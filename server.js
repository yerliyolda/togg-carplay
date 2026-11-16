const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// public/ klasörü yoksa (düz dosya yapısı) statik dosyalar kök dizinden servis edilir
const PUBLIC = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const FLAT = new Set(['index.html', 'phone.html', 'style.css', 'car.js']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

// session: { car:Set<ws>, phone:Set<ws>, last:{loc}, touched }
const sessions = new Map();
const getSession = (id) => {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { car: new Set(), phone: new Set(), last: {}, touched: Date.now() }));
  s.touched = Date.now();
  return s;
};
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
const baseUrl = (req) => {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/new') {
    const id = crypto.randomBytes(16).toString('hex');
    getSession(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id }));
  }
  if (url.pathname === '/qr') {
    const id = url.searchParams.get('s');
    if (!validId(id)) { res.writeHead(400); return res.end(); }
    const svg = await QRCode.toString(`${baseUrl(req)}/phone.html?s=${id}`, { type: 'svg', margin: 1, width: 320 });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(svg);
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC) || (PUBLIC === __dirname && !FLAT.has(path.basename(file))) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const id = q.get('s'), role = q.get('role') === 'phone' ? 'phone' : 'car';
  if (!validId(id) || (role === 'phone' && !sessions.has(id))) { ws.close(4000, 'bad session'); return; }
  const s = getSession(id);
  const other = role === 'car' ? 'phone' : 'car';
  s[role].add(ws);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  const send = (target, m) => target.forEach((c) => c.readyState === 1 && c.send(JSON.stringify(m)));
  const status = () => { const m = { type: 'status', phone: s.phone.size > 0, car: s.car.size > 0 }; send(s.car, m); send(s.phone, m); };
  status();
  if (role === 'car' && s.last.loc) ws.send(JSON.stringify(s.last.loc));
  ws.on('message', (data) => {
    if (role !== 'phone' && role !== 'car') return;
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m.type !== 'string' || data.length > 20000) return;
    if (m.type === 'loc') s.last.loc = m;
    send(s[other], m);
  });
  ws.on('close', () => { s[role].delete(ws); status(); });
});
setInterval(() => {
  wss.clients.forEach((c) => { if (!c.isAlive) return c.terminate(); c.isAlive = false; c.ping(); });
  const now = Date.now();
  for (const [id, s] of sessions) if (!s.car.size && !s.phone.size && now - s.touched > 24 * 3600e3) sessions.delete(id);
}, 30000);

server.listen(PORT, () => console.log(`Togg CarPlay çalışıyor: http://localhost:${PORT}`));
