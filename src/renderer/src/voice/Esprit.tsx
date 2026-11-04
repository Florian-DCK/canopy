import { useEffect, useId, useRef } from 'react'
import { syllableFollower } from './syllables'
import type { MarkState } from './CanopyMark'

// L'esprit de la forêt, construit pièce par pièce pour être animé (planche 36) : une canopée de lobes, un corps,
// deux bras articulés, deux pieds, un visage. Les traits sombres entre les pièces sont des masques (le corps est
// découpé autour de la canopée et des bras) : ils marchent sur n'importe quel fond.
//
// Mouvement : tout passe par des ressorts qui ne sont jamais remis à zéro. Un changement d'état ne fait que déplacer
// les cibles (et donner une impulsion d'anticipation) ; la pose en cours rejoint la nouvelle sans saut, même si l'état
// change à nouveau en route. La canopée suit le corps avec retard (inertie), chaque lobe avec le sien.

const COLOR = '#CF6C4D'
const INK = '#1C1614'
const BASE = { x: 965, y: 1690 }
const ANCHOR = { x: 965, y: 900 }

const LOBES: [number, number, number][] = [
  [965, 560, 0], // cœur (ellipse), rayon ignoré
  [950, 400, 178],
  [790, 470, 140],
  [1150, 450, 130],
  [650, 620, 165],
  [1300, 610, 150],
  [800, 700, 160],
  [1150, 640, 150],
  [560, 815, 165],
  [1390, 765, 148],
  [650, 975, 115],
  [1340, 940, 112],
  [690, 810, 120],
  [865, 740, 115],
  [1048, 668, 100],
  [1188, 730, 105],
  [1310, 790, 95]
]

const BODY =
  'M705 900C700 1000 700 1110 670 1170C630 1250 630 1420 700 1490C760 1560 820 1600 960 1605C1110 1605 1190 1570 1250 1500C1330 1410 1340 1260 1300 1150C1270 1070 1260 960 1235 870C1230 760 1200 640 965 630C730 640 700 760 705 900Z'
// Le corps se déforme à chaque image : on garde ses points pour le redessiner courbé.
const BODY_PTS = (BODY.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
const BODY_TOP = 630
type Warp = (x: number, y: number) => { x: number; y: number }
const bodyPath = (w: Warp) => {
  const q = (i: number) => {
    const d = w(BODY_PTS[i], BODY_PTS[i + 1])
    return `${(BODY_PTS[i] + d.x).toFixed(1)} ${(BODY_PTS[i + 1] + d.y).toFixed(1)}`
  }
  let d = `M${q(0)}`
  for (let i = 2; i + 5 < BODY_PTS.length; i += 6) d += `C${q(i)} ${q(i + 2)} ${q(i + 4)}`
  return d + 'Z'
}
// Épaule arrondie : même si elle dépasse un peu du corps quand il se courbe, on ne voit jamais de coupe nette.
const ARM = 'M-32 0C-36 60-46 118-42 150A42 42 0 0 0 42 150C46 118 34 60 32 0A32 32 0 0 0 -32 0Z'
// Le trait de séparation ne longe que le bas du bras : à l'épaule, bras et corps se fondent.
const ARM_GAP = 'M-40 70C-44 110-46 130-42 150A42 42 0 0 0 42 150C46 130 44 110 40 70Z'
const ARM_L = { x: 738, y: 1250 }
const ARM_R = { x: 1282, y: 1222 }
const EYES = [
  { x: 922, y: 962 },
  { x: 1124, y: 948 }
]
const MOUTH = { x: 1026, y: 1028 }
// Bouche : sourire et largeur au repos selon l'état (au repos, presque un point, comme sur le dessin).
const SMILE: Record<MarkState, number> = { rest: 0, intro: 4, listen: 6, think: -3, speak: 3 }
const MOUTH_W: Record<MarkState, number> = { rest: 4, intro: 10, listen: 13, think: 8, speak: 11 }
const TONGUE = '#A84A33'
// Ardoise du travail : un petit écran sombre tenu à deux mains. Elle est dessinée autour de son centre et placée à
// chaque image entre les deux paumes ; des lignes s'y écrivent caractère par caractère, à chaque frappe.
const TOOL = { x: 1010, y: 1330, w: 300, h: 180 }
const TOOL_LINES = 4
const LINE_MAX = 210
const LINE_X = -TOOL.w / 2 + 40
// Mots des lignes (tirets et espaces), pour que le texte se lise comme du texte.
const WORDS = ['46 28 30 28 64 28 22 28 52 28 36 28', '30 28 58 28 26 28 44 28 70 28', '62 28 22 28 40 28 34 28 56 28', '38 28 48 28 26 28 66 28 30 28']
const SCREEN = '#F3D2C1'
/** Distance de l'épaule au creux de la paume. */
const HAND = 150
/** Centre de l'ardoise sous la ligne des prises (repère de l'ardoise). */
const GRIP_Y = 12
/** Inclinaison quand une main la lâche (degrés) : elle pivote sur l'autre main et penche sous son poids. */
const DROOP = 14
/** Une frappe abaisse le bras de quelques degrés. */
const TAP_DEG = 4.5
const LEAF = 'M0 -26C22 -22 34 0 26 22C4 22 -14 6 0 -26Z'

type Pose = {
  lean: number
  squash: number
  bob: number
  eyeOpen: number
  eyeSize: number
  armL: number
  armR: number
  perk: number
  canY: number
  leaf: number
  gazeX: number
  gazeY: number
  tilt: number
  footL: number
  footR: number
  /** Langue tirée de concentration (0 à 1). */
  tongue: number
  /** Travail : le carnet tenu devant lui (0 à 1). */
  tool: number
}

const POSES: Record<MarkState, Pose> = {
  rest: { lean: 2, squash: 0.975, bob: 8, eyeOpen: 0, eyeSize: 1, armL: 22, armR: -16, perk: 0.97, canY: 14, leaf: 0, gazeX: 0, gazeY: 6, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 0 },
  intro: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1, armL: 25, armR: -18, perk: 1, canY: 0, leaf: 0, gazeX: 0, gazeY: 0, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 0 },
  listen: { lean: -4, squash: 1.015, bob: -6, eyeOpen: 1, eyeSize: 1.22, armL: 30, armR: -26, perk: 1.05, canY: -8, leaf: 0, gazeX: -4, gazeY: 2, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 0 },
  think: { lean: -2, squash: 0.99, bob: 2, eyeOpen: 0.85, eyeSize: 0.96, armL: -64, armR: 56, perk: 1.02, canY: 4, leaf: 1, gazeX: 0, gazeY: 16, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 1 },
  speak: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1.08, armL: 26, armR: -22, perk: 1.03, canY: 0, leaf: 0, gazeX: 0, gazeY: 0, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 0 }
}
const KEYS = Object.keys(POSES.rest) as (keyof Pose)[]
// Raideur et amortissement par réglage : le corps avec un léger dépassement, le regard vif, les bras souples.
const K: Partial<Record<keyof Pose, [number, number]>> = { gazeX: [520, 42], gazeY: [520, 42], armL: [110, 13], armR: [110, 13], eyeSize: [260, 16] }

