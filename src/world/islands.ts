import * as THREE from 'three';
import { loadToonModel, toonGradient } from '../render/toon';
import { groundHeight, ISLAND_CELL, islandForCell, landHeight, pushOut, rng, SHELF, shoreRadius, type IslandShape } from './island-shape';

/** Kenney Pirate Kit (CC0) — see public/models/kenney/LICENSE.txt. */
const PALM_URLS = ['/models/kenney/palm-detailed-bend.glb', '/models/kenney/palm-detailed-straight.glb'];
const BARREL_URL = '/models/kenney/barrel.glb';
const ROCK_URLS = ['/models/kenney/rocks-sand-a.glb', '/models/kenney/rocks-sand-b.glb'];
/** "Tribal Man" by Polygonal Mind (CC0) — see public/models/polygonal-mind/LICENSE.txt. */
const NATIVE_URL = '/models/polygonal-mind/tribal-man.glb';

/** Islands are built when their cell centre comes within ACTIVE metres, and dropped past RELEASE. */
const ACTIVE = 1100;
const RELEASE = 1350;

const NATIVE_HEIGHT = 1.35;
const BARREL_SCALE = 0.6;
const SAND = new THREE.Color('#f0d59a');
const SAND_WET = new THREE.Color('#c9ab72');
const GRASS = new THREE.Color('#5daa45');
const GRASS_DARK = new THREE.Color('#2f7a33');
const ROCK = new THREE.Color('#9a8a78');
const ROCK_DARK = new THREE.Color('#6d6052');
/** Totem poles: each carved face is this tall (m) and stacks on a plinth this high. */
const TOTEM_SEGMENT = 2.4;
const TOTEM_BASE = 0.9;
/** Totem bands: base colour of each carved face. */
const TOTEM_COLOURS = ['#c0392b', '#1f8a8a', '#e1b12c', '#3c8d3c', '#7d3c98'];

interface Native {
  object: THREE.Object3D;
  phase: number;
}

interface Island {
  shape: IslandShape;
  group: THREE.Group;
  natives: Native[];
}

interface Assets {
  palms: THREE.Group[];
  barrel: THREE.Group;
  rocks: THREE.Group[];
  native: THREE.Mesh;
  totemFaces: THREE.Material[];
  totemSegment: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  plinth: THREE.BufferGeometry;
  stone: THREE.Material;
  terrain: THREE.Material;
  foam: THREE.MeshBasicMaterial;
}

/** Something a ship must stay out of. */
export interface Obstacles {
  /** See `pushOut` in island-shape.ts. */
  pushOut(pos: { x: number; z: number }, clearance: number, out: { x: number; y: number }): boolean;
}

/**
 * Tropical islands scattered across the ocean, from small sandy islets to big islands with a tall central peak,
 * lesser hills and valleys: beaches round the shore, grass inland and bare rock on the steep high ground. On
 * them: palms, rocks, barrels of rum, towering carved totem poles and tribesmen who hop about and turn to watch
 * passing ships. A ring of foam laps the shore. Islands appear as the player sails toward them and are dropped
 * once far behind.
 */
export class Islands implements Obstacles {
  readonly group = new THREE.Group();
  private readonly islands = new Map<string, Island>();
  private assets: Assets | null = null;
  private time = 0;
  private readonly world = new THREE.Vector3();

