// Demo «Tinta viva»: la novela como red de tinta 3D suspendida en agua.
// three.js proyecta los nodos en 3D; un shader a pantalla completa pinta la tinta.
// Las etiquetas son botones DOM reales, para que sigan siendo nítidas y accesibles.
import {
  Euler, Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene,
  ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderer
} from 'three';

const MAX_N = 16;
const MAX_E = 24;
const rgb = (h) => new Vector3(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const PIG = { cap: rgb('#12141C'), per: rgb('#1A2A86'), lug: rgb('#0F5C60'), lor: rgb('#4B2A5E'), conflict: rgb('#B4490B') };

const NODES = [
  { id: 'cap1', short: 'Cap. 1', name: 'Cap. 1 · El regreso', t: 'cap', type: 'Capítulo', p: [-0.98, -0.34, 0.12], r: 0.03, sum: 'Marta vuelve a Puerto Viejo y encuentra una carta sin firmar.', q: 'Sobre la mesa, alguien había dejado una carta sin firmar.' },
  { id: 'cap2', short: 'Cap. 2', name: 'Cap. 2 · Los ojos de su madre', t: 'cap', type: 'Capítulo', p: [-0.32, -0.08, -0.28], r: 0.03, sum: 'Tomás y Marta se reencuentran en el faro.', q: 'Al verla pensó que Marta tenía los ojos verdes de su madre.' },
  { id: 'cap3', short: 'Cap. 3', name: 'Cap. 3 · La consulta', t: 'cap', type: 'Capítulo', p: [0.34, 0.1, 0.22], r: 0.03, sum: 'Inés lleva a la consulta una segunda carta.', q: 'Inés dejó sobre la camilla otra carta, con la misma letra que la primera.' },
  { id: 'cap4', short: 'Cap. 4', name: 'Cap. 4 · Jueves de veda', t: 'cap', type: 'Capítulo', p: [1.0, 0.36, -0.12], r: 0.033, sum: 'Marta decide enseñarle la carta a Tomás.', q: 'Ya no habrá vuelta atrás.' },
  { id: 'marta', short: 'Marta', name: 'Marta Rey', t: 'per', conflict: true, type: 'Personaje', p: [-0.42, 0.72, 0.36], r: 0.042, sum: 'Médica y hermana de Tomás. Vuelve a Puerto Viejo en el capítulo 1.', q: 'Marta nunca perdonó a Tomás que vendiera la barca de su padre.', issue: 'Por resolver: ojos verdes en el capítulo 2, marrones en el 4.' },
  { id: 'tomas', short: 'Tomás', name: 'Tomás', t: 'per', type: 'Personaje', p: [0.42, 0.84, -0.3], r: 0.036, sum: 'Hermano de Marta. Vendió la barca de su padre.', q: '—Este año la veda empieza el martes —dijo Tomás.' },
  { id: 'ines', short: 'Inés', name: 'Inés Cabrera', t: 'per', type: 'Personaje', p: [0.8, -0.46, 0.42], r: 0.036, sum: 'Patrona del único barco que sigue faenando.', q: 'Patrona del único barco que seguía faenando.' },
  { id: 'puerto', short: 'Puerto Viejo', name: 'Puerto Viejo', t: 'lug', type: 'Lugar', p: [-1.02, 0.42, -0.42], r: 0.036, sum: 'El pueblo al que vuelve Marta.', q: 'Marta Rey bajó del autobús en Puerto Viejo con una sola maleta.' },
  { id: 'sal', short: 'Calle de la Sal', name: 'Calle de la Sal', t: 'lug', type: 'Lugar', p: [-0.62, -0.7, 0.3], r: 0.028, sum: 'Donde Marta tiene la consulta.', q: 'Nadie la esperaba en la calle de la Sal, y lo agradeció.' },
  { id: 'faro', short: 'Faro', name: 'Faro de la Punta', t: 'lug', type: 'Lugar', p: [0.02, -0.68, -0.4], r: 0.03, sum: 'Escenario de los encuentros entre Marta y Tomás.', q: 'Tomás, su hermano, la encontró en el faro de la Punta.' },
  { id: 'carta', short: 'La carta', name: 'La carta sin firmar', t: 'lor', type: 'Lore', p: [-0.1, 0.34, 0.72], r: 0.028, sum: 'Dos cartas con la misma letra. Quién las escribe sigue sin saberse.', q: 'Alguien había dejado una carta sin firmar.' },
  { id: 'veda', short: 'La veda', name: 'La veda', t: 'lor', conflict: true, type: 'Lore', p: [0.98, -0.02, -0.56], r: 0.028, sum: 'Periodo en que no se puede faenar.', q: 'El jueves empezaba la veda.', issue: 'Por resolver: empieza el martes en el capítulo 2 y el jueves en el 4.' }
];
const LINKS = [
  ['cap1', 'cap2', 1.5], ['cap2', 'cap3', 1.5], ['cap3', 'cap4', 1.5],
  ['cap1', 'marta'], ['cap1', 'puerto'], ['puerto', 'sal'], ['cap1', 'carta'], ['cap2', 'tomas'], ['cap2', 'faro'],
  ['cap2', 'veda'], ['cap3', 'ines'], ['marta', 'tomas'], ['marta', 'ines'], ['puerto', 'faro'], ['carta', 'cap3'], ['veda', 'ines']
];
const NEW_NODE = { id: 'julian', short: 'Julián', name: 'Julián', t: 'per', type: 'Personaje · por confirmar', p: [0.42, -0.2, 0.86], r: 0.034, sum: 'Ficha creada a partir de lo que has escrito.', q: 'Habló con Julián antes de que amaneciera.' };
const NEW_LINKS = [['ines', 'julian'], ['cap4', 'julian']];

const TASKS = [
  { kind: 'Resolver', min: '5 min', html: 'El <button data-open="cap4">capítulo 4</button> dice jueves y el <button data-open="cap2">capítulo 2</button> dice martes. ¿Cuándo empieza la <span class="nb"><button data-open="veda">veda</button>?</span>', why: 'Te lo propongo porque lo que ocurra después depende de esa fecha.', open: 'veda' },
  { kind: 'Definir', min: '10 min', html: '¿Qué teme <button data-open="marta">Marta</button> y no le contaría a nadie?', why: 'En el capítulo 4 piensa que «ya no habrá vuelta atrás» y aún no sabemos qué perdería.', open: 'marta' },
  { kind: 'Escribir', min: '15 min', html: 'Unas 200 palabras: <button data-open="ines">Inés</button> explica cómo llegó a sus manos la <button data-open="carta">segunda carta</button>.', why: 'Esa carta aparece en el capítulo 3 y no has vuelto a ella.', open: 'carta' }
];
const lk = (id, text) => `<button type="button" class="link" data-open="${id}">${text}</button>`;
const CARDS = () => [
  { title: 'Capítulos', items: [lk('cap1', 'El regreso'), lk('cap2', 'Los ojos de su madre'), lk('cap3', 'La consulta'), lk('cap4', 'Jueves de veda') + ' · en curso'] },
  { title: 'Personajes', items: nodes.filter((n) => n.t === 'per').map((n) => lk(n.id, n.name)), id: 'personajes' },
  { title: 'Relaciones', items: [`${lk('marta', 'Marta')} y ${lk('tomas', 'Tomás')}: hermanos`, `${lk('marta', 'Marta')} e ${lk('ines', 'Inés')}: médica y paciente`] },
  { title: 'Lugares', items: [`${lk('puerto', 'Puerto Viejo')} · 4 sugerencias`, lk('sal', 'Calle de la Sal'), lk('faro', 'Faro de la Punta')] },
  { title: 'Nombres', items: [lk('sal', 'Calle de la Sal'), lk('faro', 'Faro de la Punta'), lk('ines', 'Inés Cabrera'), lk('marta', 'Marta Rey')] },
  { title: 'Lore', items: [lk('carta', 'La carta sin firmar'), lk('veda', 'La veda')] },
  { title: 'Cronología', items: [`${lk('cap1', 'Cap. 1')}: regreso de Marta`, `${lk('cap2', 'Cap. 2')}: la veda se anuncia para el martes`, `${lk('cap4', 'Cap. 4')}: la veda empieza el jueves`] },
  { title: 'Verificación de datos', alert: true, items: [lk('marta', 'Ojos de Marta: ¿verdes o marrones?'), lk('veda', 'Inicio de la veda: ¿martes o jueves?')] },
  { title: 'Documentación', items: [`${lk('marta', 'Marta Rey')} · médica rural · 2`, `${lk('veda', 'La veda')} · veda de pesca · 2`, `${lk('faro', 'Faro')} · faros y fareros · 1`] },
  { title: 'Ayuda', noCount: true, items: ['<button type="button" class="link" data-focus-levels>Regular las pistas</button>', lk('cap4', 'Volver a lo último que escribiste')] }
];

const $ = (s) => document.querySelector(s);
const hero = $('#hero');
const canvas = $('#ink');
const labels = $('#labels');
const next = $('#next');
const grid = $('#grid');
const sheet = $('#sheet');
const live = $('#live');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let nodes = [];
let edges = [];
let taskIdx = 0;
let level = 'soft';
let lastFocus = null;

function addNode(d, t0) {
  const n = Object.assign({}, d, { grow: 0, t0, ink: 1, inkT: 1, sx: 0, sy: 0, depth: 1, phase: nodes.length * 1.7 });
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'node' + (d.t === 'cap' ? ' cap' : '') + (d.conflict ? ' conflict' : '');
  b.textContent = d.short;
  b.setAttribute('aria-label', `Abrir ficha: ${d.name}`);
  b.addEventListener('pointerenter', () => setActive(d.id));
  b.addEventListener('pointerleave', () => setActive(null));
  b.addEventListener('focus', () => setActive(d.id));
  b.addEventListener('blur', () => setActive(null));
  b.addEventListener('click', () => openSheet(d.id, b));
  labels.appendChild(b);
  n.el = b;
  n.lw = 0;
  nodes.push(n);
  return n;
}
function addEdge(a, b, w, t0) {
  edges.push({ a: nodes.find((n) => n.id === a), b: nodes.find((n) => n.id === b), w: w || 1, t0, grow: 0, ink: 1, inkT: 1, seed: edges.length * 2.3 });
}

function layoutFromGraph() {
  const adj = {};
  LINKS.forEach(([a, b]) => { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); });
  const depth = { cap1: 0 };
  const queue = ['cap1'];
  while (queue.length) {
    const c = queue.shift();
    (adj[c] || []).forEach((n) => { if (depth[n] === undefined) { depth[n] = depth[c] + 1; queue.push(n); } });
  }
  NODES.forEach((d) => addNode(d, 0.25 + depth[d.id] * 0.62));
  LINKS.forEach(([a, b, w]) => {
    const swap = depth[a] > depth[b];
    addEdge(swap ? b : a, swap ? a : b, w, 0.25 + Math.min(depth[a], depth[b]) * 0.62);
  });
}

