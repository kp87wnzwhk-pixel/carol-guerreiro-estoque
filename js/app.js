/**
 * Carol Guerreiro Importado — SPA de estoque (mobile-first)
 */
import {
  loadBoxes,
  saveBoxes,
  formatPhoneBR,
  phoneDigits,
  findByPhone,
  findDuplicatePhone,
  boxAt,
  firstFreeSlot,
  shelfOccupancy,
  shelfHasDelivery,
  firstClientOnShelf,
  searchBoxes,
  exportJSON,
  importJSON,
  toCSV,
  listAutoBackups,
  restoreFromBackup,
  normalizeBox,
  corridorOf,
  shelvesInCorridor,
  getDeletedIds,
  isTombstoned,
  addTombstone,
  absorbTombstoneIds,
  purgeTombstoned,
} from './storage.js';
import {
  addPhoto,
  listPhotosForBox,
  deletePhoto,
  deleteAllPhotosForBox,
  photoObjectURL,
} from './db.js';
import { recognizeLabel } from './ocr.js';
import {
  initSync,
  isSyncActive,
  getSyncStatus,
  syncUpsertBox,
  syncDeleteBox,
  syncMarkExcluded,
  syncPullAll,
  syncPullExcludedIds,
  subscribeBoxes,
  subscribeExcluded,
  markSyncBootTried,
  markSyncError,
} from './sync.js';

const TOTAL_SHELVES = 32;
const SLOTS_PER_SHELF = 20;

let boxes = [];
let corridorFilter = 'all';
let panelStack = []; // { title, render }
let objectUrls = [];

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function revokeUrls() {
  for (const u of objectUrls) {
    try { URL.revokeObjectURL(u); } catch (_) {}
  }
  objectUrls = [];
}

function trackUrl(u) {
  objectUrls.push(u);
  return u;
}

function persist() {
  boxes = purgeTombstoned(boxes);
  saveBoxes(boxes);
  renderMap();
  updateSyncBadge();
  // nuvem em background (não bloqueia UI)
  if (isSyncActive()) {
    Promise.all(
      boxes.filter((b) => b && b.id && !isTombstoned(b.id)).map((b) =>
        syncUpsertBox(b).catch((e) => console.warn('upsert', e))
      )
    ).catch(() => {});
  }
}

function updateSyncBadge() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const st = getSyncStatus();
  el.textContent = st.message;
  el.dataset.mode = st.mode;
  el.className = 'sync-status sync-' + st.mode;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error('TIMEOUT');
      err.code = 'TIMEOUT';
      reject(err);
    }, ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function mergeBoxes(local, remote, deletedSet) {
  const map = new Map();
  for (const b of local || []) {
    if (!b || !b.id || deletedSet.has(String(b.id))) continue;
    map.set(String(b.id), normalizeBox(b));
  }
  for (const b of remote || []) {
    if (!b || !b.id || deletedSet.has(String(b.id))) continue;
    const id = String(b.id);
    const n = normalizeBox(b);
    const cur = map.get(id);
    if (!cur) {
      map.set(id, n);
      continue;
    }
    const tu = Date.parse(cur.updatedAt || 0) || 0;
    const ru = Date.parse(n.updatedAt || 0) || 0;
    map.set(id, ru >= tu ? n : cur);
  }
  return [...map.values()];
}

async function pullAndMergeCloud() {
  if (!isSyncActive()) return;
  const excluded = await syncPullExcludedIds();
  absorbTombstoneIds(excluded);
  const deletedSet = new Set(getDeletedIds());
  const remote = await syncPullAll();
  // Nunca substituir local por remoto vazio se já temos dados
  if ((!remote || remote.length === 0) && boxes.length > 0) {
    // sobe locais que ainda não estão na nuvem
    for (const b of boxes) {
      if (b && b.id && !deletedSet.has(String(b.id))) {
        try { await syncUpsertBox(b); } catch (_) {}
      }
    }
    return;
  }
  boxes = mergeBoxes(boxes, remote, deletedSet);
  boxes = purgeTombstoned(boxes);
  saveBoxes(boxes);
  renderMap();
  updateSyncBadge();
}

function startRealtimeSync() {
  if (!isSyncActive()) return;
  subscribeExcluded((ids) => {
    absorbTombstoneIds(ids);
    const before = boxes.length;
    boxes = purgeTombstoned(boxes);
    if (boxes.length !== before) {
      saveBoxes(boxes);
      renderMap();
    }
  });
  subscribeBoxes((remote) => {
    const deletedSet = new Set(getDeletedIds());
    if ((!remote || remote.length === 0) && boxes.length > 0) return;
    boxes = mergeBoxes(boxes, remote, deletedSet);
    boxes = purgeTombstoned(boxes);
    saveBoxes(boxes);
    renderMap();
    updateSyncBadge();
  });
}

