// Level definitions. Every level is a valley running along +X with a finish pad at `goal`.
//
// profile  : [x, height] control points for the track centre line (smoothly interpolated)
// pits     : [x0, x1, depth] canyons cut across the whole valley
// props    : crates, ramps, walls and TNT placed in the level
// solution : a working build, used by the Hint button and by tools/simulate.mjs
//            entries are [part, i, j, k, dir] where i = length, j = height, k = width
// script   : the key presses tools/simulate.mjs uses to drive the solution to the flag

export const THEMES = {
  meadow: {
    sun: { elevation: 38, azimuth: 205 },
    turbidity: 2.6, rayleigh: 2.0, mie: 0.004, exposure: 0.95,
    grass: [0.19, 0.36, 0.08], grass2: [0.32, 0.45, 0.12],
    dirt: [0.46, 0.38, 0.28], rock: [0.38, 0.36, 0.33],
    snowLine: Infinity, fog: 0.0028, trees: 1, flowers: 1,
  },
  golden: {
    sun: { elevation: 15, azimuth: 202 },
    turbidity: 5.5, rayleigh: 2.2, mie: 0.006, exposure: 1.15,
    grass: [0.27, 0.34, 0.08], grass2: [0.45, 0.42, 0.14],
    dirt: [0.48, 0.37, 0.26], rock: [0.47, 0.41, 0.35],
    snowLine: Infinity, fog: 0.0032, trees: 0.8, flowers: 0.6,
  },
  morning: {
    sun: { elevation: 22, azimuth: 150 },
    turbidity: 2.4, rayleigh: 1.1, mie: 0.003, exposure: 1.0,
    grass: [0.16, 0.33, 0.10], grass2: [0.26, 0.42, 0.14],
    dirt: [0.44, 0.37, 0.29], rock: [0.45, 0.44, 0.42],
    snowLine: Infinity, fog: 0.0036, trees: 1.2, flowers: 1.2,
  },
  quarry: {
    sun: { elevation: 52, azimuth: 190 },
    turbidity: 6, rayleigh: 1.2, mie: 0.005, exposure: 0.85,
    grass: [0.40, 0.38, 0.18], grass2: [0.50, 0.44, 0.24],
    dirt: [0.62, 0.48, 0.32], rock: [0.66, 0.56, 0.44],
    snowLine: Infinity, fog: 0.0026, trees: 0.25, flowers: 0,
  },
  alpine: {
    sun: { elevation: 30, azimuth: 170 },
    turbidity: 2, rayleigh: 0.9, mie: 0.003, exposure: 0.9,
    grass: [0.17, 0.30, 0.12], grass2: [0.24, 0.36, 0.15],
    dirt: [0.34, 0.29, 0.24], rock: [0.46, 0.46, 0.47],
    snowLine: 22, fog: 0.0022, trees: 1.4, flowers: 0.4, pines: true,
  },
  canyon: {
    sun: { elevation: 14, azimuth: 196 },
    turbidity: 7, rayleigh: 2.6, mie: 0.008, exposure: 1.25,
    grass: [0.36, 0.30, 0.12], grass2: [0.48, 0.36, 0.16],
    dirt: [0.58, 0.32, 0.18], rock: [0.64, 0.33, 0.20],
    snowLine: Infinity, fog: 0.0030, trees: 0.35, flowers: 0,
  },
};

function crateWall(x, rows, cols, opts = {}) {
  const props = [];
  const size = opts.size ?? 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const z = (c - (cols - 1) / 2) * (size * 1.02) + (r % 2 ? size * 0.25 : 0);
      const tnt = opts.tntRow === r && Math.abs(c - (cols - 1) / 2) <= 1;
      props.push({ type: tnt ? 'tnt' : 'crate', x, z, lift: r * size * 1.001 + 0.02, size });
    }
  }
  return props;
}

