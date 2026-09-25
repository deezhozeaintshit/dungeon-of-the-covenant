// clipRecorder.js — Phase 4 (workstream 3): one-tap 30s gameplay clip capture.
//
// Design: a MediaRecorder runs continuously over a captureStream() of a
// downscaled mirror of the WebGL canvas. ondataavailable chunks (1s
// timeslices) are pushed into a time-windowed ring buffer, so the last
// 30 seconds are ALWAYS buffered. Tapping the clip button assembles the
// buffered chunks into a standalone WebM Blob (init segment + clusters).
//
// Performance: capture resolution/fps/bitrate follow the Phase 3
// PerformanceMonitor tier (excellent/good/acceptable/poor). Only the copy
// cadence adapts live (no recorder restart, so the buffer is never lost).
// Capture is paused when the tab is hidden. Everything is local until the
// player downloads or shares — nothing is uploaded.
//
// DOM-free by construction: DOM access goes through injected deps so the
// buffer math, mime selection, and share-text builder are headless-testable.
// In the browser, deps default to window/document.

// ---- Constants ----
export const CLIP_WINDOW_MS = 30000;
export const GAME_URL = 'https://dotc.integrators.cc';
export const DEFAULT_HASHTAGS = ['#dungeoncrawler', '#indiegame', '#browsergame'];

// Capture profiles per PerformanceMonitor tier (Phase 3 pattern:
// excellent -> good -> acceptable -> poor, each step cheaper).
export const CAPTURE_PROFILES = {
  excellent:  { width: 1280, height: 720, fps: 30, videoBitsPerSecond: 5_000_000 },
  good:       { width: 960,  height: 540, fps: 30, videoBitsPerSecond: 3_500_000 },
  acceptable: { width: 854,  height: 480, fps: 24, videoBitsPerSecond: 2_500_000 },
  poor:       { width: 640,  height: 360, fps: 15, videoBitsPerSecond: 1_500_000 },
};

export const SHARE_HOOKS = {
  boss: 'Just dropped a BOSS in Dungeon of the Covenant. The last 30 seconds were unreal.',
  legendary: 'A LEGENDARY drop just hit the floor in Dungeon of the Covenant.',
  mythic: 'A MYTHIC COVENANT relic just dropped in Dungeon of the Covenant. Clip or it did not happen.',
  manual: 'This dungeon run was too good not to clip.',
};

// ---- Time-windowed ring buffer of MediaRecorder chunks ----
export class ClipRingBuffer {
  constructor(windowMs = CLIP_WINDOW_MS) {
    this.windowMs = windowMs;
    this.initChunk = null; // EBML header + segment init (chunk 0 of the session)
    this.chunks = [];      // [{ data: Blob, t: ms }]
  }

  // A fresh recording session: the first chunk carries the WebM init segment.
  // Re-assembling a playable clip requires initChunk + clusters, so a new
  // session invalidates everything buffered from the previous one.
  setInit(chunk) {
    this.initChunk = chunk;
    this.chunks = [];
  }

  push(chunk, nowMs) {
    this.chunks.push({ data: chunk, t: nowMs });
    this.evict(nowMs);
  }

  evict(nowMs) {
    const cutoff = nowMs - this.windowMs;
    while (this.chunks.length > 0 && this.chunks[0].t < cutoff) {
      this.chunks.shift();
    }
  }

  // Chunks inside the window, oldest first.
  extract(nowMs) {
    this.evict(nowMs);
    return this.chunks.map((c) => c.data);
  }

  clear() {
    this.initChunk = null;
    this.chunks = [];
  }

  get chunkCount() { return this.chunks.length; }

  get bufferedMs() {
    if (this.chunks.length === 0) return 0;
    return this.chunks[this.chunks.length - 1].t - this.chunks[0].t;
  }
}

// ---- Codec / capability probing ----
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

// Returns the first supported mime type, or '' when the platform can record
// WebM without an explicit codec hint. Throws when MediaRecorder is absent.
export function chooseRecorderMimeType(MediaRecorderCtor) {
  if (!MediaRecorderCtor || typeof MediaRecorderCtor.isTypeSupported !== 'function') {
    throw new Error('MediaRecorder is not available in this browser');
  }
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorderCtor.isTypeSupported(m)) return m;
    } catch { /* treat as unsupported and keep probing */ }
  }
  return '';
}

