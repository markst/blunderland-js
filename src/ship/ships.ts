import * as THREE from 'three';

/**
 * Playable ship models. Hull space is the boat's own frame before SHIP_SCALE: forward -Z, y 0 = waterline,
 * sized like the original Kenney ship (≈13 m bow to stern) so the physics, wake and spray fit either model.
 */
export interface ShipModel {
  url: string;
  /** Model scale into hull space. */
  scale: number;
  /** Y rotation that turns the model's bow to -Z. */
  rotationY: number;
  /** Model height offset so the waterline sits at y 0. */
  y: number;
  /** Bow chaser cannon position on the foredeck, in hull space, and its size. */
  cannonMount: THREE.Vector3;
  cannonScale: number;
  /** Where each pirate stands on deck (hull space, feet on the deck). */
  crew: CrewStation[];
  /** Optional fix-ups applied to the loaded model. */
  prepare?: (model: THREE.Object3D) => void;
}

export type Pirate = 'captain' | 'henry' | 'anne' | 'mako';

export interface CrewStation {
  pirate: Pirate;
  at: THREE.Vector3;
  /** Facing in radians around Y; 0 looks toward the bow. */
  facing: number;
  /** Height override in hull space (defaults to the crew's standard height). */
  height?: number;
}

/**
 * The galleon's sails are single-sided, facing forward. From the chase camera (behind) they'd be invisible
 * and the ink-outline pass would fill them in dark brown; drawing both sides shows the stripes from behind.
 */
function doubleSided(model: THREE.Object3D): void {
  model.traverse((node) => {
    if (node instanceof THREE.Mesh && node.material instanceof THREE.Material) node.material.side = THREE.DoubleSide;
  });
}

export const SHIPS = {
  /** Quaternius "Ship" (CC0, poly.pizza/m/mEQj2wZ3GC): striped sails, gun ports, anchor. Bow points -X. */
  galleon: {
    url: '/models/quaternius/ship-quaternius.glb',
    scale: 0.85,
    rotationY: -Math.PI / 2,
    y: -0.3,
    cannonMount: new THREE.Vector3(0, 1.0, -4.1),
    cannonScale: 0.8,
    crew: [
      { pirate: 'captain', at: new THREE.Vector3(0, 1.36, 2.9), facing: 0 },
      { pirate: 'henry', at: new THREE.Vector3(-0.9, 0.64, 0.4), facing: 0.6 },
      { pirate: 'anne', at: new THREE.Vector3(0.9, 0.64, -1.0), facing: -0.5 },
      // Lookout in the crow's nest: small, so he peeks over the basket rim.
      { pirate: 'mako', at: new THREE.Vector3(0, 6.71, 1.54), facing: 0, height: 0.95 },
    ],
    prepare: doubleSided,
  },
  /** Kenney Pirate Kit "ship-pirate-large" (CC0): black sails. Bow points +Z. */
  classic: {
    url: '/models/kenney/ship-pirate-large.glb',
    scale: 1,
    rotationY: Math.PI,
    y: -0.9,
    cannonMount: new THREE.Vector3(0, 1.45, -3.7),
    cannonScale: 1.25,
    crew: [
      { pirate: 'captain', at: new THREE.Vector3(0, 2.6, 4.6), facing: 0 },
      { pirate: 'henry', at: new THREE.Vector3(-1.1, 1.3, 0.8), facing: 0.6 },
      { pirate: 'anne', at: new THREE.Vector3(1.1, 1.3, -1.6), facing: -0.5 },
    ],
  },
} satisfies Record<string, ShipModel>;

/** The ship picked with `?ship=classic` (or `?ship=galleon`); the galleon by default. */
const requested = new URLSearchParams(globalThis.location?.search ?? '').get('ship');
export const SHIP: ShipModel = SHIPS[requested === 'classic' ? 'classic' : 'galleon'];
