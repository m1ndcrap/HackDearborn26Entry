// Read text aloud: ElevenLabs first (better Spanish and Arabic), browser voice as the fallback.
import { TtsUnavailable, ttsAudio } from "./api";

const BROWSER_LANG: Record<string, string> = { English: "en-US", Español: "es-ES", العربية: "ar-SA" };
const cache = new Map<string, string>(); // text -> object URL, so replays don't spend credits
let current: HTMLAudioElement | null = null;
let elevenLabsOff = false;

export function stopSpeaking() {
  current?.pause();
  current = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

export async function speak(text: string, language: string): Promise<"elevenlabs" | "browser" | "none"> {
  stopSpeaking();
  if (!elevenLabsOff && navigator.onLine) {
    try {
      let url = cache.get(text);
      if (!url) {
        url = URL.createObjectURL(await ttsAudio(text));
        cache.set(text, url);
      }
      current = new Audio(url);
      await current.play();
      return "elevenlabs";
    } catch (e) {
      if (e instanceof TtsUnavailable) elevenLabsOff = true; // stop asking for the rest of the session
    }
  }
  if (!("speechSynthesis" in window)) return "none";
  const u = new SpeechSynthesisUtterance(text);
  u.lang = BROWSER_LANG[language] ?? "en-US";
  speechSynthesis.speak(u);
  return "browser";
}