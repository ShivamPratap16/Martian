// Earth–Mars distance from JPL's "Approximate Positions of the Planets" (Standish),
// Table 1 Keplerian elements valid 1800–2050. Accurate to well under 1% for distance.
// Elements: a (AU), e, I, L, long. perihelion, long. ascending node (deg), each with a per-century rate.
const ELEMENTS = {
  earth: [
    [1.00000261, 0.00000562],
    [0.01671123, -0.00004392],
    [-0.00001531, -0.01294668],
    [100.46457166, 35999.37244981],
    [102.93768193, 0.32327364],
    [0, 0],
  ],
  mars: [
    [1.52371034, 0.00001847],
    [0.0933941, 0.00007882],
    [1.84969142, -0.00813131],
    [-4.55343205, 19140.30268499],
    [-23.94362959, 0.44441088],
    [49.55953891, -0.29257343],
  ],
};

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
const rad = (d) => (d * Math.PI) / 180;

function heliocentric(planet, date) {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
  const [a, e, I, L, peri, node] = ELEMENTS[planet].map(([v, rate]) => v + rate * T);
  const w = rad(peri - node);
  const O = rad(node);
  const i = rad(I);
  let M = rad((((L - peri) % 360) + 540) % 360 - 180);
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const [cw, sw, cO, sO, ci, si] = [Math.cos(w), Math.sin(w), Math.cos(O), Math.sin(O), Math.cos(i), Math.sin(i)];
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

export function earthMarsDistanceAU(date = new Date()) {
  const a = heliocentric('earth', date);
  const b = heliocentric('mars', date);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// One-way light (radio signal) travel time from Earth to Mars, in seconds.
export function lightDelaySeconds(date = new Date()) {
  return (earthMarsDistanceAU(date) * AU_KM) / C_KM_S;
}

// Mars Sol Date (NASA GISS Mars24 algorithm): days on Mars since 29 Dec 1873.
export function marsSolDate(date = new Date()) {
  const jdUT = date.getTime() / 86400000 + 2440587.5;
  const jdTT = jdUT + (37 + 32.184) / 86400;
  return (jdTT - 2405522.0028779) / 1.0274912517;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}
