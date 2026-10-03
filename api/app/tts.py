"""ElevenLabs text-to-speech. The API key stays on the server; the browser never sees it."""
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")
# Multilingual model: auto-detects Spanish/Arabic from the text. Check the ElevenLabs docs for newer model IDs.
MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_multilingual_v2")
MAX_CHARS = 1000  # protects your credits


def configured() -> bool:
    return bool(API_KEY and VOICE_ID)


def synthesize(text: str) -> bytes:
    r = httpx.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
        headers={"xi-api-key": API_KEY, "accept": "audio/mpeg"},
        json={"text": text[:MAX_CHARS], "model_id": MODEL},
        timeout=30,
    )
    r.raise_for_status()
    return r.content