async function removeBoxEverywhere(box) {
  addTombstone(box.id);
  boxes = boxes.filter((b) => b.id !== box.id);
  saveBoxes(boxes);
  renderMap();
  updateSyncBadge();
  try {
    if (isSyncActive()) {
      await syncMarkExcluded(box.id);
      await syncDeleteBox(box.id);
    }
  } catch (e) {
    console.warn('cloud delete:', e);
  }
}

function getBox(id) {
  return boxes.find((b) => b.id === id) || null;
}

function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function alertMsg(msg) {
  window.alert(msg);
}

function confirmMsg(msg) {
  return window.confirm(msg);
}

function whatsappUrl(box) {
  const digits = phoneDigits(box.phone);
  const text = encodeURIComponent(
    'Olá ' + box.name + ', aqui é da Carol Guerreiro Importado.'
  );
  return 'https://wa.me/55' + digits + '?text=' + text;
}

function bindPhoneMask(input) {
  input.addEventListener('input', () => {
    const start = input.selectionStart;
    const before = input.value;
    input.value = formatPhoneBR(input.value);
    // keep caret near end for simplicity on mobile
    if (document.activeElement === input) {
      const pos = input.value.length;
      try { input.setSelectionRange(pos, pos); } catch (_) {}
    }
  });
}

/* ---------- Panel (bottom sheet) ---------- */
function openPanel(title, renderFn) {
  panelStack.push({ title, render: renderFn });
  showTopPanel();
}

function replacePanel(title, renderFn) {
  if (panelStack.length) panelStack.pop();
  panelStack.push({ title, render: renderFn });
  showTopPanel();
}

function closePanel() {
  panelStack.pop();
  revokeUrls();
  if (panelStack.length) showTopPanel();
  else hidePanel();
}

function closeAllPanels() {
  panelStack = [];
  revokeUrls();
  hidePanel();
}

function showTopPanel() {
  const host = $('#panel-host');
  const title = $('#panel-title');
  const body = $('#panel-body');
  const top = panelStack[panelStack.length - 1];
  title.textContent = top.title;
  revokeUrls();
  body.innerHTML = '';
  top.render(body);
  host.hidden = false;
  $('#panel-back').style.visibility = panelStack.length > 1 ? 'visible' : 'hidden';
  // Prevent body scroll jump
  document.body.style.overflow = 'hidden';
}

function hidePanel() {
  $('#panel-host').hidden = true;
  $('#panel-body').innerHTML = '';
  document.body.style.overflow = '';
}

