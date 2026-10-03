export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function fmtTotal(s) {
  const m = Math.round((s || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

export function fmtBytes(n) {
  if (!n) return '0 Mo';
  const fmt = v => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return n >= 1e9 ? `${fmt(n / 1e9)} Go` : `${fmt(n / 1e6)} Mo`;
}

export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Recherche insensible aux accents et à la casse
export const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function matches(query, text) {
  const words = norm(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(text);
  return words.every(w => hay.includes(w));
}

export function hue(str) {
  let h = 0;
  for (const c of str || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
