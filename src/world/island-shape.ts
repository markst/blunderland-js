/**
 * Island layout and shape, kept free of rendering so collision and placement can be tested. The ocean is cut
 * into square cells; each cell deterministically holds at most one island, so the same islands are always in
 * the same places however the player sails.
 *
 * Terrain: a sand beach ringing the shore, rising inland into rolling ground with one or more hills (a big
 * island gets a tall central peak with lesser hills and valleys around it), then a sandy shelf sloping away
 * under the sea past the shoreline.
 */

/** Size of one world cell (m). */
export const ISLAND_CELL = 520;
/** Chance a cell holds an island, and chance that island is a big one. */
const CHANCE = 0.5;
const BIG_CHANCE = 0.3;
/** No island within this distance (m) of the start, so the player begins in open water. */
const START_CLEAR = 150;
/** The seabed shelves down past the shoreline out to this multiple of the shore radius. */
export const SHELF = 1.3;
/** Depth (m) the shelf reaches. */
const SHELF_DEPTH = 3;
/** Shoreline wobble can push the shore out to this multiple of the mean radius. */
const WOBBLE_MAX = 1.35;
/** The beach rises to this height (m) and runs this far inland (share of the shore radius). */
const BEACH_HEIGHT = 0.6;
const BEACH_WIDTH = 0.16;

export interface Hill {
  /** Centre relative to the island centre (m). */
  x: number;
  z: number;
  /** Spread (m) and peak height (m). */
  r: number;
  h: number;
}

export interface IslandShape {
  x: number;
  z: number;
  /** Mean shoreline radius (m). */
  radius: number;
  /** Height (m) of the tallest hill. */
  height: number;
  hills: Hill[];
  /** Seed for everything placed on it. */
  seed: number;
  /** Shoreline wobble: radius multiplier 1 + Σ amp·sin(k·angle + phase). */
  wobble: { k: number; amp: number; phase: number }[];
  /** Rolling ground between the hills: amplitude (m) and phases of two crossed waves. */
  roll: { amp: number; a: number; b: number };
}

/** Small fast deterministic RNG (mulberry32), returning [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellSeed(i: number, j: number): number {
  return (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ 0x5bd1e995) >>> 0;
}

/** The island in cell (i, j), or null for open sea. */
export function islandForCell(i: number, j: number): IslandShape | null {
  const rand = rng(cellSeed(i, j));
  if (rand() > CHANCE) return null;
  const big = rand() < BIG_CHANCE;
  const radius = big ? 75 + rand() * 60 : 22 + rand() * 34;
  // Keep the whole shelf inside the cell so neighbouring islands never overlap.
  const reach = radius * SHELF * WOBBLE_MAX;
  const margin = Math.max(0, ISLAND_CELL / 2 - reach - 15);
  const x = (i + 0.5) * ISLAND_CELL + (rand() * 2 - 1) * margin;
  const z = (j + 0.5) * ISLAND_CELL + (rand() * 2 - 1) * margin;
  if (Math.hypot(x, z) < START_CLEAR + reach) return null;
  const wobble = [2, 3, 5].map((k) => ({ k, amp: 0.03 + rand() * 0.07, phase: rand() * Math.PI * 2 }));

  // A main peak off-centre, then lesser hills scattered round it.
  const hills: Hill[] = [];
  const peak = big ? 18 + rand() * 16 : 4 + rand() * 4;
  const pa = rand() * Math.PI * 2;
  const pd = rand() * radius * 0.25;
  hills.push({ x: Math.cos(pa) * pd, z: Math.sin(pa) * pd, r: radius * (big ? 0.32 : 0.45), h: peak });
  const extra = big ? 3 + Math.floor(rand() * 4) : Math.floor(rand() * 2);
  for (let k = 0; k < extra; k++) {
    const a = rand() * Math.PI * 2;
    const d = radius * (0.25 + rand() * 0.4);
    hills.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: radius * (0.12 + rand() * 0.18), h: peak * (0.25 + rand() * 0.45) });
  }
  const roll = { amp: big ? 1.5 + rand() * 1.5 : 0.4, a: rand() * Math.PI * 2, b: rand() * Math.PI * 2 };
  const shape: IslandShape = { x, z, radius, height: 0, hills, seed: Math.floor(rand() * 4294967296), wobble, roll };
  shape.height = Math.max(...hills.map((h) => landHeight(shape, h.x, h.z)));
  return shape;
}

/** Shoreline radius (m) in direction `angle` (radians, atan2(dz, dx)). */
export function shoreRadius(s: IslandShape, angle: number): number {
  let f = 1;
  for (const w of s.wobble) f += w.amp * Math.sin(w.k * angle + w.phase);
  return s.radius * f;
}

/** Ground height at (lx, lz) relative to the island centre, or -Infinity past the shelf. */
export function landHeight(s: IslandShape, lx: number, lz: number): number {
  const d = Math.hypot(lx, lz);
  if (d > s.radius * SHELF * WOBBLE_MAX) return -Infinity;
  const u = d / shoreRadius(s, Math.atan2(lz, lx));
  if (u > SHELF) return -Infinity;
  if (u >= 1) return -SHELF_DEPTH * Math.min(1, (u - 1) / (SHELF - 1));
  // Hills and rolling ground, fading out toward the beach so the shoreline stays at sea level.
  let h = 0;
  for (const hill of s.hills) {
    const e = Math.hypot(lx - hill.x, lz - hill.z) / hill.r;
    h += hill.h * Math.exp(-e * e);
  }
  const k = 6 / s.radius;
  h += s.roll.amp * (Math.sin(lx * k + s.roll.a) * Math.sin(lz * k * 1.3 + s.roll.b) + 0.5);
  const inland = Math.min(1, Math.max(0, (1 - u) / (1 - BEACH_WIDTH * 2)));
  const terrain = h * inland * inland * (3 - 2 * inland);
  // The beach: a gentle ramp from the waterline up to BEACH_HEIGHT, under whatever terrain rises above it.
  const beach = BEACH_HEIGHT * Math.min(1, (1 - u) / BEACH_WIDTH);
  return Math.max(beach, terrain);
}

/** Ground height at world (x, z), or -Infinity past the island's shelf. */
export function groundHeight(s: IslandShape, x: number, z: number): number {
  return landHeight(s, x - s.x, z - s.z);
}

/**
 * Keeps a hull of `clearance` metres out of the island: if `pos` (world xz) is closer than the shoreline plus
 * `clearance`, moves it back out radially, writes the outward direction to `out` and returns true.
 */
export function pushOut(s: IslandShape, pos: { x: number; z: number }, clearance: number, out: { x: number; y: number }): boolean {
  const dx = pos.x - s.x;
  const dz = pos.z - s.z;
  const d = Math.hypot(dx, dz);
  if (d > s.radius * WOBBLE_MAX + clearance) return false;
  const angle = Math.atan2(dz, dx);
  const limit = shoreRadius(s, angle) + clearance;
  if (d >= limit - 1e-6) return false;
  const nx = d > 1e-6 ? dx / d : 1;
  const nz = d > 1e-6 ? dz / d : 0;
  pos.x = s.x + nx * limit;
  pos.z = s.z + nz * limit;
  out.x = nx;
  out.y = nz;
  return true;
}
