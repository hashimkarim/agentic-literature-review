import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { CitationTargetSchema, PaperSchema, PassageSchema, QaResponseSchema, QaThreadSchema, type QaThread } from "../packages/contracts/src/index";

// All API traffic is fixture-backed. This test cannot invoke providers or write
// papers, annotations or chat history in the user's research repository.
const appUrl = process.env.LITAGENT_TEST_URL ?? "http://localhost:5173";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined);
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-chat-ui-"));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

try {
  for (const width of [1440, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const timestamp = new Date().toISOString();
    const papers = ["A", "B"].map((label) => ({
      paper: PaperSchema.parse({ id: label, title: `Synthetic study ${label}`, authors: ["Fixture Author"], filePaths: {}, createdAt: timestamp, updatedAt: timestamp }),
      link: null
    }));
    const passages = papers.flatMap(({ paper }) => ["method", "result", "limitation"].map((section, index) => PassageSchema.parse({
      id: `${paper.id}-${section}`, paperId: paper.id, section, page: index + 1,
      quote: `Study ${paper.id} ${section}: synthetic supporting text.`, markdownStart: 3 + index * 2, markdownEnd: 3 + index * 2
    })));
    const openedCitations: string[] = [];
    const threads = new Map<string, QaThread>();
    const initialA = gate();
    const answers = new Map<string | null, ReturnType<typeof gate>>([["A", gate()], ["B", gate()], [null, gate()]]);
    const submitted: Array<string | null> = [];
    let delayA = true;
    let failHistoryB = false;
    const getThread = (paperId: string | null) => {
      const key = paperId ?? "global";
      let thread = threads.get(key);
      if (!thread) {
        thread = QaThreadSchema.parse({ id: `thread-${key}`, title: `Conversation ${key}`, paperId, createdAt: timestamp, updatedAt: timestamp });
        threads.set(key, thread);
      }
      return thread;
    };
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname;
      if (endpoint === "/api/qa/thread") {
        const paperId = url.searchParams.get("paperId");
        if (route.request().method() === "DELETE") {
          threads.delete(paperId ?? "global");
        } else if (paperId === "A" && delayA) {
          await initialA.promise;
        } else if (paperId === "B" && failHistoryB) {
          failHistoryB = false;
          await route.fulfill({ status: 503, json: { error: "Fixture history refresh unavailable" } });
          return;
        }
        await route.fulfill({ json: getThread(paperId) });
        return;
      }
      if (endpoint === "/api/qa") {
        const request = route.request().postDataJSON() as { paperId: string | null; question: string; threadRevision: number };
        submitted.push(request.paperId);
        await answers.get(request.paperId)?.promise;
        const thread = getThread(request.paperId);
        assert.equal(request.threadRevision, thread.revision);
        thread.revision += 1;
        const evidence = (thread.revision === 1 ? passages.filter((passage) => passage.paperId === request.paperId).slice(0, 1)
          : thread.revision === 2 ? passages.filter((passage) => passage.paperId === request.paperId).slice(1) : [])
          .map((passage) => ({ ...passage, passageId: passage.id, paperTitle: `Synthetic study ${passage.paperId}`, confidence: null }));
        const response = QaResponseSchema.parse({
          answer: request.paperId === null ? "New global reply" : thread.revision === 1 ? `Saved answer ${request.paperId}` : thread.revision === 2 ? `Follow-up answer ${request.paperId} [1] [2].` : "Not found in the selected sources.",
          question: request.question, evidence, status: evidence.length ? "answered" : "not_found",
          threadId: thread.id, messageId: `answer-${request.paperId}-${thread.revision}`,
          threadRevision: thread.revision,
          scope: { type: request.paperId ? "paper" : "global", paperId: request.paperId }
        });
        thread.messages.push(
          { id: `user-${request.paperId}-${thread.revision}`, role: "user", content: request.question, createdAt: timestamp, response: null },
          { id: response.messageId!, role: "assistant", content: response.answer, createdAt: timestamp, response }
        );
        await route.fulfill({ json: response });
        return;
      }
      if (route.request().method() !== "GET") {
        errors.push(`Unexpected mutation: ${route.request().method()} ${endpoint}`);
        await route.abort();
        return;
      }
      const citationPath = endpoint.match(/^\/api\/papers\/([^/]+)\/passages\/([^/]+)\/target$/);
      if (citationPath) {
        const passage = passages.find((item) => item.paperId === citationPath[1] && item.id === citationPath[2]);
        assert.ok(passage);
        openedCitations.push(passage.id);
        await route.fulfill({ json: CitationTargetSchema.parse({
          paperId: passage.paperId, passageId: passage.id, paperTitle: `Synthetic study ${passage.paperId}`, quote: passage.quote,
          page: passage.page, section: passage.section, pdf: { available: false },
          markdown: { available: true, startLine: passage.markdownStart, endLine: passage.markdownEnd }
        }) });
        return;
      }
      if (endpoint === "/api/papers") await route.fulfill({ json: papers });
      else if (endpoint.endsWith("/markdown")) await route.fulfill({ contentType: "text/markdown", body: `# Synthetic study\n\n${passages.filter((item) => item.paperId === endpoint.split("/")[3]).map((item) => item.quote).join("\n\n")}` });
      else if (endpoint.endsWith("/passages")) await route.fulfill({ json: passages.filter((item) => item.paperId === endpoint.split("/")[3]) });
      else if (endpoint === "/api/status") await route.fulfill({ json: { repoRoot: "fixture", projects: 0, papers: 2, git: { branch: "fixture", clean: true, lfsAvailable: true }, providers: [] } });
      else await route.fulfill({ json: [] });
    });

    await page.goto(appUrl);
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.getByText("Loading conversation", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(outputDir, `first-screen-${width}.png`) });
    const selectPaper = (label: string) => page.locator(".la-paper").filter({ hasText: `Synthetic study ${label}` }).click();
    const composer = page.getByRole("textbox", { name: "Question", exact: true });
    const evidenceTab = page.locator('.la-agenttabs button[title="Evidence"]');
    await selectPaper("B");
    await page.getByText("Conversation B", { exact: true }).waitFor();
    await evidenceTab.click();
    await page.getByText("No answer selected", { exact: true }).waitFor();
    assert.equal(await page.locator(".la-evcard").count(), 0);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    delayA = false;
    initialA.release();
    await composer.fill("Draft B");
    await selectPaper("A");
    await page.getByText("Conversation A", { exact: true }).waitFor();
    await composer.fill("Draft A");
    await selectPaper("B");
    assert.equal(await composer.inputValue(), "Draft B");
    await selectPaper("A");
    assert.equal(await composer.inputValue(), "Draft A");
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await page.locator(".la-chatthinking").waitFor();
    await selectPaper("B");
    await page.getByText("Conversation B", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await page.locator(".la-chatthinking").waitFor();
    const savedA = page.waitForResponse((response) => response.url().endsWith("/api/qa") && response.request().postDataJSON().paperId === "A");
    answers.get("A")!.release();
    await savedA;
    assert.equal(await composer.isDisabled(), true);
    assert.equal(await page.getByText("Conversation B", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Saved answer A", { exact: true }).count(), 0);
    failHistoryB = true;
    answers.get("B")!.release();
    await page.getByText("Saved answer B", { exact: true }).waitFor();
    await page.getByText("History unavailable", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Retry", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await page.getByText("History unavailable", { exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual(submitted, ["A", "B"]);
    await evidenceTab.click();
    await page.locator(".la-evcard .quote").filter({ hasText: "Study B method:" }).waitFor();
    assert.equal(await page.locator(".la-evcard").count(), 1);
    assert.equal(await page.locator(".la-evcard .la-conf").count(), 0);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await composer.fill("What were the results and limitations?");
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await page.locator(".la-amsg.active").filter({ hasText: "Follow-up answer B" }).waitFor();
    await evidenceTab.click();
    await page.locator(".la-evidencehead strong").filter({ hasText: "What were the results and limitations?" }).waitFor();
    assert.equal(await page.locator(".la-evcard").count(), 2);
    assert.equal(await page.locator(".la-evcard").filter({ hasText: "Study B method:" }).count(), 0);
    for (const section of ["result", "limitation"]) {
      const card = page.locator(".la-evcard").filter({ hasText: `Study B ${section}:` });
      await card.focus();
      await card.press("Enter");
      await page.locator(".la-reader").getByText(`"Study B ${section}: synthetic supporting text."`, { exact: true }).waitFor();
    }
    assert.deepEqual(openedCitations, ["B-result", "B-limitation"]);
    await page.screenshot({ path: path.join(outputDir, `evidence-${width}.png`) });
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.locator(".la-amsg").filter({ hasText: "Saved answer B" }).getByRole("button", { name: "Evidence 1", exact: true }).click();
    await page.locator(".la-evcard .quote").filter({ hasText: "Study B method:" }).waitFor();
    await selectPaper("A");
    await page.locator(".la-evcard .quote").filter({ hasText: "Study A method:" }).waitFor();
    await selectPaper("B");
    await page.locator(".la-evcard .quote").filter({ hasText: "Study B method:" }).waitFor();
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await composer.fill("A question without supporting sources");
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await page.locator(".la-amsg.active").filter({ hasText: "Not found in the selected sources." }).waitFor();
    await evidenceTab.click();
    await page.getByText("No evidence for this answer", { exact: true }).waitFor();
    assert.equal(await page.locator(".la-evcard").count(), 0);
    await selectPaper("A");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.getByText("Saved answer A", { exact: true }).waitFor();
    assert.equal(await page.getByText("Saved answer B", { exact: true }).count(), 0);
    const globalThread = getThread(null);
    globalThread.revision = 12;
    for (let index = 0; index < 12; index++) {
      const response = QaResponseSchema.parse({
        question: `Previous question ${index}`, answer: `Previous answer ${index}. ${"A synthetic explanation for testing conversation reading position. ".repeat(12)}`, evidence: []
      });
      globalThread.messages.push(
        { id: `global-user-${index}`, role: "user", content: response.question, createdAt: timestamp, response: null },
        { id: `global-answer-${index}`, role: "assistant", content: response.answer, createdAt: timestamp, response }
      );
    }
    await page.locator(".la-qascope").getByRole("button", { name: "Global", exact: true }).click();
    await page.getByText("Conversation global", { exact: true }).waitFor();
    await composer.fill("Global draft");
    await selectPaper("B");
    assert.equal(await composer.inputValue(), "Global draft");
    assert.equal(await page.getByText("Conversation global", { exact: true }).count(), 1);
    assert.equal(await page.locator(".la-chat-source-warning").count(), 0);
    await page.screenshot({ path: path.join(outputDir, `scoped-chat-${width}.png`) });
    const chatBody = page.locator(".la-chatbody");
    const atLatest = () => page.waitForFunction(() => {
      const body = document.querySelector(".la-chatbody")!;
      return body.scrollHeight - body.scrollTop - body.clientHeight < 2;
    });
    const atReadingPosition = () => page.waitForFunction(() => Math.abs(document.querySelector(".la-chatbody")!.scrollTop - 300) < 2);
    await atLatest();
    await chatBody.evaluate((element) => { element.scrollTop = 300; });
    await page.getByRole("button", { name: "Jump to latest message", exact: true }).waitFor();
    await evidenceTab.click();
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await atReadingPosition();
    await page.locator(".la-qascope").getByRole("button", { name: "Paper", exact: true }).click();
    await page.getByText("Conversation B", { exact: true }).waitFor();
    await page.locator(".la-qascope").getByRole("button", { name: "Global", exact: true }).click();
    await page.getByText("Conversation global", { exact: true }).waitFor();
    await atReadingPosition();
    await page.getByRole("button", { name: "Send question", exact: true }).click();
    await page.locator(".la-chatthinking").waitFor();
    await atLatest();
    await chatBody.evaluate((element) => { element.scrollTop = 300; });
    await page.getByRole("button", { name: "Jump to latest message", exact: true }).waitFor();
    answers.get(null)!.release();
    await page.getByText("New global reply", { exact: true }).waitFor();
    await page.getByText("Loading conversation", { exact: true }).waitFor({ state: "hidden" });
    await atReadingPosition();
    await page.screenshot({ path: path.join(outputDir, `reading-position-${width}.png`) });
    await page.getByRole("button", { name: "Jump to latest message", exact: true }).click();
    await atLatest();
    await composer.fill("A longer\nmultiline\ncomposer\ndraft\nfor layout");
    await atLatest();
    assert.deepEqual(errors, []);
    assert.deepEqual(submitted, ["A", "B", "B", "B", null]);
    console.log(`PASS ${width}px: scoped chat, answer-specific evidence, citation targets, preserved reading position, jump to latest`);
    await page.close();
  }
  console.log(`Screenshots: ${outputDir}`);
} finally {
  await browser.close();
}
