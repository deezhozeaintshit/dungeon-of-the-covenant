// cosmetics.js — Phase 3 Cosmetic Shop client renderer.
//
// Applies purchased cosmetics to hero groups (local AND remote players):
//   - applyHeroSkin(group, skinDef)   — full-body recolor through the existing
//       character material pipeline (group.userData.pbrMats from
//       characterMaterials.js). Zero stat impact: only colors change.
//   - applyWeaponGlow(group, glowDef) — recolors the emissive parts of the
//       hero's main weapon. Visual only.
//   - playEmote(group, emoteDef)     — plays an animation sequence through the
//       Phase 2 animation state machine (group.userData.animator).
//   - syncPlayerCosmetics(group, skinId, weaponGlow, skinDefs, glowDefs)
//       — idempotent per-frame sync called from EntityManager.syncPlayers,
//       mirroring the existing cosmetic-aura re-sync.
//
// Base material colors are cached on first touch (mat.userData._cosBase) so
// unequipping restores the exact class-default look. Never throws: a missing
// animator/material pipeline degrades to a no-op.

function cacheBase(mat) {
  if (!mat || !mat.isMeshStandardMaterial || mat.userData._cosBase) return;
  mat.userData._cosBase = {
    color: mat.color ? mat.color.getHex() : 0xffffff,
    emissive: mat.emissive ? mat.emissive.getHex() : 0x000000,
    emissiveIntensity: mat.emissiveIntensity || 0
  };
}

function restoreBase(mat) {
  const b = mat && mat.userData && mat.userData._cosBase;
  if (!b) return;
  if (mat.color) mat.color.setHex(b.color);
  if (mat.emissive) mat.emissive.setHex(b.emissive);
  mat.emissiveIntensity = b.emissiveIntensity;
  mat.needsUpdate = true;
}

// Classify a pbrMats record for skin retinting:
//   glow  -> skin glow color (emissive)
//   metal with hot emissive (>= 0.4) -> trim color (gold trim / knee / shield rim)
//   metal -> armor color
//   cloth -> cloth color
//   bone  -> untouched (skeleton parts keep their identity)
function skinTargetFor(rec, skin) {
  const { mat, kind } = rec;
  if (kind === 'glow') return { color: null, emissive: skin.glow, emissiveIntensity: 2.8 };
  if (kind === 'cloth') return { color: skin.cloth, emissive: null };
  if (kind === 'metal') {
    const hot = (mat.emissiveIntensity || 0) >= 0.4;
    return { color: hot ? skin.trim : skin.armor, emissive: hot ? skin.trim : null, emissiveIntensity: hot ? 0.45 : 0.22 };
  }
  return null;
}

export function applyHeroSkin(group, skinDef) {
  try {
    const u = group && group.userData;
    if (!u || !Array.isArray(u.pbrMats)) return false;
    const want = skinDef ? skinDef.id : null;
    if (u._activeSkinId === want) return true;
    u._activeSkinId = want;

    for (const rec of u.pbrMats) {
      const mat = rec.mat;
      if (!mat) continue;
      cacheBase(mat);
      if (!skinDef) {
        restoreBase(mat);
        continue;
      }
      const target = skinTargetFor(rec, skinDef.skin);
      if (!target) continue;
      if (target.color !== null && target.color !== undefined && mat.color) mat.color.setHex(target.color);
      if (target.emissive !== null && target.emissive !== undefined && mat.emissive) mat.emissive.setHex(target.emissive);
      if (target.emissiveIntensity !== undefined) mat.emissiveIntensity = target.emissiveIntensity;
      mat.needsUpdate = true;
    }
    return true;
  } catch (e) {
    console.warn('[cosmetics] applyHeroSkin failed:', e.message);
    return false;
  }
}

export function applyWeaponGlow(group, glowDef) {
  try {
    const u = group && group.userData;
    if (!u) return false;
    const want = glowDef ? glowDef.id : null;
    if (u._activeWeaponGlowId === want) return true;
    u._activeWeaponGlowId = want;

    const weapon = u.weaponGroup;
    if (!weapon) return true; // hero built before weapon ref — nothing to tint
    weapon.traverse((o) => {
      if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        if ((mat.emissiveIntensity || 0) < 1.6) continue; // glow parts only
        cacheBase(mat);
        if (!glowDef) {
          restoreBase(mat);
        } else {
          mat.emissive.setHex(glowDef.glow.color);
          if (mat.color) mat.color.setHex(glowDef.glow.color);
          mat.needsUpdate = true;
        }
      }
    });
    return true;
  } catch (e) {
    console.warn('[cosmetics] applyWeaponGlow failed:', e.message);
    return false;
  }
}

// Emotes: ordered one-shot state plays through the Phase 2 animator.
// Each state plays for emoteDef.holdMs; the per-frame locomotion sync in
// entities.js pulls the hero back to idle/walk/run afterwards, so emotes can
// never wedge the state machine.
export function playEmote(group, emoteDef) {
  try {
    const u = group && group.userData;
    const animator = u && u.animator;
    if (!animator || !emoteDef || !Array.isArray(emoteDef.emote.sequence)) return false;
    if (u._emotePlaying) return false; // don't stack emotes
    u._emotePlaying = true;

    const seq = emoteDef.emote.sequence;
    const hold = emoteDef.emote.holdMs || 800;
    seq.forEach((state, i) => {
      setTimeout(() => {
        try {
          if (state === 'attack') animator.play('attack', { layer: 'upper' });
          else animator.play(state);
        } catch (e) { /* animator hiccup: skip step */ }
        if (i === seq.length - 1) {
          setTimeout(() => { u._emotePlaying = false; }, hold);
        }
      }, i * hold);
    });
    return true;
  } catch (e) {
    console.warn('[cosmetics] playEmote failed:', e.message);
    return false;
  }
}

// Called every syncPlayers pass (like the aura re-sync). Applies skin + weapon
// glow when the snapshot's cosmetic ids change. Defs are looked up from the
// shop catalog by id; unknown ids are treated as "none".
export function syncPlayerCosmetics(group, skinId, weaponGlowId, defsById) {
  if (!group || !group.userData) return;
  const skinDef = (skinId && defsById.get(skinId)) || null;
  const glowDef = (weaponGlowId && defsById.get(weaponGlowId)) || null;
  applyHeroSkin(group, skinDef && skinDef.kind === 'skin' ? skinDef : null);
  applyWeaponGlow(group, glowDef && glowDef.kind === 'weaponGlow' ? glowDef : null);
}
