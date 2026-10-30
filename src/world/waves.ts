import * as THREE from 'three';

/**
 * One water surface shared by the ocean shader (GLSL) and the boat (JS), generated from the same
 * constants so the ship sits exactly on the waves it is drawn on.
 *
 * height = Σ travelling swells
 *        + slosh standing wave across the view (liquid lagging behind the tilt)
 *        + surges: wave fronts that roll across the sea when it is tilted, like water rushing to the low
 *          side of a glass.
 */

const GRAVITY = 9.8;

/** Travelling swells: wavelength (m), amplitude (m), direction. Deep-water speed ω = √(g·k). */
const SWELLS = [
  { length: 95, amp: 0.85, dir: [0.25, 1] },
  { length: 58, amp: 0.55, dir: [1, 0.35] },
  { length: 34, amp: 0.3, dir: [-0.55, 1] },
  { length: 21, amp: 0.16, dir: [0.8, -0.6] },
].map(({ length, amp, dir }) => {
  const k = (Math.PI * 2) / length;
  const n = Math.hypot(dir[0], dir[1]);
  return { k, amp, dx: dir[0] / n, dz: dir[1] / n, omega: Math.sqrt(GRAVITY * k) };
});

/** Slosh mode: half a wavelength spans the water around the boat, like liquid in a tilted glass. */
const SLOSH_K = Math.PI / 100;
/** Slosh and surges are local to the boat and fade out over this distance range. */
const LOCAL_FADE_START = 120;
const LOCAL_FADE_END = 420;
/** Swells flatten towards the horizon so the far sea reads as a clean line. */
const FAR_FADE_START = 600;
const FAR_FADE_END = 1500;

/** Surge slots shared with the shader; the oldest/weakest is reused when all are busy. */
export const MAX_SURGES = 6;
/** Surge shape: a rolling crest of this wavelength (m) inside an envelope this wide (m). */
const SURGE_K = (Math.PI * 2) / 28;
const SURGE_WIDTH = 20;
/** Fronts start this far upstream of the boat and roll across at this speed (m/s). */
export const SURGE_START = 35;
export const SURGE_SPEED = 14;
/** Amplitude halves roughly every 3 s; fronts are retired after rolling this far (m). */
const SURGE_DECAY = 4.5;
const SURGE_RANGE = 360;
/**
 * All live surges share this much height (m). Overlapping fronts add up, so without a shared budget rapid
 * rocking would stack them into a tidal wave; new ones get only what the fading ones have freed up.
 */
const SURGE_BUDGET = 3.2;

/** Live inputs of the wave field, mirrored into shader uniforms each frame. */
export interface WaveState {
  time: number;
  /** World xz the slosh and surges are centred on (the boat). */
  focus: THREE.Vector2;
  /** Unit xz vectors of the view: right and forward. */
  right: THREE.Vector2;
  forward: THREE.Vector2;
  /** Slosh amplitude (m) across (x) and along (y) the view. */
  slosh: THREE.Vector2;
  /** Per surge: travel direction (x, y = world xz) and start point (z, w = world xz). */
  surgeA: THREE.Vector4[];
  /** Per surge: distance rolled so far (x) and current amplitude (y, 0 = slot free). */
  surgeB: THREE.Vector4[];
}

export function createWaveState(): WaveState {
  return {
    time: 0,
    focus: new THREE.Vector2(),
    right: new THREE.Vector2(1, 0),
    forward: new THREE.Vector2(0, -1),
    slosh: new THREE.Vector2(),
    surgeA: Array.from({ length: MAX_SURGES }, () => new THREE.Vector4()),
    surgeB: Array.from({ length: MAX_SURGES }, () => new THREE.Vector4()),
  };
}

/**
 * Starts a surge rolling in world direction (dirX, dirZ) past the boat, up to `amplitude` metres high but
 * limited to what is left of the shared budget.
 */
export function addSurge(s: WaveState, dirX: number, dirZ: number, amplitude: number): void {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0 || amplitude <= 0) return;
  let live = 0;
  let slot = 0;
  for (let i = 0; i < MAX_SURGES; i++) {
    live += s.surgeB[i].y;
    if (s.surgeB[i].y < s.surgeB[slot].y) slot = i;
  }
  const height = Math.min(amplitude, SURGE_BUDGET - live);
  if (height < 0.1) return;
  const dx = dirX / len;
  const dz = dirZ / len;
  s.surgeA[slot].set(dx, dz, s.focus.x - dx * SURGE_START, s.focus.y - dz * SURGE_START);
  s.surgeB[slot].set(0, height, 0, 0);
}

