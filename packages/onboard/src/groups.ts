/**
 * The group index: 0, 1 or 2, picked when the page first loads and kept for the
 * session, so a refresh does not move a person to another group.
 *
 * `sessionStorage` rather than `localStorage`: it lasts exactly as long as the
 * tab, which is a session in the spec's sense, and a person who comes back
 * another day is placed afresh.
 *
 * The spec left the colours to choose. These are from the Okabe–Ito palette,
 * picked to stay distinct for the common kinds of colour blindness — and each is
 * paired with a symbol and a name anyway, so nothing depends on colour alone.
 * Black text reads on all three outdoors.
 */
export interface Group {
  index: 0 | 1 | 2
  name: 'Circle' | 'Square' | 'Triangle'
  colour: string
}

export const GROUPS: readonly Group[] = [
  { index: 0, name: 'Circle', colour: '#E69F00' },
  { index: 1, name: 'Square', colour: '#56B4E9' },
  { index: 2, name: 'Triangle', colour: '#CC79A7' },
]

const KEY = 'ss-onboard-group'

/** Storage that may be missing or throw (private mode, blocked site data). */
interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function groupFor(store: Store | null, random: () => number = Math.random): Group {
  try {
    const kept = store?.getItem(KEY)
    if (kept != null && GROUPS[Number(kept)]) return GROUPS[Number(kept)]!
  } catch {
    // Unreadable storage: fall through and pick, it just will not survive a reload.
  }
  const picked = GROUPS[Math.min(2, Math.floor(random() * 3))]!
  try {
    store?.setItem(KEY, String(picked.index))
  } catch {
    // As above.
  }
  return picked
}
