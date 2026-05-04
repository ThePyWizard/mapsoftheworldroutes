# mapsoftheworldroutes

Interactive 3D globe site that plots the roadtrips from [@mapsoftheworldroutes](https://www.tiktok.com/@mapsoftheworldroutes). Each route on the site is a real itinerary that was animated for TikTok, Instagram and YouTube using [TravelAnimator](https://travelanimator.com); clicking *Open in TravelAnimator* deep-links straight into the same route inside the app.

## Stack

- Static HTML / CSS / vanilla JS — no build step, no framework
- [CesiumJS](https://cesium.com/platform/cesiumjs/) for the 3D globe (loaded from CDN)
- Cesium Ion: World Imagery (asset 2) for the basemap, optional World Terrain (asset 1)

## Run locally

```bash
npx serve
```

Opening `index.html` directly with `file://` will fail because `routes.json` is fetched at runtime — you need an HTTP server.

## Configuration

Everything tunable lives in [`config.js`](config.js):

| Key | Purpose |
| --- | --- |
| `CESIUM_ION_TOKEN` | Your token from [ion.cesium.com](https://ion.cesium.com). Restrict allowed URLs in the Ion dashboard — the token itself is shipped to the browser. |
| `USE_TERRAIN` | `true` for real elevation (more bandwidth), `false` for a smooth sphere. |
| `DEEP_LINK_HTTPS` | Universal link the app handles, e.g. `https://travelanimator.com/open/route`. The route id is appended as `/<id>`. |
| `DEEP_LINK_SCHEME` | Custom scheme fallback, e.g. `travelanimator://route`. The id is appended as `?id=<id>`. |
| `APP_STORE_URL` | Where to send users whose device doesn't have the app. |

To keep the token out of git, add `config.js` to `.gitignore` and commit a `config.example.js` template alongside it.

## Adding routes

Routes live in [`routes.json`](routes.json) as a flat array. Each entry needs:

```json
{
  "id": 101,
  "title": "Route name shown in the list",
  "origin": "City, State",
  "destination": "City, State",
  "waypoints": ["First stop, ST", "Second stop, ST"],
  "googleMapsUrl": "https://www.google.com/maps/dir/...",
  "totalDistance": 250
}
```

- `id` must be unique.
- `totalDistance` is in **miles**.
- `googleMapsUrl` follows the standard `/maps/dir/` format — spaces become `+`, stops are separated by `/`.
- Every place name (`origin`, `destination`, every entry in `waypoints`) **must** have a matching key in [`geocode.js`](geocode.js). Names are matched literally — `"Las Vegas, NV"` and `"Las Vegas, Nevada"` are two different keys. If a name is missing, the route is silently dropped and a warning is logged to the console.

## Geocodes

[`geocode.js`](geocode.js) maps every place name to `{ lat, lng }`. Entries are alphabetized; coordinates can be tweaked to nudge a marker that lands in an awkward spot (mid-ocean offshore, on the wrong side of a city, etc.).

## What the user sees

- **3D globe** auto-rotates until you interact with it.
- **Origin dots** mark every route's starting city.
- **Search** filters the right-hand list by title, origin, destination, or waypoint.
- **Detail panel** shows distance, a per-route fuel cost calculator (default 25 mpg, $3.50/gal — both editable), and the deep-link buttons.
- **Traveling dot animation** rides the polyline along the geodesic; long cross-country routes follow the curve of the earth, not a straight chord through it.

## File map

| File | What it does |
| --- | --- |
| `index.html` | Page shell, Cesium widget mount, sidebar, about / footer. |
| `app.js` | Globe setup, route plotting, search, detail panel, fuel calculator, deep-link logic. |
| `styles.css` | All styling. Brand palette is defined as CSS variables at the top. |
| `config.js` | Cesium Ion token + deep-link URLs (see above). |
| `routes.json` | Route data. |
| `geocode.js` | `place name → lat/lng` map. |
| `logo.png` | Favicon, loader logo, brand mark in the header. |

## Deploying

It's a static site — drop the directory on Netlify, Vercel, GitHub Pages, S3, or any static host. Make sure the Cesium Ion token's "Allowed URLs" list includes your production domain.
