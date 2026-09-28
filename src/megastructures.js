import * as THREE from 'three';
import { latLonToVec3 } from './planet.js';

// The far end of the civilization stage: what a Kardashev Type I civilization around Mars
// might look like, drawn from the usual technosignature and megastructure ideas:
//  - Magnetic shield (NASA's 2017 Mars L1 dipole concept): visible field lines with energy
//    pulses flowing along them, and aurora curtains over both poles.
//  - Space solar power: a swarm of collectors in orbit beaming power down to cities.
//  - O'Neill cylinders: rotating habitats with window strips and angled mirrors.
//  - Clarke exobelt: a dense belt of satellites at areostationary orbit (~6.03 Mars radii),
//    co-rotating with the planet, as proposed as a detectable technosignature.
//  - Olympus Mons mass driver launching payloads to orbit, a Phobos space dock, and
//    interplanetary ships leaving with long drive trails.
// Each part reveals over its own slice of civ (0..1).

const AREOSTATIONARY_R = 6.03;
const range = (x, a, b) => THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);

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

function glowPoints(count, sizeScale = 2.4, minScale = 0.4) {
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
        gl_PointSize = aSize * pixelRatio * clamp(${sizeScale.toFixed(2)} / -mv.z, ${minScale.toFixed(2)}, 3.5);
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

// ---------- magnetic shield: dipole field lines + auroras ----------
function createFieldLines() {
  const pos = [];
  const along = [];
  for (const L of [1.45, 1.8, 2.25, 2.8]) {
    const lmax = Math.acos(Math.sqrt(1.03 / L));
    for (let k = 0; k < 14; k++) {
      const lon = (k / 14) * Math.PI * 2 + L;
      let prev = null;
      const N = 90;
      for (let i = 0; i <= N; i++) {
        const lat = -lmax + (2 * lmax * i) / N;
        const r = L * Math.cos(lat) ** 2; // dipole field line: r = L cos²(latitude)
        const p = [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon)];
        if (prev) {
          pos.push(...prev.p, ...p);
          along.push(prev.s, i / N);
        }
        prev = { p, s: i / N };
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, amount: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      varying float vAlong;
      varying float vFade;
      void main() {
        vAlong = aAlong;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Fade lines that pass close to the camera, or they smear across the screen.
        vFade = smoothstep(18.0, 3.0, -mv.z) * smoothstep(0.6, 1.6, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float amount;
      varying float vAlong;
      varying float vFade;
      void main() {
        // Energy pulses streaming pole to pole.
        float pulse = pow(0.5 + 0.5 * sin(vAlong * 40.0 - time * 3.0), 8.0);
        float a = (0.05 + pulse * 0.3) * amount * vFade;
        gl_FragColor = vec4(vec3(0.35, 0.7, 1.0) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}

function createAuroras(sunDir) {
  const pos = [];
  const uv = [];
  const idx = [];
  const N = 180;
  let base = 0;
  for (const hemi of [1, -1]) {
    for (let i = 0; i <= N; i++) {
      const lon = (i / N) * Math.PI * 2;
      // Slightly wavy oval around the magnetic pole.
      const lat = THREE.MathUtils.degToRad(68 + 3 * Math.sin(lon * 3) + 1.5 * Math.sin(lon * 7)) * hemi;
      const dir = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
      const lo = dir.clone().multiplyScalar(1.012);
      const hi = dir.clone().multiplyScalar(1.075);
      pos.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z);
      uv.push(i / N, 0, i / N, 1);
      if (i < N) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    base += (N + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, amount: { value: 0 }, sunDir },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float amount;
      uniform vec3 sunDir;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        float x = vUv.x * 120.0;
        // Rippling curtain: bright folds that drift, fading upward.
        float folds = 0.5 + 0.5 * sin(x + sin(x * 0.37 + time * 0.7) * 3.0 + time * 0.9);
        folds *= 0.6 + 0.4 * sin(x * 3.1 - time * 2.3);
        float height = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.6);
        vec3 col = mix(vec3(0.2, 1.0, 0.45), vec3(0.75, 0.3, 1.0), smoothstep(0.35, 0.9, vUv.y));
        float night = smoothstep(0.25, -0.2, dot(normalize(vWorld), sunDir));
        float a = folds * height * amount * (0.25 + 0.75 * night) * 0.9;
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(geo, mat);
}

// ---------- O'Neill cylinder habitat ----------
function createHabitat() {
  const g = new THREE.Group();
  const spinner = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xcfcac2, metalness: 0.55, roughness: 0.4 });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xbfe3ff });
  const R = 0.012;
  const L = 0.07;
  spinner.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 24, 1), hull));
  for (const end of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(R, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hull);
    cap.position.y = (end * L) / 2;
    if (end < 0) cap.rotation.x = Math.PI;
    spinner.add(cap);
  }
  // Three long window strips alternate with three land strips, as in O'Neill's design.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.0055, L * 0.92, 0.0006), windowMat);
    strip.position.set(Math.cos(a) * (R + 0.0002), 0, Math.sin(a) * (R + 0.0002));
    strip.rotation.y = -a + Math.PI / 2;
    spinner.add(strip);
  }
  g.add(spinner);
  // Mirrors hinged at one end, angled to throw sunlight into the windows.
  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xaab8c8, metalness: 1, roughness: 0.08, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const hinge = new THREE.Group();
    hinge.position.set(Math.cos(a) * R, -L / 2, Math.sin(a) * R);
    hinge.rotation.y = -a;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.0065, L * 0.9).translate(0, (L * 0.9) / 2, 0), mirrorMat);
    m.rotation.z = -0.5; // opened outward
    hinge.add(m);
    g.add(hinge);
  }
  return { group: g, spinner };
}