  async load(): Promise<void> {
    const [palms, barrel, rocks, nativeScene] = await Promise.all([
      Promise.all(PALM_URLS.map((url) => loadToonModel(url))),
      loadToonModel(BARREL_URL),
      Promise.all(ROCK_URLS.map((url) => loadToonModel(url))),
      loadToonModel(NATIVE_URL),
    ]);
    const foam = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false });
    foam.userData.outlineParameters = { visible: false };
    this.assets = {
      palms,
      barrel,
      rocks,
      native: prepareNative(nativeScene),
      totemFaces: TOTEM_COLOURS.map((c) => new THREE.MeshToonMaterial({ map: drawTotemFace(c), gradientMap: toonGradient })),
      totemSegment: new THREE.CylinderGeometry(1.0, 1.1, TOTEM_SEGMENT, 12),
      wing: new THREE.BoxGeometry(3.4, 1.0, 0.28),
      plinth: new THREE.CylinderGeometry(1.7, 1.9, 1.6, 8),
      stone: new THREE.MeshToonMaterial({ color: ROCK, gradientMap: toonGradient }),
      terrain: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient }),
      foam,
    };
  }

  /** Highest island ground at world (x, z), or -Infinity over open sea. */
  groundAt(x: number, z: number): number {
    let h = -Infinity;
    for (const { shape } of this.islands.values()) h = Math.max(h, groundHeight(shape, x, z));
    return h;
  }

  pushOut(pos: { x: number; z: number }, clearance: number, out: { x: number; y: number }): boolean {
    let pushed = false;
    for (const { shape } of this.islands.values()) pushed = pushOut(shape, pos, clearance, out) || pushed;
    return pushed;
  }

  /** Builds islands coming into range (one per frame, to avoid hitches), drops distant ones, animates natives. */
  update(dt: number, focus: THREE.Vector3, watcher: THREE.Vector3): void {
    if (!this.assets) return;
    this.time += dt;
    const ci = Math.floor(focus.x / ISLAND_CELL);
    const cj = Math.floor(focus.z / ISLAND_CELL);
    const reach = Math.ceil(ACTIVE / ISLAND_CELL);
    let built = false;
    for (let i = ci - reach; i <= ci + reach && !built; i++) {
      for (let j = cj - reach; j <= cj + reach && !built; j++) {
        const key = `${i},${j}`;
        if (this.islands.has(key)) continue;
        const cx = (i + 0.5) * ISLAND_CELL;
        const cz = (j + 0.5) * ISLAND_CELL;
        if (Math.hypot(cx - focus.x, cz - focus.z) > ACTIVE) continue;
        const shape = islandForCell(i, j);
        if (!shape) continue;
        this.islands.set(key, this.build(shape));
        built = true;
      }
    }
    for (const [key, island] of this.islands) {
      if (Math.hypot(island.shape.x - focus.x, island.shape.z - focus.z) > RELEASE) {
        this.group.remove(island.group);
        island.group.traverse((node) => {
          if (node instanceof THREE.Mesh && node.userData.ownGeometry) node.geometry.dispose();
        });
        this.islands.delete(key);
      }
    }

    if (this.assets) this.assets.foam.opacity = 0.6 + 0.3 * Math.sin(this.time * 1.7);
    for (const island of this.islands.values()) {
      const near = Math.hypot(island.shape.x - watcher.x, island.shape.z - watcher.z) < island.shape.radius + 140;
      for (const native of island.natives) this.animateNative(native, near, watcher, dt);
    }
  }

  /** Hops on the spot; when a ship comes near, turns to watch it and jumps about excitedly. */
  private animateNative(native: Native, near: boolean, watcher: THREE.Vector3, dt: number): void {
    const o = native.object;
    const speed = near ? 7.5 : 3;
    const t = this.time * speed + native.phase;
    o.children[0].position.y = Math.abs(Math.sin(t)) * (near ? 0.4 : 0.08);
    o.children[0].rotation.z = Math.sin(t) * (near ? 0.18 : 0.06);
    if (near) {
      o.getWorldPosition(this.world);
      const target = Math.atan2(-(watcher.x - this.world.x), -(watcher.z - this.world.z));
      const diff = Math.atan2(Math.sin(target - o.rotation.y), Math.cos(target - o.rotation.y));
      o.rotation.y += diff * (1 - Math.exp(-4 * dt));
    } else {
      o.rotation.y += Math.sin(this.time * 0.3 + native.phase) * 0.2 * dt;
    }
  }

  private build(shape: IslandShape): Island {
    const assets = this.assets;
    if (!assets) throw new Error('Island assets not loaded');
    const rand = rng(shape.seed);
    const group = new THREE.Group();
    group.position.set(shape.x, 0, shape.z);

    const terrain = new THREE.Mesh(terrainGeometry(shape, rand), assets.terrain);
    terrain.userData.ownGeometry = true;
    group.add(terrain);
    const foam = new THREE.Mesh(foamGeometry(shape), assets.foam);
    foam.userData.ownGeometry = true;
    foam.position.y = 0.12;
    foam.renderOrder = 2;
    group.add(foam);

    // Props are scattered by rejection sampling so they don't overlap.
    const taken: { x: number; z: number; r: number }[] = [];
    const spot = (uMin: number, uMax: number, room: number): { x: number; z: number; y: number; angle: number } | null => {
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = rand() * Math.PI * 2;
        const u = uMin + rand() * (uMax - uMin);
        const r = u * shoreRadius(shape, angle);
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (taken.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + room)) continue;
        taken.push({ x, z, r: room });
        return { x, z, y: landHeight(shape, x, z), angle };
      }
      return null;
    };
    /** Y rotation that turns a prop's front (-Z) to face out to sea along `angle`. */
    const outward = (angle: number) => Math.atan2(-Math.cos(angle), -Math.sin(angle));

    const totems = shape.radius > 70 ? 3 : shape.radius > 40 ? 2 : 1;
    for (let k = 0; k < totems; k++) {
      const at = spot(0.45, 0.75, 6);
      if (!at) continue;
      const totem = buildTotem(assets, rand);
      // Seat it on the lowest point under its plinth so no side floats on a slope.
      let floor = at.y;
      for (let a = 0; a < 6; a++) floor = Math.min(floor, landHeight(shape, at.x + Math.cos(a) * 1.8, at.z + Math.sin(a) * 1.8));
      totem.position.set(at.x, floor - 0.1, at.z);
      totem.rotation.y = outward(at.angle) + (rand() - 0.5) * 0.6;
      group.add(totem);
    }
    const palms = 2 + Math.floor(shape.radius / 7);
    for (let k = 0; k < palms; k++) {
      // Mostly along the beach and lowlands, some climbing the hills.
      const at = k % 4 === 3 ? spot(0.2, 0.7, 2.5) : spot(0.6, 0.86, 2.5);
      if (!at) continue;
      const palm = assets.palms[Math.floor(rand() * assets.palms.length)].clone();
      palm.scale.setScalar(1.3 + rand() * 0.6);
      palm.position.set(at.x, at.y - 0.1, at.z);
      palm.rotation.y = rand() * Math.PI * 2;
      group.add(palm);
    }
    for (let k = 0, rocks = 1 + Math.floor(rand() * 2) + Math.floor(shape.radius / 40); k < rocks; k++) {
      const at = spot(0.85, 1.02, 3);
      if (!at) continue;
      const rock = assets.rocks[Math.floor(rand() * assets.rocks.length)].clone();
      rock.scale.setScalar(0.7 + rand() * 0.6);
      rock.position.set(at.x, at.y - 0.4, at.z);
      rock.rotation.y = rand() * Math.PI * 2;
      group.add(rock);
    }
    // A stash of rum barrels near the beach, one knocked over.
    const stash = spot(0.6, 0.78, 2.5);
    if (stash) {
      const count = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        const barrel = assets.barrel.clone();
        barrel.scale.setScalar(BARREL_SCALE);
        const a = (k / count) * Math.PI * 2 + rand();
        const bx = stash.x + Math.cos(a) * 0.7;
        const bz = stash.z + Math.sin(a) * 0.7;
        barrel.position.set(bx, landHeight(shape, bx, bz) - 0.05, bz);
        if (k === count - 1) {
          barrel.rotation.z = Math.PI / 2;
          barrel.position.y += 0.4;
        }
        barrel.rotation.y = rand() * Math.PI * 2;
        group.add(barrel);
      }
    }
    const natives: Native[] = [];
    for (let k = 0, count = 2 + Math.floor(rand() * 3) + Math.floor(shape.radius / 35); k < count; k++) {
      const at = spot(0.5, 0.82, 1.4);
      if (!at) continue;
      // The holder turns; its child hops and sways.
      const holder = new THREE.Group();
      const body = new THREE.Mesh(assets.native.geometry, assets.native.material);
      holder.add(body);
      holder.position.set(at.x, at.y - 0.05, at.z);
      holder.rotation.y = outward(at.angle);
      group.add(holder);
      natives.push({ object: holder, phase: rand() * Math.PI * 2 });
    }

    this.group.add(group);
    return { shape, group, natives };
  }
}