// Variations : pour que le personnage reste vivant, chaque état a sa petite bibliothèque de gestes, tirés au hasard
// (jamais deux fois le même de suite) et posés par-dessus la pose de l'état. Un geste ne fait que déplacer des
// cibles ou donner une impulsion : les ressorts gardent tout fluide, même quand un geste est coupé en route.
type Fx = {
  /** Le geste dirige le regard (pas de saccades). */
  gaze: boolean
  /** Le geste ouvre la bouche hors parole (bâillement, « oh ! »). */
  mouth: { open: number; wide: number } | null
  /** Frisson du feuillage, 0 à 1. */
  rustle: number
  /** Vrai une seule fois par geste pour chaque numéro : les impulsions. */
  once: (n: number) => boolean
  push: (k: keyof Pose, v: number) => void
  /** Côté tiré au hasard au début du geste (-1 ou 1) : pencher, saluer d'un côté ou de l'autre. */
  side: number
  /** Travail : intensité de la frappe des mains (0 : mains posées, 1 : normal, plus : rafale). */
  typing: number
  /** Travail : la main lâche l'ardoise ([gauche, droite], 0 à 1) même si elle reste près du bord (écrire). */
  free: [number, number]
  /** Travail : la main libre écrit sur la face (0 à 1). */
  write: number
}
type Act = { name: string; dur: number; run: (k: number, t: Pose, fx: Fx) => void }
const ss = (x: number) => {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}
const env = (k: number, a = 0.2, r = 0.25) => (k < a ? ss(k / a) : k > 1 - r ? ss((1 - k) / r) : 1)
const mix = (a: number, b: number, e: number) => a + (b - a) * e