/* ---------- Map ---------- */
function renderMap() {
  const root = $('#shelf-map');
  root.innerHTML = '';
  const shelves =
    corridorFilter === 'all' ? range(1, TOTAL_SHELVES) : shelvesInCorridor(corridorFilter);

  let lastCorr = null;
  for (const n of shelves) {
    const corr = corridorOf(n);
    if (corridorFilter === 'all' && corr !== lastCorr) {
      lastCorr = corr;
      const lab = document.createElement('div');
      lab.className = 'corridor-label';
      lab.textContent = 'Corredor ' + corr;
      root.appendChild(lab);
    }
    const occ = shelfOccupancy(boxes, n);
    const hasDel = shelfHasDelivery(boxes, n);
    const first = firstClientOnShelf(boxes, n);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shelf-card';
    btn.setAttribute('role', 'listitem');
    if (hasDel) btn.classList.add('delivery');
    else if (occ > 0) btn.classList.add('occupied');
    else btn.classList.add('empty');

    btn.innerHTML =
      '<span class="shelf-num">' + n + '</span>' +
      '<span class="shelf-occ">' + occ + '/' + SLOTS_PER_SHELF + '</span>' +
      (first
        ? '<span class="shelf-client">' + escapeHtml(first.name) + '</span>'
        : '<span class="shelf-client">vazia</span>');

    btn.addEventListener('click', () => openShelf(n));
    root.appendChild(btn);
  }
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- Shelf slots ---------- */
function openShelf(shelf) {
  openPanel('Prateleira ' + shelf, (body) => {
    const grid = document.createElement('div');
    grid.className = 'slots-grid';
    for (let slot = 1; slot <= SLOTS_PER_SHELF; slot++) {
      const box = boxAt(boxes, shelf, slot);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      if (box && box.deliveryRequested) btn.classList.add('delivery');
      else if (box) btn.classList.add('occupied');
      else btn.classList.add('empty');

      let nameBit = box ? escapeHtml(box.name.split(' ')[0]) : 'livre';
      btn.innerHTML =
        '<span class="slot-n">' + slot + '</span>' +
        '<span class="slot-name">' + nameBit + '</span>';

      btn.addEventListener('click', () => {
        if (box) openBoxDetail(box.id);
        else openRegisterForm({ shelf, slot });
      });
      grid.appendChild(btn);
    }
    body.appendChild(grid);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-primary btn-block';
    add.style.marginTop = '14px';
    add.textContent = 'Cadastrar nesta prateleira';
    add.addEventListener('click', () => {
      const free = firstFreeSlot(boxes, shelf);
      if (free == null) {
        alertMsg('Prateleira ' + shelf + ' está cheia (20/20).');
        return;
      }
      openRegisterForm({ shelf, slot: free });
    });
    body.appendChild(add);
  });
}

/* ---------- Register / Edit form ---------- */
function openRegisterForm(opts = {}) {
  const editing = opts.boxId ? getBox(opts.boxId) : null;
  const title = editing ? 'Editar caixa' : 'Cadastrar caixa';
  const openFn = opts.replace ? replacePanel : openPanel;

  openFn(title, (body) => {
    const wrap = document.createElement('div');
    wrap.className = 'detail-card';
    wrap.innerHTML = `
      <div class="form-row">
        <label for="f-name">Nome <span class="required">*</span></label>
        <input id="f-name" type="text" autocomplete="name" required />
      </div>
      <div class="form-row">
        <label for="f-phone">Telefone <span class="required">*</span></label>
        <input id="f-phone" type="tel" inputmode="tel" placeholder="(21) 99999-0000" required />
      </div>
      <div class="form-row">
        <label for="f-shelf">Prateleira (1–32) <span class="required">*</span></label>
        <select id="f-shelf"></select>
      </div>
      <div class="form-row">
        <label for="f-slot">Slot (1–20) <span class="required">*</span></label>
        <select id="f-slot"></select>
      </div>
      <div class="form-row">
        <label for="f-notes">Notas <span class="optional">(opcional)</span></label>
        <textarea id="f-notes" rows="3"></textarea>
      </div>
      <div id="f-alert"></div>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="f-save">Salvar</button>
    `;
    body.appendChild(wrap);

    const shelfSel = $('#f-shelf', wrap);
    const slotSel = $('#f-slot', wrap);
    for (let i = 1; i <= TOTAL_SHELVES; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = String(i) + ' (corredor ' + corridorOf(i) + ')';
      shelfSel.appendChild(o);
    }
    for (let i = 1; i <= SLOTS_PER_SHELF; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = String(i);
      slotSel.appendChild(o);
    }

    const nameIn = $('#f-name', wrap);
    const phoneIn = $('#f-phone', wrap);
    const notesIn = $('#f-notes', wrap);
    bindPhoneMask(phoneIn);

    if (editing) {
      nameIn.value = editing.name;
      phoneIn.value = editing.phone;
      shelfSel.value = String(editing.shelf);
      slotSel.value = String(editing.slot);
      notesIn.value = editing.notes || '';
    } else {
      shelfSel.value = String(opts.shelf || 1);
      slotSel.value = String(opts.slot || firstFreeSlot(boxes, opts.shelf || 1) || 1);
      if (opts.name) nameIn.value = opts.name;
      if (opts.phone) phoneIn.value = formatPhoneBR(opts.phone);
      if (opts.notes) notesIn.value = opts.notes;
    }

    if (opts.viaPhoto) {
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = 'Cadastro via foto / OCR';
      wrap.insertBefore(badge, wrap.firstChild);
    }

    $('#f-save', wrap).addEventListener('click', async () => {
      const name = nameIn.value.trim();
      const phone = formatPhoneBR(phoneIn.value);
      const shelf = Number(shelfSel.value);
      const slot = Number(slotSel.value);
      const notes = notesIn.value.trim();
      const alertEl = $('#f-alert', wrap);
      alertEl.innerHTML = '';

      if (!name) {
        alertEl.innerHTML = '<div class="alert-box">Informe o nome.</div>';
        return;
      }
      const dig = phoneDigits(phone);
      if (dig.length < 10) {
        alertEl.innerHTML = '<div class="alert-box">Telefone inválido. Use o formato (21) 99999-0000.</div>';
        return;
      }

      const dup = findDuplicatePhone(boxes, phone, editing ? editing.id : null);
      if (dup) {
        alertMsg(
          'Esse telefone já tem caixa — prateleira ' +
            dup.shelf +
            ', slot ' +
            dup.slot +
            ' (' +
            dup.name +
            ').'
        );
        alertEl.innerHTML =
          '<div class="alert-box">Esse telefone já tem caixa — prateleira ' +
          dup.shelf +
          ', slot ' +
          dup.slot +
          '.</div>';
        return;
      }

      const occupant = boxAt(boxes, shelf, slot);
      if (occupant && (!editing || occupant.id !== editing.id)) {
        alertEl.innerHTML =
          '<div class="alert-box">Slot ' +
          slot +
          ' da prateleira ' +
          shelf +
          ' já está ocupado por ' +
          escapeHtml(occupant.name) +
          '.</div>';
        return;
      }

      if (editing) {
        editing.name = name;
        editing.phone = phone;
        editing.phoneDigits = dig;
        editing.shelf = shelf;
        editing.slot = slot;
        editing.notes = notes;
        editing.updatedAt = new Date().toISOString();
        persist();
        closeAllPanels();
        openBoxDetail(editing.id);
      } else {
        const box = normalizeBox({
          id: crypto.randomUUID(),
          name,
          phone,
          shelf,
          slot,
          notes,
          deliveryRequested: false,
          registeredViaPhoto: Boolean(opts.viaPhoto),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        boxes.push(box);
        persist();

        // Attach pending photo blobs from OCR flow
        if (opts.photoBlobs && opts.photoBlobs.length) {
          for (const blob of opts.photoBlobs) {
            try {
              await addPhoto(box.id, blob, { kind: 'label' });
            } catch (e) {
              console.warn(e);
            }
          }
        }
        closeAllPanels();
        openShelf(shelf);
        openBoxDetail(box.id);
      }
    });
  });
}

/* ---------- Box detail ---------- */
function openBoxDetail(boxId) {
  const box = getBox(boxId);
  if (!box) return;

  openPanel('Caixa', (body) => {
    const card = document.createElement('div');
    card.className = 'detail-card' + (box.deliveryRequested ? ' delivery-alert' : '');
    card.innerHTML =
      '<h3 class="detail-name">' + escapeHtml(box.name) + '</h3>' +
      '<p class="detail-line"><strong>Telefone:</strong> ' + escapeHtml(box.phone) + '</p>' +
      '<p class="detail-line"><strong>Local:</strong> Prateleira ' +
      box.shelf +
      ' · Slot ' +
      box.slot +
      ' · Corredor ' +
      corridorOf(box.shelf) +
      '</p>' +
      (box.notes
        ? '<p class="detail-line"><strong>Notas:</strong> ' + escapeHtml(box.notes) + '</p>'
        : '') +
      (box.registeredViaPhoto ? '<span class="badge">Via foto</span> ' : '') +
      (box.deliveryRequested
        ? '<span class="badge red">Entrega solicitada</span>'
        : '');

    body.appendChild(card);

    // Photos
    const photoSec = document.createElement('div');
    photoSec.className = 'detail-card';
    photoSec.innerHTML = '<strong>Fotos do conteúdo</strong><div class="photo-thumbs" id="photo-thumbs"><p class="hint">Carregando…</p></div>';
    const actions = document.createElement('div');
    actions.className = 'photo-actions';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-outline';
    addBtn.textContent = 'Adicionar foto';
    const fileIn = document.createElement('input');
    fileIn.type = 'file';
    fileIn.accept = 'image/*';
    fileIn.setAttribute('capture', 'environment');
    fileIn.hidden = true;
    addBtn.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', () => {
      const file = fileIn.files && fileIn.files[0];
      if (!file) return;
      addPhoto(box.id, file, { kind: 'content' }).then(() => refreshPhotos());
      fileIn.value = '';
    });
    actions.appendChild(addBtn);
    actions.appendChild(fileIn);
    photoSec.appendChild(actions);
    body.appendChild(photoSec);

    function refreshPhotos() {
      const thumbs = $('#photo-thumbs', photoSec);
      listPhotosForBox(box.id).then((photos) => {
        thumbs.innerHTML = '';
        if (!photos.length) {
          thumbs.innerHTML = '<p class="hint">Nenhuma foto nesta caixa.</p>';
          return;
        }
        for (const ph of photos) {
          const wrap = document.createElement('div');
          const img = document.createElement('img');
          img.className = 'photo-thumb';
          img.alt = 'Foto da caixa';
          img.src = trackUrl(photoObjectURL(ph));
          const del = document.createElement('button');
          del.type = 'button';
          del.className = 'btn btn-sm btn-danger';
          del.textContent = '✕';
          del.style.marginTop = '4px';
          del.style.width = '100%';
          del.addEventListener('click', () => {
            if (!confirmMsg('Remover esta foto?')) return;
            deletePhoto(ph.id).then(() => refreshPhotos());
          });
          wrap.appendChild(img);
          wrap.appendChild(del);
          thumbs.appendChild(wrap);
        }
      });
    }
    refreshPhotos();

    // Action buttons (sync — always visible)
    const row = document.createElement('div');
    row.className = 'btn-row';
    row.style.flexDirection = 'column';

    const wa = document.createElement('a');
    wa.className = 'btn btn-whatsapp btn-lg btn-block';
    wa.href = whatsappUrl(box);
    wa.target = '_blank';
    wa.rel = 'noopener noreferrer';
    wa.textContent = 'WhatsApp';
    row.appendChild(wa);

    if (box.deliveryRequested) {
      const weigh = document.createElement('button');
      weigh.type = 'button';
      weigh.className = 'btn btn-secondary btn-lg btn-block';
      weigh.textContent = 'Pesagem feita';
      weigh.addEventListener('click', () => {
        box.deliveryRequested = false;
        box.updatedAt = new Date().toISOString();
        persist();
        closePanel();
        openBoxDetail(box.id);
      });
      row.appendChild(weigh);
    } else {
      const deliv = document.createElement('button');
      deliv.type = 'button';
      deliv.className = 'btn btn-danger btn-lg btn-block';
      deliv.textContent = 'Este cliente solicitou a entrega';
      deliv.addEventListener('click', () => {
        box.deliveryRequested = true;
        box.updatedAt = new Date().toISOString();
        persist();
        closePanel();
        openBoxDetail(box.id);
      });
      row.appendChild(deliv);
    }

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-outline btn-block';
    edit.textContent = 'Editar / Mover';
    edit.addEventListener('click', () => openRegisterForm({ boxId: box.id }));
    row.appendChild(edit);

    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'btn btn-outline btn-block';
    printBtn.textContent = 'Imprimir etiqueta';
    printBtn.addEventListener('click', () => printLabel(box));
    row.appendChild(printBtn);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-secondary btn-block';
    remove.textContent = 'Remover caixa';
    remove.addEventListener('click', () => {
      if (
        !confirmMsg(
          'Remover a caixa de ' +
            box.name +
            ' (prateleira ' +
            box.shelf +
            ', slot ' +
            box.slot +
            ')? Esta ação não apaga o backup automático.'
        )
      ) {
        return;
      }
      deleteAllPhotosForBox(box.id).then(async () => {
        await removeBoxEverywhere(box);
        closeAllPanels();
      });
    });
    row.appendChild(remove);

    body.appendChild(row);
  });
}

function printLabel(box) {
  const el = $('#print-label');
  el.hidden = false;
  el.innerHTML =
    '<div class="print-card">' +
    '<h1>Carol Guerreiro Importado</h1>' +
    '<p><em>No Brasil é luxo, com a Carol é barato.</em></p>' +
    '<p class="print-shelf">Prateleira ' +
    box.shelf +
    ' · Slot ' +
    box.slot +
    '</p>' +
    '<p><strong>' +
    escapeHtml(box.name) +
    '</strong></p>' +
    '<p>' +
    escapeHtml(box.phone) +
    '</p>' +
    (box.notes ? '<p>' + escapeHtml(box.notes) + '</p>' : '') +
    '</div>';
  window.print();
  setTimeout(() => {
    el.hidden = true;
    el.innerHTML = '';
  }, 500);
}

/* ---------- Delivery home block ---------- */
function setupDeliveryBlock() {
  const nameIn = $('#delivery-name');
  const phoneIn = $('#delivery-phone');
  const feedback = $('#delivery-feedback');
  bindPhoneMask(phoneIn);

  $('#btn-delivery-request').addEventListener('click', () => {
    feedback.className = 'hint';
    feedback.textContent = '';
    const phone = formatPhoneBR(phoneIn.value);
    if (phoneDigits(phone).length < 10) {
      feedback.className = 'hint err';
      feedback.textContent = 'Informe o telefone do cliente.';
      return;
    }
    const box = findByPhone(boxes, phone);
    if (!box) {
      feedback.className = 'hint err';
      feedback.textContent = 'Nenhuma caixa com este telefone.';
      return;
    }
    box.deliveryRequested = true;
    box.updatedAt = new Date().toISOString();
    if (nameIn.value.trim() && !box.name) box.name = nameIn.value.trim();
    persist();
    feedback.className = 'hint ok';
    feedback.textContent =
      'Entrega marcada: ' +
      box.name +
      ' — prateleira ' +
      box.shelf +
      ', slot ' +
      box.slot +
      '.';
    renderSearchIfAny();
  });

  $('#btn-delivery-weighed').addEventListener('click', () => {
    feedback.className = 'hint';
    feedback.textContent = '';
    const phone = formatPhoneBR(phoneIn.value);
    if (phoneDigits(phone).length < 10) {
      feedback.className = 'hint err';
      feedback.textContent = 'Informe o telefone do cliente.';
      return;
    }
    const box = findByPhone(boxes, phone);
    if (!box) {
      feedback.className = 'hint err';
      feedback.textContent = 'Nenhuma caixa com este telefone.';
      return;
    }
    box.deliveryRequested = false;
    box.updatedAt = new Date().toISOString();
    persist();
    feedback.className = 'hint ok';
    feedback.textContent =
      'Pesagem feita — flag removida: ' +
      box.name +
      ' (prat. ' +
      box.shelf +
      '/' +
      box.slot +
      ').';
    renderSearchIfAny();
  });
}

/* ---------- Search ---------- */
function setupSearch() {
  const input = $('#search-input');
  const results = $('#search-results');
  let t = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => renderSearch(input.value), 120);
  });
}

