// Écrans de l'application (gabarits HTML). Aucune logique de lecture ici.
import * as lib from './library.js';
import * as player from './player.js';
import { icon } from './icons.js';
import { esc, fmtTime, fmtTotal, hue, plural, matches } from './util.js';

// Chaque liste affichée est enregistrée : un clic sur une ligne sait quelle file d'attente lancer.
export const lists = new Map();
const reg = (key, tracks, context) => lists.set(key, { ids: tracks.map(t => t.id), context });

const totalOf = ts => ts.reduce((s, t) => s + (t.duration || 0), 0);
const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';

/* ---------- Composants ---------- */

export function coverHTML(t, cls = '', { eq = false } = {}) {
  const url = lib.coverOf(t);
  const style = url ? `background-image:url('${url}')` : `--h:${hue(t?.album || t?.title || '')}`;
  return `<div class="cover ${cls}${url ? '' : ' ph'}" style="${style}">${url ? '' : icon('note')}${eq ? EQ : ''}</div>`;
}

function mosaic(tracks, cls, name) {
  const seen = new Set();
  const withCover = tracks.filter(t => {
    const url = lib.coverOf(t);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  if (withCover.length >= 4) {
    return `<div class="cover mosaic ${cls}">${withCover.slice(0, 4).map(t => `<span style="background-image:url('${lib.coverOf(t)}')"></span>`).join('')}</div>`;
  }
  if (withCover.length) return coverHTML(withCover[0], cls);
  return `<div class="cover ph ${cls}" style="--h:${hue(name)}">${icon('playlist')}</div>`;
}

function row(t, key, i, { num = false } = {}) {
  const resume = lib.canResume(t)
    ? `<div class="resume-bar" title="Reprise à ${fmtTime(t.position)}"><span style="width:${Math.round((t.position / t.duration) * 100)}%"></span></div>` : '';
  const lead = num
    ? `<span class="num"><b>${t.trackNo || i + 1}</b>${EQ}</span>`
    : coverHTML(t, 'sm', { eq: true });
  return `<div class="row" data-action="play-item" data-list="${key}" data-i="${i}" data-id="${t.id}" tabindex="0">
    ${lead}
    <div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${t.fav ? `<span class="fav-dot">${icon('heart-fill')}</span>` : ''}${esc(t.artist)}${t.album && !num ? ` · ${esc(t.album)}` : ''}</div>${resume}</div>
    <span class="dur">${fmtTime(t.duration)}</span>
    <button class="ic" data-action="track-menu" data-id="${t.id}" data-list="${key}" data-i="${i}" aria-label="Options pour ${esc(t.title)}">${icon('more')}</button>
  </div>`;
}

const trackList = (tracks, key, opts) => `<div class="tracks">${tracks.map((t, i) => row(t, key, i, opts)).join('')}</div>`;

function shelf(tracks, key, { resume = false } = {}) {
  return `<div class="shelf">${tracks.map((t, i) => `
    <button class="card" data-action="play-item" data-list="${key}" data-i="${i}" data-id="${t.id}">
      ${coverHTML(t, '', { eq: true })}
      ${resume ? `<div class="resume-bar"><span style="width:${Math.round((t.position / t.duration) * 100)}%"></span></div>` : ''}
      <div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${resume ? `Reprise à ${fmtTime(t.position)}` : esc(t.artist)}</div></div>
    </button>`).join('')}</div>`;
}

const plCard = p => `
  <a class="card" href="#/playlist/${p.id}">
    ${mosaic(lib.playlistTracks(p), '', p.name)}
    <div class="meta"><div class="t">${esc(p.name)}</div><div class="a">${plural(p.trackIds.length, 'titre', 'titres')}</div></div>
  </a>`;

function albumCard(a) {
  const withCover = a.tracks.find(t => lib.coverOf(t)) || a.tracks[0];
  return `<a class="card" href="#/album/${encodeURIComponent(a.key)}">
    ${coverHTML(withCover)}
    <div class="meta"><div class="t">${esc(a.name)}</div><div class="a">${esc(a.artist)}${a.year ? ` · ${esc(a.year)}` : ''}</div></div>
  </a>`;
}

const section = (title, body, href) => `
  <section class="sec">
    <div class="sec-h"><h2>${title}</h2>${href ? `<a class="link" href="${href}">Tout voir</a>` : ''}</div>
    ${body}
  </section>`;

const playActions = (key, extra = '') => `
  <div class="actions">
    <button class="btn primary" data-action="play-list" data-list="${key}">${icon('play')}Lire</button>
    <button class="btn" data-action="shuffle-list" data-list="${key}">${icon('shuffle')}Aléatoire</button>
    ${extra}
  </div>`;

const backBtn = () => `<button class="ic back-btn" data-action="back" aria-label="Retour">${icon('back')}</button>`;

const notFound = msg => `${backBtn()}<div class="empty"><h1 class="h2">${msg}</h1><a class="btn" href="#/library">Aller à ma bibliothèque</a></div>`;

function emptyLibrary() {
  return `<div class="empty hero-empty">
    <div class="vinyl" aria-hidden="true"><span></span></div>
    <h1 class="h1">Ta musique,<br>rien qu'à toi.</h1>
    <p>Importe tes fichiers MP3, FLAC, WAV ou M4A. Ils sont copiés dans le stockage privé de l'application et ne quittent jamais cet appareil.</p>
    <div class="actions center">
      <button class="btn primary" data-action="import">${icon('upload')}Importer des fichiers</button>
      <button class="btn desk" data-action="import-folder">${icon('folder')}Importer un dossier</button>
    </div>
    <p class="hint desk">Tu peux aussi glisser-déposer des fichiers n'importe où dans la fenêtre.</p>
  </div>`;
}

/* ---------- Écrans ---------- */

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
}

function home() {
  const all = lib.allTracks();
  if (!all.length) return emptyLibrary();
  const byAdded = all.slice().sort((a, b) => b.addedAt - a.addedAt);
  const resume = all.filter(lib.canResume).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt).slice(0, 10);
  const recent = all.filter(t => t.lastPlayedAt).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt).slice(0, 12);
  const pls = lib.allPlaylists().slice(0, 10);
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  reg('all', byAdded, { label: 'Ma bibliothèque', route: '#/library' });
  reg('resume', resume, { label: "Reprendre l'écoute", route: '#/home' });
  reg('recent', recent, { label: 'Écoutés récemment', route: '#/home' });
  reg('added', byAdded.slice(0, 8), { label: 'Ajoutés récemment', route: '#/library' });

  return `
  <header class="page-h">
    <h1 class="h1">${greeting()}</h1>
    <p class="sub"><span class="cap">${esc(date)}</span> · ${plural(all.length, 'titre', 'titres')} · ${fmtTotal(totalOf(all))} de musique</p>
    <div class="actions">
      <button class="btn primary" data-action="play-list" data-list="all">${icon('play')}Tout lire</button>
      <button class="btn" data-action="shuffle-list" data-list="all">${icon('shuffle')}Aléatoire</button>
      <button class="btn ghost" data-action="import">${icon('upload')}Importer</button>
    </div>
  </header>
  ${resume.length ? section("Reprendre l'écoute", shelf(resume, 'resume', { resume: true })) : ''}
  ${section('Écoutés récemment', recent.length ? shelf(recent, 'recent') : '<p class="hint">Les titres que tu écoutes apparaîtront ici.</p>')}
  ${pls.length ? section('Tes playlists', `<div class="shelf">${pls.map(plCard).join('')}</div>`, '#/playlists') : ''}
  ${section('Ajoutés récemment', trackList(byAdded.slice(0, 8), 'added'), '#/library')}`;
}

