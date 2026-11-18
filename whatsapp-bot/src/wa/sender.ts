import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_ORIGIN,
  WAMessageStatus,
  encodeBase64EncodedStringForUpload,
  generateWAMessage,
  type AnyMessageContent,
  type WAMediaUploadFunction,
  type WAMessage,
  type WASocket,
} from "baileys";
import type { Store } from "../db.js";
import { logger, waLogger } from "../logger.js";
import type { CardImage } from "../media/cards.js";
import type { VideoClip } from "../media/video.js";
import { DRY_RUN_DIR } from "../paths.js";
import { sleep } from "../time.js";
import type { WaClient } from "./client.js";

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  /**
   * true when the message may or may not have reached WhatsApp (the
   * connection broke mid-send). Such a post is never retried.
   */
  uncertain?: boolean;
}

export interface Sender {
  text(jid: string, text: string): Promise<SendResult>;
  poll(jid: string, question: string, options: string[]): Promise<SendResult>;
  image(jid: string, image: CardImage, caption: string): Promise<SendResult>;
  video(jid: string, clip: VideoClip, caption: string): Promise<SendResult>;
}

/**
 * Channel media is uploaded without encryption to its own set of paths.
 * The stock library uploads it to the regular chat paths, which community
 * forks report as the reason channel media fails, so this path is tried first.
 */
const CHANNEL_MEDIA_PATH: Record<string, string> = {
  image: "/newsletter/newsletter-image",
  video: "/newsletter/newsletter-video",
};

type UploadStrategy = "channel" | "default";

interface ServerThumb {
  directPath?: string;
  sha256?: string;
}

function channelUpload(sock: WASocket, onThumb: (t: ServerThumb) => void): WAMediaUploadFunction {
  return async (filePath, { mediaType, fileEncSha256B64, timeoutMs }) => {
    const segment = CHANNEL_MEDIA_PATH[mediaType];
    if (!segment) throw new Error(`no channel upload path for ${mediaType}`);
    const body = await fs.readFile(filePath);
    const token = encodeBase64EncodedStringForUpload(fileEncSha256B64);
    let info = await sock.refreshMediaConn(false);
    let lastError = "no upload hosts";
    for (const { hostname } of info.hosts) {
      let url = `https://${hostname}${segment}/${token}?auth=${encodeURIComponent(info.auth)}&token=${token}&server_thumb_gen=1`;
      if (mediaType === "video") url += "&server_transcode=1";
      try {
        const res = await fetch(url, {
          method: "POST",
          body,
          headers: { "Content-Type": "application/octet-stream", Origin: DEFAULT_ORIGIN },
          signal: AbortSignal.timeout(timeoutMs ?? 120_000),
        });
        const json = (await res.json().catch(() => undefined)) as
          | { url?: string; direct_path?: string; thumbnail_info?: { thumbnail_direct_path?: string; thumbnail_sha256?: string } }
          | undefined;
        if (json?.url || json?.direct_path) {
          onThumb({ directPath: json.thumbnail_info?.thumbnail_direct_path, sha256: json.thumbnail_info?.thumbnail_sha256 });
          return { mediaUrl: (json.url ?? json.direct_path) as string, directPath: json.direct_path as string };
        }
        lastError = `HTTP ${res.status} ${JSON.stringify(json ?? {}).slice(0, 200)}`;
        info = await sock.refreshMediaConn(true);
      } catch (err) {
        lastError = (err as Error).message;
      }
    }
    throw new Error(`channel media upload failed: ${lastError}`);
  };
}

export class WaSender implements Sender {
  /** message id -> error code, for sends WhatsApp answered with a rejection */
  private rejected = new Map<string, string>();

  constructor(
    private client: WaClient,
    private store: Store,
  ) {
    const attach = (sock: WASocket) => {
      sock.ev.on("messages.update", (updates) => {
        for (const u of updates) {
          if (u.update.status === WAMessageStatus.ERROR && u.key.id) {
            this.rejected.set(u.key.id, String(u.update.messageStubParameters?.[0] ?? "error"));
            if (this.rejected.size > 500) this.rejected.delete(this.rejected.keys().next().value as string);
          }
        }
      });
    };
    client.on("socket", attach);
    if (client.sock) attach(client.sock);
  }

