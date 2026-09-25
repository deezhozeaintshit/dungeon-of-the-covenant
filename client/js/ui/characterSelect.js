// ui/characterSelect.js — character-select enhancements layered on top of the
// existing main.js class grid. Does NOT rebuild the grid; main.js keeps
// ownership of .class-btn creation and selection state. This module adds:
//   - keyboard navigation (arrows + Enter) across the class cards
//   - a per-class "covenant oath" line injected once into the preview card
//   - role-based accent coloring on the preview card
// Takes the game's CLASSES table as an arg so it stays data-driven.

const CLASS_OATHS = {
  juggernaut: '“Stone breaks. I do not.”',
  cleric: '“Let the light judge what the dark has wrought.”',
  rogue: '“You will never see the blade that ends you.”',
  mage: '“The elements answer — and I never ask twice.”',
  ranger: '“One shot. One silence. One less shadow.”',
  necromancer: '“Death is merely a change of allegiance.”',
  plaguecaller: '“Breathe deep. The rot does the rest.”',
  gravewarden: '“The line holds because I am the line.”',
  hexblade: '“My blade remembers every shadow it has drunk.”',
};

const ROLE_ACCENTS = {
  Tank: '#d4af37',
  Healer: '#34d399',
  Rogue: '#9d4edd',
  Mage: '#f97316',
  Ranger: '#38bdf8',
  Necromancer: '#a3e635',
};

export function initCharacterSelect({ classes = {} } = {}) {
  const grid = document.getElementById('class-grid');
  const previewCard = document.getElementById('class-preview-card');
  if (!grid || !previewCard) return null;

  // Persistent oath footer — main.js only rewrites #preview-abilities, so this survives.
  let oathEl = previewCard.querySelector('.class-oath');
  if (!oathEl) {
    oathEl = document.createElement('p');
    oathEl.className = 'class-oath';
    previewCard.appendChild(oathEl);
  }

  function currentSelectedKey() {
    const sel = grid.querySelector('.class-btn.selected');
    return sel ? sel.getAttribute('data-class') : null;
  }

  function applyOath() {
    const key = currentSelectedKey();
    const info = classes[key];
    oathEl.textContent = CLASS_OATHS[key] || '';
    const accent = info ? ROLE_ACCENTS[info.role] || '#d4af37' : '#d4af37';
    previewCard.style.setProperty('--role-accent', accent);
    previewCard.style.borderColor = accent;
    const roleBadge = document.getElementById('preview-class-role');
    if (roleBadge) roleBadge.style.background = `linear-gradient(90deg, ${accent}, #ffd700)`;
  }

  // Keep oath in sync with main.js selection (click or programmatic).
  grid.addEventListener('click', () => requestAnimationFrame(applyOath), true);

  // Keyboard navigation across cards.
  grid.addEventListener('keydown', (e) => {
    const cards = Array.from(grid.querySelectorAll('.class-btn'));
    if (!cards.length) return;
    const idx = cards.indexOf(document.activeElement);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1 + cards.length) % cards.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + cards.length) % cards.length;
    else if ((e.key === 'Enter' || e.key === ' ') && idx >= 0) {
      e.preventDefault();
      cards[idx].click();
      return;
    } else return;
    e.preventDefault();
    cards[next].focus();
  });

  // main.js repopulates the grid on init; make cards focusable whenever it does.
  const makeFocusable = () => {
    grid.querySelectorAll('.class-btn').forEach(b => {
      if (!b.hasAttribute('tabindex')) b.setAttribute('tabindex', '0');
      if (!b.getAttribute('role')) b.setAttribute('role', 'radio');
    });
    applyOath();
  };
  const observer = new MutationObserver(makeFocusable);
  observer.observe(grid, { childList: true });

  makeFocusable();

  return { refresh: applyOath, destroy: () => observer.disconnect() };
}

export default { initCharacterSelect };
