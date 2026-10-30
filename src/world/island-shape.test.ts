import { describe, expect, it } from 'vitest';
import { groundHeight, ISLAND_CELL, islandForCell, landHeight, pushOut, SHELF, shoreRadius, type IslandShape } from './island-shape';

const island: IslandShape = {
  x: 100,
  z: -50,
  radius: 30,
  height: 6,
  hills: [{ x: 0, z: 0, r: 12, h: 6 }],
  seed: 1,
  wobble: [{ k: 3, amp: 0.1, phase: 0.4 }],
  roll: { amp: 0, a: 0, b: 0 },
};

describe('island shape', () => {
  it('rises to its hill inland, meets the sea at the shore and dips under past it', () => {
    expect(groundHeight(island, 100, -50)).toBeGreaterThan(5);
    const shore = shoreRadius(island, 0);
    expect(groundHeight(island, 100 + shore, -50)).toBeCloseTo(0, 6);
    expect(groundHeight(island, 100 + shore * 0.95, -50)).toBeGreaterThan(0);
    expect(groundHeight(island, 100 + shore * 1.15, -50)).toBeLessThan(0);
    expect(groundHeight(island, 100 + shore * (SHELF + 0.2), -50)).toBe(-Infinity);
  });

  it('pushes a ship out to the shoreline plus its clearance, pointing away from the island', () => {
    const pos = { x: 110, z: -50 };
    const n = { x: 0, y: 0 };
    expect(pushOut(island, pos, 3, n)).toBe(true);
    expect(Math.hypot(pos.x - 100, pos.z + 50)).toBeCloseTo(shoreRadius(island, 0) + 3, 6);
    expect(n.x).toBeCloseTo(1, 6);
    expect(pushOut(island, pos, 3, n)).toBe(false);
  });
});

describe('island layout', () => {
  it('is the same every time and keeps the start clear', () => {
    expect(islandForCell(3, -2)).toEqual(islandForCell(3, -2));
    for (let i = -1; i <= 0; i++) {
      for (let j = -1; j <= 0; j++) {
        const s = islandForCell(i, j);
        if (s) expect(Math.hypot(s.x, s.z)).toBeGreaterThan(150 + s.radius);
      }
    }
  });

  it('mixes small islets with big hilly islands, each inside its own cell with land all round', () => {
    let small = 0;
    let big = 0;
    for (let i = -12; i < 12; i++) {
      for (let j = -12; j < 12; j++) {
        const s = islandForCell(i, j);
        if (!s) continue;
        if (s.radius >= 75) {
          big++;
          expect(s.height).toBeGreaterThan(15);
        } else {
          small++;
        }
        const reach = s.radius * SHELF * 1.35;
        expect(s.x - reach).toBeGreaterThanOrEqual(i * ISLAND_CELL - 1e-6);
        expect(s.x + reach).toBeLessThanOrEqual((i + 1) * ISLAND_CELL + 1e-6);
        expect(s.z - reach).toBeGreaterThanOrEqual(j * ISLAND_CELL - 1e-6);
        expect(s.z + reach).toBeLessThanOrEqual((j + 1) * ISLAND_CELL + 1e-6);
        // No dry patch dips below the sea inside the shoreline.
        for (let a = 0; a < Math.PI * 2; a += 0.5) {
          for (const u of [0.2, 0.5, 0.9]) {
            const r = shoreRadius(s, a) * u;
            expect(landHeight(s, Math.cos(a) * r, Math.sin(a) * r)).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(small).toBeGreaterThan(100);
    expect(big).toBeGreaterThan(40);
  });
});
