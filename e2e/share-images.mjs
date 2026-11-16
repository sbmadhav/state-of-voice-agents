#!/usr/bin/env node
// Share pages and images for the report's exhibits (every <figure class="exhibit" id="fig-...">).
//
//   node e2e/share-images.mjs                                    index.html (the latest edition)
//   node e2e/share-images.mjs --page editions/2026-10/index.html  another edition's page
//   node e2e/share-images.mjs --all                               index.html and every editions/*/index.html
//   node e2e/share-images.mjs --only fig-fs-1,fig-tv-2            only these exhibits' images (the pages are always written)
//   node e2e/share-images.mjs --base http://localhost:8126        use a server that is already running
//   node e2e/share-images.mjs --check [--page ... | --all]        change nothing; exit 1 when something is out of date
//
// For each exhibit it writes, into share/<edition>/ (the edition is <main data-edition="YYYY-MM">):
//   <id>.png          a 1200 x 630 card for link previews: the caption's claim as the title, the exhibit under
//                     it at a readable size (faded out at the bottom when it is taller than the card), a footer
//   <id>-full.png     the whole exhibit with its caption and the same footer, for "Download image"
//   <id>/index.html   the share page. Social sites read its Open Graph tags (the card is its og:image);
//                     people who open it are sent on to the exhibit in the archived edition.
//
// An exhibit's id is "fig-<section id>-<number>". It is in every link that was ever shared, so it never
// changes: a new exhibit takes the next unused number in its section, and the others keep theirs.
//
// The share pages come from the static HTML alone (the id, the caption's text and the edition), so --check
// needs no browser: it fails when a page is missing or out of date, an image is missing, or a file in
// share/<edition>/ no longer has an exhibit. Images are only checked for existence, so run the script again
// after editing an exhibit. The images are screenshots of the real page in the light scheme, taken with the
// Playwright in e2e/node_modules and stored with a 256-color palette to keep them small; unless --base is
// given, the script starts e2e/local-server.mjs on a free port (it serves this checkout and proxies the
// design system and fonts from the live site, so it needs the network).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/state-of-voice-agents/';
const SITE = 'https://sbmadhav.com' + PREFIX;
const REPORT = 'Voice Agents at the Front Door';
const AUTHOR = 'Madhav Srinivasan';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CARD = { width: 1200, height: 630 };
const MAX_BYTES = 400 * 1024; // a full image above this is taken again at a lower scale

// ---------- the exhibits, read from the static HTML ----------

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
const VOID = new Set(['br', 'img', 'hr', 'input', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
const squash = s => s.replace(/\s+/g, ' ').trim();

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

function decode(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
    if (!(e in ENTITIES)) throw new Error(`share-images: add the entity ${m} to ENTITIES`);
    return ENTITIES[e];
  });
}

/** The caption's claim (its <strong>) and the text after it, without citations, evidence chips and the Share control. */
function captionText(html) {
  let claim = '', rest = '', strong = 0, seen = false, skip = 0, last = 0;
  const stack = [];
  const text = t => { if (skip) return; if (strong) claim += t; else if (seen) rest += t; };
  for (const m of html.matchAll(TAG)) {
    text(html.slice(last, m.index));
    last = m.index + m[0].length;
    const name = m[2].toLowerCase();
    if (VOID.has(name)) { text(' '); continue; }
    if (!m[1]) {
      const cls = (attrs(m[3]).class || '').split(/\s+/);
      const hide = cls.includes('chip') || cls.includes('share') || cls.includes('share-box') || (name === 'a' && cls.includes('c'));
      const isClaim = name === 'strong' && !seen && !skip;
      stack.push({ name, hide, isClaim });
      if (hide) skip++;
      if (isClaim) { strong++; seen = true; }
    } else {
      const i = stack.map(x => x.name).lastIndexOf(name);
      if (i < 0) continue;
      for (const x of stack.splice(i)) { if (x.hide) skip--; if (x.isClaim) strong--; }
    }
  }
  text(html.slice(last));
  return { claim: squash(decode(claim)), rest: squash(decode(rest)) };
}

