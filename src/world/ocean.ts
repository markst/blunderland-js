import * as THREE from 'three';
import { WAVE_GLSL, waveUniforms, type WaveState } from './waves';

// Wind Waker look: flat saturated blue with drifting white cell outlines, fading into a pale fog at the horizon.
// UV warp and fog constants follow Robin Payot's wind-waker-js (MIT); the wave-line pattern is generated here
// instead of using Nintendo's texture.

export const OCEAN_COLOR = '#216fb5';
export const FOG_COLOR = '#6abbe9';
export const FOG_DENSITY = 0.0009;

const PATTERN_SIZE = 512;
/** Voronoi cells per pattern tile (per axis). */
const PATTERN_CELLS = 8;
/** World units covered by one pattern tile. */
const PATTERN_TILE = 170;
/** Half the ocean's width; the mesh follows the boat. */
const OCEAN_HALF = 4000;
const OCEAN_SEGMENTS = 256;
/**
 * Grid spacing ramps from fine near the boat (≈1.6 m, enough for the shortest swell) to coarse at the
 * horizon: a grid coordinate u ∈ [-1, 1] maps to OCEAN_HALF · u · (DENSE + (1 - DENSE) · u²).
 */
const DENSE = 0.05;
/** Plane follows the boat in whole near-grid steps so displaced vertices don't swim. */
const GRID_STEP = (OCEAN_HALF * DENSE * 2) / OCEAN_SEGMENTS;
/** Downhill water flow (m/s) at full tilt; slower than the boat so it still visibly sails through the pattern. */
const FLOW_SPEED = 10;

/** Deterministic per-cell feature point in [0,1)², wrapped so the texture tiles seamlessly. */
function cellPoint(i: number, j: number, out: [number, number]): void {
  const wi = ((i % PATTERN_CELLS) + PATTERN_CELLS) % PATTERN_CELLS;
  const wj = ((j % PATTERN_CELLS) + PATTERN_CELLS) % PATTERN_CELLS;
  const a = Math.sin(wi * 127.1 + wj * 311.7) * 43758.5453;
  const b = Math.sin(wi * 269.5 + wj * 183.3) * 43758.5453;
  out[0] = 0.15 + 0.7 * (a - Math.floor(a));
  out[1] = 0.15 + 0.7 * (b - Math.floor(b));
}

