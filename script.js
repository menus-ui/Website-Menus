/* ============================================================
   ASTRO BLAST :: Space Token Game
   - Three.js 3D (r128 via CDN, global THREE)
   - Web Audio API synthesizer
   - Auth system (admin + users)
   - Token system (requests, approve/reject, direct grant)
   - localStorage persistence
   ============================================================ */
'use strict';

/* ===================== HELPERS ===================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const STORAGE_KEY = 'astro_blast_data_v1';
const SESSION_KEY = 'astro_blast_session_v1';
const ADMIN_USER = 'menus233';
const ADMIN_PASS = '12345';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmt(n) {
  return Number(n).toLocaleString('id-ID');
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function randRange(min, max) {
  return min + Math.random() * (max - min);
}

/* ===================== STORAGE ===================== */
let db = null;

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      db = JSON.parse(raw);
      if (db && db.users) return;
    }
  } catch (e) { /* corrupted */ }
  seedDB();
}

function seedDB() {
  db = {
    users: {}
  };
  addUserRecord(ADMIN_USER, ADMIN_PASS, 100000, true);
  saveDB();
}

function addUserRecord(username, password, tokens, isAdmin) {
  db.users[username] = {
    username,
    password,
    tokens: tokens || 0,
    isAdmin: !!isAdmin,
    createdAt: nowStr(),
    requests: [],
    stats: { wins: 0, losses: 0, perfects: 0, gamesPlayed: 0 },
    history: []
  };
}

function saveDB() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) { /* full storage */ }
}

function getUser(username) {
  return db.users[username] || null;
}

/* ===================== SESSION ===================== */
let currentUser = null; // username string
let adminLoginMode = false; // true saat modal auth dibuka lewat akses admin rahasia

function getSession() {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch (e) { return null; }
}
function setSession(u) {
  try {
    if (u) localStorage.setItem(SESSION_KEY, u);
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}
function restoreSession() {
  const u = getSession();
  if (u && getUser(u)) {
    currentUser = u;
    applyLoginUI();
    return true;
  }
  return false;
}

/* ===================== AUDIO ENGINE (Web Audio API) ===================== */
const Audio = {
  ctx: null,
  master: null,
  noiseBuf: null,
  muted: false,

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      // noise buffer
      const len = this.ctx.sampleRate * 1.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) { console.warn('Audio init failed', e); }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  tone(freq, dur, type, vol, opts = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.05);
  },

  noise(dur, vol, filterType, freq, opts = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = opts.rate || 1;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType || 'lowpass';
    f.frequency.setValueAtTime(freq || 1000, t);
    if (opts.slide) f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  },

  click() { this.tone(600, 0.06, 'square', 0.08); },

  launch() {
    this.noise(1.1, 0.25, 'bandpass', 300, { slide: 2400, rate: 1.4 });
    this.tone(90, 1.2, 'sawtooth', 0.12, { slide: 420 });
  },

  safeWin() {
    this.tone(523.25, 0.12, 'triangle', 0.18);
    setTimeout(() => this.tone(659.25, 0.12, 'triangle', 0.18), 110);
    setTimeout(() => this.tone(783.99, 0.2, 'triangle', 0.2), 220);
    setTimeout(() => this.tone(1046.5, 0.3, 'triangle', 0.16), 330);
  },

  perfectWin() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((n, i) => {
      setTimeout(() => {
        this.tone(n, 0.3, 'triangle', 0.2);
        this.tone(n * 2, 0.25, 'sine', 0.08);
      }, i * 90);
    });
    this.noise(1.4, 0.08, 'highpass', 5000, { slide: 8000 });
    this.tone(1568, 0.5, 'sine', 0.08);
  },

  explosion() {
    this.noise(1.0, 0.5, 'lowpass', 1500, { slide: 60 });
    this.tone(70, 0.8, 'sine', 0.35, { slide: 28 });
    this.tone(200, 0.4, 'sawtooth', 0.1, { slide: 40 });
  },

  lose() {
    this.tone(392, 0.2, 'sawtooth', 0.12);
    setTimeout(() => this.tone(330, 0.2, 'sawtooth', 0.12), 180);
    setTimeout(() => this.tone(262, 0.4, 'sawtooth', 0.14), 360);
  },

  requestSent() { this.tone(880, 0.12, 'sine', 0.14); setTimeout(() => this.tone(1320, 0.18, 'sine', 0.12), 120); },
  coins() {
    this.tone(988, 0.08, 'square', 0.1);
    setTimeout(() => this.tone(1319, 0.14, 'square', 0.12), 90);
  }
};

/* ===================== TOAST ===================== */
function toast(msg, type = 'info') {
  const box = $('#toast-container');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 350);
  }, 2800);
}

/* ===================== MODAL HELPERS ===================== */
function openModal(id) {
  $('#' + id).classList.remove('hidden');
}
function closeModal(id) {
  $('#' + id).classList.add('hidden');
}
function closeAllModals() {
  $$('.modal-overlay').forEach((m) => m.classList.add('hidden'));
}

/* ===================== THREE.JS 3D GAME ===================== */
const Game = {
  renderer: null,
  scene: null,
  camera: null,
  clock: null,
  astronaut: null,
  flame: null,
  stars: null,
  meteors: [],
  target: null,
  particles: null,
  particleData: [],
  speed: 0,
  ambientSpeed: 8,
  state: 'IDLE', // IDLE | FLYING | RESULT
  bet: 0,
  launchedAt: 0,
  shakeAmp: 0,
  steerX: 0,
  steerY: 0,
  targetDist: 140,
  idleT: 0
};

const PERFECT_ZONE = 40;
const CRASH_DIST = 3;
const SIDE_HIT = 1.7;
const BOOST_LOCK_MS = 800;
const TAKEOFF_DIST = 95;

// Jarak tabrakan meteor & kecepatan awal meluncur diacak tiap ronde
const TARGET_DIST_MIN = 110;
const TARGET_DIST_MAX = 190;
const LAUNCH_SPEED_MIN = 28;
const LAUNCH_SPEED_MAX = 42;

const IS_MOBILE = () => window.innerWidth <= 820;

