import { useEffect, useState } from "react";
import type { Medication, Profile } from "./types";

export interface AppState {
  profiles: Profile[];
  activeId: string;
  cabinet: Record<string, Medication[]>; // profile id -> meds
}

const KEY = "apothecary:v1";
const uid = () => Math.random().toString(36).slice(2, 10);

export const newProfile = (name = "Me"): Profile => ({
  id: uid(),
  name,
  allergies: [],
  conditions: [],
  language: "English",
  reading_level: "simple",
});

function initial(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore corrupt storage */
  }
  const p = newProfile();
  return { profiles: [p], activeId: p.id, cabinet: { [p.id]: [] } };
}

export function useAppState() {
  const [state, setState] = useState<AppState>(initial);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage full or blocked */
    }
  }, [state]);

  const profile = state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0];
  const meds = state.cabinet[profile.id] ?? [];

  return {
    state,
    profile,
    meds,
    setActive: (id: string) => setState((s) => ({ ...s, activeId: id })),
    addProfile: (name: string) =>
      setState((s) => {
        const p = newProfile(name);
        return { ...s, profiles: [...s.profiles, p], activeId: p.id, cabinet: { ...s.cabinet, [p.id]: [] } };
      }),
    updateProfile: (p: Profile) => setState((s) => ({ ...s, profiles: s.profiles.map((x) => (x.id === p.id ? p : x)) })),
    addMeds: (added: Medication[]) =>
      setState((s) => ({ ...s, cabinet: { ...s.cabinet, [profile.id]: [...(s.cabinet[profile.id] ?? []), ...added] } })),
    removeMed: (id: string) =>
      setState((s) => ({ ...s, cabinet: { ...s.cabinet, [profile.id]: (s.cabinet[profile.id] ?? []).filter((m) => m.id !== id) } })),
  };
}
