// "Make It So" lyric video — deterministic canvas renderer. renderFrame(t) draws the frame at t seconds.
(() => {
const TL = window.TIMELINE;
const W = 1920, H = 1080;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const FONT = 'Antonio, "Liberation Sans", sans-serif';

// ---------- utils
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - clamp(k), 3);
const easeIn = (k) => Math.pow(clamp(k), 3);
const easeInOut = (k) => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const easeBack = (k) => { k = clamp(k); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const noise = (t) => { const i = Math.floor(t), f = t - i; const u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(clamp(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt, 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
const LC = { orange: '#ff9966', peach: '#ffcc99', lav: '#cc99cc', blue: '#9999ff', red: '#cc6666', gold: '#ffaa00', tan: '#ffcc66', sky: '#99ccff', bg: '#05060d' };

function ellipse(x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2); }
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r), 0, Math.PI * 2); }
function poly(pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function text(str, x, y, size, color, align = 'left', o = {}) {
  ctx.font = `${o.weight ?? 600} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.letterSpacing = (o.spacing ?? 0) + 'px';
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.blur ?? 24; }
  if (o.stroke) { ctx.lineWidth = o.stroke; ctx.strokeStyle = o.strokeColor ?? '#000'; ctx.lineJoin = 'round'; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
  ctx.shadowBlur = 0; ctx.letterSpacing = '0px';
}
function fitSize(str, maxW, size, weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(str).width;
  return w > maxW ? size * maxW / w : size;
}
function slam(str, t0, t, x, y, size, color, o = {}) {
  const p = clamp((t - t0) / 0.22);
  if (p <= 0) return;
  const sc = lerp(o.from ?? 2.4, 1, easeOut(p));
  size = fitSize(str, o.maxW ?? 1700, size, 700);
  ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc); ctx.globalAlpha *= p * (o.alpha ?? 1);
  text(str, 0, 0, size, color, 'center', { weight: 700, glow: o.glow ?? color, blur: 30, baseline: 'middle', spacing: o.spacing ?? 4, stroke: o.stroke, strokeColor: o.strokeColor });
  ctx.restore();
}

// ---------- timeline
const sections = TL.sections;
const sectionAt = (t) => { let s = sections[0]; for (const x of sections) if (t >= x.start) s = x; return s; };
const lineAt = (sec, t) => { let cur = null; for (const l of sec.lines) if (t >= l.start - 0.05) cur = l; return cur; };
const BEATS = TL.beats || (() => { const a = []; const b = 60 / TL.bpm; for (let t = TL.beatOffset; t < TL.duration + 2; t += b) a.push(t); return a; })();
function beatInfo(t) {
  if (t < BEATS[0]) return { i: -1, since: 99 };
  let lo = 0, hi = BEATS.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (BEATS[m] <= t) lo = m; else hi = m - 1; }
  return { i: lo, since: t - BEATS[lo] };
}
const pulse = (t) => Math.exp(-beatInfo(t).since * 6);
function vocal(t, line) {
  if (TL.env) { const i = Math.floor(t * TL.envFps); return clamp(((TL.env[i] ?? 0) - 0.08) * 1.4); }
  if (!line || t < line.start || t > line.end - 0.1) return 0;
  return clamp(0.55 + 0.45 * Math.sin(t * 21) * Math.sin(t * 7.7 + 1));
}
// Word timings: aligned words when they match the text, else spread evenly across the line.
function wordTimes(line) {
  if (line._wt) return line._wt;
  const toks = line.text.split(/\s+/).filter(Boolean);
  let times;
  if (line.words && line.words.length === toks.length) times = line.words.map((w) => w.s);
  else {
    const a = line.words?.[0]?.s ?? line.start;
    const b = line.words?.length ? line.words.at(-1).s : line.start + (line.end - line.start) * 0.8;
    times = toks.map((_, i) => lerp(a, b, toks.length > 1 ? i / (toks.length - 1) : 0));
  }
  return (line._wt = toks.map((w, i) => ({ w, s: times[i] })));
}

// ---------- crew
const DIV = { cmd: '#a3162a', ops: '#d29c1c', sci: '#2a7d90' };
const CREW = {
  picard: { name: 'JEAN-LUC PICARD', rank: 'CAPTAIN', role: 'COMMANDING OFFICER', div: 'cmd', skin: '#e9b38e', pips: 4, accent: LC.red, brow: '#8a7764',
    facts: ['SERIAL NO. SP-937-215', 'HOMETOWN: LA BARRE, FRANCE', 'BEVERAGE: TEA, EARL GREY, HOT'] },
  riker: { name: 'WILLIAM T. RIKER', rank: 'COMMANDER', role: 'FIRST OFFICER', div: 'cmd', skin: '#eab28b', pips: 3, accent: LC.orange, brow: '#2e211a',
    facts: ['CALLSIGN: NUMBER ONE', 'HOMETOWN: VALDEZ, ALASKA', 'OWN COMMANDS DECLINED: 3'] },
  data: { name: 'DATA', rank: 'LT. COMMANDER', role: 'OPERATIONS OFFICER', div: 'ops', skin: '#ece2bd', pips: 2.5, accent: LC.tan, brow: '#2a2420', eye: '#e6b422',
    facts: ['SOONG-TYPE ANDROID', 'CONTRACTIONS USED: 0', 'CAT: SPOT'] },
  worf: { name: 'WORF, SON OF MOGH', rank: 'LIEUTENANT', role: 'CHIEF OF SECURITY', div: 'ops', skin: '#7b4f36', pips: 2, accent: LC.red, brow: '#1b130e',
    facts: ['FIRST KLINGON IN STARFLEET', 'BEVERAGE: PRUNE JUICE', 'STANDING ADVICE: OPEN FIRE'] },
  geordi: { name: 'GEORDI LA FORGE', rank: 'LT. COMMANDER', role: 'CHIEF ENGINEER', div: 'ops', skin: '#6c4832', pips: 2.5, accent: LC.gold, brow: '#1b130e',
    facts: ['VISOR: FULL EM SPECTRUM', 'WARP CORE: NOMINAL', 'TECHNOBABBLE: 110%'] },
  troi: { name: 'DEANNA TROI', rank: 'COMMANDER', role: "SHIP'S COUNSELOR", div: 'sci', skin: '#e7b791', pips: 3, accent: LC.lav, brow: '#1d1512', eye: '#120c0a',
    facts: ['HALF BETAZOID', 'EMPATHY: ALWAYS ON', 'CHOCOLATE: MANDATORY'] },
  crusher: { name: 'BEVERLY CRUSHER, M.D.', rank: 'COMMANDER', role: 'CHIEF MEDICAL OFFICER', div: 'sci', skin: '#f1c5a6', pips: 3, accent: LC.blue, brow: '#9b3b22',
    facts: ['A.K.A. THE DANCING DOCTOR', 'SON: WESLEY', 'UNIVERSE DIAMETER: 705 M'] },
  q: { name: 'Q', rank: '???', role: 'OMNIPOTENT NUISANCE', div: 'cmd', skin: '#eab48f', pips: 4, accent: LC.gold, brow: '#3a2a20' },
  locutus: { name: 'LOCUTUS OF BORG', rank: '', role: '', div: 'cmd', skin: '#c7ccc6', pips: 0, accent: '#3f6', brow: '#555' },
};
const BRIDGE = ['picard', 'riker', 'data', 'worf', 'geordi', 'troi', 'crusher'];

function uniform(id, C) {
  const torso = () => { ctx.beginPath(); ctx.moveTo(-235, 340); ctx.lineTo(-218, 212); ctx.quadraticCurveTo(-205, 150, -120, 135); ctx.lineTo(-45, 124); ctx.lineTo(45, 124); ctx.lineTo(120, 135); ctx.quadraticCurveTo(205, 150, 218, 212); ctx.lineTo(235, 340); ctx.closePath(); };
  torso();
  if (id === 'locutus') { ctx.fillStyle = '#18191b'; ctx.fill(); ctx.strokeStyle = '#3a3d40'; ctx.lineWidth = 10; for (const [a, b] of [[-150, 170], [140, 190], [-60, 260]]) { ctx.beginPath(); ctx.moveTo(a, b); ctx.quadraticCurveTo(a + 60, b + 40, a + 30, b + 120); ctx.stroke(); } return; }
  const g = ctx.createLinearGradient(-230, 0, 230, 0); g.addColorStop(0, shade(DIV[C.div], -0.35)); g.addColorStop(0.5, DIV[C.div]); g.addColorStop(1, shade(DIV[C.div], -0.3));
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); torso(); ctx.clip(); ctx.fillStyle = '#121214'; ctx.fillRect(-300, 100, 600, 108); ctx.restore();
  rrect(-52, 112, 104, 34, 10); ctx.fillStyle = '#0c0c0e'; ctx.fill();
  // rank pips on the collar
  for (let i = 0; i < Math.ceil(C.pips); i++) {
    circle(-72 - i * 22, 168, 8); ctx.fillStyle = '#e7c35a'; ctx.fill();
    if (i + 1 > C.pips) { circle(-72 - i * 22, 168, 4.5); ctx.fillStyle = '#121214'; ctx.fill(); }
  }
  // combadge
  ellipse(100, 214, 30, 15, -0.15); ctx.fillStyle = '#b9bcc4'; ctx.fill();
  poly([[100, 186], [122, 238], [100, 226], [78, 238]]); ctx.fillStyle = '#e9c45c'; ctx.fill();
  if (id === 'worf') { // baldric
    ctx.save(); torso(); ctx.clip(); ctx.rotate(-0.62);
    const bg = ctx.createLinearGradient(0, 70, 0, 110); bg.addColorStop(0, '#d8d2c0'); bg.addColorStop(0.5, '#8d8576'); bg.addColorStop(1, '#5e574c');
    ctx.fillStyle = bg; ctx.fillRect(-260, 60, 520, 44);
    ctx.fillStyle = '#4a443b'; for (let x = -250; x < 260; x += 34) ctx.fillRect(x, 60, 5, 44);
    ctx.restore();
  }
}
function hairBack(id) {
  if (id === 'worf') { ctx.fillStyle = '#1b130e'; ctx.beginPath(); ctx.moveTo(-100, -70); ctx.quadraticCurveTo(-150, 120, -120, 210); ctx.lineTo(120, 210); ctx.quadraticCurveTo(150, 120, 100, -70); ctx.closePath(); ctx.fill(); }
  if (id === 'troi') { ctx.fillStyle = '#1d1512'; for (let i = 0; i < 26; i++) { const a = Math.PI * (0.92 + 1.16 * (i / 25)); const r = 120 + 22 * hash(i); circle(Math.cos(a) * r * 1.05, Math.sin(a) * r * 0.95 - 10, 44 + 10 * hash(i + 9)); ctx.fill(); }
    for (let i = 0; i < 10; i++) { circle((i % 2 ? 1 : -1) * (110 + 15 * hash(i)), 40 + i * 10, 40); ctx.fill(); } }
  if (id === 'crusher') { ctx.fillStyle = '#a8432a'; ctx.beginPath(); ctx.moveTo(-108, -40); ctx.quadraticCurveTo(-130, 90, -100, 120); ctx.lineTo(100, 120); ctx.quadraticCurveTo(130, 90, 108, -40); ctx.closePath(); ctx.fill(); }
}
function hairFront(id) {
  ctx.lineCap = 'round';
  switch (id) {
    case 'picard': case 'locutus':
      if (id === 'picard') { ctx.fillStyle = '#7d6d5e'; ellipse(-86, -30, 9, 26, 0.2); ctx.fill(); ellipse(86, -30, 9, 26, -0.2); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ellipse(-25, -78, 34, 14, -0.3); ctx.fill(); break;
    case 'riker': case 'q':
      ctx.fillStyle = id === 'q' ? '#3a2a20' : '#2e211a';
      ctx.beginPath(); ctx.moveTo(-93, -5); ctx.quadraticCurveTo(-104, -112, -10, -128); ctx.quadraticCurveTo(96, -122, 93, -5); ctx.lineTo(82, -48); ctx.quadraticCurveTo(30, -92, -20, -78); ctx.quadraticCurveTo(-70, -70, -82, -45); ctx.closePath(); ctx.fill();
      if (id === 'riker') { // beard + moustache
        ctx.beginPath(); ctx.moveTo(-90, 0); ctx.quadraticCurveTo(-92, 118, 0, 132); ctx.quadraticCurveTo(92, 118, 90, 0); ctx.lineTo(74, 18); ctx.quadraticCurveTo(64, 92, 0, 96); ctx.quadraticCurveTo(-64, 92, -74, 18); ctx.closePath(); ctx.fill();
        ellipse(0, 48, 34, 10); ctx.fill();
      }
      break;
    case 'data': case 'geordi':
      ctx.fillStyle = id === 'data' ? '#2a2420' : '#17110d';
      ctx.beginPath(); ctx.moveTo(-91, -18); ctx.quadraticCurveTo(-96, -118, 0, -124); ctx.quadraticCurveTo(96, -118, 91, -18); ctx.lineTo(80, -54);
      if (id === 'data') { ctx.quadraticCurveTo(40, -84, 0, -70); ctx.quadraticCurveTo(-40, -84, -80, -54); } else { ctx.quadraticCurveTo(0, -100, -80, -54); }
      ctx.closePath(); ctx.fill();
      if (id === 'data') { ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 4; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-70 + i * 10, -70 - i * 8); ctx.quadraticCurveTo(0, -112 + i * 4, 70 - i * 10, -70 - i * 8); ctx.stroke(); } }
      break;
    case 'worf':
      ctx.fillStyle = '#1b130e'; ctx.beginPath(); ctx.moveTo(-96, -40); ctx.quadraticCurveTo(-100, -132, 0, -136); ctx.quadraticCurveTo(100, -132, 96, -40); ctx.lineTo(70, -96); ctx.quadraticCurveTo(0, -122, -70, -96); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = shade(CREW.worf.skin, -0.35); ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, -112); ctx.stroke();
      for (let i = 0; i < 4; i++) { const y = -46 - i * 17; ctx.beginPath(); ctx.moveTo(-58 + i * 6, y + 10); ctx.quadraticCurveTo(-24, y - 10, 0, y); ctx.quadraticCurveTo(24, y - 10, 58 - i * 6, y + 10); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(255,220,180,0.18)'; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) { const y = -50 - i * 17; ctx.beginPath(); ctx.moveTo(-50 + i * 6, y + 8); ctx.quadraticCurveTo(-22, y - 10, 0, y - 3); ctx.stroke(); }
      ctx.fillStyle = '#1b130e'; ctx.beginPath(); ctx.moveTo(-30, 44); ctx.quadraticCurveTo(0, 30, 30, 44); ctx.lineTo(36, 92); ctx.lineTo(24, 92); ctx.lineTo(22, 54); ctx.lineTo(-22, 54); ctx.lineTo(-24, 92); ctx.lineTo(-36, 92); ctx.closePath(); ctx.fill();
      poly([[-26, 92], [26, 92], [0, 140]]); ctx.fill();
      break;
    case 'troi':
      ctx.fillStyle = '#1d1512'; for (let i = 0; i < 14; i++) { const a = Math.PI * (1.08 + 0.84 * (i / 13)); circle(Math.cos(a) * 92, Math.sin(a) * 102 - 12, 32 + 8 * hash(i + 3)); ctx.fill(); }
      break;
    case 'crusher':
      ctx.fillStyle = '#b34a2c'; ctx.beginPath(); ctx.moveTo(-98, 50); ctx.quadraticCurveTo(-118, -126, 0, -132); ctx.quadraticCurveTo(118, -126, 98, 50); ctx.lineTo(84, 50); ctx.quadraticCurveTo(94, -50, 46, -78); ctx.quadraticCurveTo(-20, -60, -78, -24); ctx.lineTo(-84, 50); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,200,150,0.25)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-60, -100); ctx.quadraticCurveTo(10, -122, 70, -90); ctx.stroke();
      break;
  }
}
function face(id, C, talk, t, o) {
  const sk = C.skin;
  // eyes
  const blink = (t + hash(id.length) * 4) % 4.1 < 0.11 ? 0.12 : 1;
  if (id !== 'geordi') {
    for (const sx of [-1, 1]) {
      ellipse(sx * 34, -6, 16, 9.5 * blink); ctx.fillStyle = id === 'data' ? '#f4f0dc' : '#fbf7f2'; ctx.fill();
      if (blink > 0.5) {
        circle(sx * 34 + (o.look ?? 0) * 4, -6, id === 'troi' ? 8.5 : 7); ctx.fillStyle = C.eye ?? '#4a3a2a'; ctx.fill();
        circle(sx * 34 + (o.look ?? 0) * 4, -6, 3.5); ctx.fillStyle = '#000'; ctx.fill();
        circle(sx * 34 + 3, -9, 2); ctx.fillStyle = '#fff'; ctx.fill();
      }
    }
  }
  // brows
  ctx.strokeStyle = C.brow; ctx.lineWidth = id === 'worf' ? 10 : 7; ctx.lineCap = 'round';
  for (const sx of [-1, 1]) {
    let lift = (o.brow ?? 0) * 8;
    if (id === 'q' && sx === 1) lift += 12;
    if (id === 'worf') lift -= 4;
    const inner = id === 'worf' || o.angry ? 6 : 0;
    ctx.beginPath(); ctx.moveTo(sx * 18, -28 + inner - lift); ctx.quadraticCurveTo(sx * 36, -38 - lift, sx * 54, -30 - lift); ctx.stroke();
  }
  // nose
  ctx.strokeStyle = shade(sk, -0.25); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(3, -4); ctx.lineTo(-7, 34); ctx.lineTo(7, 37); ctx.stroke();
  // mouth
  const open = clamp(talk);
  if (open > 0.06) {
    ellipse(0, 62, 20 + 6 * open, 3 + 18 * open); ctx.fillStyle = '#4a1414'; ctx.fill();
    ctx.save(); ellipse(0, 62, 20 + 6 * open, 3 + 18 * open); ctx.clip(); ctx.fillStyle = '#f3efe6'; ctx.fillRect(-26, 60 - 3 - 18 * open, 52, 6 + 2 * open); ctx.restore();
  } else {
    ctx.strokeStyle = shade(sk, -0.4); ctx.lineWidth = 5; ctx.beginPath();
    if (id === 'q') { ctx.moveTo(-20, 64); ctx.quadraticCurveTo(4, 66, 24, 54); }
    else if (id === 'worf' || id === 'locutus') { ctx.moveTo(-20, 64); ctx.quadraticCurveTo(0, 58, 20, 64); }
    else { ctx.moveTo(-20, 60); ctx.quadraticCurveTo(0, 68 + (o.smile ?? 0) * 6, 20, 60); }
    ctx.stroke();
  }
  if (id === 'geordi') { // VISOR
    const vg = ctx.createLinearGradient(0, -30, 0, 12); vg.addColorStop(0, '#f2f4f7'); vg.addColorStop(0.5, '#9aa2ad'); vg.addColorStop(1, '#5d646e');
    ctx.fillStyle = '#6d747e'; rrect(-104, -16, 18, 22, 6); ctx.fill(); rrect(86, -16, 18, 22, 6); ctx.fill();
    rrect(-92, -28, 184, 40, 16); ctx.fillStyle = vg; ctx.fill();
    ctx.strokeStyle = 'rgba(40,40,50,0.55)'; ctx.lineWidth = 2.5; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(-80, -20 + k * 7); ctx.lineTo(80, -20 + k * 7); ctx.stroke(); }
    const sx = -80 + ((t * 0.9) % 1) * 160; const gl = ctx.createLinearGradient(sx - 30, 0, sx + 30, 0);
    gl.addColorStop(0, 'rgba(255,90,40,0)'); gl.addColorStop(0.5, `rgba(255,90,40,${0.6 + 0.4 * (o.glow ?? 0)})`); gl.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.fillStyle = gl; rrect(-90, -18, 180, 20, 8); ctx.fill();
  }
  if (id === 'locutus') {
    ctx.fillStyle = '#2b2e31'; poly([[-60, -30], [-12, -24], [-14, 14], [-48, 22], [-88, 4], [-90, -22]]); ctx.fill();
    ctx.fillStyle = '#4d5357'; rrect(-74, -14, 30, 16, 4); ctx.fill();
    circle(-38, -6, 6); ctx.fillStyle = '#ff2a1a'; ctx.shadowColor = '#f00'; ctx.shadowBlur = 20; ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,40,30,0.75)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-38, -6); ctx.lineTo(-900, -60 + Math.sin(t * 2) * 30); ctx.stroke();
    ctx.strokeStyle = '#2b2e31'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(-80, 40); ctx.quadraticCurveTo(-100, 110, -60, 150); ctx.stroke();
  }
}
// Draws a crew bust; (x,y) is the head center, s the scale. o: { talk, t, alpha, hat, tug, glow, brow, angry }
function bust(id, x, y, s, o = {}) {
  const C = CREW[id]; const t = o.t ?? 0;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  hairBack(id);
  ctx.save(); ctx.translate(0, (o.tug ?? 0) * 18); uniform(id, C); ctx.restore();
  ctx.fillStyle = shade(C.skin, -0.2); rrect(-40, 40, 80, 100, 22); ctx.fill();
  for (const sx of [-1, 1]) { ellipse(sx * 90, 14, 14, 24); ctx.fillStyle = shade(C.skin, -0.08); ctx.fill(); }
  const hg = ctx.createRadialGradient(-20, -30, 20, 0, 0, 130); hg.addColorStop(0, shade(C.skin, 0.12)); hg.addColorStop(1, shade(C.skin, -0.12));
  ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(0, 0, id === 'worf' ? 94 : 88, id === 'picard' || id === 'locutus' ? 116 : 110, 0, 0, Math.PI * 2); ctx.fill();
  hairFront(id);
  face(id, C, o.talk ?? 0, t, o);
  if (o.hat === 'deerstalker') {
    ctx.fillStyle = '#7a5a3a'; ctx.beginPath(); ctx.ellipse(0, -96, 104, 54, 0, Math.PI, 0); ctx.fill();
    poly([[-100, -96], [-150, -78], [-96, -82]]); ctx.fill(); poly([[100, -96], [150, -78], [96, -82]]); ctx.fill();
    ctx.strokeStyle = '#5a3f26'; ctx.lineWidth = 4; for (let k = -80; k <= 80; k += 20) { ctx.beginPath(); ctx.moveTo(k, -100); ctx.lineTo(k * 0.7, -146); ctx.stroke(); }
  }
  if (o.hat === 'robin') {
    ctx.fillStyle = '#2f7a2f'; poly([[-110, -96], [120, -110], [10, -186]]); ctx.fill();
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(60, -120); ctx.quadraticCurveTo(110, -200, 160, -220); ctx.stroke();
  }
  ctx.restore();
}

// ---------- props
function ship(x, y, s, o = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * (1 + (o.stretch ?? 0)), s);
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  const hull = ctx.createLinearGradient(0, -60, 0, 110); hull.addColorStop(0, '#eef1f5'); hull.addColorStop(1, '#7b8491');
  const nacelle = (nx, ny, far) => {
    ctx.fillStyle = far ? '#6c7380' : '#a9b1bc'; rrect(nx, ny, 330, 24, 12); ctx.fill();
    ctx.fillStyle = '#7fd8ff'; ctx.shadowColor = '#5cf'; ctx.shadowBlur = 18; ctx.fillRect(nx + 40, ny + 5, 250, 6); ctx.shadowBlur = 0;
    ellipse(nx + 318, ny + 12, 17, 12); ctx.fillStyle = '#ff3b2a'; ctx.shadowColor = '#f42'; ctx.shadowBlur = 24; ctx.fill(); ctx.shadowBlur = 0;
  };
  nacelle(-470, -16, true);
  ctx.fillStyle = '#8b94a1'; poly([[-185, 58], [-160, 58], [-205, 4], [-235, 4]]); ctx.fill();
  ctx.fillStyle = hull; ctx.beginPath(); ctx.moveTo(-330, 70); ctx.quadraticCurveTo(-330, 44, -292, 42); ctx.lineTo(20, 40); ctx.quadraticCurveTo(76, 44, 84, 72); ctx.quadraticCurveTo(76, 100, 20, 104); ctx.lineTo(-262, 102); ctx.quadraticCurveTo(-326, 98, -330, 70); ctx.fill();
  const dg = ctx.createRadialGradient(70, 72, 2, 70, 72, 34); dg.addColorStop(0, '#fff3c4'); dg.addColorStop(0.4, '#ffa640'); dg.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = dg; circle(70, 72, 34); ctx.fill();
  ctx.fillStyle = hull; poly([[-30, 44], [60, 44], [126, -2], [36, -2]]); ctx.fill();
  ellipse(150, -6, 196, 24); ctx.fillStyle = hull; ctx.fill();
  ellipse(150, -26, 74, 12); ctx.fill(); ellipse(150, -36, 22, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(60,70,80,0.6)'; ctx.lineWidth = 2; ellipse(150, -6, 196, 24); ctx.stroke();
  ctx.fillStyle = '#ffe9a8'; for (let i = 0; i < 26; i++) { const wx = -20 + i * 13.5; ctx.fillRect(wx, -10 + Math.abs(wx - 150) * 0.02, 5, 3); }
  for (let i = 0; i < 14; i++) ctx.fillRect(-250 + i * 20, 60, 5, 3);
  nacelle(-480, -4, false);
  ctx.restore();
}
function cube3d(x, y, size, t, o = {}) {
  const a = t * 0.45 + (o.a ?? 0.5), b = t * 0.3 + 0.4;
  const V = [];
  for (const X of [-1, 1]) for (const Y of [-1, 1]) for (const Z of [-1, 1]) {
    let x1 = X * Math.cos(a) - Z * Math.sin(a), z1 = X * Math.sin(a) + Z * Math.cos(a);
    let y1 = Y * Math.cos(b) - z1 * Math.sin(b), z2 = Y * Math.sin(b) + z1 * Math.cos(b);
    const p = 1 / (1 + z2 * 0.18); V.push([x + x1 * size * p, y + y1 * size * p, z2]);
  }
  const F = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
  F.map((f) => ({ f, z: f.reduce((s, i) => s + V[i][2], 0) })).sort((p, q) => q.z - p.z).forEach(({ f, z }) => {
    const P = f.map((i) => V[i]);
    poly(P.map((p) => [p[0], p[1]])); ctx.fillStyle = `rgba(14,${30 + (1 - z) * 12},16,0.95)`; ctx.fill();
    ctx.strokeStyle = `rgba(80,255,120,${0.25 + (o.glow ?? 0) * 0.5})`; ctx.lineWidth = 1.5;
    for (let k = 1; k < 6; k++) {
      const u = k / 6;
      ctx.beginPath(); ctx.moveTo(lerp(P[0][0], P[1][0], u), lerp(P[0][1], P[1][1], u)); ctx.lineTo(lerp(P[3][0], P[2][0], u), lerp(P[3][1], P[2][1], u)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lerp(P[0][0], P[3][0], u), lerp(P[0][1], P[3][1], u)); ctx.lineTo(lerp(P[1][0], P[2][0], u), lerp(P[1][1], P[2][1], u)); ctx.stroke();
    }
    poly(P.map((p) => [p[0], p[1]])); ctx.strokeStyle = '#4f8'; ctx.lineWidth = 3; ctx.shadowColor = '#3f6'; ctx.shadowBlur = 16; ctx.stroke(); ctx.shadowBlur = 0;
  });
}
function cat(x, y, s, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = '#d97f25'; ctx.lineWidth = 16; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(50, 50); ctx.quadraticCurveTo(110 + Math.sin(t * 3) * 20, 20, 90 + Math.sin(t * 3 + 1) * 25, -50); ctx.stroke();
  ctx.fillStyle = '#e08a2c'; ellipse(0, 20, 64, 74); ctx.fill(); circle(0, -78, 46); ctx.fill();
  poly([[-42, -100], [-34, -150], [-8, -116]]); ctx.fill(); poly([[42, -100], [34, -150], [8, -116]]); ctx.fill();
  ctx.strokeStyle = '#b3601a'; ctx.lineWidth = 6; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-50, k * 22); ctx.lineTo(-20, k * 22 + 6); ctx.stroke(); ctx.beginPath(); ctx.moveTo(50, k * 22); ctx.lineTo(20, k * 22 + 6); ctx.stroke(); }
  ctx.fillStyle = '#7bd36b'; ellipse(-17, -82, 7, (t % 3.3) < 0.15 ? 1 : 9); ctx.fill(); ellipse(17, -82, 7, (t % 3.3) < 0.15 ? 1 : 9); ctx.fill();
  ctx.fillStyle = '#f4a0a0'; poly([[-6, -64], [6, -64], [0, -57]]); ctx.fill();
  ctx.restore();
}
function heart(x, y, s, col) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.beginPath(); ctx.moveTo(0, 12);
  ctx.bezierCurveTo(-26, -6, -14, -30, 0, -14); ctx.bezierCurveTo(14, -30, 26, -6, 0, 12); ctx.fillStyle = col; ctx.fill(); ctx.restore();
}
function card(x, y, s, rank, suit, rot = 0, faceUp = true) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  rrect(-50, -70, 100, 140, 10); ctx.fillStyle = faceUp ? '#fbfaf5' : '#7a1c2a'; ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.stroke();
  if (faceUp) { const red = suit === '♥' || suit === '♦'; text(rank, -36, -36, 34, red ? '#c0392b' : '#111', 'left', { weight: 700 }); text(suit, 0, 30, 60, red ? '#c0392b' : '#111', 'center', { weight: 400 }); }
  else { ctx.strokeStyle = '#e8c35c'; ctx.lineWidth = 3; rrect(-38, -58, 76, 116, 6); ctx.stroke(); poly([[0, -22], [16, 22], [0, 12], [-16, 22]]); ctx.fillStyle = '#e8c35c'; ctx.fill(); }
  ctx.restore();
}

// ---------- background: starfield with integrated travel speed
const SR = mulberry(1701);
const STARS = Array.from({ length: 650 }, () => ({ x: (SR() * 2 - 1) * W * 1.2, y: (SR() * 2 - 1) * H * 1.2, z: SR() * 1000, b: 0.4 + SR() * 0.6 }));
const SPEED = { intro: 25, ensemble: 110, verse: 45, chorus: 950, q: 20, borg: 15, finale: 1100, outro: 12 };
const TRAVEL = [];
{ let acc = 0, sp = 20; for (let i = 0; i <= (TL.duration + 5) * 20; i++) { const t = i / 20; sp += ((SPEED[sectionAt(t).type] ?? 50) - sp) * 0.06; acc += sp / 20; TRAVEL.push([acc, sp]); } }
const travel = (t) => TRAVEL[clamp(Math.floor(t * 20), 0, TRAVEL.length - 1)];
function stars(t, o = {}) {
  const [tr, sp0] = travel(t); const sp = sp0 + (o.boost ?? 0);
  const cx = o.cx ?? W / 2, cy = o.cy ?? H / 2;
  ctx.lineCap = 'round';
  for (const s of STARS) {
    const z = ((s.z - tr - (o.extra ?? 0)) % 1000 + 1000) % 1000 + 2;
    const k = 380 / z, x = cx + s.x * k * 0.5, y = cy + s.y * k * 0.5;
    if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
    const z2 = z + Math.min(400, sp * 0.06); const k2 = 380 / z2;
    const a = clamp(s.b * (1 - z / 1000) * 1.6) * (o.alpha ?? 1);
    ctx.strokeStyle = o.color ? o.color(a) : `rgba(200,220,255,${a})`;
    ctx.lineWidth = clamp(3 - z / 300, 0.8, 3);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx + s.x * k2 * 0.5, cy + s.y * k2 * 0.5); ctx.stroke();
  }
}
function nebula(t, c1, c2) {
  const g = ctx.createRadialGradient(W * 0.7 + Math.sin(t * 0.05) * 100, H * 0.35, 50, W * 0.6, H * 0.5, 1100);
  g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ---------- LCARS chrome
function elbow(x, y, w, h, bw, bh, r, flip) {
  ctx.save(); if (flip) { ctx.translate(0, y * 2); ctx.scale(1, -1); }
  const ri = r * 0.45; ctx.beginPath();
  ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + bh);
  ctx.lineTo(x + bw + ri, y + bh); ctx.arcTo(x + bw, y + bh, x + bw, y + bh + ri, ri); ctx.lineTo(x + bw, y + h); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function lcars(t, accent, title, o = {}) {
  const p = pulse(t), intro = easeOut((t - (o.since ?? -9)) / 0.5);
  const slide = (1 - intro) * -400;
  ctx.save(); ctx.translate(slide, 0);
  ctx.fillStyle = accent; elbow(24, 24, 360, 220, 150, 52, 60);
  ctx.fillStyle = LC.peach; elbow(24, 1056, 360, 220, 150, 52, 60, true);
  ctx.fillStyle = LC.lav; rrect(24, 252, 150, 130, 0); ctx.fill();
  ctx.fillStyle = LC.orange; rrect(24, 390, 150, 300 + p * 6, 0); ctx.fill();
  ctx.fillStyle = LC.blue; rrect(24, 698, 150, 130, 0); ctx.fill();
  const codes = ['47-' + (1701 + Math.floor(t * 2) % 90), 'LCARS ' + (40000 + Math.floor(t * 7) % 999), '0' + (2 + Math.floor(t) % 7) + '-' + (3100 + Math.floor(t * 3) % 800)];
  [[252, codes[0]], [390, codes[1]], [698, codes[2]]].forEach(([yy, c]) => text(c, 160, yy + 120, 26, '#000', 'right', { weight: 600 }));
  ctx.restore();
  // top + bottom bars
  const bars = (y, h, segs) => { let x = 392; for (const [w, c] of segs) { ctx.fillStyle = c; if (w < 0) { rrect(x, y, -w, h, h / 2); ctx.fill(); x += -w + 8; } else { ctx.fillRect(x, y, w, h); x += w + 8; } } };
  const tw = fitSize(title, 900, 46);
  ctx.font = `700 ${tw}px ${FONT}`; ctx.letterSpacing = '3px'; const titleW = ctx.measureText(title).width + 40; ctx.letterSpacing = '0px';
  const fill = Math.max(40, 1504 - 8 * 4 - titleW - 220 - 160);
  bars(24, 52, [[fill, accent], [160, LC.peach]]);
  text(title, 392 + fill + 8 + 160 + 8 + 20, 68, tw, accent, 'left', { weight: 700, spacing: 3 });
  ctx.fillStyle = LC.lav; rrect(1896 - 220, 24, 220, 52, 26); ctx.fill();
  bars(1004, 52, [[260, LC.lav], [120 + p * 30, LC.gold], [420, LC.peach], [180, accent], [-430, LC.blue]]);
  if (o.sub) text(o.sub, 1876, 1044, fitSize(o.sub, 390, 30), '#000', 'right', { weight: 700, spacing: 2 });
}

// ---------- lyric display
function wrapTokens(tokens, size, maxW) {
  ctx.font = `600 ${size}px ${FONT}`;
  const space = ctx.measureText(' ').width, rows = [[]]; let w = 0;
  for (const tk of tokens) {
    const tw = ctx.measureText(tk.w).width;
    if (w + tw > maxW && rows.at(-1).length) { rows.push([]); w = 0; }
    rows.at(-1).push({ ...tk, tw }); w += tw + space;
  }
  return { rows, space };
}
function lyricLine(line, t, x, y, size, maxW, o = {}) {
  const toks = wordTimes(line);
  const { rows, space } = wrapTokens(toks, size, maxW);
  const lh = size * 1.12;
  rows.forEach((row, ri) => {
    const rowW = row.reduce((s, tk) => s + tk.tw + space, -space);
    let cx = o.align === 'center' ? x - rowW / 2 : x;
    for (const tk of row) {
      const sung = o.past ? 1 : clamp((t - tk.s) / 0.12);
      const col = o.past ? o.pastColor ?? 'rgba(200,190,230,0.45)' : sung > 0 ? (o.hot ?? '#ffffff') : (o.cold ?? 'rgba(170,160,210,0.55)');
      const lift = o.past ? 0 : (1 - easeOut(sung)) * 0 + (sung > 0 && sung < 1 ? -4 * (1 - sung) : 0);
      text(tk.w, cx, y + ri * lh + lift, size, col, 'left', { weight: 600, glow: !o.past && sung > 0 ? o.glow : null, blur: 18 });
      cx += tk.tw + space;
    }
  });
  return rows.length * lh;
}
function lyricStack(sec, t, x, yCur, maxW, o = {}) {
  const cur = lineAt(sec, t); if (!cur) return null;
  const i = sec.lines.indexOf(cur), k = easeOut((t - cur.start) / 0.3);
  const size = o.size ?? 64;
  ctx.save(); ctx.globalAlpha *= clamp((t - cur.start + 0.05) / 0.15);
  lyricLine(cur, t, x, yCur + (1 - k) * 50, size, maxW, { hot: o.hot, glow: o.glow });
  ctx.restore();
  let yy = yCur - size * 0.95 + (1 - k) * 50;
  for (let j = i - 1, n = 0; j >= 0 && n < (o.history ?? 3); j--, n++) {
    const L = sec.lines[j]; const ps = size * 0.62;
    const { rows } = wrapTokens(wordTimes(L), ps, maxW);
    yy -= rows.length * ps * 1.12 + 8;
    ctx.save(); ctx.globalAlpha *= (n === 0 ? 0.75 : n === 1 ? 0.45 : 0.22) * (n === (o.history ?? 3) - 1 ? k : 1);
    lyricLine(L, t, x, yy + ps, ps, maxW, { past: true, pastColor: o.pastColor });
    ctx.restore();
  }
  return cur;
}
function lowerThird(sec, t, o = {}) {
  const cur = lineAt(sec, t); if (!cur) return null;
  const a = clamp((t - cur.start + 0.05) / 0.15) * clamp((cur.end + 0.6 - t) / 0.3);
  ctx.save(); ctx.globalAlpha *= a;
  const g = ctx.createLinearGradient(0, H - 300, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = g; ctx.fillRect(0, H - 300, W, 300);
  lyricLine(cur, t, W / 2, o.y ?? H - 120, o.size ?? 70, o.maxW ?? 1600, { align: 'center', hot: o.hot ?? '#fff', glow: o.glow ?? 'rgba(120,180,255,0.8)', cold: 'rgba(200,210,255,0.4)' });
  ctx.restore();
  return cur;
}
const fxP = (line, t) => (line ? clamp((t - line.start) / Math.max(0.3, line.end - line.start)) : 0);

// ---------- section renderers
function drawIntro(sec, t) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  nebula(t, 'rgba(40,30,90,0.35)', 'rgba(0,0,0,0)');
  stars(t, { alpha: clamp(t / 2) });
  const first = sec.lines[0];
  text('STARDATE 41153.7', 80, H - 70, 34, LC.peach, 'left', { spacing: 8, weight: 500 });
  // narration, word by word
  const na = clamp((first.end + 1.2 - t) / 0.6);
  if (t >= first.start - 0.05 && na > 0) {
    ctx.save(); ctx.globalAlpha = na;
    let shown = ''; for (const tk of wordTimes(first)) if (t >= tk.s) shown += (shown ? ' ' : '') + tk.w;
    text(shown.toUpperCase(), W / 2, H / 2 + 20, 96, '#e8eeff', 'center', { spacing: 14, weight: 400, glow: 'rgba(140,170,255,0.9)', blur: 30 });
    ctx.restore();
  }
  // instrumental: the Enterprise approaches under the title, then jumps to warp
  const a = first.end + 0.6, b = sec.end;
  const k = (t - a) / (b - a);
  if (k > 0) {
    const warp = clamp((k - 0.86) / 0.1);
    ship(lerp(W / 2 - 260, W / 2 + 120, k) + easeIn(warp) * 2600, lerp(H / 2 + 40, H / 2 + 140, k), lerp(0.12, 1.3, easeInOut(k)), { stretch: easeIn(warp) * 4, alpha: clamp(k * 4) });
    const ta = clamp((t - a - 1.2) / 0.5) * clamp((b - 0.9 - t) / 0.5);
    if (ta > 0) {
      ctx.save(); ctx.globalAlpha = ta;
      slam('MAKE IT SO', a + 1.2, t, W / 2, 230, 190, LC.peach, { glow: LC.orange, spacing: 18 });
      text('A STAR TREK: THE NEXT GENERATION FAN MUSICAL', W / 2, 360, 40, LC.lav, 'center', { spacing: 10, weight: 500 });
      ctx.restore();
    }
    const fl = t - (a + (b - a) * 0.95); if (fl > 0) { ctx.fillStyle = `rgba(220,235,255,${clamp(fl / 0.3)})`; ctx.fillRect(0, 0, W, H); }
  }
}
function drawEnsemble(sec, t) {
  ctx.fillStyle = LC.bg; ctx.fillRect(0, 0, W, H);
  nebula(t, 'rgba(30,50,110,0.35)', 'rgba(0,0,0,0)');
  stars(t);
  const k = easeOut((t - sec.start) / 2.5);
  const bob = Math.sin(t * 1.2) * 8;
  ship(lerp(-700, W / 2 + 60, k), H / 2 - 80 + bob, lerp(0.5, 1.45, k), { stretch: (1 - k) * 1.5 });
  const cur = lowerThird(sec, t, { size: 66 });
  if (cur?.fx === 'registry') slam('NCC-1701-D', cur.start, t, W / 2, 210, 120, LC.gold, { spacing: 20 });
  const last = sec.lines.at(-1);
  if (t > last.start) BRIDGE.forEach((id, i) => {
    const p = easeBack((t - last.start - i * 0.12) / 0.4);
    bust(id, 220 + i * 246, H - 330 + (1 - p) * 300, 0.62, { t, alpha: clamp(p) * clamp((sec.end - t) / 0.4) });
  });
  return cur;
}
function verseFx(fx, line, t, char) {
  const p = fxP(line, t), lt = t - line.start;
  switch (fx) {
    case 'fourlights': {
      const ws = wordTimes(line);
      for (let i = 0; i < 4; i++) {
        const on = t >= (ws[i]?.s ?? line.start + i * 0.3);
        const x = 1000 + i * 230, y = 230;
        ctx.save(); if (on) { ctx.shadowColor = '#fff6c0'; ctx.shadowBlur = 60; }
        circle(x, y, 52); ctx.fillStyle = on ? '#fffbe6' : '#2a2a33'; ctx.fill(); ctx.restore();
        ctx.fillStyle = '#555'; ctx.fillRect(x - 6, y - 140, 12, 88);
      }
      break;
    }
    case 'engage': {
      ctx.save(); ctx.globalAlpha = clamp(1 - lt / 0.5) * 0.85; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
      ship(lerp(1350, 3800, easeIn(lt / 0.9)), 300, 0.7, { stretch: easeIn(lt / 0.9) * 3 });
      slam('ENGAGE!', line.start, t, 1340, 420, 200, '#fff', { glow: '#9cf' });
      break;
    }
    case 'tea': {
      const x = 1620, y = 260;
      ctx.fillStyle = '#eee'; ellipse(x, y + 60, 110, 18); ctx.fill();
      poly([[x - 70, y - 30], [x + 70, y - 30], [x + 50, y + 50], [x - 50, y + 50]]); ctx.fillStyle = '#fafafa'; ctx.fill();
      ctx.strokeStyle = '#fafafa'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(x + 74, y + 4, 26, -1.2, 1.2); ctx.stroke();
      ellipse(x, y - 30, 70, 10); ctx.fillStyle = '#9b5a23'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 5;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); for (let j = 0; j < 20; j++) { const yy = y - 50 - j * 7, xx = x - 30 + k * 30 + Math.sin(j * 0.6 + t * 4 + k) * 10; j ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke(); }
      text('EARL GREY · HOT', x, y + 120, 34, LC.peach, 'center', { spacing: 4 });
      break;
    }
    case 'cube': case 'worfcall': {
      rrect(1020, 150, 760, 300, 18); ctx.fillStyle = '#020a03'; ctx.fill(); ctx.strokeStyle = LC.orange; ctx.lineWidth = 4; ctx.stroke();
      ctx.save(); rrect(1020, 150, 760, 300, 18); ctx.clip(); cube3d(1400, 300, 70 + lt * 25, t, { glow: 0.5 }); ctx.restore();
      text('VIEWSCREEN', 1040, 186, 26, LC.orange, 'left', { spacing: 4 });
      break;
    }
    case 'fire': {
      rrect(1020, 150, 760, 300, 18); ctx.fillStyle = '#020a03'; ctx.fill();
      ctx.save(); rrect(1020, 150, 760, 300, 18); ctx.clip(); cube3d(1400, 300, 110, t, { glow: 1 });
      for (let i = 0; i < 3; i++) { const q = clamp((lt - i * 0.15) / 0.5); if (q <= 0 || q >= 1) continue; const xx = lerp(1060, 1400, q), yy = lerp(420, 300, q);
        circle(xx, yy, 18); ctx.fillStyle = '#ff6a2a'; ctx.shadowColor = '#f60'; ctx.shadowBlur = 40; ctx.fill(); ctx.shadowBlur = 0; }
      const boom = clamp((lt - 0.6) / 0.6); if (boom > 0) { circle(1400, 300, boom * 400); ctx.fillStyle = `rgba(255,${200 - boom * 120},80,${1 - boom})`; ctx.fill(); }
      ctx.restore();
      slam('FIRE!', line.start + 0.1, t, 1400, 640, 220, '#ff5533', { glow: '#f40' });
      break;
    }
    case 'spot': cat(1620, 330, 1.1, t); text('SPOT', 1620, 470, 34, LC.tan, 'center', { spacing: 6 }); break;
    case 'openfire': {
      ctx.save(); ctx.globalAlpha = 0.5 * (0.5 + 0.5 * Math.sin(t * 14)); ctx.strokeStyle = '#f33'; ctx.lineWidth = 30; ctx.strokeRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.translate(1450, 270); ctx.rotate(-0.12); const s = easeBack(lt / 0.3);
      ctx.scale(s, s); rrect(-280, -60, 560, 120, 12); ctx.strokeStyle = '#f44'; ctx.lineWidth = 8; ctx.stroke();
      text('RECOMMEND: OPEN FIRE', 0, 18, 56, '#f55', 'center', { weight: 700, spacing: 4 }); ctx.restore();
      break;
    }
    case 'prune': {
      const x = 1600, y = 290;
      poly([[x - 60, y - 110], [x + 60, y - 110], [x + 45, y + 110], [x - 45, y + 110]]); ctx.fillStyle = 'rgba(200,220,255,0.15)'; ctx.fill(); ctx.strokeStyle = '#cde'; ctx.lineWidth = 4; ctx.stroke();
      const lvl = 1 - clamp(lt / 2) * 0.7;
      poly([[x - 45 - 15 * lvl * 0.9, y + 110 - 200 * lvl], [x + 45 + 15 * lvl * 0.9, y + 110 - 200 * lvl], [x + 45, y + 110], [x - 45, y + 110]]); ctx.fillStyle = '#4b1240'; ctx.fill();
      text('A WARRIOR\'S DRINK', x, y + 170, 36, LC.lav, 'center', { spacing: 4 });
      break;
    }
    case 'ram': {
      ship(lerp(-600, 2600, easeIn(lt / 1.4)), 300, 0.6, { stretch: 0.3 });
      slam('RAMMING SPEED!', line.start, t, 1340, 300, 150, '#ff5544', { glow: '#f20' });
      break;
    }
    case 'visor': case 'babble': {
      if (fx === 'visor') for (let i = 0; i < 24; i++) {
        const h = 40 + 180 * Math.abs(noise(t * 4 + i * 1.7)); ctx.fillStyle = `hsl(${i * 13},90%,60%)`;
        ctx.fillRect(1010 + i * 34, 420 - h, 26, h);
      } else {
        const words = ['INVERSE TACHYON PULSE', 'MODULATE DEFLECTOR', 'REROUTE EPS CONDUITS', 'WARP FIELD HARMONICS', 'REALIGN DILITHIUM MATRIX', 'POLARIZE HULL PLATING', 'BYPASS PLASMA RELAY', 'RECALIBRATE SENSORS'];
        ctx.save(); ctx.beginPath(); ctx.rect(1000, 140, 860, 320); ctx.clip();
        for (let i = 0; i < 12; i++) text(words[i % words.length], 1020 + ((i * 97) % 400) - ((t * 260 + i * 140) % 1500) + 600, 170 + i * 26, 28, `rgba(255,170,0,${0.25 + 0.35 * hash(i)})`, 'left', { spacing: 3 });
        ctx.restore();
      }
      break;
    }
    case 'wink': {
      const cols = ['#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];
      ctx.save(); ctx.globalAlpha = easeOut(lt / 0.6); ctx.lineWidth = 22;
      cols.forEach((c, i) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(1400, 470, 330 - i * 22, Math.PI, Math.PI * (1 + easeOut(lt / 0.8))); ctx.stroke(); });
      ctx.restore();
      break;
    }
    case 'sense': case 'heart': case 'lwaxana': {
      if (fx === 'sense') for (let i = 0; i < 5; i++) { const r = ((t * 140 + i * 90) % 450); ctx.strokeStyle = `rgba(204,153,204,${1 - r / 450})`; ctx.lineWidth = 4; circle(480, 400, 120 + r); ctx.stroke(); }
      if (fx === 'heart') for (let i = 0; i < 9; i++) { const yy = 460 - ((lt * 120 + i * 60) % 360); heart(1040 + i * 95 + Math.sin(t * 2 + i) * 15, yy, 1.6 + hash(i), `rgba(255,120,170,${clamp(yy / 300)})`); }
      if (fx === 'lwaxana') { ctx.save(); ctx.translate(1420, 260); ctx.rotate(-0.06); ctx.scale(easeBack(lt / 0.3), easeBack(lt / 0.3));
        text('DAUGHTER OF THE FIFTH HOUSE', 0, 0, 52, LC.lav, 'center', { weight: 700, spacing: 3, glow: '#c9c' });
        text('HOLDER OF THE SACRED CHALICE OF RIXX', 0, 52, 32, LC.peach, 'center', { spacing: 3 }); ctx.restore(); }
      break;
    }
    case 'crash': {
      const q = clamp(lt / 1.2);
      ctx.save(); ctx.translate(lerp(1050, 1500, q), lerp(160, 360, easeIn(q))); ctx.rotate(lerp(0, 0.35, q));
      ellipse(0, 0, 170, 26); ctx.fillStyle = '#c9ced6'; ctx.fill(); ellipse(0, -18, 60, 10); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#4e6b3a'; ctx.beginPath(); ctx.moveTo(1000, 470); ctx.quadraticCurveTo(1400, 300, 1860, 470); ctx.fill();
      if (q >= 1) for (let i = 0; i < 12; i++) { const r = (lt - 1.2) * 200; circle(1560 + Math.cos(i) * r, 380 + Math.sin(i * 1.7) * r * 0.3 - r * 0.2, 20 + r * 0.2); ctx.fillStyle = `rgba(150,130,100,${clamp(0.6 - (lt - 1.2) * 0.5)})`; ctx.fill(); }
      break;
    }
    case 'dance': for (let i = 0; i < 6; i++) { const yy = 420 - ((lt * 160 + i * 70) % 300); text(i % 2 ? '♪' : '♫', 1080 + i * 130, yy, 70, `rgba(153,153,255,${clamp(yy / 260)})`, 'center'); } break;
    case 'wesley': {
      ['picard', 'riker', 'data'].forEach((id, i) => bust(id, 1150 + i * 260, 330, 0.75, { t, talk: vocal(t, line) * 1.2, brow: -1, angry: true }));
      slam('SHUT UP, WESLEY!', line.start, t, 1340, 640, 160, '#ff4444', { glow: '#f00' });
      break;
    }
    case 'bubble': case 'universe': case 'universe2': {
      const r = fx === 'bubble' ? 360 : fx === 'universe' ? lerp(320, 140, p) : lerp(140, 0, easeIn(p));
      const g = ctx.createRadialGradient(480, 420, r * 0.6, 480, 420, r); g.addColorStop(0, 'rgba(100,170,255,0)'); g.addColorStop(1, 'rgba(120,190,255,0.45)');
      ctx.fillStyle = g; circle(480, 420, r); ctx.fill(); ctx.strokeStyle = '#9cf'; ctx.lineWidth = 3; ctx.stroke();
      if (fx !== 'bubble') {
        text('UNIVERSE DIAMETER: ' + Math.round(fx === 'universe' ? 705 : lerp(705, 0, easeIn(p))) + ' M', 1340, 260, 64, '#9cf', 'center', { weight: 700, spacing: 4, glow: '#39f' });
        if (fx === 'universe2') slam('UNIVERSE!', line.start, t, 1340, 640, 190, '#9cf', { glow: '#39f' });
      }
      break;
    }
  }
}
const SLAM_FX = new Set(['fourlights', 'engage', 'fire', 'ram', 'wesley', 'universe2']);
function drawVerse(sec, t) {
  const C = CREW[sec.char];
  ctx.fillStyle = LC.bg; ctx.fillRect(0, 0, W, H);
  stars(t, { alpha: 0.6 });
  const cur = lineAt(sec, t);
  const fx = cur && t < cur.end + 0.3 ? cur.fx : null;
  lcars(t, C.accent, 'PERSONNEL FILE · ' + C.name, { since: sec.start, sub: `${C.rank} · ${C.role}` });
  // portrait panel
  const pin = easeOut((t - sec.start) / 0.6);
  ctx.save(); ctx.translate(0, (1 - pin) * 900);
  rrect(200, 100, 560, 880, 30); ctx.fillStyle = '#0b0c18'; ctx.fill(); ctx.strokeStyle = C.accent; ctx.lineWidth = 4; ctx.stroke();
  ctx.save(); rrect(200, 100, 560, 880, 30); ctx.clip();
  const gg = ctx.createRadialGradient(480, 420, 50, 480, 520, 520); gg.addColorStop(0, shade(DIV[C.div], -0.3)); gg.addColorStop(1, '#0b0c18'); ctx.fillStyle = gg; ctx.fillRect(200, 100, 560, 880);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 2; for (let y = 100; y < 980; y += 8) { ctx.beginPath(); ctx.moveTo(200, y); ctx.lineTo(760, y); ctx.stroke(); }
  const bob = -6 * pulse(t);
  const tug = fx === 'tunic' ? Math.max(0, Math.sin(clamp((t - cur.start) / 0.5) * Math.PI)) : 0;
  const shake = fx === 'ram' || fx === 'die' ? 6 : 0;
  const speaking = !cur?.voice || cur.voice === sec.char;
  bust(sec.char, 480 + noise(t * 30) * shake, 420 + bob + (fx === 'dance' ? Math.sin(t * 8) * 14 : 0), 1.55, {
    t, talk: speaking ? vocal(t, cur) : 0, tug,
    hat: fx === 'holmes' ? 'deerstalker' : fx === 'merry' ? 'robin' : null,
    glow: fx === 'visor' ? 1 : 0, brow: fx === 'sense' ? 1 : 0, angry: sec.char === 'worf' || fx === 'fourlights' || fx === 'nofurther',
  });
  ctx.restore();
  rrect(220, 890, 520, 70, 35); ctx.fillStyle = C.accent; ctx.fill();
  text(C.name, 480, 940, fitSize(C.name, 480, 46), '#000', 'center', { weight: 700, spacing: 2 });
  ctx.restore();
  if (fx) verseFx(fx, cur, t, sec.char);
  // lead-in: big name
  const first = sec.lines[0];
  if (t < first.start) {
    const a = clamp((t - sec.start) / 0.3) * clamp((first.start - t) / 0.2);
    ctx.save(); ctx.globalAlpha = a; slam(C.name, sec.start + 0.1, t, 1340, 520, 130, C.accent, { maxW: 980 }); ctx.restore();
  }
  // lyrics (slam lines get their own typography above, so keep them small)
  if (!SLAM_FX.has(fx)) lyricStack(sec, t, 840, 760, 1020, { size: 62, hot: '#fff', glow: C.accent });
  else { ctx.save(); ctx.globalAlpha = 0.6; lyricStack(sec, t, 840, 900, 1020, { size: 44, hot: '#fff', history: 1 }); ctx.restore(); }
  // fact pills
  if (C.facts) C.facts.forEach((f, i) => {
    const a = clamp((t - sec.start - 0.6 - i * 0.15) / 0.3);
    ctx.save(); ctx.globalAlpha = a * 0.9; rrect(840 + i * 345, 930, 330, 48, 24); ctx.fillStyle = [LC.peach, LC.lav, LC.sky][i]; ctx.fill();
    text(f, 840 + i * 345 + 165, 964, fitSize(f, 300, 26), '#000', 'center', { weight: 700, spacing: 1 }); ctx.restore();
  });
  return cur;
}
function drawChorus(sec, t, finale) {
  ctx.fillStyle = '#02030a'; ctx.fillRect(0, 0, W, H);
  nebula(t, finale ? 'rgba(120,60,20,0.35)' : 'rgba(60,40,120,0.35)', 'rgba(0,0,0,0)');
  stars(t);
  const cur = lineAt(sec, t);
  const p = pulse(t);
  ship(W / 2 + Math.sin(t * 0.7) * 40, 330 + Math.sin(t * 1.1) * 10, 1.0 + p * 0.03, { stretch: 0.05 + p * 0.05 });
  // crew lineup
  const roll = cur?.fx === 'rollcall' ? wordTimes(cur) : null;
  BRIDGE.forEach((id, i) => {
    let pop = 1, big = 0;
    if (roll) { const ws = roll[i]; pop = ws ? easeBack((t - ws.s) / 0.25) : 1; big = ws && t >= ws.s ? Math.exp(-(t - ws.s) * 3) : 0; }
    const x = 210 + i * 250, y = 790 - 14 * Math.abs(Math.sin((t * Math.PI * TL.bpm) / 60 + i * 0.6)) - big * 40;
    bust(id, x, y, 0.62 + big * 0.12, { t, alpha: roll ? clamp(pop) : 1, talk: vocal(t, cur) * 0.9, smile: 1 });
    if (roll && big > 0.02) text(id.toUpperCase(), x, 600, 64, CREW[id].accent, 'center', { weight: 700, glow: CREW[id].accent, spacing: 4 });
  });
  if (cur && (cur.fx === 'mis' || cur.fx === 'misfinal')) slam('MAKE IT SO!', cur.start, t, W / 2, 160, 170, LC.peach, { glow: LC.orange, spacing: 12 });
  lowerThird(sec, t, { size: 64, y: H - 70, glow: 'rgba(255,160,90,0.8)' });
  return cur;
}
function drawQ(sec, t) {
  const cur = lineAt(sec, t);
  const snaps = sec.lines.filter((l) => l.fx === 'snap').flatMap((l) => wordTimes(l).filter((w) => /^snap/i.test(w.w)).map((w) => w.s));
  const nSnap = snaps.filter((s) => t >= s).length;
  const scenes = [['#3b0f2e', '#12040e'], ['#123a14', '#04140a'], ['#5a9be0', '#cfe7ff']];
  const [c1, c2] = scenes[Math.min(nSnap, 2)] ?? scenes[0];
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (nSnap === 1) { ctx.fillStyle = '#0b2a0d'; for (let i = 0; i < 14; i++) { const x = i * 150 - 40; poly([[x, H], [x + 90, 300 + hash(i) * 200], [x + 180, H]]); ctx.fill(); } }
  if (nSnap >= 2) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 6; i++) { const x = ((i * 380 + t * 60) % (W + 400)) - 200, y = 160 + hash(i) * 400; circle(x, y, 60); ctx.fill(); circle(x + 60, y - 20, 70); ctx.fill(); circle(x + 130, y, 55); ctx.fill(); } }
  else stars(t, { alpha: 0.5, color: (a) => `rgba(255,220,140,${a})` });
  // sparkle flashes on snaps
  for (const s of snaps) { const d = t - s; if (d >= 0 && d < 0.35) { ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - d / 0.35)})`; ctx.fillRect(0, 0, W, H); } }
  const enter = easeBack((t - sec.start) / 0.5);
  const leave = cur?.fx === 'timid' ? clamp((t - cur.start - (cur.end - cur.start) * 0.6) / 0.5) : 0;
  ctx.save(); ctx.globalAlpha = 1 - leave;
  bust('q', 500, 470 + (1 - enter) * 700, 1.7 * (1 - leave * 0.6), { t, talk: vocal(t, cur), smile: 1 });
  ctx.restore();
  if (leave > 0) for (let i = 0; i < 30; i++) { const a = i * 2.4, r = leave * 500 * hash(i); circle(500 + Math.cos(a) * r, 470 + Math.sin(a) * r, 6 * (1 - leave)); ctx.fillStyle = '#ffe9a0'; ctx.fill(); }
  text('Q', 500, 1020, 80, LC.gold, 'center', { weight: 700, glow: LC.gold });
  if (cur?.fx === 'trial') { ctx.save(); ctx.translate(1340, 260); ctx.rotate(-0.08); const s = easeBack((t - cur.start) / 0.3); ctx.scale(s, s);
    rrect(-330, -70, 660, 140, 14); ctx.strokeStyle = '#ffcc66'; ctx.lineWidth = 8; ctx.stroke(); text('THE TRIAL NEVER ENDS', 0, 22, 64, '#ffcc66', 'center', { weight: 700, spacing: 4 }); ctx.restore(); }
  if (cur?.fx === 'cube') cube3d(1600, 260, 80, t);
  lyricStack(sec, t, 920, 760, 940, { size: 62, hot: '#fff', glow: LC.gold });
  return cur;
}
function drawBorg(sec, t) {
  const cur = lineAt(sec, t);
  const fx = cur?.fx;
  const redMode = fx === 'line' || fx === 'nofurther';
  ctx.fillStyle = redMode ? '#1a0303' : '#010702'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = redMode ? 'rgba(255,60,40,0.12)' : 'rgba(60,255,100,0.12)'; ctx.lineWidth = 1;
  const off = (t * 40) % 60; for (let x = -60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x + off, 0); ctx.lineTo(x + off, H); ctx.stroke(); } for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  if (!redMode) {
    const grow = easeOut((t - sec.start) / 4);
    if (fx !== 'locutus') cube3d(W / 2, H / 2 - 60, lerp(80, 300, grow), t, { glow: pulse(t) });
    else bust('locutus', W / 2, 440, 2.0, { t, talk: vocal(t, cur) });
    if (fx === 'borg') slam('WE ARE THE BORG', cur.start, t, W / 2, 160, 120, '#6f8', { glow: '#2f6', spacing: 14 });
    if (fx === 'futile') { const gl = Math.floor(t * 20) % 7 === 0 ? 14 : 0; slam('RESISTANCE IS FUTILE', cur.start, t, W / 2 + gl, 160, 120, '#6f8', { glow: '#2f6', spacing: 14 }); }
    if (fx === 'locutus') slam('LOCUTUS', cur.start, t, W / 2, 140, 110, '#f44', { glow: '#f00', spacing: 20 });
    if (fx === 'comeback') BRIDGE.slice(1).forEach((id, i) => bust(id, 260 + i * 280, 760, 0.6, { t, talk: vocal(t, cur), brow: 1 }));
  } else {
    bust('picard', 480, 470, 1.8, { t, talk: vocal(t, cur), angry: true });
    const lineP = fx === 'line' ? easeOut((t - cur.start) / 0.5) : 1;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 12; ctx.shadowColor = '#f44'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.moveTo(900, 560); ctx.lineTo(900 + 900 * lineP, 560); ctx.stroke(); ctx.shadowBlur = 0;
    if (fx === 'line') slam('THE LINE MUST BE DRAWN HERE!', cur.start, t, 1350, 420, 90, '#fff', { glow: '#f44', maxW: 960 });
    if (fx === 'nofurther') { slam('THIS FAR...', cur.start, t, 1350, 400, 110, '#fcc', { glow: '#f44', maxW: 960 });
      const nf = wordTimes(cur).find((w) => /^NO/.test(w.w))?.s ?? cur.start + 0.6; slam('NO FURTHER!', nf, t, 1350, 720, 170, '#ff4433', { glow: '#f00', maxW: 960 }); }
  }
  if (!redMode && fx !== 'borg' && fx !== 'futile') lowerThird(sec, t, { size: 62, glow: 'rgba(80,255,120,0.8)' });
  else if (!redMode) lowerThird(sec, t, { size: 52, glow: 'rgba(80,255,120,0.8)' });
  return cur;
}
function drawOutro(sec, t) {
  const cur = lineAt(sec, t);
  const skyLine = sec.lines.find((l) => l.fx === 'sky');
  const up = skyLine ? easeInOut((t - skyLine.start) / 2.0) : 0;
  ctx.fillStyle = '#02030a'; ctx.fillRect(0, 0, W, H);
  stars(t, { alpha: up });
  ctx.save(); ctx.translate(0, up * H);
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(0, 0, W, H);
  const fg = ctx.createRadialGradient(W / 2, 760, 100, W / 2, 760, 900); fg.addColorStop(0, '#1f7a43'); fg.addColorStop(1, '#0b3a1e');
  ellipse(W / 2, 800, 900, 330); ctx.fillStyle = '#5a3418'; ctx.fill(); ellipse(W / 2, 800, 860, 300); ctx.fillStyle = fg; ctx.fill();
  BRIDGE.forEach((id, i) => { const a = Math.PI * (1.1 + 0.8 * i / 6); bust(id, W / 2 + Math.cos(a) * 760, 520 + Math.sin(a) * 120 + 60, 0.7, { t, talk: id === 'picard' ? vocal(t, cur) : 0, smile: 1 }); });
  const cardsLine = sec.lines.find((l) => l.fx === 'cards');
  if (cardsLine) for (let i = 0; i < 5; i++) { const q = easeOut((t - cardsLine.start - i * 0.25) / 0.4); if (q <= 0) continue;
    card(lerp(W / 2, W / 2 - 300 + i * 150, q), lerp(600, 820, q), 1.2, ['A', 'K', 'Q', 'J', '10'][i], '♠', (i - 2) * 0.06 * q, t > cardsLine.start + 1.6); }
  ctx.restore();
  if (up > 0) { if (t < skyLine.start + 2.75) ship(lerp(W / 2, W + 1800, easeIn((t - skyLine.start - 1.8) / 1.0)), H / 2 - 40, 0.9, { stretch: easeIn((t - skyLine.start - 1.8) / 1.0) * 4, alpha: up });
    const fl = t - skyLine.start - 2.7; if (fl > 0 && fl < 0.4) { ctx.fillStyle = `rgba(200,230,255,${1 - fl / 0.4})`; ctx.fillRect(0, 0, W, H); }
    const end = clamp((t - skyLine.start - 3.0) / 0.8);
    if (end > 0) { ctx.save(); ctx.globalAlpha = end; text('MAKE IT SO', W / 2, H / 2, 170, LC.peach, 'center', { weight: 700, spacing: 18, glow: LC.orange, baseline: 'middle' });
      text('A FAN TRIBUTE TO STAR TREK: THE NEXT GENERATION', W / 2, H / 2 + 120, 34, LC.lav, 'center', { spacing: 8, weight: 500 }); ctx.restore(); }
  }
  if (!skyLine || t < skyLine.start + 2.6) lowerThird(sec, t, { size: 70, glow: 'rgba(255,200,120,0.8)' });
  return cur;
}

