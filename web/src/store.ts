import { useEffect, useState } from "react";
import { DEFAULT_ROUTINE, type Routine } from "./schedule";
import type { Medication, Profile } from "./types";

export interface AppState {
  profiles: Profile[];
  activeId: string;
  cabinet: Record<string, Medication[]>; // profile id -> meds
  routine: Record<string, Routine>; // profile id -> daily routine (local only, not sent to the API)
  remindersOn: boolean;
  photos: Record<string, string>; // med id -> label thumbnail (data URL). Local only, kept out of Medication so it never reaches the API
}

const KEY = "apothecary:v1";
// Photos get their own key: if storage fills up, only photos stop saving, not the cabinet itself
const PHOTOS_KEY = "apothecary:photos:v1";
const uid = () => Math.random().toString(36).slice(2, 10);

export const newProfile = (name = "Me"): Profile => ({
  id: uid(),
  name,
  allergies: [],
  conditions: [],
  language: "English",
  reading_level: "simple",
});

function loadPhotos(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PHOTOS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function initial(): AppState {
  const base = { routine: {}, remindersOn: false, photos: loadPhotos() };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...JSON.parse(raw), photos: base.photos }; // older saves lack routine/remindersOn
  } catch {
    /* ignore corrupt storage */
  }
  const p = newProfile();
  return { ...base, profiles: [p], activeId: p.id, cabinet: { [p.id]: [] } };
}

const without = (photos: Record<string, string>, ids: string[]) => Object.fromEntries(Object.entries(photos).filter(([id]) => !ids.includes(id)));

export function useAppState() {
  const [state, setState] = useState<AppState>(initial);
  useEffect(() => {
    try {
      const { photos: _photos, ...rest } = state;
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* storage full or blocked */
    }
  }, [state]);
  useEffect(() => {
    try {
      localStorage.setItem(PHOTOS_KEY, JSON.stringify(state.photos));
    } catch {
      /* storage full: photos just won't persist */
    }
  }, [state.photos]);

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
    // Deletes the person with their cabinet, routine, and label photos. The last profile can't be removed.
    removeProfile: (id: string) =>
      setState((s) => {
        if (s.profiles.length <= 1) return s;
        const profiles = s.profiles.filter((p) => p.id !== id);
        const { [id]: removedMeds = [], ...cabinet } = s.cabinet;
        const { [id]: _routine, ...routine } = s.routine;
        const photos = without(s.photos, removedMeds.map((m) => m.id));
        return { ...s, profiles, cabinet, routine, photos, activeId: s.activeId === id ? profiles[0].id : s.activeId };
      }),
    // replaceIds: cabinet entries the new scan supersedes (a refill, or an old strength after a dose change)
    // photo: thumbnail of the label they were scanned from, if any
    addMeds: (added: Medication[], replaceIds: string[] = [], photo?: string | null) =>
      setState((s) => ({
        ...s,
        cabinet: { ...s.cabinet, [profile.id]: [...(s.cabinet[profile.id] ?? []).filter((m) => !replaceIds.includes(m.id)), ...added] },
        photos: { ...without(s.photos, replaceIds), ...(photo ? Object.fromEntries(added.map((m) => [m.id, photo])) : {}) },
      })),
    updateMed: (med: Medication) =>
      setState((s) => ({
        ...s,
        cabinet: { ...s.cabinet, [profile.id]: (s.cabinet[profile.id] ?? []).map((m) => (m.id === med.id ? med : m)) },
      })),
    removeMed: (id: string) =>
      setState((s) => ({
        ...s,
        cabinet: { ...s.cabinet, [profile.id]: (s.cabinet[profile.id] ?? []).filter((m) => m.id !== id) },
        photos: without(s.photos, [id]),
      })),
    setRoutine: (r: Routine) => setState((s) => ({ ...s, routine: { ...s.routine, [profile.id]: r } })),
    setRemindersOn: (on: boolean) => setState((s) => ({ ...s, remindersOn: on })),
  };
}

export type App = ReturnType<typeof useAppState>;