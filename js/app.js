// Point d'entrée : navigation, interactions, lecteur (mini + plein écran), fenêtres.
import * as lib from './library.js';
import * as player from './player.js';
import * as views from './views.js';
import { icon } from './icons.js';
import { esc, fmtTime, fmtBytes, plural } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ui = { libTab: 'titles', libSort: 'added', query: '' };
const els = {
  view: $('#view'), main: $('#main'), mini: $('#mini'), fp: $('#fp'), modal: $('#modal-root'),
  toast: $('#toast'), file: $('#file-input'), folder: $('#folder-input'), drop: $('#dropzone'),
};
let lastRoute = null;
let storageText = '';

/* ---------- Navigation ---------- */

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const i = h.indexOf('/');
  return i < 0 ? { name: h || 'home', arg: null } : { name: h.slice(0, i), arg: decodeURIComponent(h.slice(i + 1)) };
}

const TAB_OF = { home: 'home', library: 'library', album: 'library', artist: 'library', playlists: 'playlists', playlist: 'playlists', favorites: 'favorites' };

function render() {
  const r = parseRoute();
  els.view.innerHTML = views.render(r, ui);
  if (location.hash !== lastRoute) {
    els.view.classList.remove('enter');
    void els.view.offsetWidth;
    els.view.classList.add('enter');
    els.main.scrollTop = 0;
    lastRoute = location.hash;
  }
  const tab = TAB_OF[r.name] || 'home';
  $$('[data-tab]').forEach(a => {
    a.classList.toggle('on', a.dataset.tab === tab);
    a.toggleAttribute('aria-current', a.dataset.tab === tab);
  });
  $$('[data-storage]').forEach(e => { e.textContent = storageText; });
  markCurrent();
}

function navigate(hash) {
  if (fpOpen) {
    // Ferme le lecteur sans revenir en arrière dans l'historique.
    fpOpen = false;
    els.fp.classList.remove('open');
    els.fp.setAttribute('aria-hidden', 'true');
    history.replaceState(null, '');
  }
  location.hash = hash;
}

/* ---------- Actions ---------- */

function playFromList(key, i, opts) {
  const L = views.lists.get(key);
  if (!L?.ids.length) return;
  if (!opts && player.current()?.id === L.ids[i]) return player.toggle();
  player.playList(L.ids, i, L.context, opts);
}

document.addEventListener('click', e => {
  if (e.target.closest('#modal-root')) return;
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id } = el.dataset;
  switch (action) {
    case 'import': els.file.click(); break;
    case 'import-folder': els.folder.click(); break;
    case 'play-item': playFromList(el.dataset.list, +el.dataset.i); break;
    case 'play-list': playFromList(el.dataset.list, 0, { shuffle: false }); break;
    case 'shuffle-list': playFromList(el.dataset.list, 0, { shuffle: true }); break;
    case 'track-menu': trackMenu(id, el.dataset.list); break;
    case 'toggle': player.toggle(); break;
    case 'next': player.next(); break;
    case 'prev': player.prev(); break;
    case 'shuffle': player.toggleShuffle(); toast(player.get().shuffle ? 'Lecture aléatoire activée' : 'Lecture aléatoire désactivée'); break;
    case 'repeat': player.cycleRepeat(); toast({ off: 'Répétition désactivée', all: 'Répéter la liste', one: 'Répéter ce titre' }[player.get().repeat]); break;
    case 'mute': player.toggleMute(); break;
    case 'fav-current': { const t = player.current(); if (t) lib.toggleFav(t.id); break; }
    case 'add-current': { const t = player.current(); if (t) choosePlaylist([t.id]); break; }
    case 'current-menu': { const t = player.current(); if (t) trackMenu(t.id, null); break; }
    case 'goto-artist': { const t = player.current(); if (t) navigate(`#/artist/${encodeURIComponent(t.artist)}`); break; }
    case 'goto-context': navigate(player.get().context.route || '#/library'); break;
    case 'open-player': openPlayer(); break;
    case 'close-player': closePlayer(); break;
    case 'queue-toggle': toggleQueue(); break;
    case 'queue-jump': player.jumpTo(+el.dataset.i); break;
    case 'lib-tab': ui.libTab = el.dataset.value; render(); break;
    case 'back': history.length > 1 ? history.back() : navigate('#/library'); break;
    case 'new-playlist': newPlaylist(); break;
    case 'playlist-add': pickTracks(id); break;
    case 'playlist-rename': renamePlaylist(id); break;
    case 'playlist-delete': deletePlaylist(id); break;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (els.modal.classList.contains('show')) return closeSheet(null);
    if (fpOpen) return closePlayer();
  }
  if (e.target.closest('input, textarea, select') || els.modal.classList.contains('show')) return;
  if (e.key === 'Enter' && e.target.matches('.row[data-action]')) { e.target.click(); return; }
  if (e.code === 'Space' && !e.target.closest('button, a')) { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight') e.shiftKey ? player.next() : player.seekRel(10);
  else if (e.key === 'ArrowLeft') e.shiftKey ? player.prev() : player.seekRel(-10);
});