function initThree() {
  Game.scene = new THREE.Scene();
  Game.scene.fog = new THREE.FogExp2(0x05060f, 0.0022);

  Game.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1200);
  Game.camera.position.set(0, 2.2, 13);
  Game.camera.lookAt(0, 0.6, -6);

  Game.renderer = new THREE.WebGLRenderer({
    antialias: !IS_MOBILE(),
    powerPreference: 'high-performance'
  });
  Game.renderer.setSize(window.innerWidth, window.innerHeight);
  Game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  Game.renderer.shadowMap.enabled = false;
  Game.renderer.toneMapping = IS_MOBILE() ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  $('#game3d').appendChild(Game.renderer.domElement);

  Game.clock = new THREE.Clock();

  // Lights (dikurangi untuk performa: 1 hemi + 1 directional + 1 point)
  const hemi = new THREE.HemisphereLight(0x4466ff, 0x05060f, 0.65);
  Game.scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(5, 12, 8);
  Game.scene.add(dir);
  const cyan = new THREE.PointLight(0x00f0ff, 0.6, 55);
  cyan.position.set(6, -2, 8);
  Game.scene.add(cyan);

  buildAstronaut();
  buildStars();
  buildMeteors();
  buildParticles();

  window.addEventListener('resize', onResize);
  animate();
}

function onResize() {
  Game.camera.aspect = window.innerWidth / window.innerHeight;
  Game.camera.updateProjectionMatrix();
  Game.renderer.setSize(window.innerWidth, window.innerHeight);
  Game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
}

/* ---------- ASTRONAUT MODEL (low-poly dari primitives) ---------- */
function buildAstronaut() {
  const g = new THREE.Group();
  const white = new THREE.MeshPhongMaterial({ color: 0xf4f7ff, shininess: 40 });
  const gray = new THREE.MeshPhongMaterial({ color: 0x9aa4b8, shininess: 30 });
  const dark = new THREE.MeshPhongMaterial({ color: 0x232838, shininess: 20 });
  const glowCyan = new THREE.MeshPhongMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 0.9 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x1a3a5a, emissive: 0x00d4ff, emissiveIntensity: 0.25, transparent: true, opacity: 0.75, shininess: 90 });

  // Backpack (jetpack)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), gray);
  pack.position.set(0, 0.15, 0.45);
  g.add(pack);
  const strip1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.42), glowCyan);
  strip1.position.set(0, 0.5, 0.46);
  g.add(strip1);

  // Body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 1.1, 10), white);
  body.position.set(0, 0, 0);
  g.add(body);

  // Chest strap
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.42), glowCyan);
  strap.position.set(0, 0.18, -0.1);
  g.add(strap);

  // Helmet (segment dikurangi -> low poly)
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 12), white);
  helmet.position.set(0, 0.95, 0);
  g.add(helmet);

  // Visor
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 10), glass);
  visor.position.set(0, 0.98, -0.28);
  visor.scale.set(1, 0.85, 0.8);
  g.add(visor);

  // Antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3), gray);
  ant.position.set(0.25, 1.42, 0);
  g.add(ant);
  const antLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshPhongMaterial({ color: 0xff3b5c, emissive: 0xff3b5c, emissiveIntensity: 1.2 }));
  antLight.position.set(0.25, 1.6, 0);
  g.add(antLight);

  // Arms
  const armMat = white;
  const mkArm = (side) => {
    const a = new THREE.Group();
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.45, 8), armMat);
    up.position.set(0, 0.22, 0);
    a.add(up);
    const low = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 8), armMat);
    low.position.set(0, -0.02, 0);
    a.add(low);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), dark);
    glove.position.set(0, -0.3, 0);
    a.add(glove);
    a.position.set(side * 0.62, 0.45, 0);
    a.rotation.z = side * -0.25;
    return a;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  g.add(armL);
  g.add(armR);

  // Legs
  const mkLeg = (side) => {
    const l = new THREE.Group();
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.4, 8), white);
    l.add(thigh);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.22, 8), dark);
    boot.position.set(0, -0.3, 0);
    l.add(boot);
    const sole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 8), glowCyan);
    sole.position.set(0, -0.42, 0);
    l.add(sole);
    l.position.set(side * 0.2, -0.75, 0);
    return l;
  };
  g.add(mkLeg(-1));
  g.add(mkLeg(1));

  // Jetpack flame (scales with speed)
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.8, 10), flameMat);
  flame.position.set(0, 0.1, 0.75);
  flame.rotation.x = Math.PI / 2;
  flame.visible = false;
  g.add(flame);
  Game.flame = flame;

  Game.astronaut = g;
  Game.scene.add(g);
}

/* ---------- STARFIELD (jumlah partikel dikurangi) ---------- */
function buildStars() {
  const count = 650;
  const pos = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const palette = [0xffffff, 0xaaccff, 0xffd24a, 0xff9ff2, 0x39ff8b];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 420;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 260;
    pos[i * 3 + 2] = -Math.random() * 700 - 10;
    c.set(palette[Math.floor(Math.random() * palette.length)]);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.6,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  Game.stars = new THREE.Points(geo, mat);
  Game.scene.add(Game.stars);
}

function moveStars(dt) {
  const p = Game.stars.geometry.attributes.position.array;
  const speed = Game.state === 'FLYING' ? Game.speed * 1.35 : Game.ambientSpeed;
  for (let i = 0; i < p.length; i += 3) {
    p[i + 2] += speed * dt;
    if (p[i + 2] > 30) {
      p[i] = (Math.random() - 0.5) * 420;
      p[i + 1] = (Math.random() - 0.5) * 260;
      p[i + 2] = -Math.random() * 700 - 10;
    }
  }
  Game.stars.geometry.attributes.position.needsUpdate = true;
}

/* ---------- METEORS (poly rendah & jumlah dikurangi) ---------- */
function buildMeteor(scale, color) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + 0.35 * (Math.random() - 0.5) + 0.2 * Math.sin(v.x * 3.1 + v.y * 2.3 + v.z * 1.7);
    v.multiplyScalar(n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhongMaterial({
    color: color || 0x8a5a3a,
    emissive: 0x331a0a,
    shininess: 12
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(scale);
  // glowing rim (additive sprite ring)
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0xff7a3c,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1 * scale, 1.35 * scale, 12), rimMat);
  ring.rotation.x = Math.PI / 2;
  mesh.add(ring);
  return mesh;
}

function buildMeteors() {
  // Target meteor (big, homing)
  Game.target = buildMeteor(2.4, 0x9a6a3a);
  Game.target.position.set(0, 0, -Game.targetDist);
  Game.scene.add(Game.target);

  // Side meteors
  Game.meteors = [];
  for (let i = 0; i < 6; i++) {
    const m = buildMeteor(0.8 + Math.random() * 1.2);
    m.position.set(spawnSideX(), randomSideY(), -140 - Math.random() * 560);
    m.userData = { spin: (Math.random() - 0.5) * 2, vy: 0 };
    Game.scene.add(m);
    Game.meteors.push(m);
  }
}

