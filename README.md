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

## Payments (Dodo Payments)

Famous plots are bought through [Dodo Payments](https://dodopayments.com). The buyer fills in
their plot, the `claim` edge function saves it as an order and opens a Dodo checkout, and the
`dodo-webhook` function puts the plot on the map once Dodo reports `payment.succeeded`.

1. In the Dodo dashboard, create a one-time product priced at $50 and copy its id (`pdt_...`).
2. Create an API key, and add a webhook pointing at
   `https://<project-ref>.supabase.co/functions/v1/dodo-webhook` with the `payment.succeeded`,
   `payment.failed` and `payment.cancelled` events. Copy its signing secret.
3. Apply the migration and deploy both functions:
   ```
   supabase db push
   supabase functions deploy claim
   supabase functions deploy dodo-webhook
   ```
4. Set the secrets (test mode by default; use `DODO_ENVIRONMENT=live_mode` with live keys):
   ```
   supabase secrets set DODO_API_KEY=... DODO_PRODUCT_ID=pdt_... DODO_WEBHOOK_SECRET=whsec_... \
     SITE_URL=https://your-site.com DODO_ENVIRONMENT=test_mode
   ```

A pending checkout holds its plot for 30 minutes. If a payment still lands after someone else
took the plot, its order is marked `conflict` in the `orders` table: refund it from the Dodo
dashboard.

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