function library(ui) {
  const all = lib.allTracks();
  if (!all.length) return emptyLibrary();
  const tabs = [['titles', 'Titres'], ['albums', 'Albums'], ['artists', 'Artistes']];
  const sorts = [['added', 'Ajout récent'], ['title', 'Titre'], ['artist', 'Artiste'], ['album', 'Album']];
  return `
  <header class="page-h">
    <h1 class="h1">Ma bibliothèque</h1>
    <p class="sub">${plural(all.length, 'titre', 'titres')} · <span data-storage></span></p>
  </header>
  <div class="toolbar">
    <label class="search">${icon('search')}<input id="q" type="search" placeholder="Titre, artiste ou album" value="${esc(ui.query)}" autocomplete="off" enterkeyhint="search" aria-label="Rechercher"></label>
    <button class="btn primary" data-action="import">${icon('upload')}<span class="desk-label">Importer</span></button>
    <button class="btn desk" data-action="import-folder">${icon('folder')}Dossier</button>
  </div>
  <div class="seg-row">
    <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button class="chip${ui.libTab === k ? ' on' : ''}" data-action="lib-tab" data-value="${k}" role="tab" aria-selected="${ui.libTab === k}">${l}</button>`).join('')}</div>
    ${ui.libTab === 'titles' ? `<select id="sort" class="select" aria-label="Trier par">${sorts.map(([k, l]) => `<option value="${k}"${ui.libSort === k ? ' selected' : ''}>${l}</option>`).join('')}</select>` : ''}
  </div>
  <div id="lib-results">${libraryResults(ui)}</div>`;
}

const noResult = q => `<div class="empty small"><p>Aucun résultat pour « ${esc(q)} ».</p></div>`;

const SORTERS = {
  added: (a, b) => b.addedAt - a.addedAt,
  title: (a, b) => a.title.localeCompare(b.title, 'fr'),
  artist: (a, b) => a.artist.localeCompare(b.artist, 'fr') || a.title.localeCompare(b.title, 'fr'),
  album: (a, b) => (a.album || '~').localeCompare(b.album || '~', 'fr') || (a.trackNo || 0) - (b.trackNo || 0),
};

export function libraryResults(ui) {
  const q = ui.query;
  if (ui.libTab === 'albums') {
    const as = lib.albums().filter(a => matches(q, `${a.name} ${a.artist}`));
    return as.length ? `<div class="grid">${as.map(albumCard).join('')}</div>` : (q ? noResult(q) : '<p class="hint">Aucun album : tes fichiers n\'indiquent pas d\'album dans leurs métadonnées.</p>');
  }
  if (ui.libTab === 'artists') {
    const ar = lib.artists().filter(a => matches(q, a.name));
    if (!ar.length) return noResult(q);
    return `<div class="tracks">${ar.map(a => `
      <a class="row" href="#/artist/${encodeURIComponent(a.name)}">
        ${coverHTML(a.tracks.find(t => lib.coverOf(t)) || a.tracks[0], 'sm round')}
        <div class="meta"><div class="t">${esc(a.name)}</div><div class="a">${plural(a.tracks.length, 'titre', 'titres')}</div></div>
        <span></span><span class="ic">${icon('chevron')}</span>
      </a>`).join('')}</div>`;
  }
  const ts = lib.search(q).sort(SORTERS[ui.libSort] || SORTERS.added);
  reg('lib', ts, { label: q ? `Recherche « ${q} »` : 'Ma bibliothèque', route: '#/library' });
  return ts.length ? `<p class="count">${plural(ts.length, 'titre', 'titres')}</p>${trackList(ts, 'lib')}` : noResult(q);
}

function albumView(key) {
  const a = lib.album(key);
  if (!a) return notFound('Album introuvable');
  reg('album', a.tracks, { label: a.name, route: `#/album/${encodeURIComponent(key)}` });
  return `${backBtn()}
  <header class="hero">
    ${coverHTML(a.tracks.find(t => lib.coverOf(t)) || a.tracks[0], 'hero-cover')}
    <div class="hero-txt">
      <h1 class="h1">${esc(a.name)}</h1>
      <p class="sub">Album de <a class="ulink" href="#/artist/${encodeURIComponent(a.artist)}">${esc(a.artist)}</a>${a.year ? ` · ${esc(a.year)}` : ''} · ${plural(a.tracks.length, 'titre', 'titres')} · ${fmtTotal(totalOf(a.tracks))}</p>
      ${playActions('album')}
    </div>
  </header>
  ${trackList(a.tracks, 'album', { num: true })}`;
}