/** Rolls every surge forward and lets it die away. */
export function advanceSurges(s: WaveState, dt: number): void {
  const decay = Math.exp(-dt / SURGE_DECAY);
  for (const b of s.surgeB) {
    if (b.y <= 0) continue;
    b.x += SURGE_SPEED * dt;
    b.y *= decay;
    if (b.y < 0.02 || b.x > SURGE_RANGE) b.y = 0;
  }
}

/** Water height at world (x, z). Mirrors `waveHeight` in {@link WAVE_GLSL}. */
export function waveHeight(s: WaveState, x: number, z: number): number {
  const { smoothstep } = THREE.MathUtils;
  let h = 0;
  for (const w of SWELLS) h += w.amp * Math.sin((w.dx * x + w.dz * z) * w.k + s.time * w.omega);
  const rx = x - s.focus.x;
  const rz = z - s.focus.y;
  const d = Math.hypot(rx, rz);
  const lateral = rx * s.right.x + rz * s.right.y;
  const along = rx * s.forward.x + rz * s.forward.y;
  let local = s.slosh.x * Math.sin(lateral * SLOSH_K) + s.slosh.y * Math.sin(along * SLOSH_K);
  for (let i = 0; i < MAX_SURGES; i++) {
    const a = s.surgeA[i];
    const b = s.surgeB[i];
    if (b.y <= 0) continue;
    const u = (x - a.z) * a.x + (z - a.w) * a.y - b.x;
    local += b.y * Math.exp(-((u / SURGE_WIDTH) ** 2)) * Math.cos(u * SURGE_K);
  }
  h += local * (1 - smoothstep(d, LOCAL_FADE_START, LOCAL_FADE_END));
  return h * (1 - smoothstep(d, FAR_FADE_START, FAR_FADE_END));
}

/** Formats a constant as a GLSL float literal. */
const f = (n: number) => n.toFixed(6);

/**
 * GLSL uniforms, `float surgeHeight(vec2 p)` (the surge part alone, for crest foam) and
 * `float waveHeight(vec2 p)`, identical to {@link waveHeight}.
 */
export const WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uFocus;
uniform vec2 uRight;
uniform vec2 uForward;
uniform vec2 uSlosh;
uniform vec4 uSurgeA[${MAX_SURGES}];
uniform vec4 uSurgeB[${MAX_SURGES}];

float surgeHeight(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_SURGES}; i++) {
    vec4 a = uSurgeA[i];
    vec4 b = uSurgeB[i];
    if (b.y <= 0.0) continue;
    float u = dot(p - a.zw, a.xy) - b.x;
    float e = u / ${f(SURGE_WIDTH)};
    h += b.y * exp(-e * e) * cos(u * ${f(SURGE_K)});
  }
  return h;
}

float waveHeight(vec2 p) {
  float h = 0.0;
${SWELLS.map((w) => `  h += ${f(w.amp)} * sin(dot(vec2(${f(w.dx)}, ${f(w.dz)}), p) * ${f(w.k)} + uTime * ${f(w.omega)});`).join('\n')}
  vec2 rel = p - uFocus;
  float d = length(rel);
  float local = uSlosh.x * sin(dot(rel, uRight) * ${f(SLOSH_K)}) + uSlosh.y * sin(dot(rel, uForward) * ${f(SLOSH_K)});
  local += surgeHeight(p);
  h += local * (1.0 - smoothstep(${f(LOCAL_FADE_START)}, ${f(LOCAL_FADE_END)}, d));
  return h * (1.0 - smoothstep(${f(FAR_FADE_START)}, ${f(FAR_FADE_END)}, d));
}
`;

/** Uniform objects bound to a {@link WaveState}; the vectors are shared by reference. */
export function waveUniforms(s: WaveState) {
  return {
    uTime: { value: s.time },
    uFocus: { value: s.focus },
    uRight: { value: s.right },
    uForward: { value: s.forward },
    uSlosh: { value: s.slosh },
    uSurgeA: { value: s.surgeA },
    uSurgeB: { value: s.surgeB },
  };
}
