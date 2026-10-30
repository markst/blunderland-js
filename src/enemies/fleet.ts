import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Boat } from '../ship/boat';
import type { Ammo } from '../ship/cannon';
import type { Spray } from '../ship/spray';
import type { FireFx } from '../fx/fire';
import { loadToonModel } from '../render/toon';
import { solveLaunch } from '../world/ballistics';
import type { Obstacles } from '../world/islands';
import { waveHeight, type WaveState } from '../world/waves';
import type { Gunnery } from './gunnery';
import { loadSoldier, type SoldierTemplate } from './redcoats';
import { angleDiff, beamSide, broadsideHeading } from './tactics';

/** "Ship" by Krzysztof Gryzka (CC BY) — see public/models/gryzka/LICENSE.txt. */
const ENEMY_URL = '/models/gryzka/enemy-ship.glb';
/** Kenney Pirate Kit (CC0) — see public/models/kenney/LICENSE.txt. */
const CANNON_URL = '/models/kenney/cannon-mobile.glb';
/** The model ships with its own sea and clouds; only the ship's materials are kept. */
const DROP_MATERIALS = new Set(['mat5', 'mat21']);
/** Model units → metres: the hull (0.58 long in the file) becomes ≈8 m, like the player's ship. */
const MODEL_SCALE = 14;
/** Model-space hull centre at the waterline; the bow points +X in the file. */
const MODEL_ORIGIN = new THREE.Vector3(0.07, -0.22, -0.04);
/** Hit box in the enemy's own frame (m): half beam, height range, half length (bowsprit included). */
const HIT_HALF_BEAM = 1.6;
const HIT_BOTTOM = -1.5;
const HIT_TOP = 7;
const HIT_HALF_LENGTH = 5;

/**
 * Deck layout in the enemy's own frame (m, forward -Z). Measured from the model by raycasting: the main deck
 * sits 1.15 m up with a 0.85 m half beam, and the raised stern deck is at 1.54 m.
 */
const DECK_Y = 1.15;
const STERN_DECK_Y = 1.54;
/** Two guns a side; each pokes out through the rail. */
const GUNS: { x: number; z: number; side: 1 | -1 }[] = [
  { x: -0.5, z: -1.3, side: -1 },
  { x: -0.5, z: 1.0, side: -1 },
  { x: 0.5, z: -1.3, side: 1 },
  { x: 0.5, z: 1.0, side: 1 },
];
const GUN_SCALE = 0.45;
/** Muzzle in the cannon model's own space (barrel along +Z), as on the player's cannon. */
const MUZZLE_LOCAL = new THREE.Vector3(0, 1.1, 1.05);
/** Redcoats on deck: an officer on the stern and a gunner each side. `turn` is their Y rotation. */
const CREW: { at: THREE.Vector3; turn: number; officer: boolean }[] = [
  { at: new THREE.Vector3(0, STERN_DECK_Y, 3.6), turn: Math.PI, officer: true },
  { at: new THREE.Vector3(-0.3, DECK_Y, -0.15), turn: -Math.PI / 2, officer: false },
  { at: new THREE.Vector3(0.3, DECK_Y, 0.25), turn: Math.PI / 2, officer: false },
];
const SOLDIER_HEIGHT = 1.0;
const FADE = 0.25;

const FLEET_SIZE = 3;
const SAIL_SPEED = 5;
/** New enemies appear this far ahead of the player (m), within ±SPAWN_ARC of the bow. */
const SPAWN_MIN = 140;
const SPAWN_MAX = 260;
const SPAWN_ARC = THREE.MathUtils.degToRad(55);
/** Enemies left this far behind are moved ahead again. */
const DESPAWN = 600;
/** Seconds before a sunk ship is replaced. */
const RESPAWN_DELAY = 4;

/** Within this range (m) an enemy turns to bring its broadside to bear. */
const ENGAGE_RANGE = 200;
const ENGAGE_TURN_RATE = 0.35;
/** Guns fire at targets between these ranges (m) and up to 55° either side of the beam. */
const FIRE_MIN = 25;
const FIRE_MAX = 150;
const FIRE_ARC = Math.cos(THREE.MathUtils.degToRad(55));
/** Seconds between broadsides (randomised in this range), and before the first. */
const RELOAD_MIN = 5;
const RELOAD_MAX = 8;
/** Enemy ball speed across the water (m/s); slow enough that a moving ship can dodge. */
const SHOT_SPEED = 38;
/** Aim error (m) at the target: a base plus a share of the range. */
const SPREAD_BASE = 2;
const SPREAD_PER_M = 0.05;

