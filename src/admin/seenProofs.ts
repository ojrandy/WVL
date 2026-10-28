// Which waiting payment proofs this browser has already announced (update.md H.3). Kept in
// localStorage under SEEN_PROOFS_KEY so a proof toasts once, not on every poll or reload; the
// list is pruned to the proofs still waiting so it never grows. Storage can be missing or throw
// (private windows, blocked site data), so every access is wrapped and falls back to memory.

export const SEEN_PROOFS_KEY = 'wvl_seen_proofs';

/** Stored value → list of ids; anything malformed reads as empty. */
export function parseSeenProofs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Splits the waiting proofs into those not announced yet, and returns the new seen list: every
 * waiting id (they are all announced after this), so reviewed proofs drop out.
 */
export function nextSeenProofs<T extends { id: string }>(waiting: T[], seen: Iterable<string>): { unseen: T[]; seen: string[] } {
  const known = new Set(seen);
  return { unseen: waiting.filter((p) => !known.has(p.id)), seen: waiting.map((p) => p.id) };
}

export function readSeenProofs(): string[] | null {
  try {
    return parseSeenProofs(window.localStorage.getItem(SEEN_PROOFS_KEY));
  } catch {
    return null;
  }
}

export function writeSeenProofs(ids: string[]) {
  try {
    window.localStorage.setItem(SEEN_PROOFS_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable: the in-memory copy still stops repeats while the console stays open.
  }
}