export function createMegastructures({ scene, planet, spin, cities, sunDir, phobos }) {
  const rand = mulberry(9001);
  const root = new THREE.Group();
  scene.add(root);

  // --- magnetic shield ---
  const field = createFieldLines();
  const auroras = createAuroras(sunDir);
  planet.add(field, auroras);

  // --- solar power swarm ---
  const SWARM = 520;
  const panelGeo = new THREE.BoxGeometry(0.022, 0.0006, 0.013);
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x2a4a8a, metalness: 0.5, roughness: 0.3, emissive: 0x0a1630 });
  const swarm = new THREE.InstancedMesh(panelGeo, panelMat, SWARM);
  swarm.frustumCulled = false;
  const swarmOrbits = Array.from({ length: SWARM }, () => ({
    r: 1.65 + rand() * 0.9,
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.6, rand() * Math.PI * 2, (rand() - 0.5) * 0.6)),
    phase: rand() * Math.PI * 2,
  }));
  root.add(swarm);
  const swarmGlints = glowPoints(SWARM, 2.0);
  root.add(swarmGlints);

  // --- power beams from collectors to cities ---
  const BEAMS = 10;
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BEAMS * 2 * 3), 3));
  beamGeo.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(BEAMS * 2), 1));
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, amount: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aEnd;
      varying float vEnd;
      varying float vNear;
      void main() {
        vEnd = aEnd;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNear = smoothstep(0.8, 1.8, -mv.z); // hide beam segments right in front of the camera
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float amount;
      varying float vEnd;
      varying float vNear;
      void main() {
        float pulse = 0.55 + 0.45 * sin(vEnd * 30.0 - time * 8.0);
        float a = amount * pulse * (0.2 + 0.6 * vEnd) * vNear;
        gl_FragColor = vec4(vec3(0.75, 0.55, 1.0) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const beams = new THREE.LineSegments(beamGeo, beamMat);
  beams.frustumCulled = false;
  root.add(beams);
  const beamLinks = Array.from({ length: BEAMS }, (_, i) => ({ panel: Math.floor(rand() * SWARM), city: i % cities.length }));

  // --- O'Neill habitats ---
  const habitats = [0, 1, 2, 3].map((i) => {
    const h = createHabitat();
    root.add(h.group);
    return { ...h, r: 2.2 + i * 0.22, inc: (i - 1.5) * 0.25, phase: i * 1.7, speed: 0.03 - i * 0.004 };
  });

  // --- Clarke exobelt at areostationary orbit: co-rotates with the planet ---
  const BELT = 2600;
  const belt = glowPoints(BELT, 3.0, 0.9); // keeps its size from far away, where it's seen
  {
    const p = belt.geometry.attributes.position.array;
    const c = belt.geometry.attributes.aColor.array;
    const s = belt.geometry.attributes.aSize.array;
    for (let i = 0; i < BELT; i++) {
      const a = rand() * Math.PI * 2;
      const r = AREOSTATIONARY_R + (rand() - 0.5) * 0.05;
      p.set([Math.cos(a) * r, (rand() - 0.5) * 0.03, -Math.sin(a) * r], i * 3);
      const b = 0.8 + rand() * 0.6;
      c.set([0.85 * b, 0.92 * b, 1.0 * b], i * 3);
      s[i] = 1.6 + rand() * 1.4;
    }
  }
  spin.add(belt);

  // --- Olympus Mons mass driver: a track up the flank, payloads launched to orbit ---
  const trackStart = latLonToVec3(15.2, -141.5, 1.004);
  const trackEnd = latLonToVec3(18.65, -133.8, 1.0065);
  const trackMat = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const track = new THREE.Line(new THREE.BufferGeometry().setFromPoints([trackStart, trackEnd]), trackMat);
  spin.add(track);
  const LAUNCHES = 6;
  const LAUNCH_TRAIL = 14;
  const launches = glowPoints(LAUNCHES * LAUNCH_TRAIL, 2.2);
  spin.add(launches);
  const launchDir = trackEnd.clone().sub(trackStart).normalize();

  // --- interplanetary ships leaving with long drive trails ---
  const SHIPS = 10;
  const SHIP_TRAIL = 36;
  const ships = glowPoints(SHIPS * SHIP_TRAIL, 2.6);
  root.add(ships);
  const shipRoutes = Array.from({ length: SHIPS }, () => ({
    dir: new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 0.4, rand() - 0.5).normalize(),
    start: rand() * Math.PI * 2,
    t0: rand() * 20,
  }));

  // --- Phobos space dock ---
  const dock = new THREE.Group();
  if (phobos) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.0022, 8, 64), new THREE.MeshStandardMaterial({ color: 0xd6d2cc, metalness: 0.6, roughness: 0.35 }));
    ring.rotation.x = Math.PI / 2;
    dock.add(ring);
    const lights = glowPoints(60, 1.8);
    const p = lights.geometry.attributes.position.array;
    const c = lights.geometry.attributes.aColor.array;
    const s = lights.geometry.attributes.aSize.array;
    for (let i = 0; i < 60; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(i < 40 ? 0.024 : 0.045);
      if (i >= 40) v.y = 0;
      p.set([v.x, v.y, v.z], i * 3);
      c.set([1, 0.75, 0.45], i * 3);
      s[i] = 2.2;
    }
    dock.add(lights);
    phobos.add(dock);
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const w = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const hidden = new THREE.Vector3(1e-4, 1e-4, 1e-4); // not yet built
  const cityWorld = cities.map(() => new THREE.Vector3());

  return {
    update(dt, t, civ) {
      const shieldK = range(civ, 0.6, 0.75);
      const swarmK = range(civ, 0.66, 0.85);
      const beamK = range(civ, 0.75, 0.9);
      const driverK = range(civ, 0.7, 0.8);
      const habitatK = range(civ, 0.8, 0.95);
      const beltK = range(civ, 0.82, 1);
      const shipK = range(civ, 0.9, 1);
      const dockK = range(civ, 0.85, 1);

      field.visible = shieldK > 0;
      field.material.uniforms.amount.value = shieldK;
      field.material.uniforms.time.value = t;
      auroras.visible = shieldK > 0;
      auroras.material.uniforms.amount.value = shieldK;
      auroras.material.uniforms.time.value = t;

      // Swarm: panels face the Sun, a few glint.
      swarm.visible = swarmGlints.visible = swarmK > 0;
      if (swarm.visible) {
        const shown = Math.floor(swarmK * SWARM);
        const gp = swarmGlints.geometry.attributes.position.array;
        const gc = swarmGlints.geometry.attributes.aColor.array;
        const gs = swarmGlints.geometry.attributes.aSize.array;
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir.value);
        for (let i = 0; i < SWARM; i++) {
          const o = swarmOrbits[i];
          const a = o.phase + t * 0.25 * o.r ** -1.5;
          v.set(Math.cos(a) * o.r, 0, Math.sin(a) * o.r).applyQuaternion(o.q);
          m4.compose(v, q, i < shown ? one : hidden);
          swarm.setMatrixAt(i, m4);
          gp.set([v.x, v.y, v.z], i * 3);
          const glint = i < shown && Math.sin(t * 1.3 + i * 12.9) > 0.985 ? 1 : 0;
          gc.set([glint, glint * 0.95, glint * 0.85], i * 3);
          gs[i] = glint * 4;
        }
        swarm.instanceMatrix.needsUpdate = true;
        swarmGlints.geometry.attributes.position.needsUpdate = true;
        swarmGlints.geometry.attributes.aColor.needsUpdate = true;
        swarmGlints.geometry.attributes.aSize.needsUpdate = true;
      }

      // Power beams: each link picks a city on the collector's side of the planet.
      beams.visible = beamK > 0;
      if (beams.visible) {
        beamMat.uniforms.amount.value = beamK;
        beamMat.uniforms.time.value = t;
        spin.updateMatrixWorld();
        cities.forEach((c, i) => spin.localToWorld(cityWorld[i].copy(c)));
        const bp = beamGeo.attributes.position.array;
        const be = beamGeo.attributes.aEnd.array;
        beamLinks.forEach((link, i) => {
          const o = swarmOrbits[link.panel];
          const a = o.phase + t * 0.25 * o.r ** -1.5;
          v.set(Math.cos(a) * o.r, 0, Math.sin(a) * o.r).applyQuaternion(o.q);
          let target = cityWorld[link.city];
          if (target.clone().normalize().dot(w.copy(v).normalize()) < 0.55) {
            // Re-aim at the city most directly below this collector.
            let best = -2;
            cityWorld.forEach((cw, j) => {
              const d = cw.clone().normalize().dot(w);
              if (d > best) {
                best = d;
                link.city = j;
              }
            });
            target = cityWorld[link.city];
          }
          bp.set([v.x, v.y, v.z, target.x, target.y, target.z], i * 6);
          be.set([0, 1], i * 2);
        });
        beamGeo.attributes.position.needsUpdate = true;
        beamGeo.attributes.aEnd.needsUpdate = true;
      }

      // Habitats: slow orbits, spinning for gravity.
      for (const h of habitats) {
        h.group.visible = habitatK > 0;
        if (!h.group.visible) continue;
        h.group.scale.setScalar(Math.max(0.001, habitatK) * 1.4);
        const a = h.phase + t * h.speed;
        v.set(Math.cos(a) * h.r, 0, Math.sin(a) * h.r).applyAxisAngle(new THREE.Vector3(1, 0, 0), h.inc);
        h.group.position.copy(v);
        h.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir.value);
        h.spinner.rotation.y = t * 0.6;
      }

      // Exobelt fades in; it is far out, so it mostly shows when zoomed out.
      belt.visible = beltK > 0;
      belt.material.opacity = beltK;
      if (belt.visible) {
        const s = belt.geometry.attributes.aSize.array;
        const count = Math.floor(beltK * BELT);
        for (let i = 0; i < BELT; i++) s[i] = i < count ? 1.6 + ((i * 7919) % 100) / 70 : 0;
        belt.geometry.attributes.aSize.needsUpdate = true;
      }

      // Mass driver launches: every ~2.4 s a payload races up the track and into orbit.
      track.visible = launches.visible = driverK > 0;
      trackMat.opacity = driverK * (0.55 + 0.45 * Math.sin(t * 6) ** 2);
      if (launches.visible) {
        const lp = launches.geometry.attributes.position.array;
        const lc = launches.geometry.attributes.aColor.array;
        const ls = launches.geometry.attributes.aSize.array;
        for (let i = 0; i < LAUNCHES; i++) {
          const u = ((t + i * 2.4) % (LAUNCHES * 2.4)) / 2.4; // 0..1 on the track, then flight
          for (let k = 0; k < LAUNCH_TRAIL; k++) {
            const uu = Math.max(0, u - k * 0.03);
            if (uu < 1) v.lerpVectors(trackStart, trackEnd, uu * uu);
            else v.copy(trackEnd).addScaledVector(launchDir, (uu - 1) * 0.5).addScaledVector(trackEnd.clone().normalize(), (uu - 1) ** 1.5 * 0.35);
            const j = i * LAUNCH_TRAIL + k;
            lp.set([v.x, v.y, v.z], j * 3);
            const f = (1 - k / LAUNCH_TRAIL) * (u < 3 ? 1 : 0) * driverK;
            lc.set([0.6 * f, 0.95 * f, 1.0 * f], j * 3);
            ls[j] = (k === 0 ? 3 : 1.8) * (f > 0 ? 1 : 0);
          }
        }
        launches.geometry.attributes.position.needsUpdate = true;
        launches.geometry.attributes.aColor.needsUpdate = true;
        launches.geometry.attributes.aSize.needsUpdate = true;
      }

      // Interplanetary ships: spiral out of orbit, then burn straight out of the system.
      ships.visible = shipK > 0;
      if (ships.visible) {
        const sp = ships.geometry.attributes.position.array;
        const sc = ships.geometry.attributes.aColor.array;
        const ss = ships.geometry.attributes.aSize.array;
        shipRoutes.forEach((r, i) => {
          const life = ((t + r.t0) % 20) / 20;
          for (let k = 0; k < SHIP_TRAIL; k++) {
            const u = Math.max(0, life - k * 0.006);
            const dist = 1.35 + u * u * 16;
            const swirl = r.start + (1 - u) * 1.2;
            v.set(Math.cos(swirl), 0, Math.sin(swirl)).multiplyScalar(1.35).lerp(r.dir.clone().multiplyScalar(dist), Math.min(1, u * 2.5));
            const j = i * SHIP_TRAIL + k;
            sp.set([v.x, v.y, v.z], j * 3);
            const f = (1 - k / SHIP_TRAIL) ** 1.3 * shipK * (life < 0.92 ? 1 : 0);
            sc.set([0.55 * f, 0.75 * f, 1.0 * f], j * 3);
            ss[j] = k === 0 ? 3.4 : 2.2;
          }
        });
        ships.geometry.attributes.position.needsUpdate = true;
        ships.geometry.attributes.aColor.needsUpdate = true;
        ships.geometry.attributes.aSize.needsUpdate = true;
      }

      dock.visible = dockK > 0;
      dock.scale.setScalar(Math.max(0.001, dockK));
      dock.rotation.y = t * 0.2;
    },
  };
}
