import * as THREE from 'three';

// The descent stage ("sky crane"), ~3 m across, in metres. Origin is the bottom centre,
// where the bridles leave. Eight throttleable engines in four canted pods; their plumes
// are faint because Mars' thin air hardly glows, but they light the dust below.

const M = {
  gold: new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.34 }),
  ti: new THREE.MeshStandardMaterial({ color: 0xa3a7ab, metalness: 0.9, roughness: 0.26 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.7, roughness: 0.4 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe6e2dc, roughness: 0.6 }),
  nozzle: new THREE.MeshStandardMaterial({ color: 0x2c2a28, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function beam(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

const plumeMaterial = new THREE.ShaderMaterial({
  uniforms: { throttle: { value: 0 }, time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float throttle;
    uniform float time;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float along = vUv.y; // 1 at the nozzle, 0 at the far end
      float edge = pow(abs(dot(vNormal, vView)), 1.5);
      float flick = 0.85 + 0.15 * sin(time * 60.0 + vUv.x * 30.0);
      float a = pow(along, 2.2) * edge * throttle * flick;
      vec3 col = mix(vec3(1.0, 0.55, 0.25), vec3(0.95, 0.9, 1.0), pow(along, 6.0));
      gl_FragColor = vec4(col * a * 0.9, a);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
});

export function createSkyCrane() {
  const group = new THREE.Group();

  group.add(mesh(new THREE.BoxGeometry(1.3, 0.45, 1.3), M.gold, 0, 0.45, 0));
  group.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.06, 8), M.white, 0, 0.72, 0));
  group.add(mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.18, 12), M.frame, 0, 0.1, 0)); // bridle spool
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    group.add(mesh(new THREE.SphereGeometry(0.36, 24, 16), M.ti, Math.cos(a) * 0.82, 0.92, Math.sin(a) * 0.82));
  }
  // Octagonal frame with spokes.
  const ring = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ring.push(new THREE.Vector3(Math.cos(a) * 1.55, 0.5, Math.sin(a) * 1.55));
  }
  ring.forEach((p, i) => {
    group.add(beam(p, ring[(i + 1) % 8], 0.035, M.frame));
    group.add(beam(p, new THREE.Vector3(p.x * 0.4, 0.55, p.z * 0.4), 0.03, M.frame));
  });

  // Four engine pods on the diagonals, two nozzles each, canted outward.
  const plumes = [];
  const nozzleExits = []; // local positions, used to aim dust
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const pod = new THREE.Group();
    pod.position.set(Math.cos(a) * 1.55, 0.35, Math.sin(a) * 1.55);
    pod.rotation.y = -a;
    pod.add(mesh(new THREE.BoxGeometry(0.34, 0.26, 0.3), M.white));
    for (const dz of [-0.09, 0.09]) {
      const nozzle = new THREE.Group();
      nozzle.position.set(0.04, -0.14, dz);
      nozzle.rotation.z = 0.4; // cant outward, away from the rover below
      nozzle.add(mesh(new THREE.CylinderGeometry(0.035, 0.085, 0.24, 16, 1, true), M.nozzle, 0, -0.12, 0));
      const plume = new THREE.Mesh(new THREE.ConeGeometry(0.28, 2.6, 20, 1, true), plumeMaterial);
      plume.position.y = -0.24 - 1.3;
      nozzle.add(plume);
      pod.add(nozzle);
      plumes.push(plume);
    }
    group.add(pod);
    nozzleExits.push(new THREE.Vector3(Math.cos(a) * 1.8, 0.0, Math.sin(a) * 1.8));
  }

  // Engine light spilling onto the dust and ground below.
  const glow = new THREE.PointLight(0xff9a55, 0, 45, 1.6);
  glow.position.y = -1.2;
  group.add(glow);

  return {
    group,
    nozzleExits,
    // Bridle attach points under the stage (local space).
    attachPoints: [new THREE.Vector3(0, 0.02, 0.3), new THREE.Vector3(-0.26, 0.02, -0.15), new THREE.Vector3(0.26, 0.02, -0.15)],
    setThrottle(k, t) {
      plumeMaterial.uniforms.throttle.value = k;
      plumeMaterial.uniforms.time.value = t;
      for (const p of plumes) {
        p.visible = k > 0.01;
        p.scale.set(1, 0.6 + k * 0.6 + Math.random() * 0.08, 1);
      }
      glow.intensity = k * (4 + Math.random() * 1.5);
    },
  };
}
