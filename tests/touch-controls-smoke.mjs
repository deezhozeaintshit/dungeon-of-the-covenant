// touch-controls-smoke.mjs — Phase 4 Workstream 5 headless smoke test.
// Covers the non-DOM logic: touch detection, preference state machine,
// stick-vector mapping, camera-yaw rotation, and the optimistic cooldown
// sweep lifecycle. Zero DOM required; TouchControlsManager gets stub envs.
import {
  TOUCH_PREF_KEY,
  detectTouchSupport,
  resolveTouchActive,
  computeStickVector,
  rotateInputByCameraYaw,
  TouchControlsManager
} from '../client/js/ui/touchControls.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) failures++;
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---------- 1. touch detection ----------
check('detect: ontouchstart in window', detectTouchSupport({ ontouchstart: null }, {}) === true);
check('detect: maxTouchPoints > 0', detectTouchSupport({}, { maxTouchPoints: 2 }) === true);
check('detect: maxTouchPoints = 0', detectTouchSupport({}, { maxTouchPoints: 0 }) === false);
check('detect: msMaxTouchPoints legacy', detectTouchSupport({}, { msMaxTouchPoints: 1 }) === true);
check('detect: plain desktop', detectTouchSupport({}, {}) === false);
check('detect: no env at all', detectTouchSupport(null, null) === false);

// ---------- 2. preference state machine ----------
check('auto + detected => active', resolveTouchActive('auto', true) === true);
check('auto + not detected => inactive', resolveTouchActive('auto', false) === false);
check('on overrides detection (false)', resolveTouchActive('on', false) === true);
check('off overrides detection (true)', resolveTouchActive('off', true) === false);
check('garbage pref falls back to auto', resolveTouchActive('bogus', true) === true);
check('garbage pref falls back to auto (no touch)', resolveTouchActive('bogus', false) === false);

// ---------- 3. stick vector mapping (mirrors GameControls.updateStick) ----------
{
  const v = computeStickVector(0, 0);
  check('stick: center => zero', v.x === 0 && v.z === 0);
  const dz = computeStickVector(4, 3); // dist 5 < dead zone 6
  check('stick: inside dead zone => zero', dz.x === 0 && dz.z === 0);
  const right = computeStickVector(55, 0);
  check('stick: full right => (1, 0)', approx(right.x, 1) && approx(right.z, 0));
  const down = computeStickVector(0, 55);
  check('stick: full down => (0, 1)', approx(down.x, 0) && approx(down.z, 1), JSON.stringify(down));
  const half = computeStickVector(27.5, 0);
  check('stick: half deflection => 0.5', approx(half.x, 0.5) && approx(half.z, 0));
  const clamp = computeStickVector(200, 0);
  check('stick: beyond radius clamps to 1', approx(clamp.x, 1) && approx(clamp.z, 0), JSON.stringify(clamp));
  const diag = computeStickVector(55, 55); // clamped to radius at 45deg
  const m = Math.hypot(diag.x, diag.z);
  check('stick: diagonal clamped to unit circle', approx(m, 1, 1e-6), JSON.stringify(diag));
}

// ---------- 4. camera-yaw rotation (mirrors GameControls.update) ----------
{
  const fwd = rotateInputByCameraYaw(0, -1, 0);
  check('yaw 0: stick-up => world -z', approx(fwd.x, 0) && approx(fwd.z, -1));
  const yaw90 = rotateInputByCameraYaw(0, -1, Math.PI / 2);
  check('yaw 90deg: stick-up => world -x', approx(yaw90.x, -1) && approx(yaw90.z, 0), JSON.stringify(yaw90));
  const yaw180 = rotateInputByCameraYaw(1, 0, Math.PI);
  check('yaw 180deg: stick-right => world -x', approx(yaw180.x, -1) && approx(yaw180.z, 0), JSON.stringify(yaw180));
  const mag = rotateInputByCameraYaw(0.6, 0.8, 1.234);
  check('yaw: rotation preserves magnitude', approx(Math.hypot(mag.x, mag.z), 1));
}

