// controls.js - Touch Virtual Joystick, Ability Arc & Keyboard Controls
export class GameControls {
  constructor(callbacks = {}) {
    this.callbacks = callbacks; // onInput(vector, rotation), onAction(actionName, targetPos, rotation, targetId), onHorn(), onPing(type, targetPos)

    this.moveVector = { x: 0, z: 0 };
    this.aimRotation = 0;
    this.playerPos = { x: 0, z: 0 };
    this.targetEnemy = null;
    this.keys = {};
    this.joystickActive = false;
    this.touchId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.maxRadius = 55;

    this.cooldowns = { skill1: 0, skill2: 0, skill3: 0, attack: 0 };

    this.initJoystick();
    this.initButtons();
    this.initKeyboard();
  }

  setTarget(targetEnemy) {
    this.targetEnemy = targetEnemy;
  }

  setPlayerPos(x, z) {
    this.playerPos.x = x;
    this.playerPos.z = z;
  }

  getAimData() {
    let targetPos = null;
    let rotation = this.aimRotation;

    if (this.targetEnemy) {
      targetPos = { x: this.targetEnemy.x, z: this.targetEnemy.z };
      const dx = this.targetEnemy.x - this.playerPos.x;
      const dz = this.targetEnemy.z - this.playerPos.z;
      if (Math.hypot(dx, dz) > 0.2) {
        rotation = Math.atan2(dx, dz);
        this.aimRotation = rotation;
      }
    } else if (this.moveVector.x !== 0 || this.moveVector.z !== 0) {
      targetPos = {
        x: this.playerPos.x + this.moveVector.x * 7,
        z: this.playerPos.z + this.moveVector.z * 7
      };
      rotation = Math.atan2(this.moveVector.x, this.moveVector.z);
      this.aimRotation = rotation;
    } else {
      targetPos = {
        x: this.playerPos.x + Math.sin(this.aimRotation) * 7,
        z: this.playerPos.z + Math.cos(this.aimRotation) * 7
      };
    }

    return { targetPos, rotation, targetId: this.targetEnemy ? this.targetEnemy.id : null };
  }

  initJoystick() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const knob = document.getElementById('joystick-knob');

    if (!zone || !base || !knob) return;

    // Make joystick always visible at default resting spot
    base.classList.remove('hidden');
    base.style.left = '95px';
    base.style.top = 'auto';
    base.style.bottom = '25px';

    const updateStick = (clientX, clientY) => {
      const dx = clientX - this.joyOrigin.x;
      const dy = clientY - this.joyOrigin.y;
      const dist = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);

      const clampedDist = Math.min(dist, this.maxRadius);
      const knobX = Math.cos(angle) * clampedDist;
      const knobY = Math.sin(angle) * clampedDist;
      knob.style.transform = `translate(${knobX}px, ${knobY}px)`;