function renderSearchIfAny() {
  const q = $('#search-input').value;
  if (q.trim()) renderSearch(q);
}

function renderSearch(query) {
  const results = $('#search-results');
  const list = searchBoxes(boxes, query);
  if (!String(query || '').trim()) {
    results.hidden = true;
    results.innerHTML = '';
    return;
  }
  results.hidden = false;
  if (!list.length) {
    results.innerHTML = '<p class="hint">Nenhuma caixa encontrada.</p>';
    return;
  }
  results.innerHTML = '';
  for (const box of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-item' + (box.deliveryRequested ? ' has-delivery' : '');
    btn.innerHTML =
      '<strong>' +
      escapeHtml(box.name) +
      '</strong>' +
      '<span class="search-meta">' +
      escapeHtml(box.phone) +
      ' · Prat. ' +
      box.shelf +
      ' / Slot ' +
      box.slot +
      (box.deliveryRequested ? ' · ENTREGA' : '') +
      '</span>';
    btn.addEventListener('click', () => openBoxDetail(box.id));
    results.appendChild(btn);
  }
}

/* ---------- Photo / OCR registration ---------- */
function setupPhotoRegister() {
  $('#btn-photo-register').addEventListener('click', () => openPhotoFlow());
}

function openPhotoFlow() {
  openPanel('Cadastrar por foto', (body) => {
    const wrap = document.createElement('div');
    wrap.className = 'camera-area detail-card';
    wrap.innerHTML = `
      <p>Tire uma foto do rótulo (câmera traseira) ou escolha da galeria. O texto será lido automaticamente.</p>
      <img id="ocr-preview" class="camera-preview" alt="Prévia" hidden />
      <p class="ocr-status" id="ocr-status" role="status"></p>
      <div class="ocr-preview-box" id="ocr-raw" hidden></div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary btn-lg" id="ocr-camera">Abrir câmera</button>
        <button type="button" class="btn btn-secondary btn-lg" id="ocr-gallery">Galeria</button>
      </div>
      <input type="file" id="ocr-file-cam" accept="image/*" capture="environment" hidden />
      <input type="file" id="ocr-file-gal" accept="image/*" hidden />
      <div id="ocr-form" hidden></div>
    `;
    body.appendChild(wrap);

    const status = $('#ocr-status', wrap);
    const preview = $('#ocr-preview', wrap);
    const rawBox = $('#ocr-raw', wrap);
    const formHost = $('#ocr-form', wrap);
    const camIn = $('#ocr-file-cam', wrap);
    const galIn = $('#ocr-file-gal', wrap);

    $('#ocr-camera', wrap).addEventListener('click', () => camIn.click());
    $('#ocr-gallery', wrap).addEventListener('click', () => galIn.click());

    async function handleFile(file) {
      if (!file) return;
      formHost.hidden = true;
      formHost.innerHTML = '';
      preview.hidden = false;
      preview.src = trackUrl(URL.createObjectURL(file));
      status.textContent = 'Processando imagem…';
      rawBox.hidden = true;

      try {
        const parsed = await recognizeLabel(file, (msg) => {
          status.textContent = msg;
        });
        rawBox.hidden = false;
        rawBox.textContent = parsed.rawText || '(sem texto detectado)';
        status.textContent = 'Revise os dados e confirme.';
        showOcrConfirm(formHost, parsed, file);
      } catch (err) {
        console.error(err);
        status.textContent = 'Falha no OCR. Preencha manualmente.';
        showOcrConfirm(
          formHost,
          { name: '', phoneFormatted: '', phoneDigits: '', rawText: '' },
          file
        );
      }
    }

    camIn.addEventListener('change', () => {
      const f = camIn.files && camIn.files[0];
      handleFile(f);
      camIn.value = '';
    });
    galIn.addEventListener('change', () => {
      const f = galIn.files && galIn.files[0];
      handleFile(f);
      galIn.value = '';
    });
  });
}

