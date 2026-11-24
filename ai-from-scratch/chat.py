"""
מדברים עם ניצוץ.

    python3 chat.py
    python3 chat.py -t 1.0     # תשובות יותר יצירתיות (ויותר מבולגנות)
"""

import argparse
import os

from engine import no_grad
from model import GPT, pick
from tokenizer import BOT, END, USER, Tokenizer

HERE = os.path.dirname(os.path.abspath(__file__))


def reply(model, tok, text, temperature=0.4, top_k=5):
    with no_grad():
        return _reply(model, tok, text, temperature, top_k)


def _reply(model, tok, text, temperature, top_k):
    q_ids = tok.encode(text)
    prompt = ([USER] + q_ids)[: model.block_size - 8] + [BOT]
    cache = model.new_cache()
    for t in prompt[:-1]:
        model.step(t, cache)

    out, t = [], prompt[-1]
    while len(prompt) + len(out) < model.block_size:
        t = pick(model.logits(model.step(t, cache)), temperature, top_k)
        if t == END:
            break
        out.append(t)
    return tok.decode(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default=os.path.join(HERE, "chat_model.json"))
    p.add_argument("-t", "--temperature", type=float, default=0.4)
    args = p.parse_args()

    model, vocab = GPT.load(args.model)
    tok = Tokenizer(vocab)
    print("ניצוץ מוכן! כתבו משהו (או 'יציאה' כדי לצאת)\n")
    while True:
        try:
            text = input("אתה: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if text in ("יציאה", "exit", "quit"):
            break
        if text:
            print("ניצוץ:", reply(model, tok, text, args.temperature), "\n")


if __name__ == "__main__":
    main()
