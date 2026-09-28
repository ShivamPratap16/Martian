import * as THREE from 'three';

// Elevation range of the MOLA height map (meters), used to decode mars_height.png.
export const ELEV_MIN = -8177;
export const ELEV_MAX = 21171;

// Relief exaggeration on the mesh. Kept small so the plot grid (drawn at GRID_RADIUS)
// always floats just above the tallest volcano.
const DISPLACEMENT_SCALE = 0.006;
const DISPLACEMENT_BIAS = -0.0017; // puts the 0 m datum near radius 1.0
export const GRID_RADIUS = 1.0045;

// Converts Mars lat/lon (degrees) to a point matching SphereGeometry's UV layout,
// where the color map has longitude -180 at its left edge.
export function latLonToVec3(lat, lon, r = 1, target = new THREE.Vector3()) {
  const la = THREE.MathUtils.degToRad(lat);
  const lo = THREE.MathUtils.degToRad(lon);
  return target.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

export function vec3ToLatLon(v) {
  const n = v.clone().normalize();
  return {
    lat: THREE.MathUtils.radToDeg(Math.asin(n.y)),
    lon: THREE.MathUtils.radToDeg(Math.atan2(-n.z, n.x)),
  };
}

export function createMars(manager, renderer) {
  const loader = new THREE.TextureLoader(manager);
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const colorMap = loader.load('/textures/mars_color.jpg');
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = aniso;

  const normalMap = loader.load('/textures/mars_normal.jpg');
  normalMap.anisotropy = aniso;

  const heightMap = loader.load('/textures/mars_height.png');

  const material = new THREE.MeshStandardMaterial({
    map: colorMap,
    normalMap,
    normalScale: new THREE.Vector2(1.2, 1.2),
    displacementMap: heightMap,
    displacementScale: DISPLACEMENT_SCALE,
    displacementBias: DISPLACEMENT_BIAS,
    roughness: 0.96,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 512, 256), material);
  mesh.name = 'mars';
  return mesh;
}

// Thin, dusty atmosphere: a faint limb glow that is bluish at the edge (ice hazes)
// and butterscotch further in, only on the sunlit side.
export function createAtmosphere() {
  const uniforms = {
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    terra: { value: 0 }, // 0 = today's thin dusty air, 1 = thick Earth-like blue sky
  };

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1.035, 128, 64),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        uniform float terra;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float rim = 1.0 - abs(dot(vNormal, viewDir));
          float glow = pow(smoothstep(0.55 - terra * 0.15, 1.0, rim), 3.0 - terra) * (1.0 - smoothstep(0.93, 1.0, rim));
          float lit = smoothstep(-0.25, 0.6, dot(vNormal, sunDir));
          vec3 col = mix(vec3(0.85, 0.55, 0.35), vec3(0.55, 0.68, 0.95), smoothstep(0.75, 0.97, rim));
          col = mix(col, vec3(0.3, 0.55, 1.0), terra);
          gl_FragColor = vec4(col, glow * lit * (0.9 + terra * 0.8));
        }`,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );

  // Soft haze over the day side of the disk itself.
  const haze = new THREE.Mesh(
    new THREE.SphereGeometry(1.006, 128, 64),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 sunDir;
        uniform float terra;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fres = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0 - terra);
          float lit = smoothstep(-0.1, 0.5, dot(vNormal, sunDir));
          vec3 col = mix(vec3(0.6, 0.66, 0.85), vec3(0.35, 0.6, 1.0), terra);
          gl_FragColor = vec4(col, fres * lit * (0.35 + terra * 0.35));
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );

  const group = new THREE.Group();
  group.add(shell, haze);
  return { group, uniforms };
}

export function createStars(count = 7000) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    v.randomDirection().multiplyScalar(60 + Math.random() * 40);
    positions.set([v.x, v.y, v.z], i * 3);
    // mostly white, some warm and some blue stars
    const t = Math.random();
    c.setHSL(t < 0.15 ? 0.08 : t < 0.3 ? 0.6 : 0, t < 0.3 ? 0.5 : 0, 0.55 + Math.random() * 0.45);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 0.12, vertexColors: true, sizeAttenuation: true, depthWrite: false })
  );
}

// Phobos and Deimos: small lumpy potato-shaped moons.
function lumpyMoon(radius, stretch, seed) {
  const geo = new THREE.IcosahedronGeometry(radius, 4);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 40 + seed) * Math.sin(v.y * 37 + seed * 2) * Math.sin(v.z * 43 + seed * 3) * 0.12 +
      Math.sin(v.x * 90 + seed) * Math.sin(v.z * 85) * 0.04;
    v.multiplyScalar(1 + n);
    v.x *= stretch;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a6a5c, roughness: 1, flatShading: false }));
}

export function createMoons() {
  const phobos = lumpyMoon(0.022, 1.35, 1.3);
  const deimos = lumpyMoon(0.013, 1.25, 4.1);
  // Real orbits are 2.76 and 6.92 Mars radii; Deimos is pulled in so it is visible.
  const moons = [
    { mesh: phobos, radius: 2.76, speed: 0.12, tilt: 0.02, phase: 0 },
    { mesh: deimos, radius: 4.4, speed: 0.05, tilt: 0.03, phase: 2.2 },
  ];
  const group = new THREE.Group();
  moons.forEach((m) => group.add(m.mesh));
  return {
    group,
    update(t) {
      for (const m of moons) {
        const a = m.phase + t * m.speed;
        m.mesh.position.set(Math.cos(a) * m.radius, Math.sin(a) * m.radius * m.tilt, -Math.sin(a) * m.radius);
        m.mesh.rotation.y = -a; // tidally locked
      }
    },
  };
}

// Loads the height map into memory so we can read elevation at any lat/lon.
export async function loadElevationSampler() {
  const img = new Image();
  img.src = '/textures/mars_height.png';
  await img.decode();
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return (lat, lon) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor(((lon + 180) / 360) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
    const v = data[(y * w + x) * 4] / 255;
    return ELEV_MIN + v * (ELEV_MAX - ELEV_MIN);
  };
}