function showOcrConfirm(host, parsed, fileBlob) {
  host.hidden = false;
  host.innerHTML = `
    <div class="form-row">
      <label for="ocr-name">Nome</label>
      <input id="ocr-name" type="text" />
    </div>
    <div class="form-row">
      <label for="ocr-phone">Telefone</label>
      <input id="ocr-phone" type="tel" inputmode="tel" placeholder="(21) 99999-0000" />
    </div>
    <div class="form-row">
      <label for="ocr-shelf">Prateleira</label>
      <select id="ocr-shelf"></select>
    </div>
    <div class="form-row">
      <label for="ocr-slot">Slot (livre automático ou escolha)</label>
      <select id="ocr-slot"></select>
    </div>
    <p class="hint">O primeiro slot livre da prateleira é selecionado automaticamente.</p>
    <button type="button" class="btn btn-primary btn-lg btn-block" id="ocr-continue">Continuar para confirmar</button>
  `;

  const shelfSel = $('#ocr-shelf', host);
  const slotSel = $('#ocr-slot', host);
  for (let i = 1; i <= TOTAL_SHELVES; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = String(i);
    shelfSel.appendChild(o);
  }

  function refillSlots() {
    const shelf = Number(shelfSel.value);
    slotSel.innerHTML = '';
    const free = firstFreeSlot(boxes, shelf);
    for (let i = 1; i <= SLOTS_PER_SHELF; i++) {
      const occ = boxAt(boxes, shelf, i);
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = occ ? i + ' (ocupado)' : i + ' (livre)';
      o.disabled = Boolean(occ);
      slotSel.appendChild(o);
    }
    if (free != null) slotSel.value = String(free);
  }

  shelfSel.addEventListener('change', refillSlots);
  refillSlots();

  const nameIn = $('#ocr-name', host);
  const phoneIn = $('#ocr-phone', host);
  bindPhoneMask(phoneIn);
  nameIn.value = parsed.name || '';
  phoneIn.value = parsed.phoneFormatted || formatPhoneBR(parsed.phoneDigits || '');

  $('#ocr-continue', host).addEventListener('click', () => {
    const shelf = Number(shelfSel.value);
    const slot = Number(slotSel.value);
    openRegisterForm({
      replace: true,
      name: nameIn.value.trim(),
      phone: phoneIn.value,
      shelf,
      slot,
      viaPhoto: true,
      photoBlobs: fileBlob ? [fileBlob] : [],
    });
  });
}

