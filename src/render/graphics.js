// Renderer, camera, post-processing chain and graphics quality presets.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GRASS_LAYER } from './vegetation.js';
import { partMaterials } from './partMeshes.js';

export const QUALITY = {
  low: { label: 'Low', scale: 0.8, maxDpr: 1, shadowMap: 1024, shadowSoftness: 1.5, ao: false, bloom: false, msaa: 0, smaa: true, grass: 0.3, trees: 0.6, probe: 0 },
  medium: { label: 'Medium', scale: 1, maxDpr: 1, shadowMap: 2048, shadowSoftness: 2.5, ao: false, bloom: true, msaa: 4, smaa: false, grass: 0.65, trees: 1, probe: 6 },
  high: { label: 'High', scale: 1, maxDpr: 1.5, shadowMap: 2048, shadowSoftness: 3, ao: true, bloom: true, msaa: 4, smaa: false, grass: 1, trees: 1, probe: 3 },
  ultra: { label: 'Ultra', scale: 1, maxDpr: 2, shadowMap: 4096, shadowSoftness: 3.5, ao: true, bloom: true, msaa: 4, smaa: false, grass: 1.6, trees: 1.3, probe: 1 },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

// GTAO re-renders the scene for depth and normals. Sprites, particles and see-through helpers
// would count as solid walls there, so hide them for that pass (they are already drawn).
class CleanGTAOPass extends GTAOPass {
  render(...args) {
    const hidden = [];
    this.scene.traverseVisible((o) => {
      if (o.isSprite || o.isPoints || o.isLine || o.userData.noAO) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    super.render(...args);
    for (const o of hidden) o.visible = true;
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.28 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.07 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSaturation; uniform float uContrast;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.8)));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
    }`,
};

export class Graphics {
  constructor(canvas, qualityName) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 6000);
    this.camera.layers.enable(GRASS_LAYER);
    this.qualityName = QUALITY[qualityName] ? qualityName : 'high';
    this.quality = QUALITY[this.qualityName];
    this.frame = 0;
    this.dynScale = 1;
    this.adaptTimer = -2;
    this.probeTarget = null;
    this.hideForProbe = [];
    this._buildComposer();
    this.resize();
    this._setupProbe();
    window.addEventListener('resize', () => this.resize());
  }

  _buildComposer() {
    const q = this.quality;
    this.composer?.dispose();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: q.msaa });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) {
      const ao = new CleanGTAOPass(this.scene, this.camera, size.x, size.y);
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      composer.addPass(ao);
      this.aoPass = ao;
    } else {
      this.aoPass = null;
    }
    if (q.bloom) {
      // high threshold: only fire, sparks, sun glints and the star glow, never the sky itself
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.5, 3.2);
      composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = null;
    }
    composer.addPass(new OutputPass());
    if (q.smaa) composer.addPass(new SMAAPass());
    this.gradePass = new ShaderPass(GradeShader);
    composer.addPass(this.gradePass);
    this.composer = composer;
  }

  setQuality(name) {
    if (!QUALITY[name]) return;
    this.qualityName = name;
    this.quality = QUALITY[name];
    this._buildComposer();
    this.resize();
    this._setupProbe();
  }

  pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.quality.maxDpr) * this.quality.scale * this.dynScale;
  }

  // Dynamic resolution: when frames take too long, render a few percent fewer pixels (down to 60%),
  // and climb back once there is headroom. Keeps motion smooth on slower laptops.
  adapt(dt) {
    this.ft = this.ft === undefined ? dt : this.ft * 0.92 + dt * 0.08;
    this.adaptTimer += dt;
    if (this.adaptTimer < 1.2) return;
    this.adaptTimer = 0;
    let s = this.dynScale;
    if (this.ft > 1 / 48) s = Math.max(0.6, s - 0.1);
    else if (this.ft < 1 / 57) s = Math.min(1, s + 0.05);
    if (Math.abs(s - this.dynScale) > 1e-3) {
      this.dynScale = s;
      this.resize();
    }
  }

  // After loading or a big hitch, don't judge performance on stale frame times.
  resetAdapt() {
    this.ft = undefined;
    this.adaptTimer = -2;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize?.(h * pr, this.camera.fov);
  }

  // A small cube camera that captures the surroundings for reflections on the car's metal and paint.
  _setupProbe() {
    const q = this.quality;
    const mats = Object.values(partMaterials());
    if (!q.probe) {
      this.probeTarget?.dispose();
      this.probeTarget = null;
      this.probeCamera = null;
      for (const m of mats) if (m.envMap) { m.envMap = null; m.needsUpdate = true; }
      return;
    }
    if (!this.probeTarget) {
      this.probeTarget = new THREE.WebGLCubeRenderTarget(q.probe === 1 ? 256 : 128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      this.probeCamera = new THREE.CubeCamera(0.4, 1500, this.probeTarget);
      this.scene.add(this.probeCamera);
    }
    for (const m of mats) {
      if (m.isMeshStandardMaterial && m.envMap !== this.probeTarget.texture) {
        m.envMap = this.probeTarget.texture;
        m.needsUpdate = true;
      }
    }
    this.probeNeedsFill = true;
  }

  setProbeFocus(point, hide) {
    this.probePoint = point;
    this.hideForProbe = hide;
  }

  render() {
    this.frame++;
    const q = this.quality;
    if (this.probeCamera && this.probePoint && (this.probeNeedsFill || this.frame % q.probe === 0)) {
      this.probeNeedsFill = false;
      this.probeCamera.position.copy(this.probePoint);
      // the car should not reflect itself, and fireballs in a 128px probe just make chrome glow
      const hidden = [...this.hideForProbe];
      this.scene.traverseVisible((o) => {
        if (o.isPoints || o.isSprite || o.userData.skyDome) hidden.push(o);
      });
      // Swap the raw sky dome for the balanced sky light so reflections match the lighting.
      const scene = this.scene;
      const bg = scene.background;
      const bgi = scene.backgroundIntensity;
      scene.background = scene.environment;
      scene.backgroundIntensity = scene.environmentIntensity;
      for (const o of hidden) o.visible = false;
      this.probeCamera.update(this.renderer, scene);
      for (const o of hidden) o.visible = true;
      scene.background = bg;
      scene.backgroundIntensity = bgi;
    }
    this.composer.render();
  }
}
