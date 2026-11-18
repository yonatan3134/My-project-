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
  .ch .top { display:flex; gap:8px; align-items:center; }
  .ch .top input[type=text] { flex:1; }
  .ch details { margin-top:6px; } .ch summary { cursor:pointer; color:var(--muted); font-size:14px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; } @media (max-width:600px) { .grid2 { grid-template-columns:1fr; } }
  #toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#1f1b2e; color:#fff; padding:12px 18px; border-radius:12px; display:none; z-index:9; }
  ul.events { margin:0; padding:0 18px 0 0; color:var(--muted); font-size:14px; }
  .ltr { direction:ltr; text-align:left; }
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
      <label>מפתח Pexels לרקעים <span id="pexelsState"></span></label><input id="pexelsKey" type="password" class="ltr" placeholder="להשאיר ריק כדי לא לשנות" autocomplete="off">
    </details>
    <div class="row" style="margin-top:14px"><button id="saveSettings">שמירה</button><span class="hint">אחרי שמירה הבוט מופעל מחדש (כ-10 שניות)</span></div>
  </section>

  <section class="card">
    <h2>📢 ערוצים</h2>
    <p class="hint">הבוט חייב להיות מנהל בכל ערוץ. הסדר כאן הוא הסדר שבו ערוצים נכנסים לפעולה בהתחלה ההדרגתית.</p>
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
    ["קריאות AI היום", s.usage.calls],
  ].map(([t, v]) => '<div class="stat"><b>' + esc(v) + "</b><span>" + t + "</span></div>").join("");
  $("pauseBtn").textContent = s.paused ? "▶️ להחזיר את הפרסומים" : "⏸ לעצור את כל הפרסומים";
  $("events").innerHTML = s.problems.map((p) => "<li>" + esc(p) + "</li>").join("");
  $("keyState").innerHTML = s.hasKey ? pill(true, "שמור") : pill(false, "חסר");
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
    renderChannels(s.channels);
  }
}

function renderChannels(list) {
  $("channels").innerHTML = list.map((c, i) => {
    let status = "";
    if (c.mode !== "off" && c.enabled) {
      if (c.role === "OWNER" || c.role === "ADMIN") status = '<span class="pill ok">✓ מנהל</span>';
      else if (c.role) status = '<span class="pill bad">לא מנהל</span>';
      else if (S.connection === "open") status = '<span class="pill warn">לא נבדק</span>';
    }
    const opts = Object.entries(MODES).map(([k, v]) => '<option value="' + k + '"' + (k === c.mode ? " selected" : "") + ">" + v + "</option>").join("");
    return '<div class="ch" data-i="' + i + '" data-id="' + esc(c.id || "") + '">' +
      '<div class="top"><input type="checkbox" class="en"' + (c.enabled ? " checked" : "") + ' title="פעיל" style="width:auto">' +
      '<input type="text" class="name" value="' + esc(c.name) + '" placeholder="שם הערוץ">' + status +
      (c.sentToday ? '<span class="hint">' + c.sentToday + " היום</span>" : "") +
      '<button class="danger del" title="מחיקה">✕</button></div>' +
      '<details' + (c.id ? "" : " open") + '><summary>פרטים</summary>' +
      '<label>קישור לערוץ</label><input class="invite ltr" value="' + esc(c.invite ? "https://whatsapp.com/channel/" + c.invite : "") + '" placeholder="https://whatsapp.com/channel/...">' +
      '<label>סוג</label><select class="mode">' + opts + "</select>" +
      '<label>על מה הערוץ (ה-AI כותב לפי זה)</label><textarea class="topic">' + esc(c.topic) + "</textarea>" +
      '<label>מילות חיפוש לחדשות, מופרדות בפסיק</label><input class="queries" value="' + esc((c.queries || []).join(", ")) + '">' +
      "</details></div>";
  }).join("");
  document.querySelectorAll(".ch .del").forEach((b) => b.onclick = () => {
    if (!confirm("למחוק את הערוץ מהבוט? (הערוץ עצמו בוואטסאפ לא נמחק)")) return;
    editing = true; b.closest(".ch").remove();
  });
  document.querySelectorAll(".ch input, .ch select, .ch textarea").forEach((el) => el.addEventListener("input", () => editing = true));
}

function collectChannels() {
  return [...document.querySelectorAll(".ch")].map((el) => ({
    id: el.dataset.id || null,
    name: el.querySelector(".name").value.trim(),
    invite: el.querySelector(".invite").value.trim(),
    mode: el.querySelector(".mode").value,
    topic: el.querySelector(".topic").value.trim(),
    queries: el.querySelector(".queries").value.split(",").map((q) => q.trim()).filter(Boolean),
    enabled: el.querySelector(".en").checked,
  }));
}

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
  try { await post("/api/settings", body); $("geminiKey").value = ""; $("pexelsKey").value = ""; waitRestart("נשמר."); } catch (e) { toast(e.message); }
};
["botPhone", "ownerPhone", "ntfyTopic"].forEach((id) => $(id).addEventListener("input", () => editing = true));
$("pauseBtn").onclick = async () => { try { await post("/api/pause", { paused: !S.paused }); load(); } catch (e) { toast(e.message); } };

async function load() {
  try {
    const r = await fetch("/api/state", { cache:"no-store" });
    if (!r.ok) throw new Error();
    S = await r.json(); render();
  } catch { $("sub").textContent = "הבוט לא עונה כרגע (אולי באמצע הפעלה מחדש)"; }
}
load();
setInterval(() => { if (!editing || (S && (S.linking || S.pairingCode))) load(); }, 4000);
</script>
</body>
</html>`;
