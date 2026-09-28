import * as THREE from 'three';
import { cellToChildren, cellToLatLng } from 'h3-js';
import { latLonToVec3, GRID_RADIUS } from './planet.js';

// Each claimed plot becomes a small settlement of warm lights that shine on Mars' night
// side, like city lights on Earth seen from orbit. Lights sit on a few of the plot's
// finer H3 sub-cells (picked deterministically from the plot id) so every settlement has
// its own shape, and each gets one soft halo so dense regions bloom together.

const SUB_RES = 5; // 49 sub-cells per plot at PLOT_RES 3

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296;
}

export function createColonyLights() {
  const uniforms = {
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    time: { value: 0 },
    pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform vec3 sunDir;
      uniform float time;
      uniform float pixelRatio;
      attribute float aSize;
      attribute float aBright;
      attribute float aSeed;
      varying float vAlpha;
      varying float vHalo;
      void main() {
        vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        // Planet is centred at the origin, so the surface normal is the position.
        float sun = dot(normalize(worldPos), sunDir);
        float night = smoothstep(0.12, -0.18, sun); // lights come on past the terminator
        float flicker = 0.85 + 0.15 * sin(time * (1.5 + aSeed * 3.0) + aSeed * 40.0);
        vAlpha = night * aBright * flicker;
        vHalo = step(4.0, aSize);
        vec4 mv = viewMatrix * vec4(worldPos, 1.0);
        gl_PointSize = aSize * pixelRatio * clamp(2.6 / -mv.z, 0.6, 3.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying float vHalo;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float core = exp(-d * d * 6.0);
        float halo = exp(-d * d * 2.5) * 0.35;
        float a = mix(core, halo, vHalo) * vAlpha;
        vec3 warm = mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.9, 0.72), core);
        gl_FragColor = vec4(warm * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  points.renderOrder = 3;
  points.frustumCulled = false;

  function build(cells) {
    const pos = [];
    const size = [];
    const bright = [];
    const seed = [];
    const v = new THREE.Vector3();
    const r = GRID_RADIUS + 0.0006;
    for (const cell of cells) {
      const rand = rng(hash(cell));
      const [la, lo] = cellToLatLng(cell);
      // One wide halo per settlement.
      latLonToVec3(la, lo, r, v);
      pos.push(v.x, v.y, v.z);
      size.push(26 + rand() * 10);
      bright.push(0.55);
      seed.push(rand());
      // A handful of point lights: the centre plus 6–12 sub-cells, brighter near the middle.
      const subs = cellToChildren(cell, SUB_RES);
      const count = 6 + Math.floor(rand() * 7);
      const picks = new Set([Math.floor(subs.length / 2)]);
      while (picks.size < count) picks.add(Math.floor(rand() * subs.length));
      for (const i of picks) {
        const [sla, slo] = cellToLatLng(subs[i]);
        latLonToVec3(sla, slo, r, v);
        pos.push(v.x, v.y, v.z);
        size.push(2.2 + rand() * 1.8);
        bright.push(0.7 + rand() * 0.3);
        seed.push(rand());
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    points.geometry.dispose();
    points.geometry = geo;
  }

  return {
    object: points,
    uniforms,
    sync(claims) {
      build([...claims.keys()]);
    },
    // Dev-only preview of how a busy Mars would look.
    preview(cells) {
      build(cells);
    },
  };
}
