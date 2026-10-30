import { screenRelativeTilt, STEER, THROTTLE, tiltDelta, tiltToInput, type ScreenTilt } from './tilt';

type Direction = 'left' | 'right' | 'up' | 'down';

const KEY_DIRECTION: Record<string, Direction> = {
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
  ArrowUp: 'up',
  w: 'up',
  W: 'up',
  ArrowDown: 'down',
  s: 'down',
  S: 'down',
};

export class InputController {
  steer = 0;
  throttle = 0;
  /** Current tilt away from neutral in degrees (x: steer right, y: throttle forward); drives the sea's slosh. */
  readonly delta = { x: 0, y: 0 };
  mode: 'tilt' | 'keyboard' = 'keyboard';
  /** Phone upright with the screen facing the user; re-zeroed by `calibrate()`. */
  private neutral: ScreenTilt = { roll: 0, pitch: 0 };
  private latest: ScreenTilt | null = null;
  private readonly keys = new Set<string>();

  /** Must be called directly from a user-gesture handler (iOS permission rule). */
  async enableTilt(): Promise<'granted' | 'denied' | 'unsupported'> {
    if (!window.isSecureContext) return 'unsupported';
    if (!('DeviceOrientationEvent' in window)) return 'unsupported';

    // iOS 13+ only; other platforms grant access without a prompt.
    if ('requestPermission' in DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return 'denied';
      } catch {
        return 'denied';
      }
    }

    window.addEventListener('deviceorientation', (e) => {
      if (e.beta == null || e.gamma == null) return;
      // `window.orientation` covers older iOS without `screen.orientation`.
      const angle = screen.orientation?.angle ?? window.orientation ?? 0;
      this.latest = screenRelativeTilt({ beta: e.beta, gamma: e.gamma }, angle);
    });
    this.mode = 'tilt';
    return 'granted';
  }

  calibrate(): void {
    if (this.latest) this.neutral = { ...this.latest };
  }

  attachKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key in KEY_DIRECTION) {
        this.keys.add(e.key);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(): void {
    let target = { steer: 0, throttle: 0 };
    if (this.keys.size > 0) {
      const held = { left: 0, right: 0, up: 0, down: 0 };
      for (const key of this.keys) held[KEY_DIRECTION[key]] = 1;
      target = { steer: held.right - held.left, throttle: held.up - held.down };
      this.delta.x = target.steer * STEER.full;
      this.delta.y = target.throttle * THROTTLE.full;
    } else if (this.mode === 'tilt' && this.latest) {
      target = tiltToInput(this.latest, this.neutral);
      Object.assign(this.delta, tiltDelta(this.latest, this.neutral));
    } else {
      this.delta.x = this.delta.y = 0;
    }
    // Steering eases in and out more gently than throttle, so sideways nudges feel smooth.
    this.steer += (target.steer - this.steer) * 0.12;
    this.throttle += (target.throttle - this.throttle) * 0.3;
  }
}
