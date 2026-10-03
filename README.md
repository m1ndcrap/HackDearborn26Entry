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

## New in this update

- **RxNorm name matching** (`api/app/rxnorm.py`): brand, misspelled, or strength-laden names become generic ingredients. Runs automatically on every scan; `GET /api/normalize?name=` for manual entries. Medicines now carry an `ingredients` list (multi-ingredient products like NyQuil get all of them).
- **Schedule tab**: label directions become clock times based on each person's routine, separated drugs are spaced out, and "Add to calendar" exports an .ics file.
- **Reminders**: browser notifications while the app is open, plus a test button. Use the calendar export for reminders when the app is closed.
- **Passport tab**: printable one-page summary with a QR code. The QR holds the data itself (nothing stored on a server). Set `VITE_PUBLIC_URL` to the deployed https URL at build time so QR codes open on other phones.
- **ElevenLabs voice** (`api/app/tts.py`, `POST /api/tts`): set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `api/.env`. Without them, Read aloud uses the browser voice.

## FDA label safety checks

`api/app/openfda.py` fetches FDA drug labels; `api/app/safety.py` turns them into flags.

- **Interactions:** for each pair of medicines, each label's interaction sections are searched for the other drug's ingredients or class (NSAIDs, SSRIs, MAOIs, blood thinners, antacids, and more).
- **Severity** comes from the label's wording ("contraindicated", "avoid", "serious bleeding" = high; "monitor", "may increase" = caution).
- **Citations:** each flag has `excerpt` (the label sentence) and `source_url` (the DailyMed page), shown on the Check screen.
- **Also checked:** profile conditions against label warnings, and alcohol, grapefruit, "with food", and "empty stomach" wording.
- **Fallbacks:** if openFDA is unreachable or rate limited, built-in rules still run, and the Check screen lists medicines that couldn't be checked.
- **Rate limits:** add a free `OPENFDA_API_KEY` to `api/.env`. Labels are cached in `api/.label_cache` for a week.
- **Before the demo:** run `python check_openfda.py` from `api` to test live lookups and warm the cache.