const ACTS: Partial<Record<MarkState, Act[]>> = {
  rest: [
    {
      name: 'pique du nez',
      dur: 3200,
      run: (k, t, fx) => {
        const d = k < 0.75 ? ss(k / 0.75) : 1 - ss((k - 0.75) / 0.1)
        t.canY += 24 * d
        t.tilt += 7 * d * fx.side
        t.bob += 8 * d
        if (k > 0.75 && fx.once(1)) fx.push('bob', -280)
        if (k > 0.76 && k < 0.9) t.eyeOpen = 0.5 // il entrouvre les yeux, puis se rendort
      }
    },
    {
      name: 'bâille',
      dur: 2800,
      run: (k, t, fx) => {
        const e = env(k, 0.3, 0.3)
        t.armL += 115 * e
        t.armR -= 115 * e
        t.squash += 0.07 * e
        t.canY -= 14 * e
        t.tilt += 4 * e * fx.side
        fx.mouth = { open: 0.95 * env(k, 0.25, 0.35), wide: -0.5 }
      }
    },
    {
      name: 'frissonne',
      dur: 1200,
      run: (k, t, fx) => {
        const e = env(k, 0.1, 0.4)
        fx.rustle = e
        t.lean += Math.sin(k * 40) * 2 * e
      }
    },
    {
      name: 'se cale',
      dur: 1900,
      run: (k, t) => {
        const a = k < 0.5 ? env(k * 2, 0.3, 0.4) : 0
        const b = k >= 0.5 ? env(k * 2 - 1, 0.3, 0.4) : 0
        t.footL += 20 * a
        t.footR += 20 * b
        t.lean += 3 * (b - a)
      }
    }
  ],
  listen: [
    {
      name: 'penche la tête',
      dur: 2400,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.3)
        t.tilt += 11 * e * fx.side
        t.gazeX -= 8 * e * fx.side
      }
    },
    {
      name: 'hoche deux fois',
      dur: 1000,
      run: (k, t, fx) => {
        if (fx.once(1)) fx.push('bob', 240)
        if (k > 0.42 && fx.once(2)) fx.push('bob', 210)
        t.tilt += 3 * env(k) * fx.side
      }
    },
    {
      name: 'se rapproche',
      dur: 2600,
      run: (k, t) => {
        const e = env(k, 0.25, 0.3)
        t.lean -= 6 * e
        t.eyeSize += 0.12 * e
        t.bob -= 6 * e
        t.perk += 0.02 * e
      }
    },
    {
      name: 'sautille',
      dur: 900,
      run: (k, t, fx) => {
        if (fx.once(1)) fx.push('squash', -1.6)
        if (k > 0.12 && fx.once(2)) fx.push('bob', -520)
        const e = env(k, 0.2, 0.5)
        t.footL += 14 * e
        t.footR += 14 * e
        t.armL += 30 * e
        t.armR -= 30 * e
      }
    },
    {
      name: 'hmm',
      dur: 2000,
      run: (k, t, fx) => {
        const e = env(k, 0.25, 0.3)
        t.eyeOpen -= 0.4 * e
        t.tilt += 6 * e * fx.side
        fx.mouth = { open: 0.12 * e, wide: -0.7 }
      }
    }
  ],
  // Travail : il est affairé (frappe, relit, écrit, s'essuie le front), plus qu'il ne rêvasse.
  think: [
    {
      name: 'rafale',
      dur: 2200,
      run: (k, t, fx) => {
        const e = env(k, 0.15, 0.25)
        fx.typing = 1 + 0.9 * e
        t.tongue = e
        t.lean -= 2 * e
        t.eyeOpen -= 0.15 * e
      }
    },
    {
      name: 'relit',
      dur: 2800,
      run: (k, t, fx) => {
        const e = env(k, 0.12, 0.2)
        fx.typing = 1 - e
        fx.gaze = true
        // Trois lignes lues de gauche à droite, puis un petit hochement satisfait.
        const line = Math.min(2, Math.floor(k * 3.3))
        const x = ((k * 3.3) % 1) * 34 - 17
        t.gazeX = mix(t.gazeX, k < 0.9 ? x : 0, e)
        t.gazeY = mix(t.gazeY, 8 + line * 5, e)
        t.lean += 2 * e
        if (k > 0.86 && fx.once(1)) fx.push('bob', 230)
      }
    },
    {
      name: 'écrit',
      dur: 2600,
      run: (k, t, fx) => {
        // La main gauche tient l'ardoise, la droite la lâche et écrit du doigt sur la face, par petits traits.
        const e = env(k, 0.2, 0.2)
        fx.typing = 1 - e
        fx.free[1] = e
        fx.write = e
        t.armR = mix(t.armR, 68 + Math.sin(k * 90) * 5 + Math.cos(k * 57) * 3, e)
        fx.gaze = true
        t.gazeX = mix(t.gazeX, 9 + Math.sin(k * 20) * 3, e)
        t.gazeY = mix(t.gazeY, 18, e)
        t.tilt += 4 * e
        t.tongue = e
      }
    },
    {
      name: 's’essuie le front',
      dur: 1900,
      run: (k, t, fx) => {
        fx.typing = 1 - env(k, 0.1, 0.15)
        const up = env(k, 0.2, 0.35)
        t.armR = mix(t.armR, 150 + Math.sin(k * 28) * 10 * up, up)
        t.eyeOpen -= 0.5 * up
        t.lean += 2 * up
        // Puis il souffle : il se tasse un peu.
        if (k > 0.65 && fx.once(1)) fx.push('squash', -0.8)
        fx.mouth = k > 0.62 && k < 0.85 ? { open: 0.3, wide: -0.7 } : null
      }
    },
    {
      name: 'se frotte les mains',
      dur: 1300,
      run: (k, t, fx) => {
        // Sans lâcher l'ardoise : les mains frottent ses bords, vite, l'une contre l'autre.
        const e = env(k, 0.2, 0.25)
        fx.typing = 1 - e
        t.armL += Math.sin(k * 70) * 6 * e
        t.armR += Math.sin(k * 70) * 6 * e
        t.eyeSize += 0.12 * e
        t.gazeY -= 10 * e
        t.lean -= 2 * e
      }
    },
    {
      name: 'se gratte la canopée',
      dur: 2400,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.25)
        fx.typing = 1 - e
        t.armR = mix(t.armR, -172 + Math.sin(k * 60) * 9, e)
        t.tilt -= 6 * e
        t.eyeOpen -= 0.25 * e
        fx.gaze = true
        t.gazeY = mix(t.gazeY, -12, e)
        fx.rustle = 0.5 * e
      }
    },
    {
      name: 'eurêka',
      dur: 1500,
      run: (k, t, fx) => {
        fx.typing = 0
        if (fx.once(1)) {
          fx.push('eyeSize', 5)
          fx.push('squash', -1.2)
        }
        if (k > 0.1 && fx.once(2)) fx.push('bob', -480)
        const e = env(k, 0.1, 0.35)
        t.eyeSize += 0.25 * e
        t.perk += 0.06 * e
        t.armR = mix(t.armR, -150, e)
        fx.gaze = true
        t.gazeX = mix(t.gazeX, 0, e)
        t.gazeY = mix(t.gazeY, -4, e)
        fx.mouth = { open: 0.5 * e, wide: -0.6 }
      }
    }
  ],
  speak: [
    {
      name: 'salue',
      dur: 1100,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.3)
        if (fx.side > 0) t.armR = mix(t.armR, -140 + Math.sin(k * 25) * 10, e)
        else t.armL = mix(t.armL, 140 + Math.sin(k * 25) * 10, e)
      }
    },
    {
      name: 'ouvre les bras',
      dur: 1300,
      run: (k, t) => {
        const e = env(k, 0.25, 0.3)
        t.armL = mix(t.armL, 100, e)
        t.armR = mix(t.armR, -100, e)
        t.perk += 0.03 * e
        t.squash += 0.02 * e
      }
    },
    {
      name: 'hausse les épaules',
      dur: 1100,
      run: (k, t, fx) => {
        const e = env(k, 0.25, 0.35)
        t.armL = mix(t.armL, 70, e)
        t.armR = mix(t.armR, -70, e)
        t.squash -= 0.04 * e
        t.canY -= 16 * e
        t.tilt += 7 * e * fx.side
        t.eyeOpen -= 0.15 * e
      }
    },
    {
      name: 'insiste',
      dur: 1600,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.3)
        t.tilt += 9 * e * fx.side
        t.lean += 2 * e * fx.side
      }
    },
    {
      name: 'se penche',
      dur: 1800,
      run: (k, t) => {
        const e = env(k, 0.25, 0.3)
        t.lean -= 5 * e
        t.eyeSize += 0.1 * e
      }
    },
    {
      name: 'rebondit',
      dur: 1000,
      run: (k, _t, fx) => {
        if (fx.once(1)) fx.push('bob', -260)
        if (k > 0.5 && fx.once(2)) fx.push('bob', -220)
      }
    }
  ]
}
/** Temps entre deux gestes, selon l'état (ms). */
const GAP: Record<MarkState, [number, number]> = { rest: [3500, 8000], intro: [99999, 99999], listen: [2200, 5000], think: [700, 2200], speak: [800, 2400] }

type Spring = { v: number; vel: number }
const spring = (v: number): Spring => ({ v, vel: 0 })
// Pas de calcul découpés (1/120 s au plus) : sans ça, les ressorts raides s'emballent quand l'affichage descend à 30 i/s.
const stepSpring = (s: Spring, target: number, k: number, c: number, dt: number) => {
  const n = Math.max(1, Math.ceil(dt * 120))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    s.vel += (k * (target - s.v) - c * s.vel) * h
    s.v += s.vel * h
  }
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
type Pt = { x: number; y: number }
const lerpP = (a: Pt, b: Pt, e: number): Pt => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e })
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
// Paume au bout d'un bras : l'épaule (déplacée par la courbure du corps), puis le bras tourné de `a` degrés.
const palm = (sh: Pt, d: Pt, a: number): Pt => {
  const r = (a * Math.PI) / 180
  return { x: sh.x + d.x - HAND * Math.sin(r), y: sh.y + d.y + HAND * Math.cos(r) }
}
// Enfoncement d'une frappe (ms depuis le coup) : appui vif, relâchement un peu plus lent.
const press = (e: number) => (e < 0 ? 0 : e < 45 ? e / 45 : e < 150 ? 1 - (e - 45) / 105 : 0)