const DEBRIS_GRAVITY = 14;
/** Debris floats this long after landing, then sinks; removed after DEBRIS_LIFE. */
const DEBRIS_FLOAT = 2.5;
const DEBRIS_SINK_SPEED = 0.9;
const DEBRIS_LIFE = 8;

/** A fireball sets a ship alight: it burns for this long, slowing, listing and settling, then collapses. */
const BURN_TIME = 7;
/** Flames spread from the point of impact at this rate (m/s). */
const FIRE_SPREAD = 2.2;
const FLAMES_PER_SECOND = 70;
const SMOKE_PER_SECOND = 9;
const CHARRED = new THREE.Color(0x1d1612);

interface Gun {
  muzzle: THREE.Object3D;
  side: 1 | -1;
}

interface Hand {
  idle: THREE.AnimationAction;
  /** Officer only: points his sword as the broadside fires. */
  order: THREE.AnimationAction | null;
  panic: THREE.AnimationAction | null;
}

interface Enemy {
  object: THREE.Group;
  /** Rides the waves inside `object`; holds the model and the deck until the ship breaks up. */
  hull: THREE.Group;
  /** The ship's timbers, masts and sails (model units, scaled). */
  model: THREE.Object3D;
  /** Guns and crew, in metres. */
  deck: THREE.Group;
  guns: Gun[];
  mixer: THREE.AnimationMixer;
  hands: Hand[];
  heading: number;
  turn: number;
  turnTimer: number;
  /** Seconds until the next broadside. */
  reload: number;
  /** Seconds alight, or -1 while not on fire. */
  burning: number;
  /** Where the fireball struck, in the enemy's own frame; the fire spreads out from here. */
  ignition: THREE.Vector3;
  /** This ship's own copies of its materials, blackening as it burns, with their original colours. */
  charring: { material: THREE.MeshToonMaterial; from: THREE.Color }[];
  /** Fractional flames/smoke owed from previous frames. */
  flameDebt: number;
  smokeDebt: number;
}

interface Piece {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  /** Seconds since it first hit the water, or -1 while airborne. */
  wet: number;
}

/**
 * British galleons with redcoat crews. They sail ahead of the player, and once in range turn to bring their
 * broadside to bear and fire aimed volleys (leading the player's motion, with some scatter).
 *
 * Each ship is built from its model's ~80 separate parts, so a cannonball hit blows it apart: every part, gun
 * and sailor flies outward from the impact, tumbles, splashes down, bobs for a moment and sinks. A fireball
 * instead sets the ship alight: the crew panic, the fire spreads, it slows to a stop, blackens, lists and
 * settles, then collapses into the sea. Sunk ships are replaced further ahead.
 */
export class Fleet {
  /** World-space root for enemies and debris; add to the scene. */
  readonly group = new THREE.Group();
  private template: THREE.Group | null = null;
  private deckTemplate: THREE.Group | null = null;
  private soldier: SoldierTemplate | null = null;
  private readonly enemies: Enemy[] = [];
  private readonly debris: Piece[] = [];
  private pendingRespawns: number[] = [];
  private readonly local = new THREE.Vector3();
  private readonly spinQ = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly origin = new THREE.Vector3();
  private readonly partPos = new THREE.Vector3();
  private readonly muzzlePos = new THREE.Vector3();
  private readonly aimPoint = new THREE.Vector3();
  private readonly launch = new THREE.Vector3();
  private readonly outward = new THREE.Vector2();
  private readonly drift = new THREE.Vector2();
  private readonly away = new THREE.Vector2();

  constructor(
    private readonly fire: FireFx,
    private readonly gunnery: Gunnery,
    private readonly islands: Obstacles,
  ) {}

