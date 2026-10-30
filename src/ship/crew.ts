import * as THREE from 'three';
import type { Boat } from './boat';
import { SHIP, type Pirate } from './ships';
import { loadToonGltf } from '../render/toon';

/** Quaternius Pirate Kit characters (CC0) — see public/models/quaternius/LICENSE.txt. */
const PIRATE_URLS: Record<Pirate, string> = {
  captain: '/models/quaternius/pirate-captain.glb',
  henry: '/models/quaternius/pirate-henry.glb',
  anne: '/models/quaternius/pirate-anne.glb',
  mako: '/models/quaternius/pirate-mako.glb',
};
/** Pirate height in hull space (the ship is ≈13 long); chunky cartoon proportions. */
const PIRATE_HEIGHT = 1.55;
/** Cross-fade (s) between animation clips. */
const FADE = 0.25;

interface Hand {
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  /** One-shot reaction: the captain flourishes his sword when firing, the crew cheer. */
  react: THREE.AnimationAction | null;
  /** One-shot flinch when the ship is struck. */
  flinch: THREE.AnimationAction | null;
}

/**
 * Animated pirates standing on deck: idling (out of step with each other), and reacting once to each shot.
 * They ride the hull, so they rock with the ship.
 */
export class Crew {
  private readonly hands: Hand[] = [];

  constructor(private readonly boat: Boat) {}

  async load(): Promise<void> {
    const loaded = await Promise.all(SHIP.crew.map((s) => loadToonGltf(PIRATE_URLS[s.pirate])));
    SHIP.crew.forEach((station, i) => {
      const { scene, animations } = loaded[i];
      const box = new THREE.Box3().setFromObject(scene);
      const height = box.max.y - box.min.y;
      const holder = new THREE.Group();
      const target = station.height ?? PIRATE_HEIGHT;
      scene.scale.setScalar(target / height);
      scene.position.y = (-box.min.y * target) / height;
      holder.add(scene);
      holder.position.copy(station.at);
      // Characters face +Z; the bow is -Z.
      holder.rotation.y = Math.PI + station.facing;
      this.boat.mount(holder);

      const mixer = new THREE.AnimationMixer(scene);
      // Clips are named like "CharacterArmature|…|Idle|…"; match on the action name.
      const idleClip = animations.find((c) => c.name.split('|').includes('Idle'));
      if (!idleClip) return;
      const idle = mixer.clipAction(idleClip);
      idle.time = Math.random() * idleClip.duration;
      idle.play();
      const reactName = station.pirate === 'captain' ? 'Sword' : 'Yes';
      const oneShot = (name: string) => {
        const found = animations.find((c) => c.name.split('|').includes(name));
        if (!found) return null;
        const action = mixer.clipAction(found);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        return action;
      };
      const react = oneShot(reactName);
      const flinch = oneShot('HitReact');
      mixer.addEventListener('finished', (e) => {
        if (e.action !== react && e.action !== flinch) return;
        idle.reset().fadeIn(FADE).play();
        e.action.fadeOut(FADE);
      });
      this.hands.push({ mixer, idle, react, flinch });
    });
  }

  /** The cannon fired: everyone reacts once. */
  cheer(): void {
    for (const { idle, react } of this.hands) {
      if (!react || react.isRunning()) continue;
      react.reset().fadeIn(FADE).play();
      idle.fadeOut(FADE);
    }
  }

  /** The ship was struck: everyone staggers. */
  stagger(): void {
    for (const { idle, react, flinch } of this.hands) {
      if (!flinch) continue;
      react?.stop();
      flinch.reset().fadeIn(0.1).play();
      idle.fadeOut(0.1);
    }
  }

  update(dt: number): void {
    for (const hand of this.hands) hand.mixer.update(dt);
  }
}
