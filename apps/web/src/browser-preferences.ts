import { useCallback, useEffect, useState, type SetStateAction } from "react";

export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): PreferenceStorage | null {
  try { return window.localStorage; } catch { return null; }
}

export function readPreference<T>(key: string, fallback: T, parse: (value: unknown) => T, storage = browserStorage()): T {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? fallback : parse(JSON.parse(raw));
  } catch { return fallback; }
}

export function writePreference<T>(key: string, value: T, storage = browserStorage()): void {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* Layout changes still work when storage is unavailable or full. */ }
}

export function booleanPreference(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid boolean preference");
  return value;
}

export function choicePreference<const T extends string>(choices: readonly T[]) {
  return (value: unknown): T => {
    if (typeof value !== "string" || !choices.includes(value as T)) throw new Error("Invalid preference choice");
    return value as T;
  };
}

// Keys are versioned and scoped by the caller. Never use this for credentials or document drafts.
export function useBrowserPreference<T>(key: string, fallback: T, parse: (value: unknown) => T) {
  const [entry, setEntry] = useState(() => ({ key, value: readPreference(key, fallback, parse) }));
  if (entry.key !== key) setEntry({ key, value: readPreference(key, fallback, parse) });
  useEffect(() => { if (entry.key === key) writePreference(key, entry.value); }, [key, entry]);
  const setValue = useCallback((value: SetStateAction<T>) => {
    setEntry((current) => ({ key, value: typeof value === "function" ? (value as (previous: T) => T)(current.value) : value }));
  }, [key]);
  return [entry.value, setValue] as const;
}
