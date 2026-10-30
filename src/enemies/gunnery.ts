import * as THREE from 'three';
import { HALF_BEAM, HALF_LENGTH, type Boat } from '../ship/boat';
import type { Spray } from '../ship/spray';
import type { FireFx } from '../fx/fire';
import type { Smoke } from '../fx/smoke';
import { toonGradient } from '../render/toon';
import { flight } from '../world/ballistics';
import { waveHeight, type WaveState } from '../world/waves';

const MAX_SHOTS = 16;
const BALL_RADIUS = 0.45;
const TRAIL_INTERVAL = 0.05;
const MAX_AGE = 8;
/** The player's hull for hit tests, in its own frame (m): a little generous so near misses still land. */
const HIT_HALF_BEAM = HALF_BEAM + 0.4;
const HIT_HALF_LENGTH = HALF_LENGTH + 0.6;
const HIT_BOTTOM = -1;
const HIT_TOP = 6;

interface Shot {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  launch: THREE.Vector3;
  age: number;
  sinceTrail: number;
}

/** Called when an enemy ball strikes the player, with the ball's direction of travel (world xz). */
export type OnPlayerHit = (dirX: number, dirZ: number) => void;

/**
 * Enemy cannonballs: muzzle blast at the enemy gun, a ballistic flight trailing smoke, and either a splash or
 * an explosion on the player's ship.
 */
export class Gunnery {
  readonly group = new THREE.Group();
  private readonly shots: Shot[] = [];
  private readonly local = new THREE.Vector3();

  constructor(
    private readonly flames: FireFx,
    private readonly smoke: Smoke,
  ) {
    const geometry = new THREE.SphereGeometry(BALL_RADIUS, 12, 8);
    const material = new THREE.MeshToonMaterial({ color: 0x2b2b33, gradientMap: toonGradient });
    for (let i = 0; i < MAX_SHOTS; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.shots.push({ mesh, start: new THREE.Vector3(), launch: new THREE.Vector3(), age: 0, sinceTrail: 0 });
    }
  }

  /** Fires a ball from `muzzle` with `launch` velocity; `outward` (world xz) points out of the gun port. */
  fire(muzzle: THREE.Vector3, launch: THREE.Vector3, outward: THREE.Vector2, carry: THREE.Vector2): void {
    const shot = this.shots.find((s) => !s.mesh.visible);
    if (!shot) return;
    shot.start.copy(muzzle);
    shot.launch.copy(launch);
    shot.age = 0;
    shot.sinceTrail = 0;
    shot.mesh.position.copy(muzzle);
    shot.mesh.visible = true;
    for (let i = 0; i < 10; i++) {
      const speed = 2 + Math.random() * 7;
      this.smoke.puff(
        muzzle,
        outward.x * speed + (Math.random() - 0.5) * 3,
        Math.random() * 2 + 0.5,
        outward.y * speed + (Math.random() - 0.5) * 3,
        0.3 + Math.random() * 0.3,
        1 + Math.random() * 0.6,
        carry,
      );
    }
    for (let i = 0; i < 5; i++) {
      this.flames.flame(muzzle, outward.x * (3 + Math.random() * 4), Math.random(), outward.y * (3 + Math.random() * 4), 0.35 + Math.random() * 0.3, 0.18 + Math.random() * 0.1);
    }
  }

  /** `ground`: island ground height at (x, z), or -Infinity over open sea; balls thud into it. */
  update(dt: number, waves: WaveState, player: Boat, spray: Spray, onHit: OnPlayerHit, ground: (x: number, z: number) => number): void {
    for (const shot of this.shots) {
      if (!shot.mesh.visible) continue;
      shot.age += dt;
      const p = flight(shot.start, shot.launch, shot.age, shot.mesh.position);
      shot.sinceTrail += dt;
      if (shot.sinceTrail >= TRAIL_INTERVAL) {
        shot.sinceTrail = 0;
        this.smoke.puff(p, 0, 0.5, 0, 0.3, 0.45, null);
      }
      player.object.worldToLocal(this.local.copy(p));
      const { x, y, z } = this.local;
      if (Math.abs(x) < HIT_HALF_BEAM && Math.abs(z) < HIT_HALF_LENGTH && y > HIT_BOTTOM && y < HIT_TOP) {
        this.explode(p, spray);
        onHit(shot.launch.x, shot.launch.z);
        shot.mesh.visible = false;
        continue;
      }
      const land = ground(p.x, p.z);
      const sea = waveHeight(waves, p.x, p.z);
      if (p.y <= land) {
        this.dust(p);
        shot.mesh.visible = false;
      } else if (p.y <= sea) {
        spray.burst(p.x, sea, p.z, 40, 1.4);
        shot.mesh.visible = false;
      } else if (shot.age > MAX_AGE) {
        shot.mesh.visible = false;
      }
    }
  }

  /** A ball thudding into an island: a puff of sand-coloured smoke. */
  private dust(at: THREE.Vector3): void {
    for (let i = 0; i < 8; i++) this.smoke.puff(at, (Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5, 0.5, 1, null);
  }

  private explode(at: THREE.Vector3, spray: Spray): void {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      this.flames.flame(at, Math.cos(a) * speed, 1 + Math.random() * 4, Math.sin(a) * speed, 0.6 + Math.random() * 0.5, 0.35 + Math.random() * 0.3);
      this.smoke.puff(at, Math.cos(a) * speed * 0.6, 1 + Math.random() * 3, Math.sin(a) * speed * 0.6, 0.5 + Math.random() * 0.4, 1.2 + Math.random() * 0.6, null);
    }
    spray.burst(at.x, at.y, at.z, 25, 1);
  }
}
