import { describe, expect, it } from 'vitest';
import { angleDiff, beamSide, broadsideHeading } from './tactics';

const ARC = Math.cos((55 * Math.PI) / 180);

describe('beamSide', () => {
  it('sees a target abeam to starboard or port, and nothing dead ahead or astern', () => {
    // Heading 0 faces -Z, so starboard is +X.
    expect(beamSide(0, 50, 0, ARC)).toBe(1);
    expect(beamSide(0, -50, 0, ARC)).toBe(-1);
    expect(beamSide(0, 0, -50, ARC)).toBe(0);
    expect(beamSide(0, 0, 50, ARC)).toBe(0);
  });

  it('follows the ship as it turns', () => {
    // Facing +X (heading -π/2), a target at +Z is on the starboard beam.
    expect(beamSide(-Math.PI / 2, 0, 50, ARC)).toBe(1);
  });
});

describe('broadsideHeading', () => {
  it('turns the nearer way to bring the target onto a beam', () => {
    for (const [heading, dx, dz] of [
      [0, 30, -80],
      [1.2, -60, 20],
      [-2.5, 10, 90],
    ]) {
      const h = broadsideHeading(heading, dx, dz);
      expect(beamSide(h, dx, dz, 0.999)).not.toBe(0);
      expect(Math.abs(angleDiff(h, heading))).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });
});
