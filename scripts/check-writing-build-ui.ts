import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import type { ManuscriptDocument, TexBuildState } from "../packages/contracts/src/index";

// Real compiler and app, isolated synthetic manuscripts; no provider/model calls.
const output = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-build-ui-"));
const reservation = http.createServer();
await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = (reservation.address() as import("node:net").AddressInfo).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const backend = spawn("bunx", ["tsx", "apps/server/src/index.ts"], { cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, LITAGENT_REPO: path.join(output, "research"), LITAGENT_PORT: String(port), AGENTICDRIVER_URL: "", AGENTICDRIVER_TOKEN: "" } });
let log = "";
backend.stdout.on("data", (chunk) => { log += chunk; }); backend.stderr.on("data", (chunk) => { log += chunk; });
const exited = new Promise<void>((resolve) => backend.on("exit", () => resolve()));
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium-browser" });
async function request<T>(endpoint: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${origin}/api${endpoint}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.ok, true, await response.clone().text()); return response.json() as Promise<T>;
}
try {
  for (let count = 0; ; count++) {
    if (backend.exitCode !== null || count > 150) throw new Error(log || "Backend failed to start");
    try { if ((await fetch(`${origin}/api/projects`)).ok) break; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const width of (process.env.LITAGENT_TEST_WIDTHS ?? "1440,1920,860,390").split(",").map(Number)) {
    const document = await request<ManuscriptDocument>("/manuscripts", "POST", { name: `Compilation check ${width}` });
    const base = `/manuscripts/${document.id}`;
    const introduction = document.files.find((file) => file.path === "sections/introduction.tex")!;
    await request(`${base}/files`, "PUT", { path: introduction.path, expectedRevision: introduction.revision, content: String.raw`\section{Introduction}
\label{sec:introduction}
This synthetic manuscript exercises the local writing workspace. The editor retains source revisions while compilation produces a separate PDF. Failed builds preserve the last successful preview and do not replace saved text.

\subsection{A small example}
We use the expression $y=x^2$ to verify mathematical typesetting. This is a rendering fixture, not a research result.
\newpage
\section{Verification}
The preview contains two pages. Source history and project links remain independent of the compiler cache.
` });
    const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept());
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("provider")) { await route.fulfill({ json: [] }); return; }
      // Slow status responses must not be starved by a newer polling request.
      if (width === 1440 && route.request().method() === "GET" && url.pathname.endsWith("/builds")) await new Promise((resolve) => setTimeout(resolve, 1700));
      if (route.request().method() !== "GET" && !url.pathname.includes("/manuscripts")) { errors.push(`Unexpected mutation: ${url.pathname}`); await route.abort(); return; }
      await route.fulfill({ response: await route.fetch({ url: `${origin}${url.pathname}${url.search}` }) });
    });
    await page.goto(process.env.LITAGENT_TEST_URL ?? "http://localhost:5173");
    const openWriting = () => page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("button", { name: "Writing", exact: true }).click();
    await openWriting();
    await page.getByRole("button", { name: document.name, exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `documents-${width}.png`) });
    await page.getByRole("button", { name: document.name, exact: true }).click();
    await page.getByRole("textbox", { name: "TeX source", exact: true }).waitFor();
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await page.getByText("Build succeeded", { exact: true }).waitFor({ timeout: 120_000 });
    const canvas = page.locator(".writing-preview canvas").first();
    await canvas.waitFor();
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".writing-preview canvas");
      if (!canvas || canvas.width < 100 || canvas.height < 100) return false;
      const data = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!data) return false;
      let dark = 0, white = 0;
      for (let i = 0; i < data.length; i += 4) { if (data[i + 3]! > 0) { if (data[i]! < 220) dark++; if (data[i]! > 245) white++; } }
      return dark > 100 && white > 1000;
    });
    assert.equal(await page.getByRole("button", { name: "Open annotation tools" }).count(), 0);
    await page.getByText("Up to date", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, `preview-${width}.png`) });
    const fittedWidth = await canvas.evaluate((node) => node.width);
    await page.getByRole("textbox", { name: "Zoom percentage" }).fill("150");
    await page.getByRole("textbox", { name: "Zoom percentage" }).press("Tab");
    await page.waitForFunction((original) => (document.querySelector<HTMLCanvasElement>(".writing-preview canvas")?.width ?? 0) > original, fittedWidth);
    await page.getByTitle("Fit width", { exact: true }).click();
    await page.waitForFunction((original) => (document.querySelector<HTMLCanvasElement>(".writing-preview canvas")?.width ?? 0) === original, fittedWidth);
    const bounds = await page.locator(".writing-workspace").evaluate((node) => ({ scroll: node.scrollWidth, width: node.clientWidth }));
    assert.ok(bounds.scroll <= bounds.width + 1, `Writing layout overflow at ${width}px`);
    const first = await request<TexBuildState>(`${base}/builds`);
    assert.equal(first.latest?.status, "succeeded");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download compiled PDF" }).click();
    const download = await downloadPromise;
    const file = await download.path(); assert.ok(file); assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), "%PDF-");
    await page.getByRole("button", { name: "Source only" }).click();
    const main = document.files.find((file) => file.path === "main.tex")!;
    const editor = page.getByRole("textbox", { name: "TeX source", exact: true });
    await editor.fill(main.content.replace("\\maketitle", "\\maketitle\n\\undefinedExampleCommand"));
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await page.getByText("Build failed", { exact: true }).waitFor({ timeout: 30_000 });
    const failed = await request<TexBuildState>(`${base}/builds`);
    assert.equal(failed.lastSuccessful?.id, first.lastSuccessful?.id);
    await page.getByText("Earlier revision", { exact: true }).waitFor();
    const location = failed.latest?.diagnostics.find((item) => item.path === "main.tex" && item.line);
    assert.ok(location);
    await page.getByRole("button", { name: new RegExp(`main.tex:${location.line}:?`) }).first().click();
    await editor.waitFor();
    assert.ok((await page.locator(".writing-source .cm-activeLine").textContent())?.includes("undefinedExampleCommand"));
    await page.screenshot({ path: path.join(output, `error-location-${width}.png`) });
    await editor.fill(main.content.replace("\\title{Manuscript}", "\\title{Updated manuscript}"));
    // Preview is a prior snapshot even before autosave catches up.
    await page.getByRole("button", { name: "PDF only" }).click();
    await page.getByText("Earlier revision", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await page.getByText("Build succeeded", { exact: true }).waitFor({ timeout: 30_000 });
    await page.reload(); await openWriting();
    await page.getByRole("button", { name: "PDF only" }).click();
    await page.getByText("Up to date", { exact: true }).waitFor();
    await page.locator(".writing-preview canvas").first().waitFor();
    await page.getByRole("button", { name: "File history", exact: true }).click();
    await editor.waitFor();
    await page.getByRole("button", { name: "File history", exact: true }).click();
    await page.getByRole("button", { name: "Source only" }).click();
    await editor.fill("\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}");
    await page.getByRole("button", { name: "Compile", exact: true }).click();
    await page.getByRole("button", { name: "Cancel build", exact: true }).click();
    await page.getByText("Build cancelled", { exact: true }).waitFor({ timeout: 15_000 });
    assert.ok((await request<TexBuildState>(`${base}/builds`)).lastSuccessful);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px: real compile/PDF pixels/download, failure retains PDF, error jump, autosave, reload and cancellation`);
  }
  console.log(`Artifacts: ${output}`);
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  console.error(`Failure artifacts: ${output}`); throw error;
} finally {
  await browser.close();
  if (backend.pid) { try { process.kill(-backend.pid, "SIGTERM"); } catch { backend.kill("SIGTERM"); } }
  await exited; fs.writeFileSync(path.join(output, "server.log"), log);
}