  async load(): Promise<void> {
    const [source, cannon, soldier] = await Promise.all([loadToonModel(ENEMY_URL), loadToonModel(CANNON_URL), loadSoldier()]);
    source.updateMatrixWorld(true);
    // Bake each part into its own centred mesh, so it can later tumble about its own middle.
    const model = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    source.traverse((node) => {
      if (node instanceof THREE.Mesh && node.material instanceof THREE.Material && !DROP_MATERIALS.has(node.material.name)) {
        meshes.push(node);
      }
    });
    const centre = new THREE.Vector3();
    for (const mesh of meshes) {
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geometry.translate(-MODEL_ORIGIN.x, -MODEL_ORIGIN.y, -MODEL_ORIGIN.z);
      geometry.computeBoundingBox();
      geometry.boundingBox?.getCenter(centre);
      geometry.translate(-centre.x, -centre.y, -centre.z);
      const part = new THREE.Mesh(geometry, mesh.material);
      part.position.copy(centre);
      model.add(part);
    }
    model.scale.setScalar(MODEL_SCALE);
    // Bow +X in the file → -Z (forward) in game space.
    model.rotation.y = Math.PI / 2;
    this.template = model;

    const deck = new THREE.Group();
    for (const { x, z, side } of GUNS) {
      const gun = new THREE.Group();
      gun.add(cannon.clone());
      gun.position.set(x, DECK_Y, z);
      gun.scale.setScalar(GUN_SCALE);
      // The cannon model's barrel points +Z; swing it out to port (-X) or starboard (+X).
      gun.rotation.y = (side * Math.PI) / 2;
      const muzzle = new THREE.Object3D();
      muzzle.name = side > 0 ? 'muzzle-starboard' : 'muzzle-port';
      muzzle.position.copy(MUZZLE_LOCAL);
      gun.add(muzzle);
      deck.add(gun);
    }
    this.deckTemplate = deck;
    this.soldier = soldier;
  }

  /**
   * Tests a shot against every enemy still afloat. A cannonball breaks the ship apart; a fireball sets it
   * alight (a burning ship hit by a cannonball breaks apart at once).
   */
  hit(point: THREE.Vector3, ballVelocity: THREE.Vector3, ammo: Ammo): boolean {
    for (const enemy of this.enemies) {
      enemy.object.worldToLocal(this.local.copy(point));
      const { x, y, z } = this.local;
      if (Math.abs(x) > HIT_HALF_BEAM || Math.abs(z) > HIT_HALF_LENGTH || y < HIT_BOTTOM || y > HIT_TOP) continue;
      if (ammo === 'fireball' && enemy.burning < 0) this.ignite(enemy, this.local);
      else if (ammo === 'ball') this.breakApart(enemy, point, ballVelocity, 1);
      return true;
    }
    return false;
  }