function spawnSideX() {
  const side = Math.random() < 0.5 ? -1 : 1;
  return side * (3.2 + Math.random() * 9);
}
function randomSideY() {
  return (Math.random() - 0.5) * 9;
}

function resetRun() {
  Game.target.position.set(0, 0, -Game.targetDist);
  Game.astronaut.position.set(0, 0, 0);
  Game.astronaut.rotation.z = 0;
  for (const m of Game.meteors) {
    m.position.set(spawnSideX(), randomSideY(), -140 - Math.random() * 560);
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  }
  clearParticles();
}

function updateMeteors(dt) {
  const speed = Game.state === 'FLYING' ? Game.speed : Game.ambientSpeed * 0.4;
  // target homing toward astronaut x/y while flying
  const target = Game.target;
  target.position.z += speed * dt;
  if (Game.state === 'FLYING') {
    target.position.x += (Game.astronaut.position.x - target.position.x) * 0.06;
    target.position.y += (Game.astronaut.position.y - target.position.y) * 0.06;
  }
  target.rotation.y += dt * 0.6;
  target.rotation.x += dt * 0.3;

  for (const m of Game.meteors) {
    m.position.z += speed * dt;
    m.rotation.x += m.userData.spin * dt;
    m.rotation.y += m.userData.spin * dt * 0.7;
    if (m.position.z > 26) {
      m.position.set(spawnSideX(), randomSideY(), -140 - Math.random() * 560);
    }
  }
}

/* ---------- PARTICLES (jumlah dikurangi) ---------- */
function buildParticles() {
  const count = 180;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.3,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });
  Game.particles = new THREE.Points(geo, mat);
  Game.particles.frustumCulled = false;
  Game.particles.visible = false;
  Game.scene.add(Game.particles);
  Game.particleData = [];
}

function spawnParticles(color1, color2, count, speed, pos, spread) {
  Game.particleData = [];
  const c1 = new THREE.Color(color1);
  const c2 = new THREE.Color(color2);
  const positions = Game.particles.geometry.attributes.position.array;
  const colors = Game.particles.geometry.attributes.color.array;
  const sp = spread || 2.2;
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    ).normalize();
    const v = speed * (0.4 + Math.random() * 0.8);
    const life = 0.6 + Math.random() * 0.9;
    Game.particleData.push({
      x: pos.x + (Math.random() - 0.5) * sp,
      y: pos.y + (Math.random() - 0.5) * sp,
      z: pos.z + (Math.random() - 0.5) * sp,
      vx: dir.x * v, vy: dir.y * v, vz: dir.z * v,
      life, t: 0,
      r: c1.r, g: c1.g, b: c1.b,
      r2: c2.r, g2: c2.g, b2: c2.b
    });
  }
  const colorsArr = Game.particles.geometry.attributes.color.array;
  for (let i = 0; i < colorsArr.length; i++) colorsArr[i] = 0;
  Game.particles.visible = true;
}

function updateParticles(dt) {
  if (!Game.particles.visible) return;
  const positions = Game.particles.geometry.attributes.position.array;
  const colors = Game.particles.geometry.attributes.color.array;
  let alive = 0;
  for (let i = 0; i < Game.particleData.length; i++) {
    const p = Game.particleData[i];
    p.t += dt;
    if (p.t >= p.life) continue;
    const k = p.t / p.life;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vx *= (1 - 1.8 * dt); p.vy *= (1 - 1.8 * dt); p.vz *= (1 - 1.8 * dt);
    positions[i * 3] = p.x; positions[i * 3 + 1] = p.y; positions[i * 3 + 2] = p.z;
    const fade = 1 - k;
    colors[i * 3] = p.r + (p.r2 - p.r) * k;
    colors[i * 3 + 1] = p.g + (p.g2 - p.g) * k;
    colors[i * 3 + 2] = p.b + (p.b2 - p.b) * k;
    colors[i * 3] *= fade; colors[i * 3 + 1] *= fade; colors[i * 3 + 2] *= fade;
    alive++;
  }
  if (alive === 0) {
    Game.particles.visible = false;
    return;
  }
  Game.particles.geometry.attributes.position.needsUpdate = true;
  Game.particles.geometry.attributes.color.needsUpdate = true;
}

function clearParticles() {
  Game.particleData = [];
  Game.particles.visible = false;
}

/* ---------- GAME STATE & LOGIC ---------- */
function startRun(bet) {
  Game.bet = bet;
  // Jarak tabrakan & kecepatan awal DIACAK tiap ronde agar tidak bisa dihafal
  Game.targetDist = Math.round(randRange(TARGET_DIST_MIN, TARGET_DIST_MAX));
  Game.speed = randRange(LAUNCH_SPEED_MIN, LAUNCH_SPEED_MAX);
  resetRun();
  Game.state = 'FLYING';
  Game.launchedAt = performance.now();
  Game.flame.visible = true;
  Audio.launch();
  $('#btn-launch').classList.add('hidden');
  $('#btn-stop').classList.remove('hidden');
  $('#bet-panel .bet-title').textContent = 'TERBANG! TAHAN & HENTIKAN!';
}

function stopAstronaut() {
  if (Game.state !== 'FLYING') return;
  if (performance.now() - Game.launchedAt < BOOST_LOCK_MS) {
    toast('Sedang BOOST! Tunggu sejenak sebelum berhenti...', 'info');
    Audio.click();
    return;
  }
  const targetDist = -Game.target.position.z;

  // check side meteor collision
  let sideHit = false;
  for (const m of Game.meteors) {
    if (m.position.z <= 1 && m.position.z > -4.5) {
      const d = Math.hypot(m.position.x - Game.astronaut.position.x, m.position.y - Game.astronaut.position.y);
      if (d < SIDE_HIT) { sideHit = true; break; }
    }
  }

  let outcome;
  if (sideHit || targetDist <= CRASH_DIST) {
    outcome = 'crash';
  } else if (targetDist <= PERFECT_ZONE) {
    outcome = 'perfect';
  } else if (targetDist > TAKEOFF_DIST) {
    outcome = 'tooearly';
  } else {
    outcome = 'safe';
  }

  finishRun(outcome);
}

