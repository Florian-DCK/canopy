// Mode voix : le récap des fichiers modifiés dans un tour. Une phrase en français par fichier, sans code,
// rédigée par Haiku à partir des lignes ajoutées et retirées (peu de jetons, quelques secondes).
import { loadSdk } from './sessions'

export async function summarizeChanges(files: { path: string; lines: string }[]): Promise<Record<string, string>> {
  if (!files.length) return {}
  const { query } = await loadSdk()
  const body = files.map((f) => `### ${f.path}\n${f.lines.slice(0, 2500)}`).join('\n\n')
  const prompt = `Voici des modifications de fichiers (lignes + ajoutées, - retirées). Pour chaque fichier, écris une phrase courte en français (6 à 12 mots) qui dit ce que le changement fait pour l'utilisateur, sans jargon ni nom de fonction. Réponds uniquement par un objet JSON { "chemin": "phrase" }.\n\n${body}`
  let out = ''
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ANTHROPIC_API_KEY
  for await (const m of query({ prompt, options: { model: 'haiku', maxTurns: 1, allowedTools: [], persistSession: false, settingSources: [], env } as any })) {
    if ((m as any).type === 'result' && typeof (m as any).result === 'string') out = (m as any).result
  }
  try {
    const d = JSON.parse(/\{[\s\S]*\}/.exec(out)?.[0] ?? '{}')
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v)]))
  } catch {
    return {}
  }
}
