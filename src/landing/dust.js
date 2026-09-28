import * as THREE from 'three';

// Rocket-blasted dust, in metres. Particles are thrown outward along the ground, loft a
// little, grow into soft billows and settle under Mars gravity (3.71 m/s², damped because
// fine dust rides the exhaust gas). Soft round sprites, normal blending.

const MARS_G = 3.71;

export function createDust({ groundColor, max = 3200 }) {
  const pos = new Float32Array(max * 3);
  const vel = new Float32Array(max * 3);
  const age = new Float32Array(max);
  const life = new Float32Array(max);
  const s0 = new Float32Array(max);
  const s1 = new Float32Array(max);
  const a0 = new Float32Array(max);
  const size = new Float32Array(max);
  const alpha = new Float32Array(max);
  const shade = new Float32Array(max);
  let head = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));

  const light = groundColor.clone().lerp(new THREE.Color(0.95, 0.72, 0.52), 0.45);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: light },
      scale: { value: 800 },
      fogColor: { value: new THREE.Color() },
      fogDensity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float scale;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aShade;
      varying float vAlpha;
      varying float vShade;
      varying float vDepth;
      void main() {
        vAlpha = aAlpha;
        vShade = aShade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_PointSize = min(aSize * scale / -mv.z, 520.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform vec3 fogColor;
      uniform float fogDensity;
      varying float vAlpha;
      varying float vShade;
      varying float vDepth;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p) * 2.0;
        if (d > 1.0) discard;
        float a = pow(1.0 - d, 1.6) * vAlpha;
        // Lighter on the sunlit upper side of each puff.
        vec3 c = color * vShade * (0.82 + 0.3 * (0.5 - p.y));
        float fog = 1.0 - exp(-fogDensity * fogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(c, fogColor, fog), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  function spawn(x, y, z, vx, vy, vz, lifeS, size0, size1, alpha0) {
    const i = head;
    head = (head + 1) % max;
    pos.set([x, y, z], i * 3);
    vel.set([vx, vy, vz], i * 3);
    age[i] = 0;
    life[i] = lifeS;
    s0[i] = size0;
    s1[i] = size1;
    a0[i] = alpha0;
    shade[i] = 0.75 + Math.random() * 0.35;
  }

  return {
    points,

    // Exhaust hitting the ground at (x, z): a radial sheet of dust. strength 0..1.
    blast(x, z, groundY, strength, dt) {
      const n = Math.floor(strength * 420 * dt + Math.random());
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (5 + Math.random() * 13) * Math.sqrt(strength);
        const r = Math.random() * 1.2;
        spawn(
          x + Math.cos(a) * r, groundY + 0.1, z + Math.sin(a) * r,
          Math.cos(a) * sp, 0.6 + Math.random() * 3.2 * strength, Math.sin(a) * sp,
          2.5 + Math.random() * 3.5, 0.4 + Math.random() * 0.5, 3 + Math.random() * 6, 0.16 + 0.2 * strength
        );
      }
    },

    // A quick ring of dust, e.g. wheels touching down.
    puff(x, y, z, count, speed) {
      for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * (0.4 + Math.random() * 0.8);
        spawn(x, y, z, Math.cos(a) * sp, 0.3 + Math.random() * 0.8, Math.sin(a) * sp, 1.5 + Math.random() * 1.5, 0.2, 1.2 + Math.random(), 0.35);
      }
    },

    // A distant rising column (the descent stage crashing far away).
    column(x, y, z, count) {
      for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 4 + Math.random() * 10;
        spawn(x, y, z, Math.cos(a) * sp, 6 + Math.random() * 16, Math.sin(a) * sp, 5 + Math.random() * 4, 4, 18 + Math.random() * 20, 0.5);
      }
    },

    update(dt, camera, height, viewportHeight, fog) {
      material.uniforms.scale.value = (viewportHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(window.devicePixelRatio, 2);
      material.uniforms.fogColor.value.copy(fog.color);
      material.uniforms.fogDensity.value = fog.density;
      const drag = Math.exp(-dt * 1.1);
      for (let i = 0; i < max; i++) {
        if (life[i] === 0) continue;
        age[i] += dt;
        if (age[i] >= life[i]) {
          life[i] = 0;
          alpha[i] = 0;
          continue;
        }
        const j = i * 3;
        vel[j + 1] -= MARS_G * 0.35 * dt;
        vel[j] *= drag;
        vel[j + 1] *= drag;
        vel[j + 2] *= drag;
        pos[j] += vel[j] * dt;
        pos[j + 1] += vel[j + 1] * dt;
        pos[j + 2] += vel[j + 2] * dt;
        const gy = height(pos[j], pos[j + 2]);
        if (pos[j + 1] < gy + 0.05) {
          pos[j + 1] = gy + 0.05;
          vel[j + 1] = Math.abs(vel[j + 1]) * 0.15;
        }
        const k = age[i] / life[i];
        size[i] = s0[i] + (s1[i] - s0[i]) * Math.sqrt(k);
        alpha[i] = a0[i] * Math.min(1, age[i] / 0.25) * (1 - k) ** 1.5;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aShade.needsUpdate = true;
    },
  };
}
