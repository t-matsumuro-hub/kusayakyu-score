/* IndexedDB の薄いラッパ。
   localStorage は上限 5MB で年100試合×数年に耐えないため IndexedDB を使う。 */

const DB_NAME = 'bbscore';
const DB_VER = 2;

export const STORE_PLAYERS = 'players';
export const STORE_GAMES = 'games';
export const STORE_META = 'meta';
/** 個人成績モードで入力した1試合ぶんの記録 */
export const STORE_PERSONAL = 'personal';

let _dbPromise = null;

export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PLAYERS)) {
        db.createObjectStore(STORE_PLAYERS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_GAMES)) {
        const s = db.createObjectStore(STORE_GAMES, { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'k' });
      }
      if (!db.objectStoreNames.contains(STORE_PERSONAL)) {
        const s = db.createObjectStore(STORE_PERSONAL, { keyPath: 'id' });
        s.createIndex('playerId', 'playerId');
        s.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('データベースが他のタブでロックされています'));
  });
  return _dbPromise;
}

function tx(store, mode) {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbGet(store, key) {
  return wrap((await tx(store, 'readonly')).get(key));
}

export async function dbGetAll(store) {
  return wrap((await tx(store, 'readonly')).getAll());
}

export async function dbPut(store, value) {
  const s = await tx(store, 'readwrite');
  await wrap(s.put(value));
  return value;
}

export async function dbDelete(store, key) {
  return wrap((await tx(store, 'readwrite')).delete(key));
}

export async function dbClear(store) {
  return wrap((await tx(store, 'readwrite')).clear());
}

/** 複数レコードを1トランザクションで書き込む（復元・インポート用） */
export async function dbBulkPut(store, values) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(v);
    t.oncomplete = () => resolve(values.length);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** 一意な ID。時刻順に並ぶよう先頭にタイムスタンプを置く。 */
export function uid(prefix = '') {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}${t}${r}`;
}

/** iOS でのデータ消失を減らすため永続化を要求する（拒否されても動作は継続） */
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return { supported: false, persisted: false };
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const persisted = already || await navigator.storage.persist();
    return { supported: true, persisted };
  } catch {
    return { supported: false, persisted: false };
  }
}

export async function storageEstimate() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
