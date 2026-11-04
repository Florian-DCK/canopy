import type { Item, MediaItem } from '../../shared/types'

export const mediaUrl = (id: string) => `atelier-media://media/${id}`
export const thumbUrl = (id: string) => `atelier-media://thumb/${id}`

export const fmtSize = (n?: number) =>
  n === undefined ? '' : n < 1024 * 1024 ? `${Math.round(n / 1024)} Ko` : `${(n / 1024 / 1024).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} Mo`

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '').toLowerCase()

/**
 * Clé de série : captures navigateur ensemble ; sinon même dossier + même nom sans numéro final
 * (check-43.png, check-44.png → « check »), ou même fichier relu plusieurs fois.
 */
export function seriesKey(m: MediaItem): string {
  if (m.source === 'screenshot') return 'screenshot'
  const stem = m.name.replace(/\.[^.]+$/, '')
  const base = stem.replace(/[-_ .]?\d+$/, '')
  return `${dirOf(m.path)}|${(base || stem).toLowerCase()}|${m.kind}`
}

export function seriesLabel(m: MediaItem): string {
  if (m.source === 'screenshot') return 'Captures navigateur'
  const stem = m.name.replace(/\.[^.]+$/, '')
  return stem.replace(/[-_ .]?\d+$/, '') || stem
}

export type Series = { key: string; label: string; items: MediaItem[] }

/** Séries (≥ 2 éléments) et médias isolés, dans l'ordre d'apparition. */
export function groupSeries(list: MediaItem[]): Series[] {
  const map = new Map<string, Series>()
  for (const m of list) {
    const k = seriesKey(m)
    if (!map.has(k)) map.set(k, { key: k, label: seriesLabel(m), items: [] })
    map.get(k)!.items.push(m)
  }
  return [...map.values()]
}

export function seriesOf(m: MediaItem, list: MediaItem[]): MediaItem[] {
  const k = seriesKey(m)
  return list.filter((x) => seriesKey(x) === k)
}

/** Commentaire de l'agent juste après le média (premier texte qui suit l'élément rattaché). */
export function commentFor(m: MediaItem, items: Item[]): string | undefined {
  const i = items.findIndex((x) => x.id === m.itemId)
  if (i < 0) return undefined
  const own = items[i]
  if (own.kind === 'text') return own.text
  for (let k = i + 1; k < items.length; k++) {
    const x = items[k]
    if (x.kind === 'text' && x.parent === (own.kind === 'tool' ? own.parent : null)) return x.text
    if (x.kind === 'user') return undefined
  }
  return undefined
}
