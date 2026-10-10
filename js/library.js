// Bibliothèque : titres, pochettes, playlists, favoris. Tout est en mémoire + IndexedDB.
import * as db from './db.js';
import { readTags, probeMedia } from './metadata.js';
import { uid, norm, matches } from './util.js';
import { forgetCover } from './art.js';

const tracks = new Map();
const playlists = new Map();
const covers = new Map(); // coverId -> object URL
const listeners = new Set();

export const onChange = fn => listeners.add(fn);
const emit = type => listeners.forEach(fn => fn(type));

export async function load() {
  const [ts, ps, cv] = await Promise.all([db.getAll('tracks'), db.getAll('playlists'), db.entries('covers')]);
  ts.forEach(t => tracks.set(t.id, t));
  ps.forEach(p => playlists.set(p.id, p));
  cv.forEach(([key, blob]) => covers.set(key, URL.createObjectURL(blob)));
}

/* ---------- Titres ---------- */

export const getTrack = id => tracks.get(id);
export const allTracks = () => [...tracks.values()];
export const coverOf = t => (t?.coverId && covers.get(t.coverId)) || null;
export const coverBlob = t => (t?.coverId ? db.get('covers', t.coverId) : Promise.resolve(null));
export const canResume = t => t.position > 5 && t.duration > 0 && t.position < t.duration - 8;
export const albumKey = t => `${norm(t.albumArtist || t.artist)}|${norm(t.album)}`;

export async function updateTrack(id, patch, silent = false) {
  const t = tracks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  await db.put('tracks', t);
  if (!silent) emit('tracks');
}

export function markPlayed(id) {
  const t = tracks.get(id);
  if (!t) return;
  t.lastPlayedAt = Date.now();
  t.playCount = (t.playCount || 0) + 1;
  db.put('tracks', t);
  emit('played');
}

export const toggleFav = id => {
  const t = tracks.get(id);
  return updateTrack(id, { fav: !t.fav, favAt: Date.now() });
};

// Remplace la pochette d'un seul titre (ex. pochette trouvée par la reconnaissance).
export async function setTrackCover(id, blob) {
  const t = tracks.get(id);
  if (!t || !blob) return;
  const coverId = `t:${id}`;
  await db.put('covers', blob, coverId);
  if (covers.has(coverId)) URL.revokeObjectURL(covers.get(coverId));
  covers.set(coverId, URL.createObjectURL(blob));
  forgetCover(coverId);
  await updateTrack(id, { coverId });
}

export const favorites = () => allTracks().filter(t => t.fav).sort((a, b) => (b.favAt || 0) - (a.favAt || 0));

export const search = q => allTracks().filter(t => matches(q, `${t.title} ${t.artist} ${t.album}`));

export async function deleteTrack(id) {
  const t = tracks.get(id);
  if (!t) return;
  tracks.delete(id);
  await db.removeTrack(id);
  for (const p of playlists.values()) {
    if (!p.trackIds.includes(id)) continue;
    p.trackIds = p.trackIds.filter(x => x !== id);
    await db.put('playlists', p);
  }
  if (t.coverId && !allTracks().some(x => x.coverId === t.coverId)) {
    await db.del('covers', t.coverId);
    URL.revokeObjectURL(covers.get(t.coverId));
    covers.delete(t.coverId);
  }
  emit('tracks');
}

// Recalcule les durées manquantes (titres importés pendant qu'un bug les mettait à 0).
export async function repairDurations() {
  let fixed = 0;
  for (const t of allTracks().filter(x => !x.duration)) {
    const blob = await db.get('files', t.id);
    if (!blob) continue;
    const { duration } = await probeMedia(blob);
    if (duration) { await updateTrack(t.id, { duration }, true); fixed++; }
  }
  if (fixed) emit('tracks');
  return fixed;
}

/* ---------- Albums & artistes ---------- */

const byTrackNo = (a, b) => (a.trackNo || 999) - (b.trackNo || 999) || a.title.localeCompare(b.title, 'fr');

export function albums() {
  const map = new Map();
  for (const t of tracks.values()) {
    if (!t.album) continue;
    const key = albumKey(t);
    let a = map.get(key);
    if (!a) map.set(key, a = { key, name: t.album, artist: t.albumArtist || t.artist, year: t.year, tracks: [] });
    a.tracks.push(t);
  }
  for (const a of map.values()) a.tracks.sort(byTrackNo);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export const album = key => albums().find(a => a.key === key);

export function artists() {
  const map = new Map();
  for (const t of tracks.values()) {
    const key = norm(t.artist);
    if (!map.has(key)) map.set(key, { name: t.artist, tracks: [] });
    map.get(key).tracks.push(t);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export function artistTracks(name) {
  const n = norm(name);
  return allTracks()
    .filter(t => norm(t.artist) === n || norm(t.albumArtist) === n)
    .sort((a, b) => (a.album || '').localeCompare(b.album || '', 'fr') || byTrackNo(a, b));
}

/* ---------- Import ---------- */

const MEDIA_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|weba|webm|mp4|m4v|mov|aiff?)$/i;
const MIME = {
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'video/mp4',
  m4v: 'video/mp4', mov: 'video/quicktime', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', weba: 'audio/webm', webm: 'video/webm', aif: 'audio/aiff', aiff: 'audio/aiff',
};

// Sons et clips vidéo : un clip est un titre comme un autre, avec une image en plus.
export const isMedia = f => f.type.startsWith('audio/') || f.type.startsWith('video/') || MEDIA_EXT.test(f.name);

// "01 - Artiste - Titre.mp3" -> { artist, title }
function guessFromName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\d{1,3}\s*[-.)]\s*/, '');
  const parts = base.split(' - ');
  return parts.length >= 2
    ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
    : { title: base };
}