      if (dist > 6) {
        this.rawStick = {
          x: knobX / this.maxRadius,
          z: knobY / this.maxRadius
        };
      } else {
        this.rawStick = { x: 0, z: 0 };
      }
    };

    const resetStick = () => {
      this.joystickActive = false;
      this.touchId = null;
      base.style.left = '95px';
      base.style.top = 'auto';
      base.style.bottom = '25px';
      knob.style.transform = `translate(0px, 0px)`;
      this.rawStick = { x: 0, z: 0 };
      this.moveVector.x = 0;
      this.moveVector.z = 0;
    };

    // TOUCH EVENTS
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      this.touchId = touch.identifier;
      this.joystickActive = true;
      const rect = zone.getBoundingClientRect();
      this.joyOrigin = { x: touch.clientX, y: touch.clientY };

      base.style.bottom = 'auto';
      base.style.left = `${touch.clientX - rect.left}px`;
      base.style.top = `${touch.clientY - rect.top}px`;
      knob.style.transform = `translate(0px, 0px)`;
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!this.joystickActive) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === this.touchId) {
          updateStick(touch.clientX, touch.clientY);
          break;
        }
      }
    }, { passive: false });

    const endJoystickTouch = (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.touchId) {
          resetStick();
          break;
        }
      }
    };
    zone.addEventListener('touchend', endJoystickTouch);
    zone.addEventListener('touchcancel', endJoystickTouch);

    // MOUSE DRAG EVENTS (For Desktop / Laptop Testing of Mobile Controls)
    let mouseDragging = false;
    zone.addEventListener('mousedown', (e) => {
      e.preventDefault();
      mouseDragging = true;
      this.joystickActive = true;
      const rect = zone.getBoundingClientRect();
      this.joyOrigin = { x: e.clientX, y: e.clientY };

      base.style.bottom = 'auto';
      base.style.left = `${e.clientX - rect.left}px`;
      base.style.top = `${e.clientY - rect.top}px`;
      knob.style.transform = `translate(0px, 0px)`;
    });

    window.addEventListener('mousemove', (e) => {
      if (!mouseDragging) return;
      updateStick(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
      if (mouseDragging) {
        mouseDragging = false;
        resetStick();
      }
    });
  }

  initButtons() {
    const bindBtn = (id, actionName) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      const trigger = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (navigator.vibrate) navigator.vibrate(20);
        const aim = this.getAimData();
        if (this.callbacks.onAction) {
          this.callbacks.onAction(actionName, aim.targetPos, aim.rotation, aim.targetId);
        }
      };

      btn.addEventListener('touchstart', trigger, { passive: false });
      btn.addEventListener('mousedown', trigger);
    };

    bindBtn('btn-attack', 'attack');
    bindBtn('btn-skill-1', 'skill1');
    bindBtn('btn-skill-2', 'skill2');
    bindBtn('btn-skill-3', 'skill3');
    bindBtn('btn-dash', 'dash');
    bindBtn('btn-jump', 'jump');

    this.prevPadButtons = {};
    this.attackHoldTimer = 0;
    this.initGamepadEvents();

    // War Horn
    const hornBtn = document.getElementById('btn-war-horn');
    if (hornBtn) {
      hornBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (navigator.vibrate) navigator.vibrate(50);
        this.triggerGamepadRumble(160, 0.7, 0.9);
        if (this.callbacks.onHorn) this.callbacks.onHorn();
      });
    }

    // Ping Trigger Button & Wheel
    const pingTrigger = document.getElementById('btn-open-ping');
    const pingWheel = document.getElementById('ping-wheel');
    if (pingTrigger && pingWheel) {
      pingTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        pingWheel.classList.toggle('hidden');
      });

      pingWheel.querySelectorAll('.ping-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const pingType = btn.getAttribute('data-ping');
          pingWheel.classList.add('hidden');
          const aim = this.getAimData();
          if (this.callbacks.onPing) {
            this.callbacks.onPing(pingType, aim.targetPos);
          }
        });
      });
    }

    // Secret Tab Toggle
    const secretBtn = document.getElementById('btn-secret-toggle');
    const secretCard = document.getElementById('secret-card-panel');
    const closeSecret = document.getElementById('btn-close-secret');
    if (secretBtn && secretCard) {
      secretBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        secretCard.classList.toggle('hidden');
      });
      if (closeSecret) {
        closeSecret.addEventListener('click', () => secretCard.classList.add('hidden'));
      }
    }
  }

  initGamepadEvents() {
    window.addEventListener('gamepadconnected', (e) => {
      const txt = document.getElementById('gamepad-status-text');
      const badge = document.getElementById('gamepad-hud-badge');
      if (txt) txt.innerText = 'PAD ACTIVE';
      if (badge) {
        badge.style.background = 'rgba(16, 185, 129, 0.35)';
        badge.style.borderColor = '#34d399';
      }
      this.triggerGamepadRumble(140, 0.5, 0.8);
    });
    window.addEventListener('gamepaddisconnected', () => {
      const txt = document.getElementById('gamepad-status-text');
      if (txt) txt.innerText = 'PAD READY';
    });
  }

  triggerGamepadRumble(durationMs = 80, weakMagnitude = 0.4, strongMagnitude = 0.6) {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (pad && pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
          pad.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: durationMs,
            weakMagnitude,
            strongMagnitude
          }).catch(() => {});
        }
      }
    } catch (_) {}
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['input', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) return;
      this.keys[e.code] = true;

      const aim = this.getAimData();

      if (e.code === 'Space' || e.code === 'KeyJ') {
        e.preventDefault();
        if (this.callbacks.onAction) this.callbacks.onAction('jump', aim.targetPos, aim.rotation, aim.targetId);
      } else if (e.code === 'KeyE' || e.code === 'KeyK') {
        e.preventDefault();
        if (this.callbacks.onAction) this.callbacks.onAction('attack', aim.targetPos, aim.rotation, aim.targetId);
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        e.preventDefault();
        if (this.callbacks.onAction) this.callbacks.onAction('dash', aim.targetPos, aim.rotation, aim.targetId);
      } else if (e.code === 'Digit1') {
        if (this.callbacks.onAction) this.callbacks.onAction('skill1', aim.targetPos, aim.rotation, aim.targetId);
      } else if (e.code === 'Digit2') {
        if (this.callbacks.onAction) this.callbacks.onAction('skill2', aim.targetPos, aim.rotation, aim.targetId);
      } else if (e.code === 'Digit3' || e.code === 'KeyR') {
        if (this.callbacks.onAction) this.callbacks.onAction('skill3', aim.targetPos, aim.rotation, aim.targetId);
      } else if (e.code === 'KeyF') {
        if (this.callbacks.onAction) this.callbacks.onAction('loot', aim.targetPos, aim.rotation, aim.targetId);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  setCameraYaw(yaw) {
    this.cameraYaw = yaw || 0;
  }

  update(dt) {
    let rx = 0;
    let rz = 0;

    // 1. Poll Connected HTML5 Gamepad Controller (Xbox / PlayStation / USB / Bluetooth)
    let padStickUsed = false;
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    const activePad = Array.from(pads || []).find(p => p && p.connected);

    if (activePad) {
      const txt = document.getElementById('gamepad-status-text');
      if (txt && txt.innerText !== 'PAD ACTIVE') txt.innerText = 'PAD ACTIVE';

      // Left Thumbstick (Axes 0 & 1): 360° Analog Movement
      const lx = activePad.axes[0] || 0;
      const ly = activePad.axes[1] || 0;
      if (Math.hypot(lx, ly) > 0.16) {
        rx = lx;
        rz = ly;
        padStickUsed = true;
        const knob = document.getElementById('joystick-knob');
        if (knob) {
          knob.style.transform = `translate(${Math.round(lx * 42)}px, ${Math.round(ly * 42)}px)`;
        }
      }

      // Right Thumbstick (Axes 2 & 3): 3D Camera Rotation & Zoom
      const rStickX = activePad.axes[2] || 0;
      const rStickY = activePad.axes[3] || 0;
      if (Math.abs(rStickX) > 0.22 && window.game?.renderer) {
        window.game.renderer.rotateBy(rStickX * dt * 2.3);
      }
      if (Math.abs(rStickY) > 0.28 && window.game?.renderer) {
        window.game.renderer.zoomBy(rStickY * dt * 14.0);
      }

      // Helper for edge-triggered button press
      const isPressed = (idx) => Boolean(activePad.buttons[idx]?.pressed || (activePad.buttons[idx]?.value || 0) > 0.55);
      const justPressed = (idx) => {
        const cur = isPressed(idx);
        const prev = Boolean(this.prevPadButtons[idx]);
        this.prevPadButtons[idx] = cur;
        return cur && !prev;
      };

      const aim = this.getAimData();

      // A / Cross (0): Jump Over Ledges & Pull Loot (or Start Quickplay if on Lobby screen)
      if (justPressed(0)) {
        const lobbyScreen = document.getElementById('lobby-screen');
        if (lobbyScreen && !lobbyScreen.classList.contains('hidden')) {
          document.getElementById('btn-quickplay')?.click();
        } else {
          this.triggerGamepadRumble(60, 0.3, 0.5);
          if (this.callbacks.onAction) this.callbacks.onAction('jump', aim.targetPos, aim.rotation, aim.targetId);
        }
      }

      // B / Circle (1): Tactical Dash (or close open modals)
      if (justPressed(1)) {
        this.triggerGamepadRumble(75, 0.4, 0.6);
        if (this.callbacks.onAction) this.callbacks.onAction('dash', aim.targetPos, aim.rotation, aim.targetId);
      }

      // X / Square (2) or RT / R2 (7): Primary Attack (supports tap OR hold!)
      const holdingAttack = isPressed(2) || isPressed(7);
      if (justPressed(2) || justPressed(7)) {
        this.triggerGamepadRumble(55, 0.35, 0.55);
        if (this.callbacks.onAction) this.callbacks.onAction('attack', aim.targetPos, aim.rotation, aim.targetId);
        this.attackHoldTimer = 0.28;
      } else if (holdingAttack) {
        this.attackHoldTimer -= dt;
        if (this.attackHoldTimer <= 0) {
          this.attackHoldTimer = 0.32;
          this.triggerGamepadRumble(40, 0.25, 0.4);
          if (this.callbacks.onAction) this.callbacks.onAction('attack', aim.targetPos, aim.rotation, aim.targetId);
        }
      }

      // Y / Triangle (3): Skill 1
      if (justPressed(3)) {
        this.triggerGamepadRumble(95, 0.5, 0.75);
        if (this.callbacks.onAction) this.callbacks.onAction('skill1', aim.targetPos, aim.rotation, aim.targetId);
      }

      // LB / L1 (4): Skill 2
      if (justPressed(4)) {
        this.triggerGamepadRumble(95, 0.5, 0.75);
        if (this.callbacks.onAction) this.callbacks.onAction('skill2', aim.targetPos, aim.rotation, aim.targetId);
      }

      // RB / R1 (5): Skill 3 (Ultimate)
      if (justPressed(5)) {
        this.triggerGamepadRumble(140, 0.7, 0.95);
        if (this.callbacks.onAction) this.callbacks.onAction('skill3', aim.targetPos, aim.rotation, aim.targetId);
      }

      // LT / L2 (6): War Horn & Vacuum Loot
      if (justPressed(6)) {
        this.triggerGamepadRumble(120, 0.6, 0.85);
        if (this.callbacks.onAction) this.callbacks.onAction('loot', aim.targetPos, aim.rotation, aim.targetId);
        if (this.callbacks.onHorn) this.callbacks.onHorn();
      }

      // Back / Select (8): Toggle Clean HUD [H]
      if (justPressed(8)) {
        document.getElementById('btn-clean-hud')?.click();
      }

      // Start / Options (9): Generate Next Procedural Floor [N]
      if (justPressed(9)) {
        document.getElementById('btn-generate-floor')?.click();
      }

      // D-Pad (12=Up, 13=Down, 14=Left, 15=Right): Tactical Party Commands
      if (justPressed(12)) document.getElementById('btn-tac-attack')?.click();
      if (justPressed(13)) document.getElementById('btn-tac-regroup')?.click();
      if (justPressed(14)) document.getElementById('btn-tac-loot')?.click();
      if (justPressed(15)) document.getElementById('btn-tac-heal')?.click();
    }

    if (!padStickUsed) {
      if (this.joystickActive && this.rawStick) {
        rx = this.rawStick.x;
        rz = this.rawStick.z;
      } else {
        if (this.keys['KeyW'] || this.keys['ArrowUp']) rz -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) rz += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) rx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) rx += 1;

        const len = Math.hypot(rx, rz);
        if (len > 0) {
          rx /= len;
          rz /= len;
        }
      }
    }

    if (Math.hypot(rx, rz) > 0.01) {
      const cos = Math.cos(this.cameraYaw || 0);
      const sin = Math.sin(this.cameraYaw || 0);
      this.moveVector.x = rx * cos + rz * sin;
      this.moveVector.z = -rx * sin + rz * cos;
      this.aimRotation = Math.atan2(this.moveVector.x, this.moveVector.z);
    } else {
      this.moveVector.x = 0;
      this.moveVector.z = 0;
    }

    if (this.callbacks.onInput) {
      this.callbacks.onInput(this.moveVector, this.aimRotation);
    }
  }

  setSkillInfo(skills) {
    // skills = [{ name, icon }, { name, icon }, { name, icon }]
    if (!skills) return;
    skills.forEach((s, idx) => {
      const num = idx + 1;
      const iconEl = document.getElementById(`skill-${num}-icon`);
      const labelEl = document.getElementById(`skill-${num}-label`);
      if (iconEl && s.icon) iconEl.innerText = s.icon;
      if (labelEl && s.name) labelEl.innerText = s.name;
    });
  }
}
