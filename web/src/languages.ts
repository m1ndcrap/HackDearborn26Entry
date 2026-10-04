// Languages offered for the app text, explanations, and voice. Gemini handles all of these;
// voice quality depends on ElevenLabs or the device's built-in voices.
export interface Language {
  name: string; // English name, sent to Gemini ("Write in Spanish")
  native: string; // shown in pickers
  code: string; // BCP-47, for <html lang> and browser voices
  rtl?: boolean;
}

export const LANGUAGES: Language[] = [
  { name: "English", native: "English", code: "en-US" },
  { name: "Spanish", native: "Español", code: "es-ES" },
  { name: "Arabic", native: "العربية", code: "ar-SA", rtl: true },
  { name: "Chinese (Simplified)", native: "简体中文", code: "zh-CN" },
  { name: "Chinese (Traditional)", native: "繁體中文", code: "zh-TW" },
  { name: "Hindi", native: "हिन्दी", code: "hi-IN" },
  { name: "Bengali", native: "বাংলা", code: "bn-IN" },
  { name: "Urdu", native: "اردو", code: "ur-PK", rtl: true },
  { name: "Portuguese", native: "Português", code: "pt-BR" },
  { name: "French", native: "Français", code: "fr-FR" },
  { name: "German", native: "Deutsch", code: "de-DE" },
  { name: "Italian", native: "Italiano", code: "it-IT" },
  { name: "Russian", native: "Русский", code: "ru-RU" },
  { name: "Ukrainian", native: "Українська", code: "uk-UA" },
  { name: "Polish", native: "Polski", code: "pl-PL" },
  { name: "Japanese", native: "日本語", code: "ja-JP" },
  { name: "Korean", native: "한국어", code: "ko-KR" },
  { name: "Vietnamese", native: "Tiếng Việt", code: "vi-VN" },
  { name: "Tagalog", native: "Tagalog", code: "fil-PH" },
  { name: "Turkish", native: "Türkçe", code: "tr-TR" },
  { name: "Persian", native: "فارسی", code: "fa-IR", rtl: true },
  { name: "Hebrew", native: "עברית", code: "he-IL", rtl: true },
  { name: "Punjabi", native: "ਪੰਜਾਬੀ", code: "pa-IN" },
  { name: "Gujarati", native: "ગુજરાતી", code: "gu-IN" },
  { name: "Marathi", native: "मराठी", code: "mr-IN" },
  { name: "Tamil", native: "தமிழ்", code: "ta-IN" },
  { name: "Telugu", native: "తెలుగు", code: "te-IN" },
  { name: "Nepali", native: "नेपाली", code: "ne-NP" },
  { name: "Greek", native: "Ελληνικά", code: "el-GR" },
  { name: "Romanian", native: "Română", code: "ro-RO" },
  { name: "Hungarian", native: "Magyar", code: "hu-HU" },
  { name: "Czech", native: "Čeština", code: "cs-CZ" },
  { name: "Dutch", native: "Nederlands", code: "nl-NL" },
  { name: "Swedish", native: "Svenska", code: "sv-SE" },
  { name: "Norwegian", native: "Norsk", code: "nb-NO" },
  { name: "Danish", native: "Dansk", code: "da-DK" },
  { name: "Finnish", native: "Suomi", code: "fi-FI" },
  { name: "Albanian", native: "Shqip", code: "sq-AL" },
  { name: "Serbian", native: "Српски", code: "sr-RS" },
  { name: "Croatian", native: "Hrvatski", code: "hr-HR" },
  { name: "Bosnian", native: "Bosanski", code: "bs-BA" },
  { name: "Armenian", native: "Հայերեն", code: "hy-AM" },
  { name: "Georgian", native: "ქართული", code: "ka-GE" },
  { name: "Kurdish", native: "Kurdî", code: "ku" },
  { name: "Pashto", native: "پښتو", code: "ps-AF", rtl: true },
  { name: "Indonesian", native: "Bahasa Indonesia", code: "id-ID" },
  { name: "Malay", native: "Bahasa Melayu", code: "ms-MY" },
  { name: "Thai", native: "ไทย", code: "th-TH" },
  { name: "Burmese", native: "မြန်မာ", code: "my-MM" },
  { name: "Khmer", native: "ខ្មែរ", code: "km-KH" },
  { name: "Lao", native: "ລາວ", code: "lo-LA" },
  { name: "Hmong", native: "Hmoob", code: "hmn" },
  { name: "Swahili", native: "Kiswahili", code: "sw-KE" },
  { name: "Amharic", native: "አማርኛ", code: "am-ET" },
  { name: "Somali", native: "Soomaali", code: "so-SO" },
  { name: "Yoruba", native: "Yorùbá", code: "yo-NG" },
  { name: "Igbo", native: "Igbo", code: "ig-NG" },
  { name: "Hausa", native: "Hausa", code: "ha-NG" },
  { name: "Zulu", native: "isiZulu", code: "zu-ZA" },
  { name: "Haitian Creole", native: "Kreyòl ayisyen", code: "ht-HT" },
];

/** Accepts an English name or a native name (older profiles saved "Español" / "العربية"). */
export function findLanguage(value?: string | null): Language {
  const v = (value ?? "").trim().toLowerCase();
  return LANGUAGES.find((l) => l.name.toLowerCase() === v || l.native.toLowerCase() === v) ?? LANGUAGES[0];
}

/** Best match for the device's own language, used as the first-launch default. */
export function deviceLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const t = tag.toLowerCase();
    const exact = LANGUAGES.find((l) => l.code.toLowerCase() === t);
    if (exact) return exact;
    const base = LANGUAGES.find((l) => l.code.toLowerCase().split("-")[0] === t.split("-")[0]);
    if (base) return base;
  }
  return LANGUAGES[0];
}