// Recherche et tri dans la bibliothèque : on ne redessine que les résultats (le champ garde le focus).
els.view.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  ui.query = e.target.value;
  $('#lib-results').innerHTML = views.libraryResults(ui);
  markCurrent();
});
els.view.addEventListener('change', e => {
  if (e.target.id !== 'sort') return;
  ui.libSort = e.target.value;
  $('#lib-results').innerHTML = views.libraryResults(ui);
  markCurrent();
});

/* ---------- Menus et fenêtres ---------- */

let sheetResolve = null;

function openSheet(html, resolve, onMount, cls = '') {
  if (sheetResolve) sheetResolve(null);
  sheetResolve = resolve || (() => {});
  els.modal.innerHTML = `<div class="scrim" data-dismiss></div><div class="sheet ${cls}" role="dialog" aria-modal="true"><div class="grab" aria-hidden="true"></div>${html}</div>`;
  els.modal.classList.remove('show');
  void els.modal.offsetWidth;
  els.modal.classList.add('show');
  const sheet = $('.sheet', els.modal);
  onMount?.(sheet);
  if (!onMount) $('button', sheet)?.focus({ preventScroll: true });
}

function closeSheet(value = null) {
  const resolve = sheetResolve;
  sheetResolve = null;
  els.modal.classList.remove('show');
  setTimeout(() => { if (!els.modal.classList.contains('show')) els.modal.innerHTML = ''; }, 320);
  resolve?.(value);
}

els.modal.addEventListener('click', e => {
  if (e.target.closest('[data-dismiss]')) return closeSheet(null);
  const item = e.target.closest('[data-k]');
  if (item) closeSheet(item.dataset.k);
});

function menu({ head, title, items }) {
  return new Promise(resolve => {
    const top = head
      ? `<div class="sheet-head">${views.coverHTML(head, 'sm')}<div class="meta"><div class="t">${esc(head.title)}</div><div class="a">${esc(head.artist)}</div></div></div>`
      : `<p class="sheet-title">${esc(title)}</p>`;
    openSheet(`${top}<div class="sheet-list">${items.map(it => `
      <button class="sheet-item${it.danger ? ' danger' : ''}" data-k="${esc(it.key)}">${icon(it.icon)}<span>${esc(it.label)}</span>${it.meta ? `<small>${esc(it.meta)}</small>` : ''}</button>`).join('')}</div>`, resolve);
  });
}

function promptText(title, value = '', okLabel = 'Valider') {
  return new Promise(resolve => {
    openSheet(`
      <form class="sheet-form">
        <label class="sheet-title" for="prompt-input">${esc(title)}</label>
        <input class="field" id="prompt-input" maxlength="80" value="${esc(value)}" placeholder="Nom de la playlist" autocomplete="off">
        <div class="sheet-btns"><button type="button" class="btn" data-dismiss>Annuler</button><button type="submit" class="btn primary">${esc(okLabel)}</button></div>
      </form>`, resolve, sheet => {
      const input = $('input', sheet);
      setTimeout(() => { input.focus(); input.select(); }, 60);
      $('form', sheet).addEventListener('submit', e => {
        e.preventDefault();
        const v = input.value.trim();
        if (v) closeSheet(v); else input.focus();
      });
    });
  });
}