/** Smooth periodic value noise; `period` must divide evenly into the sampled range so the texture tiles. */
function tileNoise(x: number, y: number, period: number, seed: number): number {
  const hash = (i: number, j: number) => {
    const v = Math.sin((((i % period) + period) % period) * 12.9898 + (((j % period) + period) % period) * 78.233 + seed) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * ux;
  const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * ux;
  return a + (b - a) * uy;
}

/**
 * Tileable Voronoi-border texture.
 * R: white wave line (cell borders with varying width and occasional breaks). G: broad darker patches.
 */
function createWavePattern(): THREE.DataTexture {
  const data = new Uint8Array(PATTERN_SIZE * PATTERN_SIZE * 4);
  const p: [number, number] = [0, 0];
  for (let py = 0; py < PATTERN_SIZE; py++) {
    for (let px = 0; px < PATTERN_SIZE; px++) {
      const x = ((px + 0.5) / PATTERN_SIZE) * PATTERN_CELLS;
      const y = ((py + 0.5) / PATTERN_SIZE) * PATTERN_CELLS;
      const ci = Math.floor(x);
      const cj = Math.floor(y);
      const fx = x - ci;
      const fy = y - cj;

      // Pass 1: nearest feature point.
      let best = Infinity;
      let mgx = 0, mgy = 0, mrx = 0, mry = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          cellPoint(ci + i, cj + j, p);
          const rx = i + p[0] - fx;
          const ry = j + p[1] - fy;
          const d = rx * rx + ry * ry;
          if (d < best) {
            best = d;
            mgx = i; mgy = j; mrx = rx; mry = ry;
          }
        }
      }

      // Pass 2: exact distance to the nearest cell border (Inigo Quilez, "Voronoi edges").
      let border = Infinity;
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const gx = mgx + i;
          const gy = mgy + j;
          cellPoint(ci + gx, cj + gy, p);
          const rx = gx + p[0] - fx;
          const ry = gy + p[1] - fy;
          const dx = rx - mrx;
          const dy = ry - mry;
          const len = Math.hypot(dx, dy);
          if (len < 1e-5) continue;
          border = Math.min(border, ((mrx + rx) * 0.5 * dx + (mry + ry) * 0.5 * dy) / len);
        }
      }

      // Width and breaks vary slowly along the lines so they read as hand-drawn crests, not a grid.
      const halfWidth = 0.015 + 0.045 * tileNoise(x * 2, y * 2, PATTERN_CELLS * 2, 1.7);
      const keep = tileNoise(x * 1.5, y * 1.5, PATTERN_CELLS * 1.5, 9.1);
      // Signed-distance style: 0.5 on the line edge, so the shader can threshold it crisply at any zoom.
      const edge = Math.min(halfWidth - border, (keep - 0.25) * 0.4);
      const line = THREE.MathUtils.clamp(0.5 + edge * 5, 0, 1);
      const patches = tileNoise(x, y, PATTERN_CELLS, 4.2);
      const o = (py * PATTERN_SIZE + px) * 4;
      data[o] = line * 255;
      data[o + 1] = patches * 255;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, PATTERN_SIZE, PATTERN_SIZE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const vertexShader = /* glsl */ `
${WAVE_GLSL}
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFogDepth;
varying float vSurge;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 p = world.xz;
  float h = waveHeight(p);
  vSurge = surgeHeight(p);
  // Finite-difference normal of the displaced surface.
  vNormal = normalize(vec3(h - waveHeight(p + vec2(1.0, 0.0)), 1.0, h - waveHeight(p + vec2(0.0, 1.0))));
  world.y += h;
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uPattern;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uPatternTime;
uniform float uTile;
uniform vec2 uFlow;
uniform vec2 uSunXZ;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFogDepth;
varying float vSurge;

void main() {
  // The pattern drifts with the water flow, so tilting visibly pours the sea downhill.
  vec2 uv = (vWorld.xz - uFlow) / uTile;
  float t = uPatternTime;
  uv.y += 0.01 * (sin(uv.x * 3.5 + t * 0.35) + sin(uv.x * 4.8 + t * 1.05) + sin(uv.x * 7.3 + t * 0.45)) / 3.0;
  uv.x += 0.12 * (sin(uv.y * 4.0 + t * 0.5) + sin(uv.y * 6.8 + t * 0.75) + sin(uv.y * 11.3 + t * 0.2)) / 3.0;
  uv.y += 0.12 * (sin(uv.x * 4.2 + t * 0.64) + sin(uv.x * 6.3 + t * 1.65) + sin(uv.x * 8.2 + t * 0.45)) / 3.0;

  vec4 tex = texture2D(uPattern, uv);
  // Separate, slower sample gives broad darker patches between the crests.
  float shade = texture2D(uPattern, uv * 0.5 + vec2(0.31, 0.57)).g;
  vec3 col = uColor * mix(0.74, 1.06, shade);

  // Cel-shaded wave faces: slopes facing the sun lighten, the backs of swells darken.
  float facing = dot(vNormal.xz, uSunXZ) * 8.0;
  col *= mix(0.8, 1.12, smoothstep(-0.25, 0.25, facing));

  float aa = max(fwidth(tex.r), 0.015);
  col = mix(col, vec3(1.0), smoothstep(0.5 - aa, 0.5 + aa, tex.r));

  // Rolling surge crests break into broken white foam.
  float foamBreakup = smoothstep(0.25, 0.6, texture2D(uPattern, uv * 2.3).g);
  col = mix(col, vec3(1.0), smoothstep(0.35, 0.9, vSurge) * foamBreakup * 0.9);

  // Pattern fades out with distance so the horizon stays clean.
  col = mix(col, uColor, smoothstep(250.0, 1100.0, vFogDepth));

  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  gl_FragColor = vec4(mix(col, uFogColor, fogFactor), 1.0);
  #include <colorspace_fragment>
}
`;

function createOceanGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(2, 2, OCEAN_SEGMENTS, OCEAN_SEGMENTS);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const v = pos.getY(i);
    pos.setXY(i, OCEAN_HALF * u * (DENSE + (1 - DENSE) * u * u), OCEAN_HALF * v * (DENSE + (1 - DENSE) * v * v));
  }
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export interface Ocean {
  mesh: THREE.Mesh;
  /** `downhill`: water slope in world xz (length ≤ ~1.4), drives the flowing pattern. */
  update(dt: number, elapsed: number, downhill: THREE.Vector2): void;
}

/** `waves` is shared with the boat; the caller advances it before `update`. */
export function createOcean(renderer: THREE.WebGLRenderer, waves: WaveState, sunXZ: THREE.Vector2): Ocean {
  const pattern = createWavePattern();
  pattern.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const flow = new THREE.Vector2();
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...waveUniforms(waves),
      uPattern: { value: pattern },
      uColor: { value: new THREE.Color(OCEAN_COLOR) },
      uFogColor: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uPatternTime: { value: 0 },
      uTile: { value: PATTERN_TILE },
      uFlow: { value: flow },
      uSunXZ: { value: sunXZ.clone().normalize() },
    },
  });
  material.userData.outlineParameters = { visible: false };

  const mesh = new THREE.Mesh(createOceanGeometry(), material);
  mesh.frustumCulled = false;

  return {
    mesh,
    update(dt, elapsed, downhill) {
      material.uniforms.uTime.value = waves.time;
      material.uniforms.uPatternTime.value = elapsed * 0.65;
      flow.addScaledVector(downhill, FLOW_SPEED * dt);
      // Pattern and swells are sampled in world space, so the plane can simply follow the boat.
      const { x, y } = waves.focus;
      mesh.position.set(Math.round(x / GRID_STEP) * GRID_STEP, 0, Math.round(y / GRID_STEP) * GRID_STEP);
    },
  };
}
