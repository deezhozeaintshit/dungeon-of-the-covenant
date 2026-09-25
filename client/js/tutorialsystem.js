// TutorialSystem.js - Interactive Tutorial & Onboarding System

export class TutorialSystem {
  constructor(gameApp) {
    this.game = gameApp;
    this.active = false;
    this.currentStep = 0;
    this.steps = [];
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
  showTooltip(step) {
    // Remove existing tooltip
    const existing = document.querySelector('.tutorial-tooltip');
    if (existing) existing.remove();

    const tooltip = document.createElement('div');
    tooltip.className = 'tutorial-tooltip';
    tooltip.innerHTML = `
      <div class="tooltip-content">
        <span class="tooltip-title">${step.title || ''}</span>
        <p class="tooltip-text">${step.text || ''}</p>
        <div class="tooltip-actions">
          <button class="btn-tutorial-next">${step.nextText || 'Next'}</button>
          <button class="btn-tutorial-skip">Skip</button>
        </div>
      </div>
    `;

    // Position tooltip
    if (step.highlightElement) {
      const rect = step.highlightElement.getBoundingClientRect();
      tooltip.style.position = 'fixed';
      tooltip.style.left = `${rect.right + 10}px`;
      tooltip.style.top = `${rect.top}px`;
    } else {
      tooltip.style.position = 'fixed';
      tooltip.style.bottom = '20px';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translateX(-50%)';
    }

    document.body.appendChild(tooltip);

    // Bind buttons
    tooltip.querySelector('.btn-tutorial-next').addEventListener('click', () => this.next());
    tooltip.querySelector('.btn-tutorial-skip').addEventListener('click', () => this.skip());
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

    // Remove tooltip
    const tooltip = document.querySelector('.tutorial-tooltip');
    if (tooltip) tooltip.remove();

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
