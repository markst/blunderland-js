import * as THREE from 'three';
import { createScene } from './world/scene';
import { SeaTilt } from './world/slosh';
import { createWaveState } from './world/waves';
import { Boat, HALF_BEAM, MAX_SPEED, SHIP_SCALE } from './ship/boat';
import { Cannon, type HitTest } from './ship/cannon';
import { Crew } from './ship/crew';
import { Spray } from './ship/spray';
import { Wake } from './ship/wake';
import { FireballCharge } from './ship/fireball-charge';
import { FireFx } from './fx/fire';
import { Smoke } from './fx/smoke';
import { Fleet } from './enemies/fleet';
import { Gunnery } from './enemies/gunnery';
import { Islands } from './world/islands';
import { InputController } from './input/input';
import { Aim } from './input/aim';
import { createAttitude } from './hud/attitude';
import { createFireballButton } from './hud/fireball-button';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const startEl = document.getElementById('start') as HTMLDivElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const startMsg = document.getElementById('start-msg') as HTMLParagraphElement;
const hudEl = document.getElementById('hud') as HTMLDivElement;
const attitudeBtn = document.getElementById('attitude') as HTMLButtonElement;
const attitudeCanvas = document.getElementById('attitude-canvas') as HTMLCanvasElement;
const fireballBtn = document.getElementById('fireball') as HTMLButtonElement;
const aimOverlay = document.querySelector('svg#aim') as SVGSVGElement;

const waves = createWaveState();
const sceneApi = createScene(canvas, waves);
const { scene, camera } = sceneApi;

const boat = new Boat();
scene.add(boat.object);
const wake = new Wake();
scene.add(wake.mesh);
const spray = new Spray();
scene.add(spray.mesh);
const fire = new FireFx();
scene.add(fire.mesh);
const smoke = new Smoke();
scene.add(smoke.mesh);
const cannon = new Cannon(boat, fire, smoke);
scene.add(cannon.effects);
const crew = new Crew(boat);
const gunnery = new Gunnery(fire, smoke);
scene.add(gunnery.group);
const islands = new Islands();
scene.add(islands.group);
const fleet = new Fleet(fire, gunnery, islands);
scene.add(fleet.group);
/** Camera shake (m) when an enemy ball strikes; decays quickly. */
let shake = 0;
const shoreNormal = new THREE.Vector2();
// An enemy ball striking the ship: it lurches and heels, the crew stagger and the view shakes.
const onPlayerHit = (dirX: number, dirZ: number) => {
  boat.struck(dirX, dirZ);
  crew.stagger();
  shake = 0.6;
};
const fireball = new FireballCharge();
const fireballButton = createFireballButton(fireballBtn, fireball);
// Shots that strike an enemy blow it apart (or set it alight), and the crew cheer.
const hitTest: HitTest = (point, velocity, ammo) => {
  // Balls that strike an island burst against it.
  if (point.y <= islands.groundAt(point.x, point.z)) return true;
  const hit = fleet.hit(point, velocity, ammo);
  if (hit) crew.cheer();
  return hit;
};
// Thumb down on the sea, pull back, release: fires the bow cannon (and the crew react).
const aim = new Aim(canvas, aimOverlay, (shot) => {
  const fired = cannon.fire(boat, shot);
  if (!fired) return;
  crew.cheer();
  if (fired === 'fireball') fireball.spend();
});
Promise.all([boat.load(), cannon.load(), crew.load(), fleet.load(), islands.load()]).catch((err: unknown) => {
  console.error(err);
  startMsg.textContent = 'Could not load the ship models.';
});

const input = new InputController();
input.attachKeyboard();

const attitude = createAttitude(attitudeCanvas, attitudeBtn);
const seaTilt = new SeaTilt();

/** Chase camera, rigidly attached behind the ship so the ship holds still on screen and the world moves. */
const CAMERA_DISTANCE = 22;
/** Low and flat: with the lens shift in scene.ts this puts the resting horizon a third up from the bottom. */
const CAMERA_ELEVATION = THREE.MathUtils.degToRad(7.2);
const MIN_ELEVATION = THREE.MathUtils.degToRad(2);
const LOOK_HEIGHT = 4 * SHIP_SCALE;
/** Share of the sea's forward/back tilt shown by orbiting the camera (the full amount would hide the horizon). */
const PITCH_VIEW = 0.4;
/**
 * Sea Hero Quest style pull-back: the faster the ship (or the steeper the tilt), the further the camera eases
 * out and the wider it looks, showing more of the sea around the ship.
 */
