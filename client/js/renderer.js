// renderer.js - Three.js PBR Graphics, Farther Tactical Camera, Orbit/Zoom Camera Controls & Wing Lighting
import * as THREE from '/vendor/three.module.js';
import { EffectComposer } from '/vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/vendor/addons/postprocessing/OutputPass.js';
import { TraumaShake, HitStop } from './camerashake.js?v=9.1';

export class GameRenderer {
  constructor(container) {
    this.container = container;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // 1. Scene & Ultra-Clear Distance Fog (Allows seeing across multi-wing rooms)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x110c1d);
    this.scene.fog = new THREE.FogExp2(0x110c1d, 0.0022);

    // 2. Spherical Orbit Camera Setup (Farther default distance + interactive Zoom & Orbit)
    this.camera = new THREE.PerspectiveCamera(50, this.width / this.height, 0.5, 350);
    this.cameraTarget = new THREE.Vector3(0, 0, 15);

    this.cameraDistance = 24.5; // Farther away by default so players see much more of the level
    this.minDistance = 12.0;
    this.maxDistance = 44.0;
    this.cameraYaw = 0;         // Horizontal orbit angle (radians)
    this.cameraPitch = 0.88;    // Vertical elevation angle (radians, ~50 deg)
    this.isOverviewMode = false;

    this.updateCameraPositionImmediate();

    // 3. WebGL Renderer (PBR & Shadows)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.container.appendChild(this.renderer.domElement);

    // 4. Multi-Wing Lighting Setup
    this.setupLighting();

    // 5. Floating Golden Embers
    this.setupAtmospherics();

    // 6. Camera Feel: trauma-based screen shake + hit-stop timescale
    // (pure logic in camerashake.js; zero allocation in the hot loop)
    this.traumaShake = new TraumaShake();
    this.hitStop = new HitStop();
    this.timeScale = 1; // consumed by the main loop to scale simulation dt
    this._shakeOut = { ox: 0, oy: 0, oz: 0, roll: 0, pitch: 0, yaw: 0 };
    this._desiredCamPos = new THREE.Vector3();

    // 6b. Post-processing: bloom composer + quality tiers (off/low/high/auto)
    this.qualityMode = 'auto';       // user setting: 'auto' | 'off' | 'low' | 'high'
    this.qualityEffective = 'high';  // resolved tier actually in use
    this.userBloom = 0.8;            // from the settings slider (0..1)
    this._autoTuneTimer = 0;
    this._autoTuneCooldown = 0;
    this._setupPostProcessing();
    this._applyQuality();

    // 7. Slow-Mo Kill Cam Orbit (Auto-ends after 3.5s so player keeps camera control)
    this.killCamActive = false;
    this.killCamTimer = 0;
    this.killCamCenter = new THREE.Vector3(0, 0, -75);
    this.killCamAngle = 0;

    // 8. Interactive Camera Controls (Mouse Wheel, Right/Middle Drag, Touch Pinch & Orbit, Q/E Keys)
    this.initCameraControls();

    window.addEventListener('resize', () => this.onResize());
  }

  updateCameraPositionImmediate() {
    const horizDist = this.cameraDistance * Math.cos(this.cameraPitch);
    const vertDist = this.cameraDistance * Math.sin(this.cameraPitch);
    const offsetX = Math.sin(this.cameraYaw) * horizDist;
    const offsetZ = Math.cos(this.cameraYaw) * horizDist;

    this.camera.position.set(
      this.cameraTarget.x + offsetX,
      this.cameraTarget.y + vertDist,
      this.cameraTarget.z + offsetZ
    );
    this.camera.lookAt(this.cameraTarget);
  }

