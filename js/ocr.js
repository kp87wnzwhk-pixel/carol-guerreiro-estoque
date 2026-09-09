/**
 * Adapter: OCR do embalagem + limpeza de telefone.
 */
import {
  recognize as recognizePacking,
  NAME_SCORE_MIN,
} from "./ocr-fill.js";

function formatFromDigits(d) {
  d = String(d || "").replace(/\D/g, "").slice(0, 11);
  if (d.length < 10) return d;
  if (d.length <= 10) {
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
  }
  return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
}

function phoneDigitsOnly(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.slice(0, 11);
}

/** Extrai telefone mesmo com OCR zoado: (2)) 99916-9679 */
function extractPhoneLoose(raw) {
  const text = String(raw || "");
  const compact = text.replace(/[^0-9]/g, " ");
  const blocks = compact.split(/\s+/).filter((b) => b.length >= 8);
  for (const b of blocks) {
    let d = b;
    if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
    if (d.length >= 10 && d.length <= 11) return d.slice(0, 11);
  }
  // junta sequencias tipo 21 + 99916 + 5678
  const all = text.replace(/\D/g, "");
  let d = all;
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  // pega janela 11 com 9 apos DDD
  for (let i = 0; i <= d.length - 10; i++) {
    const slice = d.slice(i, i + 11);
    if (slice.length >= 10 && slice.length <= 11) {
      const ddd = slice.slice(0, 2);
      if (/^2[1-8]$|^1[1-9]$|^3[1-5]$|^4[1-9]$|^5[1-5]$|^6[1-9]$|^7[1-9]$|^8[1-9]$|^9[1-9]$/.test(ddd)) {
        if (slice.length === 11 && slice[2] === "9") return slice;
        if (slice.length === 10) return slice;
      }
    }
  }
  if (d.length >= 10 && d.length <= 13) {
    if (d.startsWith("55")) d = d.slice(2);
    return d.slice(0, 11);
  }
  return "";
}

export function parseLabelText(text) {
  return { rawText: String(text || ""), name: "", phoneDigits: "", phoneFormatted: "" };
}

export async function recognizeLabel(image, onProgress) {
  const parsed = await recognizePacking(image, onProgress);
  let digits = phoneDigitsOnly(parsed.phone);
  if (digits.length < 10) {
    digits = extractPhoneLoose(parsed.rawText || "");
  }
  let name = parsed.name || "";
  if (parsed.nameScore != null && parsed.nameScore < NAME_SCORE_MIN) {
    name = "";
  }
  // evita nome de embalagem que passou
  if (/pack|crispy|creamy|wafer|variety|bars/i.test(name)) name = "";
  return {
    rawText: parsed.rawText || "",
    name,
    phoneDigits: digits,
    phoneFormatted: digits ? formatFromDigits(digits) : "",
    nameScore: parsed.nameScore,
    nameRejected: parsed.nameRejected || "",
  };
}

export { formatFromDigits };
