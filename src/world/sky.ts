import * as THREE from 'three';
import { FOG_COLOR } from './ocean';

const SKY_COLOR = '#4fa9e6';
const HORIZON_COLOR = '#e8f6ff';
const SKY_RADIUS = 9000;
const CLOUD_COUNT = 18;
/** Clouds stand well beyond the ocean's 4 km edge, inside the sky dome. */
const CLOUD_DISTANCE = 7600;

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFragment = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uBelow;
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 col = mix(uHorizon, uSky, smoothstep(0.0, 0.22, h));
  col = mix(uBelow, col, smoothstep(-0.02, 0.01, h));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** Flat cartoon cumulus: overlapping white puffs over a pale-blue underside, flat-bottomed. */
function drawCloud(seed: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const puffs: [number, number, number][] = [];
  const count = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    const x = w * (0.18 + 0.64 * (i / (count - 1))) + (rand() - 0.5) * 30;
    const r = 40 + rand() * 55 * Math.sin(Math.PI * (0.2 + 0.6 * (i / (count - 1))));
    puffs.push([x, h * 0.72 - r * 0.55, r]);
  }
  const base = h * 0.78;
  const fill = (color: string, dy: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [x, y, r] of puffs) {
      ctx.moveTo(x + r, y + dy);
      ctx.arc(x, y + dy, r, 0, Math.PI * 2);
    }
    ctx.fill();
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, base);
  ctx.clip();
  fill('#bcd9f2', 0);
  fill('#ffffff', -14);
  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Sky {
  /** Gradient dome and clouds; both bank with the horizon when the view tilts. */
  group: THREE.Group;
  update(dt: number, cameraPosition: THREE.Vector3): void;
}

export function createSky(): Sky {
  const group = new THREE.Group();

  const domeMaterial = new THREE.ShaderMaterial({
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSky: { value: new THREE.Color(SKY_COLOR) },
      uHorizon: { value: new THREE.Color(HORIZON_COLOR) },
      uBelow: { value: new THREE.Color(FOG_COLOR) },
    },
  });
  domeMaterial.userData.outlineParameters = { visible: false };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), domeMaterial);
  dome.renderOrder = -1;
  group.add(dome);

  // Flat cut-outs standing on a ring far out (beyond the ocean's edge), facing the centre. Being world
  // geometry rather than screen-facing sprites, they bank with the horizon when the view tilts.
  const clouds = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const materials = [1, 2, 3, 4].map((seed) => {
    const material = new THREE.MeshBasicMaterial({
      map: drawCloud(seed * 7919),
      fog: false,
      depthWrite: false,
      transparent: true,
    });
    material.userData.outlineParameters = { visible: false };
    return material;
  });
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const cloud = new THREE.Mesh(geometry, materials[i % materials.length]);
    // One cloud per slot around the ring with a little jitter, so they never bunch up.
    const slot = (Math.PI * 2) / CLOUD_COUNT;
    const angle = (i + 0.5 + Math.sin(i * 12.9898) * 0.2) * slot;
    const dist = CLOUD_DISTANCE + (i % 3) * 300;
    const width = 1100 + ((i * 37) % 4) * 200;
    const height = width / 2;
    // Centres spread between ≈7° and ≈20° above the horizon, alternating so neighbours sit at different heights.
    const elevation = THREE.MathUtils.degToRad(7 + ((i * 5) % 7) * 2.2);
    const y = Math.tan(elevation) * dist;
    cloud.position.set(Math.cos(angle) * dist, y, Math.sin(angle) * dist);
    cloud.scale.set(width, height, 1);
    cloud.lookAt(0, y, 0);
    clouds.add(cloud);
  }
  group.add(clouds);

  return {
    group,
    update(dt, cameraPosition) {
      // Sky and clouds stay centred on the camera so they read as infinitely far away.
      group.position.set(cameraPosition.x, 0, cameraPosition.z);
      clouds.rotation.y += dt * 0.004;
    },
  };
}
