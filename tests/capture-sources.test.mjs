import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, rms } from '../js/capture.js';
import { archiveCandidates, licenseName, parseLength } from '../js/sources.js';

test('encodeWav produit un en-tête WAV PCM 16 bits mono correct', async () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
  const blob = encodeWav(samples, 22050);
  assert.equal(blob.type, 'audio/wav');
  const v = new DataView(await blob.arrayBuffer());
  const str = (o, n) => String.fromCharCode(...new Uint8Array(v.buffer, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint16(22, true), 1);          // mono
  assert.equal(v.getUint32(24, true), 22050);      // fréquence
  assert.equal(v.getUint32(40, true), samples.length * 2);
  assert.equal(v.byteLength, 44 + samples.length * 2);
  assert.equal(v.getInt16(44 + 3 * 2, true), 32767);  // 1 -> max
  assert.equal(v.getInt16(44 + 5 * 2, true), 32767);  // 2 écrêté
  assert.equal(v.getInt16(44 + 4 * 2, true), -32768); // -1 -> min
});

test('rms : silence = 0, signal plein = 1', () => {
  assert.equal(rms(new Float32Array(10)), 0);
  assert.equal(rms(new Float32Array([1, -1, 1, -1])), 1);
});

test('licenseName lit les licences Creative Commons', () => {
  assert.equal(licenseName('https://creativecommons.org/licenses/by-nc-sa/3.0/'), 'CC BY-NC-SA 3.0');
  assert.equal(licenseName('http://creativecommons.org/publicdomain/zero/1.0/'), 'Domaine public');
});

test('parseLength accepte secondes et mm:ss', () => {
  assert.equal(parseLength('215.3'), 215.3);
  assert.equal(parseLength('03:35'), 215);
  assert.equal(parseLength(''), 0);
});

const doc = { identifier: 'mon-album', title: 'Mon album', creator: 'Les Ondes', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' };
const files = [
  { name: '01 Rivage.mp3', format: 'VBR MP3', size: '5000000', title: 'Rivage', length: '201.5' },
  { name: '01 Rivage.flac', format: 'Flac', size: '30000000', title: 'Rivage' },
  { name: '01 Rivage.ogg', format: 'Ogg Vorbis', size: '4000000', title: 'Rivage' },
  { name: 'cover.jpg', format: 'JPEG' },
  { name: 'sous dossier/02 Marée.mp3', format: '128Kbps MP3', size: '3000000' },
];

test('archiveCandidates regroupe les formats par morceau et construit les liens', () => {
  const c = archiveCandidates(doc, files);
  assert.equal(c.length, 2);
  const rivage = c.find(x => x.title === 'Rivage');
  assert.deepEqual(rivage.formats.map(f => f.label), ['MP3 (VBR)', 'FLAC', 'OGG']);
  assert.equal(rivage.duration, 201.5);
  assert.equal(rivage.artist, 'Les Ondes');
  assert.equal(rivage.formats[0].url, 'https://archive.org/download/mon-album/01%20Rivage.mp3');
  const maree = c.find(x => x.title === 'Marée');
  assert.equal(maree.formats[0].url, 'https://archive.org/download/mon-album/sous%20dossier/02%20Mar%C3%A9e.mp3');
});

test('archiveCandidates refuse les éléments sans licence libre', () => {
  assert.deepEqual(archiveCandidates({ ...doc, licenseurl: '' }, files), []);
  assert.deepEqual(archiveCandidates({ ...doc, licenseurl: 'https://example.com/tous-droits-reserves' }, files), []);
});