function setActive(id) {
  const near = new Set();
  if (id) { near.add(id); edges.forEach((e) => { if (e.a.id === id) near.add(e.b.id); if (e.b.id === id) near.add(e.a.id); }); }
  nodes.forEach((n) => { n.inkT = !id ? 1 : n.id === id ? 1.5 : near.has(n.id) ? 1.05 : 0.38; });
  edges.forEach((e) => { e.inkT = !id ? 1 : (e.a.id === id || e.b.id === id) ? 1.8 : 0.3; });
  requestFrame();
}

function renderNext() {
  if (level === 'off') {
    next.innerHTML = `<h1>Sin tareas. Solo tú y el texto.</h1><p>Las pistas están apagadas. Las fichas se siguen actualizando.</p><div class="actions"><button type="button" class="btn main" data-level="soft">Activar las pistas</button></div>`;
  } else {
    const t = TASKS[taskIdx % TASKS.length];
    next.innerHTML = `<div class="kicker">Siguiente paso · ${t.kind} · ${t.min}</div><h1>${t.html.replaceAll('<button ', '<button type="button" ')}</h1><p>${t.why}</p><div class="actions"><button type="button" class="btn main" data-open="${t.open}">Hacerlo</button><button type="button" class="btn" data-skip>Esta no me sirve</button><button type="button" class="btn" data-level="off">Hoy solo quiero escribir</button></div>`;
  }
}
function renderLevels() {
  const L = [['off', 'Apagadas'], ['ask', 'Si las pido'], ['soft', 'Discretas'], ['buddy', 'Compañera']];
  $('#levels').innerHTML = L.map(([id, t]) => `<button type="button" aria-pressed="${level === id}" data-level="${id}">${t}</button>`).join('');
}
function renderCards() {
  grid.innerHTML = CARDS().map((c) => `<section class="card${c.alert ? ' alert' : ''}"><header><h3>${c.title}</h3><span class="count">${c.noCount ? '' : c.items.length}</span></header><ul>${c.items.map((i) => `<li>${i}</li>`).join('')}</ul></section>`).join('');
  const cards = [...grid.children];
  if (reduced || !('IntersectionObserver' in window)) { cards.forEach((c) => c.classList.add('in')); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.08 });
  cards.forEach((c, i) => { c.style.transitionDelay = `${(i % 5) * 60}ms`; io.observe(c); });
}
function linksOf(id) {
  return edges.filter((e) => e.a.id === id || e.b.id === id).map((e) => (e.a.id === id ? e.b : e.a));
}
function showSheet(id) {
  const n = nodes.find((x) => x.id === id);
  sheet.innerHTML = `<button type="button" class="close" aria-label="Cerrar" data-close>×</button><div class="type">${n.type}</div><h2 id="sheet-title">${n.name}</h2><p>${n.sum}</p>${n.issue ? `<div class="issue">${n.issue}</div>` : ''}<blockquote>«${n.q}»<cite>Lo que has escrito</cite></blockquote><h3>Enlaces</h3><div class="chips">${linksOf(id).map((l) => `<button type="button" data-open="${l.id}">${l.short}</button>`).join('')}</div>`;
  if (!sheet.open) sheet.showModal();
}
function openSheet(id, from) {
  lastFocus = from || document.activeElement;
  if (reduced || sheet.open || !gl) { showSheet(id); return; }
  const n = nodes.find((x) => x.id === id);
  flood = { x: n.sx, y: n.sy, start: performance.now(), id };
  requestFrame();
}
sheet.addEventListener('close', () => { if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); setActive(null); });

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (ev.target === sheet) { sheet.close(); return; }
  if (!t) return;
  if (t.dataset.open) openSheet(t.dataset.open, t);
  else if (t.dataset.level) { level = t.dataset.level; renderLevels(); renderNext(); }
  else if ('skip' in t.dataset) { taskIdx += 1; renderNext(); }
  else if ('close' in t.dataset) sheet.close();
  else if ('focusLevels' in t.dataset) { window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); $('#levels button').focus({ preventScroll: true }); }
});