/* ---------- Backup / Import / CSV / Restore ---------- */
function setupDataTools() {
  $('#btn-backup').addEventListener('click', () => {
    const json = exportJSON(boxes);
    downloadBlob(
      'carol-estoque-backup-' + dateStamp() + '.json',
      new Blob([json], { type: 'application/json' })
    );
  });

  $('#btn-csv').addEventListener('click', () => {
    const csv = toCSV(boxes);
    downloadBlob(
      'carol-estoque-' + dateStamp() + '.csv',
      new Blob([csv], { type: 'text/csv;charset=utf-8' })
    );
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async () => {
    const file = $('#import-file').files && $('#import-file').files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = importJSON(text);
      if (
        !confirmMsg(
          'Importar ' +
            imported.length +
            ' caixas? Isso substitui os dados atuais (um auto-backup será criado antes).'
        )
      ) {
        $('#import-file').value = '';
        return;
      }
      // save current as auto-backup via saveBoxes first
      saveBoxes(boxes);
      boxes = imported.map((b) => normalizeBox(b));
      persist();
      alertMsg('Importação concluída: ' + boxes.length + ' caixas. Sincronizando nuvem…');
    } catch (e) {
      alertMsg('Falha ao importar JSON: ' + (e.message || e));
    }
    $('#import-file').value = '';
  });

  $('#btn-restore').addEventListener('click', () => openRestorePanel());
}

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    '-' +
    p(d.getHours()) +
    p(d.getMinutes())
  );
}

