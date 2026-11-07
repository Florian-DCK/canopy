import type { CSSProperties } from 'react'

// Jeu d'icônes d'Atelier (planche « 5 · Icônes ») : grille 24 px, trait 1,6, bouts arrondis.
// Tracés statiques écrits ici : jamais de contenu venu d'une session.

const PATHS = {
  "sessions": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"/><path d=\"M9.5 4.5v15\"/>",
  "panel": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"/><path d=\"M14.5 4.5v15\"/>",
  "conversation": "<path d=\"M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8.5l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z\"/>",
  "artifact": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"/><path d=\"M3.5 9h17\"/><circle cx=\"6.5\" cy=\"6.8\" r=\"0.7\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M12 11.2l.95 2.15 2.15.95-2.15.95L12 17.4l-.95-2.15-2.15-.95 2.15-.95z\"/>",
  "more": "<circle cx=\"6\" cy=\"12\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"12\" cy=\"12\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"18\" cy=\"12\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/>",
  "plus": "<path d=\"M12 5.5v13M5.5 12h13\"/>",
  "close": "<path d=\"M7 7l10 10M17 7L7 17\"/>",
  "chevron": "<path d=\"M7.5 10l4.5 4.5 4.5-4.5\"/>",
  "read": "<path d=\"M6.5 3.5h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z\"/><path d=\"M14 3.5v4h4\"/><path d=\"M8.5 12h7M8.5 15.5h5\"/>",
  "edit": "<path d=\"M15 4.8l4.2 4.2L9.2 19H5v-4.2z\"/><path d=\"M12.8 7l4.2 4.2\"/>",
  "write": "<path d=\"M6.5 3.5h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z\"/><path d=\"M14 3.5v4h4\"/><path d=\"M11.5 11v6M8.5 14h6\"/>",
  "bash": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"/><path d=\"M7.5 9.8l2.6 2.2-2.6 2.2\"/><path d=\"M12.5 15h4\"/>",
  "search": "<circle cx=\"10.5\" cy=\"10.5\" r=\"6\"/><path d=\"M15 15l5 5\"/>",
  "web": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M3.5 12h17\"/><path d=\"M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5z\"/>",
  "agent": "<circle cx=\"6.5\" cy=\"6\" r=\"2\"/><circle cx=\"6.5\" cy=\"18\" r=\"2\"/><circle cx=\"17.5\" cy=\"12\" r=\"2\"/><path d=\"M6.5 8v8\"/><path d=\"M6.5 9c0 2.2 1.4 3 3.6 3h5.4\"/>",
  "todo": "<path d=\"M4.5 7.2l1.6 1.6 3-3.1\"/><path d=\"M12.5 7.2h7\"/><path d=\"M4.5 16.8l1.6 1.6 3-3.1\"/><path d=\"M12.5 16.8h7\"/>",
  "calendar": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"2.5\"/><path d=\"M3.5 10h17\"/><path d=\"M8 3v4M16 3v4\"/>",
  "capture": "<path d=\"M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5\"/><circle cx=\"12\" cy=\"12\" r=\"3.2\"/>",
  "plug": "<path d=\"M9 3.5v4M15 3.5v4\"/><path d=\"M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0z\"/><path d=\"M12 16v4.5\"/>",
  "run": "<circle cx=\"12\" cy=\"12\" r=\"8\" opacity=\".28\"/><path d=\"M12 4a8 8 0 0 1 8 8\"/>",
  "wait": "<path d=\"M12 3.8l8.2 8.2-8.2 8.2L3.8 12z\" fill=\"currentColor\" fill-opacity=\".16\"/><path d=\"M12 8.6v4\"/><circle cx=\"12\" cy=\"15.4\" r=\"0.95\" fill=\"currentColor\" stroke=\"none\"/>",
  "done": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M8.4 12.2l2.5 2.5 4.8-5\"/>",
  "error": "<path d=\"M10.7 4.8a1.5 1.5 0 0 1 2.6 0l7.3 12.7a1.5 1.5 0 0 1-1.3 2.2H4.7a1.5 1.5 0 0 1-1.3-2.2z\"/><path d=\"M12 9.5v4\"/><circle cx=\"12\" cy=\"16.6\" r=\"0.95\" fill=\"currentColor\" stroke=\"none\"/>",
  "idle": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M10 9v6M14 9v6\"/>",
  "readonly": "<path d=\"M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z\"/><circle cx=\"12\" cy=\"12\" r=\"2.8\"/>",
  "attach": "<path d=\"M18.5 11.3l-6.9 6.9a4.4 4.4 0 0 1-6.2-6.2l7.3-7.3a2.9 2.9 0 0 1 4.1 4.1l-7.1 7.1a1.45 1.45 0 0 1-2-2l6.5-6.5\"/>",
  "model": "<path d=\"M12 3.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.5z\"/>",
  "mode-ask": "<path d=\"M12 3.5l7 2.6v5.4c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6.1z\"/><path d=\"M12 8.8v3.6\"/><circle cx=\"12\" cy=\"15.2\" r=\"0.95\" fill=\"currentColor\" stroke=\"none\"/>",
  "mode-edits": "<path d=\"M12 3.5l7 2.6v5.4c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6.1z\"/><path d=\"M9 12.1l2.2 2.2 4-4.2\"/>",
  "mode-auto": "<path d=\"M13.2 3.5L5.8 13.2h5.7l-1 7.3 7.7-9.9h-5.8z\"/>",
  "mode-plan": "<path d=\"M3.5 6.3l5.5-2 6 2 5.5-2v13.4l-5.5 2-6-2-5.5 2z\"/><path d=\"M9 4.3v13.4M15 6.3v13.4\"/>",
  "quota": "<path d=\"M7 3.8h10M7 20.2h10\"/><path d=\"M8.2 3.8c0 4.2 3.8 5 3.8 8.2s-3.8 4-3.8 8.2M15.8 3.8c0 4.2-3.8 5-3.8 8.2s3.8 4 3.8 8.2\"/><path d=\"M9.4 19.6c.5-1.7 1.4-2.6 2.6-2.6s2.1.9 2.6 2.6z\" fill=\"currentColor\" stroke=\"none\"/>",
  "send": "<path d=\"M12 19V5.5M6.5 11l5.5-5.5 5.5 5.5\"/>",
  "stop": "<rect x=\"7\" y=\"7\" width=\"10\" height=\"10\" rx=\"2.2\" fill=\"currentColor\" stroke=\"none\"/>",
  "files": "<path d=\"M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z\"/>",
  "media": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"/><circle cx=\"9\" cy=\"9.6\" r=\"1.6\"/><path d=\"M20.5 15.2l-4.4-4.4-8.6 8.6\"/>",
  "diff": "<path d=\"M6.5 3.5h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z\"/><path d=\"M14 3.5v4h4\"/><path d=\"M11.5 9.5v4.6M9.2 11.8h4.6M9.2 16.8h4.6\"/>",
  "restart": "<path d=\"M19.5 12a7.5 7.5 0 1 1-2.2-5.3\"/><path d=\"M19.8 4.2v4.3h-4.3\"/>",
  "external": "<path d=\"M13.5 4.5h6v6\"/><path d=\"M19.5 4.5L11 13\"/><path d=\"M17.5 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h4\"/>",
  "link": "<path d=\"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1\"/><path d=\"M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1\"/>",
  "copy": "<rect x=\"8.5\" y=\"8.5\" width=\"11.5\" height=\"11.5\" rx=\"2\"/><path d=\"M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5\"/>",
  "compare": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"/><path d=\"M12 2.5v19\"/><path d=\"M8.2 10l-2 2 2 2M15.8 10l2 2-2 2\"/>",
  "history": "<path d=\"M4.5 12a7.5 7.5 0 1 0 2.2-5.3\"/><path d=\"M4.2 4.2v4.3h4.3\"/><path d=\"M12 8.2v4.3l2.8 1.6\"/>",
  "pointer": "<path d=\"M5.5 3.8l12.7 6.6-5.6 1.7-2.4 5.6z\"/><path d=\"M12.6 12.1l4.6 5.4\"/>",
  "pin": "<path d=\"M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.2\"/>",
  "ruler": "<rect x=\"2.8\" y=\"8\" width=\"18.4\" height=\"8\" rx=\"1.5\"/><path d=\"M6.5 8v3M10 8v4.2M13.5 8v3M17 8v4.2\"/>",
  "desktop": "<rect x=\"3\" y=\"4.5\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M8.5 20h7M12 16.5V20\"/>",
  "tablet": "<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2.2\"/><path d=\"M11 18h2\"/>",
  "phone": "<rect x=\"7\" y=\"3\" width=\"10\" height=\"18\" rx=\"2.2\"/><path d=\"M11 18h2\"/>",
  "back": "<path d=\"M14.5 6l-6 6 6 6\"/>",
  "forward": "<path d=\"M9.5 6l6 6-6 6\"/>",
  "console": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"/><path d=\"M7.5 9.5h9M7.5 13h6M7.5 16.5h3\"/>",
  "queue": "<path d=\"M8 6.5h11.5M8 12h11.5M8 17.5h11.5\"/><circle cx=\"4.5\" cy=\"6.5\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"4.5\" cy=\"12\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"4.5\" cy=\"17.5\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/>",
  // Logo officiel de Claude (simple-icons, source claude.ai), plein : à colorer en argile.
  "claude": "<path fill=\"currentColor\" stroke=\"none\" d=\"m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z\"/>",
  "user": "<circle cx=\"12\" cy=\"8.2\" r=\"3.7\"/><path d=\"M4.8 20c.9-3.7 3.7-5.8 7.2-5.8s6.3 2.1 7.2 5.8\"/>",
  "audio": "<path d=\"M4 10v4M8 7v10M12 4.5v15M16 7.5v9M20 10.5v3\"/>",
  "tiles": "<rect x=\"3.5\" y=\"4.5\" width=\"7.5\" height=\"15\" rx=\"2\"/><rect x=\"13\" y=\"4.5\" width=\"7.5\" height=\"15\" rx=\"2\"/>",
  "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6\"/><circle cx=\"12\" cy=\"12\" r=\"6.3\"/>",
  "cube": "<path d=\"M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z\"/><path d=\"M12 12l7.5-4.3M12 12v8.5M12 12L4.5 7.7\"/>",
  "eye-off": "<path d=\"M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z\"/><circle cx=\"12\" cy=\"12\" r=\"2.8\"/><path d=\"M4.5 4.5l15 15\"/>",
  "database": "<ellipse cx=\"12\" cy=\"6\" rx=\"7.5\" ry=\"2.7\"/><path d=\"M4.5 6v12c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7V6\"/><path d=\"M4.5 12c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7\"/>",
  "lock": "<rect x=\"5\" y=\"11\" width=\"14\" height=\"9\" rx=\"2\"/><path d=\"M8 11V8a4 4 0 0 1 8 0v3\"/>",
  "expand":"<path d=\"M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6\"/>",
} as const

