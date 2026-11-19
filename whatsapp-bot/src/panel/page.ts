/** The settings website: one page, Hebrew, right to left. All data comes from /api/state. */
export const PAGE = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>הבוט שלי</title>
<style>
  :root { --bg:#f4f1fb; --card:#fff; --ink:#1f1b2e; --muted:#6b6580; --brand:#7c3aed; --brand2:#ec4899; --ok:#16a34a; --bad:#dc2626; --warn:#d97706; --line:#e7e2f3; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14111f; --card:#1e1a2e; --ink:#f1edfb; --muted:#a79fc2; --line:#2e2843; } }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif; background:var(--bg); color:var(--ink); }
  header { background:linear-gradient(120deg,var(--brand),var(--brand2)); color:#fff; padding:22px 16px 46px; text-align:center; }
  header h1 { margin:0; font-size:26px; } header p { margin:6px 0 0; opacity:.9; }
  main { max-width:860px; margin:-30px auto 40px; padding:0 16px; display:grid; gap:16px; }
  .card { background:var(--card); border-radius:18px; padding:18px; box-shadow:0 4px 18px rgba(80,40,160,.08); border:1px solid var(--line); }
  .card h2 { margin:0 0 12px; font-size:19px; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .stat { flex:1 1 120px; background:var(--bg); border-radius:14px; padding:12px; text-align:center; }
  .stat b { display:block; font-size:24px; } .stat span { color:var(--muted); font-size:13px; }
  label { display:block; font-size:14px; margin:10px 0 4px; color:var(--muted); }
  input, select, textarea { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font:inherit; background:var(--card); color:var(--ink); }
  textarea { min-height:60px; resize:vertical; }
  button { border:0; border-radius:12px; padding:11px 18px; font:inherit; font-weight:600; cursor:pointer; background:var(--brand); color:#fff; }
  button.light { background:var(--bg); color:var(--ink); border:1px solid var(--line); }
  button.danger { background:transparent; color:var(--bad); padding:6px 10px; }
  button:disabled { opacity:.5; cursor:default; }
  .pill { display:inline-block; padding:4px 10px; border-radius:99px; font-size:13px; font-weight:600; }
  .pill.ok { background:#dcfce7; color:#166534; } .pill.bad { background:#fee2e2; color:#991b1b; } .pill.warn { background:#fef3c7; color:#92400e; }
  .code { font-size:38px; letter-spacing:6px; font-weight:800; direction:ltr; text-align:center; background:var(--bg); border-radius:14px; padding:14px; margin:10px 0; }
  .hint { color:var(--muted); font-size:14px; line-height:1.5; }
  .ch { border:1px solid var(--line); border-radius:14px; padding:12px; margin-bottom:10px; }
  .ch .top { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .ch .top input[type=text] { flex:1; }
  .ch details { margin-top:6px; } .ch summary { cursor:pointer; color:var(--muted); font-size:14px; }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; } @media (max-width:600px) { .grid3 { grid-template-columns:1fr 1fr; } }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; } @media (max-width:600px) { .grid2 { grid-template-columns:1fr; } }
  #toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#1f1b2e; color:#fff; padding:12px 18px; border-radius:12px; display:none; z-index:9; }
  ul.events { margin:0; padding:0 18px 0 0; color:var(--muted); font-size:14px; }
  .ltr { direction:ltr; text-align:left; }
  .post { border-bottom:1px solid var(--line); padding:9px 0; display:flex; gap:8px; align-items:flex-start; }
  .post:last-child { border-bottom:0; }
  .post .t { flex:1; white-space:pre-wrap; word-break:break-word; font-size:15px; }
  .post small { color:var(--muted); display:block; }
  .grow { font-size:12px; font-weight:700; } .grow.up { color:var(--ok); } .grow.down { color:var(--bad); }
</style>
</head>
<body>
<header><h1>🤖 הבוט של הערוצים</h1><p id="sub">טוען...</p></header>
<main>
  <section class="card">
    <h2>מצב עכשיו</h2>
    <div class="row" id="stats"></div>
    <div class="row" style="margin-top:12px"><button id="pauseBtn" class="light"></button></div>
    <ul class="events" id="events" style="margin-top:12px"></ul>
  </section>

  <section class="card" id="pendingCard" style="display:none">
    <h2>✅ מחכים לאישור שלך</h2>
    <p class="hint">בערוצים שבהם הפעלת "אישור לפני פרסום". ✅ = יפורסם בזמן הבא של הערוץ. 🗑 = נמחק.</p>
    <div id="pending"></div>
  </section>

  <section class="card">
    <h2>👀 הפוסטים הבאים</h2>
    <p class="hint">מה הבוט עומד לפרסם. פוסט שלא מתאים, מוחקים לפני שהוא יוצא.</p>
    <select id="qCh"></select>
    <div id="queue" style="margin-top:10px"></div>
  </section>

  <section class="card">
    <h2>📤 פורסמו לאחרונה</h2>
    <div id="recent"></div>
  </section>

  <section class="card">
    <h2>🚀 מצב צמיחה</h2>
    <p class="hint">מתאים את הבוט למה שעוזר לערוצים לגדול בוואטסאפ:</p>
    <ul class="hint" style="margin:0 0 12px;padding-right:18px">
      <li>יותר סקרים, סוג הפוסט שמקבל הכי הרבה תגובות</li>
      <li>פוסטים שמזמינים להגיב באימוג'י או לשלוח לחבר</li>
      <li>שקט בלילה (00:00-07:00), כשכולם ישנים</li>
      <li>פעם ביום כל ערוץ ממליץ על ערוץ אחר שלך, עם קישור</li>
    </ul>
    <button id="growthBtn"></button>
  </section>

  <section class="card">
    <h2>🧠 מודלים</h2>
    <p class="hint">הבוט עובר לבד למודל הבא ברשימה כשמודל לא זמין.</p>
    <div id="models"></div>
    <p class="hint" id="imgs" style="margin-top:10px"></p>
  </section>

  <section class="card">
    <h2>📱 חיבור לוואטסאפ</h2>
    <div id="wa"></div>
  </section>

  <section class="card">
    <h2>🔑 מפתח ומספרים</h2>
    <label>מפתח Gemini <span id="keyState"></span></label>
    <input id="geminiKey" type="password" class="ltr" placeholder="להשאיר ריק כדי לא לשנות" autocomplete="off">
    <div class="grid2">
      <div><label>המספר של הבוט (למשל 972501234567)</label><input id="botPhone" class="ltr" inputmode="numeric"></div>
      <div><label>המספר שלך, לפקודות ולדוחות</label><input id="ownerPhone" class="ltr" inputmode="numeric"></div>
    </div>
    <details style="margin-top:10px"><summary class="hint">עוד הגדרות (לא חובה)</summary>
      <label>שם להתראות באפליקציית ntfy</label><input id="ntfyTopic" class="ltr" placeholder="שם ארוך וקשה לניחוש">
      <label>מפתח Claude, כגיבוי כש-Gemini לא זמין <span id="claudeState"></span></label><input id="anthropicKey" type="password" class="ltr" placeholder="להשאיר ריק כדי לא לשנות" autocomplete="off">
      <label>מפתח Pexels לרקעים <span id="pexelsState"></span></label><input id="pexelsKey" type="password" class="ltr" placeholder="להשאיר ריק כדי לא לשנות" autocomplete="off">
    </details>
    <div class="row" style="margin-top:14px"><button id="saveSettings">שמירה</button><span class="hint">אחרי שמירה הבוט מופעל מחדש (כ-10 שניות)</span></div>
  </section>

  <section class="card">
    <h2>📢 ערוצים</h2>
    <p class="hint">הבוט חייב להיות מנהל בכל ערוץ. הסדר כאן הוא הסדר שבו ערוצים נכנסים לפעולה בהתחלה ההדרגתית.</p>
    <details style="margin-bottom:12px"><summary>📋 הדבקת רשימה מעודכנת מוואטסאפ</summary>
      <p class="hint">מדביקים כאן את ההודעה עם הקישורים ("כדי לעקוב אחרי הערוץ ... ב-WhatsApp: https://..."). ערוצים קיימים שומרים את ההגדרות שלהם.</p>
      <textarea id="importText" style="min-height:90px" class="ltr"></textarea>
      <div class="row" style="margin-top:8px"><button class="light" id="importBtn">לעדכן את הרשימה</button></div>
    </details>
    <div id="channels"></div>
    <div class="row"><button class="light" id="addCh">➕ ערוץ חדש</button><button id="saveCh">שמירת הערוצים</button></div>
  </section>
</main>
<div id="toast"></div>
<script>
const MODES = { creative:"AI כותב חופשי (חידות, סקרים, בדיחות)", fandom:"מעריצים: סקרים + חדשות אמיתיות", news:"רק חדשות אמיתיות", invasion:"ערוץ הפלישה", off:"כבוי" };
let S = null, editing = false;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
function toast(t) { const el = $("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = "none", 4000); }
async function post(path, body) {
  const r = await fetch(path, { method:"POST", headers:{ "Content-Type":"application/json", "X-Panel":"1" }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ("שגיאה " + r.status));
  return j;
}
function waitRestart(msg) {
  toast(msg + " הבוט מופעל מחדש...");
  editing = false;
  setTimeout(load, 9000); setTimeout(load, 16000);
}

function render() {
  const s = S;
  $("sub").textContent = s.connection === "open" ? "מחובר ופועל 24/7" : "צריך להשלים הגדרה";
  const pill = (ok, t) => '<span class="pill ' + (ok ? "ok" : "bad") + '">' + t + "</span>";
  $("stats").innerHTML = [
    ["וואטסאפ", s.connection === "open" ? "✅" : "❌"],
    ["פורסמו היום", s.today.sent],
    ["מחכים בתור", s.today.ready],
    ["ערוצים פעילים", s.activeChannels + "/" + s.postingChannels],
    ["עוקבים בסך הכול", s.channels.reduce((a, c) => a + (c.followers || 0), 0).toLocaleString("he-IL")],
    ["קריאות AI היום", s.usage.calls],
    ...(s.pendingTotal ? [["מחכים לאישור", s.pendingTotal]] : []),
  ].map(([t, v]) => '<div class="stat"><b>' + esc(v) + "</b><span>" + t + "</span></div>").join("");
  $("growthBtn").textContent = s.growth ? "✅ מצב צמיחה פועל · לכבות" : "🚀 להפעיל מצב צמיחה";
  $("growthBtn").className = s.growth ? "light" : "";
  $("pauseBtn").textContent = s.paused ? "▶️ להחזיר את הפרסומים" : "⏸ לעצור את כל הפרסומים";
  $("recent").innerHTML = s.recent.length ? s.recent.map((r) =>
    '<div class="post"><div class="t">' + esc(r.text) + "<small>" + esc(r.channel) + " · " + new Date(r.at).toLocaleTimeString("he-IL", { hour:"2-digit", minute:"2-digit" }) + "</small></div></div>").join("")
    : '<p class="hint">עוד לא פורסם כלום.</p>';
  const qSel = $("qCh"), keep = qSel.value;
  const posting = s.channels.filter((c) => c.enabled && ["creative", "fandom", "news"].includes(c.mode));
  qSel.innerHTML = posting.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + " (" + c.ready + ")</option>").join("");
  if (keep && posting.some((c) => c.id === keep)) qSel.value = keep;
  if (!loadQueue.loaded) { loadQueue.loaded = true; loadQueue(); }
  $("pendingCard").style.display = s.pendingTotal ? "" : "none";
  if (s.pendingTotal && s.pendingTotal !== loadPending.last) { loadPending.last = s.pendingTotal; loadPending(); }
  $("events").innerHTML = s.problems.map((p) => "<li>" + esc(p) + "</li>").join("");
  $("keyState").innerHTML = s.hasKey ? pill(true, "שמור") : pill(false, "חסר");
  $("claudeState").innerHTML = s.hasClaude ? pill(true, "שמור") : "";
  $("models").innerHTML = s.models.map((m, i) => '<div class="post"><div class="t ltr">' + (i + 1) + ". " + esc(m.name) +
    (m.problem ? '<small style="color:var(--bad)">' + esc(m.problem) + "</small>" : m.lastUsedAt ? "<small>עובד ✓</small>" : "<small>מוכן</small>") + "</div></div>").join("");
  $("imgs").textContent = s.images.enabled ? "🎨 תמונות AI היום: " + s.images.today + " מתוך " + s.images.max + " (אחרי זה: תמונה עם רקע צבעוני)" : "🎨 תמונות AI כבויות (אין מפתח Gemini)";
  $("pexelsState").innerHTML = s.hasPexels ? pill(true, "שמור") : "";

  let wa = "";
  if (s.connection === "open") wa = pill(true, "מחובר") + ' <span class="hint">הבוט מחובר ל-' + esc(s.botPhone) + "</span>";
  else if (s.pairingCode) wa = '<p>בטלפון של הבוט: וואטסאפ ← ⋮ ← <b>מכשירים מקושרים</b> ← <b>קישור מכשיר</b> ← <b>קישור באמצעות מספר טלפון</b>, ומקלידים:</p><div class="code">' + esc(s.pairingCode) + '</div><p class="hint">הקוד מתחלף אחרי כדקה. העמוד מתעדכן לבד.</p>';
  else if (s.linking) wa = '<p class="hint">מבקש קוד מוואטסאפ...</p>';
  else if (!s.linked) wa = (s.linkError ? '<p style="color:var(--bad)">' + esc(s.linkError) + "</p>" : "") + (s.botPhone
      ? '<p class="hint">הבוט עוד לא מחובר. לוחצים, ומקבלים קוד של 8 תווים להקליד בטלפון של הבוט.</p><button id="linkBtn">לקבל קוד חיבור</button>'
      : '<p class="hint">קודם ממלאים למטה את המספר של הבוט ושומרים.</p>');
  else wa = pill(false, "מתחבר...") + ' <span class="hint">' + esc(s.connection) + "</span>";
  $("wa").innerHTML = wa;
  if ($("linkBtn")) $("linkBtn").onclick = async () => { try { await post("/api/link"); toast("מבקש קוד..."); setTimeout(load, 2500); } catch (e) { toast(e.message); } };

  if (!editing) {
    $("botPhone").value = s.botPhone || ""; $("ownerPhone").value = s.ownerPhone || ""; $("ntfyTopic").value = s.ntfyTopic || "";
    // the page refreshes every few seconds; never redraw the list while a channel's settings are open
    if (!document.querySelector(".ch details[open]")) renderChannels(s.channels);
  }
}

function renderChannels(list) {
  const dc = S.defaultCycle;
  $("channels").innerHTML = list.map((c, i) => {
    let status = "";
    if (c.mode !== "off" && c.enabled) {
      if (c.role === "OWNER" || c.role === "ADMIN") status = '<span class="pill ok">✓ מנהל</span>';
      else if (c.role) status = '<span class="pill bad">לא מנהל</span>';
      else if (S.connection === "open") status = '<span class="pill warn">לא נבדק</span>';
    }
    const opts = Object.entries(MODES).map(([k, v]) => '<option value="' + k + '"' + (k === c.mode ? " selected" : "") + ">" + v + "</option>").join("");
    const cy = c.cycle || {}, sp = c.special || {};
    const live = c.id && c.enabled && c.mode !== "off";
    return '<div class="ch" data-i="' + i + '" data-id="' + esc(c.id || "") + '">' +
      '<div class="top">' +
      (live ? '<button class="light run" style="padding:6px 10px" title="פועל / עצור">' + (c.paused ? "⏸ עצור" : "▶️ פועל") + "</button>" : "") +
      '<input type="text" class="name" value="' + esc(c.name) + '" placeholder="שם הערוץ">' + status +
      (c.followers != null ? '<span class="hint" title="עוקבים">👥 ' + c.followers.toLocaleString("he-IL") + "</span>" +
        (c.followersWeek ? '<span class="grow ' + (c.followersWeek > 0 ? "up" : "down") + '">' + (c.followersWeek > 0 ? "+" : "") + c.followersWeek + " בשבוע</span>" : "") : "") +
      (c.sentToday ? '<span class="hint">' + c.sentToday + " היום</span>" : "") +
      '<button class="danger del" title="מחיקה מהבוט">✕</button></div>' +
      '<details' + (c.id ? "" : " open") + '><summary>⚙️ ניהול הערוץ</summary>' +
      '<label><input type="checkbox" class="en" style="width:auto"' + (c.enabled ? " checked" : "") + '> הבוט מנהל את הערוץ הזה</label>' +
      '<label>קישור לערוץ</label><input class="invite ltr" value="' + esc(!c.invite ? "" : c.invite.startsWith("http") ? c.invite : "https://whatsapp.com/channel/" + c.invite) + '" placeholder="https://whatsapp.com/channel/...">' +
      '<label>סוג</label><select class="mode">' + opts + "</select>" +
      '<label>על מה הערוץ (ה-AI כותב לפי זה)</label><textarea class="topic">' + esc(c.topic) + "</textarea>" +
      '<label>מילות חיפוש לחדשות אמיתיות, מופרדות בפסיק</label><input class="queries" value="' + esc((c.queries || []).join(", ")) + '">' +
      '<h3 style="font-size:15px;margin:14px 0 0">⏰ כל כמה זמן</h3>' +
      '<p class="hint" style="margin:4px 0">ריק = ההגדרה הכללית (' + dc.postsPerBurst + " פוסטים, כל " + dc.intervalMinutes + " דק׳, ואז הפסקה של " + dc.pauseMinutes + " דק׳)</p>" +
      '<div class="grid3"><div><label>פוסטים ברצף</label><input class="cyB" type="number" min="1" value="' + esc(cy.postsPerBurst ?? "") + '"></div>' +
      '<div><label>דקות בין פוסטים</label><input class="cyI" type="number" min="5" value="' + esc(cy.intervalMinutes ?? "") + '"></div>' +
      '<div><label>דקות הפסקה</label><input class="cyP" type="number" min="0" value="' + esc(cy.pauseMinutes ?? "") + '"></div></div>' +
      '<label>מקסימום פוסטים ביום (ריק = בלי הגבלה מיוחדת)</label><input class="max" type="number" min="1" value="' + esc(c.maxPerDay ?? "") + '">' +
      (c.cap ? '<p class="hint" style="margin:4px 0">כרגע עד ' + c.cap + " ביום (כולל התחלה הדרגתית)</p>" : "") +
      '<h3 style="font-size:15px;margin:14px 0 0">⭐ הודעה מיוחדת</h3>' +
      '<div class="grid3"><div><label>כל כמה פוסטים</label><input class="spE" type="number" min="2" placeholder="למשל 3" value="' + esc(sp.every ?? "") + '"></div></div>' +
      '<label>טקסט קבוע שיישלח כמו שהוא (למשל "תעקבו ותזמינו חברים!")</label><textarea class="spT">' + esc(sp.text ?? "") + "</textarea>" +
      '<label>או: הוראה ל-AI (למשל "חידה קשה במיוחד" או "סקר על הדמות הכי אהובה")</label><textarea class="spP">' + esc(sp.prompt ?? "") + "</textarea>" +
      (live ? '<h3 style="font-size:15px;margin:14px 0 0">🛡️ אישור לפני פרסום</h3><label><input type="checkbox" class="appr" style="width:auto"' + (c.approve ? " checked" : "") + '> כל פוסט מחכה לאישור שלי באתר לפני שהוא יוצא</label>' : "") +
      '<h3 style="font-size:15px;margin:14px 0 0">📈 מה עובד בערוץ</h3>' + perfHtml(c.perf) +
      (live ? '<div class="row" style="margin-top:12px"><button class="push">📣 לדחוף את הערוץ בכל הערוצים</button><button class="light test">🧪 לשלוח 4 פוסטי בדיקה</button></div><div class="testres hint"></div>' : "") +
      "</details></div>";
  }).join("");
  document.querySelectorAll(".ch .del").forEach((b) => b.onclick = () => {
    if (!confirm("למחוק את הערוץ מהבוט? (הערוץ עצמו בוואטסאפ לא נמחק)")) return;
    editing = true; b.closest(".ch").remove();
  });
  document.querySelectorAll(".ch .run").forEach((b) => b.onclick = async () => {
    const id = b.closest(".ch").dataset.id, c = S.channels.find((x) => x.id === id);
    try { await post("/api/channel-pause", { id, paused: !c.paused }); c.paused = !c.paused; b.textContent = c.paused ? "⏸ עצור" : "▶️ פועל"; toast(c.paused ? "הערוץ נעצר" : "הערוץ פועל"); } catch (e) { toast(e.message); }
  });
  document.querySelectorAll(".ch .appr").forEach((b) => b.onchange = async () => {
    const id = b.closest(".ch").dataset.id;
    try { await post("/api/approve-mode", { id, on: b.checked }); toast(b.checked ? "מעכשיו כל פוסט בערוץ מחכה לאישור שלך" : "הערוץ מפרסם לבד"); } catch (e) { toast(e.message); b.checked = !b.checked; }
  });
  document.querySelectorAll(".ch .test").forEach((b) => b.onclick = async () => {
    const box = b.closest(".ch"), out = box.querySelector(".testres");
    if (!confirm("לשלוח עכשיו 4 הודעות בדיקה (טקסט, סקר, תמונה, סרטון) לערוץ הזה? העוקבים יראו אותן.")) return;
    b.disabled = true; out.textContent = "שולח... (עד דקה)";
    try {
      const r = await fetch("/api/test", { method:"POST", headers:{ "Content-Type":"application/json", "X-Panel":"1" }, body: JSON.stringify({ id: box.dataset.id }) });
      const j = await r.json();
      out.innerHTML = j.error ? '<span style="color:var(--bad)">' + esc(j.error) + "</span>" :
        j.results.map((x) => (x.ok ? "✅ " : "❌ ") + esc(x.kind) + (x.ok ? "" : " – " + esc(x.error || ""))).join("<br>") +
        "<br>עכשיו פותחים את הערוץ בטלפון ובודקים מה באמת הופיע. מה שסומן ✅ ולא מופיע, וואטסאפ לא הציגה.";
    } catch (e) { out.textContent = e.message; }
    b.disabled = false;
  });
  document.querySelectorAll(".ch .push").forEach((b) => b.onclick = async () => {
    const id = b.closest(".ch").dataset.id, c = S.channels.find((x) => x.id === id);
    const msg = prompt("📣 הודעה שתישלח בכל הערוצים האחרים עם קישור ל-" + c.name + "\\n(להשאיר ריק להודעה מוכנה)", "");
    if (msg === null) return;
    try { await post("/api/push", { id, message: msg }); toast("📣 נשלח לתור. ההודעות ייצאו אחת-אחת ב-20 הדקות הקרובות"); } catch (e) { toast(e.message); }
  });
  document.querySelectorAll(".ch input, .ch select, .ch textarea").forEach((el) => el.addEventListener("input", () => editing = true));
}

const KIND_NAMES = { text:"טקסט", poll:"סקר", image:"תמונה", video:"סרטון" };
function perfHtml(perf) {
  const rows = Object.entries(perf || {}).filter(([, p]) => p && p.n > 0).sort((a, b) => b[1].avg - a[1].avg);
  if (!rows.length) return '<p class="hint" style="margin:4px 0">עוד אין נתונים. הבוט בודק כל 3 שעות כמה תגובות וצפיות קיבל כל פוסט.</p>';
  return '<p class="hint" style="margin:4px 0">ממוצע תגובות לפוסט ב-30 הימים האחרונים. הבוט כותב יותר ממה שמצליח.</p>' +
    rows.map(([k, p]) => '<div class="hint">' + (KIND_NAMES[k] || k) + ": ❤️ " + p.avg.toFixed(1) + " · 👁 " + Math.round(p.views) + " (" + p.n + " פוסטים)</div>").join("");
}

function collectChannels() {
  const n = (el, sel) => el.querySelector(sel).value.trim();
  return [...document.querySelectorAll(".ch")].map((el) => ({
    id: el.dataset.id || null,
    name: n(el, ".name"),
    invite: n(el, ".invite"),
    mode: el.querySelector(".mode").value,
    topic: n(el, ".topic"),
    queries: n(el, ".queries").split(",").map((q) => q.trim()).filter(Boolean),
    enabled: el.querySelector(".en").checked,
    maxPerDay: n(el, ".max"),
    cycle: n(el, ".cyB") && n(el, ".cyI") ? { postsPerBurst: n(el, ".cyB"), intervalMinutes: n(el, ".cyI"), pauseMinutes: n(el, ".cyP") || 0 } : null,
    special: n(el, ".spE") ? { every: n(el, ".spE"), text: n(el, ".spT"), prompt: n(el, ".spP") } : null,
  }));
}

/** Reads the "to follow the channel X on WhatsApp: link" lines WhatsApp produces when sharing channels. */
function importList() {
  const text = $("importText").value;
  const re = /(?:הערוץ|channel)\\s+(.+?)\\s+(?:ב-|on )WhatsApp:?\\S*\\s*https:\\/\\/whatsapp\\.com\\/channel\\/([A-Za-z0-9]+)/g;
  const found = [];
  for (const m of text.matchAll(re)) found.push({ name: m[1].replace(/[​-‏]/g, "").trim(), invite: m[2] });
  if (found.length === 0) {
    for (const m of text.matchAll(/https:\\/\\/whatsapp\\.com\\/channel\\/([A-Za-z0-9]+)/g)) found.push({ name: "", invite: m[1] });
  }
  if (found.length === 0) { toast("לא מצאתי קישורים לערוצים בטקסט"); return; }
  const current = collectChannels();
  const byInvite = new Map(current.map((c) => [c.invite.replace(/^.*channel\\//, ""), c]));
  const keep = new Set(found.map((f) => f.invite));
  const removed = current.filter((c) => c.id && !keep.has(c.invite.replace(/^.*channel\\//, "")));
  const added = found.filter((f) => !byInvite.has(f.invite));
  let list = found.map((f) => {
    const old = byInvite.get(f.invite);
    if (old) return { ...old, name: f.name || old.name };
    return { id: null, name: f.name || "ערוץ חדש", invite: "https://whatsapp.com/channel/" + f.invite, mode: "creative", topic: f.name, queries: [], enabled: true };
  });
  if (removed.length && !confirm("ברשימה החדשה חסרים " + removed.length + " ערוצים:\\n" + removed.map((r) => "• " + r.name).join("\\n") + "\\n\\nלהסיר אותם מהבוט?")) {
    list = list.concat(removed);
  }
  editing = true;
  renderChannels(list);
  toast("נמצאו " + found.length + " ערוצים, " + added.length + " חדשים. בודקים ולוחצים \\"שמירת הערוצים\\"");
}

$("importBtn").onclick = importList;
$("addCh").onclick = () => {
  editing = true;
  const list = collectChannels();
  list.push({ id: null, name: "", invite: "", mode: "creative", topic: "", queries: [], enabled: true });
  renderChannels(list);
  window.scrollTo(0, document.body.scrollHeight);
};
$("saveCh").onclick = async () => {
  try { await post("/api/channels", { channels: collectChannels() }); waitRestart("הערוצים נשמרו."); } catch (e) { toast(e.message); }
};
$("saveSettings").onclick = async () => {
  const body = { botPhone: $("botPhone").value, ownerPhone: $("ownerPhone").value, ntfyTopic: $("ntfyTopic").value };
  if ($("geminiKey").value.trim()) body.geminiKey = $("geminiKey").value.trim();
  if ($("pexelsKey").value.trim()) body.pexelsKey = $("pexelsKey").value.trim();
  if ($("anthropicKey").value.trim()) body.anthropicKey = $("anthropicKey").value.trim();
  try { await post("/api/settings", body); $("geminiKey").value = ""; $("pexelsKey").value = ""; $("anthropicKey").value = ""; waitRestart("נשמר."); } catch (e) { toast(e.message); }
};
["botPhone", "ownerPhone", "ntfyTopic"].forEach((id) => $(id).addEventListener("input", () => editing = true));
$("growthBtn").onclick = async () => { try { await post("/api/growth", { on: !S.growth }); toast(S.growth ? "מצב צמיחה כבוי" : "מצב צמיחה הופעל 🚀"); load(); } catch (e) { toast(e.message); } };
$("pauseBtn").onclick = async () => { try { await post("/api/pause", { paused: !S.paused }); load(); } catch (e) { toast(e.message); } };

async function loadQueue() {
  const id = $("qCh").value;
  if (!id) { $("queue").innerHTML = ""; return; }
  try {
    const r = await fetch("/api/queue?channel=" + encodeURIComponent(id), { cache:"no-store" });
    const list = await r.json();
    $("queue").innerHTML = list.length ? list.map((p) =>
      '<div class="post"><div class="t">' + esc(p.text) + '</div><button class="danger" data-id="' + p.id + '" title="למחוק">🗑</button></div>').join("")
      : '<p class="hint">אין כרגע פוסטים בתור. הבוט כותב חדשים תוך כמה דקות.</p>';
    document.querySelectorAll("#queue button[data-id]").forEach((b) => b.onclick = async () => {
      try { await post("/api/discard", { id: Number(b.dataset.id) }); b.closest(".post").remove(); toast("נמחק"); } catch (e) { toast(e.message); }
    });
  } catch { $("queue").innerHTML = '<p class="hint">לא הצלחתי לטעון</p>'; }
}
$("qCh").onchange = loadQueue;

async function loadPending() {
  try {
    const list = await (await fetch("/api/pending", { cache:"no-store" })).json();
    $("pending").innerHTML = list.map((p) =>
      '<div class="post"><div class="t">' + esc(p.text) + "<small>" + esc(p.channel) + (p.special ? " · ⭐ מיוחדת" : "") + "</small></div>" +
      '<button class="light ok" data-id="' + p.id + '" title="לאשר" style="padding:6px 10px">✅</button>' +
      '<button class="danger no" data-id="' + p.id + '" title="למחוק">🗑</button></div>').join("") || '<p class="hint">אין</p>';
    document.querySelectorAll("#pending .ok").forEach((b) => b.onclick = async () => {
      try { await post("/api/approve", { id: Number(b.dataset.id) }); b.closest(".post").remove(); toast("אושר ✅"); } catch (e) { toast(e.message); }
    });
    document.querySelectorAll("#pending .no").forEach((b) => b.onclick = async () => {
      try { await post("/api/discard", { id: Number(b.dataset.id) }); b.closest(".post").remove(); toast("נמחק"); } catch (e) { toast(e.message); }
    });
  } catch { }
}

async function load() {
  try {
    const r = await fetch("/api/state", { cache:"no-store" });
    if (!r.ok) throw new Error();
    S = await r.json(); render();
  } catch { $("sub").textContent = "הבוט לא עונה כרגע (אולי באמצע הפעלה מחדש)"; }
}
load();
setInterval(() => { if (!editing || (S && (S.linking || S.pairingCode))) load(); }, 4000);
setInterval(loadQueue, 30000);
setInterval(() => { if (S && S.pendingTotal) loadPending(); }, 30000);
</script>
</body>
</html>`;