/** The first sentence of a text: up to a period, question mark or exclamation mark that is followed by a
    capital letter or a digit, or that ends the text. A period after an initial ("U.S.") or a common
    abbreviation does not end it. */
function firstSentence(s) {
  const end = /[.!?](?=\s+["'(]?[A-Z0-9]|\s*$)/g;
  for (let m; (m = end.exec(s));) {
    const before = s.slice(0, m.index);
    if (m[0] === '.' && /(^|[\s(.])([A-Z]|e\.g|i\.e|vs|cf|approx|St|Dr|Mr|Mrs|Ms|No|Inc|Corp|Ltd|Co)$/.test(before)) continue;
    return s.slice(0, m.index + 1);
  }
  return s;
}

async function readPage(file) {
  const rel = path.relative(REPO, file).split(path.sep).join('/');
  const src = await readFile(file, 'utf8');
  const errors = [];
  const main = /<main\b([^>]*)>/.exec(src);
  const edition = main ? attrs(main[1])['data-edition'] : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(edition || '')) throw new Error(`${rel}: <main> needs data-edition="YYYY-MM"`);
  const exhibits = [], ids = new Set();
  for (const m of src.matchAll(/<figure\b([^>]*)>/g)) {
    const a = attrs(m[1]);
    if (!(a.class || '').split(/\s+/).includes('exhibit')) continue;
    const end = src.indexOf('</figure>', m.index);
    const inner = src.slice(m.index + m[0].length, end < 0 ? undefined : end);
    const line = src.slice(0, m.index).split('\n').length;
    const id = a.id || '';
    if (!/^fig-[a-z][a-z0-9-]*-\d+$/.test(id)) { errors.push(`${rel}:${line}: the exhibit needs an id like "fig-<section id>-<number>" (found "${id}")`); continue; }
    if (ids.has(id)) { errors.push(`${rel}:${line}: the id ${id} is used twice`); continue; }
    ids.add(id);
    const cap = /<figcaption\b([^>]*)>([\s\S]*?)<\/figcaption>/.exec(inner);
    if (!cap) { errors.push(`${rel}:${line}: ${id} has no <figcaption class="caption">`); continue; }
    const { claim, rest } = captionText(cap[2]);
    if (!claim) { errors.push(`${rel}:${line}: the caption of ${id} needs its claim sentence in <strong>`); continue; }
    const share = [...cap[2].matchAll(/<a\b([^>]*)>/g)].map(x => attrs(x[1])).filter(x => (x.class || '').split(/\s+/).includes('share'));
    const want = `${PREFIX}share/${edition}/${id}/`;
    if (share.length !== 1 || share[0].href !== want) errors.push(`${rel}:${line}: the caption of ${id} needs one <a class="share" href="${want}" data-narrate-skip>Share</a>`);
    exhibits.push({ id, claim, second: firstSentence(rest), kind: /<table\b/.test(inner) ? 'Table' : 'Exhibit' });
  }
  if (!exhibits.length && !errors.length) errors.push(`${rel}: no <figure class="exhibit"> found`);
  const url = rel === 'index.html' ? PREFIX : PREFIX + rel.replace(/index\.html$/, '');
  return { rel, url, edition, exhibits, errors };
}

// ---------- the share page ----------

const month = edition => `${MONTHS[+edition.slice(5) - 1]} ${edition.slice(0, 4)}`;
const footer = edition => `${REPORT} · ${month(edition)} · sbmadhav.com/state-of-voice-agents`;
const text = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => text(s).replace(/"/g, '&quot;');

function sharePage(edition, x) {
  const from = `From the ${month(edition)} edition of ${REPORT}, by ${AUTHOR}.`;
  const description = (x.second ? x.second + ' ' : '') + from;
  const alt = `${x.kind} from the ${month(edition)} edition of ${REPORT}: ${x.claim}`;
  const own = `${SITE}share/${edition}/${x.id}/`;
  const image = `share/${edition}/${x.id}.png`;
  const exhibit = `editions/${edition}/#${x.id}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${text(x.claim)}</title>
<meta name="description" content="${attr(description)}">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${SITE}${exhibit}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${attr(REPORT)}">
<meta property="og:title" content="${attr(x.claim)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:url" content="${own}">
<meta property="og:image" content="${SITE}${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${CARD.width}">
<meta property="og:image:height" content="${CARD.height}">
<meta property="og:image:alt" content="${attr(alt)}">
<meta name="twitter:card" content="summary_large_image">
<style>:root{color-scheme:light dark}body{max-width:44rem;margin:0 auto;padding:1.5rem 1rem;font:1rem/1.5 system-ui,sans-serif}img{display:block;max-width:100%;height:auto}h1{margin:1rem 0 .5rem;font-size:1.4rem;line-height:1.25}p{margin:.5rem 0}</style>
<!-- Link previews read the tags above. People are sent on to the exhibit itself. -->
<script>location.replace(${JSON.stringify(PREFIX + exhibit)})</script>
</head>
<body>
<main>
<img src="${PREFIX}${image}" width="${CARD.width}" height="${CARD.height}" alt="${attr(alt)}">
<h1>${text(x.claim)}</h1>
<p>${text(description)}</p>
<p><a href="${PREFIX}${exhibit}">Open this exhibit in the report</a></p>
</main>
</body>
</html>
`;
}

// ---------- PNG helpers (no dependencies): read the size, and reduce a screenshot to a palette ----------

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = b => (b.length > 24 && b.subarray(0, 8).equals(PNG_SIG) ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = zlib.crc32 || (b => { let c = 0xffffffff; for (const v of b) c = CRC_TABLE[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; });

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Decodes an 8-bit RGB or RGBA, non-interlaced PNG (what Chromium writes) to RGB pixels. */
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) return null;
    } else if (name === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(height * stride), rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0, b = y ? px[dst + i - stride] : 0, c = i >= bpp && y ? px[dst + i - stride - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v;
    }
  }
  for (let i = 0, j = 0; i < px.length; i += bpp, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
  return { width, height, rgb };
}

/** Re-encodes a screenshot with a palette of at most 256 colors (median cut, no dithering). A page of text,
    tables and flat charts keeps its look, and the file is about a third of the size. Returns null when the
    PNG is not one Chromium writes, or when the palette would move the colors by more than PALETTE_MEAN levels
    (of 255) on average or PALETTE_WORST for a color that fills a visible area, as it could for a photograph. */
const PALETTE_MEAN = 1.5, PALETTE_WORST = 6;
function quantizePng(buf) {
  const img = decodePng(buf);
  if (!img) return null;
  const { width, height, rgb } = img, n = width * height;
  const count = new Uint32Array(1 << 24);
  for (let i = 0; i < n * 3; i += 3) count[(rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]]++;
  const colors = [];
  for (let k = 0; k < count.length; k++) if (count[k]) colors.push(k);
  // A box is a set of colors that will share one palette entry, their mean. It remembers its pixel count,
  // its widest channel and its error: how far its pixels lie from that mean, added up.
  const part = (k, ch) => (k >> (16 - 8 * ch)) & 255;
  const box = list => {
    const lo = [255, 255, 255], hi = [0, 0, 0], mean = [0, 0, 0];
    let weight = 0, error = 0;
    for (const k of list) {
      weight += count[k];
      for (let ch = 0; ch < 3; ch++) { const v = part(k, ch); if (v < lo[ch]) lo[ch] = v; if (v > hi[ch]) hi[ch] = v; mean[ch] += v * count[k]; }
    }
    for (let ch = 0; ch < 3; ch++) mean[ch] /= weight;
    for (const k of list) error += count[k] * Math.max(...mean.map((m, ch) => Math.abs(part(k, ch) - m)));
    const spans = hi.map((v, ch) => v - lo[ch]);
    return { list, weight, error, ch: spans.indexOf(Math.max(...spans)) };
  };
  const boxes = [box(colors)];
  while (boxes.length < 256) {
    // Split the box with the largest error, at its median pixel along its widest channel
    let pick = -1;
    boxes.forEach((x, i) => { if (x.list.length > 1 && (pick < 0 || x.error > boxes[pick].error)) pick = i; });
    if (pick < 0) break;
    const { list, weight, ch } = boxes[pick], shift = 16 - 8 * ch;
    list.sort((x, y) => ((x >> shift) & 255) - ((y >> shift) & 255));
    let acc = 0, cut = 0;
    while (cut < list.length - 1 && acc + count[list[cut]] <= weight / 2) acc += count[list[cut++]];
    cut = Math.max(1, cut);
    boxes.splice(pick, 1, box(list.slice(0, cut)), box(list.slice(cut)));
  }
  const palette = Buffer.alloc(boxes.length * 3), index = new Uint8Array(1 << 24);
  let total = 0, worst = 0;
  boxes.forEach((x, i) => {
    const mean = [0, 0, 0];
    for (const k of x.list) { index[k] = i; for (let ch = 0; ch < 3; ch++) mean[ch] += ((k >> (16 - 8 * ch)) & 255) * count[k]; }
    for (let ch = 0; ch < 3; ch++) palette[i * 3 + ch] = Math.round(mean[ch] / x.weight);
    // How far this palette entry moves each of its colors
    for (const k of x.list) {
      let shift = 0;
      for (let ch = 0; ch < 3; ch++) shift = Math.max(shift, Math.abs(((k >> (16 - 8 * ch)) & 255) - palette[i * 3 + ch]));
      total += shift * count[k];
      if (count[k] * 4000 >= n) worst = Math.max(worst, shift);
    }
  });
  if (process.env.SHARE_IMAGES_DEBUG) console.error(`    ${colors.length} colors to ${boxes.length}: mean shift ${(total / n).toFixed(2)}, worst over an area ${worst}`);
  if (total / n > PALETTE_MEAN || worst > PALETTE_WORST) return null;
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0, i = 0; y < height; y++) {
    let o = y * (width + 1) + 1;
    for (let x = 0; x < width; x++, i += 3) raw[o++] = index[(rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 3;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('PLTE', palette), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- the images ----------

// The card is a 1000 x 525 viewport at scale 1.2 (so the page keeps its desktop layout); c() turns the
// card's device pixels into CSS pixels. The full image is 800 CSS pixels wide at whatever scale it is taken.
const CARD_SCALE = 1.2, FULL_WIDTH = 800;
const c = n => `${+(n / CARD_SCALE).toFixed(3)}px`;
const shotCss = foot => `
html.shot-on,html.shot-on body{overflow:hidden!important}
html.shot-on .topbar,html.shot-on .md-skip,html.shot-on .md-toasts,html.shot-on .bolt-launch,html.shot-on .bolt-panel{display:none!important}
figure.shot{position:fixed!important;left:0!important;top:0!important;z-index:2147483000!important;box-sizing:border-box!important;margin:0!important;max-width:none!important;outline:0!important;border-radius:0!important;background:var(--bg)!important;display:flex!important;flex-direction:column!important}
figure.shot>*{flex:none!important}
figure.shot .share,figure.shot .share-box,figure.shot .ix,figure.shot .listen{display:none!important}
/* The timeline scrolls sideways on the page; in a picture it wraps, as it does in print */
figure.shot .year{flex-wrap:wrap;overflow:visible;gap:var(--space-3) 0}
figure.shot .ev{flex:0 0 33.33%}
figure.shot::after{content:${JSON.stringify(foot)};box-sizing:border-box;display:flex;align-items:center;white-space:nowrap;overflow:hidden;background:var(--bg);border-top:1px solid var(--line);color:var(--ink-muted);font-family:var(--font-mono);font-weight:var(--text-code-weight)}
.shot-title,figure.shot-full>.caption strong{display:block;font-family:var(--display);font-weight:var(--text-heading-weight);letter-spacing:var(--tracking-heading);color:var(--ink);text-wrap:balance}

/* The card: 1200 x 630 */
figure.shot-card{width:${c(CARD.width)}!important;height:${c(CARD.height)}!important;padding:${c(46)} ${c(56)} 0!important;overflow:hidden!important}
/* Left out of the card: the caption (it is the title), citation numbers, and sort and filter switches */
figure.shot-card>.caption,figure.shot-card a.c,figure.shot-card .seg{display:none!important}
figure.shot-card .shot-title{font-size:var(--shot-title);line-height:1.14}
figure.shot-card .shot-sub{margin-top:${c(12)};max-width:none;color:var(--ink-muted);font-size:${c(22)};line-height:1.4;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
figure.shot-card .shot-sub .chip{font-size:${c(16)};padding:${c(3)} ${c(11)}}
figure.shot-card .shot-stage{margin-top:calc(${c(26)} + var(--shot-push, 0px))}
figure.shot-card .shot-body{display:grid;gap:var(--space-2-5);min-width:0;zoom:var(--shot-zoom)}
figure.shot-card .shot-body>:first-child{margin-top:0!important}
figure.shot-card::after{position:absolute;left:0;right:0;bottom:0;z-index:2;height:${c(58)};padding:0 ${c(56)};font-size:${c(18)}}
figure.shot-card.shot-clip::before{content:"";position:absolute;left:0;right:0;bottom:${c(58)};z-index:1;height:${c(90)};background:linear-gradient(to bottom,color-mix(in srgb,var(--bg) 0%,transparent),var(--bg))}

/* The full image: the caption, the whole exhibit and the footer */
figure.shot-full{width:${FULL_WIDTH}px!important;padding:32px 36px 0!important;gap:var(--space-2-5)}
figure.shot-full>.caption{order:-1;max-width:none;margin-bottom:var(--space-1-5)}
figure.shot-full>.caption strong{margin-bottom:var(--space-1-5);font-size:25px;line-height:1.16}
figure.shot-full::after{order:99;margin:var(--space-3) -36px 0;padding:var(--space-3) 36px;font-size:11.5px}
`;

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO, 'e2e', 'local-server.mjs'), String(port)], { stdio: ['ignore', 'ignore', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + PREFIX + 'og.png', { signal: AbortSignal.timeout(2000) })).ok) return { base, stop: () => child.kill() }; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('share-images: the local server did not start');
}

/** Opens the page for screenshots: light scheme, no analytics, comments or audio, fonts loaded, scripts settled. */
async function openPage(browser, base, info, scale, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'light', reducedMotion: 'reduce' });
  await ctx.route(/goatcounter\.com|gc\.zgo\.at|utteranc\.es/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await ctx.route(/\/audio\/[^/]+\/manifest\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"sections":{}}' }));
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  await page.goto(base + info.url, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: shotCss(footer(info.edition)) });
  const state = await page.evaluate(async () => {
    document.documentElement.classList.add('shot-on');
    const faces = ['600 20px Fredoka', '400 16px "Nunito Sans"', '700 16px "Nunito Sans"', '500 14px "JetBrains Mono"'];
    await Promise.all(faces.map(f => document.fonts.load(f)));
    await document.fonts.ready;
    return {
      fonts: faces.filter(f => !document.fonts.check(f)),
      ids: [...document.querySelectorAll('figure.exhibit')].map(f => f.id),
      edition: document.querySelector('main').dataset.edition,
    };
  });
  if (problems.length) throw new Error(`share-images: ${info.rel} has script errors: ${problems.join('; ')}`);
  if (state.fonts.length) throw new Error(`share-images: fonts did not load (${state.fonts.join(', ')}); the images would use fallback fonts`);
  if (state.edition !== info.edition || state.ids.join() !== info.exhibits.map(x => x.id).join()) throw new Error(`share-images: ${base + info.url} does not show the exhibits of ${info.rel}`);
  return { ctx, page };
}

