/** Seconds between fireballs. */
export const FIREBALL_COOLDOWN = 60;

/**
 * The special fireball shot: one is ready at the start, tapping arms it so the next shot is a fireball, and
 * firing it starts a 60 s recharge. Ordinary cannonballs are unaffected.
 */
export class FireballCharge {
  /** Seconds until the next fireball is ready (0 = ready). */
  remaining = 0;
  /** Whether the next shot will be the fireball. */
  armed = false;

  get ready(): boolean {
    return this.remaining <= 0;
  }

  /** Share of the recharge done, 0 → 1 (1 = ready). */
  get progress(): number {
    return 1 - this.remaining / FIREBALL_COOLDOWN;
  }

  /** Arms or disarms the fireball; does nothing while it is recharging. */
  toggle(): void {
    if (this.ready) this.armed = !this.armed;
  }

  /** The armed fireball was fired: start recharging. */
  spend(): void {
    this.armed = false;
    this.remaining = FIREBALL_COOLDOWN;
  }

  update(dt: number): void {
    this.remaining = Math.max(0, this.remaining - dt);
  }
}
