// renderer.js - Three.js PBR Graphics, Farther Tactical Camera, Orbit/Zoom Camera Controls & Wing Lighting
import * as THREE from '/vendor/three.module.js';

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

    // 6. Camera Screen Shake & Hit-Stop
    this.shakeIntensity = 0;
    this.shakeDecay = 0.9;
    this.hitStopDuration = 0;

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
    this.shakeIntensity = Math.max(this.shakeIntensity, magnitude);
  }

  triggerHitStop(ms = 60) {
    this.hitStopDuration = ms / 1000;
  }

  startKillCam(x, z) {
    this.killCamActive = true;
    this.killCamTimer = 3.5; // 3.5s dramatic orbit, then returns control to player
    this.killCamCenter.set(x, 1.5, z);
    this.killCamAngle = 0;
  }

  update(dt, followTargetPos = null) {
    if (this.hitStopDuration > 0) {
      this.hitStopDuration -= dt;
      return;
    }

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

      const desiredCamPos = new THREE.Vector3(
        this.cameraTarget.x + offsetX,
        this.cameraTarget.y + vertDist,
        this.cameraTarget.z + offsetZ
      );

      this.camera.position.lerp(desiredCamPos, 0.22);
      this.camera.lookAt(this.cameraTarget);

      if (this.heroLight) {
        this.heroLight.position.set(this.cameraTarget.x, 5.0, this.cameraTarget.z + 1.0);
      }
    }

    // 4. Screen Shake Offset
    if (this.shakeIntensity > 0.01) {
      const ox = (Math.random() - 0.5) * this.shakeIntensity;
      const oy = (Math.random() - 0.5) * this.shakeIntensity;
      const oz = (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.add(new THREE.Vector3(ox, oy, oz));
      this.shakeIntensity *= this.shakeDecay;
    } else {
      this.shakeIntensity = 0;
    }

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }
}
