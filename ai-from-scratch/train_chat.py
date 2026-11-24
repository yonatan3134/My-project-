"""
אימון הבוט "ניצוץ" על השיחות שב-dialogues.txt.

כל דוגמה נראית כך (במספרים):
    <user> מה שלומך ? <bot> אני מצוין , תודה ! <end>
המודל לומד לנחש רק את החלק של הבוט: אחרי <bot>, מילה אחרי מילה, עד <end>.

    python3 train_chat.py                 # אימון רגיל (כמה דקות)
    python3 train_chat.py --steps 6000    # אימון ארוך = תשובות מדויקות יותר
    python3 train_chat.py --resume --steps 1500 --lr 0.005
                                          # ממשיך מהמודל הקיים (מהיר! טוב אחרי שהוספתם שיחות)
"""

import argparse
import math
import os
import random
import time

from engine import cross_entropy, vsum
from model import GPT
from tokenizer import BOT, END, UNK, USER, Tokenizer, split

HERE = os.path.dirname(os.path.abspath(__file__))


def load_dialogues(path):
    """מחזיר רשימת זוגות (שאלה, תשובה) מכל הבלוקים בקובץ."""
    pairs, qs, ans = [], [], []

    def flush():
        pairs.extend((q, a) for q in qs for a in ans)
        qs.clear()
        ans.clear()

    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("#"):
                continue
            if not line:
                flush()
            elif line.startswith("ש:"):
                qs.append(line[2:].strip())
            elif line.startswith("ת:"):
                ans.append(line[2:].strip())
    flush()
    return pairs


def resume_from(model, path, vocab):
    """
    ממשיך מאימון קודם. מילים שכבר הכיר שומרות את מה שלמד עליהן,
    ומילים חדשות (מבלוקים שהוספתם) מתחילות מאפס.
    """
    old, old_vocab = GPT.load(path)
    assert old.config | {"vocab_size": 0} == model.config | {"vocab_size": 0}, \
        "גודל המודל השתנה, אי אפשר להמשיך. אמנו מההתחלה"
    old_index = {w: i for i, w in enumerate(old_vocab)}
    for name, mat in model.weights.items():
        src = old.weights[name]
        for r, row in enumerate(mat):
            if name in ("wte", "head"):
                if vocab[r] not in old_index:
                    continue
                src_row = src[old_index[vocab[r]]]
            else:
                src_row = src[r]
            for v, s in zip(row, src_row):
                v.data = s.data
    new_words = sum(w not in old_index for w in vocab)
    print(f"ממשיך מ-{path} ({new_words} מילים חדשות)")


def make_example(tok, q, a, noisy, unk_noise=0.1):
    q_ids = tok.encode(q)
    if noisy:
        # קצת רעש כדי שיבין גם ניסוחים שלא ראה בדיוק:
        # לפעמים בלי סימני פיסוק, לפעמים מילה "לא מוכרת"
        if random.random() < 0.3:
            q_ids = [i for i in q_ids if tok.vocab[i] not in "?!.,"] or q_ids
        if len(q_ids) > 1:
            q_ids = [UNK if random.random() < unk_noise else i for i in q_ids]
    seq = [USER] + q_ids + [BOT] + tok.encode(a) + [END]
    answer_start = len(q_ids) + 1          # המיקום של <bot> ברשימת ה-inputs
    return seq, answer_start


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default=os.path.join(HERE, "dialogues.txt"))
    p.add_argument("--out", default=os.path.join(HERE, "chat_model.json"))
    p.add_argument("--steps", type=int, default=6000)
    p.add_argument("--lr", type=float, default=0.01)
    p.add_argument("--embd", type=int, default=32)
    p.add_argument("--heads", type=int, default=4)
    p.add_argument("--layers", type=int, default=2)
    p.add_argument("--block", type=int, default=48)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--unk-noise", type=float, default=0.1)
    p.add_argument("--resume", action="store_true", help="ממשיך מהמודל שב --out")
    p.add_argument("--resume-from", default=None)
    args = p.parse_args()
    random.seed(args.seed)

    # ---- 1. נתונים ----
    pairs = load_dialogues(args.data)
    tok = Tokenizer.build([t for pair in pairs for t in pair])
    longest = max(len(split(q)) + len(split(a)) + 3 for q, a in pairs)
    assert longest <= args.block, f"שיחה ארוכה מדי ({longest} טוקנים), הגדילו את --block"
    print(f"{len(pairs)} זוגות שאלה-תשובה, {len(tok.vocab)} מילים באוצר המילים")

    # ---- 2. מודל ----
    model = GPT(len(tok.vocab), args.embd, args.heads, args.layers, args.block)
    params = model.parameters()
    print(f"מספר פרמטרים: {len(params)}")
    if args.resume or args.resume_from:
        resume_from(model, args.resume_from or args.out, tok.vocab)

    # ---- 3. אימון עם Adam ----
    m = [0.0] * len(params)
    v = [0.0] * len(params)
    b1, b2, eps = 0.9, 0.99, 1e-8
    start, running = time.time(), None

    for step in range(1, args.steps + 1):
        q, a = random.choice(pairs)
        seq, ans_start = make_example(tok, q, a, noisy=True, unk_noise=args.unk_noise)
        inputs, targets = seq[:-1], seq[1:]

        # קדימה: קוראים את השאלה, ומנחשים כל מילה של התשובה
        cache = model.new_cache()
        losses = []
        for pos, t in enumerate(inputs):
            h = model.step(t, cache)
            if pos >= ans_start:
                losses.append(cross_entropy(model.logits(h), targets[pos]))
        loss = vsum(losses) / len(losses)

        # אחורה + עדכון
        for prm in params:
            prm.grad = 0.0
        loss.backward()
        lr = args.lr * 0.5 * (1 + math.cos(math.pi * (step - 1) / args.steps))
        for i, prm in enumerate(params):
            g = prm.grad
            m[i] = b1 * m[i] + (1 - b1) * g
            v[i] = b2 * v[i] + (1 - b2) * g * g
            prm.data -= lr * (m[i] / (1 - b1 ** step)) / (math.sqrt(v[i] / (1 - b2 ** step)) + eps)

        running = loss.data if running is None else 0.98 * running + 0.02 * loss.data
        if step % 100 == 0 or step == 1:
            print(f"צעד {step:5d}/{args.steps} | loss {running:.3f} | "
                  f"{time.time() - start:.0f} שניות", flush=True)

    model.save(args.out, tok.vocab)
    print(f"\nנשמר אל {args.out}. עכשיו אפשר לדבר איתו: python3 chat.py")


if __name__ == "__main__":
    main()
