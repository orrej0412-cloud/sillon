// Écran « Reconnaître » : écoute au micro, analyse de fichiers, résultats, historique
// et téléchargements légaux. L'état vit ici ; l'écran est redessiné à partir de lui.
import * as lib from './library.js';
import * as db from './db.js';
import * as player from './player.js';
import * as api from './api.js';
import { recordMic, excerptFromFile } from './capture.js';
import { findSources, licenseName } from './sources.js';
import { icon } from './icons.js';
import { esc, fmtTime, fmtBytes, hue, uid } from './util.js';

const LISTEN_SECONDS = 10;
const HISTORY_MAX = 100;

const st = {
  phase: 'idle',          // idle | listening | preparing | analyzing | done
  elapsed: 0,
  error: null,            // { code, message }
  current: null,          // entrée d'historique affichée
  sources: null,          // { forId, state, candidates, jamendo, archive, notes, showWeak, error }
  downloads: new Map(),   // id du résultat -> { state, loaded, total, ctrl, fileName, trackId, blobUrl, error }
  history: [],
  showSettings: false,
  health: null,           // { state: 'testing' | 'ok' | 'error', data, message }
  confirmClear: false,
};

let hooks = { rerender() {}, toast() {}, navigate() {} };
let abort = null;

export async function init(h) {
  hooks = h;
  await api.loadConfig();
  st.history = (await lib.getSetting('recognitions')) || [];

  const input = document.getElementById('rec-file-input');
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (file) analyzeFile(file, { source: 'file', fileName: file.name });
  });

  const view = document.getElementById('view');
  view.addEventListener('submit', e => {
    if (e.target.id !== 'rec-config') return;
    e.preventDefault();
    const form = new FormData(e.target);
    saveSettings(String(form.get('url') || ''), String(form.get('secret') || ''));
  });
}

const saveHistory = () => lib.setSetting('recognitions', st.history);
const busy = () => ['listening', 'preparing', 'analyzing'].includes(st.phase);

/* ---------- Actions ---------- */

export function handleAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case 'rec-listen': return listen();
    case 'rec-cancel': abort?.abort(); return;
    case 'rec-file': if (!busy()) document.getElementById('rec-file-input').click(); return;
    case 'rec-settings':
      st.showSettings = !st.showSettings;
      hooks.rerender();
      if (st.showSettings) requestAnimationFrame(() => document.getElementById('rec-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    case 'rec-forget': return forgetSettings();
    case 'rec-gen': return generateSecret();
    case 'rec-verdict': return setVerdict(el.dataset.v);
    case 'rec-open': return openEntry(id);
    case 'rec-del': return deleteEntry(id);
    case 'rec-clear': return clearHistory();
    case 'rec-sources': return searchSources();
    case 'rec-weak': st.sources.showWeak = !st.sources.showWeak; return hooks.rerender();
    case 'rec-dl': return downloadCandidate(id);
    case 'rec-dl-cancel': st.downloads.get(id)?.ctrl?.abort(); return;
    case 'rec-play': {
      const tid = st.downloads.get(id)?.trackId;
      if (tid && lib.getTrack(tid)) player.playList([tid], 0, { label: 'Téléchargements', route: '#/recognize' });
      return;
    }
    case 'rec-apply': return applyToTrack();
  }
}

async function listen() {
  if (busy()) return;
  if (!api.config()) {
    st.showSettings = true;
    return fail({ code: 'config', message: "Connecte d'abord ton serveur de reconnaissance (réglages ci-dessous)." });
  }
  abort = new AbortController();
  st.phase = 'listening';
  st.elapsed = 0;
  st.error = null;
  hooks.rerender();
  if (!player.el.paused) player.el.pause(); // sinon le micro entendrait Sillon

  let wav;
  try {
    wav = await recordMic({ seconds: LISTEN_SECONDS, signal: abort.signal, onLevel: paintLevel, onTick: paintTick });
  } catch (err) {
    if (err.code === 'aborted') { st.phase = 'idle'; return hooks.rerender(); }
    return fail(err);
  } finally {
    abort = null;
  }
  await identify(wav, { source: 'mic' });
}