/**
 * Radial grid from the middle out to the edge of the shelf, finer on bigger islands. Coloured by height and
 * slope: wet sand at the waterline, the beach, grass inland darkening up the hills, and bare rock on steep
 * slopes and high peaks.
 */
function terrainGeometry(shape: IslandShape, rand: () => number): THREE.BufferGeometry {
  const rings = Math.round(THREE.MathUtils.clamp(shape.radius / 2.6, 18, 52));
  const segments = Math.round(THREE.MathUtils.clamp(shape.radius * 1.3, 56, 170));
  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new THREE.Color();
  // Grass starts at a height that varies a little round the island.
  const grassLine = 0.75 + rand() * 0.3;
  const rockLine = shape.height * (0.72 + rand() * 0.1);
  for (let r = 0; r <= rings; r++) {
    // Rings bunch up toward the shore, where the beach and its rise need the detail.
    const t = r / rings;
    const u = t <= 0.7 ? (t / 0.7) * 0.85 : 0.85 + ((t - 0.7) / 0.3) * (SHELF - 0.85);
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const radius = u * shoreRadius(shape, angle);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = landHeight(shape, x, z);
      positions.push(x, y, z);
      const slope = Math.hypot(landHeight(shape, x + 1, z) - y, landHeight(shape, x, z + 1) - y);
      if (y < 0.15) colour.copy(SAND_WET);
      else if (y < grassLine + Math.sin(angle * 5 + shape.seed) * 0.15) colour.copy(SAND);
      else if (slope > 0.75 || y > rockLine) colour.copy(ROCK).lerp(ROCK_DARK, Math.min(1, slope - 0.75));
      else colour.copy(GRASS).lerp(GRASS_DARK, Math.min(1, (y - grassLine) / Math.max(1, rockLine - grassLine)));
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * segments + s;
      const b = r * segments + ((s + 1) % segments);
      const c = (r + 1) * segments + s;
      const d = (r + 1) * segments + ((s + 1) % segments);
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  // Unshared vertices give each facet its own normal: chunky, low-poly hills.
  const faceted = geometry.toNonIndexed();
  geometry.dispose();
  faceted.computeVertexNormals();
  return faceted;
}

/** A band of foam lapping the shoreline: opaque at the beach, fading out to sea. */
function foamGeometry(shape: IslandShape): THREE.BufferGeometry {
  const segments = 72;
  const inner = 0.96;
  const outer = 1.12;
  const positions: number[] = [];
  const colours: number[] = [];
  for (let s = 0; s < segments; s++) {
    const angle = (s / segments) * Math.PI * 2;
    const shore = shoreRadius(shape, angle);
    for (const [u, alpha] of [
      [inner, 0.9],
      [outer, 0],
    ]) {
      positions.push(Math.cos(angle) * shore * u, 0, Math.sin(angle) * shore * u);
      colours.push(1, 1, 1, alpha);
    }
  }
  const index: number[] = [];
  for (let s = 0; s < segments; s++) {
    const a = s * 2;
    const b = ((s + 1) % segments) * 2;
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
  geometry.setIndex(index);
  return geometry;
}

/**
 * A towering stack of carved faces (12–16 m with its plinth), the top one with outspread wings. It stands on a
 * stone plinth sunk into the ground so it sits level on a slope. Front faces -Z.
 */
function buildTotem(assets: Assets, rand: () => number): THREE.Group {
  const totem = new THREE.Group();
  const plinth = new THREE.Mesh(assets.plinth, assets.stone);
  plinth.position.y = 0.2;
  totem.add(plinth);
  const count = 4 + Math.floor(rand() * 3);
  for (let k = 0; k < count; k++) {
    const segment = new THREE.Mesh(assets.totemSegment, assets.totemFaces[Math.floor(rand() * assets.totemFaces.length)]);
    segment.position.y = TOTEM_BASE + TOTEM_SEGMENT / 2 + k * TOTEM_SEGMENT;
    // Each face turned a touch differently, as if carved by hand.
    segment.rotation.y = (rand() - 0.5) * 0.25;
    totem.add(segment);
  }
  const top = TOTEM_BASE + (count - 0.5) * TOTEM_SEGMENT;
  const wingMaterial = assets.totemFaces[Math.floor(rand() * assets.totemFaces.length)];
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(assets.wing, wingMaterial);
    wing.position.set(side * 2.6, top, 0);
    wing.rotation.z = side * 0.35;
    totem.add(wing);
  }
  return totem;
}

/**
 * Paints a carved tiki face onto a cylinder's texture: the face sits at u = 0.5, which CylinderGeometry puts
 * on its -Z side (the front), and the rest is bare wood.
 */
function drawTotemFace(base: string): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = base;
  ctx.fillRect(140, 0, 232, h);
  // Dark carved rings top and bottom.
  ctx.fillStyle = '#3b2412';
  ctx.fillRect(0, 0, w, 18);
  ctx.fillRect(0, h - 18, w, 18);
  // Brows.
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#1b120a';
  ctx.beginPath();
  ctx.moveTo(180, 70);
  ctx.lineTo(240, 88);
  ctx.moveTo(332, 70);
  ctx.lineTo(272, 88);
  ctx.stroke();
  // Eyes.
  for (const x of [212, 300]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, 112, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(x, 116, 11, 0, Math.PI * 2);
    ctx.fill();
  }
  // Nose.
  ctx.fillStyle = '#1b120a';
  ctx.beginPath();
  ctx.moveTo(256, 120);
  ctx.lineTo(238, 160);
  ctx.lineTo(274, 160);
  ctx.closePath();
  ctx.fill();
  // Grinning mouth with teeth.
  ctx.fillRect(184, 176, 144, 46);
  ctx.fillStyle = '#ffffff';
  for (let x = 190; x < 322; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 178);
    ctx.lineTo(x + 18, 178);
    ctx.lineTo(x + 9, 196);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, 220);
    ctx.lineTo(x + 18, 220);
    ctx.lineTo(x + 9, 202);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Bakes the tribal man into one standing mesh: lowers his arms from the T-pose (rotating each arm about its
 * shoulder), turns him to face -Z, scales him to NATIVE_HEIGHT with his feet at y 0.
 */