function artistView(name) {
  const ts = lib.artistTracks(name);
  if (!ts.length) return notFound('Artiste introuvable');
  reg('artist', ts, { label: name, route: `#/artist/${encodeURIComponent(name)}` });
  const albums = new Set(ts.map(t => t.album).filter(Boolean)).size;
  return `${backBtn()}
  <header class="hero">
    ${coverHTML(ts.find(t => lib.coverOf(t)) || ts[0], 'hero-cover round')}
    <div class="hero-txt">
      <h1 class="h1">${esc(ts[0].artist)}</h1>
      <p class="sub">Artiste · ${plural(ts.length, 'titre', 'titres')}${albums ? ` · ${plural(albums, 'album', 'albums')}` : ''} · ${fmtTotal(totalOf(ts))}</p>
      ${playActions('artist')}
    </div>
  </header>
  ${trackList(ts, 'artist')}`;
}

function playlistsView() {
  const pls = lib.allPlaylists();
  const favs = lib.favorites();
  return `
  <header class="page-h split">
    <div><h1 class="h1">Playlists</h1><p class="sub">${plural(pls.length, 'playlist', 'playlists')}</p></div>
    <button class="btn primary" data-action="new-playlist">${icon('plus')}Nouvelle playlist</button>
  </header>
  <div class="grid">
    <a class="card" href="#/favorites">
      <div class="cover fav-cover">${icon('heart-fill')}</div>
      <div class="meta"><div class="t">Favoris</div><div class="a">${plural(favs.length, 'titre', 'titres')}</div></div>
    </a>
    ${pls.map(plCard).join('')}
  </div>
  ${pls.length ? '' : '<p class="hint">Crée ta première playlist, puis ajoute des titres avec le bouton « Ajouter des titres » ou depuis le menu ⋯ de chaque morceau.</p>'}`;
}

