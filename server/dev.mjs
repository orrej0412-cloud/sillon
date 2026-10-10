// Lance le serveur Sillon en local (sans Cloudflare), pour tester sur l'ordinateur :
//   node server/dev.mjs        ->  http://localhost:8787
// Les variables (APP_SECRET, AUDD_API_TOKEN…) sont lues dans server/.dev.vars (voir .dev.vars.example).
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import worker from './worker.js';

const env = {};
const varsFile = new URL('./.dev.vars', import.meta.url);
if (existsSync(varsFile)) {
  for (const line of readFileSync(varsFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
for (const key of ['APP_SECRET', 'AUDD_API_TOKEN', 'JAMENDO_CLIENT_ID', 'ALLOWED_ORIGINS']) {
  if (process.env[key]) env[key] = process.env[key];
}

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'host', 'content-length', 'upgrade']);
const port = Number(process.env.PORT) || 8787;

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = Object.entries(req.headers).filter(([k]) => !HOP.has(k));
    const request = new Request(`http://localhost:${port}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const chunk of response.body) res.write(chunk);
    res.end();
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Erreur du serveur local');
  }
}).listen(port, () => {
  console.log(`Serveur Sillon (local) : http://localhost:${port}`);
  if (!env.APP_SECRET) console.log('Attention : APP_SECRET absent, toutes les requêtes seront refusées.');
});
