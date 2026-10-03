// Stockage local (IndexedDB). Les fichiers audio ne quittent jamais l'appareil.
const DB_NAME = 'sillon';
const DB_VERSION = 1;

let dbPromise;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('tracks', { keyPath: 'id' }); // métadonnées
      db.createObjectStore('files');                     // id -> Blob audio
      db.createObjectStore('covers');                    // coverId -> Blob image
      db.createObjectStore('playlists', { keyPath: 'id' });
      db.createObjectStore('settings');                  // clé -> valeur
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(stores, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const out = fn(tx);
    tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const get = (store, key) => run(store, 'readonly', tx => tx.objectStore(store).get(key));
export const getAll = store => run(store, 'readonly', tx => tx.objectStore(store).getAll());
export const put = (store, value, key) => run(store, 'readwrite', tx => tx.objectStore(store).put(value, key));
export const del = (store, key) => run(store, 'readwrite', tx => tx.objectStore(store).delete(key));

export function entries(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(store).objectStore(store).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  }));
}

export function addTrack(track, file, cover) {
  return run(['tracks', 'files', 'covers'], 'readwrite', tx => {
    tx.objectStore('tracks').put(track);
    tx.objectStore('files').put(file, track.id);
    if (cover) tx.objectStore('covers').put(cover, track.coverId);
  });
}

export function removeTrack(id) {
  return run(['tracks', 'files'], 'readwrite', tx => {
    tx.objectStore('tracks').delete(id);
    tx.objectStore('files').delete(id);
  });
}
