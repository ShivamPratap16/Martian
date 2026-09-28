import * as THREE from 'three';

// Ground-level Mars around a landing site, in metres. The landing point is the origin,
// +Y is up. Terrain, rocks and colors are seeded from the plot so every site differs,
// and the ground color comes from the real orbital color at that spot.

export const SUN_DIR = new THREE.Vector3(-0.55, 0.46, 0.7).normalize(); // ~27° above the horizon, front-left of the rover

// ---------- deterministic noise ----------
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rand = mulberry(seed);
  const perm = new Uint8Array(512);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (x, z) => perm[(perm[x & 255] + z) & 255] / 255;
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, z) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = smooth(x - xi);
    const zf = smooth(z - zi);
    const a = val(xi, zi);
    const b = val(xi + 1, zi);
    const c = val(xi, zi + 1);
    const d = val(xi + 1, zi + 1);
    return (a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf) * 2 - 1;
  };
  return (x, z, octaves = 4) => {
    let v = 0;
    let amp = 0.5;
    for (let i = 0; i < octaves; i++) {
      v += noise(x, z) * amp;
      x = x * 2.03 + 17.1;
      z = z * 2.03 + 3.7;
      amp *= 0.5;
    }
    return v;
  };
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createHeightField(seed) {
  const fbm = makeNoise(seed);
  const rand = mulberry(seed ^ 0x9e3779b9);
  const craters = [];
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const d = 70 + rand() * 900;
    const R = 8 + Math.pow(rand(), 2) * 90;
    craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, R, depth: R * (0.12 + rand() * 0.08) });
  }
  const raw = (x, z) => {
    let h = fbm(x / 420, z / 420, 4) * 16 + fbm(x / 90, z / 90, 3) * 3 + fbm(x / 16, z / 16, 3) * 0.45;
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.R;
      if (d < 1) h -= c.depth * (1 - d * d);
      if (d < 2) h += c.depth * 0.35 * Math.exp(-(((d - 1) / 0.22) ** 2));
    }
    return h;
  };
  const h0 = raw(0, 0);
  // The landing zone itself is a gentle, nearly flat patch.
  return (x, z) => {
    const r = Math.hypot(x, z);
    const f = 0.12 + 0.88 * smoothstep(8, 60, r);
    return (raw(x, z) - h0) * f + fbm(x / 3, z / 3, 2) * 0.04;
  };
}

// ---------- textures ----------
function grainTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const v = 190 + Math.random() * 50 + (Math.random() < 0.04 ? -70 : 0);
    img.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  // Soften into sand grains and small pebbles.
  ctx.filter = 'blur(0.6px)';
  ctx.drawImage(c, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- sky ----------
const skyShader = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = vec4(p.xy, p.w * 0.99999, p.w); // just inside the far plane, behind everything
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 sunDir;
    uniform vec3 horizon;
    uniform vec3 zenith;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float h = max(d.y, 0.0);
      float s = max(dot(d, sunDir), 0.0);
      vec3 col = mix(horizon, zenith, pow(h, 0.5));
      col *= 0.72 + 0.45 * pow(s, 3.0); // brighter towards the Sun, deeper opposite it
      col = mix(col, horizon * 0.8, smoothstep(0.0, -0.08, d.y)); // below horizon
      // Dust scatters light forward, so the sky around the Sun on Mars looks bluish.
      col = mix(col, vec3(0.48, 0.58, 0.78), pow(s, 14.0) * 0.55);
      col += vec3(1.0, 0.96, 0.9) * (pow(s, 2200.0) * 6.0 + pow(s, 180.0) * 0.6);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

function createSky(colors) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      sunDir: { value: SUN_DIR },
      horizon: { value: colors.horizon },
      zenith: { value: colors.zenith },
    },
    ...skyShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

