// Physically based sky (Preetham scattering + clouds), the sun, shadows that follow the action,
// image-based lighting generated from the sky, and fog matched to the horizon colour.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class WorldEnvironment {
  constructor(renderer, scene, theme, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.theme = theme;

    const el = THREE.MathUtils.degToRad(theme.sun.elevation);
    const az = THREE.MathUtils.degToRad(theme.sun.azimuth);
    // azimuth measured from +X towards +Z, so 180 puts the sun behind the start
    this.sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();

    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    this.sky.frustumCulled = false;
    this.sky.userData.skyDome = true;
    const u = this.sky.material.uniforms;
    u.turbidity.value = theme.turbidity;
    u.rayleigh.value = theme.rayleigh;
    u.mieCoefficient.value = theme.mie;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(this.sunDir);
    u.cloudCoverage.value = theme.clouds ?? 0.32;
    u.cloudDensity.value = 0.55;
    u.cloudElevation.value = 0.55;
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = 0.00003;
    scene.add(this.sky);

    const t = THREE.MathUtils.clamp(theme.sun.elevation / 45, 0, 1);
    const warm = new THREE.Color(1.0, 0.58, 0.32);
    const white = new THREE.Color(1.0, 0.95, 0.88);
    this.sunColor = warm.clone().lerp(white, Math.sqrt(t));
    this.sun = new THREE.DirectionalLight(this.sunColor, 5.2 * (0.55 + 0.45 * t));
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.shadowExtent = 34;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -this.shadowExtent;
    cam.right = cam.top = this.shadowExtent;
    cam.near = 1;
    cam.far = 400;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.setQuality(quality);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.material = this.sky.material.clone();
    this.envSky.scale.setScalar(100);
    this.envScene.add(this.envSky);
    this.updateEnvironmentMap();
    // Balance sky light against the sun like real daylight (sky roughly a quarter of the sun on the
    // ground), whatever the sky model's absolute brightness happens to be.
    const sky = this.measureSky();
    const lum = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
    const skyIrradiance = Math.PI * lum(sky.upper);
    const sunIrradiance = this.sun.intensity * Math.max(0.4, this.sunDir.y); // low suns still leave a bright sky
    this.scene.environmentIntensity = THREE.MathUtils.clamp((sunIrradiance * 0.42) / Math.max(1e-4, skyIrradiance), 0.05, 1.5);
    this.skyInfo = { sky, skyIrradiance, sunIrradiance, envIntensity: this.scene.environmentIntensity };
    this.fogColor = new THREE.Color(sky.horizon.x, sky.horizon.y, sky.horizon.z).multiplyScalar(this.scene.environmentIntensity * 1.1);
    scene.fog = new THREE.FogExp2(this.fogColor, theme.fog);
    scene.background = null;
  }

  setQuality(q) {
    const size = q.shadowMap;
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.radius = q.shadowSoftness ?? 3;
    this.sun.shadow.blurSamples = 12;
  }

  updateEnvironmentMap() {
    const u = this.envSky.material.uniforms;
    u.showSunDisc.value = 0; // the sun itself comes from the directional light
    u.sunPosition.value.copy(this.sunDir);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000, { size: 256 });
    this.scene.environment = this.envRT.texture;
    old?.dispose();
  }

  // Measures the sky: radiance just above the horizon (for fog) and the average over the upper
  // hemisphere (how much light the sky pours onto the ground).
  measureSky() {
    const N = 16;
    const rt = new THREE.WebGLCubeRenderTarget(N, { type: THREE.FloatType });
    const cc = new THREE.CubeCamera(0.1, 1000, rt);
    this.envScene.add(cc);
    cc.update(this.renderer, this.envScene);
    const buf = new Float32Array(N * N * 4);
    const horizon = new THREE.Vector3();
    const upper = new THREE.Vector3();
    let nh = 0;
    let nu = 0;
    // faces: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z ; row 0 of a side face is its bottom edge
    for (const face of [0, 1, 2, 4, 5]) {
      this.renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf, face);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = (y * N + x) * 4;
          const top = face === 2;
          if (!top && y < N / 2) continue;
          // weight roughly by cosine to the zenith
          const w = top ? 1 : (y - N / 2 + 0.5) / (N / 2);
          upper.x += buf[i] * w;
          upper.y += buf[i + 1] * w;
          upper.z += buf[i + 2] * w;
          nu += w;
          if (!top && y >= N / 2 && y < N / 2 + 3) {
            horizon.x += buf[i];
            horizon.y += buf[i + 1];
            horizon.z += buf[i + 2];
            nh++;
          }
        }
      }
    }
    rt.dispose();
    this.envScene.remove(cc);
    horizon.divideScalar(Math.max(1, nh));
    upper.divideScalar(Math.max(1, nu));
    return { horizon, upper };
  }

  // Cube map of the sky for the path tracer (no sun disc: the sun is a real light there).
  skyCubeTexture(size = 512) {
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
    const cc = new THREE.CubeCamera(0.1, 1000, rt);
    this.envScene.add(cc);
    this.envSky.material.uniforms.showSunDisc.value = 0;
    cc.update(this.renderer, this.envScene);
    this.envScene.remove(cc);
    return rt;
  }

  // Keep the shadow map centred on what the camera is looking at, snapped to texels to avoid shimmer.
  follow(point) {
    const light = this.sun;
    const size = light.shadow.mapSize.x || 2048;
    const texel = (this.shadowExtent * 2) / size;
    const d = this.sunDir;
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, d).normalize();
    const u = Math.round(point.dot(right) / texel) * texel;
    const v = Math.round(point.dot(up) / texel) * texel;
    const w = point.dot(d);
    const snapped = right.multiplyScalar(u).add(up.multiplyScalar(v)).addScaledVector(d, w);
    light.target.position.copy(snapped);
    light.position.copy(snapped).addScaledVector(d, 200);
    light.target.updateMatrixWorld();
  }

  update(time) {
    this.sky.material.uniforms.time.value = time;
  }

  dispose() {
    this.scene.remove(this.sky);
    this.scene.remove(this.sun);
    this.scene.remove(this.sun.target);
    this.sun.shadow.map?.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.envSky.material.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
  }
}