function finishRun(outcome) {
  Game.state = 'RESULT';
  Game.flame.visible = false;
  $('#btn-stop').classList.add('hidden');
  $('#btn-launch').classList.remove('hidden');
  $('#bet-panel .bet-title').textContent = 'TARUHAN TOKEN';

  const user = getUser(currentUser);
  const bet = Game.bet;

  if (outcome === 'safe') {
    const win = bet * 2;
    user.tokens += win;
    user.stats.wins++;
    user.stats.gamesPlayed++;
    pushHistory(user, 'SAFE', bet, win);
    Audio.safeWin();
    toast(`SAFE STOP! +${fmt(win)} token (2x)`, 'success');
    showResult('SAFE STOP', 'Berhenti dengan aman sebelum meteor! Hadiah 2x lipat', win, 'win');
    spawnParticles(0x39ff8b, 0x00f0ff, 160, 9, Game.astronaut.position, 2.4);
    Game.shakeAmp = 0.1;
  } else if (outcome === 'perfect') {
    const win = bet * 3;
    user.tokens += win;
    user.stats.wins++;
    user.stats.perfects++;
    user.stats.gamesPlayed++;
    pushHistory(user, 'PERFECT', bet, win);
    Audio.perfectWin();
    toast(`PERFECT STOP! +${fmt(win)} token (3x)`, 'gold');
    showResult('PERFECT STOP', 'Berhenti di detik terakhir! Bonus 3x lipat!', win, 'perfect');
    spawnParticles(0xffd24a, 0x39ff8b, 260, 12, Game.astronaut.position, 3);
    Game.shakeAmp = 0.18;
  } else if (outcome === 'tooearly') {
    user.tokens += bet;
    user.stats.gamesPlayed++;
    pushHistory(user, 'TAKEOFF', bet, 0);
    Audio.safeWin();
    toast('TAKE OFF! Terlalu dini berhenti, taruhan dikembalikan', 'info');
    showResult('TAKE OFF!', 'Terlalu dini berhenti... Tunggu sampai memasuki zona Aman/Perfect', 0, 'takeoff');
    spawnParticles(0x00f0ff, 0xffffff, 80, 5, Game.astronaut.position, 1.6);
    Game.shakeAmp = 0.05;
  } else {
    user.stats.losses++;
    user.stats.gamesPlayed++;
    pushHistory(user, 'CRASH', bet, -bet);
    Audio.explosion();
    setTimeout(() => Audio.lose(), 700);
    toast(`CRASH! -${fmt(bet)} token hangus`, 'error');
    showResult('CRASH!', 'Astronot menabrak meteor... Token taruhan hangus', -bet, 'lose');
    spawnParticles(0xff3b5c, 0xff7a3c, 240, 12, Game.astronaut.position, 3.5);
    Game.shakeAmp = 0.45;
  }

  saveDB();
  updateTokenUI();
  updateLeaderboards();
  setTimeout(() => {
    if (Game.state === 'RESULT') {
      Game.state = 'IDLE';
      resetRun();
    }
  }, 5000);
}

function pushHistory(user, result, bet, delta) {
  user.history.unshift({ result, bet, delta, date: nowStr() });
  if (user.history.length > 50) user.history.length = 50;
}

function showResult(title, sub, amount, cls) {
  $('#result-title').textContent = title;
  $('#result-sub').textContent = sub;
  const amtEl = $('#result-amount');
  amtEl.textContent = amount >= 0 ? `+${fmt(amount)} TOKEN` : `-${fmt(-amount)} TOKEN`;
  const inner = $('#result-inner');
  inner.className = cls;
  $('#result-banner').classList.remove('hidden');
  clearTimeout(showResult._t);
  showResult._t = setTimeout(() => $('#result-banner').classList.add('hidden'), 5000);
}

function updateHUD(dist) {
  const fill = $('#danger-fill');
  const pct = clamp((1 - dist / Game.targetDist) * 100, 0, 100);
  fill.style.width = pct + '%';
  $('#hud-dist-value').textContent = fmt(Math.max(0, Math.round(dist))) + ' m';
  const zone = $('#zone-label');
  if (dist <= CRASH_DIST) {
    zone.className = 'zone-tag zone-danger';
    zone.textContent = 'BAHAYA!';
  } else if (dist <= PERFECT_ZONE) {
    zone.className = 'zone-tag zone-perfect';
    zone.textContent = 'PERFECT ZONE';
  } else if (dist <= TAKEOFF_DIST) {
    zone.className = 'zone-tag zone-safe';
    zone.textContent = 'AMAN';
  } else {
    zone.className = 'zone-tag zone-idle';
    zone.textContent = 'BOOST';
  }
  const mult = dist <= PERFECT_ZONE ? 3 : (dist <= TAKEOFF_DIST ? 2 : 1);
  $('#mult-label').textContent = mult + '.0x';
  $('#potential-win').textContent = 'Potensi menang: ' + fmt(Game.bet * mult) + ' token';
}

/* ---------- FLIGHT LOOP ---------- */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(Game.clock.getDelta(), 0.05);
  Game.idleT += dt;

  // astronaut idle/anim
  const astro = Game.astronaut;
  if (Game.state === 'FLYING') {
    Game.speed = Math.min(Game.speed + 10 * dt, 130);
    astro.position.y = Math.sin(Game.idleT * 7) * 0.05;
    astro.rotation.x = -0.12 + Math.sin(Game.idleT * 9) * 0.04;
    astro.rotation.z = clamp(Game.steerX * -0.4, -0.4, 0.4);
    astro.rotation.x += clamp(Game.steerY * -0.3, -0.3, 0.3);
    // steer position
    astro.position.x = clamp(astro.position.x + Game.steerX * 8 * dt, -7, 7);
    astro.position.y = clamp(astro.position.y + Game.steerY * 8 * dt, -4, 4);
    // flame flicker
    Game.flame.scale.set(1 + Math.random() * 0.5, 1 + Game.speed * 0.6, 1 + Math.random() * 0.5);

    updateMeteors(dt);
    const tDist = -Game.target.position.z;
    updateHUD(tDist);

    // collision checks during flight
    let crashed = tDist <= CRASH_DIST;
    if (!crashed) {
      for (const m of Game.meteors) {
        if (m.position.z <= 1.5 && m.position.z > -4.5) {
          const d = Math.hypot(m.position.x - astro.position.x, m.position.y - astro.position.y);
          if (d < SIDE_HIT) { crashed = true; break; }
        }
      }
    }
    if (crashed) {
      finishRun('crash');
    }
  } else if (Game.state === 'IDLE') {
    astro.position.y = Math.sin(Game.idleT * 1.4) * 0.12;
    astro.rotation.z = Math.sin(Game.idleT * 0.8) * 0.08;
    astro.rotation.x = 0;
    updateMeteors(dt);
    const tDist = -Game.target.position.z;
    if (tDist < Game.targetDist + 200) {
      Game.target.position.z = -Game.targetDist - 260;
    }
  }

  moveStars(dt);
  updateParticles(dt);

  // camera shake
  if (Game.shakeAmp > 0.001) {
    Game.camera.position.x = (Math.random() - 0.5) * Game.shakeAmp;
    Game.camera.position.y = 2.2 + (Math.random() - 0.5) * Game.shakeAmp;
    Game.shakeAmp *= 0.92;
  } else {
    Game.camera.position.x = 0;
    Game.camera.position.y = 2.2;
  }
  Game.camera.lookAt(astro.position.x * 0.4, 0.6 + astro.position.y * 0.3, -6);

  Game.renderer.render(Game.scene, Game.camera);
}

