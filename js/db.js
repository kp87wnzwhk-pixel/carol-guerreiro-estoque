/**
 * IndexedDB para fotos por boxId — nunca compartilha entre caixas.
 */

const DB_NAME = 'cgi_photos_v1';
const DB_VERSION = 1;
const STORE = 'photos';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('boxId', 'boxId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('abort'));
  });
}

export async function addPhoto(boxId, blob, meta = {}) {
  const db = await openDB();
  const id = crypto.randomUUID();
  const record = {
    id,
    boxId: String(boxId),
    blob,
    mime: blob.type || 'image/jpeg',
    createdAt: new Date().toISOString(),
    ...meta,
  };
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(record);
  await txDone(tx);
  db.close();
  return id;
}

export async function listPhotosForBox(boxId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('boxId');
    const req = idx.getAll(String(boxId));
    req.onsuccess = () => {
      const rows = (req.result || []).sort((a, b) =>
        String(a.createdAt).localeCompare(String(b.createdAt))
      );
      db.close();
      resolve(rows);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function deletePhoto(photoId) {
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(photoId);
  await txDone(tx);
  db.close();
}

export async function deleteAllPhotosForBox(boxId) {
  const photos = await listPhotosForBox(boxId);
  const db = await openDB();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const p of photos) store.delete(p.id);
  await txDone(tx);
  db.close();
}

export function photoObjectURL(record) {
  return URL.createObjectURL(record.blob);
}