  /** WhatsApp reports a rejected message within a moment; no report means it was accepted. */
  private async rejection(id: string, waitMs = 6_000): Promise<string | null> {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      const err = this.rejected.get(id);
      if (err) return err;
      await sleep(400);
    }
    return this.rejected.get(id) ?? null;
  }

  private async relay(sock: WASocket, jid: string, full: WAMessage): Promise<SendResult> {
    const id = full.key.id as string;
    if (!full.message) return { ok: false, error: "empty message" };
    try {
      await sock.relayMessage(jid, full.message, { messageId: id });
    } catch (err) {
      return { ok: false, uncertain: true, error: `connection broke while sending: ${(err as Error).message}` };
    }
    const rejected = await this.rejection(id);
    return rejected ? { ok: false, error: `WhatsApp rejected the message (code ${rejected})` } : { ok: true, id };
  }

  private async simple(jid: string, content: AnyMessageContent): Promise<SendResult> {
    const sock = this.client.sock;
    if (!this.client.isOpen || !sock?.user) return { ok: false, error: "not connected" };
    let full: WAMessage;
    try {
      full = await generateWAMessage(jid, content, { userJid: sock.user.id, upload: sock.waUploadToServer, logger: waLogger });
    } catch (err) {
      return { ok: false, error: `could not build the message: ${(err as Error).message}` };
    }
    return this.relay(sock, jid, full);
  }

  text(jid: string, text: string): Promise<SendResult> {
    return this.simple(jid, { text });
  }

  poll(jid: string, question: string, options: string[]): Promise<SendResult> {
    return this.simple(jid, { poll: { name: question, values: options, selectableCount: 1 } });
  }

  private strategies(): UploadStrategy[] {
    return this.store.get("media_upload_strategy") === "default" ? ["default", "channel"] : ["channel", "default"];
  }

  private async media(jid: string, kind: "image" | "video", content: AnyMessageContent): Promise<SendResult> {
    const sock = this.client.sock;
    if (!this.client.isOpen || !sock?.user) return { ok: false, error: "not connected" };
    const errors: string[] = [];
    for (const strategy of this.strategies()) {
      let thumb: ServerThumb = {};
      let full: WAMessage;
      try {
        const upload = strategy === "channel" ? channelUpload(sock, (t) => (thumb = t)) : sock.waUploadToServer;
        full = await generateWAMessage(jid, content, { userJid: sock.user.id, upload, logger: waLogger, mediaUploadTimeoutMs: 120_000 });
      } catch (err) {
        // nothing was sent yet, so trying the other upload path cannot duplicate the post
        errors.push(`${strategy}: ${(err as Error).message}`);
        continue;
      }
      const media = kind === "image" ? full.message?.imageMessage : full.message?.videoMessage;
      if (media && thumb.directPath) {
        media.thumbnailDirectPath = thumb.directPath;
        if (thumb.sha256) media.thumbnailSha256 = Buffer.from(thumb.sha256, "base64");
      }
      const res = await this.relay(sock, jid, full);
      if (res.ok) {
        this.store.set("media_upload_strategy", strategy);
        return res;
      }
      if (res.uncertain) return res;
      errors.push(`${strategy}: ${res.error}`);
    }
    return { ok: false, error: errors.join(" | ") };
  }

  image(jid: string, image: CardImage, caption: string): Promise<SendResult> {
    return this.media(jid, "image", {
      image: image.jpeg,
      caption: caption || undefined,
      jpegThumbnail: image.thumbnail,
      width: image.width,
      height: image.height,
      mimetype: "image/jpeg",
    });
  }

  video(jid: string, clip: VideoClip, caption: string): Promise<SendResult> {
    return this.media(jid, "video", {
      video: clip.mp4,
      caption: caption || undefined,
      jpegThumbnail: clip.thumbnail || undefined,
      width: clip.width,
      height: clip.height,
      seconds: clip.seconds,
      mimetype: "video/mp4",
    } as AnyMessageContent);
  }

  /** Private message to the owner (reports, alerts, command replies). Uses the library's normal chat path. */
  async direct(jid: string, text: string): Promise<boolean> {
    const sock = this.client.sock;
    if (!this.client.isOpen || !sock) return false;
    try {
      await sock.sendMessage(jid, { text });
      return true;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "could not send a private message");
      return false;
    }
  }
}

/** Sends nothing. Prints what would have been posted and keeps the media files for inspection. */
export class DryRunSender implements Sender {
  private n = 0;
  sent: { jid: string; kind: string; body: string }[] = [];

  constructor(private opts: { saveMedia: boolean; quiet?: boolean } = { saveMedia: true }) {}

  private record(jid: string, kind: string, body: string): SendResult {
    this.n++;
    this.sent.push({ jid, kind, body });
    if (!this.opts.quiet) logger.info({ jid, kind, body: body.slice(0, 300) }, "DRY RUN: would post");
    return { ok: true, id: `dry-${this.n}` };
  }

  async text(jid: string, text: string): Promise<SendResult> {
    return this.record(jid, "text", text);
  }

  async poll(jid: string, question: string, options: string[]): Promise<SendResult> {
    return this.record(jid, "poll", `${question} :: ${options.join(" | ")}`);
  }

  async image(jid: string, image: CardImage, caption: string): Promise<SendResult> {
    if (this.opts.saveMedia) {
      await fs.mkdir(DRY_RUN_DIR, { recursive: true });
      await fs.writeFile(path.join(DRY_RUN_DIR, `${Date.now()}-${this.n}.jpg`), image.jpeg);
    }
    return this.record(jid, "image", caption);
  }

  async video(jid: string, clip: VideoClip, caption: string): Promise<SendResult> {
    if (this.opts.saveMedia) {
      await fs.mkdir(DRY_RUN_DIR, { recursive: true });
      await fs.writeFile(path.join(DRY_RUN_DIR, `${Date.now()}-${this.n}.mp4`), clip.mp4);
    }
    return this.record(jid, "video", caption);
  }
}
