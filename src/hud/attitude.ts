import * as THREE from 'three';
import { toonGradient } from '../render/toon';

/** Ball swing (°) at full steer or throttle. */
const MAX_DISPLAY_DEG = 70;
/** Below this share of full response the ring shows green: the ship is effectively holding still. */
const ZERO_SHARE = 0.04;

/** Parchment globe with latitude/longitude lines, drawn once into an equirectangular texture. */
function drawGlobeTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = '#f1e2bd';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#7a4e22';
  for (let i = 0; i <= 12; i++) {
    ctx.lineWidth = i % 3 === 0 ? 4 : 2;
    const x = (i / 12) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let i = 1; i < 6; i++) {
    ctx.lineWidth = i === 3 ? 5 : 2;
    const y = (i / 6) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface Attitude {
  /** The current steer and throttle, each in [-1, 1] (x > 0 steers right, y > 0 forward). */
  update(input: { steer: number; throttle: number }): void;
}

/**
 * Compass-ball tilt indicator. The red pin faces the viewer at the zero pose and swings toward the
 * direction the phone is tilted; `zeroClassTarget` gets the `zero` class while inside the deadzone.
 */
export function createAttitude(canvas: HTMLCanvasElement, zeroClassTarget: HTMLElement): Attitude {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 10);
  camera.position.set(0, 0, 4.2);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const light = new THREE.DirectionalLight(0xffffff, 1.6);
  light.position.set(-2, 3, 4);
  scene.add(light);

  const ball = new THREE.Group();
  // Order YXZ: steering swings the pin sideways, throttle swings it up/down from that heading.
  ball.rotation.order = 'YXZ';
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.MeshToonMaterial({ map: drawGlobeTexture(), gradientMap: toonGradient }),
  );
  // Put a texture meridian/equator crossing at the front so the zero pose looks aligned.
  globe.rotation.y = -Math.PI / 2;
  ball.add(globe);

  const pin = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 12),
    new THREE.MeshToonMaterial({ color: 0xd8342b, gradientMap: toonGradient }),
  );
  pin.position.set(0, 0, 1);
  ball.add(pin);
  scene.add(ball);

  return {
    update(input) {
      const { degToRad } = THREE.MathUtils;
      // The ball shows the spring's response, not the raw tilt: it swings freely at first, then strains
      // toward its limit as the tilt gets extreme.
      ball.rotation.y = degToRad(input.steer * MAX_DISPLAY_DEG);
      ball.rotation.x = -degToRad(input.throttle * MAX_DISPLAY_DEG);
      const atZero = Math.abs(input.steer) < ZERO_SHARE && Math.abs(input.throttle) < ZERO_SHARE;
      zeroClassTarget.classList.toggle('zero', atZero);
      renderer.render(scene, camera);
    },
  };
}