export type IconName = keyof typeof PATHS | 'context'

export function Icon({ name, size = 16, className, style, label }: { name: IconName; size?: number; className?: string; style?: CSSProperties; label?: string }) {
  if (name === 'context') return <Ring pct={0.46} size={size} className={className} style={style} label={label} />
  return (
    <svg
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`ico ${name === 'run' ? 'ico-spin ' : ''}${className ?? ''}`}
      style={{ flex: 'none', ...style }}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  )
}

/** Anneau de remplissage (contexte) : se remplit dans le sens des aiguilles d'une montre. */
export function Ring({ pct, size = 16, className, style, label }: { pct: number; size?: number; className?: string; style?: CSSProperties; label?: string }) {
  const p = Math.max(0, Math.min(0.999, pct))
  const t = 2 * Math.PI * p
  const x = 12 + 8.5 * Math.sin(t)
  const y = 12 - 8.5 * Math.cos(t)
  return (
    <svg aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className={`ico ${className ?? ''}`} style={{ flex: 'none', ...style }}>
      <circle cx="12" cy="12" r="8.5" opacity={0.28} />
      {p > 0.005 && <path d={`M12 3.5A8.5 8.5 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`} />}
    </svg>
  )
}

/** Icône de l'outil appelé par Claude. */
export function toolIcon(name: string): IconName {
  if (name === 'Read' || name === 'NotebookRead') return 'read'
  if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return 'edit'
  if (name === 'Write') return 'write'
  if (name === 'Bash' || name === 'BashOutput' || name === 'KillShell' || name === 'PowerShell') return 'bash'
  if (name === 'Grep' || name === 'Glob' || name === 'ToolSearch') return 'search'
  if (name === 'WebFetch' || name === 'WebSearch') return 'web'
  if (name === 'Task' || name === 'Agent') return 'agent'
  if (name === 'TodoWrite') return 'todo'
  if (name === 'Artifact') return 'artifact'
  if (name === 'mcp__atelier__capture') return 'capture'
  if (name.startsWith('mcp__')) return 'plug'
  if (name === 'ExitPlanMode') return 'mode-plan'
  return 'plug'
}