function confirmBox(title, text, okLabel) {
  return new Promise(resolve => {
    openSheet(`
      <div class="sheet-form">
        <p class="sheet-title">${esc(title)}</p>
        <p class="sheet-text">${esc(text)}</p>
        <div class="sheet-btns"><button type="button" class="btn" data-dismiss>Annuler</button><button type="button" class="btn danger" data-k="ok">${esc(okLabel)}</button></div>
      </div>`, v => resolve(v === 'ok'));
  });
}

async function trackMenu(id, listKey) {
  const t = lib.getTrack(id);
  if (!t) return;
  const L = listKey ? views.lists.get(listKey) : null;
  const pid = L?.context?.playlistId;
  const k = await menu({
    head: t,
    items: [
      { key: 'next', icon: 'next-up', label: 'Lire ensuite' },
      { key: 'queue', icon: 'queue', label: "Ajouter à la file d'attente" },
      { key: 'playlist', icon: 'list-plus', label: 'Ajouter à une playlist' },
      { key: 'fav', icon: t.fav ? 'heart-fill' : 'heart', label: t.fav ? 'Retirer des favoris' : 'Ajouter aux favoris' },
      lib.canResume(t) && { key: 'restart', icon: 'restart', label: 'Lire depuis le début', meta: `arrêté à ${fmtTime(t.position)}` },
      t.album && { key: 'album', icon: 'disc', label: "Voir l'album" },
      { key: 'artist', icon: 'user', label: "Voir l'artiste" },
      pid && { key: 'unlist', icon: 'minus', label: 'Retirer de cette playlist' },
      { key: 'delete', icon: 'trash', label: 'Supprimer de la bibliothèque', danger: true },
    ].filter(Boolean),
  });
  switch (k) {
    case 'next': player.playNext([id]); toast('Sera lu ensuite'); break;
    case 'queue': player.addToQueue([id]); toast("Ajouté à la file d'attente"); break;
    case 'playlist': choosePlaylist([id]); break;
    case 'fav': await lib.toggleFav(id); toast(t.fav ? 'Ajouté aux favoris' : 'Retiré des favoris'); break;
    case 'restart': {
      await lib.updateTrack(id, { position: 0 }, true);
      if (player.current()?.id === id) player.seekTo(0);
      else if (L) player.playList(L.ids, Math.max(0, L.ids.indexOf(id)), L.context);
      else player.playList([id], 0);
      break;
    }
    case 'album': navigate(`#/album/${encodeURIComponent(lib.albumKey(t))}`); break;
    case 'artist': navigate(`#/artist/${encodeURIComponent(t.artist)}`); break;
    case 'unlist': await lib.removeFromPlaylist(pid, id); toast('Retiré de la playlist'); break;
    case 'delete':
      if (await confirmBox(`Supprimer « ${t.title} » ?`, "Le titre est retiré de l'application. Ton fichier d'origine reste intact sur ton appareil.", 'Supprimer')) {
        player.forget(id);
        await lib.deleteTrack(id);
        toast('Titre supprimé');
        refreshStorage();
      }
      break;
  }
}

async function choosePlaylist(ids) {
  const pls = lib.allPlaylists();
  const k = await menu({
    title: 'Ajouter à une playlist',
    items: [
      { key: '__new', icon: 'plus', label: 'Nouvelle playlist' },
      ...pls.map(p => ({ key: p.id, icon: 'playlist', label: p.name, meta: plural(p.trackIds.length, 'titre', 'titres') })),
    ],
  });
  if (!k) return;
  if (k === '__new') {
    const name = await promptText('Nouvelle playlist', '', 'Créer');
    if (!name) return;
    await lib.createPlaylist(name, ids);
    toast(`Ajouté à « ${name} »`);
  } else {
    const n = await lib.addToPlaylist(k, ids);
    toast(n ? `Ajouté à « ${lib.getPlaylist(k).name} »` : 'Déjà dans cette playlist');
  }
}

