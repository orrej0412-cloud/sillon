// Capture audio pour la reconnaissance : micro (10 s) ou extrait d'un fichier (12 s),
// toujours converti en WAV mono 22 kHz (≈ 450 Ko), un format que tous les services lisent.

export const SAMPLE_RATE = 22050;

export class CaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// WAV PCM 16 bits mono. Fonction pure (testée).
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);              // PCM
  v.setUint16(22, 1, true);              // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // octets par seconde
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (samples.length || 1));
}

// Rééchantillonne un AudioBuffer (ou une portion) en mono SAMPLE_RATE.
async function toMono(buffer, offset = 0, seconds = buffer.duration) {
  const length = Math.max(1, Math.floor(seconds * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0, offset, seconds);
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

/* ---------- Micro ---------- */

function micError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
    return new CaptureError('mic_denied', "Accès au micro refusé. Dans Chrome : icône à gauche de l'adresse › Autorisations › Micro › Autoriser.");
  }
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
    return new CaptureError('mic_missing', 'Aucun micro détecté sur cet appareil.');
  }
  if (err?.name === 'NotReadableError') {
    return new CaptureError('mic_busy', 'Le micro est déjà utilisé par une autre appli. Ferme-la et réessaie.');
  }
  return new CaptureError('mic', `Impossible d'utiliser le micro (${err?.message || err}).`);
}

/**
 * Enregistre `seconds` secondes au micro.
 * onLevel(0..1) est appelé ~30 fois par seconde, onTick(secondesÉcoulées) chaque frame.
 * Retourne un Blob WAV. Lève CaptureError si le son est quasi nul.
 */
export async function recordMic({ seconds = 10, onLevel, onTick, signal } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CaptureError('mic_https', "Le micro n'est disponible que sur une adresse sécurisée (https).");
  }
  let stream;
  try {
    // Sans traitement de la voix : on veut la musique telle quelle.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
  } catch (err) {
    throw micError(err);
  }

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(analyser);
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  const chunks = [];
  let peak = 0;
  processor.onaudioprocess = e => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    peak = Math.max(peak, rms(data));
  };

  const levelBuf = new Float32Array(analyser.fftSize);
  const started = performance.now();
  try {
    await ctx.resume();
    // Minuterie (et non requestAnimationFrame) : l'écoute se termine même si l'écran se verrouille.
    await new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (signal?.aborted) {
          clearInterval(timer);
          return reject(new CaptureError('aborted', 'Écoute annulée.'));
        }
        analyser.getFloatTimeDomainData(levelBuf);
        onLevel?.(Math.min(1, rms(levelBuf) * 6));
        const elapsed = (performance.now() - started) / 1000;
        onTick?.(elapsed);
        if (elapsed >= seconds) {
          clearInterval(timer);
          resolve();
        }
      }, 50);
    });
  } finally {
    processor.onaudioprocess = null;
    stream.getTracks().forEach(t => t.stop());
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const raw = ctx.createBuffer(1, Math.max(1, total), ctx.sampleRate);
  const channel = raw.getChannelData(0);
  let offset = 0;
  for (const c of chunks) { channel.set(c, offset); offset += c.length; }
  await ctx.close();

  if (peak < 0.004) {
    throw new CaptureError('silence', "Je n'ai presque rien entendu. Monte le son ou rapproche le téléphone de la musique.");
  }
  return encodeWav(await toMono(raw), SAMPLE_RATE);
}

/* ---------- Fichier ---------- */

const MAX_DECODE_BYTES = 80 * 1024 * 1024;
const MAX_RAW_BYTES = 10 * 1024 * 1024; // limite d'AudD pour un envoi direct

/**
 * Prépare un extrait de 12 s pris vers le tiers du morceau (souvent le refrain ou le couplet).
 * Si le navigateur ne sait pas décoder le fichier, envoie le fichier tel quel s'il fait moins de 10 Mo.
 */
export async function excerptFromFile(blob, { seconds = 12 } = {}) {
  if (blob.size <= MAX_DECODE_BYTES) {
    try {
      const probe = new OfflineAudioContext(1, 1, SAMPLE_RATE);
      const audio = await probe.decodeAudioData(await blob.arrayBuffer());
      const len = Math.min(seconds, audio.duration);
      const start = Math.max(0, Math.min(audio.duration - len, audio.duration * 0.33));
      return { blob: encodeWav(await toMono(audio, start, len)), duration: audio.duration, startAt: start };
    } catch {
      /* format non décodable ici : on tente l'envoi direct */
    }
  }
  if (blob.size <= MAX_RAW_BYTES) return { blob, duration: 0, startAt: 0 };
  throw new CaptureError('file_large', "Ce fichier est trop lourd pour être analysé ici (plus de 10 Mo et format non décodable). Essaie avec la version MP3.");
}
