/**
 * Sillon API : serveur de reconnaissance musicale (Cloudflare Worker, offre gratuite).
 * Il garde les clés secrètes : l'appli ne les voit jamais.
 *
 * Variables à créer dans Cloudflare (Worker › Settings › Variables and Secrets) :
 *   APP_SECRET        secret, obligatoire : ton code d'accès, à saisir aussi dans l'appli.
 *   AUDD_API_TOKEN    secret, conseillé   : clé AudD. Sans clé, AudD n'accepte que quelques essais par jour.
 *   JAMENDO_CLIENT_ID secret, optionnel   : active la recherche de téléchargements légaux sur Jamendo.
 *   ALLOWED_ORIGINS   texte, conseillé    : adresse de l'appli, ex. https://orrej0412-cloud.github.io
 *
 * Routes (toutes protégées par l'en-tête « Authorization: Bearer <APP_SECRET> ») :
 *   GET  /health     état du serveur et des services configurés
 *   POST /recognize  corps = extrait audio (WAV, MP3…) → titre reconnu
 *   GET  /jamendo    ?title=&artist= → morceaux téléchargeables légalement sur Jamendo
 *   GET  /download   ?url= → relaie un téléchargement depuis une source autorisée (Jamendo, Internet Archive, pochettes)
 */

const VERSION = '1.0.0';
const AUDD_URL = 'https://api.audd.io/';
const JAMENDO_URL = 'https://api.jamendo.com/v3.0/tracks/';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;     // limite d'AudD
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
// Seules ces sources peuvent passer par /download (sinon le serveur deviendrait un relais ouvert).
const DOWNLOAD_HOSTS = ['jamendo.com', 'archive.org', 'mzstatic.com', 'scdn.co', 'dzcdn.net'];

const hostAllowed = host => DOWNLOAD_HOSTS.some(d => host === d || host.endsWith(`.${d}`));

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && allowed.length && !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// Comparaison à temps constant (via empreintes SHA-256 de même longueur).
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const A = new Uint8Array(x);
  const B = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

async function authorized(request, secret) {
  const header = request.headers.get('Authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return given ? safeEqual(given, secret) : false;
}

async function handle(request, env = {}) {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);
  if (!cors) return json({ error: 'origin', message: "Cette adresse d'appli n'est pas autorisée par le serveur (ALLOWED_ORIGINS)." }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    if (!env.APP_SECRET) {
      return json({ error: 'setup', message: "Le serveur n'a pas de code d'accès : ajoute la variable APP_SECRET dans Cloudflare." }, 500, cors);
    }
    if (!(await authorized(request, env.APP_SECRET))) {
      return json({ error: 'auth', message: "Code d'accès incorrect." }, 401, cors);
    }
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;
    switch (route) {
      case 'GET /health':
        return json({ ok: true, version: VERSION, audd: !!env.AUDD_API_TOKEN, jamendo: !!env.JAMENDO_CLIENT_ID }, 200, cors);
      case 'POST /recognize': return await recognize(request, url, env, cors);
      case 'GET /jamendo': return await jamendo(url, env, cors);
      case 'GET /download': return await download(url, cors);
      default: return json({ error: 'not_found', message: 'Adresse inconnue.' }, 404, cors);
    }
  } catch (err) {
    console.error(err);
    return json({ error: 'server', message: 'Erreur interne du serveur.' }, 500, cors);
  }
}

export default { fetch: handle };

/* ---------- Reconnaissance (AudD) ---------- */

const EXT = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac', 'video/mp4': 'mp4', 'video/webm': 'webm' };

async function recognize(request, url, env, cors) {
  if (Number(request.headers.get('Content-Length') || 0) > MAX_AUDIO_BYTES) {
    return json({ error: 'audio_large', message: "L'extrait dépasse 10 Mo." }, 413, cors);
  }
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: 'audio', message: 'Aucun son reçu.' }, 400, cors);
  if (body.byteLength > MAX_AUDIO_BYTES) return json({ error: 'audio_large', message: "L'extrait dépasse 10 Mo." }, 413, cors);

  const type = (request.headers.get('Content-Type') || 'application/octet-stream').split(';')[0].trim();
  const form = new FormData();
  if (env.AUDD_API_TOKEN) form.append('api_token', env.AUDD_API_TOKEN);
  form.append('file', new Blob([body], { type }), `extrait.${EXT[type] || 'bin'}`);
  form.append('return', 'apple_music,spotify,deezer');
  form.append('market', (url.searchParams.get('market') || 'fr').slice(0, 2).toLowerCase());

  let res;
  try {
    res = await fetch(AUDD_URL, { method: 'POST', body: form });
  } catch {
    return json({ error: 'upstream', message: 'AudD est injoignable pour le moment. Réessaie dans un instant.' }, 502, cors);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return json({ error: 'upstream', message: `Réponse inattendue d'AudD (HTTP ${res.status}).` }, 502, cors);
  }
  if (data.status === 'error') return auddError(data.error || {}, env, cors);
  const r = data.result;
  if (!r || (Array.isArray(r) && !r.length)) return json({ status: 'none', keyed: !!env.AUDD_API_TOKEN }, 200, cors);
  return json({ status: 'match', match: normalizeMatch(Array.isArray(r) ? r[0] : r) }, 200, cors);
}

