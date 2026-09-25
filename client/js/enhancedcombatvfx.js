// EnhancedCombatVFX.js - AAA Particle Effects and Post-Processing
// Implements advanced visual effects for combat and abilities

import * as THREE from '/vendor/three.module.js';
import { EffectComposer } from '/vendor/EffectComposer.js';
import { RenderPass } from '/vendor/RenderPass.js';
import { UnrealBloomPass } from '/vendor/UnrealBloomPass.js';
import { SMAAPass } from '/vendor/SMAAPass.js';

export class EnhancedCombatVFX {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    
    this.particleSystems = new Map();
    this.activeEffects = [];
    this.spellEffects = new Map();
    
    // Post-processing setup
    this.setupPostProcessing();
  }

  setupPostProcessing() {
    // Render target
    this.renderTarget = new THREE.WebGLRenderTarget(
      this.renderer.domElement.width,
      this.renderer.domElement.height,
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType
      }
    );

    // Composer
    this.composer = new EffectComposer(this.renderer);
    
    // Render pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // Bloom pass
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.renderer.domElement.width, this.renderer.domElement.height),
      0.9,      // strength
      0.5,      // radius
      0.85      // threshold
    );
    this.composer.addPass(this.bloomPass);

    // SMAA anti-aliasing
    const smaaPass = new SMAAPass(
      this.renderer.domElement.width,
      this.renderer.domElement.height
    );
    this.composer.addPass(smaaPass);
  }

  // Create particle system
  createParticleSystem(config) {
    const system = {
      id: config.id || `particle_${Date.now()}`,
      particles: [],
      maxParticles: config.maxParticles || 100,
      lifetime: config.lifetime || 2.0,
      emissionRate: config.emissionRate || 10,
      position: new THREE.Vector3(config.x || 0, config.y || 0, config.z || 0),
      velocity: new THREE.Vector3(config.vx || 0, config.vy || 0, config.vz || 0),
      color: new THREE.Color(config.color || 0xffaa00),
      size: config.size || 0.3,
      gravity: config.gravity || 0,
      drag: config.drag || 0.98,
      blending: config.blending || THREE.AdditiveBlending,
      transparent: config.transparent !== false,
      opacity: config.opacity !== undefined ? config.opacity : 1.0,
      autoDelete: config.autoDelete !== false,
      lifeLeft: config.lifeLeft || Infinity,
      elapsed: 0
    };

    // Create mesh container
    const mesh = new THREE.Group();
    mesh.position.copy(system.position);
    this.scene.add(mesh);
    system.mesh = mesh;

    this.particleSystems.set(system.id, system);
    return system;
  }

  // Emit particles
  emit(system, count = 1) {
    for (let i = 0; i < count; i++) {
      if (system.particles.length >= system.maxParticles) {
        system.particles.shift();
      }

      const particle = {
        position: system.position.clone(),
        velocity: system.velocity.clone().add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
          )
        ),
        life: system.lifetime * (0.5 + Math.random() * 0.5),
        maxLife: system.lifetime,
        size: system.size * (0.5 + Math.random() * 0.5),
        opacity: system.opacity,
        color: system.color.clone()
      };

      system.particles.push(particle);
    }
  }

  // Update all particle systems
  update(dt) {
    for (const [id, system] of this.particleSystems) {
      system.elapsed += dt;

      // Emit new particles
      if (system.particles.length < system.maxParticles) {
        this.emit(system, Math.ceil(system.emissionRate * dt));
      }

      // Update particles
      for (let i = system.particles.length - 1; i >= 0; i--) {
        const p = system.particles[i];
        p.life -= dt;

        // Apply physics
        p.velocity.y -= system.gravity * dt;
        p.velocity.multiplyScalar(system.drag);
        p.position.add(p.velocity.clone().multiplyScalar(dt));

        // Update mesh
        if (!system.mesh.children[i]) {
          const geo = new THREE.SphereGeometry(0.1, 6, 6);
          const mat = new THREE.MeshBasicMaterial({
            color: p.color,
            transparent: true,
            opacity: p.opacity,
            blending: system.blending
          });
          const mesh = new THREE.Mesh(geo, mat);
          system.mesh.add(mesh);
        }

        const mesh = system.mesh.children[i];
        if (mesh) {
          mesh.position.copy(p.position);
          const lifeRatio = p.life / p.maxLife;
          mesh.scale.setScalar(lifeRatio * p.size * 5);
          mesh.material.opacity = lifeRatio * p.opacity;
        }

        // Remove dead particles
        if (p.life <= 0) {
          if (system.mesh.children[i]) {
            system.mesh.remove(system.mesh.children[i]);
          }
          system.particles.splice(i, 1);
        }
      }

      // Auto-delete if expired
      if (system.autoDelete && system.lifeLeft !== Infinity) {
        system.lifeLeft -= dt;
        if (system.lifeLeft <= 0) {
          this.deleteSystem(id);
        }
      }
    }
  }

  // Delete particle system
  deleteSystem(id) {
    const system = this.particleSystems.get(id);
    if (system) {
      this.scene.remove(system.mesh);
      this.particleSystems.delete(id);
    }
  }

  // Clear all systems
  clearAll() {
    for (const id of this.particleSystems.keys()) {
      this.deleteSystem(id);
    }
  }

  // Preset: Fire explosion
  createFireExplosion(x, y, z) {
    const system = this.createParticleSystem({
      id: `fire_${Date.now()}`,
      x, y, z,
      maxParticles: 50,
      lifetime: 1.5,
      emissionRate: 30,
      color: 0xff4400,
      size: 0.5,
      gravity: -2,
      drag: 0.95,
      blending: THREE.AdditiveBlending,
      lifeLeft: 2.0
    });
    system.velocity.set(
      (Math.random() - 0.5) * 5,
      Math.random() * 5 + 2,
      (Math.random() - 0.5) * 5
    );
    this.emit(system, 30);
    return system;
  }

  // Preset: Magic spell
  createMagicSpell(x, y, z, color = 0x8844ff) {
    const system = this.createParticleSystem({
      id: `magic_${Date.now()}`,
      x, y, z,
      maxParticles: 30,
      lifetime: 2.0,
      emissionRate: 15,
      color,
      size: 0.3,
      gravity: 0,
      drag: 0.97,
      blending: THREE.AdditiveBlending,
      lifeLeft: 2.5
    });

    // Ring emission
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const particle = {
        position: system.position.clone(),
        velocity: new THREE.Vector3(
          Math.cos(angle) * 3,
          Math.random() * 2,
          Math.sin(angle) * 3
        ),
        life: 1.5,
        maxLife: 2.0,
        size: 0.25,
        opacity: 0.8,
        color: new THREE.Color(color)
      };
      system.particles.push(particle);
    }
    return system;
  }

  // Preset: Heal effect
  createHealEffect(x, y, z) {
    const system = this.createParticleSystem({
      id: `heal_${Date.now()}`,
      x, y, z,
      maxParticles: 20,
      lifetime: 2.5,
      emissionRate: 8,
      color: 0x44ff88,
      size: 0.4,
      gravity: 1,
      drag: 0.96,
      blending: THREE.AdditiveBlending,
      lifeLeft: 3.0
    });

    // Rising particles
    for (let i = 0; i < 15; i++) {
      const particle = {
        position: system.position.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          Math.random() * 2,
          (Math.random() - 0.5) * 2
        )),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 1,
          Math.random() * 2 + 1,
          (Math.random() - 0.5) * 1
        ),
        life: 2.0,
        maxLife: 2.5,
        size: 0.3,
        opacity: 0.7,
        color: new THREE.Color(0x44ff88)
      };
      system.particles.push(particle);
    }
    return system;
  }

  // Preset: Blood splash
  createBloodSplash(x, y, z) {
    const system = this.createParticleSystem({
      id: `blood_${Date.now()}`,
      x, y, z,
      maxParticles: 40,
      lifetime: 1.0,
      emissionRate: 20,
      color: 0xcc0000,
      size: 0.2,
      gravity: -5,
      drag: 0.9,
      blending: THREE.NormalBlending,
      lifeLeft: 1.5
    });
    this.emit(system, 25);
    return system;
  }

  // Preset: Frost nova
  createFrostNova(x, y, z) {
    const system = this.createParticleSystem({
      id: `frost_${Date.now()}`,
      x, y, z,
      maxParticles: 60,
      lifetime: 2.0,
      emissionRate: 30,
      color: 0x88ddff,
      size: 0.25,
      gravity: 0,
      drag: 0.95,
      blending: THREE.AdditiveBlending,
      lifeLeft: 2.5
    });

    // Expanding ring
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      const particle = {
        position: system.position.clone(),
        velocity: new THREE.Vector3(
          Math.cos(angle) * 4,
          Math.random() * 1,
          Math.sin(angle) * 4
        ),
        life: 1.8,
        maxLife: 2.0,
        size: 0.2,
        opacity: 0.9,
        color: new THREE.Color(0x88ddff)
      };
      system.particles.push(particle);
    }
    return system;
  }

  // Preset: Bone spikes
  createBoneSpikes(startX, startZ, dirX, dirZ, length = 10) {
    const system = this.createParticleSystem({
      id: `bones_${Date.now()}`,
      x: startX, y: 0, z: startZ,
      maxParticles: 30,
      lifetime: 1.5,
      emissionRate: 20,
      color: 0xe8e2d4,
      size: 0.3,
      gravity: 0,
      drag: 0.9,
      blending: THREE.NormalBlending,
      lifeLeft: 1.8
    });

    // Linear emission
    for (let i = 0; i < 20; i++) {
      const dist = (i + 1) * (length / 20);
      const particle = {
        position: new THREE.Vector3(
          startX + dirX * dist + (Math.random() - 0.5) * 0.5,
          -1.0,
          startZ + dirZ * dist + (Math.random() - 0.5) * 0.5
        ),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 1,
          3 + Math.random() * 2,
          (Math.random() - 0.5) * 1
        ),
        life: 1.2,
        maxLife: 1.5,
        size: 0.25,
        opacity: 0.8,
        color: new THREE.Color(0xe8e2d4)
      };
      system.particles.push(particle);
    }
    return system;
  }

  // Preset: Corpse explosion
  createCorpseExplosion(x, y, z) {
    const system = this.createParticleSystem({
      id: `corpse_${Date.now()}`,
      x, y, z,
      maxParticles: 50,
      lifetime: 1.2,
      emissionRate: 40,
      color: 0x33ff66,
      size: 0.25,
      gravity: -3,
      drag: 0.85,
      blending: THREE.AdditiveBlending,
      lifeLeft: 1.5
    });

    // Radial explosion
    for (let i = 0; i < 40; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 3 + Math.random() * 4;
      const particle = {
        position: system.position.clone(),
        velocity: new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.sin(phi) * Math.sin(theta) * speed,
          Math.cos(phi) * speed
        ),
        life: 1.0,
        maxLife: 1.2,
        size: 0.2,
        opacity: 0.9,
        color: new THREE.Color(0x33ff66)
      };
      system.particles.push(particle);
    }
    return system;
  }

  // Preset: Seismic vortex
  createSeismicVortex(x, y, z) {
    const system = this.createParticleSystem({
      id: `vortex_${Date.now()}`,
      x, y, z,
      maxParticles: 40,
      lifetime: 2.0,
      emissionRate: 20,
      color: 0x886644,
      size: 0.35,
      gravity: 0,
      drag: 0.92,
      blending: THREE.NormalBlending,
      lifeLeft: 2.5
    });

    // Spiral emission
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 4;
      const radius = 1 + (i / 30) * 3;
      const particle = {
        position: system.position.clone(),
        velocity: new THREE.Vector3(
          Math.cos(angle) * radius * 0.5,
          Math.random() * 2,
          Math.sin(angle) * radius * 0.5
        ),
        life: 1.8,
        maxLife: 2.0,
        size: 0.3,
        opacity: 0.8,
        color: new THREE.Color(0x886644)
      };
      system.particles.push(particle);
    }
    return system;
  }

  // Preset: Meteor strike
  createMeteorStrike(x, y, z) {
    const system = this.createParticleSystem({
      id: `meteor_${Date.now()}`,
      x, y, z,
      maxParticles: 60,
      lifetime: 2.5,
      emissionRate: 25,
      color: 0xff6600,
      size: 0.5,
      gravity: -8,
      drag: 0.9,
      blending: THREE.AdditiveBlending,
      lifeLeft: 3.0
    });

    // Falling then exploding
    for (let i = 0; i < 50; i++) {
      const particle = {
        position: new THREE.Vector3(
          x + (Math.random() - 0.5) * 4,
          15 + Math.random() * 10,
          z + (Math.random() - 0.5) * 4
        ),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          -8 - Math.random() * 4,
          (Math.random() - 0.5) * 2
        ),
        life: 2.0,
        maxLife: 2.5,
        size: 0.4,
        opacity: 1.0,
        color: new THREE.Color(0xff6600)
      };
      system.particles.push(particle);
    }
    return system;
  }

  // Render with post-processing
  render() {
    this.composer.render();
  }

  // Set bloom intensity
  setBloomIntensity(intensity) {
    this.bloomPass.strength = intensity;
  }

  // Cleanup
  dispose() {
    this.clearAll();
    this.composer.dispose();
    this.renderTarget.dispose();
  }
}
