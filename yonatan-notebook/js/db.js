// Minimal IndexedDB wrapper — all data stays on the phone.
const DB_NAME = 'yonatan-notebook';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    let r; try { r = indexedDB.open(DB_NAME, DB_VER); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('sheets')) db.createObjectStore('sheets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('shots')) {
        const s = db.createObjectStore('shots', { keyPath: 'id' });
        s.createIndex('sheetId', 'sheetId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

// fallback when the browser blocks IndexedDB: keep data in memory (+ localStorage for settings)
const mem = { sheets: new Map(), shots: new Map(), kv: new Map() };
let memMode = false;
try { for (const k of Object.keys(localStorage)) if (k.startsWith('yn:')) mem.kv.set(k.slice(3), JSON.parse(localStorage.getItem(k))); } catch { }
const memDb = {
  put: async (store, val, key) => { const k = key ?? val.id; mem[store].set(k, val); if (store === 'kv') try { localStorage.setItem('yn:' + k, JSON.stringify(val)); } catch { } return k; },
  get: async (store, key) => mem[store].get(key),
  del: async (store, key) => { mem[store].delete(key); if (store === 'kv') try { localStorage.removeItem('yn:' + key); } catch { } },
  all: async store => [...mem[store].values()],
  byIndex: async (store, idx, val) => [...mem[store].values()].filter(v => v[idx] === val),
  clear: async store => mem[store].clear(),
};
function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const idb = {
  put: (store, val, key) => tx(store, 'readwrite', s => req(key === undefined ? s.put(val) : s.put(val, key))),
  get: (store, key) => tx(store, 'readonly', s => req(s.get(key))),
  del: (store, key) => tx(store, 'readwrite', s => req(s.delete(key))),
  all: (store) => tx(store, 'readonly', s => req(s.getAll())),
  byIndex: (store, idx, val) => tx(store, 'readonly', s => req(s.index(idx).getAll(val))),
  clear: (store) => tx(store, 'readwrite', s => req(s.clear())),
};
const wrap = name => async (...a) => {
  if (!memMode) { try { return await idb[name](...a); } catch (e) { memMode = true; console.warn('IndexedDB unavailable, using memory', e); } }
  return memDb[name](...a);
};
export const db = Object.fromEntries(Object.keys(idb).map(k => [k, wrap(k)]));

export async function getSetting(k, def) {
  const v = await db.get('kv', k);
  return v === undefined ? def : v;
}
export const setSetting = (k, v) => db.put('kv', v, k);

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
