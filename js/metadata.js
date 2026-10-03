// Lecture des métadonnées sans dépendance : ID3v2/ID3v1 (MP3), FLAC, MP4/M4A, Ogg/Opus.
const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

async function read(file, start, length) {
  const end = Math.min(file.size, start + length);
  if (start >= end) return new Uint8Array(0);
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

const ascii = (b, s, e) => latin1.decode(b.subarray(s, e));
const be32 = (b, o) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const le32 = (b, o) => b[o + 3] * 0x1000000 + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o]);
const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const clean = s => (s || '').replace(/\0/g, '').trim();

function fill(target, src) {
  for (const [k, v] of Object.entries(src)) if (v && !target[k]) target[k] = v;
  return target;
}

export async function readTags(file) {
  const tags = {};
  try {
    const head = await read(file, 0, 10);
    let offset = 0;
    if (ascii(head, 0, 3) === 'ID3') {
      offset = 10 + syncsafe(head, 6) + (head[5] & 0x10 ? 10 : 0);
      fill(tags, parseID3v2(await read(file, 0, offset)));
    }
    const magic = await read(file, offset, 12);
    if (ascii(magic, 0, 4) === 'fLaC') fill(tags, await parseFlac(file, offset + 4));
    else if (ascii(magic, 4, 8) === 'ftyp') fill(tags, await parseMp4(file));
    else if (ascii(magic, 0, 4) === 'OggS') fill(tags, await parseOgg(file));
    if (!tags.title && file.size > 128) fill(tags, await parseID3v1(file));
  } catch (err) {
    console.warn('Métadonnées illisibles :', file.name, err);
  }
  return tags;
}

/* ---------- ID3 ---------- */

function decodeText(enc, bytes) {
  let s;
  if (enc === 0) s = latin1.decode(bytes);
  else if (enc === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) s = utf16be.decode(bytes.subarray(2));
    else s = utf16le.decode(bytes);
  } else if (enc === 2) s = utf16be.decode(bytes);
  else s = utf8.decode(bytes);
  return s.split('\0').filter(Boolean)[0]?.trim() || '';
}

function id3Picture(d, v22) {
  const enc = d[0];
  let p, mime;
  if (v22) {
    mime = ascii(d, 1, 4).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    const z = d.indexOf(0, 1);
    mime = ascii(d, 1, z).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = 'image/' + mime.replace('jpg', 'jpeg');
    p = z + 1;
  }
  const type = d[p++];
  if (enc === 1 || enc === 2) {
    while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2;
    p += 2;
  } else {
    while (p < d.length && d[p] !== 0) p++;
    p++;
  }
  return { type, mime, data: d.slice(p) };
}

function parseID3v2(b) {
  const ver = b[3];
  const out = {};
  let p = 10;
  if (b[5] & 0x40) p += ver === 4 ? syncsafe(b, 10) : be32(b, 10) + 4;
  const idLen = ver === 2 ? 3 : 4;
  const hLen = ver === 2 ? 6 : 10;

  while (p + hLen <= b.length) {
    const id = ascii(b, p, p + idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const size = ver === 2 ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]
      : ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
    let d = b.subarray(p + hLen, p + hLen + size);
    if (ver === 4 && b[p + 9] & 0x01) d = d.subarray(4); // indicateur de longueur
    p += hLen + size;
    if (!size) continue;
    const text = () => decodeText(d[0], d.subarray(1));
    switch (id) {
      case 'TIT2': case 'TT2': out.title ||= text(); break;
      case 'TPE1': case 'TP1': out.artist ||= text(); break;
      case 'TALB': case 'TAL': out.album ||= text(); break;
      case 'TPE2': case 'TP2': out.albumArtist ||= text(); break;
      case 'TRCK': case 'TRK': out.track ||= parseInt(text(), 10) || 0; break;
      case 'TYER': case 'TDRC': case 'TYE': out.year ||= text().slice(0, 4); break;
      case 'APIC': case 'PIC': {
        const pic = id3Picture(d, ver === 2);
        if (pic.data.length && (!out.picture || (pic.type === 3 && out.picture.type !== 3))) out.picture = pic;
        break;
      }
    }
  }
  return out;
}

async function parseID3v1(file) {
  const b = await read(file, file.size - 128, 128);
  if (ascii(b, 0, 3) !== 'TAG') return {};
  return {
    title: clean(ascii(b, 3, 33)),
    artist: clean(ascii(b, 33, 63)),
    album: clean(ascii(b, 63, 93)),
    year: clean(ascii(b, 93, 97)),
  };
}

/* ---------- FLAC / Vorbis ---------- */

const VORBIS_KEYS = {
  TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist',
  'ALBUM ARTIST': 'albumArtist', DATE: 'year', TRACKNUMBER: 'track',
};

function vorbisComments(d, out) {
  let p = 4 + le32(d, 0);
  const count = le32(d, p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= d.length; i++) {
    const len = le32(d, p);
    p += 4;
    if (p + len > d.length) break;
    const entry = utf8.decode(d.subarray(p, p + len));
    p += len;
    const eq = entry.indexOf('=');
    if (eq < 1) continue;
    const key = VORBIS_KEYS[entry.slice(0, eq).toUpperCase()];
    const val = entry.slice(eq + 1).trim();
    if (!key || !val || out[key]) continue;
    out[key] = key === 'track' ? parseInt(val, 10) || 0 : key === 'year' ? val.slice(0, 4) : val;
  }
}