  initCameraControls() {
    const dom = this.renderer.domElement;

    // A. Mouse Wheel Zoom
    window.addEventListener('wheel', (e) => {
      if (document.getElementById('game-hud')?.classList.contains('hidden')) return;
      this.zoomBy(e.deltaY * 0.015);
    }, { passive: true });

    // B. Desktop Mouse Drag Orbit (Right-Click, Middle-Click, or Left-Click on upper screen)
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;

    dom.addEventListener('mousedown', (e) => {
      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.clientY < window.innerHeight * 0.55)) {
        isDragging = true;
        prevX = e.clientX;
        prevY = e.clientY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;

      this.cameraYaw -= dx * 0.007;
      this.cameraPitch = Math.max(0.45, Math.min(1.35, this.cameraPitch + dy * 0.005));
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    // C. Mobile Touch Pinch-to-Zoom & Upper-Screen Orbit Drag
    let touchOrbitId = null;
    let touchPrevX = 0;
    let touchPrevY = 0;
    let lastPinchDist = 0;

    dom.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDist = Math.hypot(dx, dy);
        touchOrbitId = null;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        // Allow camera drag on upper 60% of screen (away from joystick & skill buttons)
        if (t.clientY < window.innerHeight * 0.6) {
          touchOrbitId = t.identifier;
          touchPrevX = t.clientX;
          touchPrevY = t.clientY;
        }
      }
    }, { passive: true });

    dom.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastPinchDist > 0) {
          const delta = (lastPinchDist - dist) * 0.06;
          this.zoomBy(delta);
        }
        lastPinchDist = dist;
      } else if (touchOrbitId !== null) {
        for (let i = 0; i < e.touches.length; i++) {
          const t = e.touches[i];
          if (t.identifier === touchOrbitId) {
            const dx = t.clientX - touchPrevX;
            const dy = t.clientY - touchPrevY;
            touchPrevX = t.clientX;
            touchPrevY = t.clientY;
            this.cameraYaw -= dx * 0.008;
            this.cameraPitch = Math.max(0.45, Math.min(1.35, this.cameraPitch + dy * 0.006));
            break;
          }
        }
      }
    }, { passive: true });

    dom.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) lastPinchDist = 0;
      if (e.touches.length === 0) touchOrbitId = null;
    }, { passive: true });

    // D. Keyboard Q / E Camera Rotate & +/- Zoom
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'q') this.rotateBy(-0.35);
      else if (k === 'e') this.rotateBy(0.35);
      else if (k === '=' || k === '+') this.zoomBy(-3.0);
      else if (k === '-' || k === '_') this.zoomBy(3.0);
    });
  }

  zoomBy(delta) {
    this.cameraDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.cameraDistance + delta));
  }

  rotateBy(deltaYaw) {
    this.cameraYaw += deltaYaw;
  }

  toggleTacticalOverview() {
    this.isOverviewMode = !this.isOverviewMode;
    if (this.isOverviewMode) {
      this.cameraDistance = 38.0;
      this.cameraPitch = 1.15;
      this.cameraYaw = 0;
    } else {
      this.cameraDistance = 24.5;
      this.cameraPitch = 0.88;
      this.cameraYaw = 0;
    }
    return this.isOverviewMode;
  }

  setupLighting() {
    const hemiLight = new THREE.HemisphereLight(0xaabbee, 0x38284c, 1.9);
    this.scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0x4d3f72, 1.75);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffe8cc, 2.3);
    dirLight.position.set(18, 42, 30);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 140;
    const d = 55;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    this.scene.add(dirLight);

    // Personal Hero Torch Light (Follows player everywhere)
    this.heroLight = new THREE.PointLight(0xffdd99, 4.2, 26, 1.1);
    this.heroLight.position.set(0, 5.0, 15);
    this.scene.add(this.heroLight);

    // Multi-Wing Ambient Point Lights (Atrium, Crossroads, West Blood Wing, East Arcane Wing, Bridge, Boss Sanctum)
    this.torches = [];
    const wingLightNodes = [
      { x: 0, y: 5.0, z: 19, color: 0xff9944, intensity: 3.0, dist: 28 },    // Atrium
      { x: 0, y: 5.5, z: -14, color: 0xffaa44, intensity: 3.5, dist: 34 },   // Grand Crossroads
      { x: -42, y: 5.5, z: -14, color: 0xff3355, intensity: 3.8, dist: 32 }, // West Blood Reliquary
      { x: 42, y: 5.5, z: -14, color: 0x3399ff, intensity: 3.8, dist: 32 },  // East Alchemist's Vault
      { x: 0, y: 4.5, z: -34, color: 0xff5511, intensity: 3.2, dist: 26 },   // Abyssal Bridge
      { x: 0, y: 5.0, z: -49, color: 0x66aaff, intensity: 3.2, dist: 28 },   // Antechamber of Chains
      { x: 0, y: 6.0, z: -75, color: 0xff4400, intensity: 5.0, dist: 46 }    // Soul-Forge Boss Sanctum
    ];

    wingLightNodes.forEach((node) => {
      const light = new THREE.PointLight(node.color, node.intensity, node.dist, 1.2);
      light.position.set(node.x, node.y, node.z);
      this.scene.add(light);
      this.torches.push({ light, baseIntensity: node.intensity, phase: Math.random() * 10 });
    });
  }

  setupAtmospherics() {
    const particleCount = 240;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 95;
      positions[i * 3 + 1] = Math.random() * 5.0 + 0.3;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 115 - 30;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffbb55,
      size: 0.3,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });

    this.emberParticles = new THREE.Points(geometry, material);
    this.scene.add(this.emberParticles);
  }

  triggerScreenShake(magnitude = 0.5) {
    this.traumaShake.addTrauma(magnitude);
  }

  addTrauma(amount) {
    this.traumaShake.addTrauma(amount);
  }

  triggerHitStop(ms = 60) {
    this.hitStop.trigger(ms);
  }

  setReducedMotion(enabled) {
    this.traumaShake.setReducedMotion(enabled);
    this.hitStop.setReducedMotion(enabled);
  }

  // ------------------------------------------------------------------
  // Post-processing (UnrealBloomPass) with quality tiers + auto-degrade
  // ------------------------------------------------------------------
  _setupPostProcessing() {
    const pr = this.renderer.getPixelRatio();
    // MSAA render target (WebGL2): keeps edges clean while compositing.
    const rt = new THREE.WebGLRenderTarget(
      Math.floor(this.width * pr), Math.floor(this.height * pr),
      { type: THREE.HalfFloatType, samples: 4 }
    );
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      this.userBloom, // strength
      0.55,           // radius
      0.82            // threshold
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  // The settings slider calls this (previously missing -> runtime crash).
  setBloomIntensity(value) {
    this.userBloom = Math.max(0, Math.min(1, Number(value) || 0));
    this._applyQuality();
  }

  // mode: 'auto' | 'off' | 'low' | 'high'
  setQuality(mode) {
    if (!['auto', 'off', 'low', 'high'].includes(mode)) return;
    this.qualityMode = mode;
    if (mode !== 'auto') {
      this.qualityEffective = mode;
      this._applyQuality();
    } else {
      this.qualityEffective = 'high';
      this._autoTuneCooldown = 0;
      this._applyQuality();
    }
  }

  _applyQuality() {
    const q = this.qualityEffective;
    if (q === 'off') {
      this.renderer.setPixelRatio(1);
      // composer unused; nothing else to touch
    } else {
      const pr = q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1;
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this.composer.setSize(this.width, this.height);
      this.bloomPass.strength = q === 'high' ? this.userBloom : this.userBloom * 0.55;
      this.bloomPass.threshold = q === 'high' ? 0.82 : 0.88;
      this.bloomPass.radius = 0.55;
    }
  }

  // Called every frame from the main loop with PerformanceMonitor's rolling
  // average. In 'auto' mode this steps the tier down quickly when fps tanks
  // and steps it back up only after sustained good frames.
  autoTuneQuality(avgFps, dt) {
    if (this.qualityMode !== 'auto') return;
    this._autoTuneTimer += dt;
    this._autoTuneCooldown = Math.max(0, this._autoTuneCooldown - dt);
    if (this._autoTuneTimer < 2.0) return;
    this._autoTuneTimer = 0;
    const next = nextQualityTier(this.qualityEffective, avgFps);
    if (next !== this.qualityEffective) {
      // Step-ups need a calm period so the tier doesn't oscillate.
      const steppingUp = ['off', 'low', 'high'].indexOf(next) > ['off', 'low', 'high'].indexOf(this.qualityEffective);
      if (steppingUp && this._autoTuneCooldown > 0) return;
      this.qualityEffective = next;
      this._autoTuneCooldown = steppingUp ? 8 : 0;
      this._applyQuality();
    }
  }

  startKillCam(x, z) {
    this.killCamActive = true;
    this.killCamTimer = 3.5; // 3.5s dramatic orbit, then returns control to player
    this.killCamCenter.set(x, 1.5, z);
    this.killCamAngle = 0;
  }

  // Called by the main loop before any simulation updates. Advances the
  // hit-stop clock and returns the timescale-scaled dt for the frame.
  beginFrame(rawDt) {
    this.timeScale = this.hitStop.update(rawDt);
    return rawDt * this.timeScale;
  }

  update(dt, followTargetPos = null) {
    // Hit-stop: timescale dips to 0 on heavy hits, then ramps back. The main
    // loop scales simulation dt by this.timeScale (see beginFrame); here we
    // freeze the camera too so the whole frame holds for the stop window.
    if (this.timeScale <= 0.001) return;

    const time = performance.now() * 0.001;

    // 1. Torch Light Flicker
    for (const t of this.torches) {
      const flicker = Math.sin(time * 6 + t.phase) * 0.22;
      t.light.intensity = t.baseIntensity + flicker;
    }

    // 2. Animate Floating Sparks
    if (this.emberParticles) {
      const posAttr = this.emberParticles.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) + dt * 0.45;
        if (y > 5.5) y = 0.2;
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
    }

    // 3. Camera Tracking & Orbit Controls
    if (this.killCamActive) {
      this.killCamTimer -= dt;
      this.killCamAngle += dt * 0.85;
      const radius = 15.5;
      const camX = this.killCamCenter.x + Math.sin(this.killCamAngle) * radius;
      const camZ = this.killCamCenter.z + Math.cos(this.killCamAngle) * radius;
      this.camera.position.set(camX, 11.5, camZ);
      this.camera.lookAt(this.killCamCenter);

      if (this.killCamTimer <= 0) {
        this.killCamActive = false;
      }
    } else if (followTargetPos) {
      this.cameraTarget.lerp(followTargetPos, 0.22);

      const horizDist = this.cameraDistance * Math.cos(this.cameraPitch);
      const vertDist = this.cameraDistance * Math.sin(this.cameraPitch);
      const offsetX = Math.sin(this.cameraYaw) * horizDist;
      const offsetZ = Math.cos(this.cameraYaw) * horizDist;

      this._desiredCamPos.set(
        this.cameraTarget.x + offsetX,
        this.cameraTarget.y + vertDist,
        this.cameraTarget.z + offsetZ
      );

      this.camera.position.lerp(this._desiredCamPos, 0.22);
      this.camera.lookAt(this.cameraTarget);

      if (this.heroLight) {
        this.heroLight.position.set(this.cameraTarget.x, 5.0, this.cameraTarget.z + 1.0);
      }
    }

    // 4. Trauma Screen Shake: translational + rotational, magnitude = trauma^2.
    // Zero allocation: writes into _shakeOut, applied via direct components.
    this.traumaShake.update(dt, this._shakeOut);
    const s = this._shakeOut;
    if (s.ox !== 0 || s.oy !== 0 || s.oz !== 0) {
      this.camera.position.x += s.ox;
      this.camera.position.y += s.oy;
      this.camera.position.z += s.oz;
      this.camera.rotation.z += s.roll;
      this.camera.rotation.x += s.pitch;
      this.camera.rotation.y += s.yaw;
    }

    // 5. Render: bloom composer, or direct when quality is off.
    if (this.qualityEffective === 'off') {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render();
    }
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    if (this.composer) this.composer.setSize(this.width, this.height);
  }
}

// Pure auto-degrade decision: exported for headless testing.
export function nextQualityTier(current, avgFps) {
  const order = ['off', 'low', 'high'];
  const idx = order.indexOf(current);
  if (avgFps < 27 && idx > 0) return order[idx - 1];        // degrade fast
  if (avgFps > 55 && idx < order.length - 1) return order[idx + 1]; // recover slowly
  return current;
}