async function analyzeFile(blob, meta) {
  if (busy()) return;
  if (!api.config()) {
    st.showSettings = true;
    return fail({ code: 'config', message: "Connecte d'abord ton serveur de reconnaissance (réglages ci-dessous)." });
  }
  st.phase = 'preparing';
  st.error = null;
  hooks.rerender();
  let excerpt;
  try {
    excerpt = await excerptFromFile(blob);
  } catch (err) {
    return fail(err);
  }
  await identify(excerpt.blob, meta);
}

// Depuis le menu d'un titre de la bibliothèque : « Identifier ce titre ».
export async function identifyTrack(trackId) {
  const t = lib.getTrack(trackId);
  if (!t) return;
  hooks.navigate('#/recognize');
  const blob = await db.get('files', trackId);
  if (!blob) return fail({ code: 'file', message: 'Fichier introuvable dans la bibliothèque.' });
  analyzeFile(blob, { source: 'track', trackId, fileName: t.title });
}

async function identify(blob, meta) {
  st.phase = 'analyzing';
  hooks.rerender();
  try {
    const res = await api.recognize(blob);
    const entry = {
      id: uid(),
      at: Date.now(),
      source: meta.source,
      fileName: meta.fileName || '',
      trackId: meta.trackId || '',
      status: res.status === 'match' ? 'match' : 'none',
      match: res.status === 'match' ? res.match : null,
      verdict: null,
    };
    st.current = entry;
    st.sources = null;
    st.history = [entry, ...st.history].slice(0, HISTORY_MAX);
    saveHistory();
    st.phase = 'done';
    hooks.rerender();
    revealResult();
  } catch (err) {
    fail(err);
  }
}

function fail(err) {
  st.phase = 'done';
  st.current = null;
  st.error = { code: err.code || 'error', message: err.message || String(err) };
  hooks.rerender();
  revealResult();
}