function auddError({ error_code: code, error_message: msg = '' }, env, cors) {
  if (code === 900) {
    return json({ error: 'audd_token', message: "AudD refuse la clé AUDD_API_TOKEN. Vérifie qu'elle est exacte et que ton compte AudD est actif (dashboard.audd.io)." }, 502, cors);
  }
  if (code === 901 || code === 902 || /limit/i.test(msg)) {
    return json({
      error: 'audd_quota',
      message: env.AUDD_API_TOKEN
        ? 'Le quota de ta clé AudD est épuisé. Consulte ton compte sur dashboard.audd.io.'
        : "La limite d'essai gratuite d'AudD est atteinte pour aujourd'hui. Ajoute une clé AudD (AUDD_API_TOKEN) pour continuer.",
    }, 429, cors);
  }
  if (code === 300 || code === 500 || code === 700) {
    return json({ error: 'audio', message: "L'extrait n'a pas pu être analysé (trop court, silencieux ou format illisible)." }, 422, cors);
  }
  if (code === 400) return json({ error: 'audio_large', message: "L'extrait est trop lourd pour AudD." }, 413, cors);
  return json({ error: 'audd', message: `AudD : ${msg || 'erreur inconnue'}${code ? ` (n° ${code})` : ''}` }, 502, cors);
}

function normalizeMatch(r) {
  const am = r.apple_music || {};
  const sp = r.spotify || {};
  const dz = r.deezer || {};
  const cover = am.artwork?.url?.replace('{w}x{h}', '600x600')
    || dz.album?.cover_xl || sp.album?.images?.[0]?.url || null;
  const duration = am.durationInMillis ? am.durationInMillis / 1000
    : sp.duration_ms ? sp.duration_ms / 1000 : Number(dz.duration) || 0;
  return {
    title: r.title || '',
    artist: r.artist || '',
    album: r.album || '',
    releaseDate: r.release_date || '',
    label: r.label || '',
    timecode: r.timecode || '',
    isrc: am.isrc || sp.external_ids?.isrc || dz.isrc || '',
    duration,
    cover,
    links: {
      songLink: r.song_link || '',
      spotify: sp.external_urls?.spotify || '',
      appleMusic: am.url || '',
      deezer: dz.link || '',
    },
  };
}

/* ---------- Jamendo (musique sous licence Creative Commons) ---------- */

async function jamendo(url, env, cors) {
  if (!env.JAMENDO_CLIENT_ID) return json({ enabled: false, results: [] }, 200, cors);
  const title = (url.searchParams.get('title') || '').slice(0, 200);
  const artist = (url.searchParams.get('artist') || '').slice(0, 200);
  if (!title && !artist) return json({ error: 'query', message: 'Titre ou artiste manquant.' }, 400, cors);

  const call = format => fetch(`${JAMENDO_URL}?${new URLSearchParams({
    client_id: env.JAMENDO_CLIENT_ID, format: 'json', limit: '15',
    search: `${artist} ${title}`.trim(), audiodlformat: format,
  })}`).then(r => r.json());

  let mp3;
  let flac;
  try {
    [mp3, flac] = await Promise.all([call('mp32'), call('flac').catch(() => null)]);
  } catch {
    return json({ error: 'upstream', message: 'Jamendo est injoignable pour le moment.' }, 502, cors);
  }
  if (mp3?.headers?.status !== 'success') {
    return json({ error: 'jamendo', message: `Jamendo : ${mp3?.headers?.error_message || 'erreur inconnue'}` }, 502, cors);
  }
  const flacUrl = new Map((flac?.results || []).map(t => [t.id, t.audiodownload]));
  const results = (mp3.results || [])
    .filter(t => t.audiodownload_allowed && t.audiodownload)
    .map(t => ({
      id: `jamendo:${t.id}`,
      source: 'Jamendo',
      title: t.name || '',
      artist: t.artist_name || '',
      album: t.album_name || '',
      duration: Number(t.duration) || 0,
      cover: t.album_image || t.image || '',
      page: t.shareurl || '',
      license: t.license_ccurl || '',
      formats: [
        { label: 'MP3 (VBR)', ext: 'mp3', url: t.audiodownload },
        ...(flacUrl.get(t.id) ? [{ label: 'FLAC', ext: 'flac', url: flacUrl.get(t.id) }] : []),
      ],
    }));
  return json({ enabled: true, results }, 200, cors);
}

/* ---------- Relais de téléchargement (sources autorisées uniquement) ---------- */

async function download(url, cors) {
  let target;
  try {
    target = new URL(url.searchParams.get('url') || '');
  } catch {
    return json({ error: 'url', message: 'Adresse de fichier invalide.' }, 400, cors);
  }
  if (target.protocol === 'http:') target.protocol = 'https:';
  if (target.protocol !== 'https:' || !hostAllowed(target.hostname)) {
    return json({ error: 'host', message: "Cette source n'est pas autorisée." }, 403, cors);
  }
  let res;
  try {
    res = await fetch(target.toString(), { redirect: 'follow' });
  } catch {
    return json({ error: 'upstream', message: 'La source est injoignable.' }, 502, cors);
  }
  if (res.url && !hostAllowed(new URL(res.url).hostname)) {
    return json({ error: 'host', message: 'La source redirige vers un site non autorisé.' }, 403, cors);
  }
  if (!res.ok) return json({ error: 'upstream', message: `La source a répondu avec une erreur (${res.status}).` }, 502, cors);
  const length = Number(res.headers.get('Content-Length') || 0);
  if (length > MAX_DOWNLOAD_BYTES) return json({ error: 'too_large', message: 'Fichier trop volumineux (plus de 500 Mo).' }, 413, cors);

  const headers = { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (length) headers['Content-Length'] = String(length);
  return new Response(res.body, { status: 200, headers });
}
