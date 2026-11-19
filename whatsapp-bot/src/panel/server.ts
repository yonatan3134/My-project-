import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { logger } from "../logger.js";
import { DATA_DIR } from "../paths.js";
import { PAGE } from "./page.js";

export const PASSWORD_FILE = path.join(DATA_DIR, "panel-password");

/** Reads the panel password, creating a random one the first time. */
export function panelPassword(): string {
  if (fs.existsSync(PASSWORD_FILE)) {
    const p = fs.readFileSync(PASSWORD_FILE, "utf8").trim();
    if (p.length >= 8) return p;
  }
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(12);
  const p = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PASSWORD_FILE, `${p}\n`, { mode: 0o600 });
  return p;
}

export interface PanelApi {
  state(): unknown;
  saveSettings(body: Record<string, unknown>): Promise<string | null>;
  saveChannels(body: Record<string, unknown>): Promise<string | null>;
  startLink(): Promise<string | null>;
  setPaused(paused: boolean): void;
  setGrowth(on: boolean): void;
  queue(channelId: string): unknown;
  pauseChannel(id: string, paused: boolean): string | null;
  setApprove(id: string, on: boolean): string | null;
  approve(id: number): string | null;
  pending(channelId: string): unknown;
  test(id: string): Promise<{ error?: string; results?: unknown }>;
  sendNow(id: string, prompt: string): Promise<{ text: string } | { error: string }>;
  flush(id: string): string | null;
  push(id: string, message: string): string | null;
  discard(id: number): string | null;
}

const MAX_BODY = 512 * 1024;

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown;
        resolve(v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const data = typeof body === "string" && type.startsWith("text/") ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(data);
}

/**
 * The settings website. Protected by a password (browser login box, any
 * user name). Failed logins from one address are slowed down.
 */
export function startPanel(api: PanelApi, port: number): http.Server {
  const password = Buffer.from(panelPassword());
  const fails = new Map<string, { n: number; until: number }>();

  const authorized = (req: http.IncomingMessage): boolean => {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Basic ")) return false;
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const given = Buffer.from(decoded.slice(decoded.indexOf(":") + 1));
    return given.length === password.length && crypto.timingSafeEqual(given, password);
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const ip = req.socket.remoteAddress ?? "?";
      const f = fails.get(ip);
      if (f && f.until > Date.now()) return send(res, 429, "יותר מדי ניסיונות. נסה שוב בעוד רבע שעה.", "text/plain; charset=utf-8");
      // on the bot's own computer the page opens without a password; from anywhere else it is required
      const local = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
      if (!local && !authorized(req)) {
        if (req.headers.authorization) {
          const n = (f?.n ?? 0) + 1;
          fails.set(ip, { n, until: n >= 10 ? Date.now() + 15 * 60_000 : 0 });
        }
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="bot", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" });
        return res.end("צריך סיסמה. בשרת: bot password");
      }
      fails.delete(ip);

      const url = new URL(req.url ?? "/", "http://panel");
      if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE, "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, api.state());
      if (req.method === "GET" && url.pathname === "/api/pending") return send(res, 200, api.pending(url.searchParams.get("channel") ?? ""));
      if (req.method === "GET" && url.pathname === "/api/queue") return send(res, 200, api.queue(url.searchParams.get("channel") ?? ""));

      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        // a custom header cannot be added by another website, so this blocks cross-site requests
        if (req.headers["x-panel"] !== "1") return send(res, 403, { error: "forbidden" });
        let body: Record<string, unknown>;
        try {
          body = await readBody(req);
        } catch (err) {
          return send(res, 400, { error: (err as Error).message });
        }
        let error: string | null = null;
        switch (url.pathname) {
          case "/api/settings":
            error = await api.saveSettings(body);
            break;
          case "/api/channels":
            error = await api.saveChannels(body);
            break;
          case "/api/link":
            error = await api.startLink();
            break;
          case "/api/pause":
            api.setPaused(body.paused === true);
            break;
          case "/api/test": {
            const r = await api.test(String(body.id ?? ""));
            return send(res, r.error ? 400 : 200, r);
          }
          case "/api/send-now": {
            const r = await api.sendNow(String(body.id ?? ""), String(body.prompt ?? "").slice(0, 300));
            return send(res, "error" in r ? 400 : 200, r);
          }
          case "/api/flush":
            error = api.flush(String(body.id ?? ""));
            break;
          case "/api/approve-mode":
            error = api.setApprove(String(body.id ?? ""), body.on === true);
            break;
          case "/api/approve":
            error = api.approve(Number(body.id));
            break;
          case "/api/channel-pause":
            error = api.pauseChannel(String(body.id ?? ""), body.paused === true);
            break;
          case "/api/push":
            error = api.push(String(body.id ?? ""), String(body.message ?? "").slice(0, 600));
            break;
          case "/api/discard":
            error = api.discard(Number(body.id));
            break;
          case "/api/growth":
            api.setGrowth(body.on === true);
            break;
          default:
            return send(res, 404, { error: "not found" });
        }
        return send(res, error ? 400 : 200, error ? { error } : { ok: true });
      }
      send(res, 404, { error: "not found" });
    })().catch((err: Error) => {
      logger.error({ err: err.message }, "panel request failed");
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    });
  });
  server.on("error", (err: Error) => logger.error({ err: err.message, port }, "the settings website could not start"));
  // PANEL_HOST=127.0.0.1 keeps the page on this computer only (used on Windows, so no firewall prompt appears)
  const host = process.env.PANEL_HOST || undefined;
  server.listen(port, host, () => logger.info({ port, host: host ?? "all" }, "settings website is up"));
  return server;
}
