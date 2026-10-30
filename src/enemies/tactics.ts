/** Signed shortest turn from heading `b` to heading `a` (radians, in [-π, π]). */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/**
 * Which beam a target at (dx, dz) from the ship lies on: 1 starboard, -1 port, 0 too far ahead or astern for
 * a broadside. `minAcross` is the cosine of the widest angle off the beam the guns can still bear.
 * Headings follow the game's convention: 0 faces -Z, starboard is (cos h, -sin h).
 */
export function beamSide(heading: number, dx: number, dz: number, minAcross: number): number {
  const len = Math.hypot(dx, dz);
  if (len === 0) return 0;
  const across = (Math.cos(heading) * dx - Math.sin(heading) * dz) / len;
  if (across >= minAcross) return 1;
  if (across <= -minAcross) return -1;
  return 0;
}

/** The heading that puts a target at (dx, dz) square on a beam, choosing whichever beam is the smaller turn. */
export function broadsideHeading(heading: number, dx: number, dz: number): number {
  const bearing = Math.atan2(-dx, -dz);
  const portOn = bearing + Math.PI / 2;
  const starboardOn = bearing - Math.PI / 2;
  return Math.abs(angleDiff(portOn, heading)) < Math.abs(angleDiff(starboardOn, heading)) ? portOn : starboardOn;
}