/* ===================== AUTH ===================== */
function register(username, password) {
  const u = username.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
    toast('Username 3-20 karakter (huruf/angka/_)', 'error');
    return false;
  }
  if (getUser(u)) {
    toast('Username sudah terdaftar!', 'error');
    return false;
  }
  if (password.length < 4) {
    toast('Password minimal 4 karakter', 'error');
    return false;
  }
  addUserRecord(u, password, 100, false);
  saveDB();
  toast('Akun berhasil dibuat!', 'success');
  Audio.requestSent();
  return true;
}

function login(username, password) {
  const u = getUser(username.trim());
  if (!u) {
    toast('Username tidak ditemukan', 'error');
    return false;
  }
  if (u.password !== password) {
    toast('Password salah!', 'error');
    return false;
  }
  // Jika dibuka lewat akses admin rahasia, hanya akun admin yang bisa masuk
  if (adminLoginMode && !u.isAdmin) {
    toast('Kredensial admin tidak valid', 'error');
    return false;
  }
  currentUser = u.username;
  setSession(u.username);
  adminLoginMode = false;
  Audio.coins();
  toast(`Selamat datang, ${u.username}!`, 'success');
  return true;
}

function logout() {
  currentUser = null;
  setSession(null);
  adminLoginMode = false;
  if (Game.state !== 'IDLE') {
    Game.state = 'IDLE';
    resetRun();
    $('#btn-stop').classList.add('hidden');
    $('#btn-launch').classList.remove('hidden');
    $('#bet-panel .bet-title').textContent = 'TARUHAN TOKEN';
    $('#result-banner').classList.add('hidden');
  }
  applyGuestUI();
  toast('Anda telah keluar', 'info');
}

function applyLoginUI() {
  const u = getUser(currentUser);
  $('#guest-badge').classList.add('hidden');
  $('#user-badge').classList.remove('hidden');
  $('#token-pill').classList.remove('hidden');
  $('#btn-request-token').classList.toggle('hidden', u.isAdmin);
  $('#btn-dashboard').classList.toggle('hidden', !u.isAdmin);
  $('#badge-admin').classList.toggle('hidden', !u.isAdmin);
  $('#user-name-label').textContent = u.isAdmin ? 'ADMIN' : u.username;
  $('#hud').classList.remove('hidden');
  $('#bet-panel').classList.remove('hidden');
  $('#welcome-screen').classList.add('hidden');
  updateTokenUI();
}

function applyGuestUI() {
  $('#guest-badge').classList.remove('hidden');
  $('#user-badge').classList.add('hidden');
  $('#token-pill').classList.add('hidden');
  $('#btn-request-token').classList.add('hidden');
  $('#btn-dashboard').classList.add('hidden');
  $('#badge-admin').classList.add('hidden');
  $('#hud').classList.add('hidden');
  $('#bet-panel').classList.add('hidden');
  $('#result-banner').classList.add('hidden');
  $('#welcome-screen').classList.remove('hidden');
}

function updateTokenUI() {
  if (!currentUser) return;
  const u = getUser(currentUser);
  $('#token-balance').textContent = fmt(u.tokens);
}

/* ===================== AKSES ADMIN RAHASIA ===================== */
/* Tombol admin TIDAK terlihat di UI umum.
   Akses admin dibuka lewat:
     1) Menekan logo ASTRO BLAST 3 kali berturut-turut (dalam 1.5 detik)
     2) Mengetik kombinasi rahasia "MENUS" (KeyM→KeyE→KeyN→KeyU→KeyS) */
const ADMIN_SEQ = ['KeyM', 'KeyE', 'KeyN', 'KeyU', 'KeyS'];
let adminSeqIdx = 0;
let adminTapCount = 0;
let adminTapTimer = null;

function openAuthModal(admin) {
  adminLoginMode = !!admin;
  const title = $('#auth-modal-title');
  title.textContent = admin ? '🔒 AKSES ADMIN' : '🚀 ASTRO BLAST';
  title.classList.toggle('admin-mode', admin);
  $('#tab-register').classList.toggle('hidden', admin);
  switchAuthTab('login');
  openModal('auth-modal');
  if (admin) toast('Mode admin terbuka', 'info');
}

/* ===================== TOKEN REQUEST (PLAYER) ===================== */
function renderPlayerRequests() {
  const u = getUser(currentUser);
  const list = $('#request-list');
  if (!u.requests.length) {
    list.innerHTML = '<div class="hist-empty">Belum ada request.</div>';
    return;
  }
  list.innerHTML = u.requests.map((r) => `
    <div class="req-item">
      <span class="amt">&#128142; ${fmt(r.amount)}</span>
      <span>${r.date}</span>
      <span class="req-status ${r.status}">${statusLabel(r.status)}</span>
    </div>`).join('');
}

function statusLabel(s) {
  return { pending: 'PENDING', approved: 'DISETUJUI', rejected: 'DITOLAK' }[s] || s;
}
function resultColor(r) {
  if (r === 'CRASH') return 'var(--neon-red)';
  if (r === 'PERFECT') return 'var(--neon-gold)';
  if (r === 'SAFE') return 'var(--neon-green)';
  return 'var(--text-dim)';
}
function resultClass(r) {
  if (r === 'CRASH') return 'lose';
  if (r === 'PERFECT') return 'perfect';
  if (r === 'SAFE') return 'win';
  return '';
}

