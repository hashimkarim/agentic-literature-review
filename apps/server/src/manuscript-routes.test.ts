import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { LitAgentRepository, ManuscriptStore } from "@litagent/library";
import { WritingCandidateService } from "@litagent/workflows";
import type { WritingCandidateBatch } from "@litagent/contracts";
import { manuscriptRoutes } from "./manuscript-routes";

it("serves real manuscript CRUD, validation and conflict responses without a provider", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-http-"));
  const repo = new LitAgentRepository(root);
  repo.init();
  const project = repo.createProject({ name: "HTTP writing" });
  const app = express();
  app.use(express.json());
  app.use("/api/projects/:id/manuscripts", manuscriptRoutes(new ManuscriptStore(root)));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/projects/${project.id}/manuscripts`;
  const send = (url: string, method: string, body: unknown) => fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    expect(await (await fetch(base)).json()).toEqual([]);
    expect((await send(base, "POST", { name: "" })).status).toBe(400);
    const created = await send(base, "POST", { name: "First paper" });
    expect(created.status).toBe(201);
    const document = await created.json() as import("@litagent/contracts").ManuscriptDocument;
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
  const document = store.create(project.id, { name: "Synthetic manuscript" });
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
