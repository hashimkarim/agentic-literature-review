import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { zipSync, strToU8, unzipSync } from "fflate";
import { LitAgentRepository, ManuscriptStore } from "@litagent/library";
import { WritingCandidateService, TexBuildService, WritingContextService } from "@litagent/workflows";
import type { WritingCandidateBatch } from "@litagent/contracts";
import { ManuscriptImportPreviewSchema, type TexRuntimeStatus } from "@litagent/contracts";
import { manuscriptRoutes } from "./manuscript-routes";

it("stores revision-checked comments over HTTP without changing source or exported files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-comments-http-"));
  const store = new ManuscriptStore(root), document = store.create({ name: "Review fixture" });
  const file = document.files.find((file) => file.path === "main.tex")!;
  const app = express(); app.use(express.json()); app.use("/api/manuscripts", manuscriptRoutes(store));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/manuscripts/${document.id}`;
  const mutate = (suffix: string, method: string, body: unknown) => fetch(url + suffix, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const selection = { path: file.path, revision: file.revision, from: 0, to: 14, quote: file.content.slice(0, 14) };
    expect((await mutate("/comments", "POST", { requestId: randomUUID(), body: "Stale", selection: { ...selection, revision: "0".repeat(64) } })).status).toBe(409);
    const response = await mutate("/comments", "POST", { requestId: randomUUID(), body: "Choose a journal class.", selection });
    expect(response.status).toBe(201);
    let thread = await response.json() as import("@litagent/contracts").ManuscriptCommentView;
    expect(thread.location?.state).toBe("attached");
    const resolve = { action: "resolve", requestId: randomUUID(), expectedVersion: 1 };
    thread = await (await mutate(`/comments/${thread.id}`, "PATCH", resolve)).json() as typeof thread;
    expect(thread.status).toBe("resolved");
    expect((await mutate(`/comments/${thread.id}`, "PATCH", { action: "reopen", requestId: randomUUID(), expectedVersion: 1 })).status).toBe(409);
    expect((await mutate(`/comments/${thread.id}`, "PATCH", { action: "reply", requestId: randomUUID(), expectedVersion: thread.version, body: "", author: "someone-else" })).status).toBe(400);
    expect(await (await fetch(url + "/comments")).json()).toEqual([thread]);
    expect(store.read(document.id)).toEqual(document);
    const archive = unzipSync(new Uint8Array(await (await fetch(url + "/archive")).arrayBuffer()));
    expect(Object.keys(archive).some((name) => name.includes(".comments"))).toBe(false);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(root, { force: true, recursive: true }); }
});

it("keeps writing attachment selection and exact context app-owned over HTTP", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-context-http-"));
  const repo = new LitAgentRepository(root); repo.init();
  const store = new ManuscriptStore(root), document = store.create({ name: "Context test" });
  const context = new WritingContextService(store, repo);
  const app = express(); app.use(express.json()); app.use("/api/manuscripts", manuscriptRoutes(store, undefined, undefined, context));
  const server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/manuscripts/${document.id}`;
  const post = (suffix: string, body: unknown) => fetch(`${url}/${suffix}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    expect((await post("sources", { path: "secrets.json", kind: "notes", content: "secret" })).status).toBe(400);
    const sourceResponse = await post("sources", { path: "metrics.csv", kind: "results", content: "accuracy\n0.72" });
    expect(sourceResponse.status).toBe(201);
    const source = await sourceResponse.json() as { id: string };
    expect(await (await fetch(`${url}/sources`)).json()).toMatchObject({ attachments: [{ id: source.id, kind: "results" }] });
    const preview = await post("context", { attachmentIds: [source.id] });
    expect(await preview.json()).toMatchObject({ sources: [{ sourceId: source.id, quote: "accuracy\n0.72" }], coverage: [{ status: "complete" }] });
    expect((await fetch(`${url}/sources/${source.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await post("context", { attachmentIds: [source.id] })).status).toBe(409);
    expect(store.read(document.id)).toEqual(document);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); }
});

