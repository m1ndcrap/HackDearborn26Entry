# Pocket Apothecary

**Scan your medicines, catch dangerous combinations, and understand every warning in your own language.**

**1st place, Shaping Society track, Hack Dearborn 5** (University of Michigan-Dearborn, October 2026)

**Live app:** https://pocket-apothecary.onrender.com

Pocket Apothecary is a free, installable web app for people managing medications, especially older adults, family caregivers, and people who don't read English fluently. It reads pill bottles, over-the-counter boxes, and hospital discharge sheets from a photo, checks everything against official FDA drug labels, and explains each warning in plain words, in 60 languages, out loud.

> **Not medical advice.** Pocket Apothecary helps people spot questions to ask their pharmacist or doctor. Demos use synthetic data only.

---

## Why

Medication mistakes often happen *around* the bottle. Someone comes home from the hospital with new prescriptions, a confusing discharge sheet, and a cabinet full of old pills, and nobody checks how it all fits together. Warning labels are small, technical, and usually English-only.

## Features

**Getting started**
- Welcome screens: app language, then profile (name, age, allergies, conditions), then explanation language and detail level
- **60 languages** for the whole interface, with right-to-left layouts for Arabic, Urdu, Persian, Hebrew, and Pashto
- Text size setting (Normal, Large, Extra large)
- Household profiles, so a caregiver can manage several people

**Adding medicines**
- Scan with the live camera or photo library. Gemini reads the label, and RxNorm and the FDA NDC Directory verify the drug.
- Type a medicine in, with tap buttons for how often, food, and time of day
- Duplicate detection across brand and generic names (Tylenol and store-brand acetaminophen)
- Edit dose, frequency, and refill and expiry dates, with reminder badges

**Safety checks**
- Drug interactions found in **real FDA label text**, including drug classes (NSAIDs, blood thinners, SSRIs, MAOIs, antacids)
- Allergy, health-condition, alcohol, grapefruit, and food warnings
- Severity taken from the label's own wording
- **Every warning quotes the label sentence it came from and links to DailyMed**
- Plain-language explanations at three reading levels, read aloud with ElevenLabs

**Standout features**
- **Discharge reconciliation:** scan a hospital discharge sheet to see what's new, changed, stopped, or still in the cabinet but missing from the sheet
- **Check before buying:** scan or type an over-the-counter product for a red, yellow, or green verdict against everything already taken

**Daily use**
- Smart schedule built from label directions and the person's routine, spacing out drugs that must be taken apart
- Calendar export (.ics) and dose reminders
- **Medication Passport:** a printable summary with a QR code for ER staff. The data lives inside the QR code; nothing is stored on a server.
- Installable on any phone, works offline, and keeps health data on the device

## How it works

```
Photo -> shrunk on the phone -> FastAPI -> Gemini reads the label (structured JSON)
                                         |-> RxNorm + FDA NDC verify the drug -> saved on the phone

Safety check -> FastAPI -> openFDA labels -> rules engine finds interactions + severity
                                          |-> Gemini explains only what the label says -> ElevenLabs reads it aloud
```

**Design principle:** rules and FDA label data decide what is dangerous. AI only reads labels and explains warnings, so every warning has a citation.

**Privacy:** profiles and medicines are stored only in the browser on the person's device. There are no accounts and no user database. Label photos are sent to Gemini to be read and are not kept.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 19, TypeScript, Vite, PWA (vite-plugin-pwa / Workbox) |
| Backend | Python, FastAPI |
| AI | Google Gemini (label vision, explanations, translation) |
| Voice | ElevenLabs multilingual text-to-speech, browser voice fallback |
| Medical data | openFDA drug labels, RxNorm / RxNav (NLM), FDA NDC Directory, DailyMed |
| Hosting | Render (static site + Docker web service, one Blueprint) |
| Local dev | Docker Compose |

## Running locally

### With Docker

```bash
cp .env.example api/.env      # add your keys (see below); runs in mock mode without a Gemini key
docker compose up --build
```

Open http://localhost:8080. The `web` container (nginx) serves the built app and proxies `/api` and `/health` to the `api` container.

### For development (hot reload)

Backend:

```bash
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env
uvicorn app.main:app --reload --port 8000
```