function openRestorePanel() {
  openPanel('Restaurar backup', (body) => {
    const list = listAutoBackups();
    const info = document.createElement('div');
    info.className = 'confirm-box';
    info.innerHTML =
      '<strong>Atenção:</strong> restaurar substitui os dados atuais. Só avança após confirmação explícita. Backups vazios não apagam nada sem você confirmar.';
    body.appendChild(info);

    if (!list.length) {
      body.appendChild(
        Object.assign(document.createElement('p'), {
          className: 'hint',
          textContent: 'Nenhum auto-backup disponível ainda.',
        })
      );
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'backup-list';
    for (const bk of list) {
      const li = document.createElement('li');
      const meta = document.createElement('div');
      meta.className = 'backup-meta';
      const when = formatLocal(bk.at);
      meta.innerHTML =
        '<strong>' +
        when +
        '</strong><br>' +
        (bk.count || 0) +
        ' caixas · ' +
        escapeHtml(bk.reason || 'save');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary btn-sm';
      btn.textContent = 'Restaurar';
      btn.addEventListener('click', () => {
        const count = Array.isArray(bk.data) ? bk.data.length : 0;
        if (count === 0) {
          if (
            !confirmMsg(
              'Este backup está VAZIO (0 caixas). Tem certeza que deseja restaurá-lo e substituir os dados atuais?'
            )
          ) {
            return;
          }
        } else if (
          !confirmMsg(
            'Restaurar backup de ' +
              when +
              ' com ' +
              count +
              ' caixas? Os dados atuais serão substituídos.'
          )
        ) {
          return;
        }
        try {
          boxes = restoreFromBackup(bk.id).map((b) => normalizeBox(b));
          renderMap();
          closeAllPanels();
          alertMsg('Backup restaurado (' + boxes.length + ' caixas).');
        } catch (e) {
          alertMsg('Falha: ' + (e.message || e));
        }
      });
      li.appendChild(meta);
      li.appendChild(btn);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  });
}

function formatLocal(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { timeZone: 'America/New_York' });
  } catch {
    return iso;
  }
}

