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
