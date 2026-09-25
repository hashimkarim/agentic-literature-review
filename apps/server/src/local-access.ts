import type { Request, Response, NextFunction } from "express";

function loopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "::ffff:127.0.0.1";
}

/** Filesystem and credential setup is local-only, including when the API is LAN-bound. */
export function requireLocalAccess(req: Request, res: Response, next: NextFunction): void {
  let valid = req.get("X-LitAgent-Local") === "1" && loopback(req.socket.remoteAddress ?? "");
  try {
    valid &&= loopback(new URL(`http://${req.get("host")}`).hostname);
    if (req.get("origin")) valid &&= loopback(new URL(req.get("origin")!).hostname);
  } catch { valid = false; }
  if (!valid) { res.status(403).json({ error: "Open LitAgent on localhost to configure credentials or import local folders." }); return; }
  next();
}
