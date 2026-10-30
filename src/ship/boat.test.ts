import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Boat, MAX_SPEED } from './boat';
import { createWaveState } from '../world/waves';

/** Sails from rest with a constant world-space water slope (x: east/right, y: south; -y is forward). */
function sail(downhillX: number, downhillZ: number, seconds: number): Boat {
  const boat = new Boat();
  const waves = createWaveState();
  const downhill = new THREE.Vector2(downhillX, downhillZ);
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) boat.update(dt, downhill, waves);
  return boat;
}

describe('Boat on a tilted sea', () => {
  it('stays put on level water', () => {
    const boat = sail(0, 0, 5);
    expect(boat.position.x).toBe(0);
    expect(boat.position.z).toBe(0);
  });

  it('runs forward downhill and settles at MAX_SPEED', () => {
    const boat = sail(0, -1, 20);
    expect(boat.position.z).toBeLessThan(-100);
    expect(boat.velocity.length()).toBeCloseTo(MAX_SPEED, 0);
    expect(boat.heading).toBeCloseTo(0, 6);
  });

  it('drifts toward the lower right side and swings round to sail that way', () => {
    const boat = sail(1, 0, 4);
    expect(boat.position.x).toBeGreaterThan(5);
    expect(boat.heading).toBeLessThan(-0.5);
  });

  it('drifts stern-first when the near side is lower, without spinning round', () => {
    const boat = sail(0, 1, 5);
    expect(boat.position.z).toBeGreaterThan(10);
    expect(boat.heading).toBe(0);
  });
});
