import { addSurge, advanceSurges, type WaveState } from './waves';

/**
 * Liquid feel for the sea, like beer in a glass:
 * - the water plane follows the phone's tilt through an under-damped spring, so it lags a fast tilt,
 *   overshoots and settles; that lag drives a standing slosh wave;
 * - every quick tilt sends a surge rolling across the sea toward the newly lowered side.
 */

/** Spring stiffness (1/s²) and damping (1/s): ≈0.9 Hz wobble that settles in two or three swings. */
const STIFFNESS = 32;
const DAMPING = 3.4;
/** Slosh wave height (m) per degree the water lags behind the tilt, capped so rocking can't pump it up. */
const SLOSH_PER_DEG = 0.3;
const SLOSH_MAX = 1.2;
/** Beyond this the sea would tilt out of view; the boat still feels the full tilt. */
const MAX_VIEW_DEG = 35;

/** A surge rolls out each time the tilt has moved this far (°) since the last one, at most this often (s). */
const SURGE_TRIGGER_DEG = 4;
const SURGE_MIN_INTERVAL = 0.6;
/** Surge height (m) per degree of tilt change, capped. */
const SURGE_PER_DEG = 0.24;
const SURGE_MAX = 3.2;
/** Tilting at this rate (°/s) or faster gives a full-height surge; slow tilts give gentle ones. */
const SURGE_FULL_RATE = 40;

class Spring {
  value = 0;
  velocity = 0;

  update(target: number, dt: number): void {
    // Fixed sub-steps keep the integration stable on slow frames.
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += (STIFFNESS * (target - this.value) - DAMPING * this.velocity) * h;
      this.value += this.velocity * h;
    }
  }
}

export class SeaTilt {
  private readonly rollSpring = new Spring();
  private readonly pitchSpring = new Spring();
  /** Tilt at the last surge and time since it; the next surge measures its push from here. */
  private readonly anchor = { x: 0, y: 0 };
  private sinceSurge = Infinity;
  /** Previous tilt target, and the recent peak tilt speed (°/s), which fades over about a third of a second. */
  private readonly previous = { x: 0, y: 0 };
  private peakRate = 0;
  /** Lagged sea tilt in degrees: roll > 0 right side lower, pitch > 0 far side lower. */
  roll = 0;
  pitch = 0;

  /**
   * `delta`: tilt from neutral in degrees (see `tiltDelta`). Writes the slosh into `waves`, starts surges
   * (directed with `waves.right`/`waves.forward`) and rolls the existing ones on.
   */
  update(dt: number, delta: { x: number; y: number }, waves: WaveState): void {
    const targetRoll = Math.max(-MAX_VIEW_DEG, Math.min(MAX_VIEW_DEG, delta.x));
    const targetPitch = Math.max(-MAX_VIEW_DEG, Math.min(MAX_VIEW_DEG, delta.y));
    this.rollSpring.update(targetRoll, dt);
    this.pitchSpring.update(targetPitch, dt);
    this.roll = this.rollSpring.value;
    this.pitch = this.pitchSpring.value;
    // Water rushes toward the newly lowered side, then swings back.
    const sloshX = (targetRoll - this.roll) * SLOSH_PER_DEG;
    const sloshY = (targetPitch - this.pitch) * SLOSH_PER_DEG;
    waves.slosh.set(Math.max(-SLOSH_MAX, Math.min(SLOSH_MAX, sloshX)), Math.max(-SLOSH_MAX, Math.min(SLOSH_MAX, sloshY)));

    const frameRate = Math.hypot(targetRoll - this.previous.x, targetPitch - this.previous.y) / Math.max(dt, 1e-3);
    this.peakRate = Math.max(frameRate, this.peakRate * Math.exp(-dt / 0.3));
    this.previous.x = targetRoll;
    this.previous.y = targetPitch;

    this.sinceSurge += dt;
    const dx = targetRoll - this.anchor.x;
    const dy = targetPitch - this.anchor.y;
    const change = Math.hypot(dx, dy);
    if (change >= SURGE_TRIGGER_DEG && this.sinceSurge >= SURGE_MIN_INTERVAL) {
      const quickness = Math.min(1, Math.max(0.25, this.peakRate / SURGE_FULL_RATE));
      const amplitude = Math.min(SURGE_MAX, change * SURGE_PER_DEG * quickness);
      // Right side lower (dx > 0) sends water right; far side lower (dy > 0) sends it forward.
      const { right, forward } = waves;
      addSurge(waves, right.x * dx + forward.x * dy, right.y * dx + forward.y * dy, amplitude);
      this.anchor.x = targetRoll;
      this.anchor.y = targetPitch;
      this.sinceSurge = 0;
    }
    advanceSurges(waves, dt);
  }
}