function submitRequest() {
  const amount = parseInt($('#request-amount').value, 10);
  if (!amount || amount < 1) {
    toast('Masukkan jumlah token valid', 'error');
    return;
  }
  const u = getUser(currentUser);
  u.requests.push({ id: uid(), amount, status: 'pending', date: nowStr() });
  saveDB();
  Audio.requestSent();
  toast('Request token dikirim ke admin!', 'success');
  $('#request-amount').value = '';
  renderPlayerRequests();
}

/* ===================== ADMIN DASHBOARD ===================== */
function renderAdminDashboard() {
  if (currentUser && !getUser(currentUser).isAdmin) return;
  renderStats();
  renderAdminUsers();
  renderAdminRequests();
  renderAdminLeaderboard();
  renderAdminHistory();
  renderGiveSelect();
}

function allUsersArr() {
  return Object.values(db.users).sort((a, b) => b.tokens - a.tokens);
}

function renderStats() {
  const users = Object.values(db.users);
  const totalTokens = users.reduce((s, u) => s + u.tokens, 0);
  const pending = users.reduce((s, u) => s + u.requests.filter((r) => r.status === 'pending').length, 0);
  const totalGames = users.reduce((s, u) => s + u.stats.gamesPlayed, 0);
  $('#stat-cards').innerHTML = `
    <div class="stat-card"><div class="num">${users.length}</div><div class="lbl">TOTAL USER</div></div>
    <div class="stat-card"><div class="num">${fmt(totalTokens)}</div><div class="lbl">TOTAL TOKEN</div></div>
    <div class="stat-card"><div class="num">${pending}</div><div class="lbl">REQUEST PENDING</div></div>
    <div class="stat-card"><div class="num">${totalGames}</div><div class="lbl">TOTAL GAME</div></div>
  `;
  const pendUsers = users.filter((u) => u.requests.some((r) => r.status === 'pending'));
  $('#overview-requests').innerHTML = `
    <h3>&#128176; REQUEST MENUNGGU PERSETUJUAN</h3>
    ${pendUsers.length
      ? pendUsers.map((u) => u.requests.filter((r) => r.status === 'pending').map((r) =>
          `<div class="req-item"><span><b>${u.username}</b></span><span class="amt">&#128142; ${fmt(r.amount)}</span><span>${r.date}</span></div>`).join('')).join('')
      : '<div class="hist-empty">Tidak ada request pending.</div>'}
  `;
}

function renderAdminUsers() {
  const users = Object.values(db.users);
  $('#users-table-body').innerHTML = users.map((u) => `
    <tr>
      <td><div class="user-cell"><span class="user-avatar">${u.username[0].toUpperCase()}</span><span>${u.username}</span></div></td>
      <td>${u.isAdmin ? '<span class="badge-admin">ADMIN</span>' : 'User'}</td>
      <td style="color:var(--neon-gold);font-weight:700">${fmt(u.tokens)}</td>
      <td style="color:var(--neon-green)">${u.stats.wins}</td>
      <td style="color:var(--neon-red)">${u.stats.losses}</td>
      <td style="color:var(--neon-cyan)">${u.stats.perfects}</td>
      <td>${u.stats.gamesPlayed}</td>
      <td>
        ${u.isAdmin ? '<span style="color:var(--text-dim)">-</span>' : `
          <button class="tbl-btn gold" data-give="${u.username}" data-amt="50">+50</button>
          <button class="tbl-btn gold" data-give="${u.username}" data-amt="200">+200</button>
          <button class="tbl-btn cyan" data-reset="${u.username}">Reset</button>
          <button class="tbl-btn red" data-del="${u.username}">Hapus</button>
        `}
      </td>
    </tr>`).join('');
}

function renderAdminRequests() {
  const rows = [];
  Object.values(db.users).forEach((u) => {
    u.requests.forEach((r) => {
      rows.push({ user: u.username, r });
    });
  });
  rows.sort((a, b) => {
    const o = { pending: 0, approved: 1, rejected: 2 };
    return o[a.r.status] - o[b.r.status];
  });
  $('#requests-table-body').innerHTML = rows.length
    ? rows.map(({ user, r }) => `
      <tr>
        <td>${user}</td>
        <td style="color:var(--neon-gold);font-weight:700">${fmt(r.amount)}</td>
        <td>${r.date}</td>
        <td><span class="req-status ${r.status}">${statusLabel(r.status)}</span></td>
        <td>
          ${r.status === 'pending' ? `
            <button class="tbl-btn green" data-approve="${user}" data-req="${r.id}">SETUJUI</button>
            <button class="tbl-btn red" data-reject="${user}" data-req="${r.id}">TOLAK</button>
          ` : '<span style="color:var(--text-dim)">-</span>'}
        </td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="hist-empty">Tidak ada request token.</td></tr>';
}

function renderAdminLeaderboard() {
  $('#admin-leaderboard').innerHTML = buildLeaderboardHTML();
}

