/**
 * Sync Firestore para caixas de prateleira (metadados).
 * Fotos continuam no IndexedDB local.
 */
import {
  SYNC_ENABLED,
  firebaseConfig,
  FIRESTORE_COLLECTION,
  FIRESTORE_EXCLUIDOS,
} from './firebase-config.js';
import { normalizeBox } from './storage.js';

let app = null;
let db = null;
let ready = false;
let initError = null;
let bootTried = false;

function configLooksFilled() {
  const c = firebaseConfig;
  if (!c || !c.apiKey || c.apiKey === 'YOUR_API_KEY') return false;
  if (!c.projectId || c.projectId === 'YOUR_PROJECT_ID') return false;
  return true;
}

export function isSyncActive() {
  return SYNC_ENABLED && configLooksFilled() && ready;
}

export function getSyncStatus() {
  if (!SYNC_ENABLED) return { mode: 'local', message: 'Modo local (um aparelho)' };
  if (!configLooksFilled()) {
    return { mode: 'local', message: 'Sync ligado, mas firebase-config incompleto' };
  }
  if (ready) return { mode: 'sync', message: 'Nuvem ativa — prateleiras sincronizadas' };
  if (initError) {
    const msg = String(initError.message || initError);
    if (msg === 'TIMEOUT' || initError.code === 'TIMEOUT') {
      return { mode: 'error', message: 'Nuvem lenta — dados salvos neste aparelho' };
    }
    return { mode: 'error', message: 'Nuvem offline — ' + msg.slice(0, 80) };
  }
  if (!bootTried) return { mode: 'loading', message: 'Conectando nuvem…' };
  return { mode: 'error', message: 'Nuvem offline — dados salvos neste aparelho' };
}

export function markSyncBootTried() {
  bootTried = true;
}

export function markSyncError(err) {
  bootTried = true;
  ready = false;
  initError = err instanceof Error ? err : new Error(String(err || 'falha'));
}

export async function initSync() {
  bootTried = true;
  if (!SYNC_ENABLED || !configLooksFilled()) {
    ready = false;
    return false;
  }
  try {
    const { initializeApp, getApp, getApps } = await import(
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'
    );
    const { getFirestore } = await import(
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
    );
    const NAME = 'carol-estoque';
    try {
      app = getApp(NAME);
    } catch (_) {
      app = initializeApp(firebaseConfig, NAME);
    }
    db = getFirestore(app);
    ready = true;
    initError = null;
    return true;
  } catch (err) {
    ready = false;
    initError = err;
    console.warn('Firebase init falhou:', err);
    return false;
  }
}

export async function syncUpsertBox(box) {
  if (!isSyncActive() || !box || !box.id) return { ok: false };
  const { doc, setDoc, getDoc } = await import(
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
  );
  try {
    const ex = await getDoc(doc(db, FIRESTORE_EXCLUIDOS, box.id));
    if (ex.exists()) return { ok: false, reason: 'tombstoned' };
  } catch (err) {
    console.warn('syncUpsertBox excluidos:', err);
  }
  const payload = { ...normalizeBox(box) };
  await setDoc(doc(db, FIRESTORE_COLLECTION, box.id), payload, { merge: true });
  return { ok: true };
}

export async function syncDeleteBox(id) {
  if (!isSyncActive() || !id) return;
  const { doc, deleteDoc } = await import(
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
  );
  await deleteDoc(doc(db, FIRESTORE_COLLECTION, id));
}

export async function syncMarkExcluded(id) {
  if (!isSyncActive() || !id) return;
  const { doc, setDoc } = await import(
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
  );
  await setDoc(
    doc(db, FIRESTORE_EXCLUIDOS, String(id)),
    { deletedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function syncPullExcludedIds() {
  if (!isSyncActive()) return [];
  const { collection, getDocs } = await import(
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
  );
  const snap = await getDocs(collection(db, FIRESTORE_EXCLUIDOS));
  const ids = [];
  snap.forEach((d) => ids.push(d.id));
  return ids;
}

export async function syncPullAll() {
  if (!isSyncActive()) return [];
  const { collection, getDocs } = await import(
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
  );
  const snap = await getDocs(collection(db, FIRESTORE_COLLECTION));
  const out = [];
  snap.forEach((d) => {
    const n = normalizeBox({ id: d.id, ...d.data() });
    if (n) out.push(n);
  });
  return out;
}

export function subscribeBoxes(onChange) {
  if (!isSyncActive()) return () => {};
  let unsub = () => {};
  (async () => {
    try {
      const { collection, onSnapshot } = await import(
        'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
      );
      unsub = onSnapshot(
        collection(db, FIRESTORE_COLLECTION),
        (snap) => {
          const out = [];
          snap.forEach((d) => {
            const n = normalizeBox({ id: d.id, ...d.data() });
            if (n) out.push(n);
          });
          onChange(out);
        },
        (err) => console.warn('subscribeBoxes:', err)
      );
    } catch (err) {
      console.warn('subscribeBoxes init:', err);
    }
  })();
  return () => {
    try {
      unsub();
    } catch (_) {}
  };
}

export function subscribeExcluded(onChange) {
  if (!isSyncActive()) return () => {};
  let unsub = () => {};
  (async () => {
    try {
      const { collection, onSnapshot } = await import(
        'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'
      );
      unsub = onSnapshot(
        collection(db, FIRESTORE_EXCLUIDOS),
        (snap) => {
          const ids = [];
          snap.forEach((d) => ids.push(d.id));
          onChange(ids);
        },
        (err) => console.warn('subscribeExcluded:', err)
      );
    } catch (err) {
      console.warn('subscribeExcluded init:', err);
    }
  })();
  return () => {
    try {
      unsub();
    } catch (_) {}
  };
}