function flacPicture(d) {
  let p = 0;
  const type = be32(d, p); p += 4;
  const mimeLen = be32(d, p); p += 4;
  const mime = ascii(d, p, p + mimeLen) || 'image/jpeg'; p += mimeLen;
  const descLen = be32(d, p); p += 4 + descLen + 16;
  const len = be32(d, p); p += 4;
  return { type, mime, data: d.slice(p, p + len) };
}

async function parseFlac(file, p) {
  const out = {};
  for (let i = 0; i < 128; i++) {
    const h = await read(file, p, 4);
    if (h.length < 4) break;
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 4) vorbisComments(await read(file, p + 4, len), out);
    if (type === 6) {
      const pic = flacPicture(await read(file, p + 4, len));
      if (pic.data.length && (!out.picture || (pic.type === 3 && out.picture.type !== 3))) out.picture = pic;
    }
    p += 4 + len;
    if (last) break;
  }
  return out;
}

async function parseOgg(file) {
  const b = await read(file, 0, 256 * 1024);
  const s = latin1.decode(b);
  const out = {};
  let i = s.indexOf('OpusTags');
  let skip = 8;
  if (i < 0) { i = s.indexOf('\x03vorbis'); skip = 7; }
  if (i >= 0) vorbisComments(b.subarray(i + skip), out);
  return out;
}

/* ---------- MP4 / M4A ---------- */

function* boxes(b, start = 0, end = b.length) {
  let p = start;
  while (p + 8 <= end) {
    let size = be32(b, p);
    const type = ascii(b, p + 4, p + 8);
    let hl = 8;
    if (size === 1) { size = be32(b, p + 8) * 2 ** 32 + be32(b, p + 12); hl = 16; }
    else if (size === 0) size = end - p;
    if (size < hl) return;
    yield { type, start: p + hl, end: Math.min(p + size, end) };
    p += size;
  }
}

function findBox(b, path, start = 0, end = b.length) {
  for (const box of boxes(b, start, end)) {
    if (box.type !== path[0]) continue;
    const s = box.type === 'meta' ? box.start + 4 : box.start; // meta est une "full box"
    return path.length === 1 ? { start: s, end: box.end } : findBox(b, path.slice(1), s, box.end);
  }
  return null;
}

async function parseMp4(file) {
  let p = 0;
  let moov = null;
  while (p + 8 <= file.size) {
    const h = await read(file, p, 16);
    let size = be32(h, 0);
    const type = ascii(h, 4, 8);
    let hl = 8;
    if (size === 1) { size = be32(h, 8) * 2 ** 32 + be32(h, 12); hl = 16; }
    else if (size === 0) size = file.size - p;
    if (size < 8) break;
    if (type === 'moov') { moov = await read(file, p + hl, size - hl); break; }
    p += size;
  }
  if (!moov) return {};
  const ilst = findBox(moov, ['udta', 'meta', 'ilst']) || findBox(moov, ['meta', 'ilst']);
  if (!ilst) return {};
  const out = {};
  for (const item of boxes(moov, ilst.start, ilst.end)) {
    const data = [...boxes(moov, item.start, item.end)].find(x => x.type === 'data');
    if (!data) continue;
    const kind = be32(moov, data.start) & 0xffffff;
    const v = moov.subarray(data.start + 8, data.end);
    const txt = () => utf8.decode(v).trim();
    switch (item.type) {
      case '©nam': out.title ||= txt(); break;
      case '©ART': out.artist ||= txt(); break;
      case '©alb': out.album ||= txt(); break;
      case 'aART': out.albumArtist ||= txt(); break;
      case '©day': out.year ||= txt().slice(0, 4); break;
      case 'trkn': out.track ||= (v[2] << 8) | v[3]; break;
      case 'covr': if (!out.picture && v.length) out.picture = { type: 3, mime: kind === 14 ? 'image/png' : 'image/jpeg', data: v.slice() }; break;
    }
  }
  return out;
}

/* ---------- Durée, présence d'image et vignette (clips) ---------- */

export function probeMedia(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (out = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      resolve({ duration: Number.isFinite(v.duration) ? v.duration : 0, hasVideo: false, poster: null, ...out });
    };
    const timer = setTimeout(() => finish(), 12000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onerror = () => finish({ duration: 0 });
    v.onloadedmetadata = () => {
      if (!v.videoWidth) return finish();
      // Clip : on capture une image vers 20 % de la durée pour servir de pochette.
      v.onseeked = () => {
        const scale = Math.min(1, 640 / v.videoWidth);
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        try {
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(poster => finish({ hasVideo: true, poster }), 'image/jpeg', 0.85);
        } catch {
          finish({ hasVideo: true });
        }
      };
      v.currentTime = Math.min((v.duration || 0) * 0.2, 30);
    };
    v.src = url;
  });
}
