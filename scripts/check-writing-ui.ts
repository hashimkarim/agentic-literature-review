import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { unzipSync, strFromU8 } from "fflate";
import { type ManuscriptDocument, type ManuscriptFile } from "../packages/contracts/src/index";

// Editor-only browser regression: an empty provider registry, no account calls.
const output = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-ui-"));
const reservation = http.createServer();
await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = (reservation.address() as import("node:net").AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const backend = spawn("bunx", ["tsx", "apps/server/src/index.ts"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, LITAGENT_REPO: path.join(output, "research"), LITAGENT_PORT: String(port), AGENTICDRIVER_URL: "", AGENTICDRIVER_TOKEN: "" },
  stdio: ["ignore", "pipe", "pipe"], detached: true
});
let backendLog = "";
backend.stdout.on("data", (chunk) => { backendLog += chunk; });
backend.stderr.on("data", (chunk) => { backendLog += chunk; });
const exited = new Promise<void>((resolve) => { backend.on("exit", () => resolve()); backend.on("error", () => resolve()); });
const origin = `http://127.0.0.1:${port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
async function request<T>(endpoint: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/api${endpoint}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.ok, true, `${method} ${endpoint}: ${await response.clone().text()}`);
  return response.json() as Promise<T>;
}
async function waitFor<T>(get: () => Promise<T>, check: (value: T) => boolean, description = "saved writing state"): Promise<T> {
  for (let i = 0; i < 150; i++) { const value = await get(); if (check(value)) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out waiting for ${description}`);
}
async function openWriting(page: Page) {
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("button", { name: "Writing", exact: true }).click();
}
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (backend.exitCode !== null) throw new Error(backendLog);
    try { if ((await fetch(`${origin}/api/projects`)).ok) { ready = true; break; } } catch { /* Wait for isolated backend startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, backendLog);
  for (const width of [1440, 1920, 860, 390]) {
    const { project } = await request<{ project: { id: string; name: string } }>("/projects", "POST", { name: `Writing test ${width}` });
    const { project: secondProject } = await request<{ project: { id: string; name: string } }>("/projects", "POST", { name: `Reusable research context ${width}${width === 390 ? " across independent writing documents" : ""}` });
    const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept());
    let offlineSaves = false;
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET" && !url.pathname.includes("/manuscripts")) {
        errors.push(`Unexpected mutation: ${url.pathname}`); await route.abort(); return;
      }
      if (offlineSaves && route.request().method() === "PUT") { await route.abort(); return; }
      await route.fulfill({ response: await route.fetch({ url: `${origin}${url.pathname}${url.search}` }) });
    });
    await page.goto(process.env.LITAGENT_TEST_URL ?? "http://localhost:5173");
    await page.getByRole("button", { name: "Projects", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `first-screen-${width}.png`) });
    assert.equal(await page.locator(".la-toolstrip").getByRole("button", { name: "Writing", exact: true }).count(), 0);
    await openWriting(page);
    await page.getByRole("heading", { name: "Documents", exact: true }).waitFor();
    await page.getByRole("button", { name: "New document", exact: true }).click();
    const documentName = `Synthetic manuscript ${width}${width === 390 ? ": a long title for independent research documents" : ""}`;
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(documentName);
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("textbox", { name: "TeX source", exact: true }).waitFor();
    const metadata = (await request<ManuscriptDocument[]>("/manuscripts")).find((item) => item.name === documentName);
    assert.ok(metadata);
    assert.deepEqual(metadata.projectIds, [], "Documents must not require or infer an owning project");
    const base = `/manuscripts/${metadata.id}`;
    const current = async () => (await request<ManuscriptDocument>(base)).files.find((file) => file.path === "main.tex")!;
    const linkBoth = async () => {
      await page.getByRole("button", { name: "Link projects", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Linked projects", exact: true });
      await dialog.getByRole("checkbox", { name: project.name, exact: true }).check();
      await dialog.getByRole("checkbox", { name: secondProject.name, exact: true }).check();
      await page.screenshot({ path: path.join(output, `project-links-${width}.png`) });
      await dialog.getByRole("button", { name: "Save links", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    };
    await linkBoth();
    assert.deepEqual((await request<ManuscriptDocument>(base)).projectIds, [project.id, secondProject.id].sort());
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await page.getByRole("combobox", { name: "Filter documents by project" }).selectOption(project.id);
    assert.equal(await page.getByRole("table", { name: "Writing documents" }).locator("tbody tr").count(), 1);
    await page.getByRole("button", { name: "New document", exact: true }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(`Follow-up document ${width}`);
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("textbox", { name: "TeX source", exact: true }).waitFor();
    await linkBoth();
    assert.equal((await request<unknown[]>(`/manuscripts?projectId=${project.id}`)).length, 2);
    assert.equal((await request<unknown[]>(`/manuscripts?projectId=${secondProject.id}`)).length, 2);
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await page.getByRole("button", { name: documentName, exact: true }).waitFor();
    assert.equal(await page.getByRole("table", { name: "Writing documents" }).locator("tbody tr").count(), 2);
    await page.screenshot({ path: path.join(output, `documents-${width}.png`) });
    await page.getByRole("searchbox", { name: "Find documents", exact: true }).fill("Follow-up");
    assert.equal(await page.getByRole("button", { name: documentName, exact: true }).count(), 0);
    await page.getByRole("searchbox", { name: "Find documents", exact: true }).fill("");
    await page.getByRole("button", { name: documentName, exact: true }).click();
    await page.getByRole("textbox", { name: "TeX source", exact: true }).waitFor();
    // Concurrent link edits cannot overwrite another window's selection.
    await page.getByRole("button", { name: "Link projects", exact: true }).click();
    const linksDialog = page.getByRole("dialog", { name: "Linked projects", exact: true });
    await linksDialog.getByRole("checkbox", { name: secondProject.name, exact: true }).uncheck();
    await request(`${base}/projects`, "PUT", { projectIds: [secondProject.id], expectedProjectIds: [project.id, secondProject.id] });
    await linksDialog.getByRole("button", { name: "Save links", exact: true }).click();
    await linksDialog.getByRole("alert").filter({ hasText: "Project links changed elsewhere" }).waitFor();
    await linksDialog.getByRole("button", { name: "Reload links", exact: true }).click();
    await waitFor(() => linksDialog.getByRole("checkbox", { name: secondProject.name, exact: true }).isChecked(), Boolean);
    assert.equal(await linksDialog.getByRole("checkbox", { name: project.name, exact: true }).isChecked(), false);
    await linksDialog.getByRole("checkbox", { name: project.name, exact: true }).check();
    await linksDialog.getByRole("button", { name: "Save links", exact: true }).click();
    await linksDialog.waitFor({ state: "hidden" });
    const first = "\\section{Introduction}\nA synthetic result is documented here.\n";
    await page.getByRole("textbox", { name: "TeX source", exact: true }).fill(first);
    await waitFor(current, (file) => file.content === first);
    await page.getByRole("status").filter({ hasText: /^Saved$/ }).waitFor();
    await page.getByRole("button", { name: "File history", exact: true }).click();
    await page.getByRole("button", { name: "Named checkpoint", exact: true }).click();
    await page.getByRole("textbox", { name: "Version name", exact: true }).fill("Before supervisor review");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: /Before supervisor review/ }).waitFor();
    const second = "\\section{Introduction}\nA revised synthetic result with a limitation.\n";
    await page.getByRole("textbox", { name: "TeX source", exact: true }).fill(second);
    await waitFor(current, (file) => file.content === second);
    await page.getByRole("button", { name: /Before supervisor review/ }).click();
    await page.getByRole("button", { name: "Restore this version", exact: true }).waitFor();
    assert.equal(await page.locator(".writing-comparison .cm-content").count(), width <= 600 ? 1 : 2);
    await page.screenshot({ path: path.join(output, `history-${width}.png`) });
    await page.getByRole("button", { name: "Restore this version", exact: true }).click();
    await waitFor(current, (file) => file.content === first);
    await page.getByRole("textbox", { name: "TeX source", exact: true }).waitFor();
    const saved = await current();
    await request<ManuscriptFile>(`${base}/files`, "PUT", { path: "main.tex", content: "External editor version", expectedRevision: saved.revision });
    await page.getByRole("textbox", { name: "TeX source", exact: true }).fill("My concurrent version");
    await page.getByRole("status").filter({ hasText: /^Conflict$/ }).waitFor();
    assert.equal((await current()).content, "External editor version");
    await page.getByRole("button", { name: "Compare saved version", exact: true }).click();
    await page.getByRole("button", { name: "Save my version", exact: true }).click();
    await waitFor(current, (file) => file.content === "My concurrent version");
    offlineSaves = true;
    await page.getByRole("textbox", { name: "TeX source", exact: true }).fill("Recovered local work");
    await page.getByRole("status").filter({ hasText: /^Save failed$/ }).waitFor();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    offlineSaves = false;
    await openWriting(page);
    await page.getByRole("status").filter({ hasText: /^Recovered draft$/ }).waitFor();
    await page.getByRole("button", { name: "Save recovered draft", exact: true }).click();
    await waitFor(current, (file) => file.content === "Recovered local work");
    await page.getByLabel("More writing actions", { exact: true }).click();
    await page.getByRole("button", { name: "New TeX or BibTeX file", exact: true }).click();
    await page.getByRole("textbox", { name: "Relative file path", exact: true }).fill("sections/methods.tex");
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.locator('.writing-editor[data-file-path="sections/methods.tex"]').waitFor();
    await page.getByRole("textbox", { name: "TeX source", exact: true }).fill("\\section{Methods}\nSynthetic protocol.");
    await waitFor(() => request<ManuscriptDocument>(base), (doc) => doc.files.some((file) => file.path === "sections/methods.tex" && file.content.includes("Synthetic protocol")));
    const downloadPromise = page.waitForEvent("download");
    await page.getByLabel("More writing actions", { exact: true }).click();
    await page.getByRole("button", { name: "Export TeX sources", exact: true }).click();
    const download = await downloadPromise;
    const zip = path.join(output, `sources-${width}.zip`); await download.saveAs(zip);
    const sources = unzipSync(fs.readFileSync(zip));
    assert.equal(strFromU8(sources["main.tex"]!), "Recovered local work");
    assert.equal(Object.keys(sources).some((key) => key.includes(".history")), false);
    await page.screenshot({ path: path.join(output, `editor-${width}.png`) });
    const overflow = await page.locator(".writing-workspace").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    assert.equal(overflow, false, `Writing workspace overflow at ${width}`);
    await page.reload();
    await openWriting(page);
    await page.getByRole("textbox", { name: "TeX source", exact: true }).waitFor();
    assert.match(await page.getByRole("textbox", { name: "TeX source", exact: true }).innerText(), /Synthetic protocol/);
    await page.getByRole("tab", { name: "main.tex", exact: true }).click();
    assert.match(await page.getByRole("textbox", { name: "TeX source", exact: true }).innerText(), /Recovered local work/);
    const historyBeforeUnlink = await request(`${base}/history?path=main.tex`);
    await page.getByRole("button", { name: "Link projects", exact: true }).click();
    await page.getByRole("dialog").getByRole("checkbox", { name: project.name, exact: true }).uncheck();
    await page.getByRole("dialog").getByRole("checkbox", { name: secondProject.name, exact: true }).uncheck();
    await page.getByRole("dialog").getByRole("button", { name: "Save links", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.deepEqual((await request<ManuscriptDocument>(base)).projectIds, []);
    assert.deepEqual(await request(`${base}/history?path=main.tex`), historyBeforeUnlink);
    assert.equal((await current()).content, "Recovered local work");
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await page.getByRole("combobox", { name: "Filter documents by project" }).selectOption("unlinked");
    await page.getByRole("button", { name: documentName, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: `Follow-up document ${width}`, exact: true }).count(), 0);
    await page.getByRole("button", { name: documentName, exact: true }).click();
    await page.reload(); await openWriting(page);
    await page.getByText("No linked projects", { exact: true }).waitFor();
    assert.equal((await current()).content, "Recovered local work");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px: global documents, shared project links, link conflicts/unlink/reload, editor/history/recovery/export`);
  }
  console.log(`Artifacts: ${output}`);
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  console.error(`Failure artifacts: ${output}`);
  throw error;
} finally {
  await browser.close();
  if (backend.pid) { try { process.kill(-backend.pid, "SIGTERM"); } catch { backend.kill("SIGTERM"); } }
  await exited;
  fs.writeFileSync(path.join(output, "server.log"), backendLog);
}