/** Lays one exhibit out as the 1200 x 630 card and returns the PNG. */
async function card(page, x) {
  const layout = await page.evaluate(({ x, scale, H }) => {
    const fig = document.getElementById(x.id);
    const make = cls => Object.assign(document.createElement('div'), { className: cls });
    const head = make('shot-head'), title = make('shot-title'), stage = make('shot-stage'), body = make('shot-body');
    title.textContent = x.claim;
    head.append(title);
    // Under the title: the caption's second sentence and its evidence chips
    const chips = [...fig.querySelectorAll(':scope > figcaption .chip')];
    if (x.second || chips.length) {
      const sub = make('shot-sub');
      sub.textContent = x.second;
      for (const chip of chips) sub.append(' ', chip.cloneNode(true));
      head.append(sub);
    }
    // The exhibit itself stays inside its figure and section, so every style rule still applies to it
    body.append(...[...fig.children].filter(el => el.tagName !== 'FIGCAPTION'));
    stage.append(body);
    fig.append(head, stage);
    fig.classList.add('shot', 'shot-card');
    // A toolbar that held only a switch or an "Interactive" hint would leave an empty row
    for (const bar of body.querySelectorAll('.toolbar')) if (![...bar.children].some(el => el.getClientRects().length)) bar.style.display = 'none';
    const px = n => n / scale, bottom = () => stage.getBoundingClientRect().bottom;
    // The title: large on up to two lines, or smaller on three, so that a long claim leaves room for the exhibit
    let size = 0;
    for (const [s, lines] of [[50, 2], [46, 2], [42, 2], [40, 3], [36, 3], [32, 3], [30, 9]]) {
      size = s;
      fig.style.setProperty('--shot-title', px(size) + 'px');
      if (title.getBoundingClientRect().height <= px(size) * 1.14 * lines + 1) break;
    }
    // The exhibit: as large as it can be and still fit whole. One that is too tall for that is shown at a
    // readable size and cut off above the footer; it is never shrunk to fit.
    const limit = px(H - 58 - 22), CUT = 1.1;
    const sideways = () => [body, ...body.querySelectorAll('.tbl')].some(el => el.scrollWidth > el.clientWidth + 1);
    let zoom = 0, fits = false;
    for (zoom of [1.4, 1.25, CUT, 1]) {
      fig.style.setProperty('--shot-zoom', zoom);
      fits = bottom() <= limit && !sideways();
      if (fits) break;
    }
    if (!fits) fig.style.setProperty('--shot-zoom', zoom = CUT);
    const clip = bottom() > limit;
    fig.classList.toggle('shot-clip', clip);
    // A short exhibit sits in the middle of the space under the title
    if (!clip) fig.style.setProperty('--shot-push', Math.max(0, (limit - bottom()) / 2) + 'px');
    const r = fig.getBoundingClientRect();
    return { size, zoom, clip, rect: [r.left, r.top, r.width, r.height].map(v => Math.round(v * scale)) };
  }, { x, scale: CARD_SCALE, H: CARD.height });
  if (layout.rect.join() !== [0, 0, CARD.width, CARD.height].join()) throw new Error(`share-images: ${x.id} could not be laid out as a card (it sits at ${layout.rect})`);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: CARD.width / CARD_SCALE, height: CARD.height / CARD_SCALE } });
  await page.evaluate(id => document.getElementById(id).classList.remove('shot', 'shot-card'), x.id);
  return { png, layout };
}

