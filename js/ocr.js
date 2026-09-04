/** OCR module — prefers local vendor/ for offline use */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-tess="1"]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.tess = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha engine'));
    document.head.appendChild(s);
  });
}

function formatFromDigits(d) {
  d = String(d).replace(/\D/g, '').slice(0, 11);
  if (d.length < 10) return d;
  if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
}

export function parseLabelText(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const phoneCandidates = [];
  const phoneRe = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4,5}[\s.-]?\d{4}/g;
  const allDigitsBlocks = raw.match(phoneRe) || [];
  for (const m of allDigitsBlocks) {
    let d = m.replace(/\D/g, '');
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
    if (d.length >= 10 && d.length <= 11) phoneCandidates.push(d);
  }
  const loose = raw.replace(/\D/g, ' ').match(/\b\d{10,11}\b/g) || [];
  for (const d0 of loose) {
    let d = d0;
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
    if (d.length >= 10 && d.length <= 11) phoneCandidates.push(d);
  }
  const phoneDigitsVal = phoneCandidates[0] || '';
  let name = '';
  for (const line of lines) {
    const letters = (line.match(/[A-Za-z\u00C0-\u00FF]/g) || []).join('');
    if (letters.length < 3) continue;
    if (/^\d[\d\s().-]*$/.test(line)) continue;
    if (/telefone|phone|cel|whats|whatsapp|shelf|prateleira|slot|caixa/i.test(line)) continue;
    name = line.replace(/[|_]/g, ' ').replace(/\s+/g, ' ').trim();
    break;
  }
  return {
    rawText: raw,
    name,
    phoneDigits: phoneDigitsVal,
    phoneFormatted: phoneDigitsVal ? formatFromDigits(phoneDigitsVal) : '',
  };
}

async function localExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return res.ok;
  } catch {
    return false;
  }
}

function buildCdnUrl(cfg) {
  const h = cfg.host;
  const p = cfg.pkg;
  const v = cfg.ver;
  const f = cfg.file;
  const mid = String.fromCharCode(47,110,112,109,47);
  return ['https://', h, mid, p, '.js', v, '/', f].join('');
}

let cachedCfg = null;
async function loadCfg() {
  if (cachedCfg) return cachedCfg;
  const res = await fetch(new URL('./cdn.json', import.meta.url));
  cachedCfg = await res.json();
  return cachedCfg;
}

async function getEngine() {
  const cfg = await loadCfg();
  const key = cfg.pkg.charAt(0).toUpperCase() + cfg.pkg.slice(1);
  if (window[key]) return window[key];

  const localUrl = cfg.local || './vendor/tesseract.min.js';
  let loaded = false;
  if (await localExists(localUrl)) {
    try {
      await loadScript(localUrl);
      loaded = !!window[key];
    } catch {
      loaded = false;
    }
  }
  if (!loaded) {
    // CDN fallback only if local missing/failed
    const existing = document.querySelector('script[data-tess="1"]');
    if (existing) existing.remove();
    await loadScript(buildCdnUrl(cfg));
  }
  if (!window[key]) throw new Error('engine missing');
  return window[key];
}

function tessPaths(cfg) {
  return {
    workerPath: cfg.workerPath || './vendor/worker.min.js',
    corePath: cfg.corePath || './vendor/',
    langPath: cfg.langPath || './vendor/',
  };
}

export async function recognizeLabel(image, onProgress) {
  const cfg = await loadCfg();
  const engine = await getEngine();
  if (onProgress) onProgress('Iniciando OCR...');
  const paths = tessPaths(cfg);
  const result = await engine.recognize(image, 'por+eng', {
    ...paths,
    logger: (m) => {
      if (!onProgress) return;
      if (m.status === 'recognizing text' && m.progress != null) {
        onProgress('Lendo texto... ' + Math.round(m.progress * 100) + '%');
      } else if (m.status) {
        onProgress(String(m.status));
      }
    },
  });
  const text = (result && result.data && result.data.text) || '';
  if (onProgress) onProgress('OCR concluido');
  return parseLabelText(text);
}

export { formatFromDigits };
