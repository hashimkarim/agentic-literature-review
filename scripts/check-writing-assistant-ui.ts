import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { AgenticDriver } from "@agenticdriver/sdk";
import { mockProvider } from "@agenticdriver/sdk/providers";
import { serve } from "@agenticdriver/sdk/server";
import { AgentProviderSchema, type ManuscriptDocument, type WritingCandidateBatch, type WritingContext, type WritingAssistantOutput } from "../packages/contracts/src/index";
import { LitAgentRepository } from "../packages/library/src/index";

// Real application storage and installed SDK HTTP transport. No live accounts.
const output = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-assistant-ui-"));
const root = path.join(output, "research");
const repo = new LitAgentRepository(root); repo.init();
const paper = repo.importPaper({ metadata: { title: "Synthetic evaluation study", authors: ["Fixture Author"], year: 2026 } }).paper;
repo.writeMarkdown(paper.id, "# Results\n\nAccuracy was 0.72 on the held-out test set.\n");
let calls = 0;
const provider = mockProvider(async (request) => {
  assert.equal(request.tools.length, 0); calls++;
  const prompt = request.messages.map((message) => message.content).join("\n");
  if (prompt.startsWith("LitAgent writing source review")) {
    const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2)) as { draft: WritingAssistantOutput };
    const supported = !data.draft.text.includes("999");
    return { text: JSON.stringify({ supported, reason: supported ? "Synthetic source support check passed." : "The claimed 999 is not supported by the selected results.", claims: data.draft.claims.map((_, index) => ({ index, supported, reason: "Synthetic per-claim review." })) }) };
  }
  assert.ok(prompt.startsWith("LitAgent writing assistant"));
  const input = JSON.parse(prompt.split("Input JSON:\n\n")[1]!) as { context: WritingContext };
  const literature = input.context.sources.find((source) => source.kind === "literature")!;
  const result = input.context.sources.find((source) => source.kind === "results")!;
  assert.ok(literature && result);
  const claim = prompt.includes("unsupported fixture") ? "Accuracy was 999." : "Accuracy was 0.72.";
  return { text: JSON.stringify({ text: `${claim} [[cite:${literature.id}]]\nThe internal run recorded a score of 0.68. [[cite:${result.id}]]`, claims: [
    { text: claim, kind: "reported", evidence: [{ sourceId: literature.id, quote: "Accuracy was 0.72 on the held-out test set." }] },
    { text: "The internal run recorded a score of 0.68.", kind: "reported", evidence: [{ sourceId: result.id, quote: '"score":0.68' }] }
  ], warnings: ["Synthetic context; no generalization beyond these sources."] }) };
});
provider.info = { ...provider.info, id: "assistant-fixture", name: "Synthetic writing", models: ["fixture-one", "fixture-two"] };
const token = "synthetic-assistant-token-not-an-account";
const sdk = await serve(new AgenticDriver({ providers: [provider] }), { port: 0, tokens: [{ token, subject: "writing-fixture", providers: [provider.info.id] }] });
const descriptor = AgentProviderSchema.parse({ id: `driver.${provider.info.id}`, label: provider.info.name, command: "", installed: true, enabled: true, connected: true, authStatus: "authenticated", models: provider.info.models });
fs.writeFileSync(path.join(root, ".litagent/provider-settings.json"), JSON.stringify({ [descriptor.id]: { providerId: descriptor.id, enabled: true, connected: true, command: "", defaultModel: null, customModels: [], lastCheckedAt: null, updatedAt: new Date().toISOString() } }));
const reservation = http.createServer();
await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = (reservation.address() as import("node:net").AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const backend = spawn("bunx", ["tsx", "apps/server/src/index.ts"], { cwd: fileURLToPath(new URL("../", import.meta.url)), env: { ...process.env, LITAGENT_REPO: root, LITAGENT_PORT: String(port), AGENTICDRIVER_URL: sdk.url, AGENTICDRIVER_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = ""; backend.stdout.on("data", (chunk) => { log += chunk; }); backend.stderr.on("data", (chunk) => { log += chunk; });
const exited = new Promise<void>((resolve) => { backend.on("exit", () => resolve()); backend.on("error", () => resolve()); });
const origin = `http://127.0.0.1:${port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
async function api<T>(endpoint: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/api${endpoint}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(response.ok, await response.clone().text()); return response.json() as Promise<T>;
}
async function waitFor(fn: () => Promise<boolean>) { for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error("Timed out waiting for writing state"); }
async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "AI assistant", exact: true }).waitFor();
  if (!await page.getByRole("complementary", { name: "Writing assistant", exact: true }).isVisible()) await page.getByRole("button", { name: "AI assistant", exact: true }).click();
}
try {
  await waitFor(async () => { try { return (await fetch(`${origin}/api/projects`)).ok; } catch { return false; } });
  for (const width of [1440, 1920, 860, 390]) {
    const doc = await api<ManuscriptDocument>("/manuscripts", "POST", { name: `Assistant ${width}` });
    const base = `/manuscripts/${doc.id}`;
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("provider")) { await route.fulfill({ json: [descriptor] }); return; }
      await route.continue({ url: `${origin}${url.pathname}${url.search}` });
    });
    await page.goto(process.env.LITAGENT_TEST_URL ?? "http://localhost:5173");
    await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("button", { name: "Writing", exact: true }).click();
    await page.getByRole("button", { name: doc.name, exact: true }).click();
    await page.getByRole("textbox", { name: "TeX source", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `first-screen-${width}.png`) });
    const text = "\\section{Results}\n";
    await page.getByRole("textbox", { name: "TeX source", exact: true }).fill(text);
    await page.getByRole("textbox", { name: "TeX source", exact: true }).press("Control+End");
    await waitFor(async () => (await api<ManuscriptDocument>(base)).files.find((file) => file.path === "main.tex")?.content === text);
    await openAssistant(page);
    const assistant = page.getByRole("complementary", { name: "Writing assistant", exact: true });
    await assistant.getByRole("tab", { name: /^Sources/ }).click();
    await assistant.getByRole("checkbox", { name: /Synthetic evaluation study/ }).check();
    await assistant.getByRole("button", { name: "Attach files", exact: true }).click();
    const sourceImport = page.getByRole("dialog", { name: "Attach evidence sources", exact: true });
    await sourceImport.getByLabel("Source type", { exact: true }).selectOption("results");
    await sourceImport.getByLabel("Import selected files", { exact: true }).setInputFiles({ name: "run.json", mimeType: "application/json", buffer: Buffer.from('{"run":"synthetic","score":0.68}') });
    await sourceImport.getByRole("checkbox", { name: "Select visible files", exact: true }).check();
    await sourceImport.getByRole("button", { name: /^Attach 1 file/ }).click();
    await sourceImport.getByText("1 imported / 0 failed", { exact: true }).waitFor();
    await sourceImport.getByRole("button", { name: "Done", exact: true }).click();
    await assistant.getByRole("checkbox", { name: /run.json/ }).check();
    await page.screenshot({ path: path.join(output, `sources-${width}.png`) });
    await assistant.getByRole("tab", { name: "Compose", exact: true }).click();
    await assistant.getByRole("textbox", { name: "Writing request", exact: true }).fill("Summarize the literature and internal result, without conflating them.");
    await assistant.getByRole("combobox", { name: "Assistant connection 1", exact: true }).click();
    await page.getByRole("option", { name: descriptor.label, exact: true }).click();
    await assistant.getByRole("combobox", { name: "Assistant model 1", exact: true }).click();
    await page.getByRole("option", { name: "fixture-one", exact: true }).click();
    await assistant.getByRole("button", { name: "Add model", exact: true }).click();
    await assistant.getByRole("combobox", { name: "Assistant connection 2", exact: true }).click();
    await page.getByRole("option", { name: descriptor.label, exact: true }).click();
    await assistant.getByRole("combobox", { name: "Assistant model 2", exact: true }).click();
    await page.getByRole("option", { name: "fixture-two", exact: true }).click();
    const before = calls;
    await assistant.getByRole("button", { name: "Review context", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Review writing context", exact: true });
    await preview.getByText("Source text sent to models", { exact: true }).click();
    await preview.getByText("Accuracy was 0.72 on the held-out test set.", { exact: false }).waitFor();
    assert.equal(calls, before, "Context preview must not send inference");
    await page.screenshot({ path: path.join(output, `context-${width}.png`) });
    await preview.getByRole("button", { name: "Generate 2 candidates", exact: true }).click();
    await assistant.getByRole("button", { name: "Accept candidate 2", exact: true }).waitFor();
    assert.equal(calls - before, 4, "Two explicit models each draft and review");
    const batchId = await assistant.locator("[data-batch-id]").getAttribute("data-batch-id"); assert.ok(batchId);
    const batch = await api<WritingCandidateBatch>(`${base}/candidates/${batchId}`);
    assert.equal(batch.candidates.filter((item) => item.review?.supported).length, 2);
    assert.equal((await api<ManuscriptDocument>(base)).files.find((file) => file.path === "main.tex")?.content, text);
    const first = assistant.locator(`[data-candidate-id="${batch.candidates[0]!.id}"]`);
    await first.getByText("Evidence (2 claims)", { exact: true }).click();
    await first.getByRole("button", { name: "Inspect evidence 1.2.1", exact: true }).click();
    const evidence = page.getByRole("dialog", { name: "Writing evidence", exact: true });
    await evidence.getByText('"score":0.68', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `evidence-${width}.png`) });
    await evidence.getByRole("button", { name: "Close writing evidence", exact: true }).click();
    await assistant.getByRole("button", { name: "Reject candidate 2", exact: true }).click();
    await assistant.getByRole("button", { name: "Restore candidate 2", exact: true }).waitFor();
    assert.ok(await assistant.getByRole("button", { name: "Accept candidate 2", exact: true }).isDisabled());
    await assistant.getByRole("button", { name: "Restore candidate 2", exact: true }).click();
    await assistant.getByRole("button", { name: "Add references for candidate 1", exact: true }).click();
    await assistant.getByText("References added to references.bib.", { exact: true }).waitFor();
    await assistant.getByRole("button", { name: "Compare candidate 1", exact: true }).click();
    if (width <= 1100) await assistant.getByRole("button", { name: "Close writing assistant", exact: true }).click();
    await page.screenshot({ path: path.join(output, `comparison-${width}.png`) });
    await openAssistant(page);
    await assistant.getByRole("button", { name: "Accept candidate 1", exact: true }).click();
    await assistant.getByText("Selection accepted", { exact: true }).waitFor();
    const saved = (await api<ManuscriptDocument>(base)).files.find((file) => file.path === "main.tex")!;
    assert.ok(saved.content.includes("\\cite{litagent")); assert.ok(saved.content.includes("\\footnote{results:"));
    assert.ok((await api<ManuscriptDocument>(base)).files.find((file) => file.path === "references.bib")!.content.includes("Synthetic evaluation study"));
    await page.getByRole("button", { name: "File history", exact: true }).click();
    await page.getByRole("button", { name: /Accepted candidate/ }).waitFor();
    await openAssistant(page);
    await assistant.getByRole("tab", { name: "Compose", exact: true }).click();
    await assistant.getByRole("textbox", { name: "Writing request", exact: true }).fill("unsupported fixture");
    await assistant.getByRole("button", { name: "Remove assistant model 2", exact: true }).click();
    await assistant.getByRole("button", { name: "Review context", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Generate 1 candidate", exact: true }).click();
    await assistant.getByText("Support review failed", { exact: true }).waitFor();
    assert.ok(await assistant.getByRole("button", { name: "Accept candidate 1", exact: true }).isDisabled());
    await page.screenshot({ path: path.join(output, `review-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No page overflow");
    const previousCalls = calls;
    await page.reload();
    await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("button", { name: "Writing", exact: true }).click();
    await openAssistant(page);
    await page.getByRole("tab", { name: "Drafts", exact: true }).click();
    await page.getByText("Support review failed", { exact: true }).waitFor();
    assert.equal(calls, previousCalls, "Reload must not repeat model calls");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px: visible assistant, explicit mixed sources, two-model drafts/reviews, evidence, reject/restore, bibliography, compare/accept/history, unsupported claim blocked, reload`);
  }
  console.log(`Artifacts: ${output}`);
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  console.error(`Failure artifacts: ${output}`); throw error;
} finally {
  await browser.close();
  if (backend.pid) { try { process.kill(-backend.pid, "SIGTERM"); } catch { backend.kill("SIGTERM"); } }
  await exited; await sdk.close(); fs.writeFileSync(path.join(output, "server.log"), log);
}