function revealResult() {
  requestAnimationFrame(() => document.getElementById('rec-result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

function setVerdict(v) {
  if (!st.current) return;
  st.current.verdict = v;
  const h = st.history.find(e => e.id === st.current.id);
  if (h) h.verdict = v;
  saveHistory();
  hooks.rerender();
}

function openEntry(id) {
  const e = st.history.find(x => x.id === id);
  if (!e) return;
  st.current = e;
  st.error = null;
  st.phase = 'done';
  if (st.sources?.forId !== id) st.sources = null;
  hooks.rerender();
  revealResult();
}

function deleteEntry(id) {
  st.history = st.history.filter(e => e.id !== id);
  if (st.current?.id === id) { st.current = null; st.phase = 'idle'; }
  saveHistory();
  hooks.rerender();
}

function clearHistory() {
  if (!st.confirmClear) {
    st.confirmClear = true;
    hooks.rerender();
    setTimeout(() => { if (st.confirmClear) { st.confirmClear = false; hooks.rerender(); } }, 4000);
    return;
  }
  st.confirmClear = false;
  st.history = [];
  st.current = null;
  st.phase = 'idle';
  saveHistory();
  hooks.rerender();
  hooks.toast('Historique effacé');
}

/* ---------- Réglages du serveur ---------- */

async function saveSettings(url, secret) {
  if (!/^https?:\/\//i.test(url.trim())) {
    st.health = { state: 'error', message: "L'adresse doit commencer par https://" };
    return hooks.rerender();
  }
  await api.saveConfig(url, secret);
  st.showSettings = true; // garder le résultat du test visible
  st.health = { state: 'testing' };
  hooks.rerender();
  try {
    const data = await api.health();
    st.health = { state: 'ok', data };
    st.error = null;
    hooks.toast('Serveur connecté');
  } catch (err) {
    st.health = { state: 'error', message: err.message };
  }
  hooks.rerender();
}

// Code aléatoire de 32 caractères, à coller aussi dans Cloudflare (variable APP_SECRET).
async function generateSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const code = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
  const input = document.getElementById('rec-secret');
  if (!input) return;
  input.value = code;
  input.type = 'text';
  input.select();
  try {
    await navigator.clipboard.writeText(code);
    hooks.toast('Code copié : colle-le dans Cloudflare (APP_SECRET)');
  } catch {
    hooks.toast('Code généré : copie-le pour Cloudflare (APP_SECRET)');
  }
}

async function forgetSettings() {
  await api.saveConfig(null);
  st.health = null;
  st.showSettings = true;
  hooks.rerender();
}

/* ---------- Téléchargements légaux ---------- */

async function searchSources() {
  const e = st.current;
  if (!e?.match) return;
  st.sources = { forId: e.id, state: 'loading', candidates: [], notes: [], showWeak: false };
  hooks.rerender();
  try {
    const r = await findSources({ title: e.match.title, artist: e.match.artist, duration: e.match.duration });
    if (st.sources?.forId !== e.id) return;
    Object.assign(st.sources, { state: 'done' }, r);
  } catch (err) {
    if (st.sources?.forId !== e.id) return;
    Object.assign(st.sources, { state: 'error', error: err.message });
  }
  hooks.rerender();
}

const MIME = { mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg' };
const safeName = s => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);

async function downloadCandidate(id) {
  const c = st.sources?.candidates.find(x => x.id === id);
  if (!c || st.downloads.get(id)?.state === 'downloading') return;
  const select = [...document.querySelectorAll('[data-format-for]')].find(s => s.dataset.formatFor === id);
  const fmt = c.formats[Number(select?.value || 0)] || c.formats[0];
  const d = {
    state: 'downloading', loaded: 0, total: fmt.size || 0, format: fmt.label,
    ctrl: new AbortController(), fileName: safeName(`${c.artist} - ${c.title}.${fmt.ext}`),
  };
  st.downloads.set(id, d);
  hooks.rerender();
  try {
    const blob = await api.download(fmt.url, {
      signal: d.ctrl.signal,
      expectedSize: fmt.size,
      onProgress: (loaded, total) => { d.loaded = loaded; d.total = total; paintProgress(id, d); },
    });
    const type = blob.type.startsWith('audio/') ? blob.type : MIME[fmt.ext] || 'audio/mpeg';
    const file = new File([blob], d.fileName, { type });
    const r = await lib.importFiles([file]);
    const trackId = r.ids[0] || r.existing[0];
    if (!trackId) throw new Error("Le fichier a été téléchargé mais il n'a pas pu être ajouté à la bibliothèque.");
    await lib.updateTrack(trackId, { license: c.license, sourceUrl: c.page }, true);
    Object.assign(d, { state: 'done', trackId, blobUrl: URL.createObjectURL(file) });
    hooks.toast(r.ids.length ? 'Ajouté à ta bibliothèque' : 'Déjà dans ta bibliothèque');
  } catch (err) {
    if (err.name === 'AbortError') st.downloads.delete(id);
    else Object.assign(d, { state: 'error', error: err.message || 'Téléchargement interrompu.' });
  }
  hooks.rerender();
}

async function fetchImage(url) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) return blob;
    }
  } catch { /* image bloquée par le navigateur : on passe par le serveur */ }
  const blob = await api.download(url);
  return blob.type.startsWith('image/') || !blob.type ? blob : null;
}

async function applyToTrack() {
  const e = st.current;
  const t = e?.match && lib.getTrack(e.trackId);
  if (!t) return;
  const m = e.match;
  await lib.updateTrack(t.id, {
    title: m.title,
    artist: m.artist,
    album: m.album || t.album,
    year: (m.releaseDate || '').slice(0, 4) || t.year,
  });
  if (m.cover) {
    try {
      const blob = await fetchImage(m.cover);
      if (blob) await lib.setTrackCover(t.id, blob);
    } catch { /* pochette facultative */ }
  }
  hooks.toast('Infos du titre mises à jour');
}