$('#grow').addEventListener('click', (ev) => {
  const t0 = clock + 0.1;
  addNode(NEW_NODE, t0 + 0.6);
  NEW_LINKS.forEach(([a, b]) => addEdge(a, b, 1, t0));
  ev.currentTarget.disabled = true;
  ev.currentTarget.textContent = 'Ficha nueva: Julián';
  live.textContent = 'Nueva ficha creada: Julián';
  renderCards();
  grid.querySelectorAll('.card').forEach((c) => c.classList.add('in'));
  if (reduced) { nodes.concat(edges).forEach((x) => { x.grow = 1; }); }
  layout();
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  requestFrame();
});

// ---------- WebGL ----------
const vert = 'void main(){gl_Position=vec4(position.xy,0.,1.);}';
const frag = `
precision highp float;
#define MAX_N ${MAX_N}
#define MAX_E ${MAX_E}
uniform vec2 uRes; uniform float uTime; uniform int uNn; uniform int uEn;
uniform vec4 uN[MAX_N]; uniform vec3 uC[MAX_N];
uniform vec4 uE[MAX_E]; uniform vec3 uP[MAX_E];
uniform vec4 uFade; uniform vec3 uFlood; uniform float uW;
const vec3 PAPER=vec3(.965,.965,.949);
const vec3 INK=vec3(.071,.078,.11);
float hash(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+34.23);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(11.3,7.1);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;
  float t=uTime;
  vec2 w1=vec2(fbm(p*3.1+vec2(0.,t*.035)),fbm(p*3.1+vec2(5.2,1.3-t*.03)));
  vec2 q=p+(w1-.47)*.085;
  vec2 q2=p+(vec2(fbm(q*7.+t*.02),fbm(q*7.+vec2(3.1,8.4)-t*.02))-.47)*.035+(w1-.47)*.13;
  float core=0.,halo=0.; vec3 pig=vec3(0.);
  for(int i=0;i<uNn;i++){
    vec2 d=q2-uN[i].xy; float r=uN[i].z; float k=uN[i].w;
    float g=k*exp(-dot(d,d)/(r*r));
    vec2 d2=q-uN[i].xy; float R=r*3.4;
    float h=k*exp(-dot(d2,d2)/(R*R));
    core+=g; halo+=h; pig+=uC[i]*(g*1.6+h*.5);
  }
  for(int i=0;i<uEn;i++){
    vec2 a=uE[i].xy,b=uE[i].zw; vec2 pa=q-a,ba=b-a;
    float gr=uP[i].x; if(gr<=.001)continue;
    float s=clamp(dot(pa,ba)/dot(ba,ba),0.,gr);
    float dd=length(pa-ba*s);
    float wob=noise(vec2(s*7.+uP[i].z,uP[i].z*3.));
    float wd=(.0026+.0052*wob)*uP[i].y*uW;
    float tip=smoothstep(0.,.06,gr-s+.03);
    float g=uP[i].y*exp(-dd*dd/(wd*wd))*tip*(.5+.5*wob);
    float h=.2*uP[i].y*exp(-dd*dd/(wd*wd*34.))*tip;
    core+=g; halo+=h; pig+=INK*(g*1.6+h*.5);
  }
  float total=core*1.6+halo*.5;
  vec3 colr=total>.0005?pig/total:INK;
  float cloud=fbm(q*5.5+t*.015);
  float wash=(1.-exp(-halo*1.1))*(.25+.75*smoothstep(.33,.72,cloud))*.42;
  float body=smoothstep(.1,1.05,1.-exp(-core*2.1));
  float tide=smoothstep(.09,0.,abs(body-.3))*.12*step(.0,body);
  float a=clamp(wash+body+tide,0.,1.);
  a*=.93+.07*noise(gl_FragCoord.xy*.55);
  a*=smoothstep(uFade.x,uFade.y,uv.x)*smoothstep(uFade.z,uFade.w,1.-uv.y)*smoothstep(0.,.13,uv.y);
  vec3 c=mix(PAPER,colr,a);
  if(uFlood.z>0.){
    float fl=smoothstep(uFlood.z,uFlood.z-.14,length(q2-uFlood.xy));
    c=mix(c,INK,fl);
  }
  gl_FragColor=vec4(c,1.);
}`;

