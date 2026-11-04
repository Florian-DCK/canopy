import { CanopyMark, type MarkState } from './CanopyMark'
import { Character } from './Character'
import type { Avatar as AvatarKind } from './prefs'

/** La voix à l'écran : le soleil Canopée, ou l'un des personnages (réglage « Apparence » des Paramètres). */
export function Avatar({ kind, state, size, levels }: { kind: AvatarKind; state: MarkState; size: number; levels?: (n: number) => number[] }) {
  if (kind === 'canopy') return <CanopyMark state={state} size={size} levels={levels} />
  return <Character kind={kind} state={state} size={size} levels={levels} />
}
