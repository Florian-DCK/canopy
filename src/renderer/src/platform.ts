/** Plateforme du renderer (sans passer par le preload) : Cmd sur Mac, Ctrl ailleurs. */
export const isMac = navigator.userAgent.includes('Mac')
/** Touche de commande principale (Ctrl sous Windows/Linux, Cmd sur Mac). */
export const mod = (e: { ctrlKey: boolean; metaKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey)
export const MOD = isMac ? '⌘' : 'Ctrl'
export const SHIFT = isMac ? '⇧' : 'Maj'