/* ---------- Mises à jour légères pendant l'écoute et les téléchargements ---------- */

function paintLevel(level) {
  document.getElementById('rec-btn')?.style.setProperty('--lvl', level.toFixed(3));
}

let lastSecond = -1;
function paintTick(elapsed) {
  st.elapsed = elapsed;
  const arc = document.getElementById('rec-arc');
  if (arc) arc.style.strokeDashoffset = String(100 - Math.min(100, (elapsed / LISTEN_SECONDS) * 100));
  const left = Math.max(0, Math.ceil(LISTEN_SECONDS - elapsed));
  if (left !== lastSecond) {
    lastSecond = left;
    const s = document.getElementById('rec-status');
    if (s) s.textContent = statusText();
  }
}

function paintProgress(id, d) {
  const bar = document.getElementById(`dlbar-${id}`);
  const txt = document.getElementById(`dltxt-${id}`);
  if (bar) {
    bar.style.setProperty('--p', d.total ? Math.min(1, d.loaded / d.total).toFixed(3) : '1');
    bar.classList.toggle('indeterminate', !d.total);
  }
  if (txt) txt.textContent = progressText(d);
}

const progressText = d => (d.total
  ? `${fmtBytes(d.loaded)} / ${fmtBytes(d.total)} · ${Math.floor((d.loaded / d.total) * 100)} %`
  : fmtBytes(d.loaded));

/* ---------- Rendu ---------- */

function statusText() {
  switch (st.phase) {
    case 'listening': return `J'écoute encore ${Math.max(0, Math.ceil(LISTEN_SECONDS - st.elapsed))} s · touche pour annuler`;
    case 'preparing': return "Préparation d'un extrait du fichier…";
    case 'analyzing': return 'Recherche du titre…';
    default: return 'Approche le téléphone de la musique : 10 secondes suffisent.';
  }
}

export function render() {
  const cfg = api.config();
  return `
  <header class="page-h rec-head">
    <div><h1 class="h1">Reconnaître</h1><p class="sub">Identifie un son autour de toi ou dans un fichier.</p></div>
    <button class="ic${st.showSettings ? ' on' : ''}" data-action="rec-settings" aria-label="Réglages du serveur de reconnaissance" aria-expanded="${st.showSettings}">${icon('settings')}</button>
  </header>
  ${stageHTML()}
  ${resultHTML()}
  ${!cfg || st.showSettings ? settingsHTML(cfg) : ''}
  ${historyHTML()}
  ${privacyHTML()}`;
}

function stageHTML() {
  const listening = st.phase === 'listening';
  const working = st.phase === 'preparing' || st.phase === 'analyzing';
  const pct = listening ? Math.min(100, (st.elapsed / LISTEN_SECONDS) * 100) : 0;
  return `
  <section class="rec-stage phase-${st.phase}" aria-live="polite">
    <button class="rec-btn" id="rec-btn" data-action="${listening ? 'rec-cancel' : 'rec-listen'}"${working ? ' disabled' : ''}
      aria-label="${listening ? "Annuler l'écoute" : 'Reconnaître une musique'}">
      <span class="rec-ring" aria-hidden="true"></span><span class="rec-ring" aria-hidden="true"></span><span class="rec-ring" aria-hidden="true"></span>
      <svg class="rec-progress" viewBox="0 0 100 100" aria-hidden="true"><circle id="rec-arc" cx="50" cy="50" r="47" pathLength="100" style="stroke-dashoffset:${100 - pct}"></circle></svg>
      <span class="rec-core">${icon(listening ? 'close' : 'mic')}</span>
    </button>
    <p class="rec-label">${listening ? "J'écoute…" : working ? 'Analyse…' : 'Reconnaître une musique'}</p>
    <p class="rec-status" id="rec-status">${statusText()}</p>
    <button class="btn ghost" data-action="rec-file"${busy() ? ' disabled' : ''}>${icon('upload')}Analyser un fichier</button>
  </section>`;
}

