import { visit } from 'unist-util-visit'

// Encadrés : un bloc de citation qui commence par [!SUMMARY], [!TODO], [!WARNING], [!CHECK] ou [!NOTE]
// (syntaxe des « alerts » GitHub, que les consignes d'Atelier demandent aux agents) devient un bloc coloré.

export const CALLOUTS: Record<string, { kind: string; label: string }> = {
  SUMMARY: { kind: 'summary', label: 'En bref' },
  TLDR: { kind: 'summary', label: 'En bref' },
  TODO: { kind: 'todo', label: 'À faire' },
  ACTION: { kind: 'todo', label: 'À faire' },
  WARNING: { kind: 'warning', label: 'Attention' },
  CAUTION: { kind: 'warning', label: 'Attention' },
  IMPORTANT: { kind: 'warning', label: 'Important' },
  CHECK: { kind: 'check', label: 'Vérifié' },
  SUCCESS: { kind: 'check', label: 'Vérifié' },
  NOTE: { kind: 'note', label: 'À savoir' },
  TIP: { kind: 'note', label: 'Astuce' },
  INFO: { kind: 'note', label: 'À savoir' }
}

const MARK = /^\s*\[!([A-Za-z]+)\][ \t]*\n?/

/** Plugin remark : repère le marqueur, le retire du texte et pose les classes du bloc. */
export function remarkCallouts() {
  return (tree: any) => {
    visit(tree, 'blockquote', (node: any) => {
      const para = node.children?.[0]
      const first = para?.type === 'paragraph' ? para.children?.[0] : undefined
      if (first?.type !== 'text') return
      const m = MARK.exec(first.value)
      const def = m && CALLOUTS[m[1].toUpperCase()]
      if (!m || !def) return
      first.value = first.value.slice(m[0].length)
      if (!first.value) para.children.shift()
      if (!para.children.length) node.children.shift()
      node.data = { ...node.data, hProperties: { className: ['callout', `callout-${def.kind}`], 'data-label': def.label } }
    })
  }
}
