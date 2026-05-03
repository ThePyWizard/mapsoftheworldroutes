/* ============================================================
   Cesium Ion access token
   ------------------------------------------------------------
   1. Sign up free at https://ion.cesium.com
   2. Go to Access Tokens → "Create new token"
   3. Settings:
        Scopes:        ☑ assets:read     (everything else OFF)
        Asset access:  ☑ Cesium World Imagery (asset 2)
                       ☑ Cesium World Terrain (asset 1)   ← optional
        Allowed URLs:  https://YOUR-DOMAIN.com
                       http://localhost:*
   4. Copy the token, paste below.

   The token is visible in client-side JS — that's expected and
   safe. The "Allowed URLs" restriction in Ion is what actually
   protects it. NEVER put a token with write/admin scopes here.

   To keep the token out of git, add this file to .gitignore and
   commit a `config.example.js` instead.
   ============================================================ */

window.APP_CONFIG = {
  // Paste your Cesium Ion token here:
  CESIUM_ION_TOKEN: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiMWM3Zjk5OS00MTQ0LTRhZWUtOWQ0YS1kNzRjNWM0ZGY2NmMiLCJpZCI6NDI2ODMxLCJpc3MiOiJodHRwczovL2lvbi5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3Nzc4MzY3MDN9.M_eVmbTr_zrlsBVS61dNcqIppOsVgHFJEfNf7nt-5F4',

  // Use real 3D terrain (mountains have shape). Costs more bandwidth.
  // If false, the globe stays a perfect smooth sphere.
  USE_TERRAIN: false,

  // Deep-link config — change these to match what your mobile app expects.
  DEEP_LINK_HTTPS:  'https://travelanimator.com/open/route',
  DEEP_LINK_SCHEME: 'travelanimator://route',
  APP_STORE_URL:    'https://www.travelanimator.com/download',
};