/** Lays one exhibit out with its caption and the footer, as tall as it needs, and returns the PNG. */
async function full(page, scale, x) {
  const measure = id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  await page.evaluate(id => document.getElementById(id).classList.add('shot', 'shot-full'), x.id);
  let [, , , height] = await page.evaluate(measure, x.id);
  // A fixed box taller than the window would be cut off: make the window as tall as the exhibit
  await page.setViewportSize({ width: 1000, height: Math.ceil(height) + 2 });
  const rect = await page.evaluate(measure, x.id);
  if (rect[0] !== 0 || rect[1] !== 0 || rect[2] !== FULL_WIDTH) throw new Error(`share-images: ${x.id} could not be laid out for the full image (it sits at ${rect})`);
  height = Math.ceil(rect[3] * scale) / scale;
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: FULL_WIDTH, height } });
  await page.evaluate(id => document.getElementById(id).classList.remove('shot', 'shot-full'), x.id);
  return png;
}

async function render(info, base, only) {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const dir = path.join(REPO, 'share', info.edition);
  const todo = info.exhibits.filter(x => !only || only.includes(x.id));
  const kb = n => `${Math.round(n / 1024)} KB`;
  // Every image is stored with a palette when that keeps its colors (see quantizePng), as shot otherwise
  const shrink = png => { const small = quantizePng(png); return small && small.length < png.length ? small : png; };
  const colors = png => (png[25] === 3 ? 'palette' : 'full color');
  let bytes = 0;
  try {
    const cards = await openPage(browser, base, info, CARD_SCALE, { width: CARD.width / CARD_SCALE, height: CARD.height / CARD_SCALE });
    for (const x of todo) {
      const { png: shot, layout } = await card(cards.page, x);
      const png = shrink(shot), size = pngSize(png);
      if (!size || size.width !== CARD.width || size.height !== CARD.height) throw new Error(`share-images: the card of ${x.id} is ${size && size.width} x ${size && size.height}`);
      await writeFile(path.join(dir, `${x.id}.png`), png);
      bytes += png.length;
      console.log(`  ${x.id}.png  ${kb(png.length)}  ${colors(png)}, title ${layout.size}px, exhibit x${layout.zoom}${layout.clip ? ', cut off with a fade' : ''}`);
    }
    await cards.ctx.close();
    // Full images: scale 2, or 1.5 for an exhibit so long that its file would pass MAX_BYTES
    const pages = {};
    for (const x of todo) {
      let png, scale;
      for (scale of [2, 1.5]) {
        pages[scale] ??= await openPage(browser, base, info, scale, { width: 1000, height: 800 });
        png = shrink(await full(pages[scale].page, scale, x));
        if (png.length <= MAX_BYTES) break;
      }
      await writeFile(path.join(dir, `${x.id}-full.png`), png);
      bytes += png.length;
      const size = pngSize(png);
      console.log(`  ${x.id}-full.png  ${kb(png.length)}  ${colors(png)}, ${size.width} x ${size.height} (scale ${scale})${png.length > MAX_BYTES ? ', still large' : ''}`);
    }
  } finally {
    await browser.close();
  }
  return { count: todo.length * 2, bytes };
}

