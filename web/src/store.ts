import { useEffect, useState } from "react";
import { DEFAULT_ROUTINE, type Routine } from "./schedule";
import type { Medication, Profile } from "./types";

export interface AppState {
  profiles: Profile[];
  activeId: string;
  cabinet: Record<string, Medication[]>; // profile id -> meds
  routine: Record<string, Routine>; // profile id -> daily routine (local only, not sent to the API)
  remindersOn: boolean;
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
  const base = { routine: {}, remindersOn: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...JSON.parse(raw) }; // older saves lack routine/remindersOn
  } catch {
    /* ignore corrupt storage */
  }
  const p = newProfile();
  return { ...base, profiles: [p], activeId: p.id, cabinet: { [p.id]: [] } };
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
  const routineFor = (id: string) => state.routine[id] ?? DEFAULT_ROUTINE;

  return {
    state,
    profile,
    meds,
    routine: routineFor(profile.id),
    routineFor,
    setActive: (id: string) => setState((s) => ({ ...s, activeId: id })),
    addProfile: (name: string) =>
      setState((s) => {
        const p = newProfile(name);
        return { ...s, profiles: [...s.profiles, p], activeId: p.id, cabinet: { ...s.cabinet, [p.id]: [] } };
      }),
    updateProfile: (p: Profile) => setState((s) => ({ ...s, profiles: s.profiles.map((x) => (x.id === p.id ? p : x)) })),
    // replaceIds: cabinet entries the new scan supersedes (a refill, or an old strength after a dose change)
    addMeds: (added: Medication[], replaceIds: string[] = []) =>
      setState((s) => ({
        ...s,
        cabinet: { ...s.cabinet, [profile.id]: [...(s.cabinet[profile.id] ?? []).filter((m) => !replaceIds.includes(m.id)), ...added] },
      })),
    removeMed: (id: string) =>
      setState((s) => ({ ...s, cabinet: { ...s.cabinet, [profile.id]: (s.cabinet[profile.id] ?? []).filter((m) => m.id !== id) } })),
    setRoutine: (r: Routine) => setState((s) => ({ ...s, routine: { ...s.routine, [profile.id]: r } })),
    setRemindersOn: (on: boolean) => setState((s) => ({ ...s, remindersOn: on })),
  };
}

export type App = ReturnType<typeof useAppState>;