export function Esprit({ state, size, levels }: { state: MarkState; size: number; levels?: (n: number) => number[] }) {
  const root = useRef<SVGSVGElement>(null)
  const stateRef = useRef(state)
  const levelsRef = useRef(levels)
  levelsRef.current = levels
  const id = useId().replace(/:/g, '')
  const kick = useRef<MarkState | null>(null)
  if (stateRef.current !== state) {
    kick.current = state
    stateRef.current = state
  }

  useEffect(() => {
    const svg = root.current
    if (!svg) return
    const all = (sel: string) => Array.from(svg.querySelectorAll<SVGGraphicsElement>(sel))
    const el = {
      all: all('.e-all'),
      body: all('.e-body'),
      can: all('.e-can'),
      lobes: LOBES.map((_, i) => all(`.e-lobe${i}`)),
      footL: all('.e-footL'),
      footR: all('.e-footR'),
      armL: all('.e-armL'),
      armR: all('.e-armR'),
      face: all('.e-face'),
      eyes: all('.e-eye'),
      pupils: all('.e-pupil'),
      shut: all('.e-shut'),
      mouth: all('.e-mouth'),
      tongue: all('.e-tongue'),
      tongueOut: all('.e-tout'),
      tool: all('.e-tool'),
      lines: Array.from({ length: TOOL_LINES }, (_, i) => all(`.e-line${i}`)),
      caret: all('.e-caret'),
      thumbs: [all('.e-thumbL'), all('.e-thumbR')],
      dots: [all('.e-dotL'), all('.e-dotR')],
      glow: all('.e-glow'),
      glints: all('.e-glint'),
      leaf: all('.e-leaf')
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const first = stateRef.current
    const p = Object.fromEntries(KEYS.map((k) => [k, spring(POSES[first][k])])) as Record<keyof Pose, Spring>
    // Arrivée : il apparaît en se dépliant depuis le sol.
    const grow = spring(first === 'intro' ? 0 : 1)
    const can = { x: spring(0), y: spring(0), r: spring(0) }
    const lobes = LOBES.map(() => ({ x: spring(0), y: spring(0), s: spring(1) }))
    let prevTop = { x: 0, y: 0 }
    let prevVis = { x: 0, y: 0 }
    // Souplesse du corps : courbure du haut, tassement, ventre.
    const soft = { bend: spring(0), sag: spring(0), bulge: spring(0) }
    let last = performance.now()
    let blinkAt = last + rnd(1500, 3500)
    let blinkStart = -1
    let doubleBlink = false
    let saccadeAt = last
    let sacc = { x: 0, y: 0 }
    let act: { a: Act; start: number; side: number; fired: Set<number> } | null = null
    let actAt = last + rnd(1200, 2400)
    let lastAct = ''
    let voice = 0
    // Lignes de l'ardoise : chaque frappe ajoute un caractère à la dernière ; pleine, tout remonte d'un cran.
    const lines = [170, 110, 190, 20]
    // Chaque ligne garde ses mots en remontant.
    const words = [0, 1, 2, 3]
    let lineEnd = LINE_MAX * 0.8
    // L'ardoise suit les prises à travers un ressort : la frappe la secoue sans la faire trembler.
    const tool = { x: spring(TOOL.x), y: spring(TOOL.y), a: spring(0) }
    const taps = [-1e9, -1e9]
    let tapHand = 0
    let tapAt = last
    let writeAt = last
    let lastKey = -1e9
    let flash = 0
    const typeKey = (now: number) => {
      lines[TOOL_LINES - 1] += rnd(12, 24)
      if (lines[TOOL_LINES - 1] > lineEnd) {
        lines.shift()
        lines.push(0)
        words.push(words.shift() ?? 0)
        lineEnd = LINE_MAX * rnd(0.6, 1)
      }
      lastKey = now
      flash = 1
    }
    // Débit de parole inventé quand on n'a pas le volume réel : syllabes de longueur et de forme variées, petites pauses.
    const nextSyllable = (at: number) => {
      const pause = Math.random() < 0.12
      return { start: at, end: at + (pause ? rnd(180, 420) : rnd(120, 240)), pause, open: rnd(0.35, 1), wide: rnd(-0.6, 0.9) }
    }
    let syl = nextSyllable(last)
    // Vraie voix : ouvre sur chaque syllabe, referme entre deux (voir syllables.ts).
    const follow = syllableFollower()
    let accentAt = 0
    const mouth = { open: spring(0), wide: spring(0), smile: spring(SMILE[first]), base: spring(MOUTH_W[first]) }
    let raf = 0

    const frame = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000)
      last = now
      const s = now / 1000
      const st = stateRef.current

      // Impulsion d'anticipation au changement d'état : il se tasse, puis rebondit dans la nouvelle pose.
      if (kick.current) {
        const to = kick.current
        kick.current = null
        p.squash.vel -= to === 'rest' ? 0.4 : 1.4
        if (to === 'listen') {
          p.bob.vel -= 420
          p.eyeSize.vel += 4
        }
        if (to === 'think') can.r.vel += 40
        if (to === 'speak') p.bob.vel -= 200
        if (to === 'intro') grow.v = Math.min(grow.v, 0.2)
        saccadeAt = now
        act = null
        actAt = now + rnd(700, 1500)
      }

      // Cibles du moment : la pose de l'état, plus la vie propre de l'état.
      const t: Pose = { ...POSES[st] }
      if (st === 'rest') {
        t.lean += Math.sin(s * 0.45) * 2
        t.squash += Math.sin(s * 1.6) * 0.022 // grande respiration de sommeil
      } else {
        t.squash += Math.sin(s * 3.2) * 0.008
      }
      if (st === 'listen') t.lean += Math.sin(s * 0.8) * 1.5
      if (st === 'speak') t.lean += Math.sin(s * 1.3) * 2.5

      // Geste en cours, ou tirage du suivant.
      const fx: Fx = { gaze: false, mouth: null, rustle: 0, once: () => false, push: () => {}, side: 1, typing: 1, free: [0, 0], write: 0 }
      const list = reduce ? undefined : ACTS[st]
      if (!act && list && now > actAt) {
        const pool = list.filter((x) => x.name !== lastAct)
        const pick = pool[Math.floor(Math.random() * pool.length)]
        act = { a: pick, start: now, side: Math.random() < 0.5 ? -1 : 1, fired: new Set() }
        lastAct = pick.name
      }
      if (act) {
        const k = (now - act.start) / act.a.dur
        if (k >= 1) {
          act = null
          const [g0, g1] = GAP[st]
          actAt = now + rnd(g0, g1)
        } else {
          const cur = act
          fx.side = cur.side
          fx.once = (n) => (cur.fired.has(n) ? false : (cur.fired.add(n), true))
          fx.push = (key, v) => {
            p[key].vel += v
          }
          cur.a.run(k, t, fx)
        }
      }
      // Voix : l'énergie ouvre la bouche, le timbre lui donne sa forme (graves : ronde, aigus : étirée).
      // Sans volume réel (bulle du compagnon), le débit inventé : attaque nette, tenue, relâchement.
      let say = 0
      let wide = 0
      if (st === 'speak') {
        const lv = levelsRef.current?.(8)
        if (lv && lv.length === 8) {
          const low = (lv[3] + lv[4]) / 2
          const mid = (lv[2] + lv[5]) / 2
          const high = (lv[0] + lv[1] + lv[6] + lv[7]) / 4
          say = follow((low + mid + high) / 3, dt)
          wide = Math.max(-0.7, Math.min(1, (high * 1.4 + mid * 0.4) / (low + 0.05) - 0.9))
        } else {
          if (now > syl.end) syl = nextSyllable(now)
          const k = (now - syl.start) / (syl.end - syl.start)
          const env = syl.pause ? 0 : k < 0.25 ? k / 0.25 : 1 - Math.max(0, (k - 0.55) / 0.45) * 0.85
          say = syl.open * env
          wide = syl.wide
        }
      } else if (fx.mouth) {
        say = fx.mouth.open
        wide = fx.mouth.wide
      }
      // Une syllabe qui part fort : la tête l'accompagne d'un petit coup.
      if (say - voice > 0.35 && now > accentAt) {
        p.bob.vel -= 160 * say
        p.lean.vel += rnd(-14, 14)
        accentAt = now + 180
      }
      voice += (say - voice) * Math.min(1, dt * (say > voice ? 30 : 14))

      if (st === 'speak') {
        t.squash += voice * 0.05
        t.bob -= voice * 18
      }
      // Regard : petits sauts (saccades) autour de la direction de l'état, sauf yeux fermés.
      if (now > saccadeAt) {
        const amp = st === 'think' ? 1 : st === 'listen' ? 0.4 : 0.6
        sacc = st === 'think' ? { x: rnd(-9, 9), y: rnd(-3, 4) } : { x: rnd(-10, 10) * amp, y: rnd(-6, 6) * amp }
        saccadeAt = now + (st === 'think' ? rnd(450, 1100) : rnd(1400, 3600))
      }
      if (st !== 'rest' && !fx.gaze) {
        t.gazeX += sacc.x
        t.gazeY += sacc.y
      }

      for (const k of KEYS) {
        const [kk, cc] = K[k] ?? [130, 14]
        stepSpring(p[k], t[k], kk, cc, dt)
      }
      stepSpring(grow, 1, 90, 10, dt)
      const P = Object.fromEntries(KEYS.map((k) => [k, p[k].v])) as Pose

      // Corps : inclinaison et écrasement autour des pieds.
      const sy = P.squash * grow.v
      const sx = (1 + (1 - P.squash) * 0.7) * grow.v
      const allT = `translate(0 ${P.bob}) rotate(${P.lean * 0.4} ${BASE.x} ${BASE.y}) translate(${BASE.x} ${BASE.y}) scale(${sx} ${sy}) translate(${-BASE.x} ${-BASE.y})`
      el.all.forEach((g) => g.setAttribute('transform', allT))

      // Corps souple : le pied pivote un peu, le reste de l'inclinaison est une courbure ; quand le corps bouge,
      // le haut traîne derrière le bas puis rattrape (gelée), et le ventre s'élargit quand il se tasse.
      const rad = (P.lean * 0.4 * Math.PI) / 180
      const h = BASE.y - ANCHOR.y
      const top = { x: Math.sin(rad) * h * sy, y: P.bob + (1 - Math.cos(rad)) * h + (1 - sy) * h }
      const dTop = { x: top.x - prevTop.x, y: top.y - prevTop.y }
      prevTop = top
      soft.bend.v -= dTop.x * 0.9
      soft.sag.v -= dTop.y * 0.45
      stepSpring(soft.bend, P.lean * 10, 140, 9, dt)
      stepSpring(soft.sag, 0, 170, 10, dt)
      stepSpring(soft.bulge, Math.max(-0.04, soft.sag.v * 0.004 + (1 - P.squash) * 1.6), 180, 10, dt)
      const warp: Warp = (x, y) => {
        const u = Math.max(0, (BASE.y - y) / (BASE.y - BODY_TOP))
        const g = Math.exp(-(((y - 1380) / 180) ** 2))
        return { x: soft.bend.v * u * u + (x - BASE.x) * soft.bulge.v * g, y: soft.sag.v * u }
      }
      // Pente de la courbe à une hauteur donnée (degrés) : ce qui est posé dessus tourne avec.
      const slope = (y: number) => {
        const u = Math.max(0, (BASE.y - y) / (BASE.y - BODY_TOP))
        return ((2 * soft.bend.v * u) / (BASE.y - BODY_TOP)) * (180 / Math.PI)
      }
      const bd = bodyPath(warp)
      el.body.forEach((g) => g.setAttribute('d', bd))
      const DA = warp(ANCHOR.x, 760)
      const DF = warp(1030, 990)

      // Canopée : où le haut du corps est allé cette image, elle y va avec retard (inertie), puis oscille.
      const vis = { x: top.x + DA.x, y: top.y + DA.y }
      const dVis = { x: vis.x - prevVis.x, y: vis.y - prevVis.y }
      prevVis = vis
      can.x.v -= dVis.x * 0.5
      can.y.v -= dVis.y * 0.6
      can.r.v -= dVis.x * 0.06
      const cprev = { x: can.x.v, y: can.y.v }
      stepSpring(can.x, 0, 95, 7, dt)
      stepSpring(can.y, 0, 110, 7.5, dt)
      stepSpring(can.r, 0, 80, 6, dt)
      const dCan = { x: can.x.v - cprev.x, y: can.y.v - cprev.y }
      const canT = `translate(${can.x.v + DA.x} ${can.y.v + P.canY + DA.y}) rotate(${can.r.v + P.tilt + slope(760)} ${ANCHOR.x} ${ANCHOR.y}) translate(${ANCHOR.x} 820) scale(${P.perk}) translate(${-ANCHOR.x} -820)`
      el.can.forEach((g) => g.setAttribute('transform', canT))

      // Lobes : chacun traîne un peu derrière la canopée ; en réflexion le feuillage frissonne, en parole il vibre.
      LOBES.forEach(([cx, cy], i) => {
        const L = lobes[i]
        const far = Math.hypot(cx - ANCHOR.x, cy - ANCHOR.y) / 500
        L.x.v -= dCan.x * 0.9 * far
        L.y.v -= dCan.y * 0.9 * far
        let ts = 1
        if (!reduce && i > 0) {
          if (st === 'think') ts += Math.sin(s * 5 - i * 0.9) * 0.035
          if (st === 'speak') ts += voice * 0.04 * Math.sin(i * 2.3 + s * 3)
          if (st === 'listen') ts += Math.sin(s * 1.8 + i) * 0.012
          if (st === 'rest') ts += Math.sin(s * 1.6 - far * 2) * 0.012
          ts += Math.sin(s * 16 - i * 1.3) * 0.05 * fx.rustle
        }
        stepSpring(L.x, 0, 170, 9, dt)
        stepSpring(L.y, 0, 170, 9, dt)
        stepSpring(L.s, ts, 200, 14, dt)
        const tr = `translate(${L.x.v} ${L.y.v}) translate(${cx} ${cy}) scale(${L.s.v}) translate(${-cx} ${-cy})`
        el.lobes[i].forEach((g) => g.setAttribute('transform', tr))
      })

      el.footL.forEach((g) => g.setAttribute('transform', `translate(0 ${-Math.max(0, P.footL)})`))
      el.footR.forEach((g) => g.setAttribute('transform', `translate(0 ${-Math.max(0, P.footR)})`))
      // Ardoise portée : sa place vient des mains. Les paumes sont calculées depuis les bras (angle, épaule, courbure du
      // corps), sans la frappe ; une main loin de sa prise l'a lâchée.
      const tl = Math.max(0, Math.min(1.1, P.tool))
      const DL = warp(ARM_L.x, ARM_L.y)
      const DR = warp(ARM_R.x, ARM_R.y)
      const aL = P.armL + slope(ARM_L.y)
      const aR = P.armR + slope(ARM_R.y)
      const hL = palm(ARM_L, DL, aL)
      const hR = palm(ARM_R, DR, aR)
      const oL = palm(ARM_L, DL, POSES.think.armL + slope(ARM_L.y))
      const oR = palm(ARM_R, DR, POSES.think.armR + slope(ARM_R.y))
      const awayL = clamp01((Math.hypot(hL.x - oL.x, hL.y - oL.y) - 20) / 45)
      const awayR = clamp01((Math.hypot(hR.x - oR.x, hR.y - oR.y) - 20) / 45)
      const offL = Math.max(awayL, fx.free[0])
      const offR = Math.max(awayR, fx.free[1])
      // Deux mains : entre les deux. Une seule : elle pivote sur celle qui reste et penche du côté lâché. Aucune
      // (elle arrive ou repart) : à sa place contre le ventre.
      const both = offL * offR
      // Elle n'apparaît vraiment qu'une fois dans les mains (elle grandit à mesure qu'elles arrivent).
      const tv = tl * (1 - 0.85 * both)
      let gL = lerpP(hL, oL, both)
      let gR = lerpP(hR, oR, both)
      const a0 = Math.atan2(oR.y - oL.y, oR.x - oL.x)
      const W = Math.hypot(oR.x - oL.x, oR.y - oL.y)
      const dR = a0 + (DROOP * awayR * Math.PI) / 180
      gR = lerpP(gR, { x: gL.x + W * Math.cos(dR), y: gL.y + W * Math.sin(dR) }, offR * (1 - offL))
      const dL = a0 - (DROOP * awayL * Math.PI) / 180
      gL = lerpP(gL, { x: gR.x - W * Math.cos(dL), y: gR.y - W * Math.sin(dL) }, offL * (1 - offR))
      const ang = Math.atan2(gR.y - gL.y, gR.x - gL.x)
      stepSpring(tool.x, (gL.x + gR.x) / 2 - Math.sin(ang) * GRIP_Y, 240, 24, dt)
      stepSpring(tool.y, (gL.y + gR.y) / 2 + Math.cos(ang) * GRIP_Y, 240, 24, dt)
      stepSpring(tool.a, (ang * 180) / Math.PI, 240, 24, dt)

      // Frappe : les mains qui tiennent tapent la face du pouce, par petits coups, surtout en alternance et par
      // rafales. Chaque coup secoue l'ardoise et ajoute un caractère ; la main libre qui écrit en ajoute aussi.
      if (st === 'think' && !reduce && tl > 0.6) {
        if (fx.typing > 0.1 && now > tapAt) {
          const off = [offL, offR]
          let hnd = Math.random() < 0.8 ? 1 - tapHand : tapHand
          if (off[hnd] > 0.3) hnd = 1 - hnd
          if (off[hnd] <= 0.3) {
            tapHand = hnd
            taps[hnd] = now
            tool.y.vel += 70
            tool.a.vel += hnd ? 14 : -14
            p.bob.vel += 14
            typeKey(now)
          }
          const burst = 0.55 + 0.45 * Math.max(0, Math.sin(s * 1.7) * Math.sin(s * 0.63 + 1))
          tapAt = now + (Math.random() < 0.07 ? rnd(300, 650) : rnd(85, 170) / Math.min(1.9, fx.typing) / burst)
        }
        if (fx.write > 0.5 && now > writeAt) {
          tool.y.vel += 25
          typeKey(now)
          writeAt = now + rnd(130, 230)
        }
      }
      flash = Math.max(0, flash - dt * 7)
      const dTap = [press(now - taps[0]), press(now - taps[1])]
      const tux = Math.cos((tool.a.v * Math.PI) / 180)
      const tuy = Math.sin((tool.a.v * Math.PI) / 180)
      el.tool.forEach((g) => {
        g.setAttribute('opacity', String(clamp01((tv - 0.08) * 2)))
        g.setAttribute('transform', `translate(${tool.x.v} ${tool.y.v}) rotate(${tool.a.v}) translate(0 ${-GRIP_Y}) scale(${0.6 + 0.4 * tv} ${tv}) translate(0 ${GRIP_Y})`)
      })
      const curLine = TOOL_LINES - 1
      el.lines.forEach((ls, i) =>
        ls.forEach((g) => {
          g.setAttribute('x2', String(LINE_X + Math.max(0, lines[i])))
          g.setAttribute('stroke-dasharray', WORDS[words[i]])
          g.setAttribute('visibility', lines[i] < 2 ? 'hidden' : 'visible')
        })
      )
      // Curseur au bout de la ligne en cours : plein juste après un caractère, puis il clignote.
      el.caret.forEach((g) => {
        g.setAttribute('x', String(LINE_X + lines[curLine] + 14))
        g.setAttribute('opacity', now - lastKey < 500 || Math.sin(s * 9) > 0 ? '0.9' : '0')
      })
      const rL = aL + TAP_DEG * dTap[0]
      const rR = aR - TAP_DEG * dTap[1]
      el.armL.forEach((g) => g.setAttribute('transform', `translate(${ARM_L.x + DL.x} ${ARM_L.y + DL.y}) rotate(${rL})`))
      el.armR.forEach((g) => g.setAttribute('transform', `translate(${ARM_R.x + DR.x} ${ARM_R.y + DR.y}) rotate(${rR})`))
      // Pouces devant la face, posés vers l'intérieur : ils plongent sur l'écran à chaque coup (et s'y allument).
      const hands = [palm(ARM_L, DL, rL), palm(ARM_R, DR, rR)]
      ;[1, -1].forEach((dir, i) => {
        const H = hands[i]
        const d = dTap[i]
        const show = tl * (1 - (i ? offR : offL))
        const bx = H.x + dir * tux * 14 + tuy * 14
        const by = H.y + dir * tuy * 14 - tux * 14
        el.thumbs[i].forEach((g) => {
          g.setAttribute('opacity', show < 0.05 ? '0' : '1')
          g.setAttribute('transform', `translate(${bx} ${by}) rotate(${tool.a.v + dir * 24 * d}) scale(${dir * (1 - 0.18 * d) * Math.min(1, show * 1.4)} 1)`)
        })
        const tip = 54 * (1 - 0.18 * d)
        const ta = ((tool.a.v + dir * 24 * d) * Math.PI) / 180
        el.dots[i].forEach((g) => {
          g.setAttribute('transform', `translate(${bx + dir * Math.cos(ta) * tip} ${by + dir * Math.sin(ta) * tip + 6})`)
          g.setAttribute('opacity', String(0.75 * d * show))
        })
      })
      // L'écran éclaire le bas du visage et se reflète dans les yeux.
      const lit = tv * (0.85 + 0.15 * flash)
      el.glow.forEach((g) => {
        g.setAttribute('opacity', String(0.3 * lit))
        g.setAttribute('transform', `translate(${tool.x.v + tuy * 190} ${tool.y.v - tux * 190}) rotate(${tool.a.v})`)
      })
      el.glints.forEach((g) => g.setAttribute('opacity', String(0.85 * lit)))

      // Clignement : fermeture rapide, réouverture plus douce ; parfois deux d'affilée.
      if (blinkStart < 0 && now > blinkAt) {
        blinkStart = now
        doubleBlink = Math.random() < 0.25
      }
      let blink = 0
      if (blinkStart >= 0) {
        const e = now - blinkStart
        const span = doubleBlink ? 520 : 240
        if (e < 70) blink = e / 70
        else if (e < 110) blink = 1
        else if (e < 240) blink = 1 - (e - 110) / 130
        else if (doubleBlink && e < 310) blink = (e - 240) / 70
        else if (doubleBlink && e < 350) blink = 1
        else if (doubleBlink && e < span) blink = 1 - (e - 350) / 170
        if (e >= span) {
          blinkStart = -1
          blinkAt = now + rnd(2200, 6000)
        }
      }
      const open = Math.max(0, Math.min(1.1, P.eyeOpen)) * (1 - blink)
      el.face.forEach((g) => g.setAttribute('transform', `translate(${DF.x} ${DF.y}) rotate(${P.tilt * 0.8 + slope(990)} ${ANCHOR.x} ${ANCHOR.y}) translate(${P.gazeX * 0.35} ${P.gazeY * 0.3})`))
      el.eyes.forEach((g, i) => {
        const e = EYES[i % 2]
        g.setAttribute('transform', `translate(${e.x} ${e.y}) scale(${P.eyeSize} ${P.eyeSize * Math.max(0.05, open)}) translate(${-e.x} ${-e.y})`)
        g.setAttribute('opacity', open < 0.12 ? '0' : '1')
      })
      el.pupils.forEach((g) => g.setAttribute('transform', `translate(${P.gazeX * 0.4} ${P.gazeY * 0.4})`))
      el.shut.forEach((g) => g.setAttribute('opacity', String(Math.max(0, Math.min(1, 1 - open * 6)))))
      // Bouche dessinée : deux lèvres entre deux commissures. Le contour épais et arrondi en fait un point au repos.
      stepSpring(mouth.open, say, 900, 46, dt)
      stepSpring(mouth.wide, wide, 350, 32, dt)
      stepSpring(mouth.smile, SMILE[st], 200, 22, dt)
      stepSpring(mouth.base, MOUTH_W[st], 200, 22, dt)
      const to = Math.max(0, Math.min(1, P.tongue))
      el.tongueOut.forEach((g) => {
        g.setAttribute('opacity', to < 0.05 ? '0' : '1')
        g.setAttribute('transform', `translate(13 2) scale(${to}) translate(-13 -2)`)
      })
      const o = Math.max(0, Math.min(1.1, mouth.open.v))
      const wd = mouth.wide.v
      const mw = mouth.base.v + o * (20 + wd * 14)
      const mh = o * (40 - wd * 10)
      const c = mouth.smile.v * (1 - o * 0.6)
      const uy = c * 0.6 - mh * 0.3
      const ly = c * 0.6 + mh * 1.15
      const md = `M${-mw} ${-c}C${-mw * 0.55} ${uy} ${mw * 0.55} ${uy} ${mw} ${-c}C${mw * 0.7} ${ly} ${-mw * 0.7} ${ly} ${-mw} ${-c}Z`
      el.mouth.forEach((g) => g.setAttribute('d', md))
      el.tongue.forEach((g) => {
        g.setAttribute('cy', String(c * 0.6 + mh * 0.8))
        g.setAttribute('rx', String(mw * 0.6))
        g.setAttribute('ry', String(mh * 0.4))
        g.setAttribute('opacity', mh > 14 ? '1' : '0')
      })

      // Feuille de réflexion : elle se détache de la canopée, tombe en se balançant, s'efface, recommence.
      const lf = Math.max(0, Math.min(1, P.leaf))
      el.leaf.forEach((g) => {
        if (lf < 0.02) {
          g.setAttribute('opacity', '0')
          return
        }
        const c = (s % 3.6) / 3.6
        const x = 1180 + c * 260 + Math.sin(c * Math.PI * 3) * 70
        const y = 300 + c * 620
        const fade = Math.min(1, c * 6) * Math.min(1, (1 - c) * 4)
        g.setAttribute('opacity', String(lf * fade))
        g.setAttribute('transform', `translate(${x} ${y}) rotate(${Math.sin(c * Math.PI * 3) * 50 + c * 120})`)
      })

    }
    // Une erreur dans une image ne doit jamais figer le personnage : on la signale une fois et la boucle continue.
    let warned = false
    const tick = (now: number) => {
      try {
        frame(now)
      } catch (e) {
        if (!warned) console.error('Esprit :', e)
        warned = true
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const lobeShapes = (extra?: { stroke: string; strokeWidth: number }) =>
    LOBES.map(([cx, cy, r], i) => (
      <g key={i} className={`e-lobe${i}`}>
        {i === 0 ? <ellipse cx={cx} cy={cy} rx={420} ry={150} {...extra} /> : <circle cx={cx} cy={cy} r={r} {...extra} />}
      </g>
    ))
  const gap = { stroke: 'black', strokeWidth: 26 }
  const arms = (fill: string, extra?: typeof gap) => (
    <>
      <path className="e-armL" d={extra ? ARM_GAP : ARM} fill={fill} transform={`translate(${ARM_L.x} ${ARM_L.y}) rotate(${POSES.rest.armL})`} {...extra} />
      <path className="e-armR" d={extra ? ARM_GAP : ARM} fill={fill} transform={`translate(${ARM_R.x} ${ARM_R.y}) rotate(${POSES.rest.armR})`} {...extra} />
    </>
  )
  const box = { x: -400, y: -400, width: 2800, height: 2800 }

  return (
    <svg ref={root} className="ch ch-esprit" viewBox="140 110 1650 1650" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={`${id}m`}>
          <path className="e-mouth" />
        </clipPath>
        <clipPath id={`${id}v`}>
          <path className="e-body" d={BODY} />
        </clipPath>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor={SCREEN} stopOpacity="1" />
          <stop offset="1" stopColor={SCREEN} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4A3A33" />
          <stop offset="1" stopColor="#2E2421" />
        </linearGradient>
        <mask id={`${id}b`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          <g className="e-can" fill="black">{lobeShapes(gap)}</g>
          {arms('black', gap)}
        </mask>
        <mask id={`${id}f`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          <path className="e-body" d={BODY} fill="black" {...gap} />
        </mask>
        <mask id={`${id}a`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          <g className="e-can" fill="black">{lobeShapes(gap)}</g>
        </mask>
      </defs>
      <g className="e-leaf" opacity="0">
        <path d={LEAF} fill={COLOR} />
      </g>
      <g className="e-all">
        <g mask={`url(#${id}f)`}>
          <ellipse className="e-footL" cx={870} cy={1640} rx={72} ry={58} fill={COLOR} />
          <ellipse className="e-footR" cx={1110} cy={1645} rx={70} ry={55} fill={COLOR} />
        </g>
        <g mask={`url(#${id}b)`}>
          <path className="e-body" d={BODY} fill={COLOR} />
          <g className="e-face">
            {EYES.map((e, i) => (
              <g key={i}>
                <g className="e-eye">
                  <g className="e-pupil">
                    <circle cx={e.x} cy={e.y} r={33} fill={INK} />
                    <rect className="e-glint" x={e.x - 12} y={e.y + 11} width={24} height={9} rx={4.5} fill={SCREEN} opacity="0" />
                  </g>
                </g>
                <path className="e-shut" d={`M${e.x - 40} ${e.y - 4}Q${e.x} ${e.y + 30} ${e.x + 40} ${e.y - 4}`} stroke={INK} strokeWidth={14} fill="none" strokeLinecap="round" opacity="0" />
              </g>
            ))}
            <g transform={`translate(${MOUTH.x} ${MOUTH.y})`}>
              <ellipse className="e-tout" cx={13} cy={14} rx={10} ry={11} fill={TONGUE} stroke={INK} strokeWidth={5} opacity="0" />
              <path className="e-mouth" d="M-4 0C-2 0 2 0 4 0C3 0-3 0-4 0Z" fill={INK} stroke={INK} strokeWidth={13} strokeLinejoin="round" />
              <ellipse className="e-tongue" cx={0} cy={0} rx={0} ry={0} fill={TONGUE} clipPath={`url(#${id}m)`} opacity="0" />
            </g>
          </g>
          <g clipPath={`url(#${id}v)`}>
            <ellipse className="e-glow" cx={0} cy={0} rx={310} ry={210} fill={`url(#${id}g)`} opacity="0" />
          </g>
        </g>
        <g className="e-tool" opacity="0" transform={`translate(${TOOL.x} ${TOOL.y})`}>
          <rect x={-TOOL.w / 2} y={-TOOL.h / 2} width={TOOL.w} height={TOOL.h} rx={28} fill="#231B18" />
          <rect x={-TOOL.w / 2 + 14} y={-TOOL.h / 2 + 14} width={TOOL.w - 28} height={TOOL.h - 28} rx={18} fill={`url(#${id}s)`} />
          {Array.from({ length: TOOL_LINES }, (_, i) => (
            <line key={i} className={`e-line${i}`} x1={LINE_X} x2={LINE_X} y1={-49 + i * 34} y2={-49 + i * 34} stroke={SCREEN} strokeWidth={14} strokeLinecap="round" strokeDasharray={WORDS[i]} opacity={i === TOOL_LINES - 1 ? 0.95 : 0.55} visibility="hidden" />
          ))}
          <rect className="e-caret" x={LINE_X} y={-49 + (TOOL_LINES - 1) * 34 - 12} width={6} height={24} rx={3} fill={SCREEN} opacity="0" />
        </g>
        {[0, 1].map((i) => (
          <circle key={i} className={i ? 'e-dotR' : 'e-dotL'} cx={0} cy={0} r={13} fill={SCREEN} opacity="0" />
        ))}
        <g mask={`url(#${id}a)`}>{arms(COLOR)}</g>
        {[0, 1].map((i) => (
          <g key={i} className={i ? 'e-thumbR' : 'e-thumbL'} opacity="0">
            <ellipse cx={28} cy={0} rx={31} ry={15} fill={COLOR} stroke={INK} strokeWidth={6} />
          </g>
        ))}
        <g className="e-can" fill={COLOR}>{lobeShapes()}</g>
      </g>
    </svg>
  )
}
