// Build mode: a 3D blueprint grid.
//
// - Click or drag across the grid to place the selected part (dragging paints a whole layer).
// - Click the face of a placed part to stack the next part against it.
// - "Inside boxes" mode drops pigs, engines, TNT and thrusters inside wooden or steel frames.
// - "Mirror" copies every placement to the other side of the vehicle.
// - Right-click (or the eraser, which can also drag) removes. Drag empty space to look around.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PARTS, DIRS, WHEEL_MOUNTS, WHEEL_DROP, cellLocal, cellKey, isFrame, fitsInside } from './parts.js';
import { createPartMesh, animatePig, INSIDE_SCALE } from '../render/partMeshes.js';
import { AxleView } from '../render/axles.js';
import { buildBrackets, hasBrackets, BRACKET_DIRS, INSIDE_BRACKET_DIRS } from '../render/brackets.js';

const ghostOk = new THREE.MeshStandardMaterial({ color: 0x8bff6a, emissive: 0x2f8f10, emissiveIntensity: 0.6, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshStandardMaterial({ color: 0xff5a4a, emissive: 0x8f1a10, emissiveIntensity: 0.6, transparent: true, opacity: 0.4, depthWrite: false });
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const boxGeo = new THREE.BoxGeometry(1.03, 1.03, 1.03);
const outlineGeo = new THREE.EdgesGeometry(boxGeo);
const outlineOk = new THREE.LineBasicMaterial({ color: 0xffd23a, toneMapped: false, transparent: true, opacity: 0.95, depthTest: false });
const outlineBad = new THREE.LineBasicMaterial({ color: 0xff5040, toneMapped: false, transparent: true, opacity: 0.95, depthTest: false });
const eraseFill = new THREE.MeshBasicMaterial({ color: 0xff4030, transparent: true, opacity: 0.25, depthWrite: false });

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
  g.userData.noAO = true;
  return g;
}

const slotOf = (type) => (isFrame(type) ? 'frame' : 'item');

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
    this.cells = new Map(); // "i,j,k|frame" or "i,j,k|item" -> { type, i, j, k, dir }
    this.selected = 'wood';
    this.eraser = false;
    this.insideMode = false;
    this.mirror = false;
    this.placeDir = 0;
    this.history = [];
    this.enabled = false;
    this.time = 0;
    this.turnLeft = 0;
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
    this.stroke = null;
    this._down = null;

    this._onMove = (e) => this._pointerMove(e);
    this._onDown = (e) => this._pointerDown(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onContext = (e) => e.preventDefault();
    dom.addEventListener('pointermove', this._onMove);
    // capture phase so a drag on the grid can claim the pointer before the camera controls see it
    dom.addEventListener('pointerdown', this._onDown, true);
    window.addEventListener('pointerup', this._onUp);
    dom.addEventListener('contextmenu', this._onContext);
  }

  _buildGrid() {
    const [nx, ny, nz] = this.dims;
    const o = this.origin;
    const g = new THREE.Group();
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
    const box = new THREE.BoxGeometry(nx, ny, nz);
    box.translate(o.x, o.y + ny / 2, o.z);
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, toneMapped: false })));
    // centre line shown while mirroring
    const mid = new THREE.BufferGeometry();
    mid.setAttribute('position', new THREE.Float32BufferAttribute([o.x - nx / 2, o.y + 0.02, o.z, o.x + nx / 2, o.y + 0.02, o.z], 3));
    this.mirrorLine = new THREE.LineSegments(mid, new THREE.LineBasicMaterial({ color: 0xffd23a, toneMapped: false }));
    this.mirrorLine.visible = false;
    g.add(this.mirrorLine);
    this.floorHit = new THREE.Mesh(new THREE.PlaneGeometry(nx, nz), hitMat);
    this.floorHit.rotation.x = -Math.PI / 2;
    this.floorHit.position.set(o.x, o.y, o.z);
    g.add(this.floorHit);
    g.userData.noAO = true;
    this.gridGroup = g;
    this.group.add(g);

    this.partsGroup = new THREE.Group();
    this.group.add(this.partsGroup);
    this.hitGroup = new THREE.Group();
    this.group.add(this.hitGroup);
    this.ghost = new THREE.Group();
    this.ghost.userData.noAO = true;
    this.group.add(this.ghost);
    this.outline = new THREE.LineSegments(outlineGeo, outlineOk);
    this.outline.renderOrder = 11;
    this.outline.visible = false;
    this.group.add(this.outline);
    this.eraseBox = new THREE.Mesh(boxGeo, eraseFill);
    this.eraseBox.visible = false;
    this.eraseBox.userData.noAO = true;
    this.group.add(this.eraseBox);
  }

  enable(on) {
    this.enabled = on;
    this.group.visible = on;
    this.controls.enabled = on;
    this.stroke = null;
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

  at(i, j, k) {
    const key = cellKey(i, j, k);
    return { frame: this.cells.get(`${key}|frame`) ?? null, item: this.cells.get(`${key}|item`) ?? null };
  }

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
    return { dims: this.dims, cells: this.cellsArray() };
  }

  cellsArray() {
    return [...this.cells.values()].map((c) => [c.type, c.i, c.j, c.k, c.dir]);
  }

  load(cells, record = true) {
    if (record) this._snapshot();
    this.cells.clear();
    for (const [type, i, j, k, dir = 0] of cells ?? []) {
      if (!PARTS[type] || !this._fits(type, i, j, k)) continue;
      if ((this.level.parts[type] ?? 0) <= this.used(type)) continue;
      this.cells.set(`${cellKey(i, j, k)}|${slotOf(type)}`, { type, i, j, k, dir });
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
    this.sound?.remove();
    return true;
  }

  _snapshot() {
    this.history.push(this.cellsArray());
    if (this.history.length > 80) this.history.shift();
  }

  _inside(i, j, k) {
    const [nx, ny, nz] = this.dims;
    return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
  }

  // Can this part type go into this cell, given what is already there?
  _fits(type, i, j, k) {
    if (!this._inside(i, j, k)) return false;
    const { frame, item } = this.at(i, j, k);
    if (isFrame(type)) return !frame && (!item || fitsInside(item.type));
    if (item) return false;
    if (frame) return fitsInside(type);
    return true;
  }

  canPlace(type, i, j, k) {
    return this._fits(type, i, j, k) && this.remaining(type) > 0;
  }

  _mirrorK(k) {
    return this.dims[2] - 1 - k;
  }

  // Places without recording history or rebuilding; returns true when something was added.
  _put(type, i, j, k, dir) {
    if (!this.canPlace(type, i, j, k)) return false;
    this.cells.set(`${cellKey(i, j, k)}|${slotOf(type)}`, { type, i, j, k, dir: PARTS[type].directional ? dir : 0 });
    return true;
  }

  place(i, j, k, { record = true } = {}) {
    const type = this.selected;
    if (!this.canPlace(type, i, j, k)) return false;
    if (record) this._snapshot();
    this._put(type, i, j, k, this.placeDir);
    if (this.mirror) {
      const mk = this._mirrorK(k);
      if (mk !== k) this._put(type, i, j, mk, this.placeDir);
    }
    this._rebuildMeshes();
    this.sound?.place();
    if (type === 'pig') this.sound?.oink();
    this.onChange?.();
    return true;
  }

  // Removes what is inside a box first, then the box itself.
  _take(i, j, k) {
    const { frame, item } = this.at(i, j, k);
    const victim = item ?? frame;
    if (!victim) return null;
    this.cells.delete(`${cellKey(i, j, k)}|${slotOf(victim.type)}`);
    return victim;
  }

  remove(i, j, k, { record = true } = {}) {
    const { frame, item } = this.at(i, j, k);
    if (!frame && !item) return false;
    if (record) this._snapshot();
    const gone = this._take(i, j, k);
    if (this.mirror) {
      const mk = this._mirrorK(k);
      const twin = mk !== k ? this.at(i, j, mk) : null;
      const match = twin && ((twin.item ?? twin.frame)?.type === gone.type);
      if (match) this._take(i, j, mk);
    }
    this._rebuildMeshes();
    this.sound?.remove();
    this.onChange?.();
    return true;
  }

  rotate() {
    // turn the hovered rocket or propeller, otherwise the direction for new ones
    const cell = this.hover?.cell;
    const target = cell && [this.at(cell[0], cell[1], cell[2]).item].find((c) => c && PARTS[c.type].directional);
    if (target) {
      this._snapshot();
      target.dir = (target.dir + 1) % DIRS.length;
      this._rebuildMeshes();
      this.sound?.click();
      this.onChange?.();
      return DIRS[target.dir].label;
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
    this._updateHover();
    this.onChange?.();
  }

  setEraser(on) {
    this.eraser = on;
    this._refreshGhost();
    this._updateHover();
    this.onChange?.();
  }

  setInsideMode(on) {
    this.insideMode = on;
    this._updateHover();
    this.onChange?.();
  }

  setMirror(on) {
    this.mirror = on;
    this.mirrorLine.visible = on;
    this._updateHover();
    this.onChange?.();
  }

  // Swing the camera around the build by 45 degree steps.
  turn(dir) {
    this.turnLeft += (dir * Math.PI) / 4;
  }

  hasPig() {
    return this.used('pig') > 0;
  }

  // Parts that are not bolted (directly or through other parts) to the pig's chunk fall off.
  looseParts() {
    const pig = [...this.cells.values()].find((c) => c.type === 'pig');
    if (!pig) return 0;
    const occupied = new Map();
    for (const c of this.cells.values()) {
      const key = cellKey(c.i, c.j, c.k);
      const e = occupied.get(key) ?? { solid: false, wheel: false, i: c.i, j: c.j, k: c.k, parts: 0 };
      if (c.type === 'wheel') e.wheel = true;
      else e.solid = true;
      e.parts++;
      occupied.set(key, e);
    }
    const seen = new Set([cellKey(pig.i, pig.j, pig.k)]);
    const stack = [occupied.get(cellKey(pig.i, pig.j, pig.k))];
    while (stack.length) {
      const e = stack.pop();
      for (const [dx, dy, dz] of WHEEL_MOUNTS) {
        const key = cellKey(e.i + dx, e.j + dy, e.k + dz);
        const n = occupied.get(key);
        if (!n || seen.has(key)) continue;
        if (n.wheel && !e.solid) continue;
        seen.add(key);
        if (n.solid) stack.push(n);
      }
    }
    let loose = 0;
    for (const [key, e] of occupied) if (!seen.has(key)) loose += e.parts;
    return loose;
  }

  _worldCell(i, j, k) {
    const l = cellLocal(this.dims, i, j, k);
    return new THREE.Vector3(this.origin.x + l[0], this.origin.y + l[1], this.origin.z + l[2]);
  }

  _wheelMount(c) {
    for (const d of WHEEL_MOUNTS) {
      const n = this.at(c.i + d[0], c.j + d[1], c.k + d[2]);
      if ((n.frame || n.item) && n.item?.type !== 'wheel') return d;
    }
    return null;
  }

  _rebuildMeshes() {
    for (const g of [this.partsGroup, this.hitGroup]) {
      while (g.children.length) g.remove(g.children[0]);
    }
    const hitGeo = new THREE.BoxGeometry(1, 1, 1);
    const hitCells = new Set();
    for (const c of this.cells.values()) {
      const m = createPartMesh(c.type);
      m.position.copy(this._worldCell(c.i, c.j, c.k));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(...DIRS[c.dir].v));
      if (!isFrame(c.type) && this.at(c.i, c.j, c.k).frame) m.scale.setScalar(INSIDE_SCALE[c.type] ?? 0.8);
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
      if (hasBrackets(c.type)) {
        const boxed = !!this.at(c.i, c.j, c.k).frame;
        const dirs = boxed
          ? INSIDE_BRACKET_DIRS
          : BRACKET_DIRS.filter(([dx, dy, dz]) => {
              const n = this.at(c.i + dx, c.j + dy, c.k + dz);
              return n.frame || (n.item && n.item.type !== 'wheel');
            });
        const br = buildBrackets(c.type, m.quaternion, dirs, boxed ? INSIDE_SCALE[c.type] ?? 0.8 : 1);
        br.position.copy(m.position);
        this.partsGroup.add(br);
      }
      if (c.type === 'wheel') {
        const mount = this._wheelMount(c);
        if (mount) {
          const axle = new AxleView(mount);
          const centre = this._worldCell(c.i, c.j, c.k);
          axle.update(centre, new THREE.Quaternion(), centre.clone().add(new THREE.Vector3(0, -WHEEL_DROP, 0)));
          this.partsGroup.add(axle.group);
        }
      }
      const key = cellKey(c.i, c.j, c.k);
      if (!hitCells.has(key)) {
        hitCells.add(key);
        const hit = new THREE.Mesh(hitGeo, hitMat);
        hit.position.copy(m.position);
        hit.userData.cell = [c.i, c.j, c.k];
        this.hitGroup.add(hit);
      }
    }
    this.hover = null;
    this._updateHover();
  }

  _refreshGhost() {
    while (this.ghost.children.length) this.ghost.remove(this.ghost.children[0]);
    this.ghostMeshes = [];
    if (this.eraser) return;
    // two ghosts: the cursor's and its mirror twin
    for (let n = 0; n < 2; n++) {
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
      m.visible = false;
      this.ghostMeshes.push(m);
      this.ghost.add(m);
    }
  }

  _showGhost(n, cell, ok, inside) {
    const m = this.ghostMeshes?.[n];
    if (!m) return;
    m.visible = true;
    m.position.copy(this._worldCell(...cell));
    m.scale.setScalar(inside ? INSIDE_SCALE[this.selected] ?? 0.8 : 1);
    m.traverse((o) => {
      if (o.isMesh && o.userData.ghost) o.material = ok ? ghostOk : ghostBad;
    });
  }

  _setPointer(e) {
    const r = this.dom.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  // Works out which cell a click would place into (or remove from).
  _target() {
    const hits = this.raycaster.intersectObjects([...this.hitGroup.children, this.floorHit], false);
    if (!hits.length) return null;
    const h = hits[0];
    const [nx, , nz] = this.dims;
    if (h.object === this.floorHit) {
      const i = Math.floor(h.point.x - (this.origin.x - nx / 2));
      const k = Math.floor(h.point.z - (this.origin.z - nz / 2));
      if (!this._inside(i, 0, k)) return null;
      return { place: [i, 0, k], cell: null, inside: false };
    }
    const c = h.object.userData.cell;
    const { frame, item } = this.at(...c);
    const sel = this.selected;
    // inside-boxes mode: drop the part into the box under the cursor (or wrap a box round a part)
    if (this.insideMode && ((frame && !item && fitsInside(sel)) || (item && !frame && isFrame(sel) && fitsInside(item.type)))) {
      return { place: c, cell: c, inside: true };
    }
    const n = h.face.normal;
    return { place: [c[0] + Math.round(n.x), c[1] + Math.round(n.y), c[2] + Math.round(n.z)], cell: c, inside: false };
  }

  _pointerMove(e) {
    if (!this.enabled) return;
    this._setPointer(e);
    if (this.stroke) this._continueStroke();
    this._updateHover();
  }

  _updateHover() {
    if (!this.enabled) return;
    this.hover = this._target();
    for (const m of this.ghostMeshes ?? []) m.visible = false;
    this.outline.visible = false;
    this.eraseBox.visible = false;
    const h = this.hover;
    if (!h) return;
    if (this.eraser) {
      if (h.cell) {
        this.eraseBox.position.copy(this._worldCell(...h.cell));
        this.eraseBox.visible = true;
      }
      return;
    }
    const [i, j, k] = h.place;
    if (!this._inside(i, j, k)) return;
    const ok = this.canPlace(this.selected, i, j, k);
    const inside = !!this.at(i, j, k).frame && !isFrame(this.selected);
    this._showGhost(0, h.place, ok, inside);
    this.outline.visible = true;
    this.outline.material = ok ? outlineOk : outlineBad;
    this.outline.position.copy(this._worldCell(i, j, k));
    if (this.mirror) {
      const mk = this._mirrorK(k);
      if (mk !== k) this._showGhost(1, [i, j, mk], this.canPlace(this.selected, i, j, mk), !!this.at(i, j, mk).frame && !isFrame(this.selected));
    }
  }

  _pointerDown(e) {
    if (!this.enabled) return;
    this._down = { x: e.clientX, y: e.clientY, button: e.button };
    if (e.button !== 0 && e.pointerType === 'mouse') return; // right/middle drag turns the camera
    this._setPointer(e);
    const t = this._target();
    if (!t) return; // empty space: let the camera controls have the drag
    const erase = this.eraser || e.shiftKey;
    if (erase && !t.cell) return;
    // the grid claims this drag
    this.controls.enabled = false;
    this._snapshot();
    this.stroke = { erase, layer: t.place[1], last: null, changed: false, inside: t.inside };
    this._strokeAt(t);
  }

  _strokeAt(t) {
    const s = this.stroke;
    if (s.erase) {
      if (!t.cell) return;
      const key = t.cell.join(',');
      if (s.last === key) return;
      s.last = key;
      s.changed = this.remove(...t.cell, { record: false }) || s.changed;
      return;
    }
    const key = t.place.join(',');
    if (s.last === key) return;
    s.last = key;
    if (this.place(...t.place, { record: false })) s.changed = true;
    else if (!s.changed && this._inside(...t.place)) this.onReject?.(this.remaining(this.selected) <= 0 ? 'none-left' : 'blocked');
  }

  _continueStroke() {
    const s = this.stroke;
    if (s.erase || s.inside) {
      const t = this._target();
      if (t && (!s.inside || t.inside)) this._strokeAt(t);
      return;
    }
    // paint across the layer the stroke started on, measured at its floor (where the cursor
    // sits when you start on the grid or on top of the parts below)
    const y = this.origin.y + s.layer;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return;
    const [nx, , nz] = this.dims;
    const i = Math.floor(p.x - (this.origin.x - nx / 2));
    const k = Math.floor(p.z - (this.origin.z - nz / 2));
    if (!this._inside(i, s.layer, k)) return;
    this._strokeAt({ place: [i, s.layer, k], cell: null, inside: false });
  }

  _pointerUp(e) {
    if (!this.enabled) return;
    const d = this._down;
    this._down = null;
    if (this.stroke) {
      if (!this.stroke.changed) this.history.pop(); // nothing happened: drop the undo step
      this.stroke = null;
      this.controls.enabled = true;
      return;
    }
    // a right-click without dragging removes
    if (d && d.button === 2 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) {
      this._setPointer(e);
      const t = this._target();
      if (t?.cell) this.remove(...t.cell);
    }
  }

  update(dt = 1 / 60) {
    if (!this.enabled) return;
    this.time += dt;
    if (Math.abs(this.turnLeft) > 1e-4) {
      const step = this.turnLeft * Math.min(1, dt * 8);
      this.turnLeft -= step;
      const off = this.camera.position.clone().sub(this.controls.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), step);
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.controls.update();
    for (const m of this.partsGroup.children) {
      if (m.userData.partType === 'pig') animatePig(m, this.time, m.position.x);
    }
  }

  dispose() {
    this.controls.dispose();
    this.dom.removeEventListener('pointermove', this._onMove);
    this.dom.removeEventListener('pointerdown', this._onDown, true);
    window.removeEventListener('pointerup', this._onUp);
    this.dom.removeEventListener('contextmenu', this._onContext);
    this.scene.remove(this.group);
  }
}
