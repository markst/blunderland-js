import { MAX_YAW, type Shot } from '../ship/cannon';

/** Pulls shorter than this (px) are treated as a cancelled shot. */
const MIN_PULL = 18;
/** Full power at this share of the shorter screen side. */
const FULL_PULL_SHARE = 0.3;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Slingshot input, Angry Birds style: put a thumb down anywhere on the sea, pull back, release to fire.
 * Pulling straight down aims dead ahead; pulling down-left swings the shot to starboard (and vice versa);
 * the pull length sets the power. A rubber band is drawn from where the thumb went down to where it is now.
 */
export class Aim {
  /** The shot being pulled back, or null when no thumb is down (or the pull is too short to fire). */
  current: Shot | null = null;
  enabled = false;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private readonly band: SVGLineElement;
  private readonly anchor: SVGCircleElement;
  private readonly knob: SVGCircleElement;

  constructor(
    surface: HTMLElement,
    private readonly overlay: SVGSVGElement,
    private readonly onRelease: (shot: Shot) => void,
  ) {
    this.band = document.createElementNS(SVG_NS, 'line');
    this.band.setAttribute('class', 'band');
    this.anchor = document.createElementNS(SVG_NS, 'circle');
    this.anchor.setAttribute('class', 'anchor');
    this.anchor.setAttribute('r', '10');
    this.knob = document.createElementNS(SVG_NS, 'circle');
    this.knob.setAttribute('class', 'knob');
    this.knob.setAttribute('r', '16');
    overlay.append(this.band, this.anchor, this.knob);

    surface.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.pointerId !== null) return;
      e.preventDefault();
      surface.setPointerCapture(e.pointerId);
      this.pointerId = e.pointerId;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.current = null;
      this.draw(e.clientX, e.clientY);
      overlay.classList.add('active');
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.current = this.shotFor(e.clientX, e.clientY);
      this.draw(e.clientX, e.clientY);
    });
    surface.addEventListener('pointerup', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const shot = this.shotFor(e.clientX, e.clientY);
      this.end();
      if (shot) this.onRelease(shot);
    });
    surface.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.pointerId) this.end();
    });
  }

  private shotFor(x: number, y: number): Shot | null {
    const dx = x - this.startX;
    const dy = y - this.startY;
    const pull = Math.hypot(dx, dy);
    if (pull < MIN_PULL) return null;
    const full = Math.min(window.innerWidth, window.innerHeight) * FULL_PULL_SHARE;
    // Launch goes opposite the pull: pulling toward the bottom-left sends the ball ahead and to the right.
    const yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, Math.atan2(dx, dy)));
    return { yaw, power: Math.min(1, (pull - MIN_PULL) / (full - MIN_PULL)) };
  }

  private draw(x: number, y: number): void {
    this.band.setAttribute('x1', String(this.startX));
    this.band.setAttribute('y1', String(this.startY));
    this.band.setAttribute('x2', String(x));
    this.band.setAttribute('y2', String(y));
    this.anchor.setAttribute('cx', String(this.startX));
    this.anchor.setAttribute('cy', String(this.startY));
    this.knob.setAttribute('cx', String(x));
    this.knob.setAttribute('cy', String(y));
  }

  private end(): void {
    this.pointerId = null;
    this.current = null;
    this.overlay.classList.remove('active');
  }
}