let gl = null;
let uniforms = null;
let scene = null;
let quad = null;
const projector = new PerspectiveCamera(30, 1, 0.1, 20);
projector.position.set(0, 0, 4);
projector.lookAt(0, 0, 0);
projector.updateMatrixWorld();
projector.updateProjectionMatrix();

let W = 1;
let H = 1;
let cx = 0;
let cy = 0;
let S = 1;
let pr = Math.min(window.devicePixelRatio || 1, 1) * 0.85;
function initGL() {
  try {
    gl = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  } catch (e) {
    gl = null;
    document.documentElement.classList.add('no-webgl');
    return;
  }
  uniforms = {
    uRes: { value: new Vector2(1, 1) }, uTime: { value: 0 }, uNn: { value: 0 }, uEn: { value: 0 },
    uN: { value: Array.from({ length: MAX_N }, () => new Vector4()) },
    uC: { value: Array.from({ length: MAX_N }, () => new Vector3()) },
    uE: { value: Array.from({ length: MAX_E }, () => new Vector4()) },
    uP: { value: Array.from({ length: MAX_E }, () => new Vector3()) },
    uFade: { value: new Vector4(0, 0, 0, 0) },
    uFlood: { value: new Vector3() },
    uW: { value: 1 }
  };
  scene = new Scene();
  quad = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  scene.add(quad);
}
const cam2 = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