/* ---------- Corridors + panel chrome ---------- */
function setupCorridors() {
  $$('.corridor-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.corridor-tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      corridorFilter = tab.dataset.corridor;
      renderMap();
    });
  });
}

function setupPanelChrome() {
  $('#panel-close').addEventListener('click', () => closeAllPanels());
  $('#panel-back').addEventListener('click', () => closePanel());
  $('#panel-host').addEventListener('click', (e) => {
    if (e.target === $('#panel-host')) closeAllPanels();
  });
  // Stop propagation from panel so backdrop logic is intentional only
  $('#main-panel').addEventListener('click', (e) => e.stopPropagation());
}

/* ---------- Boot ---------- */
async function init() {
  boxes = purgeTombstoned(loadBoxes());
  getDeletedIds();
  setupDeliveryBlock();
  setupSearch();
  setupPhotoRegister();
  setupDataTools();
  setupCorridors();
  setupPanelChrome();
  renderMap();
  updateSyncBadge();

  // Limpa SW em paralelo (não bloqueia a nuvem)
  if ('serviceWorker' in navigator) {
    Promise.race([
      (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
          if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
          }
        } catch (err) {
          console.warn('SW cleanup:', err);
        }
      })(),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => {});
  }

  try {
    await withTimeout(initSync(), 10000);
  } catch (e) {
    console.warn('initSync:', e);
    markSyncError(e && e.code === 'TIMEOUT' ? e : e || new Error('falha ao conectar'));
  }
  markSyncBootTried();
  updateSyncBadge();

  if (isSyncActive()) {
    try {
      await withTimeout(pullAndMergeCloud(), 12000);
    } catch (e) {
      console.warn('pull cloud:', e);
    }
    updateSyncBadge();
    startRealtimeSync();
  } else {
    updateSyncBadge();
  }
}

init().catch((err) => {
  console.error(err);
  try {
    renderMap();
    updateSyncBadge();
  } catch (_) {}
});
