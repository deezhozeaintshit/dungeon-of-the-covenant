// clipUI.js — Phase 4 (workstream 3): HUD clip button + preview modal.
//
// Wires the ClipRecorder into the game HUD: a small unobtrusive dark-fantasy
// button, a playback preview modal (Download / Copy share text / Discard /
// Close), keyboard shortcut, tab-visibility pause, and an auto-suggest toast
// after epic moments (boss kill, legendary+ drop) driven by real combat/loot
// events from main.js. Privacy: capture is local-only until the player
// downloads or shares; the modal says so explicitly.
//
// WCAG 2.1 AA: native <button> elements (keyboard reachable), aria-labels,
// visible focus styles (clip.css), focus moves into the modal on open and
// returns to the clip button on close, Escape closes.

import {
  CLIP_WINDOW_MS, SHARE_HOOKS, buildShareText, checkCaptureSupport,
} from './clipRecorder.js?v=4.0';
import { registerEscapeLayer } from './ui/escapeManager.js';

const CLIP_SECONDS = Math.round(CLIP_WINDOW_MS / 1000);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function initClipButton({
  recorder = null,
  isInGame = () => true,
  toast = null,
} = {}) {
  const support = checkCaptureSupport();
  const api = { supported: support.supported, supportReason: support.reason };

  let btn = document.getElementById('btn-clip');
  if (!btn) {
    // Resilient fallback: if the HUD markup is missing, mount a floating button.
    btn = el('button', 'clip-fab', '🎬');
    btn.id = 'btn-clip';
    btn.setAttribute('aria-label', `Save the last ${CLIP_SECONDS} seconds of gameplay as a clip`);
    document.body.appendChild(btn);
  }

  const setEnabled = () => {
    if (api.supported) {
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
    } else {
      btn.disabled = false; // keep reachable so the "not supported" state is discoverable
      btn.setAttribute('aria-disabled', 'true');
      btn.title = `Clip capture: recording not supported in this browser (${api.supportReason})`;
    }
  };
  setEnabled();

  let modal = null;
  let lastFocus = null;
  let currentObjectUrl = null;
  let discardArmed = false;
  let unregisterEscape = null;

  // Escape is owned by the single capture-phase dispatcher
  // (ui/escapeManager.js); register the open modal as a layer.
  const armEscapeLayer = () => {
    if (unregisterEscape) unregisterEscape();
    unregisterEscape = registerEscapeLayer({
      id: 'clip', priority: 80,
      isOpen: () => !!modal && !!modal.parentElement,
      close: () => closeModal(),
    });
  };

  const closeModal = ({ keepFocus = false } = {}) => {
    if (unregisterEscape) { unregisterEscape(); unregisterEscape = null; }
    if (!modal) return;
    modal.remove();
    modal = null;
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    discardArmed = false;
    if (!keepFocus && lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  };

  const copyShareText = async (hook) => {
    const text = buildShareText({ hook });
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for non-secure contexts / older browsers.
      const ta = el('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  };

  const openPreview = (clip, hook) => {
    closeModal({ keepFocus: true });
    lastFocus = document.activeElement;
    modal = el('div', 'clip-modal-backdrop');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Gameplay clip preview');

    const panel = el('div', 'clip-modal');
    const title = el('h2', 'clip-modal-title', '🎬 Clip captured');
    panel.appendChild(title);

    const video = el('video', 'clip-preview-video');
    video.controls = true;
    video.muted = true; // autoplay policies: muted preview plays immediately
    video.setAttribute('aria-label', `Captured gameplay clip, last ${CLIP_SECONDS} seconds`);
    currentObjectUrl = URL.createObjectURL(clip.blob);
    video.src = currentObjectUrl;
    panel.appendChild(video);

    const meta = el('p', 'clip-modal-meta',
      `${Math.round((clip.durationMs || 0) / 1000)}s · ${(clip.sizeBytes / 1024).toFixed(0)} KB · WebM`);
    panel.appendChild(meta);

    const privacy = el('p', 'clip-privacy-note',
      'Private: this recording never leaves your device. It exists only in this tab until you download or share it.');
    panel.appendChild(privacy);

    const actions = el('div', 'clip-modal-actions');

    const btnDownload = el('button', 'clip-btn clip-btn-primary', '⬇ Download (.webm)');
    btnDownload.setAttribute('aria-label', 'Download clip as WebM file');
    btnDownload.addEventListener('click', () => {
      const a = el('a');
      a.href = currentObjectUrl;
      a.download = `dungeon-of-the-covenant-clip-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    const btnCopy = el('button', 'clip-btn', '📋 Copy share text');
    btnCopy.setAttribute('aria-label', 'Copy TikTok share text to clipboard');
    const copyLabel = btnCopy.textContent;
    btnCopy.addEventListener('click', async () => {
      const ok = await copyShareText(hook);
      btnCopy.textContent = ok ? '✓ Copied!' : 'Copy failed — select manually';
      setTimeout(() => { btnCopy.textContent = copyLabel; }, 2200);
    });

    const btnDiscard = el('button', 'clip-btn clip-btn-danger', '🗑 Discard');
    btnDiscard.setAttribute('aria-label', 'Discard this clip');
    btnDiscard.addEventListener('click', () => {
      // Two-step discard: no accidental data loss. First tap arms the
      // confirm; second tap discards. The clip is kept on close regardless.
      if (!discardArmed) {
        discardArmed = true;
        btnDiscard.textContent = '⚠ Confirm discard?';
        btnDiscard.classList.add('armed');
        setTimeout(() => {
          if (discardArmed) { discardArmed = false; btnDiscard.textContent = '🗑 Discard'; btnDiscard.classList.remove('armed'); }
        }, 4000);
        return;
      }
      closeModal();
    });

    const btnClose = el('button', 'clip-btn', 'Close');
    btnClose.setAttribute('aria-label', 'Close clip preview (clip is kept)');
    btnClose.addEventListener('click', () => closeModal());

    actions.append(btnDownload, btnCopy, btnDiscard, btnClose);
    panel.appendChild(actions);
    modal.appendChild(panel);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
    armEscapeLayer();
    video.play().catch(() => { /* user can press play */ });
    btnDownload.focus();
  };

  const openUnsupported = () => {
    closeModal({ keepFocus: true });
    lastFocus = document.activeElement;
    modal = el('div', 'clip-modal-backdrop');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Clip capture unavailable');
    const panel = el('div', 'clip-modal clip-modal-narrow');
    panel.appendChild(el('h2', 'clip-modal-title', '🎬 Clip capture unavailable'));
    panel.appendChild(el('p', 'clip-modal-meta',
      `Recording is not supported in this browser${api.supportReason ? `: ${api.supportReason}` : ''}. ` +
      'Try Chrome, Edge, or Firefox on desktop to capture clips.'));
    const btnClose = el('button', 'clip-btn clip-btn-primary', 'Close');
    btnClose.addEventListener('click', () => closeModal());
    panel.appendChild(btnClose);
    modal.appendChild(panel);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
    armEscapeLayer();
    btnClose.focus();
  };

  const saveFromUi = (hook = SHARE_HOOKS.manual) => {
    if (!isInGame()) return;
    if (!api.supported || !recorder) { openUnsupported(); return; }
    const clip = recorder.saveClip();
    if (!clip.ok) {
      if (toast) toast(`🎬 ${clip.reason}`, 'violet');
      return;
    }
    openPreview(clip, hook);
  };

  btn.addEventListener('click', () => saveFromUi());

  // Keyboard: C saves the last 30s while in the dungeon (not while typing).
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey && isInGame()) {
      saveFromUi();
    }
  });

  // Pause buffering when the tab is hidden; resume when visible again.
  // (captureStream keeps encoding hidden tabs — pausing saves the battery
  // and the frame budget.)
  const onVisibility = () => {
    if (!recorder) return;
    if (document.hidden) recorder.pause();
    else recorder.resume();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Subtle pulse on the button so the toast suggestion has a visual anchor.
  const pulse = () => {
    btn.classList.remove('clip-pulse');
    void btn.offsetWidth; // restart the animation
    btn.classList.add('clip-pulse');
    setTimeout(() => btn.classList.remove('clip-pulse'), 3600);
  };

  // Epic-moment suggestion, wired to real combat/loot events in main.js.
  // kind: 'boss' | 'legendary' | 'mythic'
  api.suggestClip = (kind = 'boss') => {
    if (!isInGame() || !api.supported) return;
    const label = kind === 'boss' ? 'Boss down'
      : kind === 'mythic' ? 'MYTHIC drop'
      : 'Legendary drop';
    if (toast) toast(`🎬 ${label}! Press C or tap CLIP to save the last ${CLIP_SECONDS}s`, 'gold');
    pulse();
  };

  api.openPreview = openPreview;
  api.closeModal = closeModal;
  api.saveClip = saveFromUi;
  api.isOpen = () => modal !== null;

  if (recorder) {
    recorder.onStateChange((state) => {
      btn.classList.toggle('clip-recording', state === 'buffering');
      btn.title = state === 'buffering'
        ? `Save the last ${CLIP_SECONDS} seconds of gameplay (C)`
        : btn.title;
    });
  }

  return api;
}