function layout() {
  W = hero.clientWidth;
  H = hero.clientHeight;
  if (gl) {
    gl.setPixelRatio(pr);
    gl.setSize(W, H, false);
    gl.getDrawingBufferSize(uniforms.uRes.value);
  }
  if (W >= 760) {
    cx = W * 0.665;
    cy = H * 0.5;
    S = Math.min(W * 0.27, H * 0.43);
    if (uniforms) uniforms.uFade.value.set(0.3, 0.47, 0, 0.02);
  } else {
    const bottom = next.offsetTop + next.offsetHeight - 400;
    cx = W * 0.5;
    cy = (bottom + H) / 2;
    S = Math.min(W * 0.34, (H - bottom) * 0.38);
    if (uniforms) uniforms.uFade.value.set(-1, -0.5, (bottom - 20) / H, (bottom + 40) / H);
  }
  nodes.forEach((n) => { n.lw = n.el.offsetWidth; });
  requestFrame();
}

const euler = new Euler();
const v = new Vector3();
let mx = 0;
let my = 0;
let smx = 0;
let smy = 0;
window.addEventListener('pointermove', (e) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; }, { passive: true });

const ease = (x) => { const k = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - k, 3); };
let clock = reduced ? 100 : 0;
let last = performance.now();
let flood = null;
let floodOut = null;
let running = false;
let visible = true;
let frames = 0;
let frameTime = 0;

