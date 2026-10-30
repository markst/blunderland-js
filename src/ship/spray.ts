import * as THREE from 'three';
import { HALF_BEAM, HALF_LENGTH, MAX_SPEED, type Boat } from './boat';
import { waveHeight, type WaveState } from '../world/waves';

/**
 * Cartoon spray: chunky white droplets thrown up and out from the bow and along the hull, falling back
 * under gravity. Emission scales with speed, and droplets are left behind in world space as the ship sails on.
 */

const MAX_DROPS = 700;
/** Droplets per second at full speed (bow, hull sides). */
const BOW_RATE = 140;
const SIDE_RATE = 60;
const GRAVITY = 22;
/** Below this share of MAX_SPEED there is no spray. */
const MIN_SPEED_SHARE = 0.08;

interface Drop {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

export class Spray {
  readonly mesh: THREE.InstancedMesh;
  /** Fixed pool; the first `alive` entries are live droplets. */
  private readonly drops: Drop[] = Array.from({ length: MAX_DROPS }, () => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    age: 0,
    life: 1,
    size: 1,
  }));
  private alive = 0;
  private bowDebt = 0;
  private sideDebt = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();

  constructor() {
    // Unlit pure white: reads as foam regardless of the warm sunlight.
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    material.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, MAX_DROPS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(dt: number, boat: Boat, waves: WaveState): void {
    const speed = boat.velocity.length();
    const share = speed / MAX_SPEED;
    if (share > MIN_SPEED_SHARE) {
      this.bowDebt += BOW_RATE * share * dt;
      this.sideDebt += SIDE_RATE * share * dt;
    }
    const sin = Math.sin(boat.heading);
    const cos = Math.cos(boat.heading);
    // forward = (-sin, -cos), right = (cos, -sin)
    for (; this.bowDebt >= 1; this.bowDebt--) {
      // Bow wave breaks around the forward third of the hull rather than off the stem.
      this.spawn(boat, waves, sin, cos, HALF_LENGTH * 0.3, HALF_BEAM, 1, share);
    }
    for (; this.sideDebt >= 1; this.sideDebt--) {
      this.spawn(boat, waves, sin, cos, (Math.random() - 0.75) * HALF_LENGTH, HALF_BEAM + 0.2, 0.55, share);
    }

    let n = 0;
    for (let i = this.alive - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.vel.y -= GRAVITY * dt;
      d.vel.multiplyScalar(1 - 0.8 * dt);
      d.pos.addScaledVector(d.vel, dt);
      const sea = waveHeight(waves, d.pos.x, d.pos.z);
      if (d.age >= d.life || (d.vel.y < 0 && d.pos.y < sea)) {
        // Swap the dead droplet past the live range.
        this.alive--;
        this.drops[i] = this.drops[this.alive];
        this.drops[this.alive] = d;
        continue;
      }
      const s = d.size * (1 - (d.age / d.life) ** 2);
      this.matrix.compose(d.pos, this.quaternion, this.scale.set(s, s, s));
      this.mesh.setMatrixAt(n++, this.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Throws a radial splash of `count` droplets from (x, y, z), e.g. where a cannonball lands; `power` scales it. */
  burst(x: number, y: number, z: number, count: number, power: number): void {
    for (let i = 0; i < count && this.alive < MAX_DROPS; i++) {
      const d = this.drops[this.alive++];
      const angle = Math.random() * Math.PI * 2;
      const out = (1 + Math.random() * 4) * power;
      d.pos.set(x + Math.cos(angle) * 0.5, y, z + Math.sin(angle) * 0.5);
      d.vel.set(Math.cos(angle) * out, (8 + Math.random() * 10) * power, Math.sin(angle) * out);
      d.age = 0;
      d.life = 0.9 + Math.random() * 0.7;
      d.size = (0.3 + Math.random() * 0.5) * power;
    }
  }

  /**
   * Spawns one droplet at `along` metres forward of the hull centre, `out` metres to a random side,
   * flung outward and up; `force` scales the throw.
   */
  private spawn(boat: Boat, waves: WaveState, sin: number, cos: number, along: number, out: number, force: number, share: number): void {
    if (this.alive >= MAX_DROPS) return;
    const d = this.drops[this.alive++];
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = boat.position.x - sin * along + cos * out * side;
    const z = boat.position.z - cos * along - sin * out * side;
    const throwOut = (3 + Math.random() * 6) * force * share * 2;
    const up = (4 + Math.random() * 7) * force * (0.5 + share);
    const back = Math.random() * 0.4;
    d.pos.set(x, waveHeight(waves, x, z) + 0.3, z);
    // Inherit most of the ship's velocity, then fling sideways and up; drag lets the ship pull ahead.
    d.vel.set(
      boat.velocity.x * (0.8 - back) + cos * side * throwOut,
      up,
      boat.velocity.y * (0.8 - back) - sin * side * throwOut,
    );
    d.age = 0;
    d.life = 0.7 + Math.random() * 0.6;
    d.size = (0.1 + Math.random() * 0.2) * (0.6 + share);
  }
}
