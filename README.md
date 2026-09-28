# Martian

An interactive 3D Mars where people claim a plot and put their logo on the planet.

Built with Three.js on real NASA data: the Viking color mosaic and MOLA laser-altimeter
elevation for terrain, JPL orbital elements for the live Earth–Mars signal delay, and the
Perseverance rover's wind recording for sound.

Plots are novelty digital plots on a map, not legal ownership of Martian land
(Outer Space Treaty, 1967).

## Run locally

```
npm install
cp .env.example .env   # then add your Logo.dev publishable key (pk_...)
npm run dev
```

## Features

- Realistic globe: color map, elevation-based relief, thin dusty atmosphere, Phobos and Deimos
- 41,162 hexagonal plots (H3). Normal plots are free (one per person); famous landmarks are $50
- Paste a website link and the logo is fetched automatically, with a description shown on hover
- Logo pins that stay readable from orbit
- Landing cinematic after a claim, recorded as a shareable video
- Colony lights on the night side, and community terraforming milestones (clouds, seas, oceans)
- Real Mars wind audio and live light-time countdown to Mars

## Credits

Imagery and elevation: NASA / USGS (Viking, MGS MOLA). Audio: NASA/JPL-Caltech (Perseverance).
