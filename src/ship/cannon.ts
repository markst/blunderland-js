import * as THREE from 'three';
import type { Boat } from './boat';
import type { Spray } from './spray';
import { SHIP } from './ships';
import type { FireFx } from '../fx/fire';
import type { Smoke } from '../fx/smoke';
import { loadToonModel, toonGradient } from '../render/toon';
import { BALL_GRAVITY, flight } from '../world/ballistics';
import { waveHeight, type WaveState } from '../world/waves';

/** Kenney Pirate Kit (CC0) — see public/models/kenney/LICENSE.txt. */
const CANNON_URL = '/models/kenney/cannon-mobile.glb';
/** Where the bow chaser sits on the deck (hull space: forward -Z, y 0 = waterline); depends on the ship. */
const MOUNT_POSITION = SHIP.cannonMount;
/** Muzzle in the cannon model's own space (barrel points along +Z before the mount turns it forward). */
const MUZZLE_LOCAL = new THREE.Vector3(0, 1.1, 1.05);

/** Seconds between shots. */
const RELOAD = 0.55;
/** Muzzle speed (m/s) at the weakest and the fullest pull. */
const MIN_SHOT_SPEED = 25;
const MAX_SHOT_SPEED = 80;
/** How far the bow chaser can swing either side of dead ahead. */
export const MAX_YAW = THREE.MathUtils.degToRad(50);
const ELEVATION = THREE.MathUtils.degToRad(10);
const BALL_RADIUS = 0.6;
/** The fireball is drawn bigger than a cannonball and trails flames instead of smoke. */
const FIREBALL_SCALE = 1.7;
const MAX_BALLS = 8;
const BALL_TRAIL_INTERVAL = 0.035;
const FIREBALL_TRAIL_INTERVAL = 0.012;
/** Balls that never land (e.g. fired at a steep sea) are retired after this long. */
const BALL_MAX_AGE = 8;
/** Recoil: ship shove (m/s) and bow kick (rad) at full power, barrel slide (m). */
const RECOIL_IMPULSE = 2.5;
const RECOIL_KICK = 0.05;
const RECOIL_SLIDE = 0.6;

/** Aim preview: dotted arc sampled every PREVIEW_STEP seconds of flight. */
const PREVIEW_DOTS = 40;
const PREVIEW_STEP = 0.07;

const MAX_RINGS = 8;
const RING_LIFE = 1.3;

/** A shot being aimed: yaw from dead ahead (rad, > 0 to port/left) and pull strength in [0, 1]. */
export interface Shot {
  yaw: number;
  power: number;
}

/** What the cannon fires: an ordinary iron ball, or the special fireball that sets ships alight. */
export type Ammo = 'ball' | 'fireball';

/** Checks a flying shot (position, current velocity, ammo) against targets; true means it hit one. */
export type HitTest = (point: THREE.Vector3, velocity: THREE.Vector3, ammo: Ammo) => boolean;

interface Ball {
  mesh: THREE.Mesh;
  ammo: Ammo;
  start: THREE.Vector3;
  launch: THREE.Vector3;
  age: number;
  sinceTrail: number;
}

interface Ring {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
}

/**
 * Bow chaser aimed slingshot-style: while a shot is being pulled back the barrel swings to the aim and a
 * dotted arc shows where the ball will land; on release it fires with a smoke burst, flash and recoil. The
 * ball flies a ballistic arc (the same formula as the preview), trails smoke, and splashes into the sea.
 * When the fireball is loaded the next shot is a blazing ball that trails flames and sets ships alight.
 */
export class Cannon {
  /** World-space effects (balls, smoke, rings, aim preview); add to the scene. */
  readonly effects = new THREE.Group();
  private readonly mount = new THREE.Group();
  private readonly muzzle = new THREE.Object3D();
  private readonly flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private flashAge = Infinity;
  /** Flash size: small at the muzzle, big for an explosion on a hit. */
  private flashSize = 1.8;
  private reload = 0;
  private slide = 0;
  private yaw = 0;
  /** What the next shot will be; the preview turns orange for the fireball. */
  loaded: Ammo = 'ball';