// ---------- world ----------
export function createLandingWorld(renderer, { seed, groundColor }) {
  const scene = new THREE.Scene();
  const height = createHeightField(seed);
  const rand = mulberry(seed ^ 0x51ed27);

  // Sky colors tinted slightly by the local ground color.
  // Butterscotch near the horizon, deeper brown overhead (colors given in sRGB).
  const horizon = new THREE.Color().setRGB(0.8, 0.6, 0.45, THREE.SRGBColorSpace).lerp(groundColor, 0.12);
  const zenith = new THREE.Color().setRGB(0.5, 0.36, 0.27, THREE.SRGBColorSpace);
  scene.fog = new THREE.FogExp2(horizon.clone().multiplyScalar(0.95), 0.0016);
  const sky = createSky({ horizon, zenith });
  scene.add(sky);

  // Environment map for metal reflections, rendered from the sky alone.
  const envScene = new THREE.Scene();
  envScene.add(createSky({ horizon, zenith }));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();

  // Lighting: low warm Sun with long soft shadows, dusty sky fill.
  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.9, 0.78), 2.8);
  sun.position.copy(SUN_DIR).multiplyScalar(80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 220 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.85, 0.62, 0.45), new THREE.Color(0.3, 0.18, 0.12), 0.9));

  // Terrain: a grid that is dense near the landing point and sparse towards the horizon.
  const N = 300;
  const L = 2600;
  const warp = (u) => Math.sign(u) * L * Math.abs(u) ** 2.3;
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  const uv = new Float32Array((N + 1) * (N + 1) * 2);
  const col = new Float32Array((N + 1) * (N + 1) * 3);
  const dark = groundColor.clone().multiplyScalar(0.55).lerp(new THREE.Color(0.08, 0.06, 0.05), 0.25);
  const light = groundColor.clone().lerp(new THREE.Color(0.9, 0.62, 0.42), 0.35);
  const patch = makeNoise(seed ^ 0x777);
  const c = new THREE.Color();
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const x = warp((i / N) * 2 - 1);
      const z = warp((j / N) * 2 - 1);
      const y = height(x, z);
      pos.set([x, y, z], k * 3);
      uv.set([x / 3, z / 3], k * 2);
      // Dark basaltic sand in hollows and patches, brighter dust on rises.
      const slopeish = height(x + 1.5, z) - y;
      const t = THREE.MathUtils.clamp(0.5 + patch(x / 55, z / 55, 3) * 0.9 + y * 0.015 - slopeish * 0.25, 0, 1);
      c.copy(dark).lerp(light, t);
      col.set([c.r, c.g, c.b], k * 3);
    }
  }
  const index = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      index.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const grain = grainTexture();
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, bumpMap: grain, bumpScale: 1.2, roughness: 0.97, metalness: 0 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // Rocks: many pebbles, few boulders (power-law sizes), half buried.
  // Lumpy rock: every vertex is pushed in/out by a function of its direction, so the
  // copies of a shared corner (one per face) all move together and faces stay joined.
  const rockGeo = new THREE.IcosahedronGeometry(1, 1);
  const rp = rockGeo.attributes.position;
  const v = new THREE.Vector3();
  const lump = (p) => {
    const h = Math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453;
    return 0.75 + (h - Math.floor(h)) * 0.45;
  };
  for (let i = 0; i < rp.count; i++) {
    v.fromBufferAttribute(rp, i);
    v.multiplyScalar(lump(v));
    rp.setXYZ(i, v.x, v.y * 0.7, v.z);
  }
  rockGeo.computeVertexNormals();
  const ROCKS = 1400;
  const rocks = new THREE.InstancedMesh(
    rockGeo,
    new THREE.MeshStandardMaterial({ color: groundColor.clone().multiplyScalar(0.55), roughness: 0.92, flatShading: true }),
    ROCKS
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const rockColor = new THREE.Color();
  // Keep clear sightlines: nothing around the rover (the closing shot circles it) or
  // right in front of the ground cameras.
  const cameraSpots = [[-8.5, 12.5], [22, 46]];
  for (let i = 0; i < ROCKS; i++) {
    const a = rand() * Math.PI * 2;
    const d = 9 + Math.pow(rand(), 1.6) * 260;
    let x = Math.cos(a) * d;
    let z = Math.sin(a) * d;
    if (cameraSpots.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 6)) {
      x *= 3;
      z *= 3;
    }
    const size = 0.05 + Math.pow(rand(), 7) * 1.6;
    s.set(size * (0.8 + rand() * 0.6), size * (0.6 + rand() * 0.5), size * (0.8 + rand() * 0.6));
    q.setFromEuler(e.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6));
    m.compose(v.set(x, height(x, z) - size * 0.25, z), q, s);
    rocks.setMatrixAt(i, m);
    rocks.setColorAt(i, rockColor.copy(groundColor).multiplyScalar(0.45 + rand() * 0.35));
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);

  return {
    scene,
    height,
    sun,
    groundColor,
    dispose() {
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) [].concat(o.material).forEach((mm) => mm.dispose());
      });
      grain.dispose();
      envRT.dispose();
    },
  };
}