const ERROR_TITLES = {
  mic_denied: 'Micro bloqué', mic_missing: 'Pas de micro', mic_busy: 'Micro occupé', mic_https: 'Micro indisponible',
  silence: 'Trop silencieux', config: 'Serveur non connecté', auth: "Code d'accès refusé", setup: 'Serveur incomplet',
  origin: 'Appli non autorisée', network: 'Connexion impossible', audd_quota: 'Quota atteint', audd_token: 'Clé AudD refusée',
  audio: 'Extrait illisible', file_large: 'Fichier trop lourd',
};
const SETTINGS_ERRORS = new Set(['config', 'auth', 'setup', 'origin', 'network']);

function resultHTML() {
  if (st.phase !== 'done') return '';
  if (st.error) {
    return `
    <section class="rec-card rec-error" id="rec-result" role="alert">
      <h2>${ERROR_TITLES[st.error.code] || 'Reconnaissance impossible'}</h2>
      <p>${esc(st.error.message)}</p>
      <div class="actions">
        ${SETTINGS_ERRORS.has(st.error.code) && !st.showSettings ? '<button class="btn" data-action="rec-settings">Réglages du serveur</button>' : ''}
        <button class="btn primary" data-action="rec-listen">${icon('mic')}Réessayer</button>
      </div>
    </section>`;
  }
  const e = st.current;
  if (!e) return '';
  if (!e.match) {
    return `
    <section class="rec-card" id="rec-result">
      <h2>Aucune musique reconnue</h2>
      <p>Le service n'a trouvé aucune correspondance pour cet extrait${e.fileName ? ` de « ${esc(e.fileName)} »` : ''}.</p>
      <ul class="tips">
        <li>Rapproche le téléphone de la source et limite les bruits autour.</li>
        <li>Réessaie pendant le refrain ou un passage chanté.</li>
        <li>Les sons très récents, les remixes de soirée et les morceaux non publiés sont souvent introuvables.</li>
      </ul>
      <div class="actions"><button class="btn primary" data-action="rec-listen">${icon('mic')}Réessayer</button></div>
    </section>`;
  }
  return matchHTML(e);
}