// ---------- write or check ----------

async function expected(info) {
  const dir = path.join(REPO, 'share', info.edition);
  const files = new Map(); // path relative to share/<edition>/ -> the page's HTML, or null for an image
  for (const x of info.exhibits) {
    files.set(`${x.id}/index.html`, sharePage(info.edition, x));
    files.set(`${x.id}.png`, null);
    files.set(`${x.id}-full.png`, null);
  }
  const present = existsSync(dir) ? (await readdir(dir, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/')) : [];
  return { dir, files, extra: present.filter(f => !files.has(f)) };
}

async function check(info) {
  const { dir, files, extra } = await expected(info);
  const out = [], where = f => `share/${info.edition}/${f}`;
  for (const [f, html] of files) {
    const p = path.join(dir, f);
    if (!existsSync(p)) { out.push(`${where(f)} is missing`); continue; }
    const have = await readFile(p);
    if (html !== null) { if (have.toString('utf8') !== html) out.push(`${where(f)} is out of date`); continue; }
    const size = pngSize(have);
    if (!size) out.push(`${where(f)} is not a PNG`);
    else if (!f.endsWith('-full.png') && (size.width !== CARD.width || size.height !== CARD.height)) out.push(`${where(f)} is ${size.width} x ${size.height}, not ${CARD.width} x ${CARD.height}`);
  }
  for (const f of extra) out.push(`${where(f)} has no exhibit in ${info.rel} any more`);
  return out;
}

async function write(info, base, only) {
  const { dir, files, extra } = await expected(info);
  for (const f of extra) await rm(path.join(dir, f));
  for (const [f, html] of files) {
    if (html === null) continue;
    await mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await writeFile(path.join(dir, f), html);
  }
  // Folders left empty by a removed exhibit
  for (const e of await readdir(dir, { withFileTypes: true })) if (e.isDirectory() && !(await readdir(path.join(dir, e.name))).length) await rm(path.join(dir, e.name), { recursive: true });
  console.log(`${info.rel}: edition ${info.edition}, ${info.exhibits.length} share pages in share/${info.edition}/${extra.length ? `, ${extra.length} stale files removed` : ''}`);
  const { count, bytes } = await render(info, base, only);
  console.log(`${info.rel}: ${count} images, ${(bytes / 1048576).toFixed(1)} MB`);
}

async function main() {
  const args = process.argv.slice(2), opt = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check' || a === '--all') opt[a.slice(2)] = true;
    else if (['--page', '--base', '--only'].includes(a) && args[i + 1]) opt[a.slice(2)] = args[++i];
    else { console.error(`share-images: unknown or incomplete option ${a}\nSee the top of e2e/share-images.mjs.`); process.exit(2); }
  }
  let files = [path.resolve(REPO, opt.page || 'index.html')];
  if (opt.all) {
    const eds = (await readdir(path.join(REPO, 'editions'))).sort().map(d => path.join(REPO, 'editions', d, 'index.html')).filter(existsSync);
    files = [path.join(REPO, 'index.html'), ...eds];
  }
  // index.html and its archived copy are the same edition: one share folder serves both
  const pages = new Map();
  let failed = false;
  for (const f of files) {
    const info = await readPage(f);
    for (const e of info.errors) { console.error(e); failed = true; }
    const first = pages.get(info.edition);
    if (!first) pages.set(info.edition, info);
    else if (JSON.stringify(first.exhibits) !== JSON.stringify(info.exhibits)) { console.error(`${first.rel} and ${info.rel} are both edition ${info.edition}, but their exhibits differ`); failed = true; }
  }
  if (failed) process.exit(1);

  if (opt.check) {
    const problems = [];
    for (const info of pages.values()) problems.push(...await check(info));
    if (opt.all) {
      const dirs = existsSync(path.join(REPO, 'share')) ? await readdir(path.join(REPO, 'share')) : [];
      for (const d of dirs) if (!pages.has(d)) problems.push(`share/${d}/ has no page with data-edition="${d}": delete the folder`);
    }
    const n = [...pages.values()].reduce((t, p) => t + p.exhibits.length, 0);
    if (problems.length) {
      console.error(problems.join('\n'));
      console.error(`share-images: ${problems.length} problem${problems.length > 1 ? 's' : ''}. Run node e2e/share-images.mjs${opt.all ? ' --all' : opt.page ? ` --page ${opt.page}` : ''} and commit the result.`);
      process.exit(1);
    }
    console.log(`share-images: ${n} exhibits in ${[...pages.keys()].sort().join(', ')}; share pages are up to date and every image is present`);
    return;
  }

  const only = opt.only ? opt.only.split(',').map(s => s.trim()).filter(Boolean) : null;
  const known = [...pages.values()].flatMap(p => p.exhibits.map(x => x.id));
  const unknown = (only || []).filter(id => !known.includes(id));
  if (unknown.length) { console.error(`share-images: no exhibit has the id ${unknown.join(', ')}`); process.exit(1); }
  const server = opt.base ? null : await startServer();
  try {
    for (const info of pages.values()) await write(info, (opt.base || server.base).replace(/\/$/, ''), only);
  } finally {
    if (server) server.stop();
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
