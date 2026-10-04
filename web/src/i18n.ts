// Translates the whole app's text into the chosen language without touching each screen's code.
// It watches the page, collects English text (and placeholders/labels), translates it in batches
// through /api/translate, and swaps the text in place. React keeps working because we only change
// the text of existing nodes; when React writes new English text, we translate that too.
// Results are cached on the device per language, so it's instant after the first time.
import { translateTexts } from "./api";
import { findLanguage } from "./languages";

const ATTRS = ["placeholder", "aria-label", "title", "alt"];
// Never translated: user data, FDA quotes, Gemini explanations (already in the person's language)
const SKIP = "script,style,noscript,code,[data-no-translate],.notranslate,.excerpt,.explain,.med-name,.wordmark";
const HAS_LETTER = /\p{L}/u;

let lang = "English";
let root: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let cache: Record<string, string> = {};
const failed = new Set<string>();
const pending = new Set<string>();
const waiting = new Set<Text | Element>();
let timer: number | undefined;
let inflight = false;

const textOriginal = new WeakMap<Text, string>();
const textApplied = new WeakMap<Text, string>();
const attrOriginal = new WeakMap<Element, Record<string, string>>();
const attrApplied = new WeakMap<Element, Record<string, string>>();

const cacheKey = (l: string) => `apothecary:ui:${l}`;
function loadCache(l: string) {
  try {
    cache = JSON.parse(localStorage.getItem(cacheKey(l)) ?? "{}");
  } catch {
    cache = {};
  }
}
function saveCache() {
  try {
    localStorage.setItem(cacheKey(lang), JSON.stringify(cache));
  } catch {
    /* storage full: translations still work this session */
  }
}

const skipped = (el: Element | null) => !el || !!el.closest(SKIP);
const worthTranslating = (s: string) => s.length > 0 && s.length <= 400 && HAS_LETTER.test(s);

function translated(core: string): string | undefined {
  if (lang === "English") return core;
  if (cache[core] !== undefined) return cache[core];
  if (!failed.has(core)) pending.add(core);
  return undefined;
}

function applyText(n: Text) {
  const orig = textOriginal.get(n);
  if (orig === undefined) return;
  const core = orig.trim();
  let value = orig;
  if (worthTranslating(core)) {
    const t = translated(core);
    if (t === undefined) {
      waiting.add(n);
      schedule();
    } else value = orig.replace(core, t);
  }
  textApplied.set(n, value);
  if (n.nodeValue !== value) n.nodeValue = value;
}

function seeText(n: Text) {
  if (skipped(n.parentElement)) return;
  const cur = n.nodeValue ?? "";
  // Text we wrote ourselves: re-apply (a no-op unless the language changed). Anything else is new English from React.
  if (textApplied.get(n) !== cur) textOriginal.set(n, cur);
  applyText(n);
}

function applyAttr(el: Element, name: string) {
  const orig = attrOriginal.get(el)?.[name];
  if (orig === undefined) return;
  let value = orig;
  if (worthTranslating(orig.trim())) {
    const t = translated(orig.trim());
    if (t === undefined) {
      waiting.add(el);
      schedule();
    } else value = t;
  }
  const applied = attrApplied.get(el) ?? {};
  applied[name] = value;
  attrApplied.set(el, applied);
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function seeAttr(el: Element, name: string) {
  if (skipped(el)) return;
  const cur = el.getAttribute(name);
  if (cur === null) return;
  if (attrApplied.get(el)?.[name] !== cur) {
    const o = attrOriginal.get(el) ?? {};
    o[name] = cur;
    attrOriginal.set(el, o);
  }
  applyAttr(el, name);
}

function walk(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) return seeText(node as Text);
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (skipped(el)) return;
  for (const a of ATTRS) if (el.hasAttribute(a)) seeAttr(el, a);
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let cur = tw.nextNode();
  while (cur) {
    if (cur.nodeType === Node.TEXT_NODE) seeText(cur as Text);
    else for (const a of ATTRS) if ((cur as Element).hasAttribute(a)) seeAttr(cur as Element, a);
    cur = tw.nextNode();
  }
}

function reapplyWaiting() {
  const nodes = [...waiting];
  waiting.clear();
  for (const n of nodes) {
    if (n.nodeType === Node.TEXT_NODE) applyText(n as Text);
    else for (const a of ATTRS) applyAttr(n as Element, a);
  }
}

function schedule() {
  if (timer !== undefined || lang === "English") return;
  timer = window.setTimeout(flush, 120);
}

async function flush() {
  timer = undefined;
  if (inflight || pending.size === 0) return;
  inflight = true;
  const forLang = lang;
  const batch = [...pending].slice(0, 120);
  batch.forEach((s) => pending.delete(s));
  try {
    const out = await translateTexts(forLang, batch);
    if (forLang === lang) {
      batch.forEach((s, i) => {
        if (out[i] && out[i] !== s) cache[s] = out[i];
        else failed.add(s); // left in English; don't keep asking
      });
      saveCache();
      reapplyWaiting();
    }
  } catch {
    batch.forEach((s) => failed.add(s)); // offline or server error: stay in English for now
  } finally {
    inflight = false;
    if (pending.size) schedule();
  }
}

/** Starts (or switches) translation of everything inside `el`. "English" restores the original text. */
export function setUiLanguage(language: string, el: HTMLElement | null = document.getElementById("root")) {
  const l = findLanguage(language);
  document.documentElement.lang = l.code;
  document.documentElement.dir = l.rtl ? "rtl" : "ltr";
  if (l.name === lang && root === el && observer) return;
  lang = l.name;
  root = el;
  failed.clear();
  pending.clear();
  waiting.clear();
  loadCache(lang);
  if (!root) return;
  if (!observer) {
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") seeText(m.target as Text);
        else if (m.type === "attributes" && m.attributeName) seeAttr(m.target as Element, m.attributeName);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  walk(root); // re-translate (or restore) everything already on screen
}