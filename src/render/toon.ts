import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Three-band cel-shading ramp shared by every toon material (Wind Waker style hard light/shadow steps). */
export const toonGradient = new THREE.DataTexture(new Uint8Array([90, 175, 255]), 3, 1, THREE.RedFormat);
toonGradient.minFilter = THREE.NearestFilter;
toonGradient.magFilter = THREE.NearestFilter;
toonGradient.needsUpdate = true;

const loader = new GLTFLoader();

/** Loads a glTF model (with its animation clips) and swaps its PBR materials for cel-shaded ones. */
export async function loadToonGltf(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) return;
    const source = node.material;
    node.material = new THREE.MeshToonMaterial({
      name: source.name,
      map: source.map,
      color: source.color,
      gradientMap: toonGradient,
      side: source.side,
    });
    source.dispose();
  });
  return { scene: gltf.scene, animations: gltf.animations };
}

/** Loads a static glTF model with cel-shaded materials. */
export async function loadToonModel(url: string): Promise<THREE.Group> {
  return (await loadToonGltf(url)).scene;
}
