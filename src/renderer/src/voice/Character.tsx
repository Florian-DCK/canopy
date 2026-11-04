import { useEffect, useRef } from 'react'
import type { MarkState } from './CanopyMark'
import RIG from './rig-parts.json'

// Personnages vivants du mode voix (planche 36) : l'esprit de la forêt et le gland, redessinés en pièces vectorielles
// (design/character/rig_extract.py). Chaque état n'est qu'un jeu de réglages (inclinaison, yeux, regard, bouche,
// chapeau, bras…) ; au changement d'état, chaque réglage rejoint sa cible par un ressort : les passages restent fluides,
// même interrompus. Par-dessus : respiration, clignements, et la bouche branchée sur le volume réel de la voix.

export type CharacterKind = 'esprit' | 'gland'

type Part = { paths: { d: string; tx: number; ty: number }[]; bbox?: number[] }
type Params = {
  lean: number
  squash: number
  bob: number
  eyeOpen: number
  gazeX: number
  gazeY: number
  mouth: number
  capLift: number
  capRot: number
  armL: number
  armR: number
  perk: number
  leaf: number
}

const TARGETS: Record<MarkState, Params> = {
  rest: { lean: 0, squash: 0.975, bob: 0, eyeOpen: 0, gazeX: 0, gazeY: 0, mouth: 0, capLift: 0, capRot: 0, armL: 0, armR: 0, perk: 1, leaf: 0 },
  intro: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, gazeX: 0, gazeY: 0, mouth: 0, capLift: 0, capRot: 0, armL: 0, armR: 0, perk: 1, leaf: 0 },
  listen: { lean: -7, squash: 1.02, bob: -6, eyeOpen: 1.18, gazeX: 0, gazeY: 0, mouth: 0, capLift: 46, capRot: -12, armL: 150, armR: 0, perk: 1.07, leaf: 0 },
  think: { lean: 4, squash: 1, bob: 0, eyeOpen: 1, gazeX: 9, gazeY: -12, mouth: 0.08, capLift: 150, capRot: 0, armL: 0, armR: -168, perk: 1.02, leaf: 1 },
  speak: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, gazeX: 0, gazeY: 0, mouth: 0, capLift: 0, capRot: 0, armL: 0, armR: -55, perk: 1.03, leaf: 0 }
}

const KEYS = Object.keys(TARGETS.rest) as (keyof Params)[]

function Paths({ part, fill, stroke }: { part: Part; fill: string; stroke?: string }) {
  return (
    <>
      {part.paths.map((p, k) => (
        <path key={k} d={p.d} transform={`translate(${p.tx},${p.ty})`} fill={fill} stroke={stroke} strokeWidth={stroke ? 7 : undefined} strokeLinejoin="round" />
      ))}
    </>
  )
}

const center = (b: number[]) => ({ cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, r: (b[2] - b[0]) / 2 })

