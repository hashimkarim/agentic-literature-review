import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { expect, it } from "vitest";
import { LitAgentRepository, ManuscriptStore } from "@litagent/library";
import type { LocalFolderPreview } from "@litagent/contracts";
import { LocalFolderImports, localImportRoutes } from "./local-import";

it("recursively previews eligible files without secrets/dependencies and rejects changed files and links", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-folder-"));
  try {
    fs.mkdirSync(path.join(root, "src")); fs.mkdirSync(path.join(root, ".hidden")); fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "src/method.ts"), "export const value = 1;");
    fs.writeFileSync(path.join(root, "results.csv"), "method,latency\nA,10\n");
    fs.writeFileSync(path.join(root, "credentials.json"), '{"token":"do not read"}');
    fs.writeFileSync(path.join(root, ".hidden/ignored.md"), "hidden");
    fs.writeFileSync(path.join(root, "node_modules/package.js"), "dependency");
    fs.writeFileSync(path.join(root, "large.txt"), "x".repeat(256001));
    fs.symlinkSync(path.join(root, "results.csv"), path.join(root, "linked.csv"));
    const imports = new LocalFolderImports();
    const preview = await imports.preview({ path: root, kind: "sources" });
    expect(preview.files.map((file) => file.path)).toEqual(["results.csv", "src/method.ts"]);
    expect(preview.skipped).toBeGreaterThanOrEqual(5);
    expect((await imports.read(preview.id, preview.files[0]!.id)).bytes.toString()).toContain("latency");
    fs.writeFileSync(path.join(root, "results.csv"), "Changed source");
    await expect(imports.read(preview.id, preview.files[0]!.id)).rejects.toThrow("changed");
    fs.renameSync(path.join(root, "src"), path.join(root, "moved")); fs.symlinkSync(path.join(root, "moved"), path.join(root, "src"));
    await expect(imports.read(preview.id, preview.files[1]!.id)).rejects.toThrow("changed");
    await expect(imports.read(randomUUID(), preview.files[0]!.id)).rejects.toThrow("expired");
    await expect(imports.preview({ path: "relative", kind: "pdf" })).rejects.toThrow("absolute");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it("imports selected PDFs idempotently across projects and attaches local source snapshots without execution", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-import-http-"));
  const repo = new LitAgentRepository(path.join(root, "repo")); repo.init();
  const manuscripts = new ManuscriptStore(repo.root), document = manuscripts.create({ name: "Synthetic" });
  const project = repo.createProject({ name: "Project one" }), other = repo.createProject({ name: "Project two" });
  const sources = path.join(root, "sources"); fs.mkdirSync(path.join(sources, "nested"), { recursive: true });
  fs.writeFileSync(path.join(sources, "nested/study.pdf"), "%PDF-1.4\nSynthetic fixture bytes\n%%EOF");
  fs.writeFileSync(path.join(sources, "nested/fake.pdf"), "Not a PDF");
  fs.writeFileSync(path.join(sources, "results.csv"), "value,condition\n12,synthetic");
  const indexed: string[] = [];
  const app = express(); app.use(express.json()); app.use("/import", localImportRoutes(repo, manuscripts, (id) => indexed.push(id)));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/import`;
  const post = (route: string, body: unknown) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", "X-LitAgent-Local": "1" }, body: JSON.stringify(body) });
  try {
    expect((await fetch(base + "/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: sources, kind: "pdf" }) })).status).toBe(403);
    const preview = await (await post("/preview", { path: sources, kind: "pdf" })).json() as LocalFolderPreview;
    const entryId = preview.files.find((file) => file.path.endsWith("study.pdf"))!.id;
    const input = { previewId: preview.id, entryId, projectId: project.id };
    expect((await post("/entry", input)).status).toBe(201);
    expect((await post("/entry", input)).status).toBe(201);
    expect((await post("/entry", { ...input, projectId: other.id })).status).toBe(201);
    expect(repo.listGlobalPapers()).toHaveLength(1); expect(repo.listPapers(project.id)).toHaveLength(1); expect(repo.listPapers(other.id)).toHaveLength(1);
    expect(repo.listGlobalPapers()[0]?.title).toBe("study"); expect(new Set(indexed).size).toBe(1);
    expect((await post("/entry", { ...input, entryId: preview.files.find((file) => file.path.endsWith("fake.pdf"))!.id })).status).toBe(400);
    const sourcePreview = await (await post("/preview", { path: sources, kind: "sources" })).json() as LocalFolderPreview;
    const sourceInput = { previewId: sourcePreview.id, entryId: sourcePreview.files[0]!.id, manuscriptId: document.id };
    expect((await post("/entry", sourceInput)).status).toBe(201);
    expect((await post("/entry", sourceInput)).status).toBe(201);
    expect(manuscripts.writingAttachments(document.id)).toMatchObject([{ path: "results.csv", kind: "results", originPath: path.join(sources, "results.csv") }]);
    expect(manuscripts.read(document.id)).toEqual(document);
    expect(fs.readFileSync(path.join(sources, "results.csv"), "utf8")).toBe("value,condition\n12,synthetic");
    expect(fs.readdirSync(repo.resolve(".litagent/cache/imports"))).toEqual([]);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); }
});
