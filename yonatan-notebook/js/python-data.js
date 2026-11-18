// Generated: every answer was produced by actually running the code.
export const UNITS = [
{
"title": "print ומשתנים",
"concept": "כל שורה שמתחילה ב-print מדפיסה למסך. משתנה הוא \"קופסה\" עם שם: x = 5 שם 5 בקופסה x. אפשר להחליף את התוכן בכל רגע.",
"qs": [
{
"id": "py1-1",
"code": "x = 5\nx = x + 3\nprint(x)",
"ans": "8",
"wrong": [
"5",
"3",
"x + 3"
],
"why": "קודם x הוא 5, ואז x מקבל 5+3."
},
{
"id": "py1-2",
"code": "a = 2\nb = a\na = 10\nprint(b)",
"ans": "2",
"wrong": [
"10",
"12",
"a"
],
"why": "b קיבל עותק של 2. שינוי של a אחר כך לא משנה את b."
},
{
"id": "py1-3",
"code": "name = \"Yoni\"\nprint(\"Hi\", name)",
"ans": "Hi Yoni",
"wrong": [
"Hi name",
"HiYoni",
"Hi, Yoni"
],
"why": "print עם פסיק מדפיס רווח בין החלקים."
},
{
"id": "py1-4",
"code": "x = 7\nprint(\"x\")",
"ans": "x",
"wrong": [
"7",
"x = 7",
"שגיאה"
],
"why": "במרכאות זה טקסט, לא המשתנה."
}
]
},
{
"title": "מספרים וחשבון",
"concept": "פעולות: + - * /. החילוק / תמיד נותן מספר עשרוני. // זה חילוק שלם, % זה השארית, ** זה חזקה.",
"qs": [
{
"id": "py2-1",
"code": "print(7 // 2)",
"ans": "3",
"wrong": [
"3.5",
"4",
"1"
],
"why": "// זורק את מה שאחרי הנקודה: 7 לחלק ל-2 זה 3 ושארית 1."
},
{
"id": "py2-2",
"code": "print(7 % 2)",
"ans": "1",
"wrong": [
"3",
"3.5",
"0"
],
"why": "% מחזיר את השארית: 7 = 2·3 + 1."
},
{
"id": "py2-3",
"code": "print(2 ** 3)",
"ans": "8",
"wrong": [
"6",
"5",
"9"
],
"why": "** זו חזקה: 2·2·2."
},
{
"id": "py2-4",
"code": "print(10 / 5)",
"ans": "2.0",
"wrong": [
"2",
"5",
"0.5"
],
"why": "/ תמיד מחזיר float, ולכן 2.0."
},
{
"id": "py2-5",
"code": "print(3 + 4 * 2)",
"ans": "11",
"wrong": [
"14",
"10",
"24"
],
"why": "כפל לפני חיבור, בדיוק כמו בחשבון."
}
]
},
{
"title": "מחרוזות (טקסט)",
"concept": "מחרוזת היא טקסט במרכאות. + מחבר טקסטים, * חוזר עליהם, len סופר תווים, ואפשר לגשת לתו לפי מיקום שמתחיל מ-0.",
"qs": [
{
"id": "py3-1",
"code": "print(\"ab\" * 3)",
"ans": "ababab",
"wrong": [
"ab3",
"ab ab ab",
"שגיאה"
],
"why": "כפל של מחרוזת חוזר עליה."
},
{
"id": "py3-2",
"code": "s = \"python\"\nprint(s[0])",
"ans": "p",
"wrong": [
"y",
"python",
"0"
],
"why": "הספירה מתחילה מ-0, ולכן s[0] הוא התו הראשון."
},
{
"id": "py3-3",
"code": "s = \"python\"\nprint(len(s))",
"ans": "6",
"wrong": [
"5",
"7",
"python"
],
"why": "len סופר את התווים: p-y-t-h-o-n."
},
{
"id": "py3-4",
"code": "print(\"5\" + \"5\")",
"ans": "55",
"wrong": [
"10",
"5 5",
"שגיאה"
],
"why": "שני טקסטים מתחברים זה לזה ולא מחברים כמספרים."
},
{
"id": "py3-5",
"code": "s = \"hello\"\nprint(s.upper())",
"ans": "HELLO",
"wrong": [
"hello",
"Hello",
"HELLO!"
],
"why": "upper הופך את כל האותיות לגדולות."
}
]
},
{
"title": "תנאים if",
"concept": "if בודק תנאי. אם הוא נכון, הקוד המוזח מתחתיו רץ. elif זה \"אחרת אם\", ו-else זה \"בכל מקרה אחר\". == בודק שוויון.",
"qs": [
{
"id": "py4-1",
"code": "x = 15\nif x > 10:\n    print(\"big\")\nelse:\n    print(\"small\")",
"ans": "big",
"wrong": [
"small",
"big\nsmall",
"כלום"
],
"why": "15 > 10 נכון, ולכן רק big."
},
{
"id": "py4-2",
"code": "x = 5\nif x > 10:\n    print(\"A\")\nelif x > 3:\n    print(\"B\")\nelse:\n    print(\"C\")",
"ans": "B",
"wrong": [
"A",
"C",
"B\nC"
],
"why": "הראשון לא נכון, השני נכון, ולכן B. אחרי שתנאי אחד מתקיים, השאר לא נבדקים."
},
{
"id": "py4-3",
"code": "print(3 == 3.0)",
"ans": "True",
"wrong": [
"False",
"3",
"שגיאה"
],
"why": "מבחינת הערך, 3 ו-3.0 שווים."
},
{
"id": "py4-4",
"code": "age = 13\nprint(age >= 13 and age < 18)",
"ans": "True",
"wrong": [
"False",
"13",
"and"
],
"why": "שני התנאים נכונים, ולכן and נותן True."
}
]
},
{
"title": "לולאות",
"concept": "for i in range(n) רץ על i = 0, 1, …, n-1. range(a, b) מתחיל ב-a ונעצר לפני b. while רץ כל עוד התנאי נכון.",
"qs": [
{
"id": "py5-1",
"code": "for i in range(3):\n    print(i)",
"ans": "0\n1\n2",
"wrong": [
"1\n2\n3",
"0\n1\n2\n3",
"3"
],
"why": "range(3) זה 0, 1, 2. הספירה נעצרת לפני 3."
},
{
"id": "py5-2",
"code": "total = 0\nfor i in range(1, 5):\n    total += i\nprint(total)",
"ans": "10",
"wrong": [
"15",
"5",
"4"
],
"why": "הסכום 1+2+3+4. ה-5 לא נכנס."
},
{
"id": "py5-3",
"code": "n = 1\nwhile n < 20:\n    n = n * 2\nprint(n)",
"ans": "32",
"wrong": [
"16",
"20",
"64"
],
"why": "1→2→4→8→16→32. ב-32 התנאי כבר לא מתקיים."
},
{
"id": "py5-4",
"code": "for c in \"abc\":\n    print(c * 2)",
"ans": "aa\nbb\ncc",
"wrong": [
"abcabc",
"a\nb\nc",
"aa bb cc"
],
"why": "הלולאה עוברת על כל תו ומדפיסה אותו פעמיים."
}
]
},
{
"title": "רשימות",
"concept": "רשימה: [1, 2, 3]. append מוסיף לסוף, len סופר, [-1] זה האיבר האחרון, ו-in בודק אם איבר נמצא ברשימה.",
"qs": [
{
"id": "py6-1",
"code": "a = [4, 7, 9]\nprint(a[-1])",
"ans": "9",
"wrong": [
"4",
"-1",
"7"
],
"why": "-1 זה האיבר האחרון."
},
{
"id": "py6-2",
"code": "a = [1, 2]\na.append(5)\nprint(len(a))",
"ans": "3",
"wrong": [
"2",
"5",
"8"
],
"why": "אחרי append יש ברשימה 3 איברים."
},
{
"id": "py6-3",
"code": "a = [3, 1, 2]\na.sort()\nprint(a)",
"ans": "[1, 2, 3]",
"wrong": [
"[3, 1, 2]",
"[3, 2, 1]",
"6"
],
"why": "sort ממיין מהקטן לגדול."
},
{
"id": "py6-4",
"code": "nums = [2, 5, 8]\nprint(5 in nums)",
"ans": "True",
"wrong": [
"False",
"1",
"5"
],
"why": "5 נמצא ברשימה."
},
{
"id": "py6-5",
"code": "a = [1, 2, 3]\nprint(a[1:])",
"ans": "[2, 3]",
"wrong": [
"[1, 2]",
"[1]",
"2"
],
"why": "חיתוך מאינדקס 1 ועד הסוף."
}
]
},
{
"title": "פונקציות",
"concept": "def מגדיר פונקציה, מתכון עם שם. return מחזיר תוצאה. אם אין return, הפונקציה מחזירה None.",
"qs": [
{
"id": "py7-1",
"code": "def double(x):\n    return x * 2\nprint(double(4) + 1)",
"ans": "9",
"wrong": [
"10",
"8",
"5"
],
"why": "double(4) מחזיר 8, ועוד 1 זה 9."
},
{
"id": "py7-2",
"code": "def hi():\n    print(\"hi\")\nr = hi()\nprint(r)",
"ans": "hi\nNone",
"wrong": [
"hi\nhi",
"None",
"hi"
],
"why": "הפונקציה מדפיסה hi. אין בה return, ולכן r הוא None."
},
{
"id": "py7-3",
"code": "def f(a, b=10):\n    return a + b\nprint(f(5))",
"ans": "15",
"wrong": [
"5",
"15 10",
"שגיאה"
],
"why": "b מקבל ערך ברירת מחדל 10, ולכן 5+10."
}
]
},
{
"title": "מילונים",
"concept": "מילון שומר זוגות של מפתח וערך: {\"name\": \"Yoni\"}. ניגשים לערך עם d[\"name\"], ומשנים או מוסיפים עם d[\"age\"] = 13.",
"qs": [
{
"id": "py8-1",
"code": "d = {\"a\": 1, \"b\": 2}\nprint(d[\"b\"])",
"ans": "2",
"wrong": [
"1",
"b",
"\"b\": 2"
],
"why": "ניגשים לפי מפתח, וקיבלנו את הערך שלו."
},
{
"id": "py8-2",
"code": "d = {\"x\": 1}\nd[\"x\"] = 5\nd[\"y\"] = 2\nprint(len(d))",
"ans": "2",
"wrong": [
"3",
"1",
"7"
],
"why": "x שונה ו-y נוסף, ולכן יש 2 מפתחות."
},
{
"id": "py8-3",
"code": "d = {\"cat\": 3, \"dog\": 4}\nfor k in d:\n    print(k)",
"ans": "cat\ndog",
"wrong": [
"3\n4",
"cat 3\ndog 4",
"d"
],
"why": "לולאה על מילון עוברת על המפתחות."
}
]
}
];
