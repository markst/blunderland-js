import * as THREE from 'three';
import { HALF_BEAM, HALF_LENGTH, MAX_SPEED, type Boat } from './boat';
import { waveHeight, type WaveState } from '../world/waves';

/**
 * White-water trail: two foam arms spreading out in a V from the stern plus churned water straight behind,
 * laid on the wave surface and fading with age. Strength follows the speed the ship had when it passed.
 */

/** Seconds a trail point lives. */
const LIFE = 3.2;
/** A new trail point every this many seconds. */
const EMIT_INTERVAL = 0.05;
const POINTS = Math.ceil(LIFE / EMIT_INTERVAL) + 1;
/** Sideways spread (m/s) of each arm at full speed. */
const SPREAD = 7;
/** Strips: lateral offset sign (0 = centre churn), start width, width growth per second, opacity. */
const STRIPS = [
  { side: -1, width: 0.7, grow: 0.6, alpha: 1 },
  { side: 1, width: 0.7, grow: 0.6, alpha: 1 },
  { side: 0, width: HALF_BEAM * 1.1, grow: -0.5, alpha: 0.45 },
];
/** Lift above the wave surface to avoid z-fighting with the ocean mesh. */
const LIFT = 0.12;

interface TrailPoint {
  x: number;
  z: number;
  /** Ship's right vector when emitted. */
  rx: number;
  rz: number;
  age: number;
  /** 0..1 from the ship's speed when emitted. */
  strength: number;
}

export class Wake {
  readonly mesh: THREE.Mesh;
  private readonly points: TrailPoint[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private sinceEmit = 0;

  constructor() {
    const vertexCount = STRIPS.length * POINTS * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 4).fill(1);
    const indices: number[] = [];
    for (let s = 0; s < STRIPS.length; s++) {
      const base = s * POINTS * 2;
      for (let i = 0; i < POINTS - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(indices);

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    material.userData.outlineParameters = { visible: false };
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(dt: number, boat: Boat, waves: WaveState): void {
    for (const p of this.points) p.age += dt;
    while (this.points.length > 0 && this.points[this.points.length - 1].age > LIFE) this.points.pop();

    this.sinceEmit += dt;
    if (this.sinceEmit >= EMIT_INTERVAL) {
      this.sinceEmit = 0;
      const sin = Math.sin(boat.heading);
      const cos = Math.cos(boat.heading);
      this.points.unshift({
        x: boat.position.x + sin * HALF_LENGTH,
        z: boat.position.z + cos * HALF_LENGTH,
        rx: cos,
        rz: -sin,
        age: 0,
        strength: Math.min(1, boat.velocity.length() / (MAX_SPEED * 0.5)),
      });
      if (this.points.length > POINTS) this.points.length = POINTS;
    }

    const pos = this.positions;
    const col = this.colors;
    STRIPS.forEach((strip, s) => {
      for (let i = 0; i < POINTS; i++) {
        const v = (s * POINTS + i) * 2;
        // Unused slots collapse onto the newest point with zero opacity.
        const p = this.points[Math.min(i, this.points.length - 1)];
        if (!p) {
          col[v * 4 + 3] = col[v * 4 + 7] = 0;
          continue;
        }
        const t = p.age;
        const centre = strip.side * (HALF_BEAM * 0.8 + t * SPREAD * p.strength);
        const half = Math.max(0.05, (strip.width + t * strip.grow) * 0.5);
        const fade = i < this.points.length ? (1 - t / LIFE) ** 1.5 * p.strength * strip.alpha : 0;
        for (let e = 0; e < 2; e++) {
          const off = centre + (e === 0 ? -half : half);
          const x = p.x + p.rx * off;
          const z = p.z + p.rz * off;
          const k = (v + e) * 3;
          pos[k] = x;
          pos[k + 1] = waveHeight(waves, x, z) + LIFT;
          pos[k + 2] = z;
          col[(v + e) * 4 + 3] = fade;
        }
      }
    });
    const geometry = this.mesh.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }
}
