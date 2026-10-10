// Vérifie qu'un fichier trouvé correspond bien au titre reconnu (titre, artiste, version, durée).
// Fonctions pures : utilisées par l'appli et par les tests.

const VERSION_WORDS = new Set([
  'remix', 'rmx', 'live', 'edit', 'acoustic', 'acoustique', 'instrumental', 'karaoke', 'cover',
  'reprise', 'extended', 'dub', 'slowed', 'sped', 'acapella', 'demo', 'unplugged', 'bootleg', 'vip',
]);

export const norm = s => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// Titre sans "(feat. X)", "[Remix]", " - Radio Edit"…
export function baseTitle(title) {
  return norm((title || '')
    .replace(/\s*[([].*?[)\]]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, ' '));
}

export function versionTags(title) {
  return new Set(norm(title).split(' ').filter(w => VERSION_WORDS.has(w)));
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

// Coefficient de Dice sur les paires de lettres : 1 = identique, 0 = rien en commun.
export function similarity(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) { inter += Math.min(n, B.get(g) || 0); total += n; }
  for (const n of B.values()) total += n;
  return (2 * inter) / total;
}

const splitArtists = s => (s || '')
  .split(/\s*(?:,|&|\+|\/|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\bet\b|\band\b|\bavec\b)\s*/i)
  .map(norm).filter(Boolean);

export function artistSimilarity(a, b) {
  let best = similarity(a, b);
  for (const x of splitArtists(a)) for (const y of splitArtists(b)) best = Math.max(best, similarity(x, y));
  return best;
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * ref  : { title, artist, duration? } — le titre reconnu
 * cand : { title, artist, duration? } — un fichier trouvé
 * → { score 0..1, level 'exact' | 'probable' | 'faible', warnings[] }
 */
export function scoreCandidate(ref, cand) {
  const titleScore = similarity(baseTitle(ref.title), baseTitle(cand.title));
  const artistScore = artistSimilarity(ref.artist, cand.artist);
  let score = 0.6 * titleScore + 0.4 * artistScore;

  const warnings = [];
  const refTags = versionTags(ref.title);
  const candTags = versionTags(cand.title);
  const extra = [...candTags].filter(t => !refTags.has(t));
  const missing = [...refTags].filter(t => !candTags.has(t));
  if (extra.length) warnings.push(`Version différente : ${extra.join(', ')}`);
  if (missing.length) warnings.push(`Version différente : pas de mention « ${missing.join(', ')} »`);
  if (ref.duration > 0 && cand.duration > 0 && Math.abs(ref.duration - cand.duration) > 10) {
    warnings.push(`Durée différente : ${fmt(cand.duration)} au lieu de ${fmt(ref.duration)}`);
  }
  score = Math.max(0, Math.min(1, score - 0.15 * Math.min(warnings.length, 2)));

  // Un titre trop différent ne peut pas être « probable », même avec le bon artiste.
  let level = 'faible';
  if (score >= 0.85 && titleScore >= 0.85 && artistScore >= 0.7 && !warnings.length) level = 'exact';
  else if (score >= 0.62 && titleScore >= 0.6) level = 'probable';
  return { score, level, warnings, titleScore, artistScore };
}
