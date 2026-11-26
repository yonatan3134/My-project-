import assert from "node:assert/strict";
import { test } from "node:test";
import { getBinaryNodeChild, proto } from "baileys";
import { fromTemplate, parseCaptured } from "../wa/capture.js";
import { Store } from "../db.js";

const JID = "120363000000000000@newsletter";

/** What WhatsApp returns for a channel's latest posts: a question posted from the app, and a plain text post. */
function fetched() {
  const question = proto.Message.encode({
    questionMessage: { message: { extendedTextMessage: { text: "מה הבראולר הכי אהוב עליכם?", contextInfo: { isQuestion: true } } } },
  }).finish();
  const text = proto.Message.encode({ conversation: "סתם פוסט" }).finish();
  return {
    tag: "iq",
    attrs: {},
    content: [
      {
        tag: "message_updates",
        attrs: {},
        content: [
          {
            tag: "messages",
            attrs: {},
            content: [
              { tag: "message", attrs: { server_id: "100", t: "1", type: "text", id: "A1" }, content: [{ tag: "meta", attrs: { content_type: "question" } }, { tag: "plaintext", attrs: {}, content: question }, { tag: "views_count", attrs: { count: "9" } }] },
              { tag: "message", attrs: { server_id: "101", t: "2", type: "text", id: "A2" }, content: [{ tag: "plaintext", attrs: {}, content: text }] },
            ],
          },
        ],
      },
    ],
  };
}

test("a question posted from the app is recognised and kept with its exact shape", () => {
  const posts = parseCaptured(fetched() as never);
  assert.equal(posts.length, 2);
  const q = posts[0]!;
  assert.equal(q.kind, "questionMessage");
  assert.equal(q.text, "מה הבראולר הכי אהוב עליכם?");
  assert.deepEqual(q.attrs, { type: "text" }, "ids and times are not part of the template");
  assert.deepEqual(q.extra, [{ tag: "meta", attrs: { content_type: "question" } }]);
  assert.equal(posts[1]!.kind, "conversation");
});

test("the bot sends its own question in the learned shape", () => {
  const store = new Store(":memory:");
  assert.equal(fromTemplate(store, "question", JID, "X1", "שאלה חדשה"), null, "nothing learned yet");
  store.set("template:question", JSON.stringify(parseCaptured(fetched() as never)[0]));
  const node = fromTemplate(store, "question", JID, "X1", "מה עשיתם היום? 🤔")!;
  assert.deepEqual(node.attrs, { type: "text", to: JID, id: "X1" });
  assert.deepEqual(getBinaryNodeChild(node, "meta")?.attrs, { content_type: "question" });
  const msg = proto.Message.decode(getBinaryNodeChild(node, "plaintext")!.content as Uint8Array);
  assert.equal(msg.questionMessage?.message?.extendedTextMessage?.text, "מה עשיתם היום? 🤔");
  assert.equal(msg.questionMessage?.message?.extendedTextMessage?.contextInfo?.isQuestion, true, "everything else is copied as it was");
});

import { fetchChannelPosts } from "../wa/channels.js";
import { learnFromChannel } from "../wa/capture.js";

/** A stand-in for the WhatsApp connection that answers only the request official clients use. */
function fakeSock(answer: unknown) {
  const sent: { attrs: Record<string, string>; content: { tag: string; attrs: Record<string, string> }[] }[] = [];
  return {
    sent,
    sock: {
      generateMessageTag: () => "tag1",
      query: async (node: never) => {
        sent.push(node);
        return answer;
      },
      newsletterFetchMessages: async () => undefined, // the library's own request times out in real use
    } as never,
  };
}

test("channel posts are read with the request WhatsApp answers", async () => {
  const f = fakeSock({ tag: "iq", attrs: {}, content: [{ tag: "messages", attrs: {}, content: fetched().content[0]!.content[0]!.content }] });
  const posts = await fetchChannelPosts(f.sock, JID, 20);
  assert.equal(posts.length, 2);
  assert.equal(posts[0]!.views, 9);
  assert.deepEqual(f.sent[0]!.attrs, { id: "tag1", type: "get", xmlns: "newsletter", to: "s.whatsapp.net" });
  assert.deepEqual(f.sent[0]!.content[0], { tag: "messages", attrs: { type: "jid", jid: JID, count: "20" } });
});

test("when WhatsApp does not answer, the website gets a clear error instead of a crash", async () => {
  const f = fakeSock(undefined);
  await assert.rejects(learnFromChannel(f.sock, new Store(":memory:"), JID), /did not answer/);
});
