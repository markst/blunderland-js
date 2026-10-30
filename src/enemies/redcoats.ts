import * as THREE from 'three';
import { loadToonGltf } from '../render/toon';

/** Henry from the Quaternius Pirate Kit (CC0), repainted as a British marine. */
const SOLDIER_URL = '/models/quaternius/pirate-henry.glb';

/**
 * The kit's characters are coloured from a palette atlas of 32 px cells. Henry's clothes use these cells
 * (column, row; found by mapping his vertices' UVs to body height): repaint them into a redcoat uniform.
 */
const UNIFORM: { cell: [number, number]; color: string }[] = [
  { cell: [3, 11], color: '#b81f1d' }, // shirt and sleeves → scarlet coat
  { cell: [6, 11], color: '#ece6d4' }, // vest → white waistcoat
  { cell: [8, 11], color: '#ece6d4' }, // trousers → white breeches
  { cell: [2, 11], color: '#1b1e29' }, // bandana → black hat
];
const CELL = 32;

export interface SoldierTemplate {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/** Repaints a copy of `map` with the uniform cells; the original (used by the player's crew) is untouched. */
function repaint(map: THREE.Texture): THREE.Texture {
  const image = map.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(image, 0, 0);
  const scale = image.width / 1024;
  for (const { cell, color } of UNIFORM) {
    ctx.fillStyle = color;
    ctx.fillRect(cell[0] * CELL * scale, cell[1] * CELL * scale, CELL * scale, CELL * scale);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = map.flipY;
  texture.colorSpace = map.colorSpace;
  texture.wrapS = map.wrapS;
  texture.wrapT = map.wrapT;
  texture.magFilter = map.magFilter;
  texture.minFilter = map.minFilter;
  return texture;
}

export async function loadSoldier(): Promise<SoldierTemplate> {
  const { scene, animations } = await loadToonGltf(SOLDIER_URL);
  const painted = new Map<THREE.Texture, THREE.Texture>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshToonMaterial)) return;
    const material = node.material.clone();
    const map = material.map;
    if (map) {
      let uniform = painted.get(map);
      if (!uniform) {
        uniform = repaint(map);
        painted.set(map, uniform);
      }
      material.map = uniform;
    }
    node.material = material;
  });
  return { scene, animations };
}
