const $ = (s) => document.querySelector(s);
const MOD = { left: 'sola', right: 'sağa', 'slight left': 'hafif sola', 'slight right': 'hafif sağa', 'sharp left': 'keskin sola', 'sharp right': 'keskin sağa', straight: 'düz', uturn: 'geri' };
let loc = null, dest = null, route = null, stepIdx = 0, follow = true, lastRouteAt = 0;

// ---------- navigasyon (uygulamalar) ----------
function show(app) {
  document.querySelectorAll('.app').forEach((e) => e.classList.toggle('active', e.id === app));
  document.querySelectorAll('#dock button').forEach((b) => b.classList.toggle('active', b.dataset.app === app));
  if (app === 'map') setTimeout(() => map.invalidateSize(), 50);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-app]'); if (b) show(b.dataset.app); });
$('#fsBtn').onclick = () => document.documentElement.requestFullscreen?.();

// ---------- saat ----------
setInterval(() => {
  const d = new Date();
  $('#time').textContent = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  $('#date').textContent = d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
}, 1000);

// ---------- eşleştirme ----------
let sid = localStorage.getItem('sid');
async function newSession() {
  sid = (await (await fetch('/api/new')).json()).id;
  localStorage.setItem('sid', sid);
  connect();
}
$('#newSess').onclick = () => { ws && ws.close(); newSession(); };
let ws;
function connect() {
  $('#qr').src = `/qr?s=${sid}&t=${Date.now()}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=car&s=${sid}`);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  const mine = ws;
  ws.onclose = () => { if (ws === mine) setTimeout(connect, 2000); };
}
function setPaired(on) {
  $('#dot').classList.toggle('on', on);
  $('#pTile').textContent = on ? 'Bağlı' : 'Bağlı değil';
  $('#pStatus').textContent = on ? 'Telefon bağlı ✓' : 'Telefonunu eşleştir';
}
function handle(m) {
  if (m.type === 'status') { const was = $('#dot').classList.contains('on'); setPaired(m.phone); if (m.phone && !was) show('home'); }
  else if (m.type === 'loc') onLoc(m);
  else if (m.type === 'dest') { setDest(m); show('map'); }
  else if (m.type === 'url') playUrl(m.url);
}

