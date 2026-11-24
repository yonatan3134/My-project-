"""
אימון: מראים למודל מילים אמיתיות, הוא מנחש כל פעם את האות הבאה,
מודדים כמה הוא טעה (loss), ומזיזים קצת כל פרמטר בכיוון שמקטין את הטעות.

הרצה:
    python3 train.py                       # מאמן על שמות בעברית
    python3 train.py --data my_words.txt   # מאמן על קובץ משלך (מילה/משפט בכל שורה)
    python3 train.py --steps 2000          # אימון ארוך יותר = תוצאות טובות יותר
"""

import argparse
import math
import os
import random
import time

from engine import vsum
from model import GPT, sample, softmax

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default=os.path.join(HERE, "names.txt"))
    p.add_argument("--out", default=os.path.join(HERE, "model.json"))
    p.add_argument("--steps", type=int, default=2000)
    p.add_argument("--lr", type=float, default=0.01)
    p.add_argument("--embd", type=int, default=16)
    p.add_argument("--heads", type=int, default=4)
    p.add_argument("--layers", type=int, default=1)
    p.add_argument("--block", type=int, default=16)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    random.seed(args.seed)

    # ---- 1. נתונים ----
    with open(args.data, encoding="utf-8") as f:
        docs = [line.strip() for line in f if line.strip()]
    vocab = ["."] + sorted(set("".join(docs)))   # "." = סימן התחלה/סוף
    stoi = {ch: i for i, ch in enumerate(vocab)}
    print(f"{len(docs)} דוגמאות, {len(vocab) - 1} תווים שונים")

    # ---- 2. מודל ----
    model = GPT(len(vocab), args.embd, args.heads, args.layers, args.block)
    params = model.parameters()
    print(f"מספר פרמטרים: {len(params)}")

    # ---- 3. אופטימייזר Adam (מאפס) ----
    m = [0.0] * len(params)
    v = [0.0] * len(params)
    b1, b2, eps = 0.9, 0.99, 1e-8

    start = time.time()
    for step in range(1, args.steps + 1):
        doc = random.choice(docs)
        tokens = [0] + [stoi[c] for c in doc] + [0]
        tokens = tokens[: args.block + 1]
        inputs, targets = tokens[:-1], tokens[1:]

        # קדימה: מנחשים, ומודדים כמה ההסתברות לאות הנכונה נמוכה
        logits = model.forward(inputs)
        losses = [-softmax(lg)[t].log() for lg, t in zip(logits, targets)]
        loss = vsum(losses) / len(losses)

        # אחורה: מי אשם בטעות?
        for prm in params:
            prm.grad = 0.0
        loss.backward()

        # עדכון: צעד קטן נגד כיוון הטעות (קצב למידה יורד בהדרגה)
        lr = args.lr * (1 - (step - 1) / args.steps)
        for i, prm in enumerate(params):
            g = prm.grad
            m[i] = b1 * m[i] + (1 - b1) * g
            v[i] = b2 * v[i] + (1 - b2) * g * g
            m_hat = m[i] / (1 - b1 ** step)
            v_hat = v[i] / (1 - b2 ** step)
            prm.data -= lr * m_hat / (math.sqrt(v_hat) + eps)

        if step % 100 == 0 or step == 1:
            print(f"צעד {step:5d}/{args.steps} | loss {loss.data:.3f} | "
                  f"{time.time() - start:.0f} שניות")

    model.save(args.out, vocab)
    print(f"\nנשמר אל {args.out}\n\nמילים חדשות שהמודל המציא:")
    for _ in range(15):
        print("  ", sample(model, vocab))


if __name__ == "__main__":
    main()
