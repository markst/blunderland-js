import * as THREE from 'three';
import { SHIP } from './ships';
import { loadToonModel } from '../render/toon';
import { waveHeight, type WaveState } from '../world/waves';

/** Terminal speed (m/s) on a fully tilted sea. */
export const MAX_SPEED = 34;
/** Water drag (1/s); the push is sized so drag balances it at MAX_SPEED (≈1.7 s to reach 2/3 speed). */
const DRAG = 0.6;
const PUSH = MAX_SPEED * DRAG;
/** How fast (rad/s) the ship swings round to sail with the current. */
const TURN_RATE = 1.8;
/** How quickly (1/s) a recoil kick to the bow dies away. */
const KICK_DECAY = 5;

/** Overall ship size relative to hull space; everything mounted on the hull scales with it. */
export const SHIP_SCALE = 0.65;
/** Hull sample points (m from the centre) used to sit the ship on the waves; also where the wake starts. */
export const HALF_LENGTH = 5.5 * SHIP_SCALE;
export const HALF_BEAM = 2.2 * SHIP_SCALE;

export class Boat {
  readonly object = new THREE.Group();
  heading = 0; // radians; 0 faces -Z
  readonly position = new THREE.Vector3();
  /** World velocity in xz (m/s). */
  readonly velocity = new THREE.Vector2();
  private readonly hull = new THREE.Group();
  /** Extra bow-up pitch (rad) from cannon recoil, decaying back to 0. */
  private kick = 0;
  /** Extra heel (rad, > 0 rolls to starboard) from being struck, decaying back to 0. */
  private jolt = 0;

  constructor() {
    this.hull.scale.setScalar(SHIP_SCALE);
    this.object.add(this.hull);
  }

  /** Current height of the hull riding the waves (m). */
  get waterline(): number {
    return this.hull.position.y;
  }

  /**
   * Attaches `object` to the hull so it rides the waves with the ship. Hull space is the unscaled model:
   * forward -Z, y 0 = waterline, sizes multiplied by SHIP_SCALE on screen.
   */
  mount(object: THREE.Object3D): void {
    this.hull.add(object);
  }

  /** Shoves the ship backwards by `impulse` m/s and kicks the bow up by `pitch` radians. */
  recoil(impulse: number, pitch: number): void {
    this.velocity.x += Math.sin(this.heading) * impulse;
    this.velocity.y += Math.cos(this.heading) * impulse;
    this.kick += pitch;
  }

  /** Hit by a cannonball travelling along world xz (dirX, dirZ): shoved along it and heeled away from the blow. */
  struck(dirX: number, dirZ: number): void {
    const len = Math.hypot(dirX, dirZ) || 1;
    this.velocity.x += (dirX / len) * 3;
    this.velocity.y += (dirZ / len) * 3;
    // Which side it came from: positive when travelling toward starboard (right = (cos, -sin)).
    const across = (Math.cos(this.heading) * dirX - Math.sin(this.heading) * dirZ) / len;
    this.jolt += across * 0.18;
  }

  /** Loads the selected ship model (see ships.ts). */
  async load(): Promise<void> {
    const ship = await loadToonModel(SHIP.url);
    SHIP.prepare?.(ship);
    ship.scale.setScalar(SHIP.scale);
    ship.rotation.y = SHIP.rotationY;
    ship.position.y = SHIP.y;
    this.hull.add(ship);
  }

  /**
   * The ship is not driven: the tilted sea pushes it downhill against water drag, and it swings round to
   * sail with that current (unless pushed stern-first, where it drifts backwards).
   * `downhill`: water slope in world xz, each component in [-1, 1] (1 = fully tilted).
   */
  update(dt: number, downhill: THREE.Vector2, waves: WaveState): void {
    const sin = Math.sin(this.heading);
    const cos = Math.cos(this.heading);
    const v = this.velocity;
    v.x += (PUSH * downhill.x - DRAG * v.x) * dt;
    v.y += (PUSH * downhill.y - DRAG * v.y) * dt;
    this.position.x += v.x * dt;
    this.position.z += v.y * dt;

    // forward = (-sin, -cos), right = (cos, -sin) in world xz.
    const speed = v.length();
    const forwardSpeed = -sin * v.x - cos * v.y;
    if (speed > 0.5 && forwardSpeed > -0.3 * speed) {
      const desired = Math.atan2(-v.x, -v.y);
      const diff = Math.atan2(Math.sin(desired - this.heading), Math.cos(desired - this.heading));
      const maxTurn = TURN_RATE * dt * Math.min(1, speed / 4);
      this.heading += THREE.MathUtils.clamp(diff, -maxTurn, maxTurn);
    }

    this.object.position.set(this.position.x, 0, this.position.z);
    this.object.rotation.y = this.heading;

    // Ride the actual wave surface: height from the centre, pitch/roll from bow/stern and port/starboard.
    const fx = -Math.sin(this.heading) * HALF_LENGTH;
    const fz = -Math.cos(this.heading) * HALF_LENGTH;
    const rx = Math.cos(this.heading) * HALF_BEAM;
    const rz = -Math.sin(this.heading) * HALF_BEAM;
    const { x, z } = this.position;
    const bow = waveHeight(waves, x + fx, z + fz);
    const stern = waveHeight(waves, x - fx, z - fz);
    const starboard = waveHeight(waves, x + rx, z + rz);
    const port = waveHeight(waves, x - rx, z - rz);
    this.hull.position.y = (bow + stern + starboard + port) / 4;
    this.kick *= Math.exp(-KICK_DECAY * dt);
    this.jolt *= Math.exp(-KICK_DECAY * 0.6 * dt);
    this.hull.rotation.x = Math.atan2(bow - stern, HALF_LENGTH * 2) + this.kick;
    // Heel away from a sideways push, like a hull leaning under the current.
    const sideways = cos * downhill.x - sin * downhill.y;
    this.hull.rotation.z = Math.atan2(starboard - port, HALF_BEAM * 2) - sideways * 0.1 - this.jolt;
  }
}
