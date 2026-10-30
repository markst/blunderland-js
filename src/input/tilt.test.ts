import { describe, expect, it } from 'vitest';
import { screenRelativeTilt, springResponse, STEER, THROTTLE, tiltDelta, tiltToInput } from './tilt';

const upright = { roll: 0, pitch: 0 };

function expectTilt(actual: { roll: number; pitch: number }, roll: number, pitch: number) {
  expect(actual.roll).toBeCloseTo(roll, 4);
  expect(actual.pitch).toBeCloseTo(pitch, 4);
}

describe('tiltToInput', () => {
  it('has no threshold: a slight tilt gives a small, gentle response and level gives none', () => {
    expect(tiltToInput(upright, upright)).toEqual({ steer: 0, throttle: 0 });
    const slight = tiltToInput({ roll: 1, pitch: -1 }, upright);
    expect(slight.steer).toBeGreaterThan(0);
    expect(slight.steer).toBeLessThan(0.03);
    expect(slight.throttle).toBeLessThan(0);
    expect(slight.throttle).toBeGreaterThan(-0.04);
  });

  it('pulls like a spring: each extra degree counts for less toward the extreme', () => {
    const s = (deg: number) => springResponse(deg, STEER);
    expect(s(10) - s(5)).toBeGreaterThan(2 * (s(20) - s(15)));
    expect(s(STEER.full)).toBeCloseTo(0.95, 6);
    expect(s(90)).toBeLessThan(1);
    expect(s(90)).toBeGreaterThan(0.99);
    expect(springResponse(-10, STEER)).toBeCloseTo(-s(10), 12);
  });

  it('measures throttle from the calibrated pose; tipping the top away (far side lower) runs forward', () => {
    const forward = tiltToInput({ roll: 0, pitch: 40 + THROTTLE.full }, { roll: 0, pitch: 40 }).throttle;
    expect(forward).toBeCloseTo(0.95, 6);
    expect(tiltToInput({ roll: 0, pitch: 40 - THROTTLE.full }, { roll: 0, pitch: 40 }).throttle).toBeCloseTo(-0.95, 6);
  });

  it('wraps the pitch difference across ±180°', () => {
    expect(tiltDelta({ roll: 0, pitch: -175 }, { roll: 0, pitch: 175 }).y).toBeCloseTo(10, 6);
  });
});

describe('screenRelativeTilt', () => {
  it('reads an upright portrait phone facing the user as zero', () => {
    expectTilt(screenRelativeTilt({ beta: 90, gamma: 0 }, 0), 0, 0);
  });

  it('reads a phone lying flat as 90° pitch', () => {
    expectTilt(screenRelativeTilt({ beta: 0, gamma: 0 }, 0), 0, 90);
  });

  it('measures leaning the top edge away from an upright pose', () => {
    expectTilt(screenRelativeTilt({ beta: 60, gamma: 0 }, 0), 0, 30);
  });

  it('reads an upright landscape phone as zero in both landscape directions', () => {
    expectTilt(screenRelativeTilt({ beta: 0, gamma: -90 }, 90), 0, 0);
    expectTilt(screenRelativeTilt({ beta: 0, gamma: -90 }, -270), 0, 0);
    // Same physical pose reported through either side of the gamma wrap.
    expectTilt(screenRelativeTilt({ beta: 180, gamma: -90 }, 270), 0, 0);
    expectTilt(screenRelativeTilt({ beta: 0, gamma: 89.999999 }, 270), 0, 0);
  });

  it('reads a clockwise steering-wheel turn in landscape as positive roll', () => {
    expectTilt(screenRelativeTilt({ beta: 30, gamma: -90 }, 90), 30, 0);
  });

  it('reads the right edge dipping on a flat phone as positive roll', () => {
    expect(screenRelativeTilt({ beta: 0, gamma: 20 }, 0).roll).toBeCloseTo(20, 6);
  });
});
