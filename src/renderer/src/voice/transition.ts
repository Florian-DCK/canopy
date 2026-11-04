import { flushSync } from 'react-dom'

// Transitions du mode voix : l'API View Transitions de Chromium photographie l'écran avant et après le changement,
// puis anime de l'un à l'autre. Les éléments nommés (le soleil, la scène) glissent et changent de taille d'eux-mêmes.

type Doc = Document & { startViewTransition?: (cb: () => void) => unknown }

export function withTransition(change: () => void) {
  const d = document as Doc
  if (!d.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return change()
  d.startViewTransition(() => flushSync(change))
}
