import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { GoogleGenAI } from "@google/genai";
import { GeminiLLM, LLMError } from "../content/llm.js";
import { makeConfig } from "./helpers.js";

/** Local stand-in for the Gemini endpoint: checks the request shape and the handling of each kind of answer. */
let server: http.Server;
let baseUrl = "";
let last: { path?: string; body?: any } = {};
let reply: { status: number; body: unknown } = { status: 200, body: {} };

const answer = (text: string, finishReason = "STOP") => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason }],
  usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 200, thoughtsTokenCount: 50 },
});

before(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      last = { path: req.url, body: raw ? JSON.parse(raw) : {} };
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const config = makeConfig([{ id: "riddles", mode: "creative", topic: "חידות קצרות" }]);
const channel = config.channels[0]!;
const usage: { inputTokens: number; outputTokens: number }[] = [];
const llm = () => new GeminiLLM(config.settings, (u) => usage.push(u), new GoogleGenAI({ apiKey: "test-key", httpOptions: { baseUrl, retryOptions: { attempts: 1 } } }));
const request = { channel, mode: "creative" as const, counts: { text: 2, poll: 1 }, usedKeys: ["חידת המדרגות"], samples: [], sources: [] };
const DRAFT = { kind: "poll", text: "", poll_question: "מה עדיף?", poll_options: ["ים", "הרים"], card_text: "", visual_query: "", image_prompt: "", followup: "", topic_key: "ים או הרים", source_index: -1 };

async function failure(): Promise<LLMError> {
  try {
    await llm().write(request);
  } catch (err) {
    assert.ok(err instanceof LLMError, `expected LLMError, got ${String(err)}`);
    return err;
  }
  throw new Error("the call should have failed");
}

test("the request asks for JSON in the posts schema and the answer is parsed", async () => {
  reply = { status: 200, body: answer(JSON.stringify({ posts: [DRAFT] })) };
  assert.deepEqual(await llm().write(request), [DRAFT]);
  assert.match(last.path ?? "", /models\/gemini-flash-lite-latest:generateContent/);
  const b = last.body;
  assert.equal(b.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(Object.keys(b.generationConfig.responseJsonSchema.properties), ["posts"]);
  assert.match(JSON.stringify(b.systemInstruction), /Hard rules/);
  assert.match(JSON.stringify(b.contents), /Write 3 posts in exactly this mix: 2 text, 1 poll/);
  assert.deepEqual(usage.at(-1), { inputTokens: 800, outputTokens: 250 });
});

test("review verdicts are parsed", async () => {
  reply = { status: 200, body: answer(JSON.stringify({ verdicts: [{ index: 0, ok: true, reason: "" }] })) };
  const v = await llm().review(channel, [{ index: 0, kind: "text", text: "בדיחה", pollQuestion: "", pollOptions: [], cardText: "", followup: "", sourceIndex: -1 }], []);
  assert.deepEqual(v, [{ index: 0, ok: true, reason: "" }]);
});

test("blocked, cut-off, malformed and wrongly shaped answers produce no posts", async () => {
  reply = { status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } };
  assert.equal((await failure()).kind, "refusal");
  reply = { status: 200, body: answer("", "SAFETY") };
  assert.equal((await failure()).kind, "refusal");
  reply = { status: 200, body: answer('{"posts": [{"kind": "te', "MAX_TOKENS") };
  assert.equal((await failure()).kind, "truncated");
  reply = { status: 200, body: answer("not json") };
  assert.equal((await failure()).kind, "invalid");
  reply = { status: 200, body: answer(JSON.stringify({ posts: [{ kind: "song" }] })) };
  assert.equal((await failure()).kind, "invalid");
});

test("API errors are classified", async () => {
  const err = (code: number, status: string) => ({ error: { code, message: `test ${status}`, status } });
  reply = { status: 403, body: err(403, "PERMISSION_DENIED") };
  assert.equal((await failure()).kind, "auth");
  reply = { status: 429, body: err(429, "RESOURCE_EXHAUSTED") };
  assert.equal((await failure()).kind, "rate_limit");
  reply = { status: 404, body: err(404, "NOT_FOUND") };
  assert.equal((await failure()).kind, "bad_request");
  reply = { status: 503, body: err(503, "UNAVAILABLE") };
  assert.equal((await failure()).kind, "server");
});

import { AutoGeminiLLM, discoverGeminiModels } from "../content/llm.js";

test("auto: asks Google which models the key can use, picks cheap text models first, skips retired ones", async () => {
  const models = [
    { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent", "countTokens"] },
    { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.5-pro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.5-flash-image", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-embedding-2", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-3.5-flash-tts", supportedGenerationMethods: ["generateContent"] },
  ];
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push(`${req.method} ${req.url}`);
      const retired = (req.url ?? "").includes("gemini-3.5-flash-lite:");
      res.writeHead(retired ? 404 : 200, { "content-type": "application/json" });
      if (req.method === "GET") return res.end(JSON.stringify({ models }));
      if (retired) return res.end(JSON.stringify({ error: { code: 404, message: "This model is no longer available to new users", status: "NOT_FOUND" } }));
      res.end(JSON.stringify(answer(JSON.stringify({ posts: [DRAFT] }))));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const client = new GoogleGenAI({ apiKey: "k", apiVersion: "v1beta", httpOptions: { baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, retryOptions: { attempts: 1 } } });
  try {
    assert.deepEqual(await discoverGeminiModels(client), ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-pro"]);
    assert.deepEqual(await discoverGeminiModels(client, "image"), ["gemini-3.5-flash-image"]);
    const auto = new AutoGeminiLLM(client);
    assert.deepEqual(await auto.write(request), [DRAFT]);
    assert.ok(calls.some((c) => c.includes("/v1beta/models/gemini-3.5-flash:generateContent")), "fell through to the next model");
    const st = auto.status();
    assert.match(st[0]!.problem ?? "", /bad_request/);
    assert.equal(st[1]!.problem, null);
  } finally {
    srv.close();
  }
});