// Support probe used by the UI to render a clean "not supported" state
// instead of crashing. deps injectable for headless tests.
export function checkCaptureSupport(deps = {}) {
  const win = deps.window ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : undefined);
  if (!win || !doc) return { supported: false, reason: 'no DOM (headless)' };
  if (typeof win.MediaRecorder !== 'function') {
    return { supported: false, reason: 'MediaRecorder is not available' };
  }
  let probe = null;
  try { probe = doc.createElement('canvas'); } catch { probe = null; }
  if (!probe || typeof probe.captureStream !== 'function') {
    return { supported: false, reason: 'canvas.captureStream is not available' };
  }
  try {
    chooseRecorderMimeType(win.MediaRecorder);
  } catch (e) {
    return { supported: false, reason: e.message };
  }
  return { supported: true, reason: '' };
}

// ---- Share text builder ----
export function buildShareText({ hook = SHARE_HOOKS.manual, gameUrl = GAME_URL, hashtags = DEFAULT_HASHTAGS } = {}) {
  const tags = (Array.isArray(hashtags) && hashtags.length > 0 ? hashtags : DEFAULT_HASHTAGS).join(' ');
  return `Just tore through the dungeon in Dungeon of the Covenant.\n${hook}\nPlay it free in your browser: ${gameUrl}\n${tags}`;
}

// ---- Recorder ----
export class ClipRecorder {
  constructor({
    perfMonitor = null,
    windowMs = CLIP_WINDOW_MS,
    MediaRecorderCtor = (typeof window !== 'undefined' ? window.MediaRecorder : undefined),
    createCanvas = () => document.createElement('canvas'),
    now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    timesliceMs = 1000,
    profileRecheckMs = 10000,
  } = {}) {
    this.perfMonitor = perfMonitor;
    this.buffer = new ClipRingBuffer(windowMs);
    this.MediaRecorderCtor = MediaRecorderCtor;
    this.createCanvas = createCanvas;
    this.now = now;
    this.timesliceMs = timesliceMs;
    this.profileRecheckMs = profileRecheckMs;

    this.state = 'idle'; // idle | buffering | paused | unsupported | error
    this.listeners = new Set();
    this.sourceCanvas = null;
    this.mirror = null;   // downscaled offscreen canvas
    this.mirrorCtx = null;
    this.stream = null;
    this.recorder = null;
    this.profile = CAPTURE_PROFILES.good;
    this.profileName = 'good';
    this.lastCopyAt = 0;
    this.lastProfileCheckAt = 0;
    this.mimeType = '';
    this.errorInfo = '';
  }

  onStateChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _setState(next, info = '') {
    this.state = next;
    if (info) this.errorInfo = info;
    for (const fn of this.listeners) {
      try { fn(next, info); } catch { /* UI listeners must never break capture */ }
    }
  }

  _resolveProfile() {
    const tier = typeof this.perfMonitor?.getPerformanceTier === 'function'
      ? this.perfMonitor.getPerformanceTier()
      : 'good';
    const name = CAPTURE_PROFILES[tier] ? tier : 'good';
    return { name, profile: CAPTURE_PROFILES[name] };
  }

  // Attach the live game canvas. Must be called before start().
  attach(sourceCanvas) {
    this.sourceCanvas = sourceCanvas;
    const { name, profile } = this._resolveProfile();
    this.profileName = name;
    this.profile = profile;
    try {
      this.mirror = this.createCanvas();
      this.mirror.width = profile.width;
      this.mirror.height = profile.height;
      this.mirrorCtx = this.mirror.getContext('2d');
    } catch (e) {
      this._setState('unsupported', `could not create capture canvas: ${e.message}`);
      return false;
    }
    return true;
  }

