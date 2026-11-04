import { CanopyMark, type MarkState } from './CanopyMark'
import { Gland } from './Gland'
import { Esprit } from './Esprit'
import { Plume } from './Plume'
import type { Avatar as AvatarKind } from './prefs'

/** La voix à l'écran : le soleil Canopée, ou l'un des personnages (réglage « Apparence » des Paramètres). */
export function Avatar({ kind, state, size, levels }: { kind: AvatarKind; state: MarkState; size: number; levels?: (n: number) => number[] }) {
  if (kind === 'canopy') return <CanopyMark state={state} size={size} levels={levels} />
  if (kind === 'esprit') return <Esprit state={state} size={size} levels={levels} />
  if (kind === 'chouette') return <Plume state={state} size={size} levels={levels} />
  return <Gland state={state} size={size} levels={levels} />
}
