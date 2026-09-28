import * as THREE from 'three';
import { ELEV_MIN, ELEV_MAX } from './planet.js';

// Community terraforming: the more plots are claimed, the more Earth-like Mars becomes.
// Water fills the real low ground from the MOLA height map, so seas get true coastlines:
// Hellas Basin floods first, then the northern lowlands up to the proposed ancient
// shoreline (~-3,760 m, the "Deuteronilus" contact).

// Keyframes by number of claimed plots; every visual is interpolated between them.
// clouds/sky/green are 0..1; sea is the water level in metres.
const KEYS = [
  { at: 0, clouds: 0, sky: 0, sea: -9000, green: 0 },
  { at: 500, clouds: 0.3, sky: 0.15, sea: -9000, green: 0 },
  { at: 2500, clouds: 0.4, sky: 1, sea: -9000, green: 0 },
  { at: 5000, clouds: 0.45, sky: 1, sea: -6500, green: 0 },
  { at: 10000, clouds: 0.5, sky: 1, sea: -5300, green: 0.2 },
  { at: 20000, clouds: 0.55, sky: 1, sea: -4700, green: 1 },
  { at: 41162, clouds: 0.6, sky: 1, sea: -3760, green: 1 },
];

export const MILESTONES = [
  { at: 500, icon: '☁️', name: 'First clouds' },
  { at: 2500, icon: '🌤️', name: 'Blue sky' },
  { at: 5000, icon: '💧', name: 'Hellas Lake' },
  { at: 10000, icon: '🌊', name: 'Hellas Sea' },
  { at: 20000, icon: '🌿', name: 'Green shores' },
  { at: 41162, icon: '🌍', name: 'The Northern Ocean returns' },
];

function paramsAt(count) {
  const last = KEYS[KEYS.length - 1];
  if (count >= last.at) return { ...last };
  let i = 1;
  while (KEYS[i].at < count) i++;
  const a = KEYS[i - 1];
  const b = KEYS[i];
  const k = (count - a.at) / (b.at - a.at);
  const lerp = (x, y) => x + (y - x) * k;
  return { clouds: lerp(a.clouds, b.clouds), sky: lerp(a.sky, b.sky), sea: lerp(a.sea, b.sea), green: lerp(a.green, b.green) };
}

// Adds water and vegetation to the Mars surface material.
function patchSurface(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D heightTex;
        uniform float seaLevel;
        uniform float greenAmount;
        float terraWater;`
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        float elev = mix(${ELEV_MIN.toFixed(1)}, ${ELEV_MAX.toFixed(1)}, texture2D(heightTex, vMapUv).r);
        float depth = seaLevel - elev;
        terraWater = smoothstep(-60.0, 60.0, depth);
        vec3 shallow = vec3(0.07, 0.30, 0.38);
        vec3 deep = vec3(0.015, 0.07, 0.17);
        vec3 water = mix(shallow, deep, smoothstep(0.0, 1800.0, depth));
        // Vegetation: lowlands and coasts turn green, thinning out with altitude and towards
        // the poles, so the high southern plateaus and volcano tops stay red. Colours are
        // linear-space greens (tinting the red soil would only ever give brown).
        float lat = abs(vMapUv.y - 0.5) * 180.0;
        float lowland = smoothstep(4200.0, 150.0, -depth) * (1.0 - terraWater);
        float veg = lowland * greenAmount * smoothstep(64.0, 42.0, lat);
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        vec3 forest = vec3(0.035, 0.085, 0.02);
        vec3 grass = vec3(0.13, 0.19, 0.045);
        vec3 plants = mix(forest, grass, clamp(lum * 3.5, 0.0, 1.0)); // keep the terrain's light/shade detail
        diffuseColor.rgb = mix(diffuseColor.rgb, plants, veg * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, water, terraWater);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, terraWater);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, terraWater)); // water is flat`
      );
  };
  material.needsUpdate = true;
}

function createClouds(uniforms) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1.012, 160, 80),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        varying vec3 vWorldNormal;
        void main() {
          vPos = position;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float cloudAmount;
        uniform float time;
        uniform vec3 sunDir;
        varying vec3 vPos;
        varying vec3 vWorldNormal;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }
        void main() {
          // Stretch along longitude so clouds form bands, and drift them slowly eastward.
          float c = cos(time * 0.01); float s = sin(time * 0.01);
          vec3 p = vec3(c * vPos.x - s * vPos.z, vPos.y * 1.8, s * vPos.x + c * vPos.z);
          float n = fbm(p * 3.2 + fbm(p * 6.0) * 0.6);
          float cover = smoothstep(0.78 - cloudAmount * 0.35, 0.95 - cloudAmount * 0.3, n);
          float lit = smoothstep(-0.15, 0.45, dot(vWorldNormal, sunDir));
          float a = cover * cloudAmount * 1.4;
          gl_FragColor = vec4(vec3(0.97, 0.95, 0.93) * (0.12 + 0.88 * lit), a * (0.25 + 0.75 * lit));
        }`,
      transparent: true,
      depthWrite: false,
    })
  );
}

export function createTerraform({ marsMesh, atmosphere, parent }) {
  const material = marsMesh.material;
  const uniforms = {
    heightTex: { value: material.displacementMap },
    seaLevel: { value: -9000 },
    greenAmount: { value: 0 },
    cloudAmount: { value: 0 },
    time: { value: 0 },
    sunDir: atmosphere.uniforms.sunDir, // shared, updated every frame by the caller
  };
  patchSurface(material, uniforms);
  const clouds = createClouds(uniforms);
  parent.add(clouds);

  let target = paramsAt(0);
  const current = paramsAt(0);

  return {
    total: KEYS[KEYS.length - 1].at,
    setCount(count) {
      target = paramsAt(count);
    },
    update(dt, t) {
      // Ease visuals toward the target so milestones sweep in rather than pop.
      const k = Math.min(1, dt * 1.5);
      for (const key of Object.keys(current)) current[key] += (target[key] - current[key]) * k;
      uniforms.seaLevel.value = current.sea;
      uniforms.greenAmount.value = current.green;
      uniforms.cloudAmount.value = current.clouds;
      uniforms.time.value = t;
      clouds.visible = current.clouds > 0.005;
      atmosphere.uniforms.terra.value = current.sky;
    },
  };
}

export function nextMilestone(count) {
  return MILESTONES.find((m) => m.at > count) ?? null;
}

export function reachedMilestone(count) {
  return [...MILESTONES].reverse().find((m) => m.at <= count) ?? null;
}
