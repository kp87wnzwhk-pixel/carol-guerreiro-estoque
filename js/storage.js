/**
 * Persistência de caixas em localStorage + auto-backup.
 * Nunca limpa dados no reload; restore exige confirmação.
 */

const BOXES_KEY = 'cgi_boxes_v1';
const BACKUPS_KEY = 'cgi_auto_backups_v1';
const MAX_BACKUPS = 15;
const DELETED_KEY = 'cgi_estoque_deleted_v1';

/** Seed único: Graziely */
const SEED_BOX = {
  id: 'seed-graziely-1',
  name: 'Graziely Ferreira',
  phone: '(21) 97180-6776',
  phoneDigits: '21971806776',
  shelf: 1,
  slot: 1,
  notes: '',
  deliveryRequested: false,
  registeredViaPhoto: true,
  createdAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
};

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** Formata para (21) 99999-0000 ou (21) 9999-0000 */
export function formatPhoneBR(raw) {
  let d = normalizePhoneDigits(raw);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function phoneDigits(phone) {
  let d = normalizePhoneDigits(phone);
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  return d;
}

export function loadBoxes() {
  try {
    const raw = localStorage.getItem(BOXES_KEY);
    if (raw === null) {
      const seed = [structuredClone(SEED_BOX)];
      localStorage.setItem(BOXES_KEY, JSON.stringify(seed));
      pushAutoBackup(seed, 'seed');
      return seed;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [structuredClone(SEED_BOX)];
    return parsed;
  } catch {
    return [structuredClone(SEED_BOX)];
  }
}

export function saveBoxes(boxes) {
  localStorage.setItem(BOXES_KEY, JSON.stringify(boxes));
  pushAutoBackup(boxes, 'save');
}

function pushAutoBackup(boxes, reason) {
  try {
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem(BACKUPS_KEY) || '[]');
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    list.unshift({
      id: `bk-${Date.now()}`,
      at: new Date().toISOString(),
      reason: reason || 'save',
      count: boxes.length,
      data: boxes,
    });
    if (list.length > MAX_BACKUPS) list = list.slice(0, MAX_BACKUPS);
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Auto-backup falhou (quota?)', e);
  }
}

export function listAutoBackups() {
  try {
    const list = JSON.parse(localStorage.getItem(BACKUPS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Restore só com confirmação explícita do chamador */
export function restoreFromBackup(backupId) {
  const list = listAutoBackups();
  const bk = list.find((b) => b.id === backupId);
  if (!bk || !Array.isArray(bk.data)) throw new Error('Backup não encontrado');
  localStorage.setItem(BOXES_KEY, JSON.stringify(bk.data));
  pushAutoBackup(bk.data, 'restore');
  return bk.data;
}

export function exportJSON(boxes) {
  return JSON.stringify(
    {
      app: 'carol-guerreiro-estoque',
      version: 1,
      exportedAt: new Date().toISOString(),
      boxes,
    },
    null,
    2
  );
}

export function importJSON(text) {
  const data = JSON.parse(text);
  let boxes;
  if (Array.isArray(data)) boxes = data;
  else if (data && Array.isArray(data.boxes)) boxes = data.boxes;
  else throw new Error('JSON inválido: esperado array ou { boxes: [] }');

  boxes = boxes.map((b) => normalizeBox(b));
  return boxes;
}

export function normalizeBox(b) {
  const phone = formatPhoneBR(b.phone || '');
  return {
    id: b.id || crypto.randomUUID(),
    name: String(b.name || '').trim(),
    phone,
    phoneDigits: phoneDigits(phone),
    shelf: Number(b.shelf) || 1,
    slot: Number(b.slot) || 1,
    notes: String(b.notes || ''),
    deliveryRequested: Boolean(b.deliveryRequested),
    registeredViaPhoto: Boolean(b.registeredViaPhoto),
    createdAt: b.createdAt || new Date().toISOString(),
    updatedAt: b.updatedAt || new Date().toISOString(),
  };
}

export function findByPhone(boxes, phone) {
  const d = phoneDigits(phone);
  if (!d) return null;
  return boxes.find((b) => b.phoneDigits === d) || null;
}

export function findDuplicatePhone(boxes, phone, excludeId = null) {
  const d = phoneDigits(phone);
  if (!d) return null;
  return boxes.find((b) => b.phoneDigits === d && b.id !== excludeId) || null;
}

export function boxesOnShelf(boxes, shelf) {
  return boxes.filter((b) => b.shelf === shelf);
}

export function boxAt(boxes, shelf, slot) {
  return boxes.find((b) => b.shelf === shelf && b.slot === slot) || null;
}

export function firstFreeSlot(boxes, shelf, maxSlots = 25) {
  const used = new Set(boxes.filter((b) => b.shelf === shelf).map((b) => b.slot));
  for (let s = 1; s <= maxSlots; s++) {
    if (!used.has(s)) return s;
  }
  return null;
}

export function shelfOccupancy(boxes, shelf) {
  return boxes.filter((b) => b.shelf === shelf).length;
}

export function shelfHasDelivery(boxes, shelf) {
  return boxes.some((b) => b.shelf === shelf && b.deliveryRequested);
}

export function firstClientOnShelf(boxes, shelf) {
  const list = boxes
    .filter((b) => b.shelf === shelf)
    .sort((a, b) => a.slot - b.slot);
  return list[0] || null;
}

/** Busca natural: nome, telefone, “caixa do José” etc. */
export function searchBoxes(boxes, query) {
  let q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  q = q
    .replace(/^caixa\s+(do|da|de|dos|das)\s+/i, '')
    .replace(/^caixa\s+/i, '')
    .replace(/^do\s+/i, '')
    .replace(/^da\s+/i, '')
    .trim();

  const digits = phoneDigits(q);
  const results = [];

  for (const b of boxes) {
    const nameL = (b.name || '').toLowerCase();
    let score = 0;
    if (digits && digits.length >= 4 && b.phoneDigits.includes(digits)) score += 10;
    if (nameL.includes(q)) score += 5;
    if (q && nameL.split(/\s+/).some((w) => w.startsWith(q))) score += 3;
    if (score > 0) results.push({ box: b, score });
  }

  results.sort((a, b) => b.score - a.score || a.box.name.localeCompare(b.box.name, 'pt-BR'));
  return results.map((r) => r.box);
}

export function toCSV(boxes) {
  const headers = [
    'id',
    'nome',
    'telefone',
    'prateleira',
    'slot',
    'notas',
    'entregaSolicitada',
    'viaFoto',
    'criadoEm',
    'atualizadoEm',
  ];
  const esc = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = boxes.map((b) =>
    [
      b.id,
      b.name,
      b.phone,
      b.shelf,
      b.slot,
      b.notes,
      b.deliveryRequested ? 'sim' : 'nao',
      b.registeredViaPhoto ? 'sim' : 'nao',
      b.createdAt,
      b.updatedAt,
    ]
      .map(esc)
      .join(',')
  );
  return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
}

export function corridorOf(shelf) {
  if (shelf >= 1 && shelf <= 8) return 'A';
  if (shelf >= 9 && shelf <= 16) return 'B';
  if (shelf >= 17 && shelf <= 24) return 'C';
  if (shelf >= 25 && shelf <= 32) return 'D';
  return '?';
}

export function shelvesInCorridor(c) {
  if (c === 'A') return range(1, 8);
  if (c === 'B') return range(9, 16);
  if (c === 'C') return range(17, 24);
  if (c === 'D') return range(25, 32);
  return range(1, 32);
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export { SEED_BOX, BOXES_KEY };

export function getDeletedIds() {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

export function isTombstoned(id) {
  if (!id) return false;
  return getDeletedIds().includes(String(id));
}

export function addTombstone(id) {
  if (!id) return;
  const set = new Set(getDeletedIds());
  set.add(String(id));
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...set]));
  } catch (e) {
    console.warn('tombstone save failed', e);
  }
}

export function absorbTombstoneIds(ids) {
  if (!ids || !ids.length) return;
  const set = new Set(getDeletedIds());
  for (const id of ids) set.add(String(id));
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...set]));
  } catch (_) {}
}

export function purgeTombstoned(boxes) {
  const del = new Set(getDeletedIds());
  if (!del.size) return boxes || [];
  return (boxes || []).filter((b) => b && !del.has(String(b.id)));
}
