import { describe, expect, it } from 'vitest';
import { SeaTilt } from './slosh';
import { createWaveState, SURGE_SPEED, SURGE_START, waveHeight } from './waves';

const DT = 1 / 60;

/** Holds `tilt` for `seconds`; returns the extra water height (vs a calm twin sea) at each probe x, per frame. */
function surgeAt(tilt: { x: number; y: number }, probesX: number[], seconds: number): number[][] {
  const sea = createWaveState();
  const calm = createWaveState();
  const seaTilt = new SeaTilt();
  const rows: number[][] = [];
  for (let t = 0; t < seconds; t += DT) {
    seaTilt.update(DT, tilt, sea);
    // Compare surges only: drop the slosh, which `calm` doesn't have.
    sea.slosh.set(0, 0);
    rows.push(probesX.map((x) => waveHeight(sea, x, 0) - waveHeight(calm, x, 0)));
  }
  return rows;
}

function peakTime(rows: number[][], probe: number): { time: number; height: number } {
  let best = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i][probe] > rows[best][probe]) best = i;
  return { time: best * DT, height: rows[best][probe] };
}

describe('SeaTilt surges', () => {
  it('a quick tilt to the right rolls a crest under the ship and on to the right', () => {
    // View right is world +x by default.
    const rows = surgeAt({ x: 12, y: 0 }, [0, 30], 8);
    const atShip = peakTime(rows, 0);
    const toRight = peakTime(rows, 1);
    expect(atShip.height).toBeGreaterThan(0.8);
    expect(atShip.time).toBeCloseTo(SURGE_START / SURGE_SPEED, 0);
    expect(toRight.time).toBeGreaterThan(atShip.time + 1.5);
    expect(toRight.height).toBeLessThan(atShip.height);
  });

  it('a slight tilt inside the trigger angle leaves the water undisturbed', () => {
    const rows = surgeAt({ x: 3, y: 0 }, [0, 30], 4);
    for (const row of rows) for (const h of row) expect(h).toBe(0);
  });

  it('rapidly rocking full left/right (keyboard taps) never builds a tidal wave', () => {
    const sea = createWaveState();
    const calm = createWaveState();
    const seaTilt = new SeaTilt();
    let worst = 0;
    for (let t = 0; t < 12; t += DT) {
      // Full tilt (as a held arrow key reports), flipping side every 0.25 s.
      const x = Math.floor(t / 0.25) % 2 === 0 ? 18 : -18;
      seaTilt.update(DT, { x, y: 0 }, sea);
      for (let px = -60; px <= 60; px += 5) {
        worst = Math.max(worst, Math.abs(waveHeight(sea, px, 0) - waveHeight(calm, px, 0)));
      }
    }
    // Slosh plus surges stay in the range of a single big swell, however long the rocking goes on.
    expect(worst).toBeLessThan(4.5);
  });
});
