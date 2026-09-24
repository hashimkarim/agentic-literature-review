import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { expect, it } from "vitest";
import { LitAgentRepository, ManuscriptStore } from "@litagent/library";
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
