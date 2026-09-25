// ui/objectiveLine.mjs — Track 3 UX: pure formatter for the persistent
// top-of-HUD current-objective line. DOM-free so headless tests can import
// it directly. Warden names mirror server/game/systems/Objectives.js WARDENS;
// relic/altar wording mirrors the RECOVER_RELIC server description.

export const WARDEN_NAMES = {
  elite_executioner: 'Vorgath, Bone-Executioner',
  elite_lich: 'Arch-Lich Malthor'
};

// objectives: array of server _snap() shapes { type, state, primary,
// progress:{current,target}, timeRemaining, carrierId, wardenType, name }.
// Returns a one-line directive, or null when there is nothing to summarize
// (caller falls back to the legacy quest-flow text).
export function objectiveLineFor(objectives) {
  const list = Array.isArray(objectives) ? objectives : [];
  if (list.length === 0) return null;
  const active = list.filter(o => o && o.state === 'active');
  const pick = active.find(o => o.primary) || active[0];
  if (!pick) {
    // All objectives resolved on this floor — point at the next floor.
    return '🚪 Objectives complete — hit 🎲 NEXT FLOOR [N] to descend';
  }
  const cur = pick.progress ? pick.progress.current : 0;
  const tgt = pick.progress ? pick.progress.target : 0;
  if (pick.type === 'SLAY_WARDEN') {
    const wardenName = WARDEN_NAMES[pick.wardenType] || WARDEN_NAMES.elite_executioner;
    return `⚔️ Defeat ${wardenName} (${cur}/${tgt})`;
  }
  if (pick.type === 'DESTROY_SHRINES') {
    return `💥 Shatter the Shrines (${cur}/${tgt})`;
  }
  if (pick.type === 'RECOVER_RELIC') {
    return pick.carrierId
      ? '🏺 Carry the Relic to the Extraction Altar'
      : '🏺 Find the Relic — East Wing Vault';
  }
  if (pick.type === 'SURVIVE_AMBUSH') {
    const s = pick.timeRemaining != null ? pick.timeRemaining : tgt;
    return `🛡️ Survive the Ambush — ${s}s left`;
  }
  return `🎯 ${pick.name || 'Objective'} (${cur}/${tgt})`;
}

export default { objectiveLineFor, WARDEN_NAMES };