  start() {
    if (this.state === 'buffering') return true;
    if (!this.sourceCanvas || !this.mirror || !this.mirrorCtx) {
      this._setState('unsupported', 'no source canvas attached');
      return false;
    }
    try {
      this.mimeType = chooseRecorderMimeType(this.MediaRecorderCtor);
    } catch (e) {
      this._setState('unsupported', e.message);
      return false;
    }
    try {
      this.stream = this.mirror.captureStream(this.profile.fps);
    } catch (e) {
      this._setState('unsupported', `captureStream failed: ${e.message}`);
      return false;
    }
    let firstChunk = true;
    const options = { mimeType: this.mimeType || undefined, videoBitsPerSecond: this.profile.videoBitsPerSecond };
    try {
      this.recorder = new this.MediaRecorderCtor(this.stream, options);
    } catch (e) {
      this._setState('error', `MediaRecorder failed to start: ${e.message}`);
      return false;
    }
    this.recorder.ondataavailable = (ev) => {
      const data = ev && ev.data;
      if (!data || (typeof data.size === 'number' && data.size === 0)) return;
      if (firstChunk) { this.buffer.setInit(data); firstChunk = false; }
      else this.buffer.push(data, this.now());
    };
    this.recorder.onerror = (ev) => {
      this._setState('error', ev?.error?.message || 'recorder error');
    };
    try {
      this.recorder.start(this.timesliceMs);
    } catch (e) {
      this._setState('error', `recorder start failed: ${e.message}`);
      return false;
    }
    this.lastProfileCheckAt = this.now();
    this._setState('buffering');
    return true;
  }

  // Called from the game render loop right after the frame renders, so the
  // WebGL backbuffer is still valid (no preserveDrawingBuffer dependency).
  // Frame-skips internally to the profile fps; drawImage of a downscaled
  // copy is a single cheap blit.
  captureTick() {
    if (this.state !== 'buffering' || !this.mirrorCtx || !this.sourceCanvas) return;
    const t = this.now();
    const minInterval = 1000 / Math.max(1, this.profile.fps);
    if (t - this.lastCopyAt < minInterval) return;
    this.lastCopyAt = t;
    try {
      this.mirrorCtx.drawImage(this.sourceCanvas, 0, 0, this.mirror.width, this.mirror.height);
    } catch { /* a dropped frame is fine; the buffer keeps rolling */ }
    if (t - this.lastProfileCheckAt >= this.profileRecheckMs) {
      this.lastProfileCheckAt = t;
      const { name, profile } = this._resolveProfile();
      if (name !== this.profileName) {
        // Live-adapt copy cadence only. Restarting the MediaRecorder would
        // reset the init segment and wipe the 30s buffer, so resolution
        // stays fixed for the session while fps/bitrate costs drop.
        this.profileName = name;
        this.profile = profile;
      }
    }
  }

  pause() {
    if (this.state !== 'buffering' || !this.recorder) return;
    try { this.recorder.pause(); } catch { /* fall through */ }
    this._setState('paused');
  }

  resume() {
    if (this.state !== 'paused' || !this.recorder) return;
    try { this.recorder.resume(); } catch (e) {
      this._setState('error', `resume failed: ${e.message}`);
      return;
    }
    this.lastProfileCheckAt = this.now();
    this._setState('buffering');
  }

  stop() {
    if (this.recorder) {
      try { this.recorder.stop(); } catch { /* already stopped */ }
    }
    this.recorder = null;
    this.stream = null;
    this.buffer.clear();
    this._setState('idle');
  }

  // Assemble the last CLIP_WINDOW_MS of buffered chunks into a standalone
  // WebM Blob. Returns { ok, blob?, durationMs?, sizeBytes?, reason? }.
  saveClip() {
    if (this.state === 'unsupported' || this.state === 'error') {
      return { ok: false, reason: this.errorInfo || 'recording unavailable' };
    }
    if (!this.buffer.initChunk || this.buffer.chunkCount === 0) {
      return { ok: false, reason: 'no footage buffered yet — give it a few seconds' };
    }
    const t = this.now();
    const chunks = this.buffer.extract(t);
    const parts = [this.buffer.initChunk, ...chunks];
    const blob = new Blob(parts, { type: 'video/webm' });
    return {
      ok: true,
      blob,
      durationMs: this.buffer.bufferedMs,
      sizeBytes: blob.size,
      chunks: parts.length,
    };
  }

  getBufferedMs() { return this.buffer.bufferedMs; }
}
