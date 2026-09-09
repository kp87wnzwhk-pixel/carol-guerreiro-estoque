/**
 * Adapter: mesmo OCR do app de embalagem (rapido + preciso no post-it).
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

export function parseLabelText(text) {
  // kept for compatibility; main path uses recognize()
  return { rawText: String(text || ""), name: "", phoneDigits: "", phoneFormatted: "" };
}

export async function recognizeLabel(image, onProgress) {
  const parsed = await recognizePacking(image, onProgress);
  const digits = phoneDigitsOnly(parsed.phone);
  let name = parsed.name || "";
  if (parsed.nameScore != null && parsed.nameScore < NAME_SCORE_MIN) {
    name = "";
  }
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