Frontend, in a second terminal:

```bash
cd web
npm install
npm run dev
```

Open the URL Vite prints. To test on a phone on the same Wi-Fi, use the "Network" URL.

Without a Gemini key, the API runs in **mock mode** (sample scan results and templated explanations). `GET /health` shows which services are configured.

### Environment variables (`api/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes, for real scans | Label reading, explanations, translation |
| `GEMINI_MODEL` | Yes | Pin a current model ID from AI Studio |
| `ELEVENLABS_API_KEY` | Optional | Natural read-aloud |
| `ELEVENLABS_VOICE_ID` | Optional | Voice to use |
| `ELEVENLABS_MODEL` | Optional | Defaults to `eleven_multilingual_v2` |
| `OPENFDA_API_KEY` | Optional | Higher openFDA rate limits ([free key](https://open.fda.gov/apis/authentication/)) |
| `LABEL_CACHE_DIR` | Optional | Where FDA labels are cached (default `api/.label_cache`) |

Frontend build variable: `VITE_PUBLIC_URL`, the public https URL, so Passport QR codes open on other phones.

### Testing install and offline mode

The service worker only runs in a production build, on `localhost` or HTTPS:

```bash
cd web
npm run build && npm run preview     # http://localhost:4173
```

In Chrome DevTools > Application, check that the manifest is installable and the service worker is active. Then set Network to Offline and reload: the cabinet, schedule, and passport still work.

For a phone, expose the preview over HTTPS (for example `npx cloudflared tunnel --url http://localhost:4173`), then use Install app on Android or Share > Add to Home Screen on iPhone.

### Warming the FDA label cache

```bash
cd api
python check_openfda.py
```

Tests live openFDA lookups for the demo medicines, prints every flag with its citation, and caches the labels.

## Deployment

`render.yaml` is a Render Blueprint that creates both services:

- **pocket-apothecary:** the static frontend on Render's CDN. `/api` and `/health` are rewritten to the API, so no CORS setup is needed.
- **pocket-apothecary-api:** the FastAPI backend as a Docker web service.

In Render, choose **New > Blueprint**, pick this repo, and enter the secret keys when prompted. Free API instances sleep when idle, so open `/health` before a demo.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Status and which services are configured |
| `POST /api/scan` | Photo to verified medicines |
| `POST /api/reconcile` | Discharge sheet compared with the cabinet |
| `GET /api/normalize?name=` | Brand or misspelled name to generic ingredients |
| `POST /api/report` | Full safety check with FDA citations |
| `POST /api/check-otc` | Pre-purchase verdict for a product |
| `POST /api/explain` | Plain-language explanation of a warning |
| `POST /api/translate` | Interface text in the chosen language |
| `POST /api/tts` | ElevenLabs audio |
| `GET /api/label/{ingredient}` | The FDA label sections used for checks |

Interactive docs are at `/docs` when the API is running.

## Project layout

```
api/
  app/
    main.py         endpoints
    models.py       data contract (Pydantic); mirror changes in web/src/types.ts
    gemini.py       label and discharge-sheet reading, explanations
    drugs.py        scan verification: RxNorm + FDA NDC Directory
    rxnorm.py       name normalization (brands, misspellings, combination products)
    openfda.py      FDA label client with caching and rate-limit handling
    safety.py       interaction, allergy, condition, and food checks with citations
    otc.py          check before buying
    reconcile.py    discharge reconciliation
    translate.py    interface translation
    tts.py          ElevenLabs voice
  check_openfda.py  live label check and cache warm-up
web/
  src/
    screens/        Onboarding, Cabinet, Scan, ManualAdd, BuyCheck, Discharge,
                    Report, Schedule, Passport, ProfileScreen
    i18n.ts         whole-app translation engine
    languages.ts    the 60 supported languages
    schedule.ts     directions to clock times, drug spacing
    store.ts        on-device state
render.yaml         Render Blueprint
docker-compose.yml  local stack
```

## Team

Built in 24 hours at Hack Dearborn 5 by **Emaad Khan**, **Hamza Mohsin**, **Nicolas Francisco**, and **Kharma Kelley**.

## License

MIT. See [LICENSE](LICENSE).