async function newPlaylist() {
  const name = await promptText('Nouvelle playlist', '', 'Créer');
  if (!name) return;
  const p = await lib.createPlaylist(name);
  navigate(`#/playlist/${p.id}`);
}

async function renamePlaylist(id) {
  const p = lib.getPlaylist(id);
  const name = await promptText('Renommer la playlist', p.name, 'Renommer');
  if (name && name !== p.name) lib.renamePlaylist(id, name);
}

async function deletePlaylist(id) {
  const p = lib.getPlaylist(id);
  if (!await confirmBox(`Supprimer « ${p.name} » ?`, 'Les titres restent dans ta bibliothèque.', 'Supprimer')) return;
  await lib.deletePlaylist(id);
  navigate('#/playlists');
  toast('Playlist supprimée');
}

// Sélection multiple de titres à ajouter à une playlist.
function pickTracks(pid) {
  const p = lib.getPlaylist(pid);
  if (!p) return;
  const selected = new Set();
  const all = lib.allTracks().sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  const listHTML = q => {
    const ts = q ? lib.search(q).sort((a, b) => a.title.localeCompare(b.title, 'fr')) : all;
    if (!ts.length) return '<p class="hint">Aucun titre trouvé.</p>';
    return ts.map(t => {
      const inside = p.trackIds.includes(t.id);
      return `<button type="button" class="pick${selected.has(t.id) ? ' on' : ''}" data-pick="${t.id}"${inside ? ' disabled' : ''}>
        ${views.coverHTML(t, 'sm')}
        <div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${inside ? 'Déjà dans la playlist' : esc(t.artist)}</div></div>
        <span class="check">${icon('check')}</span></button>`;
    }).join('');
  };
  openSheet(`
    <p class="sheet-title">Ajouter à « ${esc(p.name)} »</p>
    <label class="search">${icon('search')}<input id="pick-q" type="search" placeholder="Rechercher" autocomplete="off" aria-label="Rechercher un titre"></label>
    <div class="pick-list">${listHTML('')}</div>
    <div class="sheet-btns"><button type="button" class="btn" data-dismiss>Annuler</button><button type="button" class="btn primary" id="pick-ok" disabled>Ajouter</button></div>`,
  null, sheet => {
    const list = $('.pick-list', sheet);
    const ok = $('#pick-ok', sheet);
    const sync = () => { ok.disabled = !selected.size; ok.textContent = selected.size ? `Ajouter (${selected.size})` : 'Ajouter'; };
    $('#pick-q', sheet).addEventListener('input', e => { list.innerHTML = listHTML(e.target.value); });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b || b.disabled) return;
      const tid = b.dataset.pick;
      selected.has(tid) ? selected.delete(tid) : selected.add(tid);
      b.classList.toggle('on', selected.has(tid));
      sync();
    });
    ok.addEventListener('click', async () => {
      const n = await lib.addToPlaylist(pid, [...selected]);
      closeSheet(null);
      toast(`${plural(n, 'titre ajouté', 'titres ajoutés')}`);
    });
  }, 'tall');
}

/* ---------- Toast ---------- */

let toastTimer;
function toast(msg, { sticky = false } = {}) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

/* ---------- Import ---------- */

async function doImport(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  navigator.storage?.persist?.().catch(() => {});
  toast(`Import… 0 / ${files.length}`, { sticky: true });
  const r = await lib.importFiles(files, (i, n) => toast(`Import… ${i} / ${n}`, { sticky: true }));
  const parts = [r.added ? plural(r.added, 'titre importé', 'titres importés') : 'Aucun nouveau titre'];
  if (r.duplicates) parts.push(plural(r.duplicates, 'déjà présent', 'déjà présents'));
  if (r.skipped) parts.push(plural(r.skipped, 'fichier ignoré', 'fichiers ignorés'));
  toast(parts.join(' · '));
  refreshStorage();
}