function step(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!reduced) clock += dt;
  smx += (mx - smx) * 0.05;
  smy += (my - smy) * 0.05;

  euler.set(smy * 0.28, (reduced ? 0.2 : Math.sin(clock * 0.11) * 0.42) + smx * 0.42, 0);
  const lerp = reduced ? 1 : 0.1;
  nodes.forEach((n, i) => {
    n.grow = reduced ? 1 : ease((clock - n.t0) / 0.75);
    n.ink += (n.inkT - n.ink) * lerp;
    v.set(n.p[0], n.p[1] + (reduced ? 0 : Math.sin(clock * 0.5 + n.phase) * 0.02), n.p[2]).applyEuler(euler);
    const z = v.z;
    v.project(projector);
    n.sx = cx + v.x * S * 1.07;
    n.sy = cy - v.y * S * 1.07;
    n.depth = 4 / (4 - z);
    const far = 0.72 + 0.28 * Math.min(1, Math.max(0, (z + 1) / 2));
    if (uniforms) {
      uniforms.uN.value[i].set((n.sx - W / 2) / H, (H / 2 - n.sy) / H, n.r * n.depth * (S / (H * 0.42)) * (0.3 + 0.7 * n.grow), n.ink * far * n.grow * 1.1);
      uniforms.uC.value[i].copy(n.conflict ? PIG.conflict : PIG[n.t]);
    }
    n.el.style.opacity = n.grow > 0.35 ? (0.62 + 0.38 * far).toFixed(2) : '0';
    n.lx = Math.min(W - n.lw / 2 - 8, Math.max(n.lw / 2 + 8, n.sx));
  });
  // Evita que las etiquetas se tapen: las más cercanas mandan y las demás se desplazan.
  const placed = [];
  nodes.slice().sort((a, b) => b.depth - a.depth).forEach((n) => {
    let y = n.sy + 14 * n.depth;
    let moved = true;
    for (let guard = 0; moved && guard < 6; guard += 1) {
      moved = false;
      placed.forEach((p) => {
        if (Math.abs(n.lx - p.x) < (n.lw + p.w) / 2 + 4 && Math.abs(y - p.y) < 30) { y = p.y + 30; moved = true; }
      });
    }
    if (n.grow > 0.35) placed.push({ x: n.lx, y, w: n.lw });
    n.ly = n.ly === undefined || reduced ? y : n.ly + (y - n.ly) * 0.12;
    n.el.style.transform = `translate3d(${n.lx.toFixed(1)}px,${n.ly.toFixed(1)}px,0) translateX(-50%)`;
  });
  edges.forEach((e, i) => {
    e.grow = reduced ? 1 : ease((clock - e.t0) / 0.7);
    e.ink += (e.inkT - e.ink) * lerp;
    if (uniforms) {
      uniforms.uE.value[i].set((e.a.sx - W / 2) / H, (H / 2 - e.a.sy) / H, (e.b.sx - W / 2) / H, (H / 2 - e.b.sy) / H);
      uniforms.uP.value[i].set(e.grow, e.ink * e.w, e.seed);
    }
  });

  let fl = 0;
  let fx = 0;
  let fy = 0;
  if (flood) {
    const k = (now - flood.start) / 460;
    fl = Math.pow(Math.min(1, k), 2.2) * 1.9;
    fx = flood.x;
    fy = flood.y;
    if (k >= 1) {
      showSheet(flood.id);
      floodOut = { x: fx, y: fy, start: now };
      flood = null;
    }
  } else if (floodOut) {
    const k = (now - floodOut.start) / 520;
    fl = Math.pow(1 - Math.min(1, k), 2) * 1.9;
    fx = floodOut.x;
    fy = floodOut.y;
    if (k >= 1) floodOut = null;
  }
  if (uniforms) {
    uniforms.uFlood.value.set((fx - W / 2) / H, (H / 2 - fy) / H, fl);
    uniforms.uTime.value = clock;
    uniforms.uW.value = Math.min(1, Math.max(0.5, S / (H * 0.43)));
    uniforms.uNn.value = nodes.length;
    uniforms.uEn.value = edges.length;
    gl.render(scene, cam2);
  }
}

