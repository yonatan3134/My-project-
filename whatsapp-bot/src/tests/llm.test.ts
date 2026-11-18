import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { makeConfig } from "./helpers.js";
import { ClaudeLLM, LLMError } from "../content/llm.js";

/**
 * A local stand-in for the API endpoint. It checks nothing about the model's
 * writing; it checks that the request this bot sends is well formed and that
 * every kind of answer is handled.
 */
let server: http.Server;
let baseURL = "";
let lastRequest: Record<string, any> = {};
let reply: { status: number; body: unknown } = { status: 200, body: {} };

function message(text: string, over: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 250 },
    ...over,
  };
}

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastRequest = { path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : {} };
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const config = makeConfig([{ id: "riddles", mode: "creative", topic: "חידות קצרות", rules: "בלי אלימות" }]);
const channel = config.channels[0]!;
const usage: { inputTokens: number; outputTokens: number }[] = [];
const llm = () => new ClaudeLLM({ model: "claude-haiku-5-5", effort: "medium" }, (u) => usage.push(u), new Anthropic({ apiKey: "test-key", baseURL, maxRetries: 0 }));
const request = { channel, mode: "creative" as const, counts: { text: 2, poll: 1 }, usedKeys: ["חידת המדרגות"], samples: ["חידה לדוגמה 🤔"], sources: [] };

const DRAFT = { kind: "text", text: "חידה: מה תמיד מגיע אבל אף פעם לא כאן?", poll_question: "", poll_options: [], card_text: "", visual_query: "", image_prompt: "", followup: "התשובה: מחר!", topic_key: "חידת המחר", source_index: -1 };

test("the writing request is well formed and the answer is parsed", async () => {
  reply = { status: 200, body: message(JSON.stringify({ posts: [DRAFT] })) };
  const drafts = await llm().write(request);
  assert.deepEqual(drafts, [DRAFT]);

  const b = lastRequest.body;
  assert.equal(lastRequest.path, "/v1/messages");
  assert.equal(b.model, "claude-haiku-5-5");
  assert.equal(b.output_config.effort, "medium");
  assert.equal(b.output_config.format.type, "json_schema");
  assert.deepEqual(Object.keys(b.output_config.format.schema.properties), ["posts"]);
  assert.equal(b.system[0].cache_control.type, "ephemeral");
  assert.match(b.system[0].text, /Hard rules/);
  // sampling parameters and a thinking budget are rejected by this model, so they must not be sent
  for (const key of ["temperature", "top_p", "top_k", "thinking"]) assert.equal(key in b, false, `${key} must not be sent`);
  const user = b.messages[0].content as string;
  assert.match(user, /CHANNEL: ערוץ riddles/);
  assert.match(user, /EXTRA RULES FOR THIS CHANNEL: בלי אלימות/);
  assert.match(user, /ALREADY USED[\s\S]*חידת המדרגות/);
  assert.match(user, /Write 3 posts in exactly this mix: 2 text, 1 poll/);
  assert.deepEqual(usage.at(-1), { inputTokens: 900, outputTokens: 250 });
});

test("the review request carries the posts and returns one verdict each", async () => {
  reply = { status: 200, body: message(JSON.stringify({ verdicts: [{ index: 0, ok: false, reason: "invented fact" }] })) };
  const verdicts = await llm().review(channel, [{ index: 0, kind: "text", text: "עדכון חדש יצא היום", pollQuestion: "", pollOptions: [], cardText: "", followup: "", sourceIndex: -1 }], []);
  assert.deepEqual(verdicts, [{ index: 0, ok: false, reason: "invented fact" }]);
  assert.match(lastRequest.body.system[0].text, /last check before posts are published/);
  assert.match(lastRequest.body.messages[0].content, /עדכון חדש יצא היום/);
});

async function failure(): Promise<LLMError> {
  try {
    await llm().write(request);
  } catch (err) {
    assert.ok(err instanceof LLMError, `expected LLMError, got ${String(err)}`);
    return err;
  }
  throw new Error("the call should have failed");
}

test("a refusal, a cut-off answer and malformed JSON all produce no posts", async () => {
  reply = { status: 200, body: message("", { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null }, content: [] }) };
  assert.equal((await failure()).kind, "refusal");
  reply = { status: 200, body: message('{"posts": [{"kind": "text", "te', { stop_reason: "max_tokens" }) };
  assert.ok(["truncated", "invalid"].includes((await failure()).kind));
  reply = { status: 200, body: message("not json at all") };
  assert.equal((await failure()).kind, "invalid");
});

test("API errors are classified, with a longer wait for problems that will not fix themselves", async () => {
  const err = (type: string, msg: string) => ({ type: "error", error: { type, message: msg } });
  reply = { status: 401, body: err("authentication_error", "invalid x-api-key") };
  const auth = await failure();
  assert.equal(auth.kind, "auth");
  reply = { status: 429, body: err("rate_limit_error", "slow down") };
  const rate = await failure();
  assert.equal(rate.kind, "rate_limit");
  reply = { status: 529, body: err("overloaded_error", "overloaded") };
  const server = await failure();
  assert.equal(server.kind, "server");
  reply = { status: 400, body: err("invalid_request_error", "bad field") };
  assert.equal((await failure()).kind, "bad_request");
  assert.ok(auth.retryAfterMs > rate.retryAfterMs && rate.retryAfterMs > server.retryAfterMs);
});
