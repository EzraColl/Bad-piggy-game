// Part catalogue: gameplay and physics properties for every buildable part.
// Visual meshes live in src/render/partMeshes.js.

export const CELL = 1; // metres per build-grid cell
export const WHEEL_RADIUS = 0.47;
export const WHEEL_HALF_WIDTH = 0.17;
export const WHEEL_DROP = 0.2; // the axle sits this far below the cell centre

export const PARTS = {
  wood: {
    name: 'Wooden Frame',
    blurb: 'Light and cheap. Snaps on big crashes.',
    mass: 6,
    strength: 1,
    friction: 0.7,
  },
  metal: {
    name: 'Steel Frame',
    blurb: 'Heavy and tough. Great for smashing through things.',
    mass: 22,
    strength: 4,
    friction: 0.5,
  },
  wheel: {
    name: 'Wheel',
    blurb: 'Rolls. An engine makes it drive. Put it next to a frame.',
    mass: 5,
    strength: 3,
    friction: 1.35,
  },
  engine: {
    name: 'V8 Engine',
    blurb: 'Powers every wheel it is bolted to. More engines, more speed.',
    mass: 26,
    strength: 3,
    friction: 0.5,
  },
  pig: {
    name: 'Pig Pilot',
    blurb: 'Your driver. Get the pig to the finish flag.',
    mass: 14,
    strength: Infinity,
    friction: 0.6,
    unique: true,
  },
  balloon: {
    name: 'Balloon',
    blurb: 'Lifts your ride into the air. Press B to pop one.',
    mass: 0.8,
    strength: 1,
    friction: 0.5,
    lift: 165,
  },
  fan: {
    name: 'Propeller',
    blurb: 'Pushes in the arrow direction. Press F to switch on or off.',
    mass: 4,
    strength: 1.5,
    friction: 0.5,
    thrust: 150,
    directional: true,
  },
  rocket: {
    name: 'Soda Rocket',
    blurb: 'Huge push for a short time. Hold Space to fire.',
    mass: 3,
    strength: 1.5,
    friction: 0.5,
    thrust: 460,
    fuel: 1.8,
    directional: true,
  },
  tnt: {
    name: 'TNT',
    blurb: 'Boom. Press T to detonate, or crash it into something.',
    mass: 5,
    strength: 1.1,
    friction: 0.6,
    explosive: true,
  },
};

export const PART_ORDER = ['wood', 'metal', 'wheel', 'engine', 'pig', 'balloon', 'fan', 'rocket', 'tnt'];

// Thrust directions for fans and rockets, in the contraption's own frame.
// +X is forward (towards the finish), +Y is up.
export const DIRS = [
  { v: [1, 0, 0], label: 'Forward' },
  { v: [0, 1, 0], label: 'Up' },
  { v: [-1, 0, 0], label: 'Backward' },
  { v: [0, -1, 0], label: 'Down' },
];

// Structural parts are the ones other parts can be bolted onto.
export function isStructural(type) {
  return type !== 'wheel';
}

export function cellKey(i, j, k) {
  return `${i},${j},${k}`;
}

// Local position of a cell centre relative to the grid base centre.
export function cellLocal(dims, i, j, k) {
  return [
    (i - (dims[0] - 1) / 2) * CELL,
    (j + 0.5) * CELL,
    (k - (dims[2] - 1) / 2) * CELL,
  ];
}