it("reports the actual compiler capability when previewing imported requirements", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-import-runtime-http-"));
  const store = new ManuscriptStore(root);
  let status: TexRuntimeStatus = { available: true, engine: "texlive", version: "fixture", message: "Synthetic full runtime" };
  const builds = new TexBuildService(store, { status: () => status, compile: async () => { throw new Error("Preview must not compile"); } });
  const app = express(); app.use("/api/manuscripts", manuscriptRoutes(store, undefined, builds));
  const server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/manuscripts/import/preview`;
  const preview = async () => {
    const body = new FormData(); body.set("archive", new Blob([new Uint8Array(zipSync({ "main.tex": strToU8("\\documentclass{report}\\usepackage[backend=biber]{biblatex}\\makeglossaries\\setmainfont{Liberation Sans}") }))]), "sources.zip");
    const response = await fetch(url, { method: "POST", body }); expect(response.status).toBe(200); return ManuscriptImportPreviewSchema.parse(await response.json());
  };
  try {
    expect(await preview()).toMatchObject({ requirements: ["biber", "glossaries", "fonts"], warnings: [], compiler: { available: true } });
    status = { available: true, engine: "tectonic", version: "fixture", message: "Synthetic basic runtime" };
    expect((await preview()).warnings).toContain("This project needs the full offline TeX Live runtime for bibliography, glossary or custom font support.");
    status = { available: false, version: null, message: "Runtime missing" };
    expect((await preview()).warnings).toContain("Runtime missing");
    expect(store.list()).toEqual([]);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); }
});

it("imports, edits, downloads and exports a complete file tree over HTTP", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-import-http-"));
  const store = new ManuscriptStore(root);
  const app = express(); app.use(express.json()); app.use("/api/manuscripts", manuscriptRoutes(store));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/manuscripts`;
  const zip = zipSync({ "main.tex": strToU8("\\documentclass{article}"), "sections/one.tex": strToU8("First chapter"), "figures/plot.png": new Uint8Array([1, 2, 3]) });
  const requestId = randomUUID();
  const upload = (preview: boolean, bytes: Uint8Array = zip) => {
    const body = new FormData(); body.set("archive", new Blob([new Uint8Array(bytes)]), "overleaf.zip");
    if (!preview) body.set("options", JSON.stringify({ requestId, name: "HTTP import", entryFile: "main.tex" }));
    return fetch(`${base}/import${preview ? "/preview" : ""}`, { method: "POST", body });
  };
  try {
    const preview = await upload(true); expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ suggestedEntry: "main.tex", folders: ["figures", "sections"] });
    expect(store.list()).toEqual([]);
    expect((await upload(true, new Uint8Array([0]))).status).toBe(400);
    const response = await upload(false); expect(response.status).toBe(201);
    let document = await response.json() as import("@litagent/contracts").ManuscriptDocument;
    expect(await (await upload(false)).json()).toMatchObject({ id: document.id });
    const tree = (body: unknown) => fetch(`${base}/${document.id}/tree`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await tree({ action: "folder", path: "draft", expectedRevision: "0".repeat(64) })).status).toBe(409);
    const moved = await tree({ action: "move", path: "sections", destination: "chapters", expectedRevision: document.treeRevision }); expect(moved.status).toBe(200); document = await moved.json() as typeof document;
    expect((await tree({ action: "move", path: "main.tex", destination: "chapters/one.tex", expectedRevision: document.treeRevision })).status).toBe(400);
    const asset = document.assets![0]!;
    const fetched = await fetch(`${base}/${document.id}/assets?path=${asset.path}&revision=${asset.revision}`);
    expect(fetched.headers.get("content-type")).toContain("image/png");
    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
    const exported = await fetch(`${base}/${document.id}/archive`);
    const unzipped = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    expect(Object.keys(unzipped)).toContain("chapters/one.tex");
    expect(unzipped["figures/plot.png"]).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.keys(unzipped).some((name) => name.startsWith(".history"))).toBe(false);
    const fileBody = new FormData(); fileBody.set("file", new Blob(["New source"]), "new.tex"); fileBody.set("path", "chapters/new.tex"); fileBody.set("expectedRevision", document.treeRevision!);
    expect((await fetch(`${base}/${document.id}/upload`, { method: "POST", body: fileBody })).status).toBe(201);
    expect(store.history(document.id, "chapters/new.tex")).toHaveLength(1);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); }
});

