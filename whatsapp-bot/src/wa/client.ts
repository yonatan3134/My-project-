import { EventEmitter } from "node:events";
import makeWASocket, { Browsers, DisconnectReason, makeCacheableSignalKeyStore, useMultiFileAuthState, type WAMessage, type WASocket } from "baileys";
import { waLogger, logger } from "../logger.js";
import { AUTH_DIR, ensureDirs } from "../paths.js";

export type WaStatus = "idle" | "connecting" | "open" | "closed" | "logged_out";

export interface WaClientOptions {
  /** phone number of the bot account, digits only; enables linking with an 8-character code instead of a QR */
  pairingPhone?: string | null;
  /** the main bot never starts a new link by itself; only `npm run link` does */
  allowLinking: boolean;
}

/** Delays between reconnect attempts. The last value repeats for as long as the connection stays down. */
const BACKOFF_MS = [2_000, 5_000, 10_000, 30_000, 60_000];

function statusCode(err: unknown): number | undefined {
  return (err as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
}

/**
 * Keeps one WhatsApp connection alive: saves the session to disk, reconnects
 * with a growing delay, and reports when the account has been logged out and
 * a person has to link it again.
 *
 * Events: "socket" (WASocket), "open", "close" (reason), "logged_out" (reason),
 * "qr" (string), "pairing_code" (string), "message" (WAMessage).
 */
export class WaClient extends EventEmitter {
  sock: WASocket | null = null;
  status: WaStatus = "idle";
  lastOpenAt = 0;
  lastCloseAt = 0;
  private attempt = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: WaClientOptions) {
    super();
  }

  get isOpen(): boolean {
    return this.status === "open" && this.sock !== null;
  }

  async start(): Promise<void> {
    ensureDirs();
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const sock = this.sock;
    this.sock = null;
    if (sock) await sock.end(undefined).catch(() => {});
    this.status = "closed";
  }

  /** Resolves true once connected, false when the time runs out or the account is logged out. */
  waitOpen(timeoutMs: number): Promise<boolean> {
    if (this.isOpen) return Promise.resolve(true);
    if (this.status === "logged_out") return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (v: boolean) => {
        clearTimeout(t);
        this.off("open", onOpen);
        this.off("logged_out", onOut);
        resolve(v);
      };
      const onOpen = () => done(true);
      const onOut = () => done(false);
      const t = setTimeout(() => done(false), timeoutMs);
      this.once("open", onOpen);
      this.once("logged_out", onOut);
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.status = "connecting";
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, waLogger) },
      logger: waLogger,
      browser: Browsers.ubuntu("Chrome"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      shouldSyncHistoryMessage: () => false,
    });
    this.sock = sock;
    let pairingRequested = false;
    this.emit("socket", sock);

    sock.ev.on("creds.update", () => void saveCreds());

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) this.emit("message", m as WAMessage);
    });

    sock.ev.on("connection.update", (u) => {
      if (this.sock !== sock) return; // an older socket that is being torn down
      const { connection, lastDisconnect, qr } = u;

      if (qr) {
        if (!this.opts.allowLinking) {
          // The bot has no saved session. Do not sit in a QR loop; a person has to run the link step.
          this.loggedOut("the bot is not linked to a WhatsApp account");
          return;
        }
        if (this.opts.pairingPhone && !sock.authState.creds.registered) {
          if (!pairingRequested) {
            pairingRequested = true;
            sock
              .requestPairingCode(this.opts.pairingPhone)
              .then((code) => this.emit("pairing_code", code))
              .catch((err: Error) => logger.error({ err: err.message }, "could not get a pairing code"));
          }
        } else {
          this.emit("qr", qr);
        }
      }

      if (connection === "open") {
        this.status = "open";
        this.attempt = 0;
        this.lastOpenAt = Date.now();
        logger.info("WhatsApp connected");
        this.emit("open");
      }

      if (connection === "close") {
        const code = statusCode(lastDisconnect?.error);
        const reason = `${code ?? "?"} ${lastDisconnect?.error?.message ?? ""}`.trim();
        this.lastCloseAt = Date.now();
        this.sock = null;
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden) {
          this.loggedOut(reason);
          return;
        }
        this.status = "closed";
        this.emit("close", reason);
        if (this.stopped) return;
        // 515 is WhatsApp asking for an immediate reconnect (normal right after linking).
        // 440 means another device took over this session, so wait longer before taking it back.
        const delay =
          code === DisconnectReason.restartRequired
            ? 500
            : code === DisconnectReason.connectionReplaced
              ? 60_000
              : (BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 60_000);
        this.attempt++;
        logger.warn({ reason, retryInMs: delay }, "WhatsApp disconnected, reconnecting");
        this.timer = setTimeout(() => {
          this.connect().catch((err: Error) => {
            logger.error({ err: err.message }, "reconnect failed");
            this.status = "closed";
            this.timer = setTimeout(() => void this.connect().catch(() => {}), 60_000);
          });
        }, delay);
      }
    });
  }

  private loggedOut(reason: string): void {
    this.status = "logged_out";
    const sock = this.sock;
    this.sock = null;
    if (sock) void sock.end(undefined).catch(() => {});
    logger.error({ reason }, "WhatsApp session is gone; the bot must be linked again");
    this.emit("logged_out", reason);
  }
}
