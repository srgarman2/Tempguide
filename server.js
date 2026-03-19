#!/usr/bin/env node
/**
 * Production server for Tempguide.
 *
 * Serves the Vite-built static files from dist/ AND proxies
 * /api/bridge/* requests to the Combustion WiFi accessory on the LAN,
 * so the browser never makes a cross-origin or mixed-content request.
 *
 * Usage:
 *   npm run build
 *   node server.js              # http://localhost:3000
 *   PORT=8080 node server.js    # http://localhost:8080
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

// ── Bridge proxy ────────────────────────────────────────────────────────────

async function handleBridgeProxy(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const host = url.searchParams.get('host');

  if (!host) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing host query parameter' }));
    return;
  }

  const devicePath = url.pathname.replace(/^\/?/, '/');
  const target = `http://${host}${devicePath}`;

  try {
    const resp = await fetch(target, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    });
    const body = await resp.text();
    res.writeHead(resp.status, {
      'Content-Type': resp.headers.get('content-type') || 'application/json',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
}

// ── Static file server ──────────────────────────────────────────────────────

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let filePath = join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // SPA fallback — serve index.html for any unmatched path
    filePath = join(DIST, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// ── Router ──────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/bridge/')) {
    handleBridgeProxy(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Tempguide server running at http://localhost:${PORT}`);
});