// ---------- harita ----------
const map = L.map('mapEl', { zoomControl: false }).setView([41.0, 29.0], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OSM © CARTO' }).addTo(map);
const me = L.marker([0, 0], { icon: L.divIcon({ className: '', html: '<div class="car-marker"></div>', iconSize: [22, 22] }) });
let destMarker, routeLine;
map.on('dragstart', () => (follow = false));
$('#recenter').onclick = () => { follow = true; if (loc) map.setView([loc.lat, loc.lon], 16); };

async function search() {
  const q = $('#q').value.trim(); if (!q) return;
  const vb = loc ? `&viewbox=${loc.lon - 1},${loc.lat + 1},${loc.lon + 1},${loc.lat - 1}` : '';
  const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=tr&countrycodes=tr&q=${encodeURIComponent(q)}${vb}`)).json();
  const box = $('#results'); box.innerHTML = '';
  r.forEach((x) => { const d = document.createElement('div'); d.textContent = x.display_name; d.onclick = () => { box.innerHTML = ''; setDest({ lat: +x.lat, lon: +x.lon, name: x.display_name }); }; box.appendChild(d); });
  if (!r.length) box.innerHTML = '<div>Sonuç yok</div>';
}
$('#go').onclick = search;
$('#q').onkeydown = (e) => e.key === 'Enter' && search();

function setDest(d) { dest = d; if (destMarker) destMarker.remove(); destMarker = L.marker([d.lat, d.lon]).addTo(map); getRoute(); }
function stopNav() { dest = route = null; destMarker?.remove(); routeLine?.remove(); $('#nav').hidden = true; }
$('#stop').onclick = stopNav;

async function getRoute() {
  if (!dest || !loc) { $('#nav').hidden = false; $('#step').textContent = 'Konum bekleniyor…'; return; }
  lastRouteAt = Date.now();
  try {
    const u = `https://router.project-osrm.org/route/v1/driving/${loc.lon},${loc.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson&steps=true`;
    const j = await (await fetch(u)).json();
    route = j.routes[0]; stepIdx = 1;
    routeLine?.remove();
    routeLine = L.geoJSON(route.geometry, { style: { color: '#0a84ff', weight: 8 } }).addTo(map);
    if (follow === false || !loc) map.fitBounds(routeLine.getBounds());
    updateNav();
  } catch { $('#step').textContent = 'Rota alınamadı'; $('#nav').hidden = false; }
}
const dist = (a, b) => { const R = 6371e3, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const fmtD = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m');
function updateNav() {
  if (!route || !loc) return;
  const steps = route.legs[0].steps;
  const p = [loc.lat, loc.lon];
  while (stepIdx < steps.length - 1 && dist(p, [steps[stepIdx].maneuver.location[1], steps[stepIdx].maneuver.location[0]]) < 30) stepIdx++;
  const s = steps[Math.min(stepIdx, steps.length - 1)];
  const toS = dist(p, [s.maneuver.location[1], s.maneuver.location[0]]);
  const m = s.maneuver, mod = MOD[m.modifier] || '';
  let txt = m.type === 'arrive' ? 'Hedefe vardınız' : m.type === 'roundabout' || m.type === 'rotary' ? `Dönel kavşaktan ${m.exit || ''}. çıkış` : mod ? `${mod[0].toUpperCase() + mod.slice(1)} dönün` : 'Düz devam edin';
  if (s.name && m.type !== 'arrive') txt += ` → ${s.name}`;
  $('#step').textContent = `${fmtD(toS)} sonra ${txt}`;
  let left = 0; for (let i = stepIdx; i < steps.length; i++) left += steps[i].distance;
  const mins = Math.max(1, Math.round((route.duration * left) / route.distance / 60));
  const eta = new Date(Date.now() + mins * 60000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  $('#eta').textContent = `${fmtD(left)} · ${mins} dk · ${eta}`;
  $('#nav').hidden = false;
  if (steps.length && toS > 0 && m.type === 'arrive' && toS < 30) setTimeout(stopNav, 8000);
  // rotadan sapma
  const off = Math.min(...route.geometry.coordinates.filter((_, i) => i % 3 === 0).map((c) => dist(p, [c[1], c[0]])));
  if (off > 150 && Date.now() - lastRouteAt > 15000) getRoute();
}

// ---------- konum / hız / hava ----------
let lastWeather = 0;
function onLoc(m) {
  const first = !loc; loc = m;
  me.setLatLng([m.lat, m.lon]); if (first) { me.addTo(map); map.setView([m.lat, m.lon], 16); }
  if (follow) map.panTo([m.lat, m.lon], { animate: true });
  const kmh = m.speed != null && m.speed >= 0 ? Math.round(m.speed * 3.6) : 0;
  $('#kmh').textContent = kmh;
  $('#head').textContent = m.heading != null ? ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'][Math.round(m.heading / 45) % 8] : '—';
  $('#acc').textContent = m.acc ? `±${Math.round(m.acc)} m` : '';
  if (dest && !route) getRoute(); else updateNav();
  if (Date.now() - lastWeather > 10 * 60000) { lastWeather = Date.now(); weather(); }
}
const WMO = (c) => (c === 0 ? ['☀️', 'Açık'] : c < 4 ? ['⛅', 'Parçalı bulutlu'] : c < 50 ? ['🌫️', 'Sisli'] : c < 70 ? ['🌧️', 'Yağmurlu'] : c < 80 ? ['🌨️', 'Karlı'] : c < 90 ? ['🌦️', 'Sağanak'] : ['⛈️', 'Fırtına']);
async function weather() {
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`)).json();
    const c = j.current, [ic, name] = WMO(c.weather_code);
    $('#wBody').innerHTML = `<div class="i">${ic}</div><div class="t">${Math.round(c.temperature_2m)}°</div><div>${name}</div><div class="row"><span>💨 ${Math.round(c.wind_speed_10m)} km/sa</span><span>💧 %${c.relative_humidity_2m}</span></div>`;
    $('#wTile').textContent = `${Math.round(c.temperature_2m)}° ${ic}`;
  } catch {}
}

// ---------- medya ----------
function playUrl(u) {
  let id, list;
  try {
    const x = new URL(u);
    if (x.hostname.includes('youtu.be')) id = x.pathname.slice(1);
    else if (x.hostname.includes('youtube.com')) { id = x.searchParams.get('v') || (x.pathname.match(/\/(shorts|embed|live)\/([\w-]+)/) || [])[2]; list = x.searchParams.get('list'); }
  } catch {}
  if (!id && !list) { $('#mediaEmpty').textContent = 'Yalnızca YouTube bağlantıları desteklenir.'; return show('media'); }
  $('#player').src = list && !id ? `https://www.youtube.com/embed/videoseries?list=${list}&autoplay=1` : `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1${list ? '&list=' + list : ''}`;
  $('#player').hidden = false; $('#mediaEmpty').hidden = true; show('media');
}

// ---------- başlat ----------
show('pair');
sid ? connect() : newSession();
