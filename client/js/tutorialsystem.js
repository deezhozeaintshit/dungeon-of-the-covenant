// TutorialSystem.js - Interactive Tutorial & Onboarding System
//
// Escape handling: the tooltip registers as the TOP-priority layer (100) in
// the central ui/escapeManager.js dispatcher, so one Escape press skips the
// tutorial and never double-fires into pause. The Tab focus trap stays here.
import { registerEscapeLayer } from './ui/escapeManager.js';

export class TutorialSystem {
  constructor(gameApp) {
    this.game = gameApp;
    this.active = false;
    this.currentStep = 0;
    this.steps = [];
    this._lastFocused = null;    // element focused before the tooltip opened
    this._lastKeyHandler = null; // { tooltip, onKeyDown } for cleanup
    this._escRegistered = false; // central Escape dispatcher layer (priority 100)
    this.listeners = {
      onTutorialStart: [],
      onTutorialStep: [],
      onTutorialComplete: [],
      onTutorialSkip: []
    };
  }

  // Define tutorial steps
  registerSteps(steps) {
    this.steps = steps;
  }

  // Start tutorial
  start() {
    if (!this.active && this.steps.length > 0) {
      this.active = true;
      // Register once with the central Escape dispatcher: while the tutorial
      // tooltip is up, Escape skips the tutorial (top priority, so it can
      // never double-fire into pause or a modal beneath it).
      if (!this._escRegistered) {
        this._escRegistered = true;
        registerEscapeLayer({
          id: 'tutorial', priority: 100,
          isOpen: () => this.active && !!document.querySelector('.tutorial-tooltip'),
          close: () => this.skip(),
        });
      }
      this.currentStep = 0;
      this.showStep();
      this.notifyListeners('onTutorialStart');
    }
  }

  // Show current step
  showStep() {
    if (this.currentStep >= this.steps.length) {
      this.complete();
      return;
    }

    const step = this.steps[this.currentStep];
    this.notifyListeners('onTutorialStep', { step: this.currentStep, total: this.steps.length, data: step });

    // Highlight target element
    if (step.highlight) {
      const el = document.querySelector(step.highlight);
      if (el) {
        el.classList.add('tutorial-highlight');
        step.highlightElement = el;
      }
    }

    // Show tooltip
    this.showTooltip(step);
  }

  // Show tooltip
  // Track 3 UX (WCAG 2.1 AA): the tooltip is a modal dialog — role="dialog",
  // aria-modal, labelled/described by its content, focus moved into it on
  // show, Tab trapped between the buttons, Esc skips, and focus is restored
  // to the previously focused element on close.
  showTooltip(step) {
    // Remove existing tooltip
    const existing = document.querySelector('.tutorial-tooltip');
    if (existing) existing.remove();

    // Remember where focus was so we can put it back on close.
    if (!this._lastFocused) {
      this._lastFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
    }

    const stepNo = this.currentStep + 1;
    const stepTotal = this.steps.length;
    const isLast = this.currentStep >= stepTotal - 1;

    const tooltip = document.createElement('div');
    tooltip.className = 'tutorial-tooltip';
    tooltip.setAttribute('role', 'dialog');
    tooltip.setAttribute('aria-modal', 'true');
    tooltip.setAttribute('aria-labelledby', 'tutorial-tip-title');
    tooltip.setAttribute('aria-describedby', 'tutorial-tip-text tutorial-tip-step');
    tooltip.innerHTML = `
      <div class="tooltip-content">
        <span class="tooltip-title" id="tutorial-tip-title">${step.title || ''}</span>
        <p class="tooltip-text" id="tutorial-tip-text">${step.text || ''}</p>
        <span class="tooltip-step" id="tutorial-tip-step">STEP ${stepNo} OF ${stepTotal}</span>
        <div class="tooltip-actions">
          <button class="btn-tutorial-next" type="button">${isLast ? 'FINISH' : (step.nextText || 'NEXT')}</button>
          <button class="btn-tutorial-skip" type="button">SKIP TUTORIAL</button>
        </div>
      </div>
    `;

    // Position tooltip — highlight elements hidden on this device (e.g. the
    // touch joystick on desktop) fall back to bottom-center.
    const hl = step.highlightElement;
    let anchored = false;
    if (hl) {
      try {
        const rect = hl.getBoundingClientRect();
        const cs = window.getComputedStyle(hl);
        if (rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') {
          tooltip.style.position = 'fixed';
          tooltip.style.left = `${Math.min(rect.right + 10, window.innerWidth - 360)}px`;
          tooltip.style.top = `${Math.max(8, rect.top)}px`;
          anchored = true;
        }
      } catch (e) { /* fall through to default position */ }
    }
    if (!anchored) {
      tooltip.style.position = 'fixed';
      tooltip.style.bottom = '20px';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translateX(-50%)';
    }

    document.body.appendChild(tooltip);

    // Bind buttons
    const nextBtn = tooltip.querySelector('.btn-tutorial-next');
    const skipBtn = tooltip.querySelector('.btn-tutorial-skip');
    nextBtn.addEventListener('click', () => this.next());
    skipBtn.addEventListener('click', () => this.skip());

    // Escape is owned by the central dispatcher (ui/escapeManager.js), where
    // the tutorial registers as the top-priority layer (close = skip).
    // Tab cycles between the two buttons (focus trap).
    const onKeyDown = (e) => {
      if (e.key === 'Tab') {
        const focusables = [nextBtn, skipBtn];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    tooltip.addEventListener('keydown', onKeyDown);
    this._lastKeyHandler = { tooltip, onKeyDown };

    // Move focus into the dialog.
    nextBtn.focus();
  }

  // Go to next step
  next() {
    // Clear highlight
    const step = this.steps[this.currentStep];
    if (step && step.highlightElement) {
      step.highlightElement.classList.remove('tutorial-highlight');
    }

    this.currentStep++;
    this.showStep();
  }

  // Skip tutorial
  skip() {
    this.notifyListeners('onTutorialSkip');
    this.complete();
  }

  // Complete tutorial
  complete() {
    this.active = false;
    this.currentStep = 0;

    // Clear all highlights
    document.querySelectorAll('.tutorial-highlight').forEach(el => {
      el.classList.remove('tutorial-highlight');
    });

    // Remove tooltip + its key handler, restore focus.
    if (this._lastKeyHandler) {
      try { this._lastKeyHandler.tooltip.removeEventListener('keydown', this._lastKeyHandler.onKeyDown); } catch (e) { /* noop */ }
      this._lastKeyHandler = null;
    }
    const tooltip = document.querySelector('.tutorial-tooltip');
    if (tooltip) tooltip.remove();
    if (this._lastFocused && typeof this._lastFocused.focus === 'function') {
      try { this._lastFocused.focus(); } catch (e) { /* noop */ }
    }
    this._lastFocused = null;

    this.notifyListeners('onTutorialComplete');
  }

  // Register event listener
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  // Remove event listener
  off(event, callback) {
    if (this.listeners[event]) {
      const idx = this.listeners[event].indexOf(callback);
      if (idx !== -1) {
        this.listeners[event].splice(idx, 1);
      }
    }
  }

  // Notify all listeners
  notifyListeners(event, data) {
    const callbacks = this.listeners[event];
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data);
        } catch (error) {
          console.error('TutorialSystem: Listener error:', error);
        }
      }
    }
  }
}
