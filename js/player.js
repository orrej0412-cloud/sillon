// Lecteur : un seul <audio>, une file d'attente, la mémoire de position et les contrôles système.
import * as lib from './library.js';
import * as db from './db.js';
import { analyzeCover, placeholderRGB } from './art.js';

const audio = new Audio();
audio.preload = 'auto';

const state = {
  source: [],   // ordre d'origine de la liste lue
  queue: [],    // ordre de lecture réel (mélangé ou non)
  index: -1,
  shuffle: false,
  repeat: 'off', // off | all | one
  context: { label: 'Ma bibliothèque', route: '#/library' },
  art: null,     // { dataUrl, rgb } de la pochette courante
};

const subs = new Set();
export const on = fn => subs.add(fn);
const emit = type => subs.forEach(fn => fn(type));

let objectUrl = null;
let loadedId = null;
let pendingResume = 0;
let markedId = null;
let token = 0;
let lastSave = 0;
let lastMs = 0;

export const get = () => state;
export const el = audio;
export const current = () => lib.getTrack(state.queue[state.index]) || null;
export const duration = () => (Number.isFinite(audio.duration) && audio.duration) || current()?.duration || 0;

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Chargement ---------- */

async function loadIndex(i, autoplay) {
  savePosition();
  const id = state.queue[i];
  const t = lib.getTrack(id);
  if (!t) return;
  state.index = i;
  emit('track');
  persist();
  updateArt(t);

  const my = ++token;
  const blob = await db.get('files', id);
  if (my !== token) return;
  if (!blob) { emit('error'); return; }

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  loadedId = id;
  pendingResume = lib.canResume(t) ? t.position : 0;
  audio.src = objectUrl;
  if (pendingResume) {
    audio.addEventListener('loadedmetadata', () => {
      if (loadedId === id && pendingResume) audio.currentTime = pendingResume;
      pendingResume = 0;
    }, { once: true });
  }
  if (autoplay) {
    try { await audio.play(); } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
  }
}

// Mémorise où l'on s'est arrêté dans le titre chargé.
function savePosition() {
  if (!loadedId || !audio.src || pendingResume) return;
  const t = lib.getTrack(loadedId);
  if (!t) return;
  const d = Number.isFinite(audio.duration) ? audio.duration : t.duration;
  let pos = audio.currentTime || 0;
  if (audio.ended || (d && pos > d - 8) || pos < 5) pos = 0;
  if (Math.abs((t.position || 0) - pos) < 1) return;
  lib.updateTrack(t.id, { position: pos }, true);
}

/* ---------- Commandes ---------- */

export function playList(ids, start = 0, context, { shuffle = false } = {}) {
  if (!ids.length) return;
  if (shuffle) state.shuffle = true;
  if (context) state.context = context;
  state.source = ids.slice();
  const startId = shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[Math.min(start, ids.length - 1)];
  if (state.shuffle) {
    state.queue = [startId, ...shuffled(ids.filter(id => id !== startId))];
    state.index = 0;
  } else {
    state.queue = ids.slice();
    state.index = Math.min(start, ids.length - 1);
  }
  emit('queue');
  emit('modes');
  return loadIndex(state.index, true);
}

export function toggle() {
  const t = current();
  if (!t) return;
  if (loadedId !== t.id || !audio.src) return loadIndex(state.index, true);
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function next(auto = false) {
  if (!state.queue.length) return;
  if (state.index < state.queue.length - 1) return loadIndex(state.index + 1, true);
  if (state.repeat === 'all') {
    if (state.shuffle) { state.queue = shuffled(state.source); emit('queue'); }
    return loadIndex(0, true);
  }
  if (auto) audio.currentTime = 0; // fin de la liste
}

export function prev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3 || (state.index === 0 && state.repeat !== 'all')) return seekTo(0);
  loadIndex(state.index > 0 ? state.index - 1 : state.queue.length - 1, true);
}

export const jumpTo = i => loadIndex(i, true);

export function seekTo(s) {
  if (!audio.src) return;
  pendingResume = 0;
  const d = duration();
  audio.currentTime = Math.max(0, d ? Math.min(s, d - 0.25) : s);
  msPosition(true);
  emit('time');
}
export const seekFraction = f => seekTo(f * duration());
export const seekRel = delta => seekTo((audio.currentTime || 0) + delta);

export function setVolume(v) {
  audio.volume = Math.max(0, Math.min(1, v));
  audio.muted = false;
  persist();
}
export const toggleMute = () => { audio.muted = !audio.muted; };

export function toggleShuffle() {
  state.shuffle = !state.shuffle;
  const cur = state.queue[state.index];
  if (cur) {
    if (state.shuffle) {
      state.queue = [cur, ...shuffled(state.source.filter(id => id !== cur))];
      state.index = 0;
    } else {
      state.queue = state.source.slice();
      state.index = Math.max(0, state.queue.indexOf(cur));
    }
  }
  emit('modes');
  emit('queue');
  persist();
}

