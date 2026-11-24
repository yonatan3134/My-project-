"""
בדיקה: משווים את הנגזרות שהמנוע מחשב לנגזרות "בכוח"
(משנים כל מספר טיפה ורואים כמה התוצאה זזה). אם הן שוות, המנוע עובד.

    python3 test_engine.py
"""

import random

from engine import Value, cross_entropy, dot, matvec, vsum
from model import GPT, softmax


def numeric_check(f, xs, eps=1e-6, tol=1e-4):
    out = f(xs)
    for x in xs:
        x.grad = 0.0
    out.backward()
    for x in xs:
        orig = x.data
        x.data = orig + eps
        up = f(xs).data
        x.data = orig - eps
        down = f(xs).data
        x.data = orig
        num = (up - down) / (2 * eps)
        assert abs(num - x.grad) < tol * max(1.0, abs(num)), (num, x.grad)


def test_basic_ops():
    xs = [Value(random.uniform(0.5, 2)) for _ in range(3)]
    numeric_check(lambda v: (v[0] * v[1] + v[2] ** 3 - v[0] / v[2]).exp().log()
                  + (v[1] - 1.5).relu() + 2 / v[0], xs)


def test_fused_ops():
    xs = [Value(random.uniform(-1, 1)) for _ in range(6)]
    numeric_check(lambda v: dot(v[:3], v[3:]) * vsum(v) + dot(v, v)
                  + vsum(matvec([v[:3], v[3:]], v[1:4])), xs)


def test_cross_entropy():
    xs = [Value(random.uniform(-2, 2)) for _ in range(5)]
    numeric_check(lambda v: cross_entropy(v, 2) * 3, xs)
    # שווה לגרסה ה"ארוכה"
    assert abs(cross_entropy(xs, 1).data - (-softmax(xs)[1].log()).data) < 1e-9


def test_whole_model():
    random.seed(0)
    model = GPT(vocab_size=5, n_embd=8, n_head=2, n_layer=2, block_size=6)
    # אתחול לא-אפס לכל השכבות כדי שכל נתיב ייבדק
    for p in model.parameters():
        p.data = random.gauss(0, 0.3)
    tokens, targets = [0, 3, 1, 4], [3, 1, 4, 0]

    def loss_fn(_):
        logits = model.forward(tokens)
        return vsum(-softmax(lg)[t].log() for lg, t in zip(logits, targets))

    params = model.parameters()
    numeric_check(loss_fn, random.sample(params, 40))


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("עבר:", name)
    print("כל הבדיקות עברו ✓")
