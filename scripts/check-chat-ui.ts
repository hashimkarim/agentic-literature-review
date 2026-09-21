import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { PaperSchema, QaResponseSchema, QaThreadSchema, type QaThread } from "../packages/contracts/src/index";

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
    const threads = new Map<string, QaThread>();
    const initialA = gate();
    const answers = new Map([["A", gate()], ["B", gate()]]);
    const submitted: string[] = [];
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
        const request = route.request().postDataJSON() as { paperId: string; question: string; threadRevision: number };
        submitted.push(request.paperId);
        await answers.get(request.paperId)?.promise;
        const thread = getThread(request.paperId);
        assert.equal(request.threadRevision, thread.revision);
        thread.revision += 1;
        const response = QaResponseSchema.parse({
          answer: `Saved answer ${request.paperId}`, question: request.question, evidence: [],
          threadId: thread.id, messageId: `answer-${request.paperId}`,
          threadRevision: thread.revision,
          scope: { type: "paper", paperId: request.paperId }
        });
        thread.messages.push(
          { id: `user-${request.paperId}`, role: "user", content: request.question, createdAt: timestamp, response: null },
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
      if (endpoint === "/api/papers") await route.fulfill({ json: papers });
      else if (endpoint.endsWith("/markdown")) await route.fulfill({ contentType: "text/markdown", body: "# Synthetic study\n\nFixture reading copy." });
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
    await selectPaper("B");
    await page.getByText("Conversation B", { exact: true }).waitFor();
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
    await selectPaper("A");
    await page.getByText("Saved answer A", { exact: true }).waitFor();
    assert.equal(await page.getByText("Saved answer B", { exact: true }).count(), 0);
    await page.locator(".la-qascope").getByRole("button", { name: "Global", exact: true }).click();
    await page.getByText("Conversation global", { exact: true }).waitFor();
    await composer.fill("Global draft");
    await selectPaper("B");
    assert.equal(await composer.inputValue(), "Global draft");
    assert.equal(await page.getByText("Conversation global", { exact: true }).count(), 1);
    await page.screenshot({ path: path.join(outputDir, `scoped-chat-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: delayed loads, separate drafts, concurrent scopes, saved-answer recovery, context scope preserved`);
    await page.close();
  }
  console.log(`Screenshots: ${outputDir}`);
} finally {
  await browser.close();
}
