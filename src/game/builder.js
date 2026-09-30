// Build mode: a 3D blueprint grid where parts are clicked into place, Minecraft style.
// Click the floor or the face of a placed part to add the selected part next to it.
// Right-click (or the eraser) removes. R rotates propellers and rockets.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, DIRS, cellLocal, cellKey } from './parts.js';
import { createPartMesh } from '../render/partMeshes.js';

const ghostOk = new THREE.MeshStandardMaterial({ color: 0x8bff6a, emissive: 0x2f8f10, emissiveIntensity: 0.6, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0x8f1a10, emissiveIntensity: 0.6, transparent: true, opacity: 0.4, depthWrite: false });
const eraseMat = new THREE.MeshBasicMaterial({ color: 0xff4030, transparent: true, opacity: 0.28, depthWrite: false });
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

function arrowMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd23a, toneMapped: false, depthTest: false, transparent: true, opacity: 0.95 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), mat);
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = 0.1;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 14), mat);
  head.rotation.z = -Math.PI / 2;
  head.position.x = 0.45;
  g.add(shaft, head);
  g.renderOrder = 10;
  shaft.renderOrder = head.renderOrder = 10;
  return g;
}

export class Builder {
  constructor({ scene, camera, dom, level, origin, sound, onChange }) {
    this.scene = scene;
    this.camera = camera;
    this.dom = dom;
    this.level = level;
    this.dims = level.grid;
    this.origin = origin.clone();
    this.sound = sound;
    this.onChange = onChange;
    this.cells = new Map();
    this.selected = 'wood';
    this.eraser = false;
    this.placeDir = 0;
    this.history = [];
    this.enabled = false;
    this.group = new THREE.Group();
    this.group.name = 'builder';
    scene.add(this.group);
    this._buildGrid();

    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.enabled = false;
    this.centre = this.origin.clone().add(new THREE.Vector3(0, this.dims[1] * 0.5, 0));
    this.controls.target.copy(this.centre);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-9, -9);
    this.hover = null;
    this._down = null;

