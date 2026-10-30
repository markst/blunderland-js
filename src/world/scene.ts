import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { createOcean } from './ocean';
import { createSky } from './sky';
import type { WaveState } from './waves';

/** Sun offset from the boat; also sets which wave faces catch the light. */
const SUN_OFFSET = new THREE.Vector3(-40, 44, 30);
/** How far below screen centre the ship sits, as a share of the screen height. */
const SHIP_SCREEN_DROP = 0.22;

export interface SceneApi {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** `downhill`: water slope in world xz, see `Ocean.update`. */
  update(dt: number, elapsed: number, downhill: THREE.Vector2): void;
  render(): void;
}

export function createScene(canvas: HTMLCanvasElement, waves: WaveState): SceneApi {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Flat, saturated cartoon colours: no filmic tone mapping.
  renderer.toneMapping = THREE.NoToneMapping;

  // Black ink outlines around toon meshes (ocean, sky and clouds opt out via userData.outlineParameters).
  const outline = new OutlineEffect(renderer, { defaultThickness: 0.007, defaultColor: [0.08, 0.05, 0.03] });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
  // Lens shift: the camera aims at the ship (so rolling the view pivots around it) but the picture is shifted
  // down, leaving the ship fixed in the lower part of the screen with open sea ahead for the cannon.
  // Sized from the canvas box itself, which CSS stretches edge to edge (under notches and browser bars).
  const fitView = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.setViewOffset(w, h, 0, -h * SHIP_SCREEN_DROP, w, h);
    renderer.setSize(w, h, false);
  };
  fitView();
  new ResizeObserver(fitView).observe(canvas);

  const ocean = createOcean(renderer, waves, new THREE.Vector2(SUN_OFFSET.x, SUN_OFFSET.z));
  scene.add(ocean.mesh);
  const sky = createSky();
  scene.add(sky.group);

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  scene.add(sun);
  scene.add(sun.target);

  return {
    scene,
    camera,
    update(dt, elapsed, downhill) {
      ocean.update(dt, elapsed, downhill);
      sky.update(dt, camera.position);
      // Directional light keeps its angle while following the boat.
      sun.target.position.set(waves.focus.x, 0, waves.focus.y);
      sun.position.copy(sun.target.position).add(SUN_OFFSET);
    },
    render() {
      outline.render(scene, camera);
    },
  };
}
