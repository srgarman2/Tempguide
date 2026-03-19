import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev-only proxy that forwards /api/bridge/* requests to a Combustion WiFi
 * accessory on the LAN, avoiding browser CORS restrictions.
 *
 * Endpoints:
 *   GET /api/bridge/probe?host=<ip>  — try common paths, return the first that works
 *   GET /api/bridge/get?host=<ip>&path=/some/path — fetch an arbitrary path
 */
function combustionBridgeProxy() {
  const PROBE_PATHS = [
    '/',
    '/data',
    '/api/data',
    '/api/status',
    '/status',
    '/temperatures',
    '/api/temperatures',
    '/api/v1/data',
    '/api/v1/status',
    '/probe',
  ];

  async function fetchDevice(host, path, timeoutMs = 5000) {
    const target = `http://${host}${path}`;
    const resp = await fetch(target, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json, text/html, */*' },
    });
    const contentType = resp.headers.get('content-type') || '';
    const body = await resp.text();
    return { status: resp.status, contentType, body, path };
  }

  return {
    name: 'combustion-bridge-proxy',
    configureServer(server) {
      // Probe endpoint — tries common paths to discover what the device exposes
      server.middlewares.use('/api/bridge/probe', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const host = url.searchParams.get('host');

        if (!host) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing host query parameter' }));
          return;
        }

        const results = [];
        for (const path of PROBE_PATHS) {
          try {
            const r = await fetchDevice(host, path, 3000);
            results.push({ path, status: r.status, contentType: r.contentType, body: r.body.slice(0, 2000) });
          } catch (err) {
            results.push({ path, status: 0, error: String(err?.message || err) });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ host, results }));
      });

      // Generic fetch endpoint — proxy any path to the device
      server.middlewares.use('/api/bridge/get', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const host = url.searchParams.get('host');
        const devicePath = url.searchParams.get('path') || '/';

        if (!host) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing host query parameter' }));
          return;
        }

        try {
          const r = await fetchDevice(host, devicePath);
          res.writeHead(r.status, { 'Content-Type': r.contentType || 'application/json' });
          res.end(r.body);
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err?.message || err) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), combustionBridgeProxy()],
  server: {
    port: 5173,
    https: false, // Web Bluetooth requires HTTPS in production; use chrome://flags/#enable-web-bluetooth-new-permissions-backend for local dev
  }
})