/** Nom lisible d'un outil (infobulles, compteurs). */
export function toolLabel(name: string): string {
  const L: Record<string, string> = { read: 'Lit', edit: 'Modifie', write: 'Crée', bash: 'Commande', search: 'Cherche', web: 'Web', agent: 'Sous-agent', todo: 'Plan de tâches', artifact: 'Artefact', capture: 'Capture', 'mode-plan': 'Plan' }
  return L[toolIcon(name)] ?? name.replace(/^mcp__/, '').replace(/__/g, ' · ')
}

/** Ce que fait Claude, en phrase : « Exécute npm run build », ou, avant d'avoir les détails, « Prépare une commande ». */
export function toolDoing(name: string, summary?: string): string {
  const k = toolIcon(name)
  const S = summary?.trim()
  const D: Partial<Record<IconName, [string, string]>> = {
    read: ['Lit', 'Va lire un fichier'],
    edit: ['Modifie', 'Prépare une modification'],
    write: ['Crée', 'Prépare un fichier'],
    bash: ['Exécute', 'Prépare une commande'],
    search: ['Cherche', 'Prépare une recherche'],
    web: ['Consulte', 'Prépare une recherche web'],
    agent: ['Sous-agent :', 'Lance un sous-agent'],
    todo: ['Met à jour le plan', 'Met à jour le plan'],
    artifact: ['Publie', 'Prépare un artefact'],
    capture: ['Capture', 'Prépare une capture'],
    'mode-plan': ['Présente le plan', 'Rédige le plan']
  }
  const d = D[k]
  if (!d) return S ? `${toolLabel(name)} · ${S}` : `Prépare ${toolLabel(name)}`
  if (k === 'todo' || k === 'mode-plan') return S ? d[0] : d[1]
  return S ? `${d[0]} ${S}` : d[1]
}

export const STATUS_ICON = { run: 'run', wait: 'wait', idle: 'done', done: 'done', error: 'error' } as const satisfies Record<string, IconName>
export const MODE_ICON = { default: 'mode-ask', acceptEdits: 'mode-edits', auto: 'mode-auto', plan: 'mode-plan' } as const satisfies Record<string, IconName>
