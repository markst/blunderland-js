import * as THREE from 'three';
import { toonGradient } from '../render/toon';

const MAX_PUFFS = 260;

interface Puff {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Constant drift (e.g. a ship's velocity when it fired) on top of `vel`, which drag slows. */
  carry: THREE.Vector2;
  age: number;
  life: number;
  size: number;
}

/** White cannon smoke: puffs that billow out quickly, drift up and shrink away. Shared by every gun. */
export class Smoke {
  readonly mesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = Array.from({ length: MAX_PUFFS }, () => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    carry: new THREE.Vector2(),
    age: 0,
    life: 1,
    size: 1,
  }));
  /** The first `alive` puffs are live. */
  private alive = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();

  constructor() {
    // Emissive lift keeps the smoke near-white under the warm sun while the toon bands still show its volume.
    const material = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0x5a5a5a, gradientMap: toonGradient });
    material.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, MAX_PUFFS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** A puff at `at` moving with (vx, vy, vz), optionally carried along at `carry` (world xz, m/s). */
  puff(at: THREE.Vector3, vx: number, vy: number, vz: number, size: number, life: number, carry: THREE.Vector2 | null): void {
    if (this.alive >= MAX_PUFFS) return;
    const d = this.puffs[this.alive++];
    d.pos.copy(at);
    d.vel.set(vx, vy, vz);
    if (carry) d.carry.copy(carry);
    else d.carry.set(0, 0);
    d.age = 0;
    d.life = life;
    d.size = size;
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.alive - 1; i >= 0; i--) {
      const d = this.puffs[i];
      d.age += dt;
      if (d.age >= d.life) {
        this.alive--;
        this.puffs[i] = this.puffs[this.alive];
        this.puffs[this.alive] = d;
        continue;
      }
      d.vel.multiplyScalar(1 - 2.2 * dt);
      d.vel.y += 1.5 * dt;
      d.pos.addScaledVector(d.vel, dt);
      d.pos.x += d.carry.x * dt;
      d.pos.z += d.carry.y * dt;
      // Billow out quickly, then shrink away.
      const t = d.age / d.life;
      const s = d.size * (1 + 1.8 * Math.min(1, t * 4)) * (t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35);
      this.matrix.compose(d.pos, this.quaternion, this.scale.set(s, s, s));
      this.mesh.setMatrixAt(n++, this.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
