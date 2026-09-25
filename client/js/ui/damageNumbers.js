// ui/damageNumbers.js — pooled 2D floating damage numbers on a fullscreen
// canvas overlay (#damage-numbers-canvas). Spawns take world coordinates;
// pass a projectToScreen(worldPos) -> {x, y} fn at init (e.g. camera
// projection from the renderer). Without a projector, coords are treated
// as screen pixels. Zero per-spawn allocation: fixed-size pool.

const TYPE_STYLE = {
  phys:  { color: '#ffffff', size: 15, weight: 700 },
  crit:  { color: '#ffd700', size: 24, weight: 900 },
  magic: { color: '#b3a6ff', size: 16, weight: 800 },
  fire:  { color: '#ff9a3c', size: 17, weight: 800 },
  frost: { color: '#9adcff', size: 16, weight: 800 },
  poison:{ color: '#a3e635', size: 15, weight: 700 },
  heal:  { color: '#34d399', size: 16, weight: 800, prefix: '+' },
  miss:  { color: '#9aa3b2', size: 13, weight: 600 },
  dot:   { color: '#e0aaff', size: 13, weight: 700 },
};

const POOL_SIZE = 64;
const GRAVITY = -34; // px/s^2 upward drift assist
const RISE = -62;    // initial upward velocity px/s

export function initDamageNumbers({ projectToScreen = null } = {}) {
  const canvas = document.getElementById('damage-numbers-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const state = {
    enabled: true,
    pool: [],
    running: false,
    raf: 0,
    lastT: 0,
    dpr: Math.min(2, window.devicePixelRatio || 1),
  };

  for (let i = 0; i < POOL_SIZE; i++) {
    state.pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, text: '', style: TYPE_STYLE.phys });
  }

  function resize() {
    if (!canvas) return;
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * state.dpr);
    canvas.height = Math.floor(window.innerHeight * state.dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  }
  window.addEventListener('resize', resize);
  resize();

  function frame(now) {
    if (!state.running) return;
    const dt = Math.min(0.05, (now - state.lastT) / 1000 || 0.016);
    state.lastT = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(state.dpr, state.dpr);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const p of state.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += GRAVITY * dt * 0.35;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.life / p.maxLife; // 1 -> 0
      const alpha = t < 0.35 ? t / 0.35 : 1;
      const pop = p.life > p.maxLife - 0.12 ? 1 + (p.maxLife - p.life) * 2.2 : 1;
      const size = p.style.size * pop;
      ctx.globalAlpha = alpha;
      ctx.font = `${p.style.weight} ${size}px Inter, system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,2,10,0.9)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.style.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    state.raf = requestAnimationFrame(frame);
  }

  function ensureLoop() {
    if (!state.running && ctx) {
      state.running = true;
      state.lastT = performance.now();
      state.raf = requestAnimationFrame(frame);
    }
  }

  const api = {
    setEnabled(v) { state.enabled = !!v; },
    isEnabled() { return state.enabled; },
    setProjector(fn) { projectToScreen = fn; },

    // world: {x, y, z} or {x, y} world coords; amount: number|string
    // type: phys|crit|magic|fire|frost|poison|heal|miss|dot
    spawn(world, amount, type = 'phys') {
      if (!state.enabled || !ctx || amount == null) return;
      let sx, sy;
      if (typeof projectToScreen === 'function') {
        const s = projectToScreen(world);
        if (!s) return;
        sx = s.x; sy = s.y;
      } else {
        sx = world.x; sy = world.y;
      }
      if (sx < -50 || sy < -50 || sx > window.innerWidth + 50 || sy > window.innerHeight + 50) return;

      const style = TYPE_STYLE[type] || TYPE_STYLE.phys;
      let slot = state.pool.find(p => !p.active);
      if (!slot) slot = state.pool[0]; // steal oldest slot
      const jitter = () => (Math.random() - 0.5) * 26;
      slot.active = true;
      slot.x = sx + jitter();
      slot.y = sy - 10 + jitter() * 0.5;
      slot.vx = (Math.random() - 0.5) * 22;
      slot.vy = RISE * (0.85 + Math.random() * 0.3);
      slot.maxLife = type === 'crit' ? 1.25 : 0.95;
      slot.life = slot.maxLife;
      const n = typeof amount === 'number' ? Math.round(amount) : amount;
      slot.text = `${style.prefix || ''}${typeof n === 'number' ? n.toLocaleString() : n}`;
      slot.style = style;
      ensureLoop();
    },

    clear() { for (const p of state.pool) p.active = false; },

    destroy() {
      state.running = false;
      cancelAnimationFrame(state.raf);
      window.removeEventListener('resize', resize);
    },
  };

  return api;
}

export default { initDamageNumbers };
