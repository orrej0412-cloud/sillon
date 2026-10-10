// Tests du serveur avec des réponses AudD/Jamendo SIMULÉES (aucun appel réseau ici).
// Ils vérifient la logique du serveur, pas la reconnaissance réelle.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';

const ENV = { APP_SECRET: 'secret-de-test', AUDD_API_TOKEN: 'cle-audd', ALLOWED_ORIGINS: 'https://app.example' };
const AUTH = { Authorization: 'Bearer secret-de-test', Origin: 'https://app.example' };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const call = (path, init = {}, env = ENV) => worker.fetch(new Request(`https://api.example${path}`, init), env);
const mockFetch = handler => { globalThis.fetch = async (input, init) => handler(String(input?.url || input), init); };
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('refuse sans code d’accès (401) et avec un mauvais code', async () => {
  assert.equal((await call('/health', { headers: { Origin: 'https://app.example' } })).status, 401);
  assert.equal((await call('/health', { headers: { ...AUTH, Authorization: 'Bearer faux' } })).status, 401);
});

test('refuse tout si APP_SECRET n’est pas configuré', async () => {
  const res = await call('/health', { headers: AUTH }, { ...ENV, APP_SECRET: '' });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'setup');
});

test('CORS : origine autorisée renvoyée, origine inconnue refusée, pré-requête OK', async () => {
  const ok = await call('/health', { headers: AUTH });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  assert.deepEqual(await ok.json(), { ok: true, version: '1.0.0', audd: true, jamendo: false });

  const bad = await call('/health', { headers: { ...AUTH, Origin: 'https://pirate.example' } });
  assert.equal(bad.status, 403);

  const pre = await call('/recognize', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('recognize : transmet la clé et le fichier à AudD, normalise le résultat', async () => {
  let sent;
  mockFetch(async (url, init) => {
    assert.equal(url, 'https://api.audd.io/');
    sent = init.body;
    return jsonResponse({
      status: 'success',
      result: {
        artist: 'Tears For Fears', title: 'Everybody Wants To Rule The World', album: 'Songs From The Big Chair',
        release_date: '1985-02-25', label: 'Mercury', timecode: '00:56', song_link: 'https://lis.tn/NbkVb',
        apple_music: { artwork: { url: 'https://is1-ssl.mzstatic.com/x/{w}x{h}bb.jpg' }, url: 'https://music.apple.com/x', isrc: 'GBF088590110', durationInMillis: 251000 },
        spotify: { external_urls: { spotify: 'https://open.spotify.com/track/x' } },
        deezer: { link: 'https://www.deezer.com/track/1' },
      },
    });
  });
  const res = await call('/recognize', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'audio/wav' }, body: new Uint8Array([1, 2, 3]) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'match');
  assert.equal(data.match.title, 'Everybody Wants To Rule The World');
  assert.equal(data.match.cover, 'https://is1-ssl.mzstatic.com/x/600x600bb.jpg');
  assert.equal(data.match.duration, 251);
  assert.equal(data.match.links.spotify, 'https://open.spotify.com/track/x');
  assert.equal(sent.get('api_token'), 'cle-audd');
  assert.equal(sent.get('return'), 'apple_music,spotify,deezer');
  assert.equal(sent.get('file').name, 'extrait.wav');
  assert.equal(sent.get('file').size, 3);
});

test('recognize : aucun résultat -> status none', async () => {
  mockFetch(async () => jsonResponse({ status: 'success', result: null }));
  const res = await call('/recognize', { method: 'POST', headers: AUTH, body: new Uint8Array([1]) });
  assert.deepEqual(await res.json(), { status: 'none', keyed: true });
});

test('recognize : erreurs AudD traduites (clé, quota, audio)', async () => {
  const cases = [[900, 502, 'audd_token'], [901, 429, 'audd_quota'], [300, 422, 'audio']];
  for (const [code, status, error] of cases) {
    mockFetch(async () => jsonResponse({ status: 'error', error: { error_code: code, error_message: 'x' } }));
    const res = await call('/recognize', { method: 'POST', headers: AUTH, body: new Uint8Array([1]) });
    assert.equal(res.status, status, `code ${code}`);
    assert.equal((await res.json()).error, error);
  }
});

test('recognize : corps vide refusé, AudD injoignable -> 502', async () => {
  assert.equal((await call('/recognize', { method: 'POST', headers: AUTH })).status, 400);
  mockFetch(async () => { throw new Error('réseau'); });
  assert.equal((await call('/recognize', { method: 'POST', headers: AUTH, body: new Uint8Array([1]) })).status, 502);
});

test('jamendo : désactivé sans client_id', async () => {
  const res = await call('/jamendo?title=a&artist=b', { headers: AUTH });
  assert.deepEqual(await res.json(), { enabled: false, results: [] });
});

test('jamendo : garde seulement les morceaux téléchargeables, ajoute le FLAC', async () => {
  mockFetch(async url => {
    const flac = url.includes('audiodlformat=flac');
    return jsonResponse({
      headers: { status: 'success' },
      results: [
        { id: '1', name: 'Rivage', artist_name: 'Les Ondes', duration: 200, audiodownload_allowed: true, audiodownload: `https://prod-1.storage.jamendo.com/download/track/1/${flac ? 'flac' : 'mp32'}/`, license_ccurl: 'http://creativecommons.org/licenses/by/3.0/' },
        { id: '2', name: 'Interdit', artist_name: 'X', audiodownload_allowed: false, audiodownload: '' },
      ],
    });
  });
  const res = await call('/jamendo?title=Rivage&artist=Les%20Ondes', { headers: AUTH }, { ...ENV, JAMENDO_CLIENT_ID: 'id' });
  const data = await res.json();
  assert.equal(data.results.length, 1);
  assert.deepEqual(data.results[0].formats.map(f => f.label), ['MP3 (VBR)', 'FLAC']);
  assert.match(data.results[0].formats[1].url, /\/flac\/$/);
});

test('download : refuse les sites non autorisés, relaie les sources autorisées', async () => {
  const bad = await call(`/download?url=${encodeURIComponent('https://evil.example/x.mp3')}`, { headers: AUTH });
  assert.equal(bad.status, 403);
  const tricky = await call(`/download?url=${encodeURIComponent('https://archive.org.evil.example/x.mp3')}`, { headers: AUTH });
  assert.equal(tricky.status, 403);

  mockFetch(async url => {
    assert.equal(url, 'https://archive.org/download/a/b.mp3');
    return new Response(new Uint8Array(5), { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '5' } });
  });
  const ok = await call(`/download?url=${encodeURIComponent('https://archive.org/download/a/b.mp3')}`, { headers: AUTH });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal((await ok.arrayBuffer()).byteLength, 5);
});
