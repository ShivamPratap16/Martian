import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A Perseverance-class rover, ~3 m long, in metres. Origin is on the ground under the
// middle of the rover, +Z forward. Animated parts: suspension/wheels unfold (deploy),
// the camera mast rises (mast) and a flag carrying the claimer's logo unfurls (flag).

const M = {
  paint: new THREE.MeshStandardMaterial({ color: 0xdcd5cb, roughness: 0.6 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.3 }),
  black: new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.45 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0b0d10, metalness: 0.2, roughness: 0.08 }),
  alu: new THREE.MeshStandardMaterial({ color: 0x8f9296, metalness: 0.75, roughness: 0.5 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x3a3b3d, metalness: 0.6, roughness: 0.45 }),
  rtg: new THREE.MeshStandardMaterial({ color: 0x2a2a2b, metalness: 0.3, roughness: 0.6 }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A round strut between two points.
function beam(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// Wheel: machined aluminium rim with chevron-ish grousers and a dark hub.
function wheelGeometry() {
  const r = 0.26;
  const w = 0.25;
  const parts = [new THREE.CylinderGeometry(r, r, w, 40).rotateZ(Math.PI / 2)];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const g = new THREE.BoxGeometry(w * 0.98, 0.03, 0.022);
    g.rotateY(i % 2 ? 0.25 : -0.25);
    g.translate(0, r + 0.008, 0);
    g.rotateX(a);
    parts.push(g);
  }
  const rim = mergeGeometries(parts);
  const hub = new THREE.CylinderGeometry(0.1, 0.12, w + 0.04, 16).rotateZ(Math.PI / 2);
  return { rim, hub };
}

function flagTexture(logoImg, title) {
  const W = 512;
  const H = 336;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5efe8';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ff7a3d';
  ctx.fillRect(0, 0, 34, H);
  ctx.fillRect(0, H - 14, W, 14);
  const area = { x: 60, y: 30, w: W - 90, h: H - 110 };
  if (logoImg) {
    const k = Math.min(area.w / logoImg.width, area.h / logoImg.height);
    const lw = logoImg.width * k;
    const lh = logoImg.height * k;
    ctx.drawImage(logoImg, area.x + (area.w - lw) / 2, area.y + (area.h - lh) / 2, lw, lh);
  }
  ctx.fillStyle = '#2b211b';
  ctx.font = '700 40px "Space Grotesk", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 34 + (W - 34) / 2, H - 40, W - 80);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createRover({ logoImg, title }) {
  const group = new THREE.Group();

  // ---- body ("warm electronics box") and deck details ----
  const body = new THREE.Group();
  body.add(mesh(new THREE.BoxGeometry(1.7, 0.5, 2.3), M.paint, 0, 0.92, 0));
  body.add(mesh(new THREE.BoxGeometry(1.74, 0.06, 2.34), M.dark, 0, 1.18, 0)); // deck edge
  body.add(mesh(new THREE.BoxGeometry(1.6, 0.1, 2.2), M.dark, 0, 0.66, 0)); // dark belly
  for (const sx of [-1, 1]) {
    // Panel seams and a black instrument strip along each side.
    body.add(mesh(new THREE.BoxGeometry(0.01, 0.46, 0.012), M.dark, sx * 0.855, 0.92, 0.35));
    body.add(mesh(new THREE.BoxGeometry(0.01, 0.46, 0.012), M.dark, sx * 0.855, 0.92, -0.45));
    body.add(mesh(new THREE.BoxGeometry(0.012, 0.08, 1.9), M.black, sx * 0.856, 0.78, 0));
  }
  body.add(mesh(new THREE.BoxGeometry(0.55, 0.2, 0.65), M.gold, -0.45, 1.3, -0.45));
  body.add(mesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), M.black, 0.35, 1.28, -0.15));
  body.add(mesh(new THREE.BoxGeometry(0.3, 0.1, 0.35), M.paint, 0.35, 1.26, 0.45));
  body.add(mesh(new THREE.BoxGeometry(1.4, 0.34, 0.12), M.gold, 0, 0.9, 1.18)); // front belly pan
  body.add(beam(new THREE.Vector3(-0.92, 1.24, 0.1), new THREE.Vector3(0.92, 1.24, 0.1), 0.03, M.alu)); // differential bar
  group.add(body);

  // ---- mobility: rocker-bogie on each side, folds up while stowed ----
  const { rim, hub } = wheelGeometry();
  const sides = [];
  const wheels = [];
  for (const sx of [-1, 1]) {
    const side = new THREE.Group();
    const pivot = new THREE.Vector3(sx * 0.9, 0.85, 0.3);
    side.position.copy(pivot);
    const P = (x, y, z) => new THREE.Vector3(x, y, z).sub(pivot);
    const bogiePivot = P(sx * 1.0, 0.58, -0.45);
    const wheelZ = [1.0, 0.05, -0.9];
    side.add(beam(P(sx * 0.9, 0.85, 0.3), P(sx * 1.0, 0.5, 1.0), 0.045, M.alu)); // rocker front
    side.add(beam(P(sx * 0.9, 0.85, 0.3), bogiePivot, 0.045, M.alu)); // rocker back
    side.add(beam(bogiePivot, P(sx * 1.0, 0.5, 0.05), 0.04, M.alu)); // bogie front
    side.add(beam(bogiePivot, P(sx * 1.0, 0.5, -0.9), 0.04, M.alu)); // bogie back
    for (const z of wheelZ) {
      side.add(beam(P(sx * 1.0, 0.5, z), P(sx * 1.0, 0.26, z), 0.035, M.alu)); // strut
      const wheel = new THREE.Group();
      wheel.position.copy(P(sx * 1.15, 0.26, z));
      wheel.add(mesh(rim, M.alu), mesh(hub, M.dark));
      side.add(wheel);
      wheels.push(wheel);
    }
    group.add(side);
    sides.push({ side, sx });
  }

  // ---- remote sensing mast with the camera head ----
  const mast = new THREE.Group();
  mast.position.set(0.55, 1.2, 0.9);
  mast.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.05, 14), M.paint, 0, 0.52, 0));
  const head = new THREE.Group();
  head.position.y = 1.1;
  head.add(mesh(new THREE.BoxGeometry(0.44, 0.2, 0.22), M.paint));
  head.add(mesh(new THREE.BoxGeometry(0.2, 0.14, 0.12), M.gold, 0, 0.02, -0.14));
  for (const x of [-0.13, 0.13]) {
    const cam = mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.08, 16), M.glass, x, -0.02, 0.13);
    cam.rotation.x = Math.PI / 2;
    head.add(cam);
  }
  const supercam = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 20), M.glass, 0, 0.14, 0.06);
  supercam.rotation.x = Math.PI / 2;
  head.add(supercam, mesh(new THREE.BoxGeometry(0.2, 0.1, 0.18), M.paint, 0, 0.14, -0.02));
  mast.add(head);
  group.add(mast);

  // ---- MMRTG power source at the back, with cooling fins ----
  const rtg = new THREE.Group();
  rtg.position.set(0, 1.0, -1.3);
  rtg.rotation.x = -0.95; // sticks up and out behind the rover
  rtg.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.66, 20), M.rtg));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const fin = mesh(new THREE.BoxGeometry(0.02, 0.6, 0.16), M.rtg, Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
    fin.rotation.y = -a;
    rtg.add(fin);
  }
  group.add(rtg);

  // ---- high-gain antenna ----
  group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), M.alu, -0.55, 1.32, -0.95));
  const hga = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 6), M.paint, -0.55, 1.45, -0.95);
  hga.rotation.set(0.35, 0, 0.2);
  group.add(hga);

  // ---- robotic arm, stowed across the front ----
  const sh = new THREE.Vector3(-0.62, 0.98, 1.22);
  const el = new THREE.Vector3(0.38, 0.95, 1.3);
  group.add(beam(sh, el, 0.055, M.paint), mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), M.dark, sh.x, sh.y, sh.z));
  group.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.26), M.paint, 0.52, 0.86, 1.32));
  group.add(mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.26, 10), M.alu, 0.52, 0.62, 1.32));

  // ---- flag with the claimer's logo, Apollo-style top rod so it always reads ----
  const flag = new THREE.Group();
  flag.position.set(0.62, 1.2, -0.85);
  const pole = new THREE.Group();
  pole.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.55, 10), M.alu, 0, 0.775, 0));
  flag.add(pole);
  const rod = mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.05, 8), M.alu, 0.52, 1.55, 0);
  rod.rotation.z = Math.PI / 2;
  flag.add(rod);
  const clothGeo = new THREE.PlaneGeometry(1.0, 0.66, 28, 18).translate(0.5, -0.33, 0);
  const restPos = clothGeo.attributes.position.array.slice();
  const cloth = mesh(
    clothGeo,
    new THREE.MeshStandardMaterial({ map: flagTexture(logoImg, title), roughness: 0.85, side: THREE.DoubleSide })
  );
  cloth.position.set(0.02, 1.54, 0);
  flag.add(cloth);
  group.add(flag);

  const lerp = THREE.MathUtils.lerp;
  const ease = (x) => 1 - (1 - x) ** 3;

  return {
    group,
    // Top-deck points where the sky-crane bridles attach (rover local space).
    attachPoints: [new THREE.Vector3(0, 1.22, 0.55), new THREE.Vector3(-0.5, 1.22, -0.4), new THREE.Vector3(0.5, 1.22, -0.4)],

    // 0 = stowed for flight, 1 = standing on its wheels.
    setDeploy(k) {
      const e = ease(THREE.MathUtils.clamp(k, 0, 1));
      for (const { side, sx } of sides) {
        side.rotation.z = lerp(sx * 0.55, 0, e);
        side.position.y = lerp(1.1, 0.85, e);
      }
    },
    setMast(k) {
      mast.rotation.x = lerp(-Math.PI / 2, 0, ease(THREE.MathUtils.clamp(k, 0, 1)));
      head.rotation.y = Math.sin(k * Math.PI) * 0.6; // looks around as it rises
    },
    setFlag(k) {
      const pk = THREE.MathUtils.clamp(k * 1.6, 0, 1);
      const fk = THREE.MathUtils.clamp(k * 1.6 - 0.6, 0, 1);
      flag.visible = k > 0;
      pole.scale.y = Math.max(0.01, ease(pk)); // telescopes up
      rod.visible = cloth.visible = pk >= 1;
      rod.scale.y = Math.max(0.01, ease(fk));
      rod.position.x = 0.52 * ease(fk);
      cloth.scale.x = Math.max(0.01, ease(fk)); // unfurls along the rod
    },
    // Gentle ripple from the thin wind; the rod keeps it spread.
    update(t) {
      const p = clothGeo.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const x = restPos[i];
        const y = restPos[i + 1];
        p[i + 2] = Math.sin(x * 7 - t * 3.2) * 0.035 * x + Math.sin(x * 13 + y * 5 - t * 5) * 0.008 * x;
      }
      clothGeo.attributes.position.needsUpdate = true;
      clothGeo.computeVertexNormals();
    },
    spinWheels(a) {
      for (const w of wheels) w.rotation.x = a;
    },
  };
}