els.file.addEventListener('change', () => { doImport(els.file.files); els.file.value = ''; });
els.folder.addEventListener('change', () => { doImport(els.folder.files); els.folder.value = ''; });

let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; dragDepth++; els.drop.hidden = false; });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; els.drop.hidden = true; } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.drop.hidden = true;
  doImport(e.dataTransfer.files);
});

async function refreshStorage() {
  try {
    const { usage } = await navigator.storage.estimate();
    storageText = `${fmtBytes(usage)} stockés sur cet appareil`;
  } catch {
    storageText = 'stockés sur cet appareil';
  }
  $$('[data-storage]').forEach(e => { e.textContent = storageText; });
}

/* ---------- Lecteur : mise à jour de l'interface ---------- */

let seeking = false;

function markCurrent() {
  const id = player.current()?.id;
  $$('#view [data-action="play-item"]').forEach(el => el.classList.toggle('cur', el.dataset.id === id));
}

function setRange(r, fraction) {
  r.style.setProperty('--p', `${(fraction * 100).toFixed(2)}%`);
}

function updateTrackUI() {
  const t = player.current();
  els.mini.hidden = !t;
  document.body.classList.toggle('has-track', !!t);
  if (!t) {
    if (fpOpen) closePlayer();
    document.title = 'Sillon';
    return;
  }
  $('#mini-art').innerHTML = views.coverHTML(t, 'sm');
  $('#mini-title').textContent = t.title;
  $('#mini-artist').textContent = t.artist;
  $('#fp-art').innerHTML = views.coverHTML(t, 'xl');
  $('#fp-title').textContent = t.title;
  $('#fp-artist').textContent = t.album ? `${t.artist} · ${t.album}` : t.artist;
  $('#fp-ctx').textContent = player.get().context.label;
  document.title = `${t.title} · ${t.artist}`;
  const meta = $('#fp-meta');
  meta.classList.remove('swap');
  void meta.offsetWidth;
  meta.classList.add('swap');
  updateFav();
  updateTime();
  if (queueOpen) $('#fp-queue').innerHTML = views.queueHTML();
}

function updateFav() {
  const fav = !!player.current()?.fav;
  $$('.js-fav').forEach(b => {
    b.innerHTML = icon(fav ? 'heart-fill' : 'heart');
    b.classList.toggle('on', fav);
    b.setAttribute('aria-label', fav ? 'Retirer des favoris' : 'Ajouter aux favoris');
  });
}

function updatePlayState() {
  const playing = !player.el.paused;
  document.body.classList.toggle('is-playing', playing);
  $$('.js-play').forEach(b => {
    b.innerHTML = icon(playing ? 'pause' : 'play');
    b.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
  });
}

function updateTime() {
  const d = player.duration();
  const c = player.el.currentTime || 0;
  const f = d ? Math.min(1, c / d) : 0;
  $('#mini-bar').style.transform = `scaleX(${f})`;
  for (const r of $$('.js-seek')) {
    if (seeking) continue;
    r.value = Math.round(f * 1000);
    setRange(r, f);
  }
  if (!seeking) $$('.js-cur').forEach(e => { e.textContent = fmtTime(c); });
  $$('.js-dur').forEach(e => { e.textContent = fmtTime(d); });
}

function updateModes() {
  const s = player.get();
  $$('.js-shuffle').forEach(b => { b.classList.toggle('on', s.shuffle); b.setAttribute('aria-pressed', s.shuffle); });
  $$('.js-repeat').forEach(b => {
    b.innerHTML = icon(s.repeat === 'one' ? 'repeat-one' : 'repeat');
    b.classList.toggle('on', s.repeat !== 'off');
    b.setAttribute('aria-label', { off: 'Répétition désactivée', all: 'Répéter la liste', one: 'Répéter ce titre' }[s.repeat]);
  });
}