function loop(now) {
  if (!visible) { running = false; return; }
  const t0 = performance.now();
  step(now);
  frameTime += performance.now() - t0 + Math.max(0, now - (loop.prev || now) - 17);
  loop.prev = now;
  frames += 1;
  if (frames >= 45) {
    if (frameTime / frames > 26 && pr > 0.45) { pr = Math.max(0.45, pr - 0.15); layout(); }
    frames = 0;
    frameTime = 0;
  }
  requestAnimationFrame(loop);
}
function requestFrame() {
  if (reduced || !gl) {
    requestAnimationFrame((n) => { last = n; step(n); });
    if (flood === null && floodOut === null) return;
    return;
  }
  if (!running && visible) { running = true; last = performance.now(); requestAnimationFrame(loop); }
}

function setVisible(on) {
  visible = on && !document.hidden;
  if (visible) requestFrame();
}
document.addEventListener('visibilitychange', () => setVisible(heroOn));
let heroOn = true;
new IntersectionObserver((es) => { heroOn = es[0].isIntersecting; setVisible(heroOn); }).observe(hero);
window.addEventListener('resize', layout);

initGL();
layoutFromGraph();
renderLevels();
renderNext();
renderCards();
layout();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
window.__inkDemo = { nodes: () => nodes.length, edges: () => edges.length, webgl: () => !!gl };
