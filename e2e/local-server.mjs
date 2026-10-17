// Serves this checkout at /state-of-voice-agents/ for local end-to-end runs. Everything else
// (/design-system/, /assets/, ...) comes from the live site, so the page runs exactly as on
// sbmadhav.com but with this branch's files.
//   node e2e/local-server.mjs [port]   (default 8126)
//   BASE_URL=http://localhost:8126 npx playwright test
import http from 'node:http';
import { open, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
// Serves the checkout itself, or a folder inside it (argv[3]); never a folder outside it
const root = process.argv[3] ? await realpath(path.resolve(repo, process.argv[3])) : repo;
const inside = (q, base) => q === base || q.startsWith(base + path.sep);
if (!inside(root, repo)) throw new Error('the folder to serve must be inside the checkout');
const port = +(process.argv[2] || process.env.PORT || 8126);
const LIVE = 'https://sbmadhav.com';
const PREFIX = '/state-of-voice-agents/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.m4a': 'audio/mp4', '.md': 'text/markdown; charset=utf-8' };
// .nojekyll publishes the whole branch; never serve dependencies or anything with a dot path part (.git, .github, .env)
const BLOCKED = /(^|\/)(node_modules|\.[^/]*)(\/|$)/;

async function proxy(req, res) {
  const r = await fetch(LIVE + req.url, { redirect: 'manual' });
  const headers = {};
  r.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) headers[k] = v; });
  if (headers.location) headers.location = headers.location.replace(LIVE, '');
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}

async function readChecked(p) {
  const fh = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const [held, again] = await Promise.all([fh.stat(), realpath(p).then(q => (q === p ? stat(q) : null))]);
    if (!again || !held.isFile() || held.dev !== again.dev || held.ino !== again.ino) return null;
    return await fh.readFile();
  } finally { await fh.close(); }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/state-of-voice-agents') { res.writeHead(301, { location: PREFIX + url.search }); return res.end(); }
    if (!pathname.startsWith(PREFIX)) return await proxy(req, res);
    // Resolve dot segments and encoded separators, follow symlinks (realpath), and only then check that the
    // file is inside the served folder (root + separator) and not blocked, so nothing hides behind "..", "//",
    // "%2F" or a link that points elsewhere.
    let p = path.resolve(root, '.' + '/' + pathname.slice(PREFIX.length));
    if (!inside(p, root)) { res.writeHead(403); return res.end(); }
    const s = await stat(p).catch(() => null);
    if (s && s.isDirectory()) p = path.join(p, 'index.html');
    p = await realpath(p).catch(() => null);
    if (!p) { res.writeHead(404); return res.end('Not found'); }
    if (!inside(p, root)) { res.writeHead(403); return res.end(); }
    if (BLOCKED.test(path.relative(root, p).split(path.sep).join('/'))) { res.writeHead(404); return res.end('Not found'); }
    // Read through the descriptor that was checked: open the canonical path without following a final
    // symlink, then confirm the open file is still the one realpath resolved inside the root (same device
    // and inode), so a file swapped in between the check and the read is refused rather than served.
    const body = await readChecked(p).catch(() => null);
    if (!body) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(port, '127.0.0.1', () => console.log(`State of Voice Agents (this checkout) on http://127.0.0.1:${port}/state-of-voice-agents/ (localhost only)`));
