import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { flight, solveLaunch } from './ballistics';

describe('solveLaunch', () => {
  it('lands on a stationary target', () => {
    const start = new THREE.Vector3(0, 2, 0);
    const target = new THREE.Vector3(80, 1, -30);
    const launch = solveLaunch(start, target, new THREE.Vector2(), 40, new THREE.Vector3());
    const t = Math.hypot(80, 30) / 40;
    const p = flight(start, launch, t, new THREE.Vector3());
    expect(p.distanceTo(target)).toBeLessThan(0.01);
  });

  it('leads a moving target so the ball meets it', () => {
    const start = new THREE.Vector3(0, 2, 0);
    const target = new THREE.Vector3(0, 1, -100);
    const vel = new THREE.Vector2(20, 0);
    const launch = solveLaunch(start, target, vel, 40, new THREE.Vector3());
    // Step through the flight and find the closest approach to the moving target.
    let best = Infinity;
    const p = new THREE.Vector3();
    for (let t = 0; t < 6; t += 0.01) {
      flight(start, launch, t, p);
      const tx = target.x + vel.x * t;
      const tz = target.z + vel.y * t;
      best = Math.min(best, Math.hypot(p.x - tx, p.y - target.y, p.z - tz));
    }
    expect(best).toBeLessThan(0.5);
  });
});