// ---------- frame
const FIRE_LINE = sections.flatMap((s) => s.lines).find((l) => l.fx === 'fire');
function renderFrame(t) {
  const sec = sectionAt(t);
  ctx.save();
  const cur = lineAt(sec, t);
  const hot = cur && t < cur.start + 0.6 ? cur.fx : null;
  const shakeAmt = { ram: 14, wesley: 10, fire: 10, nofurther: 14, engage: 8, universe2: 8 }[hot] ?? 0;
  if (shakeAmt) ctx.translate(noise(t * 40) * shakeAmt, noise(t * 40 + 50) * shakeAmt);
  switch (sec.type) {
    case 'intro': drawIntro(sec, t); break;
    case 'ensemble': drawEnsemble(sec, t); break;
    case 'verse': drawVerse(sec, t); break;
    case 'chorus': drawChorus(sec, t, false); break;
    case 'finale': drawChorus(sec, t, true); break;
    case 'q': drawQ(sec, t); break;
    case 'borg': drawBorg(sec, t); break;
    case 'outro': drawOutro(sec, t); break;
  }
  ctx.restore();
  const fireLine = FIRE_LINE; if (fireLine && t > fireLine.start + 0.1 && t < fireLine.start + 1.2) {
    const q = (t - fireLine.start - 0.1) / 1.1; const g = ctx.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, 1400);
    g.addColorStop(0, `rgba(255,240,200,${0.8 * (1 - q)})`); g.addColorStop(0.4, `rgba(255,120,40,${0.5 * (1 - q)})`); g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // section transition flash + final fade
  const d = t - sec.start;
  if (sec !== sections[0] && sec.type !== 'ensemble' && d < 0.3) { ctx.fillStyle = `rgba(255,240,220,${0.35 * (1 - d / 0.3)})`; ctx.fillRect(0, 0, W, H); }
  const tail = TL.duration - t; if (tail < 1.5) { ctx.fillStyle = `rgba(0,0,0,${1 - tail / 1.5})`; ctx.fillRect(0, 0, W, H); }
}
window.renderFrame = renderFrame;
window.sceneReady = document.fonts.load(`600 40px Antonio`).then(() => document.fonts.ready);
})();
