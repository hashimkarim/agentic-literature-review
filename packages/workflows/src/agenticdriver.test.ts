import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgenticClient } from "@agenticdriver/sdk/client";
import { AgenticDriver } from "@agenticdriver/sdk";
import { mockProvider } from "@agenticdriver/sdk/providers";
import { serve } from "@agenticdriver/sdk/server";
import { AgenticDriverCatalog } from "@litagent/agents/agenticdriver";
import { AgentProviderSettingsStore } from "@litagent/agents";
import { LitAgentRepository } from "@litagent/library";
import { SearchIndex } from "@litagent/indexer";
import { WorkflowEngine } from "./index";

it("uses the installed SDK for cited Q&A while LitAgent validates source revisions and stores the conversation", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "litagent-driver-question-"),
  );
  const repo = new LitAgentRepository(root);
  repo.init();
  const { paper } = repo.importPaper({
    metadata: { title: "Synthetic optical detector study" },
  });
  const markdown =
    "# Results\n\nThe optical detector achieves an accuracy of 0.92 on the validation set.";
  repo.writeMarkdown(paper.id, markdown);
  const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
  index.rebuild(repo);
  let calls = 0;
  const server = await serve(
    new AgenticDriver({
      providers: [
        mockProvider((request) => {
          calls++;
          const prompt = request.messages.find((message) => message.role === "user")?.content ?? "";
          const supplied = request.messages.map((message) => message.content).join("\n");
          let result;
          if (prompt.startsWith("LitAgent Q&A source review")) {
            result = {
              supported: true,
              reason: "Fixture review matches the supplied passage.",
              claims: [
                {
                  index: 0,
                  supported: true,
                  reason: "The passage reports this value.",
                },
              ],
            };
          } else {
            const passage = [
              ...supplied.matchAll(/\[\[passage:([^\]\s]+)\]\]/g),
            ][0]?.[1];
            expect(passage).toBeTruthy();
            result = {
              status: "answered",
              claims: [
                {
                  text: "The detector achieves accuracy of 0.92 on the validation set.",
                  kind: "reported",
                  passageIds: [passage],
                },
              ],
            };
          }
          return {
            text: JSON.stringify(result),
            usage: { inputTokens: 10, outputTokens: 5 },
          };
        }),
      ],
    }),
    {
      port: 0,
      tokens: [
        {
          token: "research-fixture-token-with-32-characters",
          subject: "researcher",
          providers: ["mock"],
        },
      ],
    },
  );
  try {
    const client = new AgenticClient({
      url: server.url,
      token: "research-fixture-token-with-32-characters",
    });
    const settings = new AgentProviderSettingsStore(
      repo.resolve(".litagent/provider-settings.json"),
    );
    const catalog = new AgenticDriverCatalog(client, await client.providers());
    settings.patch(
      "driver.mock",
      { enabled: true, connected: true, defaultModel: "demo" },
      [catalog.definition("driver.mock")!],
    );
    catalog.setSettings(settings.read());
    const engine = new WorkflowEngine(
      repo,
      index,
      catalog,
      undefined,
      settings,
    );
    const result = await engine.answerQuestionInThread({
      providerId: "driver.mock",
      model: "demo",
      paperId: paper.id,
      question: "What accuracy is reported?",
      threadRevision: 0,
    });
    expect(calls).toBe(2);
    expect(result.response.answer).toContain("0.92");
    expect(result.response.evidence).toHaveLength(1);
    expect(result.response.evidence[0]).toMatchObject({
      paperId: paper.id,
      markdownHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.thread.messages).toHaveLength(2);
    expect(repo.readMarkdown(paper.id)).toBe(markdown);
    const run = engine.listRuns()[0]!;
    expect(run).toMatchObject({
      status: "completed",
      providerId: "driver.mock",
      model: "demo",
    });
    const files = fs.readdirSync(
      repo.resolve(`.litagent/cache/provider-runs/${run.id}`),
    );
    const log = files
      .filter((file) => file.endsWith(".events.jsonl"))
      .map((file) =>
        fs.readFileSync(
          repo.resolve(`.litagent/cache/provider-runs/${run.id}/${file}`),
          "utf8",
        ),
      )
      .join("\n");
    expect(log).toContain('"inputTokens":10');
    expect(log).toContain('"outputTokens":5');
    const events = log.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const ids = new Set(events.flatMap((event) => event.payload.sdkRunId ? [event.payload.sdkRunId] : []));
    expect(ids.size).toBe(2);
    expect(events.every((event) => event.runId === run.id)).toBe(true);
    const manifests = events.filter((event) => event.type === "run.completed").map((event) => event.payload.sources);
    expect(manifests).toHaveLength(2);
    expect(manifests[0]).toEqual(manifests[1]);
    expect(manifests[0]).toEqual([expect.objectContaining({ id: paper.id, revision: result.response.evidence[0]!.markdownHash, origin: "inline" })]);
    expect(engine.readRun(run.id).events.some((event) => event.type === "run.progress" && event.payload.sdkRunId)).toBe(true);
  } finally {
    await server.close();
    index.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