    this._onMove = (e) => this._pointerMove(e);
    this._onDown = (e) => {
      this._down = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
    };
    this._onUp = (e) => this._pointerUp(e);
    this._onContext = (e) => e.preventDefault();
    dom.addEventListener('pointermove', this._onMove);
    dom.addEventListener('pointerdown', this._onDown);
    dom.addEventListener('pointerup', this._onUp);
    dom.addEventListener('contextmenu', this._onContext);
  }

  _buildGrid() {
    const [nx, ny, nz] = this.dims;
    const o = this.origin;
    const g = new THREE.Group();
    // blueprint floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(nx, nz),
      new THREE.MeshBasicMaterial({ color: 0x3aa0ff, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(o.x, o.y + 0.004, o.z);
    g.add(floor);
    const pts = [];
    for (let i = 0; i <= nx; i++) {
      const x = o.x - nx / 2 + i;
      pts.push(x, o.y + 0.01, o.z - nz / 2, x, o.y + 0.01, o.z + nz / 2);
    }
    for (let k = 0; k <= nz; k++) {
      const z = o.z - nz / 2 + k;
      pts.push(o.x - nx / 2, o.y + 0.01, z, o.x + nx / 2, o.y + 0.01, z);
    }
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.8, toneMapped: false })));
    // build volume outline
    const box = new THREE.BoxGeometry(nx, ny, nz);
    box.translate(o.x, o.y + ny / 2, o.z);
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, toneMapped: false })));
    // invisible floor for picking
    this.floorHit = new THREE.Mesh(new THREE.PlaneGeometry(nx, nz), hitMat);
    this.floorHit.rotation.x = -Math.PI / 2;
    this.floorHit.position.set(o.x, o.y, o.z);
    g.add(this.floorHit);
    this.gridGroup = g;
    this.group.add(g);

    this.partsGroup = new THREE.Group();
    this.group.add(this.partsGroup);
    this.hitGroup = new THREE.Group();
    this.group.add(this.hitGroup);
    this.ghost = new THREE.Group();
    this.group.add(this.ghost);
    this.eraseBox = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.04, 1.04), eraseMat);
    this.eraseBox.visible = false;
    this.eraseBox.userData.noAO = true;
    this.ghost.userData.noAO = true;
    this.gridGroup.userData.noAO = true;
    this.group.add(this.eraseBox);
  }

  enable(on) {
    this.enabled = on;
    this.group.visible = on;
    this.controls.enabled = on;
    if (on) {
      // front three-quarter view so the pig looks at you
      const d = 2.6 + Math.max(...this.dims) * 1.15;
      this.camera.position.copy(this.centre).add(new THREE.Vector3(d * 0.72, d * 0.5, d * 0.62));
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(this.centre);
      this.controls.update();
      this._refreshGhost();
    }
  }

  // ------------------------------------------------------------------ blueprint

  used(type) {
    let n = 0;
    for (const c of this.cells.values()) if (c.type === type) n++;
    return n;
  }

  remaining(type) {
    const max = this.level.parts[type] ?? 0;
    return max === Infinity ? Infinity : max - this.used(type);
  }

  blueprint() {
    return { dims: this.dims, cells: [...this.cells.values()].map((c) => [c.type, c.i, c.j, c.k, c.dir]) };
  }

  cellsArray() {
    return [...this.cells.values()].map((c) => [c.type, c.i, c.j, c.k, c.dir]);
  }

  load(cells, record = true) {
    if (record) this._snapshot();
    this.cells.clear();
    for (const [type, i, j, k, dir = 0] of cells ?? []) {
      if (!this._inside(i, j, k) || !PARTS[type]) continue;
      if ((this.level.parts[type] ?? 0) <= this.used(type)) continue;
      this.cells.set(cellKey(i, j, k), { type, i, j, k, dir });
    }
    this._rebuildMeshes();
    this.onChange?.();
  }

  clear() {
    this.load([], true);
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    this.load(prev, false);
    return true;
  }

  _snapshot() {
    this.history.push(this.cellsArray());
    if (this.history.length > 60) this.history.shift();
  }

  _inside(i, j, k) {
    const [nx, ny, nz] = this.dims;
    return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
  }

  canPlace(type, i, j, k) {
    if (!this._inside(i, j, k)) return false;
    if (this.cells.has(cellKey(i, j, k))) return false;
    return this.remaining(type) > 0;
  }

  place(i, j, k) {
    const type = this.selected;
    if (!this.canPlace(type, i, j, k)) {
      return false;
    }
    this._snapshot();
    const dir = PARTS[type].directional ? this.placeDir : 0;
    this.cells.set(cellKey(i, j, k), { type, i, j, k, dir });
    this._rebuildMeshes();
    this.sound?.place();
    if (type === 'pig') this.sound?.oink();
    this.onChange?.();
    return true;
  }

  remove(i, j, k) {
    const key = cellKey(i, j, k);
    if (!this.cells.has(key)) return false;
    this._snapshot();
    this.cells.delete(key);
    this._rebuildMeshes();
    this.sound?.remove();
    this.onChange?.();
    return true;
  }

  rotate() {
    // rotate the hovered directional part, otherwise the direction for new parts
    const h = this.hover;
    if (h && h.part && PARTS[h.part.type].directional) {
      this._snapshot();
      h.part.dir = (h.part.dir + 1) % DIRS.length;
      this._rebuildMeshes();
      this.sound?.click();
      this.onChange?.();
      return DIRS[h.part.dir].label;
    }
    this.placeDir = (this.placeDir + 1) % DIRS.length;
    this._refreshGhost();
    this.sound?.click();
    this.onChange?.();
    return DIRS[this.placeDir].label;
  }

  select(type) {
    this.selected = type;
    this.eraser = false;
    this._refreshGhost();
    this.onChange?.();
  }

  setEraser(on) {
    this.eraser = on;
    this._refreshGhost();
    this.onChange?.();
  }

  hasPig() {
    return this.used('pig') > 0;
  }

  _worldCell(i, j, k) {
    const l = cellLocal(this.dims, i, j, k);
    return new THREE.Vector3(this.origin.x + l[0], this.origin.y + l[1], this.origin.z + l[2]);
  }

  _rebuildMeshes() {
    for (const g of [this.partsGroup, this.hitGroup]) {
      while (g.children.length) g.remove(g.children[0]);
    }
    const hitGeo = new THREE.BoxGeometry(1, 1, 1);
    for (const c of this.cells.values()) {
      const m = createPartMesh(c.type);
      m.position.copy(this._worldCell(c.i, c.j, c.k));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(...DIRS[c.dir].v));
      m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      if (PARTS[c.type].directional) {
        const a = arrowMesh();
        a.position.set(0, 0.52, 0);
        if (c.dir === 1 || c.dir === 3) a.position.set(0.52, 0, 0);
        m.add(a);
      }
      this.partsGroup.add(m);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.copy(m.position);
      hit.userData.cell = c;
      this.hitGroup.add(hit);
    }
    this.hover = null;
    this._updateHover();
  }

  _refreshGhost() {
    while (this.ghost.children.length) this.ghost.remove(this.ghost.children[0]);
    if (this.eraser) return;
    const m = createPartMesh(this.selected);
    m.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.userData.ghost = true;
      }
    });
    if (PARTS[this.selected].directional) {
      const a = arrowMesh();
      a.position.set(0, 0.52, 0);
      if (this.placeDir === 1 || this.placeDir === 3) a.position.set(0.52, 0, 0);
      m.add(a);
    }
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(...DIRS[this.placeDir].v));
    this.ghostMesh = m;
    this.ghost.add(m);
    this.ghost.visible = false;
  }

  _setGhostMaterial(ok) {
    this.ghostMesh?.traverse((o) => {
      if (o.isMesh && o.userData.ghost) o.material = ok ? ghostOk : ghostBad;
    });
  }

  _pointerMove(e) {
    if (!this.enabled) return;
    const r = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._updateHover();
  }

  _updateHover() {
    if (!this.enabled) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.hitGroup.children, this.floorHit], false);
    this.hover = null;
    this.ghost.visible = false;
    this.eraseBox.visible = false;
    if (!hits.length) return;
    const h = hits[0];
    const [nx, , nz] = this.dims;
    if (h.object === this.floorHit) {
      const i = Math.floor(h.point.x - (this.origin.x - nx / 2));
      const k = Math.floor(h.point.z - (this.origin.z - nz / 2));
      if (!this._inside(i, 0, k)) return;
      this.hover = { place: [i, 0, k], part: null };
    } else {
      const c = h.object.userData.cell;
      const n = h.face.normal;
      this.hover = { place: [c.i + Math.round(n.x), c.j + Math.round(n.y), c.k + Math.round(n.z)], part: c };
    }
    if (this.eraser) {
      if (this.hover.part) {
        this.eraseBox.position.copy(this._worldCell(this.hover.part.i, this.hover.part.j, this.hover.part.k));
        this.eraseBox.visible = true;
      }
      return;
    }
    const [i, j, k] = this.hover.place;
    if (!this._inside(i, j, k)) return;
    this.ghost.visible = true;
    this.ghost.position.copy(this._worldCell(i, j, k));
    this._setGhostMaterial(this.canPlace(this.selected, i, j, k));
  }

  _pointerUp(e) {
    if (!this.enabled || !this._down) return;
    const d = this._down;
    this._down = null;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved > 6) return; // that was a camera drag
    this._pointerMove(e);
    if (!this.hover) return;
    const remove = d.button === 2 || this.eraser || e.shiftKey;
    if (remove) {
      if (this.hover.part) this.remove(this.hover.part.i, this.hover.part.j, this.hover.part.k);
      return;
    }
    const [i, j, k] = this.hover.place;
    if (!this.place(i, j, k)) {
      if (this._inside(i, j, k)) this.onReject?.(this.remaining(this.selected) <= 0 ? 'none-left' : 'blocked');
    }
  }

  update() {
    if (this.enabled) this.controls.update();
  }

  dispose() {
    this.controls.dispose();
    this.dom.removeEventListener('pointermove', this._onMove);
    this.dom.removeEventListener('pointerdown', this._onDown);
    this.dom.removeEventListener('pointerup', this._onUp);
    this.dom.removeEventListener('contextmenu', this._onContext);
    this.scene.remove(this.group);
  }
}
