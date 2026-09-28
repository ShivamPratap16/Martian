import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createLandingWorld } from './world.js';
import { createRover } from './rover.js';
import { createSkyCrane } from './skycrane.js';
import { createDust } from './dust.js';

// The ground-level landing, directed like a film: a sky-crane descent modelled on
// Perseverance (Feb 2021), timed ~3x faster than the real thing, shot in three angles.
//
// Timeline (seconds):
//   0.0  powered descent from ~70 m, braking hard
//   3.2  sky-crane manoeuvre: stage at 21 m lowers the rover 7.5 m on three bridles
//   7.4  touchdown, 7.75 cables cut, stage flies away and crashes far off
//   9.6  mast up, flag with the claimer's logo unfurls
//  13.4  end

const T = { skycrane: 3.2, lowered: 5.2, touch: 7.4, cut: 7.75, mast: 8.4, flag: 9.6, flagDone: 11.2, end: 13.4 };
const BRIDLE = 7.5;
const ROVER_TOP = 1.22; // attach height on the rover
const START_ALT = 70;
const SHOTS = [
  { until: 4.2, name: 'A' },
  { until: 8.9, name: 'B' },
  { until: Infinity, name: 'C' },
];

const gradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform vec2 res;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb *= vec3(1.04, 1.0, 0.94);                       // warm grade
      float v = smoothstep(0.95, 0.3, length(vUv - 0.5) * 1.3);
      c.rgb *= mix(0.5, 1.0, v);                             // vignette
      float g = fract(sin(dot(floor(vUv * res) + fract(time) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (g - 0.5) * 0.04 * (0.25 + c.rgb);            // film grain
      gl_FragColor = c;
    }`,
};

const ease = (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x) => 1 - (1 - x) ** 3;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const range = (t, a, b) => clamp01((t - a) / (b - a));

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Altitude of the descent stage's underside above the landing point.
function stageAltitude(t) {
  const touchAlt = BRIDLE + ROVER_TOP;
  if (t < T.skycrane) return 21 + (START_ALT - 21) * (1 - t / T.skycrane) ** 2.4;
  if (t < T.touch) return 21 + (touchAlt - 21) * ((t - T.skycrane) / (T.touch - T.skycrane));
  return touchAlt - Math.min(t - T.touch, T.cut - T.touch) * 0.75;
}

function bridleLength(t) {
  return 0.05 + (BRIDLE - 0.05) * ease(range(t, T.skycrane, T.lowered));
}

function throttleAt(t) {
  if (t < 1.1) return 0.55;
  if (t < T.skycrane) return 0.55 + 0.4 * range(t, 1.1, 1.8);
  if (t < T.touch) return 0.72;
  if (t < T.cut) return 0.5;
  if (t < T.cut + 3.2) return 1;
  return 0;
}

export function createLandingSequence(renderer) {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 6000);
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(new THREE.Scene(), camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.6, 0.95);
  const grade = new ShaderPass(gradeShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  const hud = { visible: false, phase: '', alt: 0, vel: 0, clock: 0 };
  let s = null; // current run

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    grade.uniforms.res.value.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function cable(mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), mat);
    m.castShadow = true;
    return m;
  }
  const up = new THREE.Vector3(0, 1, 0);
  function setCable(m, a, b, r) {
    const d = new THREE.Vector3().subVectors(b, a);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.scale.set(r, d.length(), r);
    m.quaternion.setFromUnitVectors(up, d.normalize());
  }

  return {
    camera,
    hud,
    get fade() {
      return s ? s.fade : 0;
    },

    // Builds the site (a few hundred ms), so call it while the orbit dive is playing.
    async prepare({ cell, groundColor, logoSrc, title }) {
      const logoImg = logoSrc ? await loadImage(logoSrc) : null;
      const world = createLandingWorld(renderer, { seed: hash(cell), groundColor });
      const rover = createRover({ logoImg, title });
      const crane = createSkyCrane();
      const dust = createDust({ groundColor });
      const cableMat = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6 });
      const cables = [0, 1, 2].map(() => cable(cableMat));
      const umbilical = cable(new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.6, roughness: 0.4 }));
      world.scene.add(rover.group, crane.group, dust.points, ...cables, umbilical);
      renderPass.scene = world.scene;
      s = {
        t: 0, world, rover, crane, dust, cables, umbilical, title,
        fade: 1, events: new Set(), look: new THREE.Vector3(0, 60, 0), shake: 0,
        crashAt: null, flyVel: new THREE.Vector3(), prevAlt: null,
      };
      rover.setDeploy(0);
      rover.setMast(0);
      rover.setFlag(0);
    },

    // Advances and renders one frame. Calls on(event) for sound cues; returns false when finished.
    update(dt, on = () => {}) {
      if (!s) return false;
      const { world, rover, crane, dust } = s;
      const t = (s.t += dt);
      const once = (name) => !s.events.has(name) && s.events.add(name);

      // ---- descent stage ----
      const alt = stageAltitude(t);
      const sway = t < T.touch ? 1 : 0;
      if (t < T.cut) {
        crane.group.position.set(Math.sin(t * 0.7) * 0.25 * sway, alt, Math.cos(t * 0.5) * 0.2 * sway);
        crane.group.rotation.set(Math.sin(t * 1.3) * 0.015, t * 0.02, Math.cos(t * 1.1) * 0.015);
      } else {
        // Fly-away: full throttle, pitch over and head off to crash a safe distance away.
        if (once('cut')) {
          s.flyDir = new THREE.Vector3(-0.55, 0.75, -0.4).normalize();
          on('snap');
        }
        const k = t - T.cut;
        s.flyVel.addScaledVector(s.flyDir, 11 * dt);
        if (k > 2.5) s.flyVel.y -= 3.71 * dt; // engines cut out: falls toward its crash site
        crane.group.position.addScaledVector(s.flyVel, dt);
        const tilt = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(s.flyDir.x, 1.4, s.flyDir.z).normalize());
        crane.group.quaternion.slerp(tilt, Math.min(1, dt * 1.5));
        if (k > 4.2 && once('crash')) {
          const far = new THREE.Vector3(s.flyDir.x, 0, s.flyDir.z).normalize().multiplyScalar(650);
          s.crashAt = far;
          dust.column(far.x, world.height(far.x, far.z), far.z, 90);
        }
      }
      const throttle = throttleAt(t);
      crane.setThrottle(throttle, t);

      // ---- rover ----
      const hanging = t < T.touch;
      const roverY = hanging ? alt - bridleLength(t) - ROVER_TOP : 0;
      const settle = hanging ? 0 : -0.05 * Math.sin(Math.PI * clamp01((t - T.touch) / 0.4));
      rover.group.position.set(hanging ? crane.group.position.x : rover.group.position.x, roverY + settle, hanging ? crane.group.position.z : rover.group.position.z);
      rover.group.rotation.set(Math.sin(t * 2.1) * 0.03 * sway * range(t, T.skycrane, T.lowered), 0, Math.cos(t * 1.7) * 0.025 * sway * range(t, T.skycrane, T.lowered));
      rover.setDeploy(range(t, T.skycrane + 0.5, T.lowered + 1.2));
      rover.setMast(range(t, T.mast, T.mast + 1.3));
      rover.setFlag(range(t, T.flag, T.flagDone));
      rover.update(t);
      if (t >= T.touch && once('touch')) {
        on('thud');
        s.shake = 1;
        for (const x of [-1.15, 1.15]) for (const z of [1, 0.05, -0.9]) dust.puff(rover.group.position.x + x, 0.1, rover.group.position.z + z, 14, 3);
      }
      if (t >= T.flag && once('flag')) on('whoosh');

      // ---- bridles and umbilical ----
      const showCables = t >= T.skycrane - 0.05 && t < T.cut;
      s.cables.forEach((c, i) => {
        c.visible = showCables;
        if (!showCables) return;
        const a = crane.group.localToWorld(crane.attachPoints[i].clone());
        const b = rover.group.localToWorld(rover.attachPoints[i].clone());
        setCable(c, a, b, 0.012);
      });
      s.umbilical.visible = showCables;
      if (showCables) {
        const a = crane.group.localToWorld(new THREE.Vector3(0.1, 0, 0));
        const b = rover.group.localToWorld(new THREE.Vector3(0.1, ROVER_TOP, 0.1));
        setCable(s.umbilical, a, b.add(new THREE.Vector3(0.25, 0, 0)), 0.02);
      }

      // ---- dust where each engine's exhaust hits the ground ----
      for (const exit of crane.nozzleExits) {
        const p = crane.group.localToWorld(exit.clone());
        const hitX = p.x * 1.1;
        const hitZ = p.z * 1.1;
        const gy = world.height(hitX, hitZ);
        const strength = throttle * clamp01(1 - (p.y - gy) / 30) ** 1.4;
        if (strength > 0.01) dust.blast(hitX, hitZ, gy, strength, dt);
      }
      dust.update(dt, camera, world.height, window.innerHeight, world.scene.fog);

      // ---- camera: three shots with hard cuts ----
      const shot = SHOTS.find((x) => t < x.until).name;
      if (shot !== s.shot) {
        s.shot = shot;
        s.look = null; // cut: snap to the new framing
      }
      const target = new THREE.Vector3();
      if (shot === 'A') {
        // From the ground with a longer lens: look up at the incoming vehicle, then tilt
        // down with it until the horizon comes into frame.
        camera.fov = 32;
        camera.position.set(22, world.height(22, 46) + 1.7, 46);
        target.copy(crane.group.position);
        target.y = crane.group.position.y * 0.72 + 1;
      } else if (shot === 'B') {
        // Low and close as the rover is lowered into the dust.
        camera.fov = 46;
        camera.position.set(-8.5, world.height(-8.5, 12.5) + 1.1, 12.5);
        const ry = rover.group.position.y;
        target.set(rover.group.position.x, ry + 1.6 + Math.min(4, (alt - ry) * 0.25), rover.group.position.z);
      } else {
        // Slow orbit around the rover while the mast rises and the flag goes up.
        const k = t - SHOTS[1].until;
        const a = 0.5 + k * 0.075;
        const r = 6.3 - k * 0.14;
        camera.fov = 40;
        camera.position.set(0.6 + Math.sin(a) * r, 1.3 + k * 0.08, Math.cos(a) * r);
        camera.position.y += world.height(camera.position.x, camera.position.z);
        target.set(0.6, 1.15 + 0.35 * range(t, T.flag, T.flagDone), -0.2);
      }
      s.look = s.look ? s.look.lerp(target, Math.min(1, dt * 4)) : target.clone();

      // Handheld feel, rocket vibration when close, a jolt at touchdown.
      s.shake = Math.max(0, s.shake - dt * 2.2);
      const near = clamp01(1 - camera.position.distanceTo(crane.group.position) / 60);
      const amp = 0.012 + throttle * near * 0.05 + s.shake * 0.12;
      const jitter = new THREE.Vector3(Math.sin(t * 13.1) + Math.sin(t * 7.3), Math.sin(t * 11.7) + Math.cos(t * 5.1), Math.cos(t * 9.4)).multiplyScalar(amp * 0.5);
      camera.position.add(jitter.clone().multiplyScalar(0.3));
      camera.updateProjectionMatrix();
      camera.lookAt(s.look.clone().add(jitter));
      on('thrust', throttle * clamp01(1 - camera.position.distanceTo(crane.group.position) / 90) ** 0.7);

      // ---- telemetry for the overlay ----
      const roverAlt = Math.max(0, rover.group.position.y);
      const vel = s.prevAlt === null ? 0 : Math.max(0, (s.prevAlt - roverAlt) / dt);
      s.prevAlt = roverAlt;
      hud.visible = t < T.end - 0.3;
      hud.clock = t;
      hud.alt = roverAlt;
      hud.vel = hud.vel + (vel - hud.vel) * Math.min(1, dt * 6);
      hud.phase =
        t < T.skycrane ? 'POWERED DESCENT'
        : t < T.touch ? 'SKY CRANE MANEUVER'
        : t < T.cut + 0.3 ? 'TOUCHDOWN CONFIRMED'
        : t < T.flag ? 'FLYAWAY · SAFE ON MARS'
        : `${s.title.toUpperCase()} HAS LANDED`;
      hud.showNumbers = t < T.touch + 1.2;

      // Fade in from the entry haze, fade out at the end.
      s.fade = Math.max(1 - t / 0.6, clamp01((t - (T.end - 0.7)) / 0.7));

      grade.uniforms.time.value = t;
      composer.render(dt);
      if (t >= T.end) {
        hud.visible = false;
        return false;
      }
      return true;
    },

    dispose() {
      if (!s) return;
      s.world.dispose();
      s.dust.points.geometry.dispose();
      s = null;
      renderPass.scene = new THREE.Scene();
    },
  };
}