function updateVolume() {
  const a = player.el;
  const v = a.muted ? 0 : a.volume;
  $$('.js-vol').forEach(r => { r.value = Math.round(v * 100); setRange(r, v); });
  $$('.js-mute').forEach(b => { b.innerHTML = icon(v === 0 ? 'mute' : 'volume'); });
}

function updateArt() {
  const rgb = player.get().art?.rgb;
  if (rgb) document.documentElement.style.setProperty('--dyn', rgb.join(','));
}

player.on(type => {
  switch (type) {
    case 'track': updateTrackUI(); markCurrent(); break;
    case 'state': updatePlayState(); break;
    case 'time': updateTime(); break;
    case 'queue': if (queueOpen) $('#fp-queue').innerHTML = views.queueHTML(); break;
    case 'modes': updateModes(); break;
    case 'volume': updateVolume(); break;
    case 'art': updateArt(); break;
    case 'error': toast('Ce fichier ne peut pas être lu sur cet appareil'); break;
  }
});

for (const r of $$('.js-seek')) {
  r.addEventListener('input', () => {
    seeking = true;
    const f = r.value / 1000;
    setRange(r, f);
    $$('.js-cur').forEach(e => { e.textContent = fmtTime(f * player.duration()); });
  });
  r.addEventListener('change', () => { player.seekFraction(r.value / 1000); seeking = false; });
}
for (const r of $$('.js-vol')) r.addEventListener('input', () => player.setVolume(r.value / 100));

/* ---------- Lecteur plein écran ---------- */

let fpOpen = false;
let queueOpen = false;

function openPlayer() {
  if (!player.current() || fpOpen) return;
  fpOpen = true;
  els.fp.classList.add('open');
  els.fp.setAttribute('aria-hidden', 'false');
  history.pushState({ fp: true }, '');
  $('[data-action="close-player"]', els.fp).focus({ preventScroll: true });
}

function closePlayer({ viaHistory = false } = {}) {
  if (!fpOpen) return;
  fpOpen = false;
  els.fp.classList.remove('open');
  els.fp.setAttribute('aria-hidden', 'true');
  if (!viaHistory && history.state?.fp) history.back();
}

// Bouton « retour » d'Android : ferme le lecteur au lieu de quitter l'appli.
window.addEventListener('popstate', () => { if (fpOpen && !history.state?.fp) closePlayer({ viaHistory: true }); });

function toggleQueue() {
  queueOpen = !queueOpen;
  $('#fp-queue').hidden = !queueOpen;
  $('#fp-art').hidden = queueOpen;
  $('#fp-qbtn').classList.toggle('on', queueOpen);
  if (queueOpen) $('#fp-queue').innerHTML = views.queueHTML();
}

// Glisser vers le bas pour fermer (mobile).
{
  let startY = null;
  let dy = 0;
  els.fp.addEventListener('touchstart', e => {
    if (e.target.closest('input, .fp-queue')) return;
    startY = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  els.fp.addEventListener('touchmove', e => {
    if (startY === null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 8) { els.fp.style.transition = 'none'; els.fp.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  els.fp.addEventListener('touchend', () => {
    if (startY === null) return;
    startY = null;
    els.fp.style.transition = '';
    els.fp.style.transform = '';
    if (dy > 110) closePlayer();
  });
}

/* ---------- Démarrage ---------- */

lib.onChange(type => {
  if (type === 'played' && parseRoute().name !== 'home') return;
  render();
  if (type === 'tracks') updateFav();
});

window.addEventListener('hashchange', render);

$$('[data-icon]').forEach(el => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

async function init() {
  await lib.load();
  await player.restore();
  render();
  updateTrackUI();
  updatePlayState();
  updateModes();
  updateVolume();
  refreshStorage();
}

init().catch(err => {
  console.error(err);
  els.view.innerHTML = `<div class="empty"><h1 class="h2">Impossible d'ouvrir ta bibliothèque</h1><p>${esc(err.message || err)}</p><p class="hint">Vérifie que le navigateur n'est pas en navigation privée.</p></div>`;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker :', err));
}
