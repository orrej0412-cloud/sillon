import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseTitle, similarity, artistSimilarity, scoreCandidate, versionTags } from '../js/match.js';

test('baseTitle retire feat., parenthèses et suffixes', () => {
  assert.equal(baseTitle('Été indien (feat. X) [Remastered]'), 'ete indien');
  assert.equal(baseTitle('Lumière froide - Radio Edit'), 'lumiere froide');
  assert.equal(baseTitle('Song ft. Someone'), 'song');
});

test('similarity : identique = 1, sans rapport ≈ 0, insensible aux accents', () => {
  assert.equal(similarity('Été indien', 'ete INDIEN'), 1);
  assert.ok(similarity('Warriors', 'Bohemian Rhapsody') < 0.2);
  assert.ok(similarity('Everybody Wants To Rule The World', 'Everybody Want To Rule The World') > 0.9);
});

test('artistSimilarity reconnaît un artiste dans un duo', () => {
  assert.equal(artistSimilarity('Kalash', 'Kalash feat. Damso'), 1);
  assert.equal(artistSimilarity('Admiral T & Kalash', 'Kalash'), 1);
});

test('versionTags repère remix, live, acoustique', () => {
  assert.deepEqual([...versionTags('Rivage (Live Remix)')].sort(), ['live', 'remix']);
  assert.equal(versionTags('Rivage').size, 0);
});

test('scoreCandidate : correspondance exacte', () => {
  const r = scoreCandidate({ title: 'Rivage', artist: 'Les Ondes', duration: 200 }, { title: 'Rivage', artist: 'Les Ondes', duration: 203 });
  assert.equal(r.level, 'exact');
  assert.equal(r.warnings.length, 0);
});

test('scoreCandidate : un remix est signalé et déclassé', () => {
  const r = scoreCandidate({ title: 'Rivage', artist: 'Les Ondes' }, { title: 'Rivage (Club Remix)', artist: 'Les Ondes' });
  assert.notEqual(r.level, 'exact');
  assert.match(r.warnings[0], /remix/);
});

test('scoreCandidate : durée très différente signalée', () => {
  const r = scoreCandidate({ title: 'Rivage', artist: 'Les Ondes', duration: 200 }, { title: 'Rivage', artist: 'Les Ondes', duration: 420 });
  assert.ok(r.warnings.some(w => /Durée/.test(w)));
});

test('scoreCandidate : autre morceau du même artiste = peu ressemblant', () => {
  const r = scoreCandidate({ title: 'Canto a la libertad', artist: 'Abora Reggae' }, { title: 'Lavanta la cabeza', artist: 'Abora Reggae' });
  assert.equal(r.level, 'faible');
});

test('scoreCandidate : autre artiste = peu ressemblant', () => {
  const r = scoreCandidate({ title: 'Warriors', artist: 'Imagine Dragons' }, { title: 'Sunrise', artist: 'Nova Lane' });
  assert.equal(r.level, 'faible');
});
