// tests/phase4-clip.test.mjs — headless smoke tests for the Phase 4 clip
// button workstream (ring buffer, mime selection, support probe, share text,
// recorder state machine with injected fakes).
// Run: node tests/phase4-clip.test.mjs
import assert from 'node:assert/strict';
import {
  CLIP_WINDOW_MS, GAME_URL, DEFAULT_HASHTAGS, CAPTURE_PROFILES, SHARE_HOOKS,
  ClipRingBuffer, chooseRecorderMimeType, checkCaptureSupport,
  buildShareText, ClipRecorder,
} from '../client/js/clipRecorder.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`ok - ${name}`); };

// ---- ClipRingBuffer ----
t('buffer keeps chunks inside the 30s window, evicts older ones', () => {
  const b = new ClipRingBuffer(30000);
  b.setInit(new Blob(['init']));
  const now = 1_000_000;
  for (let i = 0; i < 40; i++) b.push(new Blob([`c${i}`]), now - (39 - i) * 1000);
  assert.equal(b.chunkCount, 31); // chunks 9..39 (30s span)
  const parts = b.extract(now);
  assert.equal(parts.length, 31);
  assert.equal(b.bufferedMs, 30000);
});

t('setInit resets the buffer (new recorder session)', () => {
  const b = new ClipRingBuffer();
  b.setInit(new Blob(['a']));
  b.push(new Blob(['x']), 1000);
  b.setInit(new Blob(['b']));
  assert.equal(b.chunkCount, 0);
  assert.equal(b.bufferedMs, 0);
});

t('clear empties everything', () => {
  const b = new ClipRingBuffer();
  b.setInit(new Blob(['a']));
  b.push(new Blob(['x']), 1000);
  b.clear();
  assert.equal(b.chunkCount, 0);
  assert.equal(b.extract(2000).length, 0);
});

// ---- Mime selection ----
t('chooseRecorderMimeType prefers vp9, falls back through candidates', () => {
  const fake = { isTypeSupported: (m) => m === 'video/webm;codecs=vp8' };
  assert.equal(chooseRecorderMimeType(fake), 'video/webm;codecs=vp8');
  const fake2 = { isTypeSupported: () => false };
  assert.equal(chooseRecorderMimeType(fake2), '');
});

t('chooseRecorderMimeType throws when MediaRecorder is absent', () => {
  assert.throws(() => chooseRecorderMimeType(undefined), /not available/);
  assert.throws(() => chooseRecorderMimeType({}), /not available/);
});

// ---- Support probe ----
t('checkCaptureSupport reports supported when APIs exist', () => {
  class MR { static isTypeSupported() { return true; } }
  const doc = { createElement: () => ({ captureStream: () => ({}) }) };
  const r = checkCaptureSupport({ window: { MediaRecorder: MR }, document: doc });
  assert.equal(r.supported, true);
});

t('checkCaptureSupport gives clean reasons when APIs are missing', () => {
  const doc = { createElement: () => ({ captureStream: () => ({}) }) };
  const r1 = checkCaptureSupport({ window: {}, document: doc });
  assert.equal(r1.supported, false);
  assert.match(r1.reason, /MediaRecorder/);
  class MR { static isTypeSupported() { return true; } }
  const badDoc = { createElement: () => ({}) };
  const r2 = checkCaptureSupport({ window: { MediaRecorder: MR }, document: badDoc });
  assert.equal(r2.supported, false);
  assert.match(r2.reason, /captureStream/);
});

// ---- Share text ----
t('buildShareText contains game URL, hashtags, hook', () => {
  const text = buildShareText({ hook: SHARE_HOOKS.boss });
  assert.ok(text.includes(GAME_URL));
  assert.ok(text.includes(SHARE_HOOKS.boss));
  for (const tag of DEFAULT_HASHTAGS) assert.ok(text.includes(tag));
});

t('buildShareText falls back to default hashtags when empty', () => {
  const text = buildShareText({ hashtags: [] });
  assert.ok(text.includes('#dungeoncrawler'));
});

// ---- ClipRecorder with injected fakes ----
class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onerror = null;
  }
  emit(data) { if (this.ondataavailable) this.ondataavailable({ data }); }
  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
}

const makeFakeCanvas = () => ({
  width: 0, height: 0,
  getContext: () => ({ drawImage() {} }),
  captureStream: () => ({ fakeStream: true }),
});

