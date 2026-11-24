"""
מפרק טקסט לטוקנים (מילים וסימני פיסוק) ומחזיר אותם למספרים, ולהפך.

מילה שהמודל לא מכיר: מנסים להוריד ממנה אותיות שימוש (ו, ה, ב, ל, מ, ש, כ),
כך ש"והחתול" יובן כ"חתול" אם המודל מכיר רק את "חתול".
"""

import re

SPECIAL = ["<end>", "<unk>", "<user>", "<bot>"]
END, UNK, USER, BOT = range(4)

_NIQQUD = re.compile("[֑-ׇ]")
_TOKEN = re.compile(r"\w+|[^\w\s]")
_PREFIXES = "והבלמשכ"
_NO_SPACE_BEFORE = set(".,!?:;)")


def split(text):
    text = _NIQQUD.sub("", text).lower()
    return _TOKEN.findall(text)


class Tokenizer:
    def __init__(self, vocab):
        self.vocab = vocab
        self.stoi = {w: i for i, w in enumerate(vocab)}

    @classmethod
    def build(cls, texts):
        words = sorted({w for t in texts for w in split(t)})
        return cls(SPECIAL + words)

    def _lookup(self, word):
        if word in self.stoi:
            return self.stoi[word]
        # הסרת עד שתי אותיות שימוש: "וכשהלכתי" -> "כשהלכתי" -> "שהלכתי"
        w = word
        for _ in range(2):
            if len(w) > 2 and w[0] in _PREFIXES:
                w = w[1:]
                if w in self.stoi:
                    return self.stoi[w]
        return UNK

    def encode(self, text):
        return [self._lookup(w) for w in split(text)]

    def decode(self, ids):
        out = ""
        for i in ids:
            w = self.vocab[i]
            if w in SPECIAL:
                continue
            out += w if (not out or w in _NO_SPACE_BEFORE) else " " + w
        return out
