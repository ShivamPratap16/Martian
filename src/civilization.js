import * as THREE from 'three';
import { latLonToVec3 } from './planet.js';

// The last terraforming stage: an advanced, spacefaring civilization.
//  - Cities settle where people would: on the future coastlines and lowlands (from the
//    real MOLA elevation), joined by a maglev/road network. They are baked into civTex
//    (R = urban density, G = roads) which the surface shader turns into day texture and
//    night lights.
//  - In orbit: an equatorial orbital ring built segment by segment, space elevators
//    (one on Pavonis Mons, the site actually proposed for a Mars elevator), climbers,
//    shuttles with engine trails, blinking satellites and wheel stations.
// Everything reveals progressively with civ (0..1).

const FINAL_SEA = -3760;
const RING_R = 1.28;
const ELEVATORS = [-112.96, 7, 127]; // longitudes on the equator; the first is Pavonis Mons
const TEX_W = 2048;
const TEX_H = 1024;

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

const rad = THREE.MathUtils.degToRad;
function angDist(a, b) {
  const c = Math.sin(rad(a.lat)) * Math.sin(rad(b.lat)) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, c))));
}

// ---------- where the cities go ----------
function placeCities(elevationAt, rand) {
  const candidates = [];
  for (let i = 0; i < 6000; i++) {
    const lat = THREE.MathUtils.radToDeg(Math.asin(rand() * 2 - 1)) * 0.95;
    const lon = rand() * 360 - 180;
    if (Math.abs(lat) > 58) continue;
    const e = elevationAt(lat, lon);
    if (e < FINAL_SEA + 60 || e > 6000) continue;
    // Coastal if water lies within ~2.5° in any direction.
    let coastal = false;
    for (let k = 0; k < 8 && !coastal; k++) {
      const a = (k / 8) * Math.PI * 2;
      coastal = elevationAt(lat + Math.sin(a) * 2.5, lon + (Math.cos(a) * 2.5) / Math.cos(rad(lat))) < FINAL_SEA;
    }
    const lowland = THREE.MathUtils.clamp(1 - (e - FINAL_SEA) / 6000, 0, 1);
    candidates.push({ lat, lon, score: (coastal ? 1 : 0.25) * (0.4 + lowland) * (0.5 + rand()) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const cities = [];
  for (const c of candidates) {
    if (cities.length >= 170) break;
    if (cities.some((o) => angDist(o, c) < 3.2)) continue;
    cities.push(c);
  }
  // A spaceport city at the foot of each elevator.
  for (const lon of ELEVATORS) cities.push({ lat: 0, lon, score: 2, port: true });
  // Pareto-ish sizes: a few megacities, many towns. Spaceports are always big.
  for (const c of cities) c.size = c.port ? 1.1 : 0.25 + Math.pow(rand(), 3) * 1.2;
  return cities;
}

// Minimum spanning tree plus a few extra links, so the network has loops like real ones.
function buildRoads(cities) {
  const n = cities.length;
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const from = new Array(n).fill(-1);
  const edges = [];
  best[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = true;
    if (from[u] >= 0) edges.push([from[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = angDist(cities[u], cities[v]);
      if (d < best[v]) {
        best[v] = d;
        from[v] = u;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const near = cities
      .map((c, j) => [j, angDist(cities[i], c)])
      .filter(([j, d]) => j !== i && d < 11)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2);
    for (const [j] of near) if (!edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edges.push([i, j]);
  }
  // Long hauls over water or very long ones are skipped (those are served by air).
  return edges.filter(([a, b]) => angDist(cities[a], cities[b]) < 22);
}

// ---------- bake cities and roads into an equirectangular texture ----------
function bakeTexture(cities, roads, rand) {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.globalCompositeOperation = 'lighter';
  const px = (lat, lon) => [((lon + 180) / 360) * TEX_W, ((90 - lat) / 180) * TEX_H];

  const blob = (x, y, rx, ry, strength) => {
    for (const ox of [0, -TEX_W, TEX_W]) {
      if (x + ox + rx < 0 || x + ox - rx > TEX_W) continue;
      ctx.save();
      ctx.translate(x + ox, y);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(255,0,0,${strength})`);
      g.addColorStop(0.5, `rgba(255,0,0,${strength * 0.45})`);
      g.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  for (const city of cities) {
    const [x, y] = px(city.lat, city.lon);
    const stretch = 1 / Math.max(0.35, Math.cos(rad(city.lat)));
    const r = 1.5 + city.size * 6;
    blob(x, y, r * stretch, r, 0.95);
    // Suburbs and satellite towns give each city an organic outline.
    const n = 8 + Math.floor(city.size * 16);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = r * (0.6 + rand() * 2.2);
      const sr = r * (0.25 + rand() * 0.5);
      blob(x + Math.cos(a) * d * stretch, y + Math.sin(a) * d, sr * stretch, sr, 0.25 + rand() * 0.4);
    }
  }

  // Roads as great-circle arcs, split where they cross the map's date line.
  ctx.strokeStyle = 'rgba(0,210,0,1)';
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (const [i, j] of roads) {
    latLonToVec3(cities[i].lat, cities[i].lon, 1, va);
    latLonToVec3(cities[j].lat, cities[j].lon, 1, vb);
    const angle = va.angleTo(vb);
    const steps = Math.max(8, Math.ceil(THREE.MathUtils.radToDeg(angle) * 2));
    let prev = null;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // Slerp between the two cities.
      v.copy(va).multiplyScalar(Math.sin((1 - t) * angle)).addScaledVector(vb, Math.sin(t * angle)).divideScalar(Math.sin(angle));
      const lat = THREE.MathUtils.radToDeg(Math.asin(v.y));
      const lon = THREE.MathUtils.radToDeg(Math.atan2(-v.z, v.x));
      const [x, y] = px(lat, lon);
      if (prev && Math.abs(x - prev[0]) > TEX_W / 2) ctx.moveTo(x, y);
      else if (prev) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      prev = [x, y];
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  return tex;
}

// ---------- orbital infrastructure ----------
function ringGeometry(progress) {
  return new THREE.TorusGeometry(RING_R, 0.0032, 8, 512, Math.max(0.001, progress) * Math.PI * 2).rotateX(Math.PI / 2);
}

function createStation() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xdedad4, metalness: 0.5, roughness: 0.4 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd9a8 });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0028, 8, 48), white));
  g.add(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0009, 4, 48), glow).translateZ(0.0024));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 12).rotateX(Math.PI / 2), white));
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.022, 4), white);
    spoke.rotation.z = (i / 4) * Math.PI;
    g.add(spoke);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0004, 0.008), new THREE.MeshStandardMaterial({ color: 0x1b2a4a, metalness: 0.6, roughness: 0.3 }));
  panel.position.z = -0.016;
  g.add(panel);
  return g;
}

// Glowing points with size attenuation, used for traffic, climbers and satellites.
function glowPoints(count) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      uniform float pixelRatio;
      attribute vec3 aColor;
      attribute float aSize;
      varying vec3 vColor;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * pixelRatio * clamp(2.4 / -mv.z, 0.5, 3.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float a = exp(-d * d * 4.0);
        gl_FragColor = vec4(vColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

const range = (x, a, b) => THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);

export function createCivilization({ elevationAt, parent, seed = 4242 }) {
  const rand = mulberry(seed);
  const cities = placeCities(elevationAt, rand);
  const roads = buildRoads(cities);
  const texture = bakeTexture(cities, roads, rand);
  const cityPos = cities.map((c) => latLonToVec3(c.lat, c.lon, 1.003));

  const group = new THREE.Group();
  parent.add(group);

  // Orbital ring with a light strip and station modules along it.
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 0.8, roughness: 0.35 });
  const ring = new THREE.Mesh(ringGeometry(0), ringMat);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffe3b8, transparent: true, opacity: 0.85 });
  const strip = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.001, 4, 512).rotateX(Math.PI / 2), stripMat);
  strip.position.y = 0.0035;
  const MODULES = 48;
  const modules = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.008, 0.01), ringMat, MODULES);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < MODULES; i++) {
    const a = (i / MODULES) * Math.PI * 2;
    m4.makeRotationY(-a).setPosition(Math.cos(a) * RING_R, 0, -Math.sin(a) * RING_R);
    modules.setMatrixAt(i, m4);
  }
  group.add(ring, strip, modules);
  let builtRing = -1;

  // Space elevators: tethers from the equator up to the ring.
  const tetherMat = new THREE.MeshBasicMaterial({ color: 0xe8e2d8, transparent: true, opacity: 0.8 });
  const tethers = ELEVATORS.map((lon) => {
    const base = latLonToVec3(0, lon, 1.002);
    const top = latLonToVec3(0, lon, RING_R);
    const len = top.distanceTo(base);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0011, 0.0011, len, 6).translate(0, len / 2, 0), tetherMat);
    m.position.copy(base);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(base).normalize());
    group.add(m);
    return { m, base, top };
  });

  // Big wheel stations in inclined orbits.
  const stations = [0, 1, 2].map((i) => {
    const s = createStation();
    group.add(s);
    return { s, r: 1.5 + i * 0.12, inc: 0.4 + i * 0.35, node: i * 2.1, speed: 0.05 - i * 0.012, phase: i * 2 };
  });

  // Satellites: blinking points in random orbits.
  const SATS = 320;
  const sats = glowPoints(SATS);
  const satOrbits = Array.from({ length: SATS }, () => ({
    r: 1.03 + Math.pow(rand(), 1.5) * 0.35,
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI * 2, 0)),
    phase: rand() * Math.PI * 2,
    blink: rand() * 10,
  }));
  group.add(sats);

  // Traffic: shuttles with engine trails, and elevator climbers.
  const SHIPS = 170;
  const TRAIL = 10;
  const CLIMBERS = 18;
  const traffic = glowPoints(SHIPS * TRAIL + CLIMBERS);
  group.add(traffic);
  const ships = Array.from({ length: SHIPS }, () => ({ u: rand(), route: null }));

  function newRoute(ship) {
    let a = cityPos[Math.floor(rand() * cityPos.length)];
    let b;
    let arc;
    if (rand() < 0.45) {
      // Up to the ring, above the nearest point of the equator.
      const lon = Math.atan2(-a.z, a.x);
      b = new THREE.Vector3(Math.cos(lon) * RING_R, 0, -Math.sin(lon) * RING_R);
      arc = 0.08;
    } else {
      b = cityPos[Math.floor(rand() * cityPos.length)];
      arc = 0.05 + a.distanceTo(b) * 0.12;
    }
    if (rand() < 0.5) [a, b] = [b, a];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const lift = mid.length() < 0.2 ? a.clone().normalize() : mid.clone().normalize();
    const ctrl = lift.multiplyScalar(Math.max(a.length(), b.length()) + arc);
    ship.route = { a, b, ctrl, dur: 5 + rand() * 9, hue: rand() };
    ship.u = 0;
  }

  const bez = (r, u, out) => {
    const k = 1 - u;
    return out.set(0, 0, 0).addScaledVector(r.a, k * k).addScaledVector(r.ctrl, 2 * k * u).addScaledVector(r.b, u * u);
  };

  const p = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const engine = new THREE.Color();

  return {
    texture,
    cityCount: cities.length,
    update(dt, t, civ) {
      group.visible = civ > 0.01;
      if (!group.visible) return;

      // Ring grows around the planet, then elevators and big stations appear.
      const ringK = range(civ, 0.45, 0.8);
      const built = Math.round(ringK * 200) / 200;
      if (built !== builtRing) {
        builtRing = built;
        ring.geometry.dispose();
        ring.geometry = ringGeometry(built);
      }
      ring.visible = ringK > 0;
      strip.visible = modules.visible = ringK >= 1;
      stripMat.opacity = 0.5 + 0.35 * Math.sin(t * 0.8) ** 2;
      const elevK = range(civ, 0.55, 0.85);
      for (const { m } of tethers) {
        m.visible = elevK > 0;
        m.scale.y = Math.max(0.001, elevK);
      }
      const stationK = range(civ, 0.6, 0.9);
      for (const st of stations) {
        st.s.visible = stationK > 0;
        st.s.scale.setScalar(Math.max(0.001, stationK));
        const a = st.phase + t * st.speed;
        p.set(Math.cos(a) * st.r, 0, -Math.sin(a) * st.r);
        tmpQ.setFromEuler(new THREE.Euler(st.inc, st.node, 0));
        st.s.position.copy(p.applyQuaternion(tmpQ));
        st.s.lookAt(0, 0, 0);
        st.s.rotateZ(t * 0.4);
      }

      // Satellites.
      const sp = sats.geometry.attributes.position.array;
      const sc = sats.geometry.attributes.aColor.array;
      const ss = sats.geometry.attributes.aSize.array;
      const satCount = Math.floor(range(civ, 0.1, 0.9) * SATS);
      for (let i = 0; i < SATS; i++) {
        const o = satOrbits[i];
        const a = o.phase + t * 0.35 * o.r ** -1.5;
        p.set(Math.cos(a) * o.r, 0, Math.sin(a) * o.r).applyQuaternion(o.q);
        sp.set([p.x, p.y, p.z], i * 3);
        const on = i < satCount ? 1 : 0;
        const blink = Math.sin(t * 3 + o.blink) > 0.93 ? 1.6 : 0.55;
        sc.set([0.8 * blink * on, 0.9 * blink * on, 1.0 * blink * on], i * 3);
        ss[i] = 2.2 * on;
      }
      sats.geometry.attributes.position.needsUpdate = true;
      sats.geometry.attributes.aColor.needsUpdate = true;
      sats.geometry.attributes.aSize.needsUpdate = true;

      // Shuttles along their arcs, each with a fading trail.
      const tp = traffic.geometry.attributes.position.array;
      const tc = traffic.geometry.attributes.aColor.array;
      const ts = traffic.geometry.attributes.aSize.array;
      const active = Math.floor(range(civ, 0.2, 1) * SHIPS);
      for (let i = 0; i < SHIPS; i++) {
        const ship = ships[i];
        if (!ship.route) newRoute(ship);
        ship.u += dt / ship.route.dur;
        if (ship.u >= 1) newRoute(ship);
        const on = i < active ? 1 : 0;
        engine.setHSL(0.08 + ship.route.hue * 0.5, 0.8, 0.7);
        for (let k = 0; k < TRAIL; k++) {
          const u = Math.max(0, ship.u - k * 0.012);
          bez(ship.route, u, p);
          const j = i * TRAIL + k;
          tp.set([p.x, p.y, p.z], j * 3);
          const fade = (1 - k / TRAIL) ** 1.6 * on;
          const head = k === 0 ? 1.6 : 1;
          tc.set([engine.r * fade * head, engine.g * fade * head, engine.b * fade * head], j * 3);
          ts[j] = (k === 0 ? 3.2 : 2.2 * (1 - k / TRAIL) + 0.6) * on;
        }
      }
      // Climbers riding the elevators up and down.
      for (let c = 0; c < CLIMBERS; c++) {
        const tether = tethers[c % tethers.length];
        const phase = (t * 0.03 + c * 0.37) % 1;
        const u = c % 2 ? phase : 1 - phase;
        p.lerpVectors(tether.base, tether.top, u * elevK);
        const j = SHIPS * TRAIL + c;
        tp.set([p.x, p.y, p.z], j * 3);
        const on = elevK > 0 ? 1 : 0;
        tc.set([1 * on, 0.85 * on, 0.6 * on], j * 3);
        ts[j] = 2.6 * on;
      }
      traffic.geometry.attributes.position.needsUpdate = true;
      traffic.geometry.attributes.aColor.needsUpdate = true;
      traffic.geometry.attributes.aSize.needsUpdate = true;
    },
  };
}