// Retourne { added, duplicates, skipped, ids (nouveaux titres), existing (titres déjà présents) }.
export async function importFiles(files, onProgress) {
  const seen = new Map(allTracks().map(t => [`${t.fileName}|${t.size}`, t.id]));
  const result = { added: 0, duplicates: 0, skipped: 0, ids: [], existing: [] };

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.(i + 1, files.length, f.name);
    if (!isMedia(f)) { result.skipped++; continue; }
    const dupKey = `${f.name}|${f.size}`;
    if (seen.has(dupKey)) { result.duplicates++; result.existing.push(seen.get(dupKey)); continue; }

    try {
      const tags = await readTags(f);
      const guess = guessFromName(f.name);
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const media = await probeMedia(f);
      let mime = f.type || MIME[ext] || 'audio/mpeg';
      if (media.hasVideo) mime = mime.replace(/^audio\//, 'video/');
      else mime = mime.replace(/^video\//, 'audio/');
      const id = uid();
      const track = {
        id,
        title: tags.title || guess.title || f.name,
        artist: tags.artist || tags.albumArtist || guess.artist || 'Artiste inconnu',
        album: tags.album || '',
        albumArtist: tags.albumArtist || '',
        trackNo: tags.track || 0,
        year: tags.year || '',
        duration: media.duration,
        video: media.hasVideo,
        mime,
        fileName: f.name,
        size: f.size,
        coverId: null,
        fav: false,
        position: 0,
        playCount: 0,
        lastPlayedAt: 0,
        addedAt: Date.now(),
      };

      // Une pochette par album : on la partage entre les titres du même album.
      const sharedKey = track.album ? `a:${albumKey(track)}` : null;
      let coverData = null;
      if (tags.picture?.data?.length) {
        track.coverId = sharedKey || `t:${id}`;
        if (!covers.has(track.coverId)) coverData = new Blob([tags.picture.data], { type: tags.picture.mime });
      } else if (media.poster) {
        track.coverId = `t:${id}`; // image tirée du clip
        coverData = media.poster;
      } else if (sharedKey && covers.has(sharedKey)) {
        track.coverId = sharedKey;
      }

      // Copie du fichier dans le stockage privé de l'appli.
      const data = new Blob([await f.arrayBuffer()], { type: mime });
      await db.addTrack(track, data, coverData);
      tracks.set(id, track);
      if (coverData) covers.set(track.coverId, URL.createObjectURL(coverData));
      seen.set(dupKey, id);
      result.added++;
      result.ids.push(id);
      if (result.added % 5 === 0) emit('tracks');
    } catch (err) {
      console.error('Import impossible :', f.name, err);
      result.skipped++;
    }
  }
  emit('tracks');
  return result;
}

/* ---------- Playlists ---------- */

export const getPlaylist = id => playlists.get(id);
export const allPlaylists = () => [...playlists.values()].sort((a, b) => b.updatedAt - a.updatedAt);
export const playlistTracks = p => p.trackIds.map(id => tracks.get(id)).filter(Boolean);

async function savePlaylist(p) {
  p.updatedAt = Date.now();
  playlists.set(p.id, p);
  await db.put('playlists', p);
  emit('playlists');
}

export async function createPlaylist(name, trackIds = []) {
  const p = { id: uid(), name, trackIds: [...new Set(trackIds)], createdAt: Date.now(), updatedAt: Date.now() };
  await savePlaylist(p);
  return p;
}

export async function addToPlaylist(pid, ids) {
  const p = playlists.get(pid);
  const fresh = ids.filter(id => !p.trackIds.includes(id));
  p.trackIds.push(...fresh);
  await savePlaylist(p);
  return fresh.length;
}

export async function removeFromPlaylist(pid, trackId) {
  const p = playlists.get(pid);
  p.trackIds = p.trackIds.filter(id => id !== trackId);
  await savePlaylist(p);
}

export async function renamePlaylist(pid, name) {
  const p = playlists.get(pid);
  p.name = name;
  await savePlaylist(p);
}

export async function deletePlaylist(pid) {
  playlists.delete(pid);
  await db.del('playlists', pid);
  emit('playlists');
}

/* ---------- Réglages ---------- */

export const getSetting = key => db.get('settings', key);
export const setSetting = (key, value) => db.put('settings', value, key);