function playlistView(id) {
  const p = lib.getPlaylist(id);
  if (!p) return notFound('Playlist introuvable');
  const ts = lib.playlistTracks(p);
  reg('pl', ts, { label: p.name, route: `#/playlist/${id}`, playlistId: id });
  const tools = `
    <button class="ic" data-action="playlist-add" data-id="${id}" aria-label="Ajouter des titres" title="Ajouter des titres">${icon('list-plus')}</button>
    <button class="ic" data-action="playlist-rename" data-id="${id}" aria-label="Renommer" title="Renommer">${icon('edit')}</button>
    <button class="ic" data-action="playlist-delete" data-id="${id}" aria-label="Supprimer la playlist" title="Supprimer la playlist">${icon('trash')}</button>`;
  return `${backBtn()}
  <header class="hero">
    ${mosaic(ts, 'hero-cover', p.name)}
    <div class="hero-txt">
      <h1 class="h1">${esc(p.name)}</h1>
      <p class="sub">Playlist · ${plural(ts.length, 'titre', 'titres')}${ts.length ? ` · ${fmtTotal(totalOf(ts))}` : ''}</p>
      ${ts.length ? playActions('pl', tools) : `<div class="actions">${tools}</div>`}
    </div>
  </header>
  ${ts.length ? trackList(ts, 'pl') : `<div class="empty small"><p>Cette playlist est vide.</p><button class="btn primary" data-action="playlist-add" data-id="${id}">${icon('plus')}Ajouter des titres</button></div>`}`;
}

function favoritesView() {
  const favs = lib.favorites();
  reg('fav', favs, { label: 'Favoris', route: '#/favorites' });
  return `
  <header class="hero">
    <div class="cover hero-cover fav-cover">${icon('heart-fill')}</div>
    <div class="hero-txt">
      <h1 class="h1">Favoris</h1>
      <p class="sub">${plural(favs.length, 'titre', 'titres')}${favs.length ? ` · ${fmtTotal(totalOf(favs))}` : ''}</p>
      ${favs.length ? playActions('fav') : ''}
    </div>
  </header>
  ${favs.length ? trackList(favs, 'fav') : `<div class="empty small"><p>Touche ${icon('heart')} sur un titre pour le retrouver ici.</p></div>`}`;
}

export function render(r, ui) {
  switch (r.name) {
    case 'library': return library(ui);
    case 'album': return albumView(r.arg);
    case 'artist': return artistView(r.arg);
    case 'playlists': return playlistsView();
    case 'playlist': return playlistView(r.arg);
    case 'favorites': return favoritesView();
    default: return home();
  }
}

/* ---------- File d'attente (lecteur plein écran) ---------- */

export function queueHTML() {
  const s = player.get();
  const cur = player.current();
  if (!cur) return '';
  const qrow = (t, i, isCur) => `
    <div class="row${isCur ? ' cur' : ''}" data-action="queue-jump" data-i="${i}" tabindex="0">
      ${coverHTML(t, 'sm', { eq: true })}
      <div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist)}</div></div>
      <span class="dur">${fmtTime(t.duration)}</span><span></span>
    </div>`;
  const upcoming = s.queue.slice(s.index + 1, s.index + 101)
    .map((id, k) => [lib.getTrack(id), s.index + 1 + k]).filter(([t]) => t);
  return `
    <p class="q-h">En cours</p>${qrow(cur, s.index, true)}
    <p class="q-h">À suivre${s.shuffle ? ' · aléatoire' : ''}</p>
    ${upcoming.length ? upcoming.map(([t, i]) => qrow(t, i, false)).join('') : '<p class="hint">Rien après ce titre.</p>'}`;
}