export function Character({ kind, state, size, levels }: { kind: CharacterKind; state: MarkState; size: number; levels?: (n: number) => number[] }) {
  const root = useRef<SVGSVGElement>(null)
  const target = useRef<Params>(TARGETS[state])
  target.current = TARGETS[state]
  const levelsRef = useRef(levels)
  const sim = useRef<{ cur: Params; vel: Record<keyof Params, number> } | null>(null)
  levelsRef.current = levels

  useEffect(() => {
    const svg = root.current
    if (!svg) return
    const q = (sel: string) => svg.querySelectorAll<SVGGElement>(sel)
    // La pose en cours survit aux changements d'état : les ressorts repartent d'où ils en sont, jamais de saut.
    sim.current ??= { cur: { ...target.current }, vel: Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<keyof Params, number> }
    const { cur, vel } = sim.current
    let blinkUntil = 0
    let nextBlink = performance.now() + 2500
    let last = performance.now()
    let raf = 0
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = target.current
      // Ressorts : raideur et amortissement choisis pour un léger dépassement, jamais de rebond qui traîne.
      for (const k of KEYS) {
        const a = 140 * (t[k] - cur[k]) - 16 * vel[k]
        vel[k] += a * dt
        cur[k] += vel[k] * dt
      }
      const s = now / 1000
      // Vie propre : respiration, clignements irréguliers, bouche sur le volume réel en parlant.
      const breath = reduce ? 0 : Math.sin(s * 1.7) * 0.012
      if (now > nextBlink) {
        blinkUntil = now + 130
        nextBlink = now + 2200 + Math.random() * 4200
      }
      const blink = now < blinkUntil ? 0.08 : 1
      let voice = 0
      if (state === 'speak' && levelsRef.current) {
        const lv = levelsRef.current(8)
        voice = lv.length ? Math.min(1, (lv.reduce((x, y) => x + y, 0) / lv.length) * 2.2) : 0
      }
      const mouth = Math.max(cur.mouth, voice)
      const eye = Math.max(0, cur.eyeOpen) * blink
      const spin = state === 'think' && !reduce ? Math.cos(s * 7) : 1
      const sway = state === 'speak' && !reduce ? Math.sin(s * 5) * 10 * (0.4 + voice) : 0
      const bob = cur.bob - (state === 'speak' ? voice * 10 : 0)

      const B = kind === 'gland' ? { x: 512, y: 897 } : { x: 528, y: 900 }
      q('.ch-all').forEach((g) =>
        g.setAttribute('transform', `translate(0,${bob}) rotate(${cur.lean} ${B.x} ${B.y}) translate(${B.x},${B.y}) scale(${1 - breath / 2},${cur.squash + breath}) translate(${-B.x},${-B.y})`)
      )
      q('.ch-eye').forEach((g) => {
        const cx = Number(g.dataset.cx)
        const cy = Number(g.dataset.cy)
        g.setAttribute('transform', `translate(${cx},${cy}) scale(${Math.max(0.6, Math.min(1.25, eye || 1))},${Math.max(0.06, Math.min(1.25, eye))}) translate(${-cx},${-cy})`)
      })
      q('.ch-shut').forEach((g) => g.setAttribute('opacity', String(Math.max(0, 1 - eye * 6))))
      q('.ch-pupil').forEach((g) => g.setAttribute('transform', `translate(${cur.gazeX},${cur.gazeY})`))
      q('.ch-mouth').forEach((g) => {
        const cx = Number(g.dataset.cx)
        const cy = Number(g.dataset.cy)
        g.setAttribute('transform', `translate(${cx},${cy}) scale(${1 - mouth * 0.25},${0.15 + mouth * 1.6}) translate(${-cx},${-cy})`)
        g.setAttribute('opacity', kind === 'esprit' ? String(Math.min(1, mouth * 5)) : '1')
      })
      q('.ch-cap').forEach((g) => {
        const c = { x: 512, y: 430 }
        g.setAttribute('transform', `translate(0,${-cur.capLift}) rotate(${cur.capRot} ${c.x} ${c.y}) translate(${c.x},${c.y}) scale(${spin},1) translate(${-c.x},${-c.y})`)
      })
      q('.ch-armL').forEach((g) => g.setAttribute('transform', `rotate(${cur.armL} 312 626)`))
      q('.ch-armR').forEach((g) => g.setAttribute('transform', `rotate(${cur.armR + sway} 712 626)`))
      q('.ch-canopy').forEach((g) => g.setAttribute('transform', `translate(512,560) scale(${cur.perk}) translate(-512,-560)`))
      q('.ch-leaf').forEach((g) => {
        g.setAttribute('opacity', String(Math.max(0, Math.min(1, cur.leaf))))
        g.setAttribute('transform', `translate(${Math.sin(s * 1.3) * 40},${-20 + Math.sin(s * 2.1) * 14}) rotate(${Math.sin(s * 1.6) * 25} 640 70)`)
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `state` est lu dans la boucle pour la parole et la rotation du chapeau ; la boucle se relance à chaque état.
  }, [kind, state])

  if (kind === 'esprit') {
    const r = RIG.esprit
    const eyes = r.eyes.map(center)
    const mid = { x: (eyes[0].cx + eyes[1].cx) / 2, y: Math.max(eyes[0].cy, eyes[1].cy) + 46 }
    return (
      <svg ref={root} className="ch" viewBox="100 -30 840 960" width={size} height={size} aria-hidden="true">
        <g className="ch-leaf" opacity="0">
          <path d="M640 70 C660 40 700 34 716 40 C710 70 680 92 640 70 Z" fill={r.color} />
        </g>
        <g className="ch-all">
          <Paths part={r.body as Part} fill={r.color} />
          <g className="ch-canopy"><Paths part={r.canopy as Part} fill={r.color} /></g>
          {eyes.map((e, k) => (
            <g key={k}>
              <g className="ch-eye" data-cx={e.cx} data-cy={e.cy}><g className="ch-pupil"><circle cx={e.cx} cy={e.cy} r={e.r} fill="#1C1614" /></g></g>
              <path className="ch-shut" d={`M${e.cx - e.r * 1.3} ${e.cy} Q${e.cx} ${e.cy + e.r * 1.2} ${e.cx + e.r * 1.3} ${e.cy}`} stroke="#1C1614" strokeWidth={e.r * 0.6} fill="none" strokeLinecap="round" opacity="0" />
            </g>
          ))}
          <ellipse className="ch-mouth" data-cx={mid.x} data-cy={mid.y} cx={mid.x} cy={mid.y} rx="15" ry="12" fill="#1C1614" opacity="0" />
        </g>
      </svg>
    )
  }

  const r = RIG.gland
  const eyes = r.eyes.map(center)
  const mid = { x: (eyes[0].cx + eyes[1].cx) / 2, y: eyes[0].cy + 56 }
  return (
    <svg ref={root} className="ch" viewBox="160 -120 700 1040" width={size} height={size} aria-hidden="true">
      <g className="ch-all">
        <Paths part={r.legL as Part} fill={r.color} />
        <Paths part={r.legR as Part} fill={r.color} />
        <Paths part={r.body as Part} fill={r.color} />
        {/* Bras devant le corps : levés, ils passent par-dessus au lieu de disparaître derrière. */}
        <g className="ch-armL"><Paths part={r.armL as Part} fill={r.color} stroke="#9E4A2E" /></g>
        <g className="ch-armR"><Paths part={r.armR as Part} fill={r.color} stroke="#9E4A2E" /></g>
        {eyes.map((e, k) => (
          <g key={k}>
            <ellipse cx={e.cx + (k ? 14 : -14)} cy={e.cy + 52} rx="27" ry="15" fill="#F3D2C1" opacity="0.85" />
            <g className="ch-eye" data-cx={e.cx} data-cy={e.cy}>
              <circle cx={e.cx} cy={e.cy} r={e.r} fill="#FAF3EC" />
              <g className="ch-pupil"><circle cx={e.cx} cy={e.cy} r={e.r * 0.58} fill="#1C1614" /><circle cx={e.cx + e.r * 0.22} cy={e.cy - e.r * 0.22} r={e.r * 0.16} fill="#FAF3EC" /></g>
            </g>
            <path className="ch-shut" d={`M${e.cx - e.r} ${e.cy} Q${e.cx} ${e.cy + e.r * 0.8} ${e.cx + e.r} ${e.cy}`} stroke="#1C1614" strokeWidth="9" fill="none" strokeLinecap="round" opacity="0" />
          </g>
        ))}
        <ellipse className="ch-mouth" data-cx={mid.x} data-cy={mid.y} cx={mid.x} cy={mid.y} rx="16" ry="10" fill="#2A1E1A" />
        <g className="ch-cap">
          <Paths part={r.cap as Part} fill={r.capColor} />
          <Paths part={r.scales as Part} fill="#221D1B" />
        </g>
      </g>
    </svg>
  )
}
