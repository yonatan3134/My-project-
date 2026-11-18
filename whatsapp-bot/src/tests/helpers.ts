import { parseConfig, type AppConfig } from "../config.js";
import type { CardImage } from "../media/cards.js";
import type { VideoClip } from "../media/video.js";
import type { SendResult, Sender } from "../wa/sender.js";

export const INVITE = (n: number) => `0029Vtest${String(n).padStart(12, "0")}`;

export function makeConfig(channels: Record<string, unknown>[], settings: Record<string, unknown> = {}): AppConfig {
  const withInvites = channels.map((c, i) => ({ invite: INVITE(i), name: `ערוץ ${c.id as string}`, ...c }));
  // by default every channel is on from the first minute and nothing is capped by warm-up
  const parsed = parseConfig({ rollout: [], warmup: [], ...settings }, withInvites);
  return {
    ...parsed,
    env: { botPhone: null, ownerPhone: "972500000000", ntfyTopic: null, pexelsKey: null, dryRun: true, fakeLlm: true, hasAnthropicKey: false, hasGeminiKey: false },
  };
}

export interface Sent {
  jid: string;
  kind: "text" | "poll" | "image" | "video";
  body: string;
  ok: boolean;
}

/** A sender whose failures can be scripted per kind. */
export class ScriptedSender implements Sender {
  log: Sent[] = [];
  fail: Partial<Record<Sent["kind"], SendResult>> = {};
  private n = 0;

  private go(jid: string, kind: Sent["kind"], body: string): SendResult {
    const forced = this.fail[kind];
    const res: SendResult = forced ?? { ok: true, id: `m${++this.n}` };
    this.log.push({ jid, kind, body, ok: res.ok });
    return res;
  }

  async text(jid: string, text: string): Promise<SendResult> {
    return this.go(jid, "text", text);
  }
  async poll(jid: string, question: string, options: string[]): Promise<SendResult> {
    return this.go(jid, "poll", `${question} :: ${options.join(" | ")}`);
  }
  async image(jid: string, _image: CardImage, caption: string): Promise<SendResult> {
    return this.go(jid, "image", caption);
  }
  async video(jid: string, _clip: VideoClip, caption: string): Promise<SendResult> {
    return this.go(jid, "video", caption);
  }

  delivered(kind?: Sent["kind"]): Sent[] {
    return this.log.filter((s) => s.ok && (!kind || s.kind === kind));
  }
}