export const LEVELS = [
  {
    id: 'meadow',
    name: 'Meadow Run',
    blurb: 'Bolt on some wheels and an engine, then drive the pig to the flag.',
    theme: 'meadow',
    seed: 11,
    grid: [3, 2, 3],
    parts: { wood: 4, wheel: 4, engine: 1, pig: 1 },
    profile: [[-80, 0], [-20, 0], [10, 0], [28, 1.2], [45, 3.2], [62, 1.4], [78, 0.6], [96, 3.6], [112, 4.2], [128, 2.2], [146, 0.6], [200, 0.4], [280, 0.4]],
    start: 0,
    goal: 172,
    star: { x: 112, lift: 1.3 },
    timeLimit: 22,
    props: [
      { type: 'hay', x: 30, z: 8.5 }, { type: 'hay', x: 31.6, z: 9.3 }, { type: 'hay', x: 84, z: -8.8 },
      { type: 'fence', x: 150, z: -7.5, len: 16 }, { type: 'fence', x: 150, z: 7.5, len: 16 },
    ],
    solution: [
      ['wheel', 0, 0, 0], ['wheel', 2, 0, 0], ['wheel', 0, 0, 2], ['wheel', 2, 0, 2],
      ['wood', 0, 0, 1], ['pig', 1, 0, 1], ['engine', 2, 0, 1],
    ],
    script: [{ t: 0, keys: ['forward'] }],
  },
  {
    id: 'jump',
    name: 'Hog Leap',
    blurb: 'A canyon splits the road. Build up speed, hit the ramp and fly.',
    theme: 'golden',
    seed: 23,
    grid: [4, 2, 3],
    parts: { wood: 6, wheel: 4, engine: 2, rocket: 2, pig: 1 },
    profile: [[-80, 0], [-10, 0], [30, 0], [50, 0.6], [62, 2.2], [70, 4.4], [74, 5.2], [80, 3.8], [86, 3.2], [100, 1.6], [130, 1.0], [180, 1.2], [260, 1.2]],
    pits: [[70.5, 84, 34]],
    start: 0,
    goal: 150,
    star: { x: 79, lift: 2.8 },
    timeLimit: 15,
    props: [
      { type: 'sign', x: 45, z: -6.5 },
      { type: 'hay', x: 110, z: 8 }, { type: 'hay', x: 111.5, z: 8.6 },
    ],
    solution: [
      ['wheel', 0, 0, 0], ['wheel', 3, 0, 0], ['wheel', 0, 0, 2], ['wheel', 3, 0, 2],
      ['wood', 0, 0, 1], ['pig', 1, 0, 1], ['engine', 2, 0, 1], ['engine', 3, 0, 1],
      ['rocket', 1, 0, 0, 0], ['rocket', 1, 0, 2, 0],
    ],
    script: [{ t: 0, keys: ['forward'] }, { x: 58, keys: ['forward', 'rocket'] }],
  },
  {
    id: 'mesa',
    name: 'Balloon Mesa',
    blurb: 'The flag sits on top of a cliff. Float up with balloons, then pop them to land.',
    theme: 'morning',
    seed: 37,
    grid: [3, 3, 3],
    parts: { wood: 4, wheel: 4, engine: 1, balloon: 6, fan: 2, pig: 1 },
    profile: [[-80, 0], [-10, 0], [25, 0], [38, 0.4], [44, 15], [100, 15.5], [106, 1], [140, 0], [220, 0]],
    start: 0,
    goal: 76,
    star: { x: 24, lift: 19 },
    timeLimit: 24,
    balloonCeiling: 30,
    props: [
      { type: 'hay', x: 12, z: 7 }, { type: 'sign', x: 28, z: -6.5 },
    ],
    solution: [
      ['wheel', 0, 0, 0], ['wheel', 2, 0, 0], ['wheel', 0, 0, 2], ['wheel', 2, 0, 2],
      ['wood', 0, 0, 1], ['pig', 1, 0, 1], ['wood', 2, 0, 1],
      ['balloon', 0, 1, 1], ['balloon', 1, 1, 1], ['balloon', 2, 1, 1], ['balloon', 1, 1, 0], ['balloon', 1, 1, 2],
      ['fan', 0, 1, 0, 0], ['fan', 0, 1, 2, 0],
    ],
    script: [
      { t: 0, keys: ['fan'] },
      { x: 36, keys: ['fan'], press: ['balloon', 'balloon'] },
      { x: 52, keys: ['fan'], press: ['balloon'] },
    ],
  },
  {
    id: 'quarry',
    name: 'Crate Crusher',
    blurb: 'Walls of crates block the quarry road. Build something heavy and smash through. Mind the TNT.',
    theme: 'quarry',
    seed: 41,
    grid: [4, 2, 3],
    parts: { wood: 4, metal: 4, wheel: 6, engine: 3, tnt: 2, pig: 1 },
    profile: [[-80, 0], [-10, 0], [40, 0.2], [70, 0.8], [100, 0.4], [140, 1.4], [175, 1.0], [260, 1.0]],
    start: 0,
    goal: 170,
    star: { x: 125, lift: 1.2 },
    timeLimit: 20,
    wallHeight: 12,
    props: [
      ...crateWall(60, 3, 6),
      ...crateWall(112, 3, 6),
      { type: 'tnt', x: 84, z: 4.6 }, { type: 'tnt', x: 84, z: 5.7 }, { type: 'tnt', x: 84, z: 5.1, lift: 0.9 },
      { type: 'tnt', x: 138, z: -4.8 }, { type: 'tnt', x: 139.1, z: -4.8 },
      { type: 'barrel', x: 92, z: -5.5 }, { type: 'barrel', x: 92.8, z: -6.3 }, { type: 'barrel', x: 40, z: -6 },
    ],
    solution: [
      ['wheel', 0, 0, 0], ['wheel', 3, 0, 0], ['wheel', 0, 0, 2], ['wheel', 3, 0, 2],
      ['metal', 0, 0, 1], ['pig', 1, 0, 1], ['engine', 2, 0, 1], ['metal', 3, 0, 1],
      ['engine', 1, 1, 1], ['engine', 2, 1, 1], ['metal', 3, 1, 1],
    ],
    script: [{ t: 0, keys: ['forward'] }],
  },
  {
    id: 'alpine',
    name: 'Summit Climb',
    blurb: 'A steep mountain road. Grip and power win here: more wheels, more engines.',
    theme: 'alpine',
    seed: 53,
    grid: [5, 2, 3],
    parts: { wood: 8, metal: 2, wheel: 6, engine: 3, pig: 1 },
    profile: [[-80, 0], [-10, 0], [15, 0], [40, 6], [55, 8], [80, 15.5], [95, 17], [118, 25], [135, 27], [160, 27.5], [240, 27]],
    start: 0,
    goal: 150,
    star: { x: 95, lift: 1.3 },
    timeLimit: 17,
    wallHeight: 16,
    props: [
      { type: 'boulder', x: 62, z: 6.8, r: 1.6 }, { type: 'boulder', x: 102, z: -7, r: 1.9 },
      { type: 'sign', x: 12, z: 6.5 },
    ],
    solution: [
      ['wheel', 0, 0, 0], ['wheel', 2, 0, 0], ['wheel', 4, 0, 0],
      ['wheel', 0, 0, 2], ['wheel', 2, 0, 2], ['wheel', 4, 0, 2],
      ['wood', 0, 0, 1], ['engine', 1, 0, 1], ['pig', 2, 0, 1], ['engine', 3, 0, 1], ['engine', 4, 0, 1],
    ],
    script: [{ t: 0, keys: ['forward'] }],
  },
  {
    id: 'canyon',
    name: 'Rocket Canyon',
    blurb: 'The widest gap yet. Rockets, balloons, whatever it takes.',
    theme: 'canyon',
    seed: 67,
    grid: [4, 3, 3],
    parts: { wood: 6, wheel: 4, engine: 1, rocket: 4, balloon: 2, pig: 1 },
    profile: [[-80, 6], [-10, 6], [30, 6], [52, 7.5], [64, 9.5], [104, 5], [125, 4], [170, 4.5], [260, 4.5]],
    pits: [[66, 100, 40]],
    start: 0,
    goal: 140,
    star: { x: 84, lift: 5.6 },
    timeLimit: 19,
    wallHeight: 14,
    props: [{ type: 'sign', x: 40, z: -6.5 }],
    solution: [
      ['wheel', 0, 0, 0], ['wheel', 3, 0, 0], ['wheel', 0, 0, 2], ['wheel', 3, 0, 2],
      ['wood', 0, 0, 1], ['pig', 1, 0, 1], ['wood', 2, 0, 1], ['engine', 3, 0, 1],
      ['rocket', 1, 0, 0, 0], ['rocket', 2, 0, 0, 0], ['rocket', 1, 0, 2, 0], ['rocket', 2, 0, 2, 0],
      ['balloon', 1, 1, 1], ['balloon', 2, 1, 1],
    ],
    script: [{ t: 0, keys: ['forward'] }, { x: 40, keys: ['forward', 'rocket'] }],
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    blurb: 'No goal, no limits. Build anything and see what it does.',
    theme: 'meadow',
    seed: 91,
    sandbox: true,
    grid: [7, 4, 5],
    parts: { wood: Infinity, metal: Infinity, wheel: Infinity, engine: Infinity, pig: 1, balloon: Infinity, fan: Infinity, rocket: Infinity, tnt: Infinity },
    profile: [[-120, 0], [-10, 0], [40, 0], [70, 2], [90, 0.5], [130, 0.5], [160, 6], [200, 2], [260, 0], [360, 0]],
    start: 0,
    goal: 300,
    trackHalf: 22,
    wallHeight: 14,
    timeLimit: 0,
    props: [
      { type: 'ramp', x: 25, z: 0, len: 7, width: 5, height: 2.2 },
      { type: 'ramp', x: 110, z: -8, len: 9, width: 5, height: 3.2 },
      ...crateWall(55, 4, 5).map((p) => ({ ...p, z: p.z + 10 })),
      { type: 'tnt', x: 100, z: 9, lift: 0 }, { type: 'tnt', x: 100, z: 10.1, lift: 0 }, { type: 'tnt', x: 100, z: 9.5, lift: 1.01 },
      { type: 'hay', x: 15, z: -14 }, { type: 'barrel', x: 36, z: -12 },
    ],
    solution: [
      ['wheel', 1, 0, 1], ['wheel', 5, 0, 1], ['wheel', 1, 0, 3], ['wheel', 5, 0, 3],
      ['wood', 1, 0, 2], ['wood', 2, 0, 2], ['pig', 3, 0, 2], ['engine', 4, 0, 2], ['engine', 5, 0, 2],
      ['balloon', 3, 1, 2], ['rocket', 2, 1, 2, 0], ['fan', 1, 1, 2, 0],
    ],
    script: [{ t: 0, keys: ['forward'] }],
  },
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === id);
}
