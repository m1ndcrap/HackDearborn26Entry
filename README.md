# Pocket Apothecary

Scan medications, catch conflicts, understand them in your language. PWA (Vite + React + TypeScript) with a FastAPI backend and Gemini.

## Run it with Docker

    cp .env.example api/.env       # optional: add GEMINI_API_KEY (MOCK mode without it)
    docker compose up --build

Open http://localhost:8080. The `web` container (nginx) serves the built PWA and proxies `/api` and `/health` to the `api` container.

## Run it for development (hot reload)

Terminal 1, backend:

    cd api
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp ../.env.example .env        # add GEMINI_API_KEY and confirm GEMINI_MODEL in AI Studio
    uvicorn app.main:app --reload --port 8000

Terminal 2, frontend:

    cd web
    npm install
    npm run dev

Open the URL Vite prints. To test on a phone, use the "Network" URL (same Wi-Fi). The photo button uses the phone's camera app, so it works over plain http in dev.

Without a Gemini key the API runs in MOCK mode (fake scan results, templated explanations), so the whole UI can be built first. `GET /health` shows which mode you're in.

## Testing the PWA (install + offline)

The service worker only runs in a production build, and only on `localhost` or HTTPS. So `npm run dev` and the phone "Network" URL above won't show install or offline behavior.

    cd web
    npm run build && npm run preview     # serves dist/ on :4173, still proxies /api to the backend

On a laptop, open http://localhost:4173 in Chrome, then go to DevTools > Application:
- Manifest: should say installable, with no errors.
- Service workers: should be activated.
- Network > Offline, then reload: the cabinet still opens and the offline banner shows.

On a phone, you need HTTPS. With the backend and preview running:

    npx cloudflared tunnel --url http://localhost:4173

Open the https://...trycloudflare.com URL it prints.
- Android Chrome: Profile > Install app.
- iPhone Safari: Share > Add to Home Screen.

Then turn on airplane mode and launch it from the home screen.

Icons live in `web/public/` (`pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`). Overwrite them with the real artwork using the same names. To regenerate them all from one SVG:

    npx @vite-pwa/assets-generator --preset minimal-2023 public/icon.svg

## Layout

    api/app/models.py   data contract (Pydantic). Mirror changes in web/src/types.ts
    api/app/gemini.py   vision extraction + explanations (Gemini, structured JSON output)
    api/app/safety.py   deterministic checks (demo rules) + openFDA label fetch starter
    api/app/main.py     endpoints: /api/scan, /api/report, /api/explain, /api/label/{ingredient}
    web/src/screens/    Cabinet, Scan (+confirm), Report (flags + explain + read aloud), Profile

## Principle

Rules and FDA label data decide what gets flagged. Gemini only extracts text from photos and explains flags in plain language. Never let the model invent interactions.

## Next up (in order)

1. Real Gemini key, then test scan with a printed fake label (check extraction quality first).
2. Replace DEMO_RULES in safety.py with openFDA label text (fetch_label_section is an untested starter) plus RxNorm name normalization.
3. Discharge-sheet reconciliation, pre-purchase OTC check.
4. Smart schedule, Medication Passport (PDF/QR), offline polish.
5. Vultr deploy with HTTPS.

Synthetic data only in demos. Not medical advice.
