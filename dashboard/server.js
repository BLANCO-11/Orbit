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

// Handle proxy errors to prevent Node crash when backend is offline
proxy.on('error', (err, req, res) => {
  console.error('Proxy connection error:', err.message);
  if (!res) return;
  if (typeof res.writeHead === 'function') {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway: backend offline');
  } else if (typeof res.destroy === 'function') {
    res.destroy();
  }
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

  // Override server.emit to intercept 'upgrade' events before other listeners (like Next.js) receive them.
  // This prevents double-upgrading/double-handling of WebSockets which causes "Invalid frame header".
  const originalEmit = server.emit;
  server.emit = function (event, ...args) {
    if (event === 'upgrade') {
      const [req, socket, head] = args;
      const parsedUrl = parse(req.url, true);
      if (parsedUrl.pathname?.startsWith('/api/ws')) {
        proxy.ws(req, socket, head, { target: BACKEND });
        return true; // Handled, prevent propagation to other listeners
      }
      if (!parsedUrl.pathname?.startsWith('/_next/')) {
        socket.destroy();
        return true; // Handled/destroyed, prevent propagation
      }
    }
    return originalEmit.apply(this, [event, ...args]);
  };

  // Parse command line arguments for port and hostname
  const args = process.argv.slice(2);
  let PORT = process.env.PORT || 6801;
  let HOST = '0.0.0.0';

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      PORT = parseInt(args[i + 1], 10);
      i++;
    } else if ((args[i] === '--hostname' || args[i] === '-H') && args[i + 1]) {
      HOST = args[i + 1];
      i++;
    }
  }

  server.listen(PORT, HOST, () => {
    console.log(`Orbit Dashboard listening on ${HOST}:${PORT} (proxying /api/* to ${BACKEND})`);
  });
});
