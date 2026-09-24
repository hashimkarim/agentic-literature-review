import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
import { chromium } from "playwright";
import type { ManuscriptDocument } from "../packages/contracts/src/index";

// Tests only mutate an isolated research repo; an optional real source folder is read-only.
const output = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-import-ui-"));
const folder = path.join(output, "Example thesis");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
const sources: Record<string, Buffer> = {
  "main.tex": Buffer.from("\\documentclass{article}\n\\usepackage{custom}\n\\begin{document}\n\\input{chapters/intro}\n\\includegraphics[width=1cm]{figures/plot.png}\n\\end{document}"),
  "chapters/intro.tex": Buffer.from("\\section{Introduction}\nSynthetic imported chapter."),
  "custom.sty": Buffer.from("\\RequirePackage{graphicx}\n\\newcommand{\\example}{Synthetic}"),
  "references.bib": Buffer.from("@article{fixture,title={Synthetic source}}"),
  "figures/plot.png": png,
  ".git/config": Buffer.from("hidden-fixture-not-to-be-imported"),
  "main.aux": Buffer.from("generated")
};
for (const [name, bytes] of Object.entries(sources)) { const destination = path.join(folder, name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes); }
const zipPath = path.join(output, "overleaf.zip"); fs.writeFileSync(zipPath, zipSync(sources));
const badZip = path.join(output, "broken.zip"); fs.writeFileSync(badZip, "not a zip");
const reservation = http.createServer(); await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = (reservation.address() as import("node:net").AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const backend = spawn("bunx", ["tsx", "apps/server/src/index.ts"], { cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LITAGENT_REPO: path.join(output, "research"), LITAGENT_PORT: String(port), AGENTICDRIVER_URL: "", AGENTICDRIVER_TOKEN: "" } });
let log = ""; backend.stdout.on("data", (chunk) => { log += chunk; }); backend.stderr.on("data", (chunk) => { log += chunk; });
const exited = new Promise<void>((resolve) => backend.on("exit", () => resolve()));
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium-browser" });
async function request<T>(endpoint: string): Promise<T> { const response = await fetch(`${origin}/api${endpoint}`); assert.ok(response.ok, await response.clone().text()); return response.json() as Promise<T>; }
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean) { for (let i = 0; i < 100; i++) { const value = await read(); if (accept(value)) return value; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error("Timed out waiting for saved document"); }
function hashes(directory: string, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of fs.readdirSync(path.join(directory, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(result, hashes(directory, relative));
    else if (entry.isFile()) result[relative] = createHash("sha256").update(fs.readFileSync(path.join(directory, relative))).digest("hex");
  }
  return result;
}
try {
  for (let count = 0; ; count++) { if (backend.exitCode !== null || count > 150) throw new Error(log || "Backend failed to start"); try { if ((await fetch(`${origin}/api/projects`)).ok) break; } catch { /* Starting. */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  for (const width of (process.env.LITAGENT_TEST_WIDTHS ?? "1440,1920,860,390").split(",").map(Number)) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); page.on("dialog", (dialog) => void dialog.accept());
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("provider")) { await route.fulfill({ json: [] }); return; }
      if (route.request().method() !== "GET" && !url.pathname.includes("/manuscripts")) { errors.push(`Unexpected mutation: ${url.pathname}`); await route.abort(); return; }
      // Let Chromium forward multipart file bytes; route.fetch cannot replay
      // browser file-backed upload bodies reliably.
      await route.continue({ url: `${origin}${url.pathname}${url.search}` });
    });
    const openWriting = () => page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("button", { name: "Writing", exact: true }).click();
    const showFiles = async () => { if (width <= 1100 && !await page.getByRole("tree", { name: "Document file tree" }).isVisible()) await page.getByRole("button", { name: "Toggle document files" }).click(); };
    const select = async (name: string) => { await showFiles(); await page.getByRole("treeitem", { name, exact: true }).click(); };
    await page.goto(process.env.LITAGENT_TEST_URL ?? "http://localhost:5173"); await openWriting();
    await page.getByRole("heading", { name: "Documents", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `documents-${width}.png`) });
    await page.getByRole("button", { name: "Import writing document" }).click();
    await page.getByLabel("Import Overleaf ZIP", { exact: true }).setInputFiles(badZip);
    await page.getByRole("dialog").getByRole("alert").waitFor();
    await page.getByLabel("Import Overleaf ZIP", { exact: true }).setInputFiles(zipPath);
    await page.getByRole("combobox", { name: "Imported main TeX file" }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "Imported main TeX file" }).inputValue(), "main.tex");
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(`Imported ${width}`);
    await page.screenshot({ path: path.join(output, `import-${width}.png`) });
    await page.getByRole("dialog").getByRole("button", { name: "Import document", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "TeX source", exact: true }); await editor.waitFor();
    const document = (await request<ManuscriptDocument[]>("/manuscripts")).find((item) => item.name === `Imported ${width}`)!; assert.ok(document);
    const current = () => request<ManuscriptDocument>(`/manuscripts/${document.id}`);
    await select("chapters/intro.tex");
    await editor.fill("\\section{Introduction}\nEdited imported chapter.");
    await until(current, (doc) => doc.files.some((file) => file.path === "chapters/intro.tex" && file.content.includes("Edited imported")));
    await page.getByRole("tab", { name: "main.tex", exact: true }).click(); assert.match(await editor.innerText(), /documentclass/);
    await select("figures/plot.png");
    await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>(".writing-image-preview img"); return !!image?.complete && image.naturalWidth > 0; });
    await showFiles(); await page.getByRole("button", { name: "New folder", exact: true }).click();
    await page.getByRole("textbox", { name: "Relative file path", exact: true }).fill("drafts"); await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "New TeX or BibTeX file", exact: true }).click();
    await page.getByRole("textbox", { name: "Relative file path", exact: true }).fill("drafts/result.tex"); await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
    await editor.fill("Saved chapter with history."); await until(current, (doc) => doc.files.some((file) => file.path === "drafts/result.tex" && file.content.includes("history")));
    await showFiles(); await page.getByRole("button", { name: "Rename or move selected item" }).click();
    await page.getByRole("textbox", { name: "Destination path" }).fill("chapters/result.tex"); await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.match(await editor.innerText(), /history/);
    assert.ok((await request<unknown[]>(`/manuscripts/${document.id}/history?path=chapters/result.tex`)).length >= 2);
    await showFiles(); await page.getByRole("treeitem", { name: "drafts", exact: true }).click();
    await page.getByRole("button", { name: "Delete selected file or folder" }).click(); await until(current, (doc) => !doc.folders?.includes("drafts"));
    await showFiles(); await page.getByRole("combobox", { name: "Main TeX file", exact: true }).selectOption("chapters/result.tex"); await until(current, (doc) => doc.entryFile === "chapters/result.tex");
    await page.getByRole("combobox", { name: "Main TeX file", exact: true }).selectOption("main.tex"); await until(current, (doc) => doc.entryFile === "main.tex");
    await select("main.tex");
    await page.getByRole("button", { name: "Compile", exact: true }).click(); await page.getByText("Build succeeded", { exact: true }).waitFor({ timeout: 120_000 });
    await page.locator(".writing-preview canvas").first().waitFor();
    await page.screenshot({ path: path.join(output, `editor-${width}.png`) });
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export TeX sources", exact: true }).click();
    const downloaded = await (await download).path(); assert.ok(downloaded);
    const files = unzipSync(fs.readFileSync(downloaded)); assert.deepEqual(Buffer.from(files["figures/plot.png"]!), png); assert.ok(files["chapters/result.tex"]); assert.ok(files["custom.sty"]);
    assert.equal(await page.locator(".writing-workspace").evaluate((node) => node.scrollWidth > node.clientWidth + 1), false);
    await page.reload(); await openWriting(); await editor.waitFor(); await select("chapters/result.tex"); assert.match(await editor.innerText(), /history/);
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await page.getByRole("button", { name: "Import writing document" }).click();
    await page.getByLabel("Import document folder", { exact: true }).setInputFiles(folder);
    await page.getByRole("combobox", { name: "Imported main TeX file" }).waitFor();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill(`Folder ${width}`);
    await page.getByRole("dialog").getByRole("button", { name: "Import document", exact: true }).click(); await editor.waitFor();
    const folderDoc = (await request<ManuscriptDocument[]>("/manuscripts")).find((item) => item.name === `Folder ${width}`)!;
    const imported = await request<ManuscriptDocument>(`/manuscripts/${folderDoc.id}`);
    assert.equal(imported.files.length, 4); assert.equal(imported.assets?.length, 1);
    assert.ok(imported.folders?.includes("chapters")); assert.equal(imported.folders?.includes(".git"), false);
    assert.deepEqual(errors, []); await page.close();
    console.log(`PASS ${width}px: folder/ZIP import, multi-file editing, tabs, folders, move/history, main file, figures, compilation, export, reload`);
  }
  if (process.env.LITAGENT_TEST_WRITING_FOLDER) {
    const source = path.resolve(process.env.LITAGENT_TEST_WRITING_FOLDER);
    const before = hashes(source);
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.route("**/api/**", async (route) => { const url = new URL(route.request().url()); if (url.pathname.includes("provider")) { await route.fulfill({ json: [] }); return; } await route.continue({ url: `${origin}${url.pathname}${url.search}` }); });
    await page.goto(process.env.LITAGENT_TEST_URL ?? "http://localhost:5173");
    await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("button", { name: "Writing", exact: true }).click();
    await page.getByRole("button", { name: "Import writing document" }).click();
    await page.getByLabel("Import document folder", { exact: true }).setInputFiles(source);
    await page.getByRole("combobox", { name: "Imported main TeX file" }).waitFor({ timeout: 60_000 });
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Local source compatibility check");
    await page.screenshot({ path: path.join(output, "local-folder-preview.png") });
    await page.getByRole("dialog").getByRole("button", { name: "Import document", exact: true }).click();
    await page.getByRole("textbox", { name: "TeX source", exact: true }).waitFor({ timeout: 60_000 });
    const imported = (await request<ManuscriptDocument[]>("/manuscripts")).find((item) => item.name === "Local source compatibility check")!;
    const complete = await request<ManuscriptDocument>(`/manuscripts/${imported.id}`);
    for (const file of [...complete.files, ...(complete.assets ?? [])]) assert.equal(file.revision, before[file.path], `Imported bytes changed: ${file.path}`);
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await page.getByText("Build succeeded", { exact: true }).waitFor({ timeout: 360_000 });
    await page.locator(".writing-preview canvas").first().waitFor();
    const build = await request<import("../packages/contracts/src/index").TexBuildState>(`/manuscripts/${imported.id}/builds`);
    assert.equal(build.latest?.status, "succeeded");
    assert.ok(build.latest?.log.includes("[PDF generation]"));
    const pdf = await fetch(`${origin}/api/manuscripts/${imported.id}/builds/${build.latest.id}/pdf`);
    const pdfFile = path.join(output, "local-folder-compiled.pdf"); fs.writeFileSync(pdfFile, Buffer.from(await pdf.arrayBuffer()));
    const info = execFileSync("pdfinfo", [pdfFile], { encoding: "utf8" });
    const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]); assert.ok(pages > 0);
    const text = execFileSync("pdftotext", [pdfFile, "-"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    assert.ok(text.trim().length > 1000);
    assert.deepEqual(hashes(source), before, "Original source folder was modified");
    await page.screenshot({ path: path.join(output, "local-folder-editor.png") });
    console.log(`PASS local source copy: ${complete.files.length} text files, ${complete.assets?.length} assets, ${complete.folders?.length} folders; ${pages}-page PDF compiled offline; original hashes unchanged.`);
    await page.close();
  }
  console.log(`Artifacts: ${output}`);
} catch (error) { for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {}); console.error(`Failure artifacts: ${output}`); throw error; }
finally { await browser.close(); if (backend.pid) { try { process.kill(-backend.pid, "SIGTERM"); } catch { backend.kill("SIGTERM"); } } await exited; fs.writeFileSync(path.join(output, "server.log"), log); }