export function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  emit('modes');
  persist();
}

export function playNext(ids) {
  if (!current()) return playList(ids, 0);
  state.queue.splice(state.index + 1, 0, ...ids);
  state.source.splice(state.source.indexOf(state.queue[state.index]) + 1, 0, ...ids);
  emit('queue');
  persist();
}

export function addToQueue(ids) {
  if (!current()) return playList(ids, 0);
  state.queue.push(...ids);
  state.source.push(...ids);
  emit('queue');
  persist();
}

// Appelé quand un titre est supprimé de la bibliothèque.
export function forget(id) {
  const curId = state.queue[state.index];
  state.source = state.source.filter(x => x !== id);
  state.queue = state.queue.filter(x => x !== id);
  if (curId === id) {
    loadedId = null;
    token++;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    state.index = Math.min(state.index, state.queue.length - 1);
    if (state.index >= 0) loadIndex(state.index, false);
    else emit('track');
  } else {
    state.index = state.queue.indexOf(curId);
  }
  emit('queue');
  persist();
}

/* ---------- Sauvegarde de la session ---------- */

let persistTimer;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => lib.setSetting('player', {
    source: state.source, queue: state.queue, index: state.index,
    shuffle: state.shuffle, repeat: state.repeat, context: state.context, volume: audio.volume,
  }), 400);
}

export async function restore() {
  const s = await lib.getSetting('player');
  if (!s) return;
  const exists = id => !!lib.getTrack(id);
  const curId = s.queue?.[s.index];
  state.source = (s.source || []).filter(exists);
  state.queue = (s.queue || []).filter(exists);
  state.shuffle = !!s.shuffle;
  state.repeat = s.repeat || 'off';
  if (s.context) state.context = s.context;
  if (typeof s.volume === 'number') audio.volume = s.volume;
  state.index = state.queue.indexOf(curId);
  if (state.index < 0 && state.queue.length) state.index = 0;
  if (state.index >= 0) await loadIndex(state.index, false);
  emit('modes');
}

/* ---------- Événements audio ---------- */

audio.addEventListener('play', () => {
  if (markedId !== loadedId) { markedId = loadedId; lib.markPlayed(loadedId); }
  emit('state');
  msState();
});
audio.addEventListener('pause', () => { emit('state'); savePosition(); msState(); });
audio.addEventListener('timeupdate', () => {
  emit('time');
  const now = Date.now();
  if (now - lastSave > 5000) { lastSave = now; savePosition(); }
  msPosition();
});
audio.addEventListener('loadedmetadata', () => {
  const t = lib.getTrack(loadedId);
  if (t && Number.isFinite(audio.duration) && Math.abs((t.duration || 0) - audio.duration) > 1) {
    lib.updateTrack(t.id, { duration: audio.duration }, true);
  }
  emit('time');
});
audio.addEventListener('ended', () => {
  if (loadedId) lib.updateTrack(loadedId, { position: 0 }, true);
  if (state.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  next(true);
});
audio.addEventListener('volumechange', () => emit('volume'));
audio.addEventListener('error', () => { if (audio.getAttribute('src') && audio.error) emit('error'); });

document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });
window.addEventListener('pagehide', savePosition);

/* ---------- Écran verrouillé / notification (Media Session) ---------- */

const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

if (ms) {
  const handle = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* action non prise en charge */ } };
  handle('play', () => toggle());
  handle('pause', () => audio.pause());
  handle('previoustrack', () => prev());
  handle('nexttrack', () => next());
  handle('seekbackward', d => seekRel(-(d.seekOffset || 10)));
  handle('seekforward', d => seekRel(d.seekOffset || 10));
  handle('seekto', d => seekTo(d.seekTime));
  handle('stop', () => audio.pause());
}

async function updateArt(t) {
  const blob = await lib.coverBlob(t);
  const art = blob ? await analyzeCover(t.coverId, blob) : null;
  if (current()?.id !== t.id) return;
  state.art = art || { dataUrl: null, rgb: placeholderRGB(t) };
  emit('art');
  if (!ms) return;
  const artwork = state.art.dataUrl
    ? [{ src: state.art.dataUrl, sizes: '512x512', type: 'image/jpeg' }]
    : [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }];
  try { ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork }); } catch { /* ignoré */ }
}

function msState() {
  if (ms) ms.playbackState = audio.paused ? 'paused' : 'playing';
}

function msPosition(force) {
  if (!ms?.setPositionState) return;
  const now = Date.now();
  if (!force && now - lastMs < 1000) return;
  lastMs = now;
  const d = audio.duration;
  if (!Number.isFinite(d) || !d) return;
  try { ms.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime, d) }); } catch { /* ignoré */ }
}
