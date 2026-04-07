import { loadPrefs, savePrefs } from './prefs'

const checkbox = document.querySelector<HTMLInputElement>('#contextMenu')

void loadPrefs().then((prefs) => {
  if (checkbox) checkbox.checked = prefs.contextMenu
})

checkbox?.addEventListener('change', () => {
  savePrefs({ contextMenu: checkbox.checked })
})
