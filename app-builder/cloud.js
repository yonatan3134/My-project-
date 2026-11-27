// Accounts and cloud saving through Supabase.
// Projects always live in the browser first; when signed in, changes are also sent to the cloud.
/* global supabase */
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const ERRORS = {
  invalid_credentials: 'המייל או הסיסמה לא נכונים',
  email_not_confirmed: 'צריך קודם לאשר את המייל. חפש אצלך בתיבת הדואר מייל מ-Supabase',
  user_already_exists: 'כבר יש חשבון עם המייל הזה. נסה להתחבר',
  email_exists: 'כבר יש חשבון עם המייל הזה. נסה להתחבר',
  weak_password: 'הסיסמה חלשה מדי. צריך לפחות 6 תווים',
  same_password: 'הסיסמה החדשה זהה לישנה',
  over_email_send_rate_limit: 'נשלחו יותר מדי מיילים. נסה שוב עוד כמה דקות',
  over_request_rate_limit: 'יותר מדי ניסיונות. נסה שוב עוד כמה דקות',
  email_address_invalid: 'כתובת המייל לא תקינה',
  validation_failed: 'כתובת המייל או הסיסמה לא תקינות',
  signup_disabled: 'ההרשמה סגורה כרגע',
};

export function errorText(err) {
  if (!err) return '';
  if (ERRORS[err.code]) return ERRORS[err.code];
  if (/fetch|network/i.test(err.message || '')) return 'אין חיבור לאינטרנט. נסה שוב';
  return 'משהו השתבש: ' + (err.message || err);
}

const toRow = (p, owner) => ({
  id: p.id, owner, name: p.name, mode: p.mode, blocks: p.blocks ?? null, html: p.html || '',
  messages: p.messages || [], updated_at: new Date(p.updated || Date.now()).toISOString(),
});
const fromRow = (r) => ({
  id: r.id, name: r.name, mode: r.mode, blocks: r.blocks, html: r.html, messages: r.messages || [],
  updated: Date.parse(r.updated_at),
});

export function createCloud({ onStatus = () => {} } = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY || typeof supabase === 'undefined') return null;
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const pending = new Map();
  let timer = null;
  let user = null;

  const redirectTo = () => location.origin + location.pathname;

  async function flush() {
    clearTimeout(timer);
    if (!user || !pending.size) return;
    const batch = [...pending.values()];
    pending.clear();
    onStatus('saving');
    const { error } = await client.from('projects').upsert(batch.map(p => toRow(p, user.id)), { onConflict: 'owner,id' });
    if (error) {
      // Keep the newest copy queued and try again later.
      for (const p of batch) if (!pending.has(p.id)) pending.set(p.id, p);
      onStatus('error', errorText(error));
      timer = setTimeout(flush, 15000);
    } else {
      batch.forEach(p => { p.synced = true; });
      if (!pending.size) onStatus('saved');
    }
  }

  window.addEventListener('online', () => flush());

  return {
    client,
    get user() { return user; },
    setUser(u) { user = u; pending.clear(); },

    async session() {
      const { data } = await client.auth.getSession();
      return data.session?.user ?? null;
    },
    onAuth(cb) {
      // Supabase asks not to await its own calls inside this callback, so hand off to the next tick.
      client.auth.onAuthStateChange((event, session) => setTimeout(() => cb(event, session?.user ?? null), 0));
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return error;
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } });
      if (error) return { error };
      // With email confirmation on, an already-registered address comes back with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { error: { code: 'user_already_exists' } };
      }
      return { needsConfirm: !data.session };
    },
    async signOut() {
      await flush();
      const { error } = await client.auth.signOut();
      return error;
    },
    async resetPassword(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
      return error;
    },
    async newPassword(password) {
      const { error } = await client.auth.updateUser({ password });
      return error;
    },

    async list() {
      const { data, error } = await client.from('projects').select('*').order('updated_at', { ascending: false });
      if (error) throw error;
      return data.map(fromRow);
    },
    queue(p) {
      if (!user) return;
      pending.set(p.id, p);
      onStatus('pending');
      clearTimeout(timer);
      timer = setTimeout(flush, 1500);
    },
    async upload(list) {
      if (!user || !list.length) return null;
      const { error } = await client.from('projects').upsert(list.map(p => toRow(p, user.id)), { onConflict: 'owner,id' });
      return error;
    },
    async remove(id) {
      pending.delete(id);
      if (!user) return;
      const { error } = await client.from('projects').delete().eq('id', id).eq('owner', user.id);
      if (error) onStatus('error', errorText(error));
    },
    flush,
  };
}
