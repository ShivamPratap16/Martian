import * as THREE from 'three';
import { cellToLatLng } from 'h3-js';
import { latLonToVec3, GRID_RADIUS } from './planet.js';

// The claim moment: a lander drops onto the plot on a retro-rocket, kicks up a ring of
// dust at touchdown and shakes the camera a little. Everything is scaled for a camera
// hovering ~0.3 planet radii above the surface.

const DESCENT = 2.3; // seconds from start to touchdown
const LANDER_SIZE = 0.009;
const START_ALT = 0.13;
const DUST_COUNT = 260;
const DUST_LIFE = 2.2;

function buildLander() {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9d4cf, metalness: 0.6, roughness: 0.35, emissive: 0x2a2320 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.3, emissive: 0x2a1c05 });
  const s = LANDER_SIZE;
  // Local +Y points away from the planet.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.45, s * 0.6, s * 0.7, 16), gold);
  body.position.y = s * 0.75;
  const top = new THREE.Mesh(new THREE.ConeGeometry(s * 0.45, s * 0.55, 16), metal);
  top.position.y = s * 1.37;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.75, s * 0.75, s * 0.12, 16), metal);
  deck.position.y = s * 0.38;
  group.add(body, top, deck);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.05, s * 0.05, s * 0.55, 6), metal);
    leg.position.set(Math.cos(a) * s * 0.62, s * 0.18, Math.sin(a) * s * 0.62);
    leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.14, s * 0.14, s * 0.04, 10), metal);
    foot.position.set(Math.cos(a) * s * 0.78, 0, Math.sin(a) * s * 0.78);
    group.add(leg, foot);
  }
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(s * 0.32, s * 1.6, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffa04a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  flame.rotation.x = Math.PI; // point down
  flame.position.y = s * 0.3 - s * 0.8;
  const glow = new THREE.PointLight(0xff8a3d, 0, s * 30, 1.5);
  glow.position.y = -s * 0.2;
  group.add(flame, glow);
  return { group, flame, glow };
}

function buildDust() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_COUNT * 3), 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(DUST_COUNT), 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      uniform float pixelRatio;
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = pixelRatio * clamp(9.0 / -mv.z, 3.0, 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(0.86, 0.58, 0.38) * (0.6 + 0.4 * (1.0 - d)), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

function buildShockwave() {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xffd2a8, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  return mesh;
}

const easeOutCubic = (x) => 1 - (1 - x) ** 3;

export function createLanding(parent) {
  const lander = buildLander();
  const dust = buildDust();
  const ring = buildShockwave();
  const root = new THREE.Group(); // oriented so local +Y is the surface normal at the plot
  root.add(lander.group, dust, ring);
  root.visible = false;
  parent.add(root);

  const vel = new Float32Array(DUST_COUNT * 3);
  const shake = new THREE.Vector3();
  let t = null; // seconds since the descent started; null when idle
  let dustStarted = false;
  let onTouchdown = null;
  let resolveDone = null;

  function place(cell) {
    const [la, lo] = cellToLatLng(cell);
    const n = latLonToVec3(la, lo, 1).normalize();
    root.position.copy(n).multiplyScalar(GRID_RADIUS);
    root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  }

  function startDust() {
    const pos = dust.geometry.attributes.position.array;
    for (let i = 0; i < DUST_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = LANDER_SIZE * (0.2 + Math.random() * 0.5);
      pos.set([Math.cos(a) * r, Math.random() * LANDER_SIZE * 0.2, Math.sin(a) * r], i * 3);
      const speed = LANDER_SIZE * (2.5 + Math.random() * 5);
      vel.set([Math.cos(a) * speed, LANDER_SIZE * (0.5 + Math.random() * 2.5), Math.sin(a) * speed], i * 3);
    }
    dustStarted = true;
  }

  return {
    get active() {
      return t !== null;
    },

    // Plays the landing on `cell`. Calls touchdown() at the moment of impact, resolves when done.
    play(cell, { delay = 0, touchdown } = {}) {
      place(cell);
      t = -delay;
      dustStarted = false;
      onTouchdown = touchdown;
      root.visible = false;
      return new Promise((r) => (resolveDone = r));
    },

    // Advances the animation. Returns a camera shake offset to add for this frame.
    update(dt) {
      shake.set(0, 0, 0);
      if (t === null) return shake;
      t += dt;
      root.visible = t >= 0;
      if (t < 0) return shake;

      // Descent: fast at first, retro-rockets brake it to a soft landing.
      const k = Math.min(1, t / DESCENT);
      lander.group.position.y = START_ALT * (1 - easeOutCubic(k));
      const burn = k < 0.35 ? 0.3 : 1;
      const flick = 0.75 + Math.random() * 0.5;
      lander.flame.visible = k < 1;
      lander.flame.scale.set(1, burn * flick, 1);
      lander.flame.material.opacity = burn * 0.9;
      lander.glow.intensity = k < 1 ? burn * flick * 0.02 : 0;

      if (k >= 1 && !dustStarted) {
        startDust();
        onTouchdown?.();
      }

      // Dust ring and shockwave after touchdown.
      const since = t - DESCENT;
      if (dustStarted) {
        const pos = dust.geometry.attributes.position.array;
        const alpha = dust.geometry.attributes.aAlpha.array;
        const life = Math.min(1, since / DUST_LIFE);
        for (let i = 0; i < DUST_COUNT; i++) {
          const drag = Math.exp(-since * 2.2);
          pos[i * 3] += vel[i * 3] * dt * drag;
          pos[i * 3 + 1] = Math.max(0, pos[i * 3 + 1] + (vel[i * 3 + 1] * drag - LANDER_SIZE * 1.2 * since) * dt);
          pos[i * 3 + 2] += vel[i * 3 + 2] * dt * drag;
          alpha[i] = (1 - life) * 0.8;
        }
        dust.geometry.attributes.position.needsUpdate = true;
        dust.geometry.attributes.aAlpha.needsUpdate = true;

        const rk = Math.min(1, since / 0.9);
        const size = LANDER_SIZE * (0.5 + easeOutCubic(rk) * 5);
        ring.scale.setScalar(size);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = LANDER_SIZE * 0.05;
        ring.material.opacity = (1 - rk) * 0.7;
        ring.visible = rk < 1;

        if (since < 0.45) {
          const amp = 0.0035 * (1 - since / 0.45);
          shake.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
        }
      } else {
        ring.visible = false;
      }

      // The lander fades into the flag pin.
      if (since > 1.6) lander.group.scale.setScalar(Math.max(0.001, 1 - (since - 1.6) / 0.5));
      else lander.group.scale.setScalar(1);

      if (since > DUST_LIFE + 0.3) {
        root.visible = false;
        t = null;
        resolveDone?.();
        resolveDone = null;
      }
      return shake;
    },
  };
}
