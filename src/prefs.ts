export const PREFS_KEY = 'booklike-prefs'

export interface BooklikePrefs {
  contextMenu: boolean
}

export const defaultPrefs: BooklikePrefs = {
  contextMenu: true,
}

export async function loadPrefs(): Promise<BooklikePrefs> {
  try {
    const stored = await chrome.storage.local.get(PREFS_KEY)
    const p = stored[PREFS_KEY] as Partial<BooklikePrefs> | undefined
    return { contextMenu: p?.contextMenu ?? defaultPrefs.contextMenu }
  } catch {
    return { ...defaultPrefs }
  }
}

export function savePrefs(prefs: BooklikePrefs): void {
  chrome.storage.local
    .set({ [PREFS_KEY]: prefs })
    .catch((e) => console.error('BookLike: failed to save prefs', e)) // eslint-disable-line no-console
}
