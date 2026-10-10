// Pochettes : version 512 px pour l'écran verrouillé + couleur dominante pour l'ambiance du lecteur.
import { hue } from './util.js';

const cache = new Map();

export function analyzeCover(key, blob) {
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    const bmp = await createImageBitmap(blob);
    const S = 512;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const side = Math.min(bmp.width, bmp.height);
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, S, S);
    const dataUrl = c.toDataURL('image/jpeg', 0.88);
    const small = document.createElement('canvas');
    small.width = small.height = 24;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(c, 0, 0, 24, 24);
    return { dataUrl, rgb: dominant(sctx.getImageData(0, 0, 24, 24).data) };
  })().catch(() => null);
  cache.set(key, job);
  return job;
}

export const forgetCover = key => cache.delete(key);

function dominant(px) {
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < px.length; i += 4) {
    const R = px[i], G = px[i + 1], B = px[i + 2];
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const sat = max ? (max - min) / max : 0;
    const lum = max / 255;
    const wt = 0.05 + sat * sat * (lum > 0.2 && lum < 0.97 ? 1 : 0.1);
    r += R * wt; g += G * wt; b += B * wt; w += wt;
  }
  let rgb = [r / w, g / w, b / w];
  const max = Math.max(...rgb);
  if (max < 150) rgb = rgb.map(v => v * (150 / Math.max(max, 1)));
  return rgb.map(v => Math.round(Math.min(255, v)));
}

function hsl(h, s, l) {
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}

// Même gamme violet-bleu que les pochettes de remplacement en CSS (.cover.ph).
export const placeholderRGB = t => hsl(222 + hue(t?.album || t?.title || '') / 5, 0.6, 0.62);
