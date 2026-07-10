// dashboard/server.js — Custom Next.js server with WebSocket proxy
// Proxies /api/ws to backend:6800 so only port 6801 is exposed

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const httpProxy = require('http-proxy');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const BACKEND = 'http://127.0.0.1:6800';

// Create proxy for WebSocket + API fallback
const proxy = httpProxy.createProxyServer({
  target: BACKEND,
  ws: true,
  changeOrigin: true,
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    // Proxy /api/* to backend
    if (parsedUrl.pathname?.startsWith('/api/') || parsedUrl.pathname?.startsWith('/screenshots/')) {
      proxy.web(req, res, { target: BACKEND });
      return;
    }

    // Let Next.js handle everything else
    handle(req, res, parsedUrl);
  });

  // WebSocket upgrade: proxy to backend
  server.on('upgrade', (req, socket, head) => {
    const parsedUrl = parse(req.url, true);
    if (parsedUrl.pathname?.startsWith('/api/ws')) {
      proxy.ws(req, socket, head, { target: BACKEND });
    } else {
      socket.destroy();
    }
  });

  const PORT = process.env.PORT || 6801;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AegisAgent Dashboard listening on port ${PORT} (proxying /api/* to ${BACKEND})`);
  });
});
