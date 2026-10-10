// Dialogue avec ton serveur privé (Cloudflare Worker). L'adresse et le code d'accès
// sont gardés sur cet appareil uniquement ; les clés AudD/Jamendo restent sur le serveur.
import * as lib from './library.js';

let cfg = null;

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function loadConfig() {
  cfg = (await lib.getSetting('backend')) || null;
  return cfg;
}

export const config = () => cfg;

export async function saveConfig(url, secret) {
  cfg = url ? { url: url.trim().replace(/\/+$/, ''), secret: secret.trim() } : null;
  await lib.setSetting('backend', cfg);
}

async function call(path, opts = {}) {
  if (!cfg?.url) throw new ApiError('config', "Connecte d'abord ton serveur de reconnaissance (bouton Réglages en haut à droite).");
  try {
    return await fetch(cfg.url + path, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${cfg.secret}` },
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (navigator.onLine === false) throw new ApiError('network', 'Pas de connexion Internet.');
    throw new ApiError('network', "Serveur injoignable. Vérifie son adresse dans les réglages, et qu'il est bien déployé.");
  }
}

async function callJson(path, opts) {
  const res = await call(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* corps non JSON */ }
  if (!res.ok) throw new ApiError(data?.error || 'http', data?.message || `Erreur du serveur (${res.status}).`, res.status);
  return data;
}

export const health = () => callJson('/health');

export const recognize = blob => callJson('/recognize?market=fr', {
  method: 'POST',
  headers: { 'Content-Type': blob.type || 'application/octet-stream' },
  body: blob,
});

export const jamendo = ({ title, artist }) => callJson(`/jamendo?${new URLSearchParams({ title, artist })}`);

// Téléchargement via le serveur, avec progression (loaded, total). total = 0 si inconnu.
export async function download(url, { onProgress, signal, expectedSize = 0 } = {}) {
  const res = await call(`/download?url=${encodeURIComponent(url)}`, { signal });
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* corps non JSON */ }
    throw new ApiError(data?.error || 'http', data?.message || `Téléchargement impossible (${res.status}).`, res.status);
  }
  const total = Number(res.headers.get('Content-Length')) || expectedSize || 0;
  const type = (res.headers.get('Content-Type') || '').split(';')[0];
  if (!res.body) {
    const blob = await res.blob();
    onProgress?.(blob.size, blob.size);
    return blob;
  }
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  if (!loaded) throw new ApiError('empty', 'La source a renvoyé un fichier vide.');
  return new Blob(parts, { type });
}
