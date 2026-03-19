import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev-only proxy that forwards /api/bridge/* requests to a Combustion WiFi
 * accessory on the LAN, avoiding browser CORS restrictions.  The target host
 * is passed as a query-string parameter:
 *
 *   GET /api/bridge/data?host=192.168.0.145
 *       → proxied to http://192.168.0.145/data
 */
function combustionBridgeProxy() {
  return {
    name: 'combustion-bridge-proxy',
    configureServer(server) {
      server.middlewares.use('/api/bridge', async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const host = url.searchParams.get('host');

        if (!host) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing host query parameter' }));
          return;
        }

        // Strip the /api/bridge prefix to get the device-relative path
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
          res.end(JSON.stringify({ error: err.message }));
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
