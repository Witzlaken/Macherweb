const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;

// ===== CORS HEADERS =====
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ===== DISCORD PROXY =====
function proxyDiscord(webhookUrl, body, res) {
  const parsed = url.parse(webhookUrl);
  const postData = JSON.stringify(body);

  const options = {
    hostname: parsed.hostname,
    path: parsed.path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = https.request(options, (discordRes) => {
    let data = '';
    discordRes.on('data', chunk => data += chunk);
    discordRes.on('end', () => {
      setCORS(res);
      res.writeHead(discordRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: discordRes.statusCode < 300, status: discordRes.statusCode }));
    });
  });

  req.on('error', (e) => {
    setCORS(res);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  });

  req.write(postData);
  req.end();
}

// ===== MAIN SERVER =====
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Discord Proxy Endpoint
  if (req.method === 'POST' && parsedUrl.pathname === '/discord') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { webhookUrl, message, username } = JSON.parse(body);
        if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
          setCORS(res);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Ungültige Webhook URL' }));
          return;
        }
        proxyDiscord(webhookUrl, { content: message, username: username || 'Macher Buissnes' }, res);
      } catch (e) {
        setCORS(res);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Ungültiges JSON' }));
      }
    });
    return;
  }

  // Statische Dateien ausliefern
  let filePath = parsedUrl.pathname === '/' ? '/macher_buissnes.html' : parsedUrl.pathname;
  filePath = path.join(__dirname, filePath);

  const extMap = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  };
  const ext = path.extname(filePath);
  const contentType = extMap[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Datei nicht gefunden: ' + parsedUrl.pathname);
      return;
    }
    setCORS(res);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     MACHER BUISSNES – Server läuft     ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  Öffne: http://localhost:${PORT}           ║`);
  console.log('║  Discord Proxy aktiv auf /discord      ║');
  console.log('║  Zum Stoppen: STRG + C                 ║');
  console.log('╚════════════════════════════════════════╝\n');
});