it("serves revision-checked builds, diagnostics, and last-good PDFs over HTTP", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-tex-http-"));
  const store = new ManuscriptStore(root);
  const document = store.create({ name: "HTTP compilation" });
  let fail = false;
  const service = new TexBuildService(store, { status: () => ({ available: true, version: "fixture", message: "synthetic" }),
    compile: async () => ({ log: fail ? "error: main.tex:2: Invalid command" : "", pdf: fail ? null : Buffer.from("%PDF-1.7\nfixture") }) });
  const app = express(); app.use(express.json()); app.use("/api/manuscripts", manuscriptRoutes(store, undefined, service));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/manuscripts/${document.id}/builds`;
  const post = (body: unknown) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    expect((await post({})).status).toBe(400);
    const input = { requestId: randomUUID(), revisions: Object.fromEntries(document.files.map((file) => [file.path, file.revision])) };
    expect((await post({ ...input, revisions: { "main.tex": "0".repeat(64) } })).status).toBe(409);
    expect((await post(input)).status).toBe(202); await service.idle();
    const pdf = await fetch(`${base}/${input.requestId}/pdf`);
    expect(pdf.headers.get("Content-Type")).toContain("application/pdf");
    expect(await pdf.text()).toBe("%PDF-1.7\nfixture");
    fail = true;
    expect((await post({ ...input, requestId: randomUUID() })).status).toBe(202); await service.idle();
    expect(await (await fetch(base)).json()).toMatchObject({ latest: { status: "failed", diagnostics: [{ path: "main.tex", line: 2 }] }, lastSuccessful: { id: input.requestId } });
    expect((await fetch(`${base}/${input.requestId}/pdf`)).status).toBe(200);
    expect((await fetch(`${base}/${randomUUID()}/pdf`)).status).toBe(404);
  } finally { await service.idle(); await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); }
});

it("serves real manuscript CRUD, validation and conflict responses without a provider", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-http-"));
  const repo = new LitAgentRepository(root);
  repo.init();
  const project = repo.createProject({ name: "HTTP writing" });
  const app = express();
  app.use(express.json());
  const store = new ManuscriptStore(root);
  app.use("/api/manuscripts", manuscriptRoutes(store));
  app.use("/api/projects/:id/manuscripts", manuscriptRoutes(store));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/manuscripts`;
  const send = (url: string, method: string, body: unknown) => fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    expect(await (await fetch(base)).json()).toEqual([]);
    expect((await send(base, "POST", { name: "" })).status).toBe(400);
    const created = await send(base, "POST", { name: "First paper" });
    expect(created.status).toBe(201);
    const document = await created.json() as import("@litagent/contracts").ManuscriptDocument;
    expect(document.projectIds).toEqual([]);
    expect((await send(`${base}/${document.id}/projects`, "PUT", { projectIds: [project.id], expectedProjectIds: [] })).status).toBe(200);
    expect(await (await fetch(`${base}?projectId=${project.id}`)).json()).toMatchObject([{ id: document.id, projectIds: [project.id] }]);
    const legacy = base.replace("/api/manuscripts", `/api/projects/${project.id}/manuscripts`);
    expect((await fetch(`${legacy}/${document.id}`)).status).toBe(200);
    expect((await send(`${base}/${document.id}/projects`, "PUT", { projectIds: ["missing"], expectedProjectIds: [project.id] })).status).toBe(404);
    expect((await send(`${base}/${document.id}/projects`, "PUT", { projectIds: [], expectedProjectIds: [] })).status).toBe(409);
    const main = document.files.find((file) => file.path === "main.tex")!;
    const endpoint = `${base}/${document.id}/files`;
    const saved = await send(endpoint, "PUT", { path: main.path, content: "New source", expectedRevision: main.revision });
    expect(saved.status).toBe(200);
    const conflict = await send(endpoint, "PUT", { path: main.path, content: "Stale", expectedRevision: main.revision });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "manuscript_file_changed" });
    expect((await send(endpoint, "PUT", { path: "../bad.tex", content: "Bad", expectedRevision: null })).status).toBe(400);
    const file = await (await send(endpoint, "PUT", { path: "new.tex", content: "", expectedRevision: null })).json() as import("@litagent/contracts").ManuscriptFile;
    expect((await send(endpoint, "DELETE", { path: file.path, expectedRevision: file.revision })).status).toBe(200);
    expect(await (await fetch(`${base}/${document.id}`)).json()).toMatchObject({ name: "First paper", files: expect.arrayContaining([expect.objectContaining({ content: "New source" })]) });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("serves candidate creation, review, persistence and conflict-safe acceptance over HTTP", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-candidate-http-"));
  const repo = new LitAgentRepository(root); repo.init();
  const project = repo.createProject({ name: "HTTP candidates" });
  const store = new ManuscriptStore(root);
  const document = store.create({ name: "Synthetic manuscript", projectIds: [project.id] });
  const file = document.files.find((item) => item.path === "main.tex")!;
  let calls = 0;
  const service = new WritingCandidateService(store, {
    startRun: (input) => {
      calls++;
      return { id: "fixture", runId: input.runId, providerId: input.providerId, status: "running", cwd: input.cwd, prompt: input.prompt,
        process: null, events: new EventEmitter(), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        finished: Promise.resolve({ sessionId: "fixture", runId: input.runId, providerId: input.providerId, status: "completed", exitCode: 0, signal: null, failureClass: null,
          transcript: JSON.stringify({ text: "Synthetic replacement" }), events: [], artifacts: [] }) };
    }, cancelRun: () => {}
  }, () => {});
  const app = express(); app.use(express.json());
  app.use("/api/projects/:id/manuscripts", manuscriptRoutes(store, service));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/projects/${project.id}/manuscripts/${document.id}/candidates`;
  const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const input = { requestId: randomUUID(), path: file.path, expectedRevision: file.revision, from: 0, to: 10, instruction: "Edit", audience: 2, targets: [{ providerId: "driver.fixture", model: "synthetic", count: 2 }] };
    expect((await post(base, { ...input, to: 0 })).status).toBe(400);
    const response = await post(base, input); expect(response.status).toBe(202);
    const batch = await response.json() as WritingCandidateBatch;
    await service.idle();
    expect((await post(base, input)).status).toBe(202); expect(calls).toBe(2);
    const finished = await (await fetch(`${base}/${batch.id}`)).json() as WritingCandidateBatch;
    expect(finished.status).toBe("completed");
    expect(await (await fetch(base)).json()).toMatchObject([{ total: 2, completed: 2, path: file.path }]);
    const request = { candidateId: batch.candidates[1]!.id, expectedRevision: file.revision };
    expect((await post(`${base}/${batch.id}/accept`, { ...request, expectedRevision: "0".repeat(64) })).status).toBe(409);
    expect((await post(`${base}/${batch.id}/accept`, request)).status).toBe(200);
    expect((await post(`${base}/${batch.id}/accept`, request)).status).toBe(200);
    expect((await fetch(base.replace(project.id, "other-project"))).status).toBe(404);
  } finally {
    await service.idle();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