function prepareNative(scene: THREE.Group): THREE.Mesh {
  scene.updateMatrixWorld(true);
  let source: THREE.Mesh | null = null;
  scene.traverse((node) => {
    if (!source && node instanceof THREE.Mesh) source = node;
  });
  if (!source) throw new Error('Tribal man model has no mesh');
  const mesh: THREE.Mesh = source;
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  // In the file he stands 4.6 units tall facing +X, arms out along ±Z at shoulder height 3.5, shoulders at |z| 0.5.
  const SHOULDER_Y = 3.5;
  const SHOULDER_Z = 0.5;
  const DROP = 1.15;
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const side = Math.sign(z);
    const weight = THREE.MathUtils.smoothstep(Math.abs(z), 0.45, 0.75);
    if (weight === 0) continue;
    const a = side * DROP * weight;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const dy = pos.getY(i) - SHOULDER_Y;
    const dz = z - side * SHOULDER_Z;
    pos.setY(i, SHOULDER_Y + dy * cos - dz * sin);
    pos.setZ(i, side * SHOULDER_Z + dy * sin + dz * cos);
    if (nrm) {
      const ny = nrm.getY(i);
      const nz = nrm.getZ(i);
      nrm.setY(i, ny * cos - nz * sin);
      nrm.setZ(i, ny * sin + nz * cos);
    }
  }
  geometry.rotateY(Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const scale = NATIVE_HEIGHT / (box.max.y - box.min.y);
  geometry.translate(0, -box.min.y, 0);
  geometry.scale(scale, scale, scale);
  return new THREE.Mesh(geometry, mesh.material);
}
