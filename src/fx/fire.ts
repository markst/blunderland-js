import * as THREE from 'three';

/** Pool size shared by every flame and smoke puff in the scene. */
const MAX_PARTICLES = 900;

const FLAME_HOT = new THREE.Color(0xfff2a0);
const FLAME_MID = new THREE.Color(0xff8a1c);
const FLAME_COOL = new THREE.Color(0xc4260f);
const SMOKE_LIGHT = new THREE.Color(0x6a625c);
const SMOKE_DARK = new THREE.Color(0x2c2826);

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  smoke: boolean;
}

/**
 * Cartoon fire: chunky flame blobs that flare yellow, cool through orange to red and shrink as they rise, plus
 * dark smoke puffs that swell and drift up. One instanced mesh with a colour per particle.
 */
export class FireFx {
  readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    age: 0,
    life: 1,
    size: 1,
    smoke: false,
  }));
  /** The first `alive` particles are live. */
  private alive = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly color = new THREE.Color();

  constructor() {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    material.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.color.set(0xffffff));
    this.mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** A flame blob at `at` moving with (vx, vy, vz); it also rises on its own. */
  flame(at: THREE.Vector3, vx: number, vy: number, vz: number, size: number, life: number): void {
    this.spawn(at, vx, vy, vz, size, life, false);
  }

  /** A smoke puff at `at` moving with (vx, vy, vz). */
  smoke(at: THREE.Vector3, vx: number, vy: number, vz: number, size: number, life: number): void {
    this.spawn(at, vx, vy, vz, size, life, true);
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.alive - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.alive--;
        this.particles[i] = this.particles[this.alive];
        this.particles[this.alive] = p;
        continue;
      }
      const t = p.age / p.life;
      let s: number;
      if (p.smoke) {
        p.vel.multiplyScalar(Math.exp(-1.2 * dt));
        p.vel.y += 1.2 * dt;
        s = p.size * (0.6 + 1.6 * Math.min(1, t * 2)) * (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
        this.color.copy(SMOKE_LIGHT).lerp(SMOKE_DARK, t);
      } else {
        p.vel.multiplyScalar(Math.exp(-2.5 * dt));
        p.vel.y += 6 * dt;
        s = p.size * (t < 0.15 ? 0.6 + (t / 0.15) * 0.4 : 1 - (t - 0.15) / 0.85);
        if (t < 0.35) this.color.copy(FLAME_HOT).lerp(FLAME_MID, t / 0.35);
        else this.color.copy(FLAME_MID).lerp(FLAME_COOL, (t - 0.35) / 0.65);
      }
      p.pos.addScaledVector(p.vel, dt);
      this.matrix.compose(p.pos, this.quaternion, this.scale.set(s, s, s));
      this.mesh.setMatrixAt(n, this.matrix);
      this.mesh.setColorAt(n, this.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private spawn(at: THREE.Vector3, vx: number, vy: number, vz: number, size: number, life: number, smoke: boolean): void {
    if (this.alive >= MAX_PARTICLES) return;
    const p = this.particles[this.alive++];
    p.pos.copy(at);
    p.vel.set(vx, vy, vz);
    p.age = 0;
    p.life = life;
    p.size = size;
    p.smoke = smoke;
  }
}
