/** OCR estoque: so NOME + TELEFONE do post-it amarelo */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-tess="1"]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.tess = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha OCR'));
    document.head.appendChild(s);
  });
}
const CDN_SCRIPT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const CDN_WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js';
const CDN_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd.wasm.js';
const CDN_LANG = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por/4.0.0_fast_int';

let enginePromise = null;
let workerPromise = null;
export function formatFromDigits(d) {
  d = String(d || '').replace(/\D/g, '').slice(0, 11);
  if (d.length < 10) return d;
  if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
}

const PACK_RE = /variety|crispy|creamy|wafer|bars?|pack|net\s*wt|chocolate|cookie|biscuit|product|ingredients|nariety|imported/i;

function isPersonName(line) {
  const s = String(line || '').replace(/[|_]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 40) return false;
  if (PACK_RE.test(s)) return false;
  if (/\d{3,}/.test(s)) return false;
  if (/telefone|phone|cel|whats/i.test(s)) return false;
  const letters = (s.match(/[A-Za-z\u00C0-\u00FF]/g) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  if (letters < 3 || digits > 2) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  const short = words.filter((w) => w.replace(/[^A-Za-z\u00C0-\u00FF]/g, '').length <= 2).length;
  if (words.length >= 3 && short >= 2) return false;
  if (s === s.toUpperCase() && letters >= 12 && words.length >= 3) return false;
  return true;
}

function pickName(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let best = '', bestScore = 0;
  for (const line of lines) {
    if (!isPersonName(line)) continue;
    const words = line.split(/\s+/).filter(Boolean);
    const letters = (line.match(/[A-Za-z\u00C0-\u00FF]/g) || []).length;
    let score = letters + words.length * 10;
    if (words.length >= 2 && words.length <= 4) score += 25;
    if (words.length === 1 && letters >= 4 && letters <= 14) score += 30;
    if (/[a-z\u00E0-\u00FF]/.test(line)) score += 8;
    if (score > bestScore) { bestScore = score; best = line.replace(/^(?:nome|cliente)\s+/i, '').trim(); }
  }
  return bestScore >= 25 ? best : '';
}

function pickPhone(text) {
  const raw = String(text || '');
  const candidates = [];
  const re = /(?:\+?55\s*)?(?:\(?\s*\d{2}\s*\)?\s*)?(?:9\s*)?\d{4,5}[\s.-]?\d{3,4}/g;
  for (const m of raw.match(re) || []) {
    let d = m.replace(/\D/g, '');
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
    if (d.length >= 10 && d.length <= 11) candidates.push(d.slice(0, 11));
  }
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  for (let i = 0; i + 10 <= d.length; i++) {
    const slice = d.slice(i, i + 11);
    if (slice.length >= 11 && slice[2] === '9') candidates.push(slice.slice(0, 11));
    else if (slice.length >= 10) candidates.push(slice.slice(0, 10));
  }
  const mob = candidates.find((c) => c.length === 11 && c[2] === '9');
  return mob || candidates[0] || '';
}

async function getTesseract() {
  if (window.Tesseract) return window.Tesseract;
  if (!enginePromise) {
    enginePromise = loadScript(CDN_SCRIPT).then(() => {
      if (!window.Tesseract) throw new Error('Tesseract ausente');
      return window.Tesseract;
    });
  }
  return enginePromise;
}

async function getWorker(onProgress) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const Tesseract = await getTesseract();
    if (onProgress) onProgress('Preparando…');
    return Tesseract.createWorker('por', 1, {
      workerPath: CDN_WORKER,
      corePath: CDN_CORE,
      langPath: CDN_LANG,
      logger: (m) => {
        if (!onProgress || !m) return;
        if (m.status === 'recognizing text' && m.progress != null) {
          onProgress('Lendo… ' + Math.round(m.progress * 100) + '%');
        } else if (m.status === 'loading language traineddata') {
          onProgress('Baixando (1ª vez)…');
        }
      },
    });
  })().catch((e) => { workerPromise = null; throw e; });
  return workerPromise;
}

