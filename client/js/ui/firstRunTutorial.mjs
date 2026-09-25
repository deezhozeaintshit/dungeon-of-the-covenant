// ui/firstRunTutorial.js — Track 3 UX: first-run onboarding overlay.
//
// Shown once on first run (localStorage flag `dotc_tutorial_seen`) when the
// player enters the dungeon. Uses the shared TutorialSystem with step
// definitions taken from the real HUD/control facts:
//   - joystick zone: #joystick-zone (touch) / WASD-arrows (desktop)
//   - attack button: #btn-attack
//   - abilities: .abilities-zone (skill 1/2/3, Shift dash, Space jump)
//   - objective line: #hud-quest-banner
//   - boss reward: Malakor's Molten Relic epic chest + TAP TO CLAIM
// Skippable at any point (SKIP TUTORIAL button or Esc). The flag is set on
// both finish and skip, so it never shows again.

export const TUTORIAL_SEEN_KEY = 'dotc_tutorial_seen';

const STEPS = [
  {
    title: '🕹️ MOVE',
    text: 'Drag the virtual joystick (bottom-left) to move your hero. On desktop: WASD or arrow keys.',
    highlight: '#joystick-zone',
    nextText: 'NEXT'
  },
  {
    title: '⚔️ ATTACK',
    text: 'Tap the ⚔️ button (bottom-right) to attack — on desktop, click. Your hero auto-aims at the nearest foe.',
    highlight: '#btn-attack',
    nextText: 'NEXT'
  },
  {
    title: '✨ ABILITIES',
    text: 'Tap the skill buttons for your class abilities — keys 1 / 2 / 3 on desktop. SHIFT dashes (briefly invulnerable); SPACE jumps.',
    highlight: '.abilities-zone',
    nextText: 'NEXT'
  },
  {
    title: '🎯 OBJECTIVE',
    text: 'Watch the gold objective line at the top of the screen: slay the Warden, finish each objective, then press 🎲 NEXT FLOOR [N] to descend.',
    highlight: '#hud-quest-banner',
    nextText: 'NEXT'
  },
  {
    title: '🏆 BOSS REWARD',
    text: 'When Malakor falls, a golden relic chest rises with a light beam. Tap 👆 TAP TO CLAIM — or just walk over it — to claim your reward.',
    highlight: null,
    nextText: 'FINISH'
  }
];

function readSeen(storage) {
  try {
    return storage && storage.getItem(TUTORIAL_SEEN_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function writeSeen(storage) {
  try {
    if (storage) storage.setItem(TUTORIAL_SEEN_KEY, '1');
  } catch (e) { /* storage unavailable: tutorial may repeat next visit */ }
}

// Returns true when the tutorial was started.
export function maybeShowFirstRunTutorial(game, opts = {}) {
  const storage = opts.storage !== undefined
    ? opts.storage
    : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!game || !game.tutorial || typeof game.tutorial.registerSteps !== 'function') return false;
  if (readSeen(storage)) return false;
  // Never stack a second tutorial on top of an active one.
  if (game.tutorial.active) return false;

  const markSeen = () => writeSeen(storage);
  game.tutorial.on('onTutorialComplete', markSeen);
  game.tutorial.on('onTutorialSkip', markSeen);
  game.tutorial.registerSteps(STEPS.map(s => ({ ...s })));
  game.tutorial.start();
  return true;
}

export default { maybeShowFirstRunTutorial, TUTORIAL_SEEN_KEY };
