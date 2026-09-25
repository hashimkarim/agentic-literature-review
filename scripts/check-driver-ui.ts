import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { AgenticDriver } from "@agenticdriver/sdk";
import { mockProvider } from "@agenticdriver/sdk/providers";
import { serve } from "@agenticdriver/sdk/server";

// Real application routes and SDK discovery, using disposable research data and
// a mock host. This script never invokes a user's provider or changes their data.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-driver-ui-"));
const token = "driver-ui-fixture-credential-with-sufficient-length";
const models = ["demo"];
let generations = 0;
const visible = mockProvider(() => {
  generations++;
  return { text: "Fixture only" };
});
visible.info.models = models;
const hidden = {
  ...mockProvider(),
  info: {
    ...mockProvider().info,
    id: "hidden-account",
    name: "Hidden account",
  },
};
const driver = new AgenticDriver({ providers: [visible, hidden] });
const tokens = [{ token, subject: "fixture-researcher", providers: ["mock"] }];
let host = await serve(driver, { port: 0, tokens });
const driverPort = Number(new URL(host.url).port);
const reservation = net.createServer();
await new Promise<void>((resolve) =>
  reservation.listen(0, "127.0.0.1", resolve),
);
const port = (reservation.address() as net.AddressInfo).port;
await new Promise<void>((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const server = spawn("node", ["--import", "tsx", "apps/server/src/index.ts"], {
  env: {
    ...process.env,
    LITAGENT_PORT: String(port),
    LITAGENT_REPO: path.join(root, "research"),
    AGENTICDRIVER_URL: host.url,
    AGENTICDRIVER_TOKEN: token,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const exited = new Promise<void>((resolve) => {
  server.once("exit", () => resolve());
  server.once("error", () => resolve());
});
let output = "";
server.stdout.on("data", (chunk) => {
  output += String(chunk);
});
server.stderr.on("data", (chunk) => {
  output += String(chunk);
});
const apiUrl = `http://127.0.0.1:${port}`;
const webReservation = net.createServer();
await new Promise<void>((resolve) =>
  webReservation.listen(0, "127.0.0.1", resolve),
);
const webPort = (webReservation.address() as net.AddressInfo).port;
await new Promise<void>((resolve, reject) =>
  webReservation.close((error) => (error ? reject(error) : resolve())),
);
const web = spawn(
  "node",
  [
    "node_modules/vite/bin/vite.js",
    "apps/web",
    "--config",
    "apps/web/vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(webPort),
    "--strictPort",
  ],
  {
    env: { ...process.env, LITAGENT_API_URL: apiUrl },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const webExited = new Promise<void>((resolve) => {
  web.once("exit", () => resolve());
  web.once("error", () => resolve());
});
web.stdout.on("data", (chunk) => {
  output += String(chunk);
});
web.stderr.on("data", (chunk) => {
  output += String(chunk);
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let page:
  | Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newPage"]>>
  | undefined;
try {
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
    (fs.existsSync("/usr/bin/chromium-browser")
      ? "/usr/bin/chromium-browser"
      : undefined);
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null || web.exitCode !== null)
      throw new Error(output);
    try {
      ready =
        (
          await fetch(`${apiUrl}/api/settings/driver`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok &&
        (
          await fetch(`http://127.0.0.1:${webPort}`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok;
    } catch {
      /* startup */
    }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, output);
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000); // Test watchdog only; no model/run deadline.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${webPort}`);
  await page.screenshot({ path: path.join(root, "loaded-app.png") });
  console.log("Fixture app loaded:", root);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const connection = page.getByRole("region", {
    name: "AgenticDriver connection",
    exact: true,
  });
  await page.screenshot({ path: path.join(root, "settings-before-wait.png") });
  await connection.getByText(/Driver catalog refreshed/).waitFor();
  await page.screenshot({ path: path.join(root, "first-screen.png") });
  const card = page.getByRole("region", {
    name: `${visible.info.name} (AgenticDriver)`,
    exact: true,
  });
  await card.scrollIntoViewIfNeeded();
  assert.equal(
    await page
      .getByText("Hidden account (AgenticDriver)", { exact: true })
      .count(),
    0,
  );
  assert.equal(
    await card
      .getByRole("button", { name: "Enable provider", exact: true })
      .isDisabled(),
    true,
  );
  await card.getByRole("combobox", { name: "Model for mock", exact: true }).click();
  await page.getByRole("option", { name: "demo", exact: true }).click();
  await card
    .getByRole("button", { name: "Enable provider", exact: true })
    .click();
  await card.getByText("Enabled", { exact: true }).waitFor();
  assert.equal(generations, 0);
  const saved = JSON.parse(
    fs.readFileSync(
      path.join(root, "research/.litagent/provider-settings.json"),
      "utf8",
    ),
  );
  assert.equal(saved["driver.mock"].defaultModel, "demo");
  assert.equal(saved["driver.mock"].enabled, true);
  for (const patch of [
    { defaultModel: "forbidden" },
    { customModels: ["forbidden"] },
    { command: "/bin/sh" },
  ]) {
    const response = await fetch(
      `${apiUrl}/api/settings/providers/driver.mock`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    assert.equal(response.status, 400);
  }
  models.push("new-model");
  await card
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await card.getByRole("combobox", { name: "Model for mock", exact: true }).click();
  await page
    .getByRole("option", { name: "new-model", exact: true })
    .waitFor({ state: "attached" });
  await page.keyboard.press("Escape");
  assert.equal(
    (await card.getByRole("combobox", { name: "Model for mock", exact: true }).textContent())?.trim(),
    "demo",
  );
  assert.equal(await card.getByText("Enabled", { exact: true }).count(), 1);
  await page.screenshot({ path: path.join(root, "refreshed-models.png") });
  await host.close();
  await card
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await card.getByText("Unavailable", { exact: true }).waitFor();
  await card.getByRole("alert").waitFor();
  await page.screenshot({ path: path.join(root, "connection-failure.png") });
  // Disable still works offline and immediately persists. It does not erase model selection.
  await card.getByRole("button", { name: "Disable", exact: true }).click();
  await card.getByText("Disabled", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Defaults", exact: true }).click();
  assert.equal(
    await page.getByLabel("Provider", { exact: true }).inputValue(),
    "driver.mock",
  );
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  host = await serve(driver, { port: driverPort, tokens });
  await connection
    .getByRole("button", { name: "Refresh driver catalog", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Enable provider", exact: true })
    .waitFor();
  await card.getByText("Authentication unverified", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await card.getByText("Disabled", { exact: true }).waitFor();
  assert.equal(
    (await card.getByRole("combobox", { name: "Model for mock", exact: true }).textContent())?.trim(),
    "demo",
  );
  for (const endpoint of [
    "/api/settings/driver",
    "/api/settings/providers",
    "/api/provider-status",
  ]) {
    const body = await (await fetch(apiUrl + endpoint)).text();
    assert.ok(!body.includes(token) && !body.includes("hidden-account"));
  }
  assert.ok(!(await page.content()).includes(token));
  assert.equal(generations, 0);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: required model, scoped inventory, enable/disable persistence, refresh, connection failure/recovery; zero generations. Screenshots: ${root}`,
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => undefined);
    console.error(
      "Visible alerts:",
      await page.getByRole("alert").allTextContents(),
    );
  }
  console.error("Fixture server output:", output);
  throw error;
} finally {
  await browser?.close();
  web.kill("SIGTERM");
  await webExited;
  server.kill("SIGTERM");
  await exited;
  await host.close();
  // Keep screenshots for visual review; only disposable research/cache data is removed.
  fs.rmSync(path.join(root, "research"), { recursive: true, force: true });
}
