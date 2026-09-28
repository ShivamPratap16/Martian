import * as THREE from 'three';
import { ELEV_MIN, ELEV_MAX } from './planet.js';

// Community terraforming: the more plots are claimed, the more Earth-like Mars becomes.
// Water fills the real low ground from the MOLA height map, so seas get true coastlines:
// Hellas Basin floods first, then the northern lowlands up to the proposed ancient
// shoreline (~-3,760 m, the "Deuteronilus" contact).

// Keyframes by number of claimed plots; every visual is interpolated between them.
// clouds/sky/green/civ are 0..1; sea is the water level in metres. civ drives the
// civilization stage: cities and roads, then the orbital ring, elevators and traffic.
const KEYS = [
  { at: 0, clouds: 0, sky: 0, sea: -9000, green: 0, civ: 0 },
  { at: 500, clouds: 0.3, sky: 0.15, sea: -9000, green: 0, civ: 0 },
  { at: 2500, clouds: 0.4, sky: 1, sea: -9000, green: 0, civ: 0 },
  { at: 5000, clouds: 0.45, sky: 1, sea: -6500, green: 0, civ: 0 },
  { at: 10000, clouds: 0.5, sky: 1, sea: -5300, green: 0.2, civ: 0 },
  { at: 20000, clouds: 0.55, sky: 1, sea: -4700, green: 1, civ: 0 },
  { at: 25000, clouds: 0.55, sky: 1, sea: -4300, green: 1, civ: 0.15 },
  { at: 30000, clouds: 0.6, sky: 1, sea: -3760, green: 1, civ: 0.35 },
  { at: 33000, clouds: 0.6, sky: 1, sea: -3760, green: 1, civ: 0.5 },
  { at: 36000, clouds: 0.6, sky: 1, sea: -3760, green: 1, civ: 0.7 },
  { at: 39000, clouds: 0.6, sky: 1, sea: -3760, green: 1, civ: 0.85 },
  { at: 41162, clouds: 0.6, sky: 1, sea: -3760, green: 1, civ: 1 },
];

export const MILESTONES = [
  { at: 500, icon: '☁️', name: 'First clouds' },
  { at: 2500, icon: '🌤️', name: 'Blue sky' },
  { at: 5000, icon: '💧', name: 'Hellas Lake' },
  { at: 10000, icon: '🌊', name: 'Hellas Sea' },
  { at: 20000, icon: '🌿', name: 'Green shores' },
  { at: 25000, icon: '🏙️', name: 'First cities' },
  { at: 30000, icon: '🌍', name: 'The Northern Ocean returns' },
  { at: 33000, icon: '🛰️', name: 'Orbital ring & space elevators' },
  { at: 36000, icon: '🧲', name: 'Magnetic shield & auroras' },
  { at: 39000, icon: '☀️', name: 'Orbital solar power swarm' },
  { at: 41162, icon: '🌌', name: 'Kardashev Type I civilization' },
];

function paramsAt(count) {
  const last = KEYS[KEYS.length - 1];
  if (count >= last.at) {
    const { at, ...rest } = last;
    return rest;
  }
  let i = 1;
  while (KEYS[i].at < count) i++;
  const a = KEYS[i - 1];
  const b = KEYS[i];
  const k = (count - a.at) / (b.at - a.at);
  const out = {};
  for (const key of Object.keys(a)) if (key !== 'at') out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

// Adds water, vegetation and cities to the Mars surface material. Cities come from civTex
// (R = urban density, G = roads): by day grey-blue urban texture, by night warm lights.
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
        uniform sampler2D civTex;
        uniform float civAmount;
        uniform vec3 sunDirView;
        float terraWater;
        float civUrban;
        float civRoad;
        float civHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
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
        diffuseColor.rgb = mix(diffuseColor.rgb, water, terraWater);

        // Cities grow from their dense cores outward as civAmount rises; roads follow later.
        vec4 civ = texture2D(civTex, vMapUv);
        // Density fades in from the core outward: reveal = how much of each city exists yet.
        civUrban = min(1.0, civ.r * 1.6) * smoothstep(1.0 - civAmount, 1.0 - civAmount + 0.35, civ.r) * (1.0 - terraWater) * step(0.001, civAmount);
        civRoad = civ.g * smoothstep(0.3, 0.6, civAmount) * (1.0 - terraWater);
        // Final stage: sprawl merges cities into urban regions; floating cities at sea.
        float eco = civ.b * smoothstep(0.84, 1.0, civAmount);
        civUrban = max(civUrban, eco * mix(1.0, 0.7, terraWater));
        float block = civHash(floor(vMapUv * vec2(8192.0, 4096.0)));
        vec3 urbanDay = mix(vec3(0.3, 0.3, 0.32), vec3(0.62, 0.62, 0.64), block);
        diffuseColor.rgb = mix(diffuseColor.rgb, urbanDay, civUrban * 0.75 * (1.0 - terraWater * 0.6));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.18, 0.2), civRoad * 0.35);`
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
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // City and road lights on the night side (vNormal and sunDirView are view space).
        float night = smoothstep(0.08, -0.22, dot(normalize(vNormal), sunDirView));
        // Individual lights: the denser the city, the more of these tiny cells are lit,
        // so cores glow solid and outskirts break up into scattered sparks.
        float cell = civHash(floor(vMapUv * vec2(8192.0, 4096.0)) + 0.37);
        float lit = step(1.0 - civUrban, cell);
        float glowFill = civUrban * 0.45;
        vec3 sodium = vec3(1.0, 0.55, 0.22);
        vec3 lights = sodium * (lit * (0.7 + 0.6 * cell) + glowFill)
                    + vec3(1.0, 0.72, 0.4) * civRoad * 0.6;
        totalEmissiveRadiance += lights * (night * 2.6 + 0.02);`
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

function blankCivTexture() {
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  tex.needsUpdate = true;
  return tex;
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
    civTex: { value: blankCivTexture() },
    civAmount: { value: 0 },
    sunDirView: { value: new THREE.Vector3() },
  };
  patchSurface(material, uniforms);
  const clouds = createClouds(uniforms);
  parent.add(clouds);

  let target = paramsAt(0);
  const current = paramsAt(0);

  return {
    total: KEYS[KEYS.length - 1].at,
    get civ() {
      return current.civ;
    },
    setCount(count) {
      target = paramsAt(count);
    },
    setCivTexture(tex) {
      uniforms.civTex.value = tex;
    },
    update(dt, t, camera) {
      // Ease visuals toward the target so milestones sweep in rather than pop.
      const k = Math.min(1, dt * 1.5);
      for (const key of Object.keys(current)) current[key] += (target[key] - current[key]) * k;
      uniforms.seaLevel.value = current.sea;
      uniforms.greenAmount.value = current.green;
      uniforms.cloudAmount.value = current.clouds;
      uniforms.civAmount.value = current.civ;
      uniforms.sunDirView.value.copy(uniforms.sunDir.value).transformDirection(camera.matrixWorldInverse);
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
