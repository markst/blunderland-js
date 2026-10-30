import { describe, expect, it } from 'vitest';
import { FIREBALL_COOLDOWN, FireballCharge } from './fireball-charge';

describe('FireballCharge', () => {
  it('starts ready and arms on tap', () => {
    const charge = new FireballCharge();
    expect(charge.ready).toBe(true);
    charge.toggle();
    expect(charge.armed).toBe(true);
    charge.toggle();
    expect(charge.armed).toBe(false);
  });

  it('allows only one fireball per cooldown', () => {
    const charge = new FireballCharge();
    charge.toggle();
    charge.spend();
    expect(charge.armed).toBe(false);
    charge.update(FIREBALL_COOLDOWN - 1);
    charge.toggle();
    expect(charge.armed).toBe(false);
    expect(charge.ready).toBe(false);
    charge.update(1);
    expect(charge.ready).toBe(true);
    charge.toggle();
    expect(charge.armed).toBe(true);
  });
});