  update(dt: number, waves: WaveState, player: Boat, spray: Spray): void {
    if (!this.template) return;
    while (this.enemies.length + this.pendingRespawns.length < FLEET_SIZE) this.spawn(player);
    this.pendingRespawns = this.pendingRespawns.map((t) => t - dt);
    while (this.pendingRespawns.length > 0 && this.pendingRespawns[0] <= 0) {
      this.pendingRespawns.shift();
      this.spawn(player);
    }

    const burntOut: Enemy[] = [];
    for (const enemy of this.enemies) {
      const o = enemy.object;
      const dx = player.position.x - o.position.x;
      const dz = player.position.z - o.position.z;
      const range = Math.hypot(dx, dz);
      const afloat = enemy.burning < 0;

      if (afloat && range < ENGAGE_RANGE) {
        // Engage: swing round to bring a broadside to bear on the player.
        const diff = angleDiff(broadsideHeading(enemy.heading, dx, dz), enemy.heading);
        enemy.heading += THREE.MathUtils.clamp(diff, -ENGAGE_TURN_RATE * dt, ENGAGE_TURN_RATE * dt);
      } else {
        enemy.turnTimer -= dt;
        if (enemy.turnTimer <= 0) {
          // Wander: hold a gentle turn for a while, then pick another.
          enemy.turn = (Math.random() - 0.5) * 0.12;
          enemy.turnTimer = 4 + Math.random() * 6;
        }
        enemy.heading += enemy.turn * dt;
      }

      // A burning ship loses way over a couple of seconds and drifts to a stop.
      const speed = afloat ? SAIL_SPEED : SAIL_SPEED * Math.max(0, 1 - enemy.burning / 2);
      o.position.x -= Math.sin(enemy.heading) * speed * dt;
      o.position.z -= Math.cos(enemy.heading) * speed * dt;
      // Run into an island? Slide along its shore and turn away from it.
      if (this.islands.pushOut(o.position, 5, this.away)) {
        const clear = Math.atan2(-this.away.x, -this.away.y);
        enemy.heading += THREE.MathUtils.clamp(angleDiff(clear, enemy.heading), -1.5 * dt, 1.5 * dt);
      }
      o.rotation.y = enemy.heading;
      // Ride the waves like the player's ship (centre height, bow/stern pitch).
      const fx = -Math.sin(enemy.heading) * 4;
      const fz = -Math.cos(enemy.heading) * 4;
      const bow = waveHeight(waves, o.position.x + fx, o.position.z + fz);
      const stern = waveHeight(waves, o.position.x - fx, o.position.z - fz);
      enemy.hull.position.y = (bow + stern) / 2;
      enemy.hull.rotation.x = Math.atan2(bow - stern, 8);
      enemy.mixer.update(dt);

      if (!afloat) {
        enemy.burning += dt;
        this.burn(enemy, dt);
        if (enemy.burning >= BURN_TIME) burntOut.push(enemy);
        continue;
      }
      enemy.reload -= dt;
      if (enemy.reload <= 0 && range >= FIRE_MIN && range <= FIRE_MAX) {
        const side = beamSide(enemy.heading, dx, dz, FIRE_ARC);
        if (side !== 0) this.broadside(enemy, side, player, range, speed);
      }
      if (range > DESPAWN) this.place(enemy, player);
    }
    // A burnt-out hull collapses: its timbers slump outward into the sea rather than blowing apart.
    for (const enemy of burntOut) {
      const centre = enemy.object.localToWorld(new THREE.Vector3(0, -1, 0));
      this.breakApart(enemy, centre, new THREE.Vector3(), 0.35);
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];
      piece.age += dt;
      if (piece.age > DEBRIS_LIFE) {
        this.group.remove(piece.mesh);
        this.debris.splice(i, 1);
        continue;
      }
      const p = piece.mesh.position;
      const sea = waveHeight(waves, p.x, p.z);
      if (piece.wet < 0) {
        piece.vel.y -= DEBRIS_GRAVITY * dt;
        if (p.y <= sea && piece.vel.y < 0) {
          piece.wet = 0;
          spray.burst(p.x, sea, p.z, 3, 0.5);
        }
      } else {
        // In the water: heavy drag, bob at the surface, then slip under.
        piece.wet += dt;
        piece.vel.multiplyScalar(Math.exp(-3 * dt));
        const target = piece.wet < DEBRIS_FLOAT ? sea : sea - (piece.wet - DEBRIS_FLOAT) * DEBRIS_SINK_SPEED;
        piece.vel.y += (target - p.y) * 8 * dt;
        piece.spin.multiplyScalar(Math.exp(-2 * dt));
      }
      p.addScaledVector(piece.vel, dt);
      this.spinQ.setFromEuler(this.euler.set(piece.spin.x * dt, piece.spin.y * dt, piece.spin.z * dt));
      piece.mesh.quaternion.multiply(this.spinQ);
    }
  }

  /** Fires every gun on one side at the player, each with its own scatter, and the officer points his sword. */
  private broadside(enemy: Enemy, side: number, player: Boat, range: number, speed: number): void {
    enemy.reload = RELOAD_MIN + Math.random() * (RELOAD_MAX - RELOAD_MIN);
    const right = { x: Math.cos(enemy.heading), z: -Math.sin(enemy.heading) };
    this.outward.set(right.x * side, right.z * side);
    this.drift.set(-Math.sin(enemy.heading) * speed, -Math.cos(enemy.heading) * speed);
    const spread = SPREAD_BASE + SPREAD_PER_M * range;
    for (const gun of enemy.guns) {
      if (gun.side !== side) continue;
      gun.muzzle.getWorldPosition(this.muzzlePos);
      this.aimPoint.set(
        player.position.x + (Math.random() - 0.5) * 2 * spread,
        player.waterline + 1.2,
        player.position.z + (Math.random() - 0.5) * 2 * spread,
      );
      solveLaunch(this.muzzlePos, this.aimPoint, player.velocity, SHOT_SPEED, this.launch);
      this.gunnery.fire(this.muzzlePos, this.launch, this.outward, this.drift);
    }
    for (const hand of enemy.hands) {
      if (!hand.order) continue;
      hand.order.reset().fadeIn(0.15).play();
      hand.idle.fadeOut(0.15);
    }
  }

  private spawn(player: Boat): void {
    if (!this.template || !this.deckTemplate || !this.soldier) return;
    const object = new THREE.Group();
    const hull = new THREE.Group();
    const model = this.template.clone();
    const deck = this.deckTemplate.clone();
    hull.add(model, deck);
    object.add(hull);
    this.group.add(object);

    const guns: Gun[] = [];
    deck.traverse((node) => {
      if (node.name === 'muzzle-port') guns.push({ muzzle: node, side: -1 });
      else if (node.name === 'muzzle-starboard') guns.push({ muzzle: node, side: 1 });
    });

    const mixer = new THREE.AnimationMixer(deck);
    const hands = CREW.map(({ at, turn, officer }) => this.addSoldier(deck, mixer, at, turn, officer));

    const enemy: Enemy = {
      object,
      hull,
      model,
      deck,
      guns,
      mixer,
      hands,
      heading: 0,
      turn: 0,
      turnTimer: 0,
      reload: 2 + Math.random() * 3,
      burning: -1,
      ignition: new THREE.Vector3(),
      charring: [],
      flameDebt: 0,
      smokeDebt: 0,
    };
    this.place(enemy, player);
    this.enemies.push(enemy);
  }

  /** Places one redcoat on `deck`, idling out of step with the others. */
  private addSoldier(deck: THREE.Group, mixer: THREE.AnimationMixer, at: THREE.Vector3, turn: number, officer: boolean): Hand {
    const template = this.soldier;
    if (!template) throw new Error('Soldier not loaded');
    const scene = cloneSkinned(template.scene);
    const box = new THREE.Box3().setFromObject(template.scene);
    const height = box.max.y - box.min.y;
    scene.scale.setScalar(SOLDIER_HEIGHT / height);
    scene.position.y = (-box.min.y * SOLDIER_HEIGHT) / height;
    const holder = new THREE.Group();
    holder.add(scene);
    holder.position.copy(at);
    holder.rotation.y = turn;
    deck.add(holder);

    // Clips are named like "CharacterArmature|…|Idle|…"; match on the action name.
    const clip = (name: string) => template.animations.find((c) => c.name.split('|').includes(name));
    const action = (name: string) => {
      const found = clip(name);
      return found ? mixer.clipAction(found, scene) : null;
    };
    const idle = action('Idle');
    if (!idle) throw new Error('Soldier has no Idle animation');
    idle.time = Math.random() * idle.getClip().duration;
    idle.play();
    const order = officer ? action('Sword') : null;
    if (order) {
      order.setLoop(THREE.LoopOnce, 1);
      order.clampWhenFinished = true;
      mixer.addEventListener('finished', (e) => {
        if (e.action !== order) return;
        idle.reset().fadeIn(FADE).play();
        order.fadeOut(FADE);
      });
    }
    return { idle, order, panic: action('Run') };
  }

  /** Puts an enemy somewhere ahead of the player, sailing across or toward their path. */
  private place(enemy: Enemy, player: Boat): void {
    const angle = player.heading + (Math.random() * 2 - 1) * SPAWN_ARC;
    const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    enemy.object.position.set(player.position.x - Math.sin(angle) * dist, 0, player.position.z - Math.cos(angle) * dist);
    // Roughly across or toward the player's path, so they cross the line of fire.
    enemy.heading = angle + Math.PI + (Math.random() - 0.5) * Math.PI;
    // Never start aground.
    this.islands.pushOut(enemy.object.position, 15, this.away);
  }

  /** A fireball struck at `localPoint` (the enemy's frame): the ship starts to burn and the crew panic. */
  private ignite(enemy: Enemy, localPoint: THREE.Vector3): void {
    enemy.burning = 0;
    enemy.ignition.copy(localPoint);
    // Give this ship its own materials so it can blacken without charring the rest of the fleet.
    const copies = new Map<THREE.Material, THREE.MeshToonMaterial>();
    enemy.hull.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshToonMaterial)) return;
      let copy = copies.get(node.material);
      if (!copy) {
        copy = node.material.clone();
        copies.set(node.material, copy);
        enemy.charring.push({ material: copy, from: copy.color.clone() });
      }
      node.material = copy;
    });
    for (const hand of enemy.hands) {
      if (!hand.panic) continue;
      hand.order?.stop();
      hand.panic.reset().fadeIn(0.2).play();
      hand.idle.fadeOut(0.2);
    }
  }

  /** One frame of a burning ship: flames spread from the impact, smoke rises, timbers blacken, the hull settles. */
  private burn(enemy: Enemy, dt: number): void {
    const t = enemy.burning / BURN_TIME;
    // Lists to one side and settles lower in the water as it burns.
    enemy.hull.rotation.z = 0.22 * t * t;
    enemy.hull.position.y -= 1.6 * t * t;
    for (const { material, from } of enemy.charring) material.color.copy(from).lerp(CHARRED, Math.min(1, t * 1.4));

    const parts = enemy.model.children;
    const ignition = enemy.object.localToWorld(this.origin.copy(enemy.ignition));
    const reach = 1.5 + enemy.burning * FIRE_SPREAD;
    enemy.flameDebt += FLAMES_PER_SECOND * dt;
    enemy.smokeDebt += SMOKE_PER_SECOND * dt;
    // Try a few random parts per flame; only those the fire has spread to catch.
    for (let tries = 0; enemy.flameDebt >= 1 && tries < 200; tries++) {
      parts[Math.floor(Math.random() * parts.length)].getWorldPosition(this.partPos);
      if (this.partPos.distanceTo(ignition) > reach) continue;
      enemy.flameDebt--;
      this.partPos.x += (Math.random() - 0.5) * 1.2;
      this.partPos.z += (Math.random() - 0.5) * 1.2;
      this.fire.flame(this.partPos, (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 0.7 + Math.random() * 0.8, 0.5 + Math.random() * 0.5);
    }
    enemy.flameDebt = Math.min(enemy.flameDebt, 1);
    for (; enemy.smokeDebt >= 1; enemy.smokeDebt--) {
      parts[Math.floor(Math.random() * parts.length)].getWorldPosition(this.partPos);
      this.partPos.y += 2;
      this.fire.smoke(this.partPos, (Math.random() - 0.5) * 1.5, 3 + Math.random() * 2, (Math.random() - 0.5) * 1.5, 1.2 + Math.random() * 0.8, 3 + Math.random() * 1.5);
    }
  }

  /** Detaches every part, gun and sailor and flings them from `impact`; `force` scales the blast (1 = cannonball). */
  private breakApart(enemy: Enemy, impact: THREE.Vector3, ballVelocity: THREE.Vector3, force: number): void {
    this.enemies.splice(this.enemies.indexOf(enemy), 1);
    enemy.mixer.stopAllAction();
    enemy.hull.updateMatrixWorld(true);
    // Detach into world space, keeping where each piece is, and fling it away from the blast.
    for (const part of [...enemy.model.children, ...enemy.deck.children]) {
      this.group.attach(part);
      const away = part.position.clone().sub(impact);
      const distance = Math.max(1, away.length());
      away.normalize();
      const blast = (force * (14 + Math.random() * 10)) / Math.sqrt(distance);
      this.debris.push({
        mesh: part,
        vel: new THREE.Vector3(
          away.x * blast + ballVelocity.x * 0.15,
          Math.abs(away.y) * blast + (4 + Math.random() * 6) * force,
          away.z * blast + ballVelocity.z * 0.15,
        ),
        spin: new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8),
        age: Math.random() * 0.5,
        wet: -1,
      });
    }
    this.group.remove(enemy.object);
    this.pendingRespawns.push(RESPAWN_DELAY);
  }
}