// ---------- 5. manager: preference persistence + body class ----------
function stubEnv() {
  const toggled = {};
  const store = new Map();
  const elements = new Map();
  return {
    toggled,
    store,
    elements,
    env: {
      win: {},
      nav: { maxTouchPoints: 0 },
      doc: {
        body: { classList: { toggle: (cls, on) => { toggled[cls] = !!on; } } },
        getElementById: (id) => {
          if (!elements.has(id)) elements.set(id, { style: {}, textContent: '' });
          return elements.get(id);
        }
      },
      storage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); }
      }
    }
  };
}
{
  const s = stubEnv();
  const m = new TouchControlsManager(s.env);
  m.init();
  check('manager: auto + no touch => inactive', m.isActive() === false);
  check('manager: body class reflects inactive', s.toggled['touch-active'] === false);

  m.setPreference('on');
  check('manager: forced on => active', m.isActive() === true);
  check('manager: body class reflects active', s.toggled['touch-active'] === true);
  check('manager: pref persisted', s.store.get(TOUCH_PREF_KEY) === 'on');

  m.setPreference('off');
  check('manager: forced off => inactive', m.isActive() === false);

  const bad = m.setPreference('bogus');
  check('manager: invalid pref rejected', bad === 'off');

  // fresh manager reads persisted pref
  const m2 = new TouchControlsManager({ ...s.env, nav: { maxTouchPoints: 4 } });
  s.store.set(TOUCH_PREF_KEY, 'off');
  m2.init();
  check('manager: persisted off wins over detection', m2.isActive() === false);
  s.store.set(TOUCH_PREF_KEY, 'auto');
  const m3 = new TouchControlsManager(s.env);
  m3.nav = { maxTouchPoints: 4 };
  m3.init();
  check('manager: persisted auto + detected => active', m3.isActive() === true);
}

// ---------- 6. manager: optimistic cooldown sweeps ----------
{
  const s = stubEnv();
  const m = new TouchControlsManager(s.env);
  m.init();
  m.setPreference('on');

  check('markActionFired unknown action => false', m.markActionFired('nope', 1000) === false);
  check('markActionFired skill1 => true', m.markActionFired('skill1', 1000) === true);
  const el = s.elements.get('skill-1-cd');
  check('sweep starts full', el.style.height === '100%', el.style.height);
  check('sweep shows seconds', el.textContent === '6.0s', JSON.stringify(el.textContent));

  m.tick(4000); // 3s elapsed of 6s fallback max
  check('sweep mid-way ~50%', el.style.height === '50%', el.style.height);
  check('sweep text counts down', el.textContent === '3.0s', JSON.stringify(el.textContent));

  m.tick(8000); // past the end
  check('sweep clears at end', el.style.height === '0%' && el.textContent === '' && m.pending.size === 0);

  // server observation learns real maxima
  m.observeServerCooldowns({ skill1: 4.5, skill2: 9.0, skill3: 12.0, dash: 3.0, attack: 0.5, jump: 0.65 });
  check('observed max does not shrink below seen', m.maxCooldowns.skill1 === 6.0); // fallback 6.0 > 4.5
  m.observeServerCooldowns({ skill2: 11.0 });
  check('observed max grows on larger server value', m.maxCooldowns.skill2 === 11.0);
  m.markActionFired('skill2', 10000);
  const el2 = s.elements.get('skill-2-cd');
  check('sweep uses learned max', el2.textContent === '11.0s', JSON.stringify(el2.textContent));

  // inert when touch layer off
  m.setPreference('off');
  check('markActionFired while off => false', m.markActionFired('skill1', 20000) === false);
}

console.log(failures === 0 ? 'ALL TOUCH-CONTROLS SMOKE TESTS PASSED' : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
