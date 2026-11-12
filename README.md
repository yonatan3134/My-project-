# My-project-
Building a game 

---

<div dir="rtl">

# עורך וידאו בקוד

סביבת עריכת וידאו שמופעלת בפקודות ובשיחה עם Claude: מורידים חומר גלם, חותכים, מתמללים, מוסיפים כתוביות וגרפיקה, ומרנדרים קובץ וידאו.

## מה מותקן

| כלי | תפקיד |
| --- | --- |
| **yt-dlp** | הורדת וידאו ואודיו מהרשת |
| **FFmpeg** | חיתוך, חיבור, שינוי יחס מסך, אודיו, המרות |
| **Whisper** (faster-whisper) | תמלול עם תזמון לכל מילה. לעברית נעשה שימוש במודל של **ivrit.ai** |
| **Remotion** | כתוביות מונפשות, כותרות וגרפיקה ב-React |
| **HyperFrames** | כתוביות, כותרות וגרפיקה ב-HTML ו-GSAP, עם ספריית רכיבים מוכנים |

## התקנה

</div>

```bash
bash scripts/setup.sh     # מתקין הכול
bash scripts/doctor.sh    # בודק שהכול עובד
```

<div dir="rtl">

דרישות מוקדמות: Node.js 22 ומעלה, Python 3.10 ומעלה, FFmpeg.

## התיקיות

</div>

```
media/raw/           חומר גלם: הורדות וקבצי מצלמה
media/work/          קבצי ביניים: חיתוכים, תמונות בדיקה
media/audio/         מוזיקה, קריינות, אודיו שחולץ
media/transcripts/   תמלולים: כתוביות לכל כלי, SRT, VTT, טקסט
assets/              דברים שחוזרים בין סרטונים: פונטים, לוגואים, מוזיקה
out/                 הסרטונים המוכנים
remotion/            פרויקט Remotion
hyperframes/         HyperFrames והפרויקטים שלו (projects/)
scripts/             הפקודות של העורך
.claude/skills/      הידע של Claude על עריכה בכלים האלה
```

<div dir="rtl">

קבצי מדיה ורינדורים לא נשמרים ב-git (הם גדולים), רק הקוד והנכסים הקטנים.

## הפקודות

</div>

```bash
# הורדה אל media/raw
bash scripts/download.sh "<url>"
bash scripts/download.sh "<url>" --audio                  # אודיו בלבד
bash scripts/download.sh "<url>" --section "*1:30-2:45"   # קטע מסוים

# תמלול (השפה מזוהה לבד; עברית הולכת למודל של ivrit.ai)
bash scripts/transcribe.sh media/raw/talk.mp4
bash scripts/transcribe.sh media/raw/talk.mp4 --lang he --prompt "שמות ומונחים לאיות נכון"

# הסרת שתיקות
bash scripts/jumpcut.sh media/raw/talk.mp4

# תמלול + כתוביות מונפשות בפקודה אחת -> out/talk.captioned.mp4
bash scripts/caption.sh media/raw/talk.mp4

# דף פריימים, כדי לראות מה יש בסרטון
bash scripts/frames.sh out/talk.captioned.mp4 12
```

<div dir="rtl">

רינדור ישיר:

</div>

```bash
cd remotion && npx remotion render CaptionedVideo ../out/video.mp4
cd hyperframes/projects/demo && npx hyperframes render --quality looks -o ../../../out/demo.mp4
```

<div dir="rtl">

## עבודה עם Claude

פשוט מבקשים, למשל:

- "תוריד את הסרטון הזה, תחתוך את השתיקות ותוסיף כתוביות בעברית"
- "תהפוך את הקטע בין 1:30 ל-2:10 לסרטון אנכי עם כתוביות צהובות"
- "תבנה פתיח של 5 שניות עם הלוגו שלי ב-HyperFrames"
- "תתקן בכתוביות את המילה X ותרנדר שוב"

Claude טוען את ה-skill בשם `video-editor`, שמכיל את סדר העבודה, ואת ה-skills הרשמיים של Remotion ו-HyperFrames.

## עברית

- התמלול בעברית משתמש במודל `ivrit-ai/whisper-large-v3-turbo-ct2`.
- הכתוביות מיושרות מימין לשמאל אוטומטית, גם כשיש מילים באנגלית באמצע.
- הפונט הוא Heebo (עברית ולטינית), שמור בתוך הפרויקט ולכן לא תלוי ברשת.

## שימוש בענן (claude.ai/code)

- המכונה זמנית: מה שב-`media/` וב-`out/` נמחק כשהסשן נסגר. את הסרטון המוכן צריך להוריד.
- הרשת מוגבלת לרשימת אתרים מאושרים. מודלי Whisper והדפדפן של Remotion כבר מאושרים בסביבה "My-project- video editor".
- **הורדה מ-YouTube דורשת הרשאת רשת רחבה יותר** (שרתי הווידאו שלו מתחלפים), ולעיתים YouTube חוסם כתובות של שרתי ענן. אפשר להרחיב את הגישה בהגדרות הסביבה, או להעלות את הקובץ ישירות.

## רישוי

- Remotion חינמי ליחידים ולחברות עד 3 עובדים; חברות גדולות יותר צריכות רישיון.
- הפונט Heebo מופץ ברישיון SIL Open Font License (הקובץ `assets/fonts/heebo/OFL.txt`).
- מורידים רק תוכן שיש לכם זכות להשתמש בו.

</div>
