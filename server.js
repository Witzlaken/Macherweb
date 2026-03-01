const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const DB_FILE = path.join(__dirname, 'db.json');

// ===== DATENBANK =====
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) {}
  return {
    users: [
      { username: 'admin', password: 'admin123', role: 'admin', displayName: 'Admin' },
      { username: 'member1', password: 'pass123', role: 'member', displayName: 'Member1' }
    ]
  };
}

function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch(e) { console.error('DB Fehler:', e.message); }
}

let db = loadDB();
// Beim ersten Start DB initialisieren
if (!fs.existsSync(DB_FILE)) saveDB(db);

const sessions = {};

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

function getSession(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  return sessions[token] ? { token, ...sessions[token] } : null;
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function json(res, code, data) {
  setCORS(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch(e) { resolve({}); } });
  });
}

function proxyDiscord(webhookUrl, body, res) {
  const parsed = url.parse(webhookUrl);
  const postData = JSON.stringify(body);
  const opts = { hostname: parsed.hostname, path: parsed.path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };
  const req = https.request(opts, (dr) => {
    let d = '';
    dr.on('data', c => d += c);
    dr.on('end', () => json(res, 200, { ok: dr.statusCode < 300, status: dr.statusCode }));
  });
  req.on('error', (e) => json(res, 500, { ok: false, error: e.message }));
  req.write(postData);
  req.end();
}

const server = http.createServer(async (req, res) => {
  const purl = url.parse(req.url, true);
  const p = purl.pathname;

  if (req.method === 'OPTIONS') { setCORS(res); res.writeHead(204); res.end(); return; }

  // POST /api/login
  if (req.method === 'POST' && p === '/api/login') {
    const body = await readBody(req);
    db = loadDB();
    const user = db.users.find(u => u.username === body.username && u.password === body.password);
    if (!user) return json(res, 401, { ok: false, error: 'Ungültige Anmeldedaten' });
    const token = generateToken();
    sessions[token] = { username: user.username, role: user.role, displayName: user.displayName || user.username };
    return json(res, 200, { ok: true, token, user: { username: user.username, role: user.role, displayName: user.displayName || user.username } });
  }

  // GET /api/users
  if (req.method === 'GET' && p === '/api/users') {
    const sess = getSession(req);
    if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'Kein Zugriff' });
    db = loadDB();
    return json(res, 200, { ok: true, count: db.users.length, users: db.users.map(u => ({ username: u.username, role: u.role, displayName: u.displayName || u.username })) });
  }

  // POST /api/users
  if (req.method === 'POST' && p === '/api/users') {
    const sess = getSession(req);
    if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'Kein Zugriff' });
    const body = await readBody(req);
    if (!body.username || !body.password) return json(res, 400, { ok: false, error: 'Fehlende Felder' });
    db = loadDB();
    if (db.users.find(u => u.username === body.username)) return json(res, 409, { ok: false, error: 'Benutzername vergeben' });
    db.users.push({ username: body.username, password: body.password, role: body.role || 'member', displayName: body.username });
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  // DELETE /api/users/:username
  if (req.method === 'DELETE' && p.startsWith('/api/users/')) {
    const sess = getSession(req);
    if (!sess || sess.role !== 'admin') return json(res, 403, { ok: false, error: 'Kein Zugriff' });
    const target = decodeURIComponent(p.replace('/api/users/', ''));
    if (target === sess.username) return json(res, 400, { ok: false, error: 'Eigenen Account nicht löschbar' });
    db = loadDB();
    db.users = db.users.filter(u => u.username !== target);
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  // PUT /api/me
  if (req.method === 'PUT' && p === '/api/me') {
    const sess = getSession(req);
    if (!sess) return json(res, 401, { ok: false, error: 'Nicht eingeloggt' });
    const body = await readBody(req);
    db = loadDB();
    const idx = db.users.findIndex(u => u.username === sess.username);
    if (idx === -1) return json(res, 404, { ok: false, error: 'User nicht gefunden' });
    if (body.displayName) { db.users[idx].displayName = body.displayName; sessions[sess.token].displayName = body.displayName; }
    if (body.password) db.users[idx].password = body.password;
    saveDB(db);
    return json(res, 200, { ok: true, user: { username: db.users[idx].username, role: db.users[idx].role, displayName: db.users[idx].displayName } });
  }

  // POST /discord
  if (req.method === 'POST' && p === '/discord') {
    const body = await readBody(req);
    if (!body.webhookUrl || !body.webhookUrl.startsWith('https://discord.com/api/webhooks/')) return json(res, 400, { ok: false, error: 'Ungültige Webhook URL' });
    proxyDiscord(body.webhookUrl, { content: body.message, username: body.username || 'Macher Buissnes' }, res);
    return;
  }

  // Statische Dateien
  let filePath = p === '/' ? '/macher_buissnes.html' : p;
  filePath = path.join(__dirname, filePath);
  const extMap = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
  const contentType = extMap[path.extname(filePath)] || 'text/plain';
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    setCORS(res);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║      MACHER BUISSNES – Server läuft      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  http://localhost:${PORT}                    ║`);
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('  Login: admin / admin123\n');
});