async function cropSticky(file) {
  const bmp = await createImageBitmap(file);
  const maxEdge = 1400;
  const scale0 = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w0 = Math.max(1, Math.round(bmp.width * scale0));
  const h0 = Math.max(1, Math.round(bmp.height * scale0));
  const c0 = document.createElement('canvas');
  c0.width = w0; c0.height = h0;
  const ctx0 = c0.getContext('2d', { willReadFrequently: true });
  ctx0.drawImage(bmp, 0, 0, w0, h0);
  try { bmp.close(); } catch (_) {}

  const img = ctx0.getImageData(0, 0, w0, h0);
  const d = img.data;
  let minX = w0, minY = h0, maxX = 0, maxY = 0, yellow = 0;
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      const i = (y * w0 + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const warm = r > 130 && g > 90 && b < 170 && r >= g - 10 && r > b + 20 && g > b + 5 && r + g > b * 1.7;
      if (warm) {
        yellow++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  let sx, sy, sw, sh;
  if (yellow > w0 * h0 * 0.006 && maxX > minX + 25 && maxY > minY + 25) {
    const pad = Math.round(Math.min(w0, h0) * 0.02);
    sx = Math.max(0, minX - pad);
    sy = Math.max(0, minY - pad);
    sw = Math.min(w0 - sx, maxX - minX + pad * 2);
    sh = Math.min(h0 - sy, maxY - minY + pad * 2);
  } else {
    sw = Math.round(w0 * 0.55);
    sh = Math.round(h0 * 0.45);
    sx = Math.round((w0 - sw) / 2);
    sy = Math.round((h0 - sh) / 2);
  }

  const up = 2.5;
  const c1 = document.createElement('canvas');
  c1.width = Math.max(1, Math.round(sw * up));
  c1.height = Math.max(1, Math.round(sh * up));
  const ctx1 = c1.getContext('2d', { willReadFrequently: true });
  ctx1.imageSmoothingEnabled = true;
  ctx1.drawImage(c0, sx, sy, sw, sh, 0, 0, c1.width, c1.height);

  const img2 = ctx1.getImageData(0, 0, c1.width, c1.height);
  const p = img2.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    let yv = 0.299 * r + 0.587 * g + 0.114 * b;
    if (b > r + 10 && b > g) yv *= 0.5;
    yv = (yv - 128) * 1.75 + 128;
    if (yv < 0) yv = 0;
    if (yv > 255) yv = 255;
    const v = yv < 145 ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  ctx1.putImageData(img2, 0, 0);
  return await new Promise((resolve) => c1.toBlob((b) => resolve(b || file), 'image/png'));
}

export function warmUpOcr() {
  getWorker(() => {}).catch(() => {});
}

export function parseLabelText(text) {
  const name = pickName(text);
  const phoneDigits = pickPhone(text);
  return {
    rawText: String(text || ''),
    name,
    phoneDigits,
    phoneFormatted: phoneDigits ? formatFromDigits(phoneDigits) : '',
  };
}

export async function recognizeLabel(image, onProgress) {
  if (onProgress) onProgress('Recortando post-it…');
  const crop = await cropSticky(image);
  const worker = await getWorker(onProgress);

  if (onProgress) onProgress('Lendo telefone…');
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: '0123456789()- ',
  });
  const phoneRes = await worker.recognize(crop);
  const phoneText = (phoneRes && phoneRes.data && phoneRes.data.text) || '';

  if (onProgress) onProgress('Lendo nome…');
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç '-",
  });
  const nameRes = await worker.recognize(crop);
  const nameText = (nameRes && nameRes.data && nameRes.data.text) || '';

  await worker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  let raw = nameText + '\n' + phoneText;
  let name = pickName(nameText) || pickName(raw);
  let phoneDigits = pickPhone(phoneText) || pickPhone(raw);

  if (!name || !phoneDigits) {
    if (onProgress) onProgress('Ajustando…');
    const full = await worker.recognize(crop);
    raw = ((full && full.data && full.data.text) || '') + '\n' + raw;
    if (!name) name = pickName(raw);
    if (!phoneDigits) phoneDigits = pickPhone(raw);
  }

  if (onProgress) onProgress('Pronto');
  return {
    rawText: raw,
    name: name || '',
    phoneDigits: phoneDigits || '',
    phoneFormatted: phoneDigits ? formatFromDigits(phoneDigits) : '',
  };
}
