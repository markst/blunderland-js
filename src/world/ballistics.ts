import * as THREE from 'three';

/** Cannonball gravity (m/s²): heavier than real so arcs read clearly within a couple of seconds. */
export const BALL_GRAVITY = 14;

/** Ballistic position `t` seconds after leaving `start` with velocity `launch`. */
export function flight(start: THREE.Vector3, launch: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(start).addScaledVector(launch, t).setY(start.y + launch.y * t - 0.5 * BALL_GRAVITY * t * t);
}

/**
 * Launch velocity that carries a ball from `start` to where a target now at `target`, moving at `targetVel`
 * (world xz, m/s), will be when the ball arrives. `speed` is the ball's horizontal speed (m/s); the lead is
 * refined a few times because flight time depends on where the target ends up.
 */
export function solveLaunch(
  start: THREE.Vector3,
  target: THREE.Vector3,
  targetVel: THREE.Vector2,
  speed: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  let t = Math.hypot(target.x - start.x, target.z - start.z) / speed;
  let aimX = target.x;
  let aimZ = target.z;
  for (let i = 0; i < 4; i++) {
    aimX = target.x + targetVel.x * t;
    aimZ = target.z + targetVel.y * t;
    t = Math.max(0.2, Math.hypot(aimX - start.x, aimZ - start.z) / speed);
  }
  return out.set((aimX - start.x) / t, (target.y - start.y + 0.5 * BALL_GRAVITY * t * t) / t, (aimZ - start.z) / t);
}
