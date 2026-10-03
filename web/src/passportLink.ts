// The Passport QR code holds the passport data itself, compressed into the link (#passport=...).
// Nothing is stored on a server, and the "#" part of a URL is never sent to the server.
import type { Severity } from "./types";

export interface PassportData {
  v: 1;
  n: string; // name
  a?: number | null; // age
  al: string[]; // allergies
  c: string[]; // conditions
  m: { n: string; s?: string | null; d?: string | null; f?: string | null }[]; // meds
  fl: { s: Severity; t: string; d: string[] }[]; // flags
  at: string; // ISO date
}

const toB64url = (bytes: Uint8Array) => {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodePassport(data: PassportData): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(data));
  if ("CompressionStream" in window) return "z" + toB64url(await pipe(raw, new CompressionStream("deflate-raw")));
  return "j" + toB64url(raw);
}

export async function decodePassport(code: string): Promise<PassportData> {
  const bytes = fromB64url(code.slice(1));
  const raw = code[0] === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (data?.v !== 1) throw new Error("Unknown passport format");
  return data as PassportData;
}

export function passportUrl(code: string): string {
  // Set VITE_PUBLIC_URL to your deployed https URL so QR codes work on other phones.
  const base = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || window.location.origin;
  return `${base.replace(/\/$/, "")}/#passport=${code}`;
}