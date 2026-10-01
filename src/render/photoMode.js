// Ray-traced photo mode. Freezes the game and path-traces the current view with three-gpu-pathtracer:
// real multi-bounce global illumination, soft sky light, glossy reflections and depth of field.

import * as THREE from 'three';
import { WebGLPathTracer, PhysicalCamera } from 'three-gpu-pathtracer';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Path tracer only understands standard/physical materials, so custom shaders become plain ones.
function ptMaterial(m) {
  if (!m) return m;
  if (Array.isArray(m)) return m.map(ptMaterial);
  if (m.isMeshStandardMaterial) return m;
  if (m.isMeshBasicMaterial) {
    return new THREE.MeshStandardMaterial({ color: m.color, emissive: m.color, emissiveIntensity: 1, map: m.map, transparent: m.transparent, opacity: m.opacity });
  }
  return new THREE.MeshStandardMaterial({ color: 0x888888 });
}

// Bake instanced meshes into ordinary geometry (optionally only instances near a point).
function bakeInstanced(im, near, radius, maxInstances) {
  const geos = [];
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const color = new THREE.Color();
  const base = im.geometry.index ? im.geometry.toNonIndexed() : im.geometry.clone();
  for (const k of Object.keys(base.attributes)) if (!['position', 'normal', 'color'].includes(k)) base.deleteAttribute(k);
  if (!base.attributes.normal) base.computeVertexNormals();
  if (!base.attributes.color) {
    const c = new Float32Array(base.attributes.position.count * 3).fill(1);
    base.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const count = im.count;
  const picks = [];
  for (let i = 0; i < count; i++) {
    im.getMatrixAt(i, m4);
    pos.setFromMatrixPosition(m4);
    const d = near ? pos.distanceTo(near) : 0;
    if (near && d > radius) continue;
    picks.push([d, i]);
  }
  picks.sort((a, b) => a[0] - b[0]);
  for (const [, i] of picks.slice(0, maxInstances)) {
    im.getMatrixAt(i, m4);
    const g = base.clone();
    g.applyMatrix4(m4);
    if (im.instanceColor) {
      im.getColorAt(i, color);
      const c = g.attributes.color;
      for (let v = 0; v < c.count; v++) c.setXYZ(v, c.getX(v) * color.r, c.getY(v) * color.g, c.getZ(v) * color.b);
    }
    geos.push(g);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos);
  const src = Array.isArray(im.material) ? im.material[0] : im.material;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: src.roughness ?? 0.8,
    map: src.map ?? null,
    side: src.side,
  });
  return new THREE.Mesh(merged, mat);
}

export class PhotoMode {
  constructor(graphics) {
    this.graphics = graphics;
    this.active = false;
    this.tracer = null;
  }

  async start({ camera, env, levelView, vehicleView, focus, onStatus }) {
    const renderer = this.graphics.renderer;
    this.active = true;
    onStatus?.('Building the ray-tracing scene…');
    await new Promise((r) => setTimeout(r, 30));

    const scene = new THREE.Scene();
    this.owned = [];
    const add = (obj) => {
      obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        if (!o.visible) return;
        if (o.isInstancedMesh) return;
        if (o.isMesh && !o.isSprite) {
          const m = new THREE.Mesh(o.geometry, ptMaterial(o.material));
          m.matrixAutoUpdate = false;
          m.matrix.copy(o.matrixWorld);
          m.matrixWorld.copy(o.matrixWorld);
          scene.add(m);
        }
      });
    };
    const lv = levelView;
    add(lv.terrainNear);
    add(lv.terrainFar);
    for (const m of lv.propMeshes.values()) if (m.parent) add(m);
    add(lv.finish);
    if (lv.star.visible) add(lv.star);
    add(vehicleView.objects());

    // baked instanced vegetation near the camera
    const near = camera.position;
    lv.scatter.traverse((o) => {
      if (!o.isInstancedMesh) return;
      const baked = bakeInstanced(o, near, 130, 140);
      if (baked) {
        if (o.material.map) baked.material.map = o.material.map;
        scene.add(baked);
        this.owned.push(baked);
      }
    });
    for (const chunk of lv.grass.children) {
      if (!chunk.visible || chunk.userData.centre.distanceTo(near) > 45) continue;
      const baked = bakeInstanced(chunk, near, 30, 900);
      if (baked) {
        baked.material.side = THREE.DoubleSide;
        baked.material.color.setScalar(1.6); // raster grass is brightened by its fake up-normals
        scene.add(baked);
        this.owned.push(baked);
      }
    }

    // sky and sun
    this.skyRT = env.skyCubeTexture(512);
    scene.background = this.skyRT.texture;
    scene.environment = this.skyRT.texture;
    scene.environmentIntensity = env.scene.environmentIntensity;
    scene.backgroundIntensity = env.scene.environmentIntensity;
    const sun = new THREE.DirectionalLight(env.sun.color, env.sun.intensity);
    sun.position.copy(env.sunDir).multiplyScalar(100);
    scene.add(sun);
    scene.add(sun.target);

    const cam = new PhysicalCamera(camera.fov, camera.aspect, camera.near, camera.far);
    cam.position.copy(camera.position);
    cam.quaternion.copy(camera.quaternion);
    cam.focusDistance = focus ? camera.position.distanceTo(focus) : 10;
    cam.fStop = 5.6;
    cam.apertureBlades = 6;
    cam.updateProjectionMatrix();

    onStatus?.('Building the BVH (ray acceleration structure)…');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    const tracer = new WebGLPathTracer(renderer);
    tracer.bounces = 5;
    tracer.transmissiveBounces = 4;
    tracer.filterGlossyFactor = 0.4;
    tracer.minSamples = 1;
    tracer.renderDelay = 0;
    tracer.fadeDuration = 0;
    tracer.renderScale = Math.min(1, 1.25 / renderer.getPixelRatio());
    tracer.tiles.set(2, 2);
    tracer.multipleImportanceSampling = true;
    tracer.rasterizeScene = true;
    // synchronous build: the async path needs a web worker file, which a single-file game can't ship
    tracer.setScene(scene, cam);
    this.tracer = tracer;
    this.scene = scene;
    this.camera = cam;
    this.startTime = performance.now();
    onStatus?.('');
  }

  get samples() {
    return this.tracer ? Math.floor(this.tracer.samples) : 0;
  }

  render() {
    if (!this.tracer) return;
    this.tracer.renderSample();
  }

  // PNG of the current ray-traced frame.
  snapshot() {
    this.render();
    return this.graphics.renderer.domElement.toDataURL('image/png');
  }

  stop() {
    this.active = false;
    this.tracer?.dispose();
    this.tracer = null;
    this.skyRT?.dispose();
    for (const o of this.owned ?? []) {
      o.geometry.dispose();
      o.material.dispose();
    }
    this.owned = [];
    this.scene = null;
  }
}
