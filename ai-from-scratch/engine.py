"""
המנוע: גזירה אוטומטית (autograd) מאפס.

כל מספר במודל הוא Value. כל Value זוכר מאילו מספרים הוא נוצר,
ומה הנגזרת "המקומית" שלו ביחס לכל אחד מהם. כך אפשר ללכת אחורה
(backward) ולחשב, לפי כלל השרשרת, כמה כל פרמטר השפיע על השגיאה.

אין כאן שום ספרייה חיצונית: רק math מהספרייה הסטנדרטית של פייתון.
"""

import math


class Value:
    __slots__ = ("data", "grad", "_children", "_local_grads")

    def __init__(self, data, children=(), local_grads=()):
        self.data = float(data)
        self.grad = 0.0
        self._children = children          # מאילו ערכים נוצרתי
        self._local_grads = local_grads    # d(אני) / d(כל ילד)

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
        # סידור טופולוגי (בלי רקורסיה, כדי לא להיתקע בגרפים גדולים)
        order, seen, stack = [], set(), [(self, False)]
        while stack:
            node, done = stack.pop()
            if done:
                order.append(node)
                continue
            if id(node) in seen:
                continue
            seen.add(id(node))
            stack.append((node, True))
            for child in node._children:
                if id(child) not in seen:
                    stack.append((child, False))

        self.grad = 1.0
        for node in reversed(order):
            g = node.grad
            if g == 0.0:
                continue
            for child, local in zip(node._children, node._local_grads):
                child.grad += local * g


# ---- פעולות "מאוחדות" שחוסכות המון צמתים ומאיצות את הכל ----

def vsum(values):
    """סכום של הרבה ערכים בצומת אחד."""
    values = tuple(values)
    return Value(sum(v.data for v in values), values, (1.0,) * len(values))


def dot(a, b):
    """מכפלה סקלרית a·b בצומת אחד."""
    a, b = tuple(a), tuple(b)
    data = sum(x.data * y.data for x, y in zip(a, b))
    return Value(data, a + b, tuple(y.data for y in b) + tuple(x.data for x in a))
