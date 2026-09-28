// Named Martian landmarks. Plots on them are famous plots and cost PREMIUM_PRICE;
// every other plot is free to claim.
// radius = degrees of arc around the center that count as part of the feature.
export const FEATURES = [
  { name: 'Olympus Mons', lat: 18.65, lon: -133.8, radius: 5, tier: 'Legendary', blurb: 'Tallest volcano in the solar system, ~22 km high.' },
  { name: 'Valles Marineris', lat: -13.9, lon: -59.2, radius: 9, tier: 'Epic', blurb: 'Canyon system 4,000 km long and up to 7 km deep.' },
  { name: 'Jezero Crater', lat: 18.38, lon: 77.58, radius: 1.5, tier: 'Legendary', blurb: 'Perseverance rover landing site (2021).' },
  { name: 'Gale Crater', lat: -5.4, lon: 137.8, radius: 1.8, tier: 'Legendary', blurb: 'Curiosity rover landing site (2012).' },
  { name: 'Hellas Basin', lat: -42.4, lon: 70.5, radius: 12, tier: 'Rare', blurb: 'Giant impact basin, lowest point on Mars.' },
  { name: 'Arsia Mons', lat: -8.26, lon: -120.09, radius: 3, tier: 'Epic', blurb: 'Southernmost of the three Tharsis volcanoes.' },
  { name: 'Pavonis Mons', lat: 1.48, lon: -112.96, radius: 3, tier: 'Epic', blurb: 'Central Tharsis volcano, right on the equator.' },
  { name: 'Ascraeus Mons', lat: 11.92, lon: -104.08, radius: 3, tier: 'Epic', blurb: 'Northernmost Tharsis volcano.' },
  { name: 'Elysium Mons', lat: 25.02, lon: 147.21, radius: 3, tier: 'Rare', blurb: 'Second great volcanic region of Mars.' },
  { name: 'Syrtis Major', lat: 8.4, lon: 69.5, radius: 6, tier: 'Rare', blurb: 'Dark volcanic plain visible from Earth by telescope.' },
  { name: 'Argyre Planitia', lat: -49.7, lon: -43.4, radius: 7, tier: 'Rare', blurb: 'Large impact basin in the southern highlands.' },
  { name: 'Utopia Planitia', lat: 46.7, lon: 117.5, radius: 10, tier: 'Uncommon', blurb: 'Viking 2 and Zhurong rover landing region.' },
  { name: 'North Polar Cap', lat: 90, lon: 0, radius: 8, tier: 'Rare', blurb: 'Water-ice cap, dusted pink by iron-rich dust.' },
  { name: 'South Polar Cap', lat: -90, lon: 0, radius: 6, tier: 'Rare', blurb: 'Water ice under a permanent CO₂ ice layer.' },
];

export const BASE_PRICE = 0;
export const PREMIUM_PRICE = 50;

const toRad = (d) => (d * Math.PI) / 180;

// Great-circle distance in degrees.
export function angularDistance(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(toRad(lat1)) * Math.sin(toRad(lat2)) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.acos(Math.min(1, Math.max(-1, a))) * 180) / Math.PI;
}

// Returns the landmark covering this point (the closest one if several overlap), or null.
export function featureAt(lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const f of FEATURES) {
    const d = angularDistance(lat, lon, f.lat, f.lon);
    if (d <= f.radius && d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

export function priceAt(lat, lon) {
  return featureAt(lat, lon) ? PREMIUM_PRICE : BASE_PRICE;
}
