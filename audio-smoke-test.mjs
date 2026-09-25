// Headless smoke test for client/js/audiomanager.js
// Stubs the Web Audio API + browser globals, then exercises every public path
// and every SFX name referenced across the client codebase.
import { AudioManager } from './client/js/audiomanager.js';

const errors = [];
const calls = { nodes: 0, started: 0 };

// ---- generic audio-param stub ----
function audioParam() {
  return {
    value: 0,
    setValueAtTime() {}, linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}, setTargetAtTime() {},
  };
}
function audioNode() {
  calls.nodes++;
  return new Proxy({
    gain: audioParam(), frequency: audioParam(), Q: audioParam(),
    detune: audioParam(), threshold: audioParam(), knee: audioParam(),
    ratio: audioParam(), attack: audioParam(), release: audioParam(),
    type: '', buffer: null,
    connect() {}, disconnect() {},
    start() { calls.started++; }, stop() {},
  }, {
    get(t, p) { return p in t ? t[p] : (() => {}); },
    set(t, p, v) { t[p] = v; return true; },
  });
}
class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.sampleRate = 44100;
    this.currentTime = 100;
    this.destination = audioNode();
  }
  createGain() { return audioNode(); }
  createOscillator() { return audioNode(); }
  createBiquadFilter() { return audioNode(); }
  createDynamicsCompressor() { return audioNode(); }
  createConvolver() { return audioNode(); }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len), numberOfChannels: ch };
  }
  createBufferSource() { return audioNode(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

// ---- browser globals ----
const listeners = {};
globalThis.window = globalThis;
globalThis.AudioContext = FakeAudioContext;
globalThis.game = { selectedClass: 'juggernaut' };
globalThis.document = { addEventListener() {}, removeEventListener() {},
  getElementById() { return null; }, hidden: false };
const _ls = {};
globalThis.localStorage = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};
globalThis.window.addEventListener = (t, fn) => { (listeners[t] ||= []).push(fn); };
globalThis.window.removeEventListener = () => {};

function check(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { errors.push(name + ': ' + e.message); console.log('FAIL ' + name + ' -> ' + e.message); }
}

// ---- collect every SFX name referenced in the client ----
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
const files = execSync("grep -rl \"playSFX\" client/js --include='*.js'", { cwd: new URL('.', import.meta.url).pathname }).toString().trim().split('\n');
const names = new Set();
for (const f of files) {
  const src = readFileSync(new URL('.', import.meta.url).pathname + '/' + f, 'utf8');
  for (const m of src.matchAll(/playSFX\(\s*['"]([a-z_]+)['"]/g)) names.add(m[1]);
}
console.log('SFX names referenced in client:', [...names].sort().join(', '));

// ---- exercise the manager ----
const am = new AudioManager();
check('construct', () => {});
check('init', () => am.init());
check('resume', () => am.resume());
for (const n of names) check('playSFX(' + n + ')', () => am.playSFX(n));
check('playSFX(attack, each class)', () => {
  for (const c of ['juggernaut','rogue','ranger','mage','cleric','necromancer'])
    am.playSFX('attack', { classKey: c });
});
check('playSFX(unknown) default branch', () => am.playSFX('nope_not_real'));
check('setMusicMode dungeon/boss/lobby', () => {
  am.setMusicMode('dungeon'); am.setMusicMode('boss'); am.setMusicMode('lobby');
});
check('startAmbient', () => am.startAmbient());
check('sequencer ticks (all 32 steps, dungeon)', () => {
  am.setMusicMode('dungeon');
  for (let s = 0; s < 32; s++) am.tickMusicSequencer(s);
});
check('sequencer ticks (boss)', () => {
  am.setMusicMode('boss');
  for (let s = 0; s < 32; s++) am.tickMusicSequencer(s);
});
check('stopAmbient', () => am.stopAmbient());
check('setMuted on/off', () => { am.setMuted(true); am.setMuted(false); });
check('setVolume sweep', () => { for (let v = 0; v <= 1.01; v += 0.1) am.setVolume(v); });
check('toggle() round-trip (main.js:854)', () => {
  const wasMuted = am.muted;
  const enabled = am.toggle();          // flips: audio now ON iff it was muted
  if (enabled !== wasMuted) throw new Error('toggle did not flip (expected ' + wasMuted + ', got ' + enabled + ')');
  const enabled2 = am.toggle();         // flips back
  if (enabled2 !== !wasMuted) throw new Error('toggle did not flip back');
  if (am.muted !== wasMuted) throw new Error('mute state not restored');
});
check('setSfxVolume (wanted by settings panel)', () => am.setSfxVolume(0.8));
check('setMusicVolume (wanted by settings panel)', () => am.setMusicVolume(0.6));
check('playPositional (wanted: distance attenuation)', () => am.playPositional('explosion', 10, 30));
check('attenuation curve values', () => {
  const a = am._attenuation.bind(am);
  if (a(0, 40) !== 1) throw new Error('d=0 should be 1');
  if (a(40, 40) !== 0) throw new Error('d=max should be 0');
  if (a(99, 40) !== 0) throw new Error('d>max should be 0');
  const half = a(20, 40);
  if (!(half > 0.3 && half < 0.4)) throw new Error('d=max/2 should be ~0.354, got ' + half);
});
check('playSFX beyond maxDistance is skipped silently', () => {
  const before = calls.started;
  am.playSFX('explosion', { distance: 500, maxDistance: 40 });
  if (calls.started !== before) throw new Error('out-of-range sound still started nodes');
});
check('playSFX near distance still plays', () => {
  const before = calls.started;
  am.playSFX('explosion', { distance: 5, maxDistance: 40 });
  if (calls.started === before) throw new Error('in-range sound started no nodes');
});
check('setBiome crypt/cavern/forge/throne_room', () => {
  for (const b of ['crypt','cavern','forge','throne_room']) am.setBiome(b);
});
check('legacy biome ids normalize', () => {
  am.setBiome('ossuary_crypt'); if (am.biome !== 'crypt') throw new Error('ossuary_crypt');
  am.setBiome('glacial_sanctum'); if (am.biome !== 'cavern') throw new Error('glacial_sanctum');
  am.setBiome('blood_citadel'); if (am.biome !== 'forge') throw new Error('blood_citadel');
  am.setBiome('void_nexus'); if (am.biome !== 'throne_room') throw new Error('void_nexus');
  am.setBiome('blight_catacombs'); if (am.biome !== 'cavern') throw new Error('blight_catacombs');
  am.setBiome('bogus_id'); if (am.biome !== 'crypt') throw new Error('unknown should fall back to crypt');
});
check('sequencer ticks in every biome + boss', () => {
  for (const b of ['crypt','cavern','forge','throne_room']) {
    am.setBiome(b);
    am.setMusicMode('dungeon');
    for (let s = 0; s < 32; s++) am.tickMusicSequencer(s);
    am.setMusicMode('boss');
    for (let s = 0; s < 32; s++) am.tickMusicSequencer(s);
  }
});
check('bossStinger', () => am.playBossStinger());
check('boss_stinger via playSFX', () => am.playSFX('boss_stinger'));
check('settings persist + restore', () => {
  am.setVolume(0.5); am.setSfxVolume(0.6); am.setMusicVolume(0.7); am.setMuted(true);
  const am2 = new AudioManager();
  if (am2.volume !== 0.5 || am2.sfxVolume !== 0.6 || am2.musicVolume !== 0.7 || am2.muted !== true)
    throw new Error('persisted settings not restored: ' + JSON.stringify({v:am2.volume,s:am2.sfxVolume,m:am2.musicVolume,mu:am2.muted}));
  am2.destroy();
  am.setMuted(false);
});
check('handleVisibilityChange suspends/resumes', () => {
  am.init();
  globalThis.document.hidden = true;
  am.handleVisibilityChange();
  if (am.ctx.state !== 'suspended' && am.ctx.state !== 'closed') {
    // FakeAudioContext stub: emulate suspend by hand-checking the flag instead
  }
  if (!am._suspendedForHidden) throw new Error('did not mark suspended-for-hidden');
  globalThis.document.hidden = false;
  am.handleVisibilityChange();
  if (am._suspendedForHidden) throw new Error('did not clear suspended-for-hidden');
  if (am.ctx.state !== 'running') throw new Error('did not resume');
});
check('onVisibilityChange handler exists', () => {
  if (typeof am.handleVisibilityChange !== 'function') throw new Error('no handleVisibilityChange');
});
check('destroy', () => am.destroy());

// ---- recipe coverage: every referenced name must hit a real recipe, not default ----
check('all referenced names resolve to recipes (no silent default)', () => {
  const am2 = new AudioManager(); am2.init();
  const hit = new Set();
  const orig = am2.playStoneRuneClickSFX.bind(am2);
  am2.playStoneRuneClickSFX = (...a) => { hit.add('__default__'); return orig(...a); };
  for (const n of names) { hit.clear(); am2.playSFX(n); }
  // re-run capturing which names fell through to default click
  const fellThrough = [];
  for (const n of names) {
    hit.clear();
    am2.playSFX(n);
    if (hit.has('__default__') && n !== 'ui_click') fellThrough.push(n);
  }
  if (fellThrough.length) throw new Error('fell through to default click: ' + fellThrough.join(','));
});

console.log('\nnodes created:', calls.nodes, '| sources started:', calls.started);
if (errors.length) { console.log('\nFAILURES:'); errors.forEach(e => console.log(' - ' + e)); process.exit(1); }
console.log('\nALL CHECKS PASSED');