function when(at) {
  const diff = (Date.now() - at) / 60000;
  if (diff < 1) return "à l'instant";
  if (diff < 60) return `il y a ${Math.floor(diff)} min`;
  if (diff < 24 * 60) return `il y a ${Math.floor(diff / 60)} h`;
  return new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const sourceLabel = e => (e.source === 'mic' ? 'au micro' : e.fileName ? `dans « ${esc(e.fileName)} »` : 'dans un fichier');

function coverImg(m, cls) {
  return m?.cover
    ? `<img class="${cls}" src="${esc(m.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="${cls} cover ph" style="--h:${hue(m?.album || m?.title || '')}">${icon(m ? 'note' : 'mic')}</div>`;
}

function matchHTML(e) {
  const m = e.match;
  const meta = [m.album, (m.releaseDate || '').slice(0, 4), m.label].filter(Boolean).map(esc).join(' · ');
  const q = encodeURIComponent(`${m.artist} ${m.title}`);
  const listen = [
    m.links?.spotify && ['Spotify', m.links.spotify],
    m.links?.deezer && ['Deezer', m.links.deezer],
    m.links?.appleMusic && ['Apple Music', m.links.appleMusic],
    m.links?.songLink && ['Autres plateformes', m.links.songLink],
  ].filter(Boolean);
  const buy = [['Bandcamp', `https://bandcamp.com/search?q=${q}`], ['Qobuz', `https://www.qobuz.com/fr-fr/search?q=${q}`]];
  const linkChip = ([label, href]) => `<a class="chip-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  const track = e.trackId && lib.getTrack(e.trackId);

  let verdict;
  if (e.verdict === 'ok') verdict = `<p class="rr-ok">${icon('check')}Confirmé</p>`;
  else if (e.verdict === 'wrong') verdict = `<div class="rr-verdict"><span>Marqué comme incorrect. Réessaie sur un autre passage du morceau.</span><button class="btn small primary" data-action="rec-listen">Réessayer</button></div>`;
  else verdict = `<div class="rr-verdict"><span>C'est le bon titre ?</span><button class="btn small primary" data-action="rec-verdict" data-v="ok">Oui</button><button class="btn small ghost" data-action="rec-verdict" data-v="wrong">Non</button></div>`;

  return `
  <section class="rec-card rec-match" id="rec-result">
    <div class="rr-main">
      ${coverImg(m, 'rr-cover')}
      <div class="rr-txt">
        <h2>${esc(m.title)}</h2>
        <p class="rr-artist">${esc(m.artist)}</p>
        ${meta ? `<p class="rr-meta">${meta}</p>` : ''}
        <p class="rr-meta">Reconnu ${sourceLabel(e)} · ${when(e.at)}${m.timecode ? ` · passage à ${esc(m.timecode)}` : ''}</p>
      </div>
    </div>
    ${verdict}
    ${track ? `<button class="btn small" data-action="rec-apply">${icon('edit')}Appliquer ces infos à « ${esc(track.title)} »</button>` : ''}
    ${listen.length ? `<div class="rr-links"><span>Écouter</span>${listen.map(linkChip).join('')}</div>` : ''}
    <div class="rr-links"><span>Acheter</span>${buy.map(linkChip).join('')}</div>
    ${e.verdict === 'wrong' ? '' : sourcesHTML(e)}
  </section>`;
}

const LEVEL_LABEL = { exact: 'Correspondance exacte', probable: 'Correspondance probable', faible: 'Peu ressemblant' };

function sourcesHTML(e) {
  const s = st.sources;
  const head = '<h3>Téléchargement légal</h3>';
  if (!s || s.forId !== e.id) {
    return `<div class="rr-dl">${head}
      <p class="hint">Cherche une version gratuite et autorisée (licence Creative Commons ou domaine public) sur Jamendo et Internet Archive.</p>
      <button class="btn" data-action="rec-sources">${icon('search')}Chercher un téléchargement légal</button></div>`;
  }
  if (s.state === 'loading') return `<div class="rr-dl">${head}<p class="hint"><span class="spinner" aria-hidden="true"></span>Recherche sur Jamendo et Internet Archive…</p></div>`;
  if (s.state === 'error') return `<div class="rr-dl">${head}<p class="cand-err">${esc(s.error)}</p><button class="btn small" data-action="rec-sources">Réessayer</button></div>`;

  const strong = s.candidates.filter(c => c.match.level !== 'faible');
  const weak = s.candidates.filter(c => c.match.level === 'faible');
  const notes = [
    ...(s.notes || []),
    s.jamendo === 'off' ? "Jamendo n'est pas activé sur ton serveur (variable JAMENDO_CLIENT_ID) : seule Internet Archive a été consultée." : '',
  ].filter(Boolean);
  return `<div class="rr-dl">${head}
    ${strong.length ? strong.map(candHTML).join('') : `
      <p>Aucun fichier gratuit et légal ne correspond à ce titre.</p>
      <p class="hint">C'est le cas pour la plupart des artistes signés en maison de disques. Tu peux l'acheter en MP3 ou en FLAC grâce aux liens ci-dessus, puis l'importer dans Sillon.</p>`}
    ${weak.length ? `<button class="link" data-action="rec-weak">${s.showWeak ? 'Masquer' : 'Voir'} ${weak.length} résultat${weak.length > 1 ? 's' : ''} peu ressemblant${weak.length > 1 ? 's' : ''}</button>` : ''}
    ${s.showWeak ? weak.map(candHTML).join('') : ''}
    ${notes.map(n => `<p class="hint">${esc(n)}</p>`).join('')}
  </div>`;
}

function candHTML(c) {
  const d = st.downloads.get(c.id);
  let controls;
  if (d?.state === 'downloading') {
    const p = d.total ? Math.min(1, d.loaded / d.total) : 1;
    controls = `
      <div class="dl-progress">
        <div class="dl-bar"><span id="dlbar-${esc(c.id)}" class="${d.total ? '' : 'indeterminate'}" style="--p:${p.toFixed(3)}"></span></div>
        <span class="dl-txt" id="dltxt-${esc(c.id)}">${progressText(d)}</span>
        <button class="btn small ghost" data-action="rec-dl-cancel" data-id="${esc(c.id)}">Annuler</button>
      </div>`;
  } else if (d?.state === 'done') {
    controls = `
      <div class="cand-done">
        <span>${icon('check')}Dans ta bibliothèque</span>
        <button class="btn small" data-action="rec-play" data-id="${esc(c.id)}">${icon('play')}Lire</button>
        <a class="btn small ghost" href="${d.blobUrl}" download="${esc(d.fileName)}">${icon('download')}Enregistrer sur l'appareil</a>
      </div>`;
  } else {
    controls = `
      <div class="cand-dl">
        <select class="select" data-format-for="${esc(c.id)}" aria-label="Format de « ${esc(c.title)} »">
          ${c.formats.map((f, i) => `<option value="${i}">${esc(f.label)}${f.size ? ` · ${fmtBytes(f.size)}` : ''}</option>`).join('')}
        </select>
        <button class="btn small primary" data-action="rec-dl" data-id="${esc(c.id)}">${icon('download')}Télécharger</button>
      </div>
      ${d?.state === 'error' ? `<p class="cand-err">${esc(d.error)}</p>` : ''}`;
  }
  return `
  <article class="cand">
    <img class="cand-cover" src="${esc(c.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    <div class="cand-main">
      <p class="cand-t">${esc(c.title)}</p>
      <p class="cand-a">${esc(c.artist)}${c.album ? ` · ${esc(c.album)}` : ''}${c.duration ? ` · ${fmtTime(c.duration)}` : ''}</p>
      <p class="cand-meta">
        <span class="badge ${c.match.level}">${LEVEL_LABEL[c.match.level]}</span>
        <span>${esc(c.source)}</span>
        <a href="${esc(c.license)}" target="_blank" rel="noopener noreferrer">${esc(licenseName(c.license))}</a>
        ${c.page ? `<a href="${esc(c.page)}" target="_blank" rel="noopener noreferrer">Page source</a>` : ''}
      </p>
      ${c.match.warnings.map(w => `<p class="cand-warn">${icon('info')}${esc(w)}</p>`).join('')}
      ${controls}
    </div>
  </article>`;
}

function historyHTML() {
  if (!st.history.length) return '';
  return `
  <section class="sec rec-narrow">
    <div class="sec-h"><h2>Historique</h2><button class="link${st.confirmClear ? ' danger' : ''}" data-action="rec-clear">${st.confirmClear ? "Confirmer l'effacement" : 'Effacer'}</button></div>
    <div class="tracks">${st.history.slice(0, 60).map(e => `
      <div class="row hist${st.current?.id === e.id ? ' cur' : ''}" data-action="rec-open" data-id="${e.id}" tabindex="0">
        ${coverImg(e.match, 'cover sm')}
        <div class="meta">
          <div class="t">${e.match ? esc(e.match.title) : 'Aucun résultat'}</div>
          <div class="a">${e.match ? `${esc(e.match.artist)} · ` : ''}${when(e.at)}</div>
        </div>
        <span class="hist-state ${e.verdict || ''}" aria-label="${e.verdict === 'ok' ? 'Confirmé' : e.verdict === 'wrong' ? 'Incorrect' : ''}">${e.verdict === 'ok' ? icon('check') : e.verdict === 'wrong' ? icon('close') : ''}</span>
        <button class="ic" data-action="rec-del" data-id="${e.id}" aria-label="Retirer de l'historique">${icon('trash')}</button>
      </div>`).join('')}
    </div>
  </section>`;
}

function settingsHTML(cfg) {
  const h = st.health;
  let status = '';
  if (h?.state === 'testing') status = '<p class="hint"><span class="spinner" aria-hidden="true"></span>Test de la connexion…</p>';
  else if (h?.state === 'error') status = `<p class="cand-err">${esc(h.message)}</p>`;
  else if (h?.state === 'ok') {
    status = `
      <ul class="svc">
        <li class="ok">${icon('check')}Serveur connecté (version ${esc(h.data.version || '?')})</li>
        <li class="${h.data.audd ? 'ok' : 'warn'}">${icon(h.data.audd ? 'check' : 'info')}${h.data.audd ? 'Clé AudD configurée' : "Pas de clé AudD : mode d'essai limité à quelques reconnaissances par jour"}</li>
        <li class="${h.data.jamendo ? 'ok' : 'warn'}">${icon(h.data.jamendo ? 'check' : 'info')}${h.data.jamendo ? 'Jamendo activé' : 'Jamendo non activé (facultatif)'}</li>
      </ul>`;
  }
  return `
  <section class="rec-card rec-settings" id="rec-settings">
    <h2>${cfg ? 'Serveur de reconnaissance' : 'Connecte ton serveur de reconnaissance'}</h2>
    ${cfg ? '' : `<p>La reconnaissance passe par ton serveur privé et gratuit (Cloudflare), qui garde les clés secrètes. Crée-le en suivant la partie « Reconnaissance musicale » du guide (README), puis colle ici son adresse et ton code d'accès.</p>`}
    <form id="rec-config" class="rec-form" autocomplete="off">
      <label for="rec-url">Adresse du serveur</label>
      <input class="field" id="rec-url" name="url" type="url" inputmode="url" required placeholder="https://sillon-api.ton-compte.workers.dev" value="${esc(cfg?.url || '')}">
      <label for="rec-secret">Code d'accès (APP_SECRET)</label>
      <input class="field" id="rec-secret" name="secret" type="password" required minlength="16" value="${esc(cfg?.secret || '')}">
      <button class="link rec-gen" type="button" data-action="rec-gen">Générer un code sûr et le copier</button>
      <div class="actions">
        <button class="btn primary" type="submit">Enregistrer et tester</button>
        ${cfg ? '<button class="btn ghost" type="button" data-action="rec-forget">Oublier ce serveur</button>' : ''}
      </div>
    </form>
    ${status}
  </section>`;
}

function privacyHTML() {
  return `
  <details class="rec-privacy">
    <summary>${icon('info')}Ce qui est envoyé, et à qui</summary>
    <ul>
      <li><b>Pour reconnaître</b> : un extrait de 10 s (micro) ou de 12 s (fichier) part vers ton serveur Cloudflare, qui le transmet à AudD pour l'identifier. Rien d'autre : ni ta position, ni ton identité, ni ta bibliothèque.</li>
      <li><b>Le micro</b> n'est allumé que pendant les 10 secondes d'écoute, après ton appui sur le bouton.</li>
      <li><b>Les clés</b> (AudD, Jamendo) restent sur ton serveur. Cet appareil ne garde que l'adresse du serveur et ton code d'accès.</li>
      <li><b>Pour chercher un téléchargement</b> : le titre et l'artiste sont envoyés à Internet Archive (depuis ton téléphone) et à Jamendo (via ton serveur).</li>
      <li><b>Les pochettes</b> s'affichent depuis les serveurs d'Apple, Deezer ou Spotify.</li>
      <li><b>L'historique</b> et les fichiers téléchargés restent sur cet appareil.</li>
    </ul>
    <p class="hint">Conditions d'AudD : <a href="https://audd.io/" target="_blank" rel="noopener noreferrer">audd.io</a>. Internet Archive : <a href="https://archive.org/about/terms.php" target="_blank" rel="noopener noreferrer">conditions</a>. Jamendo : <a href="https://devportal.jamendo.com/api_terms_of_use" target="_blank" rel="noopener noreferrer">conditions de l'API</a>.</p>
  </details>`;
}