  private readonly balls: Ball[] = [];
  private readonly rings: Ring[] = [];
  private readonly dots: THREE.InstancedMesh;
  private readonly target: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly dotMaterial: THREE.MeshBasicMaterial;
  private readonly ballMaterial: THREE.Material;
  private readonly fireballMaterial: THREE.Material;

  private readonly start = new THREE.Vector3();
  private readonly launch = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();

  constructor(
    boat: Boat,
    private readonly flames: FireFx,
    private readonly smoke: Smoke,
  ) {
    this.mount.position.copy(MOUNT_POSITION);
    this.mount.scale.setScalar(SHIP.cannonScale);
    // Like the ship, the model faces +Z; turn it to the bow.
    this.mount.rotation.y = Math.PI;
    this.muzzle.position.copy(MUZZLE_LOCAL);
    this.mount.add(this.muzzle);
    boat.mount(this.mount);

    this.flash = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd25a }));
    this.flash.material.userData.outlineParameters = { visible: false };
    this.flash.visible = false;
    this.effects.add(this.flash);

    const ballGeometry = new THREE.SphereGeometry(BALL_RADIUS, 16, 10);
    this.ballMaterial = new THREE.MeshToonMaterial({ color: 0x2b2b33, gradientMap: toonGradient });
    this.fireballMaterial = new THREE.MeshBasicMaterial({ color: 0xffb02e });
    this.fireballMaterial.userData.outlineParameters = { visible: false };
    for (let i = 0; i < MAX_BALLS; i++) {
      const mesh = new THREE.Mesh(ballGeometry, this.ballMaterial);
      mesh.visible = false;
      this.effects.add(mesh);
      this.balls.push({ mesh, ammo: 'ball', start: new THREE.Vector3(), launch: new THREE.Vector3(), age: 0, sinceTrail: 0 });
    }

    const ringGeometry = new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
      material.userData.outlineParameters = { visible: false };
      const mesh = new THREE.Mesh(ringGeometry, material);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.effects.add(mesh);
      this.rings.push({ mesh, age: Infinity });
    }

    this.dotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    this.dotMaterial.userData.outlineParameters = { visible: false };
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), this.dotMaterial, PREVIEW_DOTS);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    this.dots.renderOrder = 10;
    this.effects.add(this.dots);

    const targetMaterial = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false });
    targetMaterial.userData.outlineParameters = { visible: false };
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 32).rotateX(-Math.PI / 2), targetMaterial);
    this.target.visible = false;
    this.target.renderOrder = 4;
    this.effects.add(this.target);
  }

  async load(): Promise<void> {
    this.mount.add(await loadToonModel(CANNON_URL));
  }

  /** Fires `shot` with the loaded ammo if reloaded; returns the ammo that went off, or null. */
  fire(boat: Boat, shot: Shot): Ammo | null {
    if (this.reload > 0) return null;
    const ball = this.balls.find((b) => !b.mesh.visible);
    if (!ball) return null;
    this.reload = RELOAD;
    const ammo = this.loaded;

    // Snap the barrel to the shot so the ball leaves the muzzle where the preview started.
    this.yaw = THREE.MathUtils.clamp(shot.yaw, -MAX_YAW, MAX_YAW);
    this.mount.rotation.y = Math.PI + this.yaw;
    this.launchFrom(boat, shot, ball.start, ball.launch);
    ball.ammo = ammo;
    ball.mesh.material = ammo === 'fireball' ? this.fireballMaterial : this.ballMaterial;
    ball.mesh.scale.setScalar(ammo === 'fireball' ? FIREBALL_SCALE : 1);
    ball.mesh.position.copy(ball.start);
    ball.mesh.visible = true;
    ball.age = 0;
    ball.sinceTrail = 0;
    // Smoke billows out of the barrel and keeps pace with the ship, so it never smothers the view.
    const dirX = ball.launch.x - boat.velocity.x;
    const dirZ = ball.launch.z - boat.velocity.y;
    const len = Math.hypot(dirX, dirZ) || 1;
    for (let i = 0; i < 12; i++) {
      const speed = 3 + Math.random() * 9;
      this.smoke.puff(ball.start,
      (dirX / len) * speed + (Math.random() - 0.5) * 4,
      Math.random() * 2.5 + speed * 0.15,
      (dirZ / len) * speed + (Math.random() - 0.5) * 4,
      0.3 + Math.random() * 0.3,
      0.9 + Math.random() * 0.6,
      boat.velocity,);
    }
    if (ammo === 'fireball') {
      // A gout of flame from the barrel, carried along with the ship.
      for (let i = 0; i < 14; i++) {
        const speed = 4 + Math.random() * 10;
        this.flames.flame(
          ball.start,
          (dirX / len) * speed + boat.velocity.x * 0.9 + (Math.random() - 0.5) * 3,
          Math.random() * 2,
          (dirZ / len) * speed + boat.velocity.y * 0.9 + (Math.random() - 0.5) * 3,
          0.5 + Math.random() * 0.5,
          0.35 + Math.random() * 0.3,
        );
      }
    }
    this.flash.position.set(ball.start.x + (dirX / len) * 1.2, ball.start.y, ball.start.z + (dirZ / len) * 1.2);
    this.flashAge = 0;
    this.flashSize = ammo === 'fireball' ? 2.6 : 1.8;

    this.slide = RECOIL_SLIDE;
    const kick = 0.4 + 0.6 * shot.power;
    boat.recoil(RECOIL_IMPULSE * kick, RECOIL_KICK * kick);
    return ammo;
  }

  /**
   * `aim`: the shot currently being pulled back, or null when not aiming.
   * `hitTest`: checks a flying ball against targets; returning true means it struck one (and stops there).
   */
  update(dt: number, boat: Boat, waves: WaveState, spray: Spray, aim: Shot | null, hitTest: HitTest): void {
    this.reload = Math.max(0, this.reload - dt);

    // Barrel swings toward the aim (or back to dead ahead), slides back on recoil and is run out again.
    const yawTarget = aim ? THREE.MathUtils.clamp(aim.yaw, -MAX_YAW, MAX_YAW) : 0;
    this.yaw += (yawTarget - this.yaw) * (1 - Math.exp(-12 * dt));
    this.mount.rotation.y = Math.PI + this.yaw;
    this.slide *= Math.exp(-6 * dt);
    this.mount.position.z = MOUNT_POSITION.z + this.slide;

    this.flashAge += dt;
    this.flash.visible = this.flashAge < 0.08;
    this.flash.scale.setScalar(this.flashSize * (1 - this.flashAge / 0.08));

    this.updateBalls(dt, waves, spray, hitTest);
    this.updatePreview(boat, waves, aim);
    this.updateRings(dt, waves);
  }

  /** Muzzle position and launch velocity (ship velocity included) for `shot`. */
  private launchFrom(boat: Boat, shot: Shot, start: THREE.Vector3, launch: THREE.Vector3): void {
    this.muzzle.getWorldPosition(start);
    const speed = MIN_SHOT_SPEED + (MAX_SHOT_SPEED - MIN_SHOT_SPEED) * THREE.MathUtils.clamp(shot.power, 0, 1);
    const angle = boat.heading + THREE.MathUtils.clamp(shot.yaw, -MAX_YAW, MAX_YAW);
    const flat = Math.cos(ELEVATION) * speed;
    launch.set(-Math.sin(angle) * flat + boat.velocity.x, Math.sin(ELEVATION) * speed, -Math.cos(angle) * flat + boat.velocity.y);
  }

  private updateBalls(dt: number, waves: WaveState, spray: Spray, hitTest: HitTest): void {
    for (const ball of this.balls) {
      if (!ball.mesh.visible) continue;
      ball.age += dt;
      const p = flight(ball.start, ball.launch, ball.age, ball.mesh.position);
      const blazing = ball.ammo === 'fireball';
      ball.sinceTrail += dt;
      if (ball.sinceTrail >= (blazing ? FIREBALL_TRAIL_INTERVAL : BALL_TRAIL_INTERVAL)) {
        ball.sinceTrail = 0;
        if (blazing) {
          this.flames.flame(p, (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.8 + Math.random() * 0.5, 0.35 + Math.random() * 0.25);
          if (Math.random() < 0.3) this.flames.smoke(p, 0, 1, 0, 0.5, 1.2);
        } else {
          this.smoke.puff(p, ball.launch.x * 0.05, 0.6, ball.launch.z * 0.05, 0.4, 0.5, null);
        }
      }
      this.point.copy(ball.launch).setY(ball.launch.y - BALL_GRAVITY * ball.age);
      if (hitTest(p, this.point, ball.ammo)) {
        this.explode(p, spray, blazing);
        ball.mesh.visible = false;
        continue;
      }
      const sea = waveHeight(waves, p.x, p.z);
      if (p.y <= sea) {
        spray.burst(p.x, sea, p.z, 70, 1.8);
        this.ring(p.x, p.z);
        // A fireball that misses goes out in a hiss of steam.
        if (blazing) {
          for (let i = 0; i < 10; i++) this.smoke.puff(p, (Math.random() - 0.5) * 4, 3 + Math.random() * 4, (Math.random() - 0.5) * 4, 0.7 + Math.random() * 0.5, 1.4, null);
        }
        ball.mesh.visible = false;
      } else if (ball.age > BALL_MAX_AGE) {
        ball.mesh.visible = false;
      }
    }
  }

  /** Dotted arc and landing marker for the shot being aimed. */
  private updatePreview(boat: Boat, waves: WaveState, aim: Shot | null): void {
    this.dots.count = 0;
    this.target.visible = false;
    if (!aim) return;
    // White arc and yellow target for a cannonball; fiery orange when the fireball is loaded.
    const fireball = this.loaded === 'fireball';
    this.dotMaterial.color.set(fireball ? 0xffa23a : 0xffffff);
    this.target.material.color.set(fireball ? 0xff5a1f : 0xffe066);
    this.launchFrom(boat, aim, this.start, this.launch);
    let n = 0;
    for (let i = 1; i <= PREVIEW_DOTS * 3 && n < PREVIEW_DOTS; i++) {
      const p = flight(this.start, this.launch, i * PREVIEW_STEP, this.point);
      const sea = waveHeight(waves, p.x, p.z);
      if (p.y <= sea) {
        this.target.position.set(p.x, sea + 0.2, p.z);
        // Grows with range so the landing spot stays visible far out.
        this.target.scale.setScalar(2 + 0.04 * p.distanceTo(this.start));
        this.target.visible = true;
        break;
      }
      // Every other sample, Angry Birds style; dots grow with distance so the far end stays readable.
      if (i % 2 === 0) continue;
      const s = 0.3 + 0.01 * p.distanceTo(this.start);
      this.matrix.compose(p, this.quaternion, this.scale.set(s, s, s));
      this.dots.setMatrixAt(n++, this.matrix);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
  }

  private updateRings(dt: number, waves: WaveState): void {
    for (const ring of this.rings) {
      if (!ring.mesh.visible) continue;
      ring.age += dt;
      const t = ring.age / RING_LIFE;
      if (t >= 1) {
        ring.mesh.visible = false;
        continue;
      }
      const { position } = ring.mesh;
      position.y = waveHeight(waves, position.x, position.z) + 0.15;
      ring.mesh.scale.setScalar(2 + 14 * Math.sqrt(t));
      ring.mesh.material.opacity = 1 - t;
    }
  }

  /** A ball struck something: a flash, a billow of smoke (or a burst of flame) and spray. */
  private explode(at: THREE.Vector3, spray: Spray, blazing: boolean): void {
    this.flash.position.copy(at);
    this.flashAge = 0;
    this.flashSize = blazing ? 7 : 5;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 7;
      if (blazing) this.flames.flame(at, Math.cos(a) * speed, 2 + Math.random() * 5, Math.sin(a) * speed, 1 + Math.random() * 0.8, 0.6 + Math.random() * 0.5);
      else this.smoke.puff(at, Math.cos(a) * speed, 1 + Math.random() * 5, Math.sin(a) * speed, 0.6 + Math.random() * 0.6, 1.2 + Math.random() * 0.8, null);
    }
    spray.burst(at.x, at.y, at.z, 30, 1.1);
  }

  private ring(x: number, z: number): void {
    const ring = this.rings.find((r) => !r.mesh.visible) ?? this.rings[0];
    ring.mesh.position.set(x, 0, z);
    ring.mesh.visible = true;
    ring.age = 0;
  }
}
