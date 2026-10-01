// Rapier world for a level: terrain heightfield plus crates, ramps and other props.

import { sampleGrid } from './terrain.js';

export const G = {
  GROUND: 0x0001,
  PROP: 0x0002,
  VEHICLE: 0x0004,
  DEBRIS: 0x0008,
  WHEEL: 0x0010,
};

export function groups(member, filter) {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export const PROP_KINDS = {
  crate: { dynamic: true, mass: 7, explosive: false },
  tnt: { dynamic: true, mass: 10, explosive: true },
  barrel: { dynamic: true, mass: 16, explosive: false },
  hay: { dynamic: true, mass: 70, explosive: false },
  ramp: { dynamic: false },
  fence: { dynamic: false },
  boulder: { dynamic: false },
  sign: { dynamic: false },
  island: { dynamic: false },
  spire: { dynamic: false },
};

export class LevelPhysics {
  constructor(RAPIER, level, terrain) {
    this.R = RAPIER;
    this.level = level;
    this.terrain = terrain;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 120;
    world.numSolverIterations = 8;
    this.world = world;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.props = [];
    this.propByCollider = new Map();
    this._buildGround();
    for (const def of level.props ?? []) this._addProp(def);
  }

  _buildGround() {
    const { R, terrain, world } = this;
    const b = terrain.bounds;
    const step = 1;
    const x0 = b.x0;
    const x1 = b.x1;
    const z0 = -48;
    const z1 = 48;
    const grid = sampleGrid(terrain, x0, x1, z0, z1, step);
    const { nx, nz } = grid;
    const hf = new Float32Array((nx + 1) * (nz + 1));
    for (let iz = 0; iz <= nz; iz++) {
      for (let ix = 0; ix <= nx; ix++) {
        hf[iz + ix * (nz + 1)] = grid.heights[iz * (nx + 1) + ix];
      }
    }
    const desc = R.ColliderDesc.heightfield(nz, nx, hf, { x: nx * step, y: 1, z: nz * step }, R.HeightFieldFlags.FIX_INTERNAL_EDGES)
      .setTranslation(x0 + (nx * step) / 2, 0, z0 + (nz * step) / 2)
      .setFriction(0.9)
      .setRestitution(0.05)
      .setCollisionGroups(groups(G.GROUND, 0xffff));
    this.groundCollider = world.createCollider(desc);
  }

  propPosition(def, halfHeight) {
    const t = this.terrain;
    const z = t.center(def.x) + (def.z ?? 0);
    const y = t.height(def.x, z) + (def.lift ?? 0) + halfHeight;
    return { x: def.x, y, z };
  }

  // Floating islands and rock spires: flat grassy tops at `lift` metres above the road.
  _addSkyRock(def) {
    const { R, world, terrain } = this;
    const z = terrain.center(def.x) + (def.z ?? 0);
    const top = terrain.profile(def.x) + def.lift;
    const r = def.r ?? 8;
    const colliders = [];
    if (def.type === 'island') {
      const slab = 1.2;
      colliders.push(R.ColliderDesc.cylinder(slab, r).setTranslation(def.x, top - slab, z));
      // rocky underside: a cone hanging point-down beneath the slab
      const depth = def.depth ?? r * 1.2;
      colliders.push(
        R.ColliderDesc.cone(depth / 2, r * 0.92)
          .setRotation({ x: 1, y: 0, z: 0, w: 0 })
          .setTranslation(def.x, top - slab * 2 - depth / 2, z),
      );
    } else {
      const ground = Math.min(terrain.height(def.x, z), terrain.height(def.x + r, z), terrain.height(def.x - r, z)) - 3;
      const h = (top - ground) / 2;
      colliders.push(R.ColliderDesc.cylinder(h, r).setTranslation(def.x, ground + h, z));
    }
    let first = null;
    for (const cd of colliders) {
      cd.setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups(G.PROP, 0xffff));
      const c = world.createCollider(cd);
      first = first ?? c;
    }
    const prop = { def, kind: def.type, body: null, collider: first, alive: true, explosive: false, home: { x: def.x, y: top, z }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    this.props.push(prop);
    return prop;
  }

  _addProp(def) {
    const { R, world } = this;
    const kind = PROP_KINDS[def.type];
    if (!kind) return;
    if (def.type === 'island' || def.type === 'spire') return this._addSkyRock(def);
    let colliderDesc;
    let half = 0.5;
    let rotation = { x: 0, y: 0, z: 0, w: 1 };
    switch (def.type) {
      case 'crate': {
        const s = (def.size ?? 1) / 2;
        half = s;
        colliderDesc = R.ColliderDesc.cuboid(s * 0.98, s * 0.98, s * 0.98).setMass(kind.mass * (def.size ?? 1) ** 3);
        break;
      }
      case 'tnt':
        half = 0.45;
        colliderDesc = R.ColliderDesc.cuboid(0.44, 0.44, 0.44).setMass(kind.mass);
        break;
      case 'barrel':
        half = 0.45;
        colliderDesc = R.ColliderDesc.cylinder(0.45, 0.32).setMass(kind.mass);
        break;
      case 'hay': {
        half = 0.62;
        // round bale lying on its side, axis across the road
        colliderDesc = R.ColliderDesc.cylinder(0.55, 0.62).setMass(kind.mass);
        rotation = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
        break;
      }
      case 'ramp': {
        const L = def.len ?? 6;
        const W = def.width ?? 4;
        const H = def.height ?? 1.8;
        half = 0;
        const pts = new Float32Array([
          -L / 2, 0, -W / 2, -L / 2, 0, W / 2,
          L / 2, 0, -W / 2, L / 2, 0, W / 2,
          L / 2, H, -W / 2, L / 2, H, W / 2,
          -L / 2, -0.6, -W / 2, -L / 2, -0.6, W / 2, L / 2, -0.6, -W / 2, L / 2, -0.6, W / 2,
        ]);
        colliderDesc = R.ColliderDesc.convexHull(pts);
        break;
      }
      case 'fence': {
        const L = def.len ?? 10;
        half = 0.5;
        colliderDesc = R.ColliderDesc.cuboid(L / 2, 0.5, 0.06);
        break;
      }
      case 'boulder': {
        const r = def.r ?? 1.5;
        half = r * 0.55;
        colliderDesc = R.ColliderDesc.ball(r);
        break;
      }
      case 'sign':
        half = 1;
        colliderDesc = R.ColliderDesc.cuboid(0.08, 1, 0.08);
        break;
      default:
        return;
    }
    const pos = this.propPosition(def, half);
    if (def.type === 'ramp') pos.y -= 0.05;
    colliderDesc
      .setFriction(def.type === 'ramp' ? 0.9 : 0.6)
      .setRestitution(0.08)
      .setCollisionGroups(groups(G.PROP, 0xffff));

    let body = null;
    let collider;
    if (kind.dynamic) {
      const bd = R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(rotation).setSleeping(true).setCcdEnabled(true);
      body = world.createRigidBody(bd);
      collider = world.createCollider(colliderDesc, body);
    } else {
      colliderDesc.setTranslation(pos.x, pos.y, pos.z).setRotation(rotation);
      collider = world.createCollider(colliderDesc);
    }
    if (kind.explosive) {
      collider.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS);
      collider.setContactForceEventThreshold(2600);
    }
    const prop = { def, kind: def.type, body, collider, alive: true, explosive: !!kind.explosive, home: pos, rotation };
    this.props.push(prop);
    this.propByCollider.set(collider.handle, prop);
    return prop;
  }

  removeProp(prop) {
    if (!prop.alive) return;
    prop.alive = false;
    this.propByCollider.delete(prop.collider.handle);
    if (prop.body) this.world.removeRigidBody(prop.body);
    else this.world.removeCollider(prop.collider, true);
  }

  // Ray straight down onto ground/props; returns hit distance or null.
  groundDistance(x, y, z, maxDist) {
    const ray = new this.R.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, G.GROUND | G.PROP));
    return hit ? hit.timeOfImpact : null;
  }

  dispose() {
    this.eventQueue.free?.();
    this.world.free();
  }
}
