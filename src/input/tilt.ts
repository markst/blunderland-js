export type Tilt = { beta: number; gamma: number };
export type ScreenTilt = { roll: number; pitch: number };

/**
 * Response curve per axis, shaped like pulling on a spring: there is no hard threshold; the first degrees of
 * tilt give a gentle, fine response (softened over `knee` degrees so sensor jitter barely moves the ship),
 * the middle range responds most, and toward the extreme each extra degree gives less and less, easing up to
 * 95% at `full` degrees and approaching 100% beyond it.
 */
export interface AxisCurve {
  knee: number;
  full: number;
}

/** Left/right: a wide, soft spring so small sideways corrections are easy. */
export const STEER: AxisCurve = { knee: 3, full: 24 };
/** Forward/back: a firmer spring that reaches full sooner. */
export const THROTTLE: AxisCurve = { knee: 3, full: 16 };

/** atanh(0.95): the response reaches 95% at `full`. */
const FULL_ARG = Math.atanh(0.95);

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/**
 * Maps raw deviceorientation angles to screen-relative tilt (degrees).
 *
 * Works from the world-up vector in device coordinates instead of raw beta/gamma, so it stays
 * continuous when the phone is held upright (where gamma wraps at ±90° and beta hits gimbal lock).
 *
 * roll > 0: right edge of the screen dips (or the phone turns clockwise like a steering wheel).
 * pitch: 0 when the screen faces the user upright, > 0 as the top edge tips away, 90 lying flat.
 */
export function screenRelativeTilt(t: Tilt, screenAngle: number): ScreenTilt {
  const b = t.beta * RAD;
  const g = t.gamma * RAD;
  // World up in device frame for R = Rz(alpha)·Rx(beta)·Ry(gamma) (W3C DeviceOrientation).
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  // Rotate into the screen frame; screenAngle is the counter-clockwise rotation of the device.
  const a = ((((screenAngle % 360) + 360) % 360) * RAD);
  const sx = ux * Math.cos(a) - uy * Math.sin(a);
  const sy = ux * Math.sin(a) + uy * Math.cos(a);
  return {
    roll: Math.asin(Math.max(-1, Math.min(1, -sx))) * DEG,
    pitch: Math.atan2(uz, sy) * DEG,
  };
}

/** Signed response in (-1, 1) for a tilt of `d` degrees; see {@link AxisCurve}. */
export function springResponse(d: number, axis: AxisCurve): number {
  const a = Math.abs(d);
  // a²/(a + knee): grows gently from zero (no jump), then becomes ≈ a − knee.
  const soft = (a * a) / (a + axis.knee);
  const atFull = (axis.full * axis.full) / (axis.full + axis.knee);
  return Math.sign(d) * Math.tanh((soft / atFull) * FULL_ARG);
}

/**
 * Tilt away from the neutral pose, in degrees, read as the slope of the water: x > 0 means the right
 * side is lower (sea runs right), y > 0 means the far side is lower (top edge tipped away from the
 * user, sea runs forward). Pitch difference is wrapped into [-180, 180).
 */
export function tiltDelta(current: ScreenTilt, neutral: ScreenTilt): { x: number; y: number } {
  return {
    x: current.roll - neutral.roll,
    y: ((((current.pitch - neutral.pitch + 180) % 360) + 360) % 360) - 180,
  };
}

/** Tilt relative to the calibrated neutral pose → steer/throttle in [-1, 1]. */
export function tiltToInput(current: ScreenTilt, neutral: ScreenTilt): { steer: number; throttle: number } {
  const d = tiltDelta(current, neutral);
  return { steer: springResponse(d.x, STEER), throttle: springResponse(d.y, THROTTLE) };
}
