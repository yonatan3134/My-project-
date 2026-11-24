"""
המנוע: גזירה אוטומטית (autograd) מאפס.

כל מספר במודל הוא Value. כל Value זוכר מאילו מספרים הוא נוצר,
ומה הנגזרת "המקומית" שלו ביחס לכל אחד מהם. כך אפשר ללכת אחורה
(backward) ולחשב, לפי כלל השרשרת, כמה כל פרמטר השפיע על השגיאה.

כל חישוב נרשם על "סרט" (tape) לפי הסדר שבו קרה. בשלב הלמידה
פשוט מריצים את הסרט אחורה, וכל צומת מעביר את הנגזרת שלו לילדים שלו.

אין כאן שום ספרייה חיצונית: רק math מהספרייה הסטנדרטית של פייתון.
"""

import math

_tape = []          # כל החישובים מאז ה-backward האחרון, לפי הסדר
_recording = True   # כבוי בזמן שיחה, כשלא צריך ללמוד


class no_grad:
    """with no_grad(): ... מריץ את המודל בלי לרשום כלום (חוסך זיכרון)."""

    def __enter__(self):
        global _recording
        self._prev, _recording = _recording, False

    def __exit__(self, *exc):
        global _recording
        _recording = self._prev


class Value:
    __slots__ = ("data", "grad", "_children", "_local_grads")

    def __init__(self, data, children=(), local_grads=()):
        self.data = float(data)
        self.grad = 0.0
        self._children = children          # מאילו ערכים נוצרתי
        self._local_grads = local_grads    # d(אני) / d(כל ילד)
        if children and _recording:
            _tape.append(self)

    # ---- פעולות בסיס ----
    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return Value(self.data + other.data, (self, other), (1.0, 1.0))

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        return Value(self.data * other.data, (self, other), (other.data, self.data))

    def __pow__(self, k):
        assert isinstance(k, (int, float)), "רק חזקה במספר רגיל"
        return Value(self.data ** k, (self,), (k * self.data ** (k - 1),))

    def exp(self):
        e = math.exp(self.data)
        return Value(e, (self,), (e,))

    def log(self):
        return Value(math.log(self.data), (self,), (1.0 / self.data,))

    def relu(self):
        return Value(max(0.0, self.data), (self,), (1.0 if self.data > 0 else 0.0,))

    # ---- נוחות ----
    def __neg__(self):
        return self * -1.0

    def __sub__(self, other):
        return self + (-other)

    def __truediv__(self, other):
        return self * (other ** -1 if isinstance(other, Value) else 1.0 / other)

    def __radd__(self, other):
        return self + other

    def __rsub__(self, other):
        return (-self) + other

    def __rmul__(self, other):
        return self * other

    def __rtruediv__(self, other):
        return Value(other) * self ** -1

    def __repr__(self):
        return f"Value(data={self.data:.4f}, grad={self.grad:.4f})"

    # ---- למידה: חישוב כל הנגזרות ----
    def backward(self):
        """
        כלל השרשרת: עוברים על הסרט מהסוף להתחלה. כל צומת נוצר אחרי
        הילדים שלו, ולכן כשמגיעים אליו הנגזרת שלו כבר מלאה וסופית.
        """
        self.grad = 1.0
        for node in reversed(_tape):
            g = node.grad
            if g:
                for child, local in zip(node._children, node._local_grads):
                    child.grad += local * g
        _tape.clear()


# ---- פעולות "מאוחדות" שחוסכות המון צמתים ומאיצות את הכל ----

def vsum(values):
    """סכום של הרבה ערכים בצומת אחד."""
    values = tuple(values)
    return Value(sum(v.data for v in values), values, (1.0,) * len(values))


def _sumprod(xs, ys):
    return sum([x * y for x, y in zip(xs, ys)])


_sumprod = getattr(math, "sumprod", _sumprod)   # מהיר יותר בפייתון 3.12 ומעלה


def dot(a, b):
    """מכפלה סקלרית a·b בצומת אחד."""
    ad = [x.data for x in a]
    bd = [y.data for y in b]
    return Value(_sumprod(ad, bd), (*a, *b), (*bd, *ad))


def matvec(w, x):
    """מטריצה כפול וקטור: צומת אחד לכל שורה."""
    x = tuple(x)
    xd = [v.data for v in x]
    out = []
    for row in w:
        rd = [v.data for v in row]
        out.append(Value(_sumprod(rd, xd), (*row, *x), (*xd, *rd)))
    return out


def cross_entropy(logits, target):
    """
    כמה המודל "הופתע" מהתשובה הנכונה: -log(הסתברות שנתן לה).
    בצומת אחד, עם הנגזרת המוכנה: softmax פחות 1 במקום הנכון.
    """
    logits = tuple(logits)
    m = max(v.data for v in logits)
    exps = [math.exp(v.data - m) for v in logits]
    total = sum(exps)
    probs = [e / total for e in exps]
    grads = probs[:]
    grads[target] -= 1.0
    return Value(-math.log(probs[target]), logits, tuple(grads))