const BASE_FOV = 50;
const ZOOM_FOV = 10;
const ZOOM_DISTANCE = 0.45;
/** Ease rate (1/s) toward the target pull-back: slow enough to feel like a camera operator, not a jump. */
const ZOOM_RATE = 1.4;
const ZOOM_RISE = THREE.MathUtils.degToRad(10);
let zoom = 0;
const downhill = new THREE.Vector2();

function updateCamera(dt: number): void {
  const h = boat.heading;
  waves.forward.set(-Math.sin(h), -Math.cos(h));
  waves.right.set(Math.cos(h), -Math.sin(h));

  const speedShare = Math.min(1, boat.velocity.length() / MAX_SPEED);
  const tiltShare = Math.min(1, Math.hypot(input.steer, input.throttle));
  const zoomTarget = Math.min(1, 0.7 * speedShare + 0.5 * tiltShare);
  zoom += (zoomTarget - zoom) * (1 - Math.exp(-ZOOM_RATE * dt));
  const fov = BASE_FOV + ZOOM_FOV * zoom;
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  const distance = CAMERA_DISTANCE * (1 + ZOOM_DISTANCE * zoom);

  // Far side lower → orbit down behind the ship so the horizon drops while the ship stays put on screen.
  // Pulling back also rises, so the extra view is sea around the ship rather than sky.
  const elevation = Math.max(
    MIN_ELEVATION,
    CAMERA_ELEVATION + ZOOM_RISE * zoom - THREE.MathUtils.degToRad(seaTilt.pitch * PITCH_VIEW),
  );
  const back = Math.cos(elevation) * distance;
  const y = boat.waterline + LOOK_HEIGHT;
  camera.position.set(
    boat.position.x - waves.forward.x * back,
    y + Math.sin(elevation) * distance,
    boat.position.z - waves.forward.y * back,
  );
  camera.lookAt(boat.position.x, y, boat.position.z);

  // The camera turns with the phone, so the sea stays level with the real world (like liquid in a glass):
  // tilting the phone visibly tilts the sea, lagging and wobbling through the slosh spring.
  camera.rotateZ(-THREE.MathUtils.degToRad(seaTilt.roll));
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake *= Math.exp(-6 * dt);
  }
}

updateCamera(0);

const timer = new THREE.Timer();
timer.connect(document);
let elapsed = 0;

function frame(timestamp: number): void {
  requestAnimationFrame(frame);
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.05);
  elapsed += dt;
  input.update();
  seaTilt.update(dt, input.delta, waves);

  waves.time = elapsed;
  downhill
    .copy(waves.right)
    .multiplyScalar(input.steer)
    .addScaledVector(waves.forward, input.throttle);
  boat.update(dt, downhill, waves);
  // Run aground? Slide along the shore: push back out and cancel the speed heading into the island.
  if (islands.pushOut(boat.position, HALF_BEAM + 1, shoreNormal)) {
    const into = boat.velocity.dot(shoreNormal);
    if (into < 0) boat.velocity.addScaledVector(shoreNormal, -into);
    boat.object.position.set(boat.position.x, 0, boat.position.z);
  }
  islands.update(dt, boat.position, boat.position);
  waves.focus.set(boat.position.x, boat.position.z);
  wake.update(dt, boat, waves);
  spray.update(dt, boat, waves);
  fireball.update(dt);
  cannon.loaded = fireball.armed ? 'fireball' : 'ball';
  cannon.update(dt, boat, waves, spray, aim.current, hitTest);
  fleet.update(dt, waves, boat, spray);
  gunnery.update(dt, waves, boat, spray, onPlayerHit, (x, z) => islands.groundAt(x, z));
  fire.update(dt);
  smoke.update(dt);
  crew.update(dt);

  updateCamera(dt);
  sceneApi.update(dt, elapsed, downhill);
  sceneApi.render();
  attitude.update(input);
  fireballButton.update();
}
requestAnimationFrame(frame);

function showHud(): void {
  startEl.style.display = 'none';
  hudEl.style.visibility = 'visible';
  aim.enabled = true;
}

startBtn.addEventListener('click', async () => {
  // Both need this tap: the iOS motion prompt (requested synchronously inside enableTilt) and, where the
  // browser allows it (Android Chrome), going fullscreen. iPhone Safari has no page fullscreen.
  const tilt = input.enableTilt();
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  const result = await tilt;
  const hasTouch = navigator.maxTouchPoints > 0;
  let message = '';
  if (result === 'denied') message = 'Motion access denied — use arrow keys, or reload and allow motion.';
  else if (result === 'unsupported' && hasTouch) message = 'Tilt needs HTTPS — open the https:// URL.';

  if (message) {
    startMsg.textContent = message;
    startBtn.disabled = true;
    setTimeout(showHud, 2000);
  } else {
    showHud();
  }
});

attitudeBtn.addEventListener('click', () => input.calibrate());
