"""
המודל: GPT קטנטן, כתוב מאפס על גבי המנוע שלנו.

המבנה זהה ברעיון למודלי שפה גדולים:
  1. כל אות הופכת לווקטור (embedding) + וקטור שמסמן את המיקום שלה.
  2. שכבת Attention: כל אות "מסתכלת" על האותיות שלפניה ומחליטה למה לשים לב.
  3. שכבת MLP: רשת קטנה שמעבדת את מה שנאסף.
  4. בסוף: ניחוש של האות הבאה (התפלגות הסתברות על כל האותיות).
"""

import json
import math
import random

from engine import Value, dot, matvec, no_grad, vsum


# ---------- אבני בניין ----------

def matrix(rows, cols, std=0.08):
    return [[Value(random.gauss(0, std)) for _ in range(cols)] for _ in range(rows)]


def linear(x, w):
    """x: וקטור, w: מטריצה (שורה לכל פלט)."""
    return matvec(w, x)


def softmax(logits):
    m = max(v.data for v in logits)          # ליציבות מספרית
    exps = [(v - m).exp() for v in logits]
    total = vsum(exps)
    return [e / total for e in exps]


def rmsnorm(x):
    ms = dot(x, x) / len(x)
    scale = (ms + 1e-5) ** -0.5
    return [xi * scale for xi in x]


# ---------- המודל ----------

class GPT:
    def __init__(self, vocab_size, n_embd=16, n_head=4, n_layer=1, block_size=16):
        assert n_embd % n_head == 0
        self.config = dict(vocab_size=vocab_size, n_embd=n_embd, n_head=n_head,
                           n_layer=n_layer, block_size=block_size)
        self.vocab_size, self.n_embd = vocab_size, n_embd
        self.n_head, self.n_layer, self.block_size = n_head, n_layer, block_size
        self.head_dim = n_embd // n_head

        C = n_embd
        self.weights = {"wte": matrix(vocab_size, C), "wpe": matrix(block_size, C)}
        for i in range(n_layer):
            self.weights[f"l{i}.wq"] = matrix(C, C)
            self.weights[f"l{i}.wk"] = matrix(C, C)
            self.weights[f"l{i}.wv"] = matrix(C, C)
            self.weights[f"l{i}.wo"] = matrix(C, C, std=0.0)
            self.weights[f"l{i}.fc1"] = matrix(4 * C, C)
            self.weights[f"l{i}.fc2"] = matrix(C, 4 * C, std=0.0)
        self.weights["head"] = matrix(vocab_size, C)

    def parameters(self):
        return [v for mat in self.weights.values() for row in mat for v in row]

    def new_cache(self):
        """זיכרון של מה שכבר נקרא (keys/values לכל שכבה)."""
        return {"keys": [[] for _ in range(self.n_layer)],
                "vals": [[] for _ in range(self.n_layer)]}

    def step(self, tok, cache):
        """קורא טוקן אחד (אות או מילה), זוכר אותו, ומחזיר ציון לכל טוקן אפשרי הבא."""
        W, D = self.weights, self.head_dim
        keys, vals = cache["keys"], cache["vals"]
        pos = len(keys[0])

        x = [t + p for t, p in zip(W["wte"][tok], W["wpe"][pos])]
        x = rmsnorm(x)

        for i in range(self.n_layer):
            # --- Attention: על מה ממה שקראתי עד עכשיו לשים לב? ---
            h = rmsnorm(x)
            q = linear(h, W[f"l{i}.wq"])
            keys[i].append(linear(h, W[f"l{i}.wk"]))
            vals[i].append(linear(h, W[f"l{i}.wv"]))

            attn_out = []
            for hd in range(self.n_head):
                s = slice(hd * D, (hd + 1) * D)
                qh = q[s]
                scores = [dot(qh, k[s]) / math.sqrt(D) for k in keys[i]]
                weights = softmax(scores)
                for j in range(hd * D, (hd + 1) * D):
                    attn_out.append(dot(weights, [v[j] for v in vals[i]]))
            x = [a + b for a, b in zip(x, linear(attn_out, W[f"l{i}.wo"]))]

            # --- MLP: לחשוב על מה שנאסף ---
            h = rmsnorm(x)
            h = [v.relu() for v in linear(h, W[f"l{i}.fc1"])]
            x = [a + b for a, b in zip(x, linear(h, W[f"l{i}.fc2"]))]

        return rmsnorm(x)

    def logits(self, hidden):
        return linear(hidden, self.weights["head"])

    def forward(self, tokens):
        """מחזיר logits (ציון לכל טוקן אפשרי) לכל מיקום ברצף."""
        cache = self.new_cache()
        return [self.logits(self.step(t, cache)) for t in tokens]

    # ---------- שמירה וטעינה ----------

    def save(self, path, vocab):
        data = {"config": self.config, "vocab": vocab,
                "weights": {k: [[round(v.data, 5) for v in row] for row in m]
                            for k, m in self.weights.items()}}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        model = cls(**data["config"])
        for k, m in data["weights"].items():
            for row, saved_row in zip(model.weights[k], m):
                for v, d in zip(row, saved_row):
                    v.data = d
        return model, data["vocab"]


# ---------- יצירת טקסט ----------

def sample(model, vocab, temperature=0.8, prefix=""):
    """vocab[0] הוא סימן "התחלה/סוף". מייצר מילה אחת חדשה."""
    with no_grad():
        return _sample(model, vocab, temperature, prefix)


def _sample(model, vocab, temperature, prefix):
    stoi = {ch: i for i, ch in enumerate(vocab)}
    tokens = [0] + [stoi[c] for c in prefix if c in stoi]
    cache = model.new_cache()
    for t in tokens[:-1]:
        model.step(t, cache)
    out, tok = prefix, tokens[-1]
    for _ in range(model.block_size - len(tokens)):
        nxt = pick(model.logits(model.step(tok, cache)), temperature)
        if nxt == 0:
            break
        out += vocab[nxt]
        tok = nxt
    return out


def pick(logits, temperature=0.8, top_k=None):
    """בוחר את הטוקן הבא לפי ההסתברויות (עם טמפרטורה: נמוכה = בטוח, גבוהה = יצירתי)."""
    scores = [v.data / temperature for v in logits]
    idx = range(len(scores))
    if top_k:
        idx = sorted(idx, key=lambda i: -scores[i])[:top_k]
    m = max(scores[i] for i in idx)
    weights = [math.exp(scores[i] - m) for i in idx]
    return random.choices(list(idx), weights=weights)[0]
