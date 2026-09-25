// characterLighting.js — Character rim/back lighting rig + blob contact shadows.
//
// Two cheap, mobile-friendly tricks that sell "AAA" more than anything else:
//
//   1. RIM LIGHT: one THREE.DirectionalLight living on layer 1 ONLY. Character
//      meshes get layer 1 enabled (enableCharacterLightLayer), dungeon meshes
//      stay on layer 0, so the rim light never touches the environment. The
//      camera must also enable layer 1 (coordinator: camera.layers.enable(1)).
//      Each frame the light is repositioned opposite the camera azimuth so
//      characters always get a cool back-edge highlight facing the player.
//
//   2. BLOB SHADOWS: radial-gradient canvas texture planes under each character.
//      Cheaper than shadow-map acne at glancing angles and they ground the
//      character even when the real shadow map is soft. They counter-rotate so
//      they stay flat on the floor when a hero is tipped (downed).
//
// Init (coordinator, once):
//   initCharacterRimLight(scene, camera)
// Per-frame (EntityManager.update):
//   updateCharacterLighting(dt, elapsedTime)
// Per character (EntityManager builders):
//   enableCharacterLightLayer(group); attachBlobShadow(group, radius, opacity)

import * as THREE from '/vendor/three.module.js';

let _blobTexture = null;
const _shadowRecords = []; // { group, mesh }

const _rim = {
  light: null,
  camera: null,
  baseIntensity: 2.1
};

const _tmpFwd = new THREE.Vector3();
const _tmpTarget = new THREE.Vector3();

// --- Blob contact shadows ---------------------------------------------------

export function getBlobShadowTexture() {
  if (_blobTexture) return _blobTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.34)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _blobTexture = new THREE.CanvasTexture(c);
  return _blobTexture;
}

export function attachBlobShadow(group, radius = 1.15, opacity = 0.6, y = 0.025) {
  const mat = new THREE.MeshBasicMaterial({
    map: getBlobShadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = 1;
  group.add(mesh);
  const rec = { group, mesh };
  _shadowRecords.push(rec);
  return mesh;
}

function pruneShadowRecords() {
  for (let i = _shadowRecords.length - 1; i >= 0; i--) {
    const rec = _shadowRecords[i];
    if (!rec.group.parent || !rec.mesh.parent) {
      rec.mesh.geometry.dispose();
      rec.mesh.material.dispose();
      _shadowRecords.splice(i, 1);
    }
  }
}

export function updateBlobShadows() {
  pruneShadowRecords();
  for (const rec of _shadowRecords) {
    // Stay flat on the floor even when the parent group tips (downed heroes).
    rec.mesh.rotation.x = -Math.PI / 2 - rec.group.rotation.x;
    rec.mesh.rotation.y = -rec.group.rotation.y;
    rec.mesh.visible = rec.group.visible;
  }
}

// --- Rim / back light rig ----------------------------------------------------

export function initCharacterRimLight(scene, camera, options = {}) {
  if (_rim.light) {
    _rim.camera = camera;
    return _rim.light;
  }
  const color = options.color !== undefined ? options.color : 0x7fb2ff;
  const intensity = options.intensity !== undefined ? options.intensity : _rim.baseIntensity;
  _rim.baseIntensity = intensity;
  const light = new THREE.DirectionalLight(color, intensity);
  light.layers.set(1); // characters only — dungeon meshes stay on layer 0
  light.castShadow = false;
  scene.add(light);
  scene.add(light.target);
  _rim.light = light;
  _rim.camera = camera;
  return light;
}

// Enable layer 1 on every mesh/sprite in a character group so the rim light
// (and only the rim light) picks them up in addition to the scene lights.
export function enableCharacterLightLayer(group) {
  group.traverse((o) => {
    if (o.isMesh || o.isSprite) o.layers.enable(1);
  });
}

const _up = new THREE.Vector3(0, 1, 0);

export function updateCharacterRimLight(elapsed) {
  if (!_rim.light || !_rim.camera) return;
  const cam = _rim.camera;
  cam.getWorldDirection(_tmpFwd);
  // Aim the rim target a little ahead of the camera, then park the light
  // behind the characters relative to the view direction: cool edge highlight.
  _tmpTarget.copy(cam.position).addScaledVector(_tmpFwd, 14);
  _rim.light.target.position.copy(_tmpTarget);
  const behind = _tmpTarget.clone();
  behind.x -= _tmpFwd.x * 26;
  behind.z -= _tmpFwd.z * 26;
  behind.y += 20;
  _rim.light.position.copy(behind);
  _rim.light.intensity = _rim.baseIntensity + Math.sin(elapsed * 1.6) * 0.22;
}

// --- Combined per-frame driver ------------------------------------------------

export function updateCharacterLighting(dt, elapsed) {
  updateCharacterRimLight(elapsed);
  updateBlobShadows();
}