function renderAdminHistory() {
  const all = [];
  Object.values(db.users).forEach((u) => {
    u.history.forEach((h) => all.push({ user: u.username, h }));
  });
  all.sort((a, b) => b.h.date.localeCompare(a.h.date));
  $('#admin-history-body').innerHTML = all.length
    ? all.map(({ user, h }) => `
      <tr>
        <td>${user}</td>
        <td><span class="hist-result" style="color:${resultColor(h.result)}">${h.result}</span></td>
        <td>${fmt(h.bet)}</td>
        <td style="color:${h.delta >= 0 ? 'var(--neon-green)' : 'var(--neon-red)'};font-weight:700">${h.delta >= 0 ? '+' + fmt(h.delta) : '-' + fmt(-h.delta)}</td>
        <td>${h.date}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="hist-empty">Belum ada riwayat game.</td></tr>';
}

function renderGiveSelect() {
  const opts = Object.values(db.users).map((u) => `<option value="${u.username}">${u.username}</option>`).join('');
  $('#give-user').innerHTML = opts;
}

function buildLeaderboardHTML() {
  const users = Object.values(db.users).sort((a, b) => {
    if (b.tokens !== a.tokens) return b.tokens - a.tokens;
    return b.stats.wins - a.stats.wins;
  });
  if (!users.length) return '<div class="leader-empty">Belum ada pemain.</div>';
  return users.map((u, i) => `
    <div class="leader-row ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : ''}" style="animation-delay:${i * 0.05}s">
      <div class="rank-num">${i + 1}</div>
      <div class="leader-user">${u.username}${u.isAdmin ? ' <span class="badge-admin">ADMIN</span>' : ''}</div>
      <div class="leader-stats">
        <span class="win">Win <b>${u.stats.wins}</b></span>
        <span>Perfect <b>${u.stats.perfects}</b></span>
        <span>Token <b>${fmt(u.tokens)}</b></span>
      </div>
    </div>`).join('');
}

function updateLeaderboards() {
  if (!$('#admin-modal').classList.contains('hidden')) {
    renderAdminLeaderboard();
    renderAdminHistory();
  }
}

/* ---------- ADMIN ACTIONS ---------- */
function approveRequest(userName, reqId) {
  const u = getUser(userName);
  if (!u) return;
  const req = u.requests.find((r) => r.id === reqId);
  if (!req || req.status !== 'pending') return;
  req.status = 'approved';
  u.tokens += req.amount;
  saveDB();
  Audio.coins();
  toast(`Request ${fmt(req.amount)} token untuk ${userName} disetujui!`, 'success');
  renderAdminDashboard();
  updateTokenUI();
}

function rejectRequest(userName, reqId) {
  const u = getUser(userName);
  if (!u) return;
  const req = u.requests.find((r) => r.id === reqId);
  if (!req || req.status !== 'pending') return;
  req.status = 'rejected';
  saveDB();
  toast(`Request ${userName} ditolak`, 'error');
  renderAdminDashboard();
}

function giveTokens(userName, amount) {
  const u = getUser(userName);
  if (!u) return;
  if (!amount || amount < 1) {
    toast('Jumlah token tidak valid', 'error');
    return;
  }
  u.tokens += amount;
  saveDB();
  Audio.coins();
  toast(`+${fmt(amount)} token dikirim ke ${userName}!`, 'success');
  renderAdminDashboard();
  updateTokenUI();
}

function resetUser(userName) {
  const u = getUser(userName);
  if (!u) return;
  if (!confirm(`Reset data user "${userName}"? Saldo & statistik akan dikembalikan ke awal.`)) return;
  u.tokens = 0;
  u.stats = { wins: 0, losses: 0, perfects: 0, gamesPlayed: 0 };
  u.history = [];
  saveDB();
  toast(`User ${userName} di-reset`, 'info');
  renderAdminDashboard();
}

function deleteUser(userName) {
  if (!confirm(`Hapus akun "${userName}"? Tindakan ini tidak bisa dibatalkan.`)) return;
  delete db.users[userName];
  saveDB();
  toast(`Akun ${userName} dihapus`, 'error');
  renderAdminDashboard();
}

function createUserByAdmin(username, password, tokens) {
  const u = username.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
    toast('Username 3-20 karakter (huruf/angka/_)', 'error');
    return;
  }
  if (getUser(u)) {
    toast('Username sudah ada!', 'error');
    return;
  }
  if (password.length < 4) {
    toast('Password minimal 4 karakter', 'error');
    return;
  }
  const tk = Math.max(0, parseInt(tokens, 10) || 0);
  addUserRecord(u, password, tk, false);
  saveDB();
  Audio.coins();
  toast(`Akun "${u}" dibuat dengan ${fmt(tk)} token!`, 'success');
  closeModal('adduser-modal');
  renderAdminDashboard();
}

function resetAllData() {
  if (!confirm('HAPUS SEMUA DATA? Seluruh akun user, token, dan riwayat akan terhapus permanen. Admin dibuat ulang.')) return;
  localStorage.removeItem(STORAGE_KEY);
  seedDB();
  if (currentUser && !getUser(currentUser)) {
    logout();
  } else {
    renderAdminDashboard();
    updateTokenUI();
  }
  toast('Semua data di-reset', 'info');
}

/* ===================== UI BINDINGS ===================== */
function bindUI() {
  // Auth modal tabs
  $('#tab-login').addEventListener('click', () => switchAuthTab('login'));
  $('#tab-register').addEventListener('click', () => switchAuthTab('register'));

  $('#form-login').addEventListener('submit', (e) => {
    e.preventDefault();
    if (login($('#login-user').value, $('#login-pass').value)) {
      closeModal('auth-modal');
      $('#login-pass').value = '';
      applyLoginUI();
    }
  });

  $('#form-register').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = $('#reg-user').value;
    const p = $('#reg-pass').value;
    const p2 = $('#reg-pass2').value;
    if (p !== p2) {
      toast('Konfirmasi password tidak cocok!', 'error');
      return;
    }
    if (register(u, p)) {
      $('#reg-user').value = ''; $('#reg-pass').value = ''; $('#reg-pass2').value = '';
      if (login(u, p)) {
        closeModal('auth-modal');
        applyLoginUI();
      }
    }
  });

  $('#btn-login').addEventListener('click', () => openAuthModal(false));
  $('#btn-start').addEventListener('click', () => openAuthModal(false));

  // Akses admin rahasia: tekan logo 3x berturut-turut
  $('#nav-logo').addEventListener('click', () => {
    adminTapCount++;
    if (adminTapTimer) clearTimeout(adminTapTimer);
    adminTapTimer = setTimeout(() => { adminTapCount = 0; }, 1500);
    if (adminTapCount >= 3) {
      adminTapCount = 0;
      openAuthModal(true);
    }
  });

  $('#btn-logout').addEventListener('click', logout);
  $('#btn-dashboard').addEventListener('click', () => {
    renderAdminDashboard();
    openModal('admin-modal');
  });
  $('#btn-leaderboard').addEventListener('click', () => {
    renderPublicLeaderboard();
    openModal('leaderboard-modal');
  });
  $('#btn-history').addEventListener('click', () => {
    if (!currentUser) {
      toast('Silakan login dahulu!', 'error');
      openModal('auth-modal');
      return;
    }
    renderPlayerHistory();
    openModal('history-modal');
  });
  $('#btn-request-token').addEventListener('click', () => {
    renderPlayerRequests();
    openModal('request-modal');
  });

  $('#btn-submit-request').addEventListener('click', submitRequest);
  $('#request-amount').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitRequest();
  });

  // Close buttons
  $$('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  $$('.modal-overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.classList.add('hidden');
    });
  });

  // Sound toggle
  $('#btn-sound').addEventListener('click', () => {
    Audio.muted = !Audio.muted;
    $('#btn-sound').style.opacity = Audio.muted ? 0.4 : 1;
    toast(Audio.muted ? 'Suara dimatikan' : 'Suara dinyalakan', 'info');
    if (!Audio.muted) Audio.click();
  });

  // Bet chips
  $$('.chip[data-add]').forEach((c) => {
    c.addEventListener('click', () => {
      const add = parseInt(c.dataset.add, 10);
      const inp = $('#bet-input');
      inp.value = (parseInt(inp.value, 10) || 0) + add;
    });
  });
  $('#bet-max').addEventListener('click', () => {
    if (currentUser) {
      const u = getUser(currentUser);
      $('#bet-input').value = Math.max(1, u.tokens);
    }
  });

  // Launch / Stop
  $('#btn-launch').addEventListener('click', () => {
    if (!currentUser) {
      toast('Silakan login dahulu!', 'error');
      openModal('auth-modal');
      return;
    }
    const u = getUser(currentUser);
    const bet = parseInt($('#bet-input').value, 10);
    if (!bet || bet < 1) {
      toast('Masukkan jumlah taruhan minimal 1', 'error');
      return;
    }
    if (bet > u.tokens) {
      toast('Saldo token tidak mencukupi! Ajukan request token ke admin.', 'error');
      return;
    }
    u.tokens -= bet;
    saveDB();
    updateTokenUI();
    startRun(bet);
  });

  $('#btn-stop').addEventListener('click', () => {
    stopAstronaut();
  });

  $('#btn-replay').addEventListener('click', () => {
    $('#result-banner').classList.add('hidden');
    Game.state = 'IDLE';
    resetRun();
  });

  // Keyboard
  window.addEventListener('keydown', (e) => {
    Audio.init(); Audio.resume();

    // Kombinasi rahasia admin: ketik "MENUS" berurutan (saat tidak terbang)
    if (Game.state !== 'FLYING') {
      let matched = false;
      if (e.code === ADMIN_SEQ[adminSeqIdx]) {
        adminSeqIdx++;
        matched = true;
        if (adminSeqIdx === ADMIN_SEQ.length) {
          adminSeqIdx = 0;
          openAuthModal(true);
        }
      }
      if (!matched) adminSeqIdx = 0;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      if (Game.state === 'FLYING') stopAstronaut();
    }
    if (Game.state === 'FLYING') {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') Game.steerY = 1;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') Game.steerY = -1;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') Game.steerX = -1;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') Game.steerX = 1;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'ArrowUp' || e.code === 'ArrowDown') Game.steerY = 0;
    if (e.code === 'KeyA' || e.code === 'KeyD' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') Game.steerX = 0;
  });

  // Audio init on any gesture
  const unlockAudio = () => { Audio.init(); Audio.resume(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlockAudio, { once: true }));

  // Admin sidebar tabs
  $$('.admin-tab[data-atab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.admin-tab[data-atab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.admin-section').forEach((s) => s.classList.remove('active'));
      $('#atab-' + tab.dataset.atab).classList.add('active');
    });
  });
  $('#btn-admin-close').addEventListener('click', () => closeModal('admin-modal'));

  // Admin: users table actions (event delegation)
  $('#users-table-body').addEventListener('click', (e) => {
    const giveBtn = e.target.closest('[data-give]');
    if (giveBtn) {
      giveTokens(giveBtn.dataset.give, parseInt(giveBtn.dataset.amt, 10));
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) { deleteUser(delBtn.dataset.del); return; }
    const resetBtn = e.target.closest('[data-reset]');
    if (resetBtn) { resetUser(resetBtn.dataset.reset); return; }
  });

  // Admin: requests actions
  $('#requests-table-body').addEventListener('click', (e) => {
    const ap = e.target.closest('[data-approve]');
    if (ap) { approveRequest(ap.dataset.approve, ap.dataset.req); return; }
    const rj = e.target.closest('[data-reject]');
    if (rj) { rejectRequest(rj.dataset.reject, rj.dataset.req); }
  });

  // Add user modal
  $('#btn-add-user').addEventListener('click', () => openModal('adduser-modal'));
  $('#btn-au-submit').addEventListener('click', () => {
    createUserByAdmin($('#au-user').value, $('#au-pass').value, $('#au-tokens').value);
    $('#au-user').value = ''; $('#au-pass').value = ''; $('#au-tokens').value = '100';
  });

  // Give tokens (tools)
  $('#btn-give-tokens').addEventListener('click', () => {
    const user = $('#give-user').value;
    const amt = parseInt($('#give-amount').value, 10);
    giveTokens(user, amt);
    $('#give-amount').value = '';
  });

  // Reset all
  $('#btn-reset-all').addEventListener('click', resetAllData);
}

function switchAuthTab(tab) {
  $('#tab-login').classList.toggle('active', tab === 'login');
  $('#tab-register').classList.toggle('active', tab === 'register');
  $('#form-login').classList.toggle('hidden', tab !== 'login');
  $('#form-register').classList.toggle('hidden', tab !== 'register');
}

/* ===================== PUBLIC LEADERBOARD & HISTORY ===================== */
function renderPublicLeaderboard() {
  $('#leaderboard-list').innerHTML = buildLeaderboardHTML();
}

function renderPlayerHistory() {
  const u = getUser(currentUser);
  const list = $('#player-history-list');
  if (!u || !u.history.length) {
    list.innerHTML = '<div class="hist-empty">Belum ada riwayat permainan.</div>';
    return;
  }
  list.innerHTML = u.history.map((h) => {
    return `
      <div class="hist-row ${resultClass(h.result)}">
        <span class="hist-result" style="color:${resultColor(h.result)}">${h.result}</span>
        <span>Taruhan <b style="color:#fff">${fmt(h.bet)}</b></span>
        <span class="hist-amt" style="color:${h.delta >= 0 ? 'var(--neon-green)' : 'var(--neon-red)'}">${h.delta >= 0 ? '+' + fmt(h.delta) : '-' + fmt(-h.delta)}</span>
        <span class="hist-time">${h.date}</span>
      </div>`;
  }).join('');
}

/* ===================== INIT ===================== */
function boot() {
  loadDB();
  bindUI();
  initThree();

  const isAdmin = currentUser && getUser(currentUser) && getUser(currentUser).isAdmin;
  if (!isAdmin) {
    $('#btn-dashboard').classList.add('hidden');
  }

  if (restoreSession()) {
    applyLoginUI();
  } else {
    applyGuestUI();
  }

  if (!Audio.muted) {
    $('#btn-sound').style.opacity = 1;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
