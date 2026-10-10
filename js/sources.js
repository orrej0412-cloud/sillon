// Recherche de fichiers téléchargeables légalement : Jamendo (via ton serveur, qui garde la clé)
// et Internet Archive (directement, sans clé), en ne gardant que les licences Creative Commons
// ou le domaine public. Chaque résultat est noté par rapport au titre reconnu.
import * as api from './api.js';
import { norm, scoreCandidate } from './match.js';

const IA = 'https://archive.org';
const LICENSE_OK = /creativecommons\.org|publicdomain/i;
const FORMATS = [
  [/^VBR MP3$/i, 'MP3 (VBR)', 'mp3'],
  [/MP3/i, 'MP3', 'mp3'],
  [/FLAC/i, 'FLAC', 'flac'],
  [/Ogg Vorbis/i, 'OGG', 'ogg'],
];
const FORMAT_ORDER = ['MP3 (VBR)', 'MP3', 'FLAC', 'OGG'];

const first = v => (Array.isArray(v) ? v[0] : v) || '';
const phrase = s => `"${(s || '').replace(/["\\]/g, ' ').trim()}"`;
const cleanName = n => n.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/^\d{1,3}[\s.-]+/, '').trim();

export function parseLength(l) {
  if (!l) return 0;
  if (String(l).includes(':')) return String(l).split(':').reduce((s, p) => s * 60 + Number(p), 0) || 0;
  return Number(l) || 0;
}

// "https://creativecommons.org/licenses/by-nc-sa/3.0/" -> "CC BY-NC-SA 3.0"
export function licenseName(url) {
  if (!url) return 'Licence non précisée';
  if (/publicdomain/i.test(url)) return 'Domaine public';
  const m = url.match(/licenses\/([a-z-]+)\/([\d.]+)/i);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : 'Creative Commons';
}

// Transforme un élément Internet Archive (résultat de recherche + liste de fichiers) en morceaux téléchargeables.
export function archiveCandidates(doc, files) {
  if (!LICENSE_OK.test(first(doc.licenseurl))) return [];
  const groups = new Map();
  for (const f of files || []) {
    const fmt = FORMATS.find(([re]) => re.test(f.format || ''));
    if (!fmt || !f.name) continue;
    const title = f.title || cleanName(f.name);
    const key = norm(title);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { title, artist: f.creator || f.artist || first(doc.creator), duration: 0, formats: [] });
    g.duration ||= parseLength(f.length);
    if (g.formats.some(x => x.label === fmt[1])) continue;
    g.formats.push({
      label: fmt[1],
      ext: fmt[2],
      size: Number(f.size) || 0,
      url: `${IA}/download/${encodeURIComponent(doc.identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
    });
  }
  return [...groups.values()].map(g => ({
    id: `archive:${doc.identifier}:${norm(g.title)}`,
    source: 'Internet Archive',
    title: g.title,
    artist: g.artist,
    album: first(doc.title),
    duration: g.duration,
    cover: `${IA}/services/img/${encodeURIComponent(doc.identifier)}`,
    page: `${IA}/details/${encodeURIComponent(doc.identifier)}`,
    license: first(doc.licenseurl),
    formats: g.formats.sort((a, b) => FORMAT_ORDER.indexOf(a.label) - FORMAT_ORDER.indexOf(b.label)),
  }));
}

async function searchArchive(ref, signal) {
  const title = (ref.title || '').replace(/\s*[([].*?[)\]]/g, ' ').trim();
  const q = [
    'mediatype:(audio)',
    '(licenseurl:*creativecommons* OR licenseurl:*publicdomain*)',
    `(creator:(${phrase(ref.artist)}) OR title:(${phrase(title)}))`,
  ].join(' AND ');
  const params = new URLSearchParams({ q, rows: '6', output: 'json' });
  for (const f of ['identifier', 'title', 'creator', 'licenseurl']) params.append('fl[]', f);
  const res = await fetch(`${IA}/advancedsearch.php?${params}`, { signal });
  if (!res.ok) throw new Error(`Internet Archive a répondu ${res.status}`);
  const docs = (await res.json())?.response?.docs || [];
  const lists = await Promise.all(docs.slice(0, 4).map(doc =>
    fetch(`${IA}/metadata/${encodeURIComponent(doc.identifier)}/files`, { signal })
      .then(r => (r.ok ? r.json() : { result: [] }))
      .then(j => archiveCandidates(doc, j.result))
      .catch(() => [])));
  return lists.flat();
}

/**
 * ref : { title, artist, duration }
 * → { candidates (triés, avec .match), jamendo: 'ok'|'off'|'error', archive: 'ok'|'error', notes[] }
 */
export async function findSources(ref, { signal } = {}) {
  const [jam, arc] = await Promise.allSettled([api.jamendo(ref), searchArchive(ref, signal)]);
  const notes = [];
  let jamendo = 'ok';
  let candidates = [];

  if (jam.status === 'fulfilled') {
    if (jam.value?.enabled === false) jamendo = 'off';
    candidates.push(...(jam.value?.results || []));
  } else {
    jamendo = 'error';
    notes.push(`Jamendo indisponible : ${jam.reason?.message || 'erreur inconnue'}`);
  }
  const archive = arc.status === 'fulfilled' ? 'ok' : 'error';
  if (arc.status === 'fulfilled') candidates.push(...arc.value);
  else notes.push(`Internet Archive indisponible : ${arc.reason?.message || 'erreur inconnue'}`);

  candidates = candidates
    .filter(c => c.formats?.length)
    .map(c => ({ ...c, match: scoreCandidate(ref, c) }))
    .filter(c => c.match.score >= 0.3)
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 20);
  return { candidates, jamendo, archive, notes };
}
