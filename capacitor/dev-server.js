const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = parseInt(process.env.PORT || process.env.POS_PORT || '3000', 10);
const WWW_DIR = path.join(__dirname, 'www');
const SRC_DIR = path.join(__dirname, 'src');
const BRIDGE_OUT = path.join(WWW_DIR, 'sqlite-bridge.js');
const BRIDGE_SRC = path.join(SRC_DIR, 'sqlite-bridge.js');

// Ensure SQLite bridge bundle is built
function buildBridge() {
  try {
    if (!fs.existsSync(BRIDGE_SRC)) return;
    console.log('[DevServer] Building SQLite bridge bundle (www/sqlite-bridge.js)...');
    execSync('npm run build:bridge', {
      cwd: __dirname,
      stdio: 'inherit'
    });
    console.log('[DevServer] SQLite bridge ready.');
  } catch (err) {
    console.error('[DevServer] Failed to build bridge bundle:', err.message);
  }
}

if (!fs.existsSync(BRIDGE_OUT)) {
  buildBridge();
}

// Watch src/ directory for bridge source edits
if (fs.existsSync(SRC_DIR)) {
  let bridgeDebounce = null;
  try {
    fs.watch(SRC_DIR, { recursive: true }, () => {
      clearTimeout(bridgeDebounce);
      bridgeDebounce = setTimeout(() => {
        buildBridge();
        notifyReload();
      }, 250);
    });
  } catch (_) {}
}

// Live-reload SSE clients
const sseClients = new Set();

function notifyReload() {
  for (const client of sseClients) {
    try {
      client.write('data: reload\n\n');
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// Watch www/ directory for code & styling edits
let watchDebounce = null;
try {
  fs.watch(WWW_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (filename.includes('.git') || filename.endsWith('~') || filename.endsWith('.tmp')) return;
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      console.log(`[DevServer] Change detected in www/${filename} -> reloading browser...`);
      notifyReload();
    }, 120);
  });
} catch (err) {
  console.warn('[DevServer] File watch warning:', err.message);
}

// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const LIVE_RELOAD_SCRIPT = `
<!-- Dev Live Reload -->
<script id="__dev_live_reload">
  (() => {
    let es;
    function connect() {
      es = new EventSource('/dev-live-reload');
      es.onmessage = (e) => {
        if (e.data === 'reload') {
          console.log('[Dev] Change detected, reloading...');
          location.reload();
        }
      };
      es.onerror = () => {
        es.close();
        setTimeout(connect, 1200);
      };
    }
    connect();
  })();
</script>
`;

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Server Error: ' + err.message);
      return;
    }

    if (contentType.startsWith('text/html')) {
      let html = content.toString('utf-8');
      if (html.includes('</body>')) {
        html = html.replace('</body>', LIVE_RELOAD_SCRIPT + '\n</body>');
      } else {
        html += LIVE_RELOAD_SCRIPT;
      }
      content = Buffer.from(html, 'utf-8');
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  });
}

function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // CORS preflight support
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // Paystack Charge proxy endpoint
  if (pathname.startsWith('/api/admin/sms/')) {
    require('./sms').handle(req, res, pathname);
    return;
  }

  if (pathname === '/api/paystack/charge' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(raw || '{}');
        const https = require('https');
        
        let secretKey = 'sk_live_91baa01872ba458e72ab98118415ed9a69778dee';
        const keyFileCandidates = [
          path.join(__dirname, '..', 'paystack.txt'),
          path.join(__dirname, 'paystack.txt'),
          path.join(WWW_DIR, 'paystack.txt')
        ];
        for (const kf of keyFileCandidates) {
          if (fs.existsSync(kf)) {
            const k = fs.readFileSync(kf, 'utf-8').trim();
            if (k) { secretKey = k; break; }
          }
        }
        // The configured key file is authoritative for proxied payments.

        const dataStr = JSON.stringify({
          email: String(payload.email || `mpesa.${String(payload.phone || payload.mobile_money?.phone || '').replace(/\D/g, '')}@example.com`).trim(),
          amount: payload.amount,
          currency: payload.currency || 'KES',
          mobile_money: payload.mobile_money || { phone: payload.phone, provider: 'mpesa' }
        });

        const preq = https.request({
          hostname: 'api.paystack.co',
          path: '/charge',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(dataStr),
            'User-Agent': 'Oraforge-POS/1.0'
          }
        }, pres => {
          let resData = '';
          pres.on('data', c => resData += c);
          pres.on('end', () => {
            res.writeHead(pres.statusCode || 200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(resData);
          });
        });

        preq.on('error', err => {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ status: false, message: 'Paystack connection error: ' + err.message }));
        });

        preq.write(dataStr);
        preq.end();
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ status: false, message: 'Invalid payload: ' + err.message }));
      }
    });
    return;
  }

  // SSE endpoint for live reload
  if (pathname === '/dev-live-reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Canonical admin routes
  if (pathname === '/admin' || pathname === '/admin/') {
    return serveFile(res, path.join(WWW_DIR, 'admin.html'), 'text/html; charset=utf-8');
  }

  // Resolve target file path
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(WWW_DIR, safePath);

  // Check if requested path points directly to an existing file
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return serveFile(res, filePath, contentType);
  }

  // If path is a directory and has index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const dirIndex = path.join(filePath, 'index.html');
    if (fs.existsSync(dirIndex)) {
      return serveFile(res, dirIndex, 'text/html; charset=utf-8');
    }
  }

  // If request has no extension, assume SPA route -> fallback to index.html
  if (!path.extname(pathname)) {
    const indexPath = path.join(WWW_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return serveFile(res, indexPath, 'text/html; charset=utf-8');
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found: ' + pathname);
}

function startServer(port, attempts = 0) {
  const server = http.createServer(handleRequest);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts < 10) {
      const nextPort = port + 1;
      console.log(`[DevServer] Port ${port} is in use, trying ${nextPort}...`);
      startServer(nextPort, attempts + 1);
    } else {
      console.error('[DevServer] Server error:', err.message);
      process.exit(1);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    const url = `http://localhost:${port}`;
    console.log('\n' + '='.repeat(64));
    console.log('  🚀 Oraforge POS — Local APK Browser Preview Server');
    console.log('='.repeat(64));
    console.log(`  📱 POS Terminal:  ${url}/pos`);
    console.log(`  👑 Admin Portal:  ${url}/admin.html`);
    console.log(`  ⚡ Live Reload:   ACTIVE (edits in capacitor/www/ auto-refresh)`);
    console.log(`  🔑 Default PIN:   1234`);
    console.log('='.repeat(64));
    console.log('  💡 PRO-TIP FOR SEEING IT "JUST LIKE THE APK":');
    console.log('     1. Open ' + url + ' in Chrome or Firefox.');
    console.log('     2. Press F12 (Inspect), then press Ctrl+Shift+M');
    console.log('        (or click the phone/tablet icon in DevTools).');
    console.log('     3. Select a device like "Pixel 7" or "Samsung Galaxy"');
    console.log('        to test the exact APK touch and mobile layout!');
    console.log('='.repeat(64) + '\n');
  });
}

startServer(PORT);