t('recorder buffers, saves clip with init segment first', () => {
  const tag = (s) => { const b = new Blob([s]); b._text = s; return b; };
  let now = 0;
  const rec = new ClipRecorder({
    MediaRecorderCtor: FakeMediaRecorder,
    createCanvas: makeFakeCanvas,
    now: () => now,
  });
  const states = [];
  rec.onStateChange((s) => states.push(s));
  assert.equal(rec.attach(makeFakeCanvas()), true);
  assert.equal(rec.start(), true);
  assert.equal(rec.state, 'buffering');
  assert.deepEqual(states, ['buffering']);

  // Simulate 40s of 1s chunks; first is the init segment.
  rec.recorder.emit(tag('init-seg'));
  for (let i = 0; i < 40; i++) { now += 1000; rec.recorder.emit(tag(`seg${i}`)); }

  const clip = rec.saveClip();
  assert.equal(clip.ok, true);
  assert.equal(clip.chunks, 32); // init + 31 clusters inside the 30s window
  assert.ok(clip.sizeBytes > 0);
  assert.ok(clip.durationMs <= CLIP_WINDOW_MS + 1000);
  // Blob concatenation order: init segment first, old chunks evicted.
  const t0 = rec.now();
  const ordered = [rec.buffer.initChunk, ...rec.buffer.extract(t0)]
    .map((b) => b._text || '').join('|');
  assert.ok(ordered.startsWith('init-seg'), 'init segment must be first for a playable WebM');
  assert.ok(ordered.includes('seg39'), 'newest chunk must be present');
  assert.ok(!ordered.includes('seg0|'), 'chunks older than 30s must be evicted');
});

t('saveClip fails cleanly when nothing is buffered yet', () => {
  const rec = new ClipRecorder({
    MediaRecorderCtor: FakeMediaRecorder,
    createCanvas: makeFakeCanvas,
    now: () => 0,
  });
  rec.attach(makeFakeCanvas());
  rec.start();
  const clip = rec.saveClip();
  assert.equal(clip.ok, false);
  assert.match(clip.reason, /buffered/);
});

t('pause/resume cycle preserves the buffered window', () => {
  let now = 0;
  const rec = new ClipRecorder({
    MediaRecorderCtor: FakeMediaRecorder,
    createCanvas: makeFakeCanvas,
    now: () => now,
  });
  rec.attach(makeFakeCanvas());
  rec.start();
  rec.recorder.emit(new Blob(['init']));
  for (let i = 0; i < 10; i++) { now += 1000; rec.recorder.emit(new Blob([`s${i}`])); }
  rec.pause();
  assert.equal(rec.state, 'paused');
  rec.resume();
  assert.equal(rec.state, 'buffering');
  assert.equal(rec.buffer.chunkCount, 10);
});

t('profile downgrades copy cadence on poor perf tier without losing buffer', () => {
  let now = 0;
  let tier = 'excellent';
  const rec = new ClipRecorder({
    perfMonitor: { getPerformanceTier: () => tier },
    MediaRecorderCtor: FakeMediaRecorder,
    createCanvas: makeFakeCanvas,
    now: () => now,
    profileRecheckMs: 1,
  });
  rec.attach(makeFakeCanvas());
  assert.equal(rec.profileName, 'excellent');
  rec.start();
  rec.recorder.emit(new Blob(['init']));
  rec.recorder.emit(new Blob(['a']));
  assert.equal(rec.buffer.chunkCount, 1);
  tier = 'poor';
  now += 100; // advance past the recheck interval
  rec.captureTick(); // triggers profile re-evaluation
  assert.equal(rec.profileName, 'poor');
  assert.equal(rec.profile.fps, CAPTURE_PROFILES.poor.fps);
  assert.equal(rec.buffer.chunkCount, 1, 'buffer survives profile adaptation');
});

t('unsupported recorder surfaces a clean state, saveClip reports why', () => {
  const rec = new ClipRecorder({
    MediaRecorderCtor: undefined, // no MediaRecorder in this browser
    createCanvas: makeFakeCanvas,
    now: () => 0,
  });
  rec.attach(makeFakeCanvas());
  assert.equal(rec.start(), false);
  assert.equal(rec.state, 'unsupported');
  const clip = rec.saveClip();
  assert.equal(clip.ok, false);
});

console.log(`\n${pass} clip tests passed.`);
