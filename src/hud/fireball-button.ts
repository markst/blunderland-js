import type { FireballCharge } from '../ship/fireball-charge';

/**
 * The fireball button: tap to load the fireball for the next shot (it glows while armed). While it recharges,
 * a ring fills round it and the seconds left count down.
 */
export function createFireballButton(button: HTMLButtonElement, charge: FireballCharge): { update(): void } {
  const timer = button.querySelector('.timer');
  button.addEventListener('click', () => charge.toggle());
  return {
    update() {
      button.classList.toggle('armed', charge.armed);
      button.classList.toggle('ready', charge.ready);
      button.style.setProperty('--charge', `${(charge.progress * 360).toFixed(1)}deg`);
      if (timer) timer.textContent = charge.ready ? '' : String(Math.ceil(charge.remaining));
    },
  };
}
