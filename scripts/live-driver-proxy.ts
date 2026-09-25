import assert from "node:assert/strict";
import http from "node:http";

// Opt-in transport fault injection, not a provider adapter. Never logs headers or bodies.
assert(process.env.LITAGENT_LIVE_PROXY === "1", "Explicitly enable the disposable live-check proxy.");
const upstream = new URL(process.env.AGENTICDRIVER_URL ?? "");
assert(upstream.protocol === "http:" && upstream.hostname === "127.0.0.1" && !upstream.username && !upstream.password && !upstream.search && !upstream.hash, "Use the explicitly authorized loopback host.");
const port = Number(process.env.LITAGENT_PROXY_PORT ?? 17434);
assert(Number.isInteger(port) && port > 1024 && port < 65536 && port !== Number(upstream.port), "Choose a separate unoccupied proxy port.");
let mode: "online" | "offline" | "fail-runs" = "online";
process.on("SIGUSR1", () => { mode = "offline"; console.log("Fault mode: offline"); });
process.on("SIGUSR2", () => { mode = "fail-runs"; console.log("Fault mode: reject new runs"); });
process.on("SIGHUP", () => { mode = "online"; console.log("Fault mode: online"); });

const server = http.createServer((req, res) => {
  const route = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!route.pathname.startsWith("/v1/")) { res.writeHead(404).end(); return; }
  if (mode === "offline" || mode === "fail-runs" && req.method === "POST" && route.pathname === "/v1/runs") {
    res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message: "Synthetic transport failure for the isolated acceptance check.", retryable: false } }));
    return;
  }
  const outgoing = http.request(new URL(route.pathname + route.search, upstream), {
    method: req.method, headers: { ...req.headers, host: upstream.host }
  }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(res);
    res.once("close", () => { if (!res.writableEnded) response.destroy(); });
  });
  outgoing.on("error", () => {
    if (res.headersSent) res.destroy();
    else res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message: "Isolated proxy cannot reach its selected upstream.", retryable: false } }));
  });
  req.once("aborted", () => outgoing.destroy());
  res.once("close", () => { if (!res.writableEnded) outgoing.destroy(); });
  req.pipe(outgoing);
});
server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ proxyUrl: `http://127.0.0.1:${port}`, pid: process.pid, mode })));
