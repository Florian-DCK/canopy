import { useEffect, useId, useRef } from 'react'

// Plume, la petite chouette : une boule bleu nuit au ventre clair, construite pièce par pièce pour être animée.
// Pièces : un corps (chemin déformable), un ventre, deux aigrettes de trois plumes chacune, deux ailes articulées
// à l'épaule, deux pattes à trois doigts, un disque facial avec de grands yeux ambrés à paupières, un bec qui sert
// de bouche. Les traits sombres entre les pièces sont des masques : ils marchent sur n'importe quel fond.
//
// Mouvement : tout passe par des ressorts qui ne sont jamais remis à zéro. Un changement d'état ne fait que déplacer
// les cibles (et donner une impulsion d'anticipation) ; la pose en cours rejoint la nouvelle sans saut. Les aigrettes
// suivent la tête avec retard (inertie), chaque plume avec le sien selon sa longueur.

export type PlumeState = 'rest' | 'intro' | 'listen' | 'think' | 'speak'

const COLOR = '#2E4A7A'
const COLOR_BACK = '#263F69' // plumes d'arrière-plan des aigrettes, un ton plus sombre pour la profondeur
const BELLY = '#E8D9B8'
const CHEVRON = '#C8B28B'
const ORANGE = '#E08A3C'
const ORANGE_D = '#B9662B'
const FACE = '#3D5D93'
const LID = '#3A5B90'
const AMBER = '#F2A93B'
const AMBER_D = '#C87D1E'
const INK = '#0E1320'
const TONGUE = '#C4566A'
const WING_LINE = '#5A7CB5'
const BASE = { x: 1000, y: 1690 }
const ANCHOR = { x: 1000, y: 1000 }
const BODY_TOP = 600

// Contour fermé lisse (Catmull-Rom converti en courbes de Bézier) : [x0 y0, puis c1 c2 p par segment].
const ring = (cx: number, cy: number, rx: number, ryTop: number, ryBot: number, n: number, flare = 0) => {
  const P = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    const s = Math.sin(a)
    return [cx + rx * (1 + flare * s) * Math.cos(a), cy + (s < 0 ? ryTop : ryBot) * s]
  })
  const out = [P[0][0], P[0][1]]
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n]
    const p1 = P[i]
    const p2 = P[(i + 1) % n]
    const p3 = P[(i + 2) % n]
    out.push(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1])
  }
  return out.map((v) => Math.round(v * 10) / 10)
}
// Le corps (une boule un peu plus large en bas) et le ventre se déforment à chaque image : on garde leurs points.
const BODY_PTS = ring(1000, 1150, 525, 550, 545, 14, 0.035)
const BELLY_PTS = ring(1000, 1455, 372, 335, 335, 12)
type Warp = (x: number, y: number) => { x: number; y: number }
const pathOf = (pts: number[], w: Warp) => {
  const q = (i: number) => {
    const d = w(pts[i], pts[i + 1])
    return `${(pts[i] + d.x).toFixed(1)} ${(pts[i + 1] + d.y).toFixed(1)}`
  }
  let d = `M${q(0)}`
  for (let i = 2; i + 5 < pts.length; i += 6) d += `C${q(i)} ${q(i + 2)} ${q(i + 4)}`
  return d + 'Z'
}
const still: Warp = () => ({ x: 0, y: 0 })
const BODY = pathOf(BODY_PTS, still)
const BELLY_D = pathOf(BELLY_PTS, still)
// Petites plumes en chevron sur le ventre : elles suivent la déformation du corps.
const CHEVRONS: [number, number][] = [
  [905, 1275],
  [1000, 1250],
  [1095, 1275],
  [950, 1370],
  [1050, 1370],
  [880, 1470],
  [1000, 1465],
  [1120, 1470]
]

// Aile : épaule arrondie (elle peut dépasser un peu du corps sans montrer de coupe), bout festonné en trois plumes.
const ARM = 'M-50 0C-56 90-64 190-50 252C-40 284-20 286-12 266C-2 292 18 290 24 266C36 282 56 270 56 244C64 186 58 90 50 0A50 50 0 0 0 -50 0Z'
// Le trait de séparation ne longe que la partie libre de l'aile : à l'épaule, aile et corps se fondent.
const ARM_GAP = 'M-57 120C-61 170-64 200-50 252C-40 284-20 286-12 266C-2 292 18 290 24 266C36 282 56 270 56 244C63 196 61 150 57 120Z'
const ARM_L = { x: 590, y: 1150 }
const ARM_R = { x: 1410, y: 1150 }
const FEET = [
  { x: 880, y: 1688 },
  { x: 1120, y: 1688 }
]
const EYE_R = 112
const EYES = [
  { x: 820, y: 930 },
  { x: 1180, y: 930 }
]
const MOUTH = { x: 1000, y: 1078 }
// Bec : sourire (commissures relevées) et largeur au repos selon l'état ; fermé au repos.
const SMILE: Record<PlumeState, number> = { rest: 0, intro: 6, listen: 8, think: -5, speak: 5 }
const MOUTH_W: Record<PlumeState, number> = { rest: 22, intro: 30, listen: 34, think: 28, speak: 30 }
// Mandibule supérieure : un crochet arrondi qui recouvre la lèvre du haut.
const BEAK_UP = 'M-20 -52C-8 -60 8 -60 20 -52C34 -42 42 -18 38 -4C30 10 12 22 0 36C-12 22 -30 10 -38 -4C-42 -18 -34 -42 -20 -52Z'
// Ardoise du travail, tenue devant le ventre ; des lignes s'y écrivent à la craie au rythme de la frappe.
const TOOL = { x: 1000, y: 1405, w: 410, h: 236 }
const TOOL_LINES = 4
const LINE_MAX = 300

// Aigrettes : trois plumes par côté. [base x, base y, angle (degrés, 0 = vers le haut), longueur, largeur, avant-plan].
const TUFT: [number, number, number, number, number, number][] = [
  [806, 702, -50, 185, 62, 0],
  [818, 690, -14, 210, 60, 0],
  [792, 700, -31, 300, 80, 1]
]
const FEATHERS = [...TUFT.map(([x, y, a, l, w, f]) => ({ x, y, a, l, w, f, side: -1 })), ...TUFT.map(([x, y, a, l, w, f]) => ({ x: 2000 - x, y, a: -a, l, w, f, side: 1 }))]
type V = [number, number]
const lerpV = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
// Découpe d'une courbe de Bézier cubique en t (de Casteljau).
const splitBez = (p: V[], t: number): [V[], V[]] => {
  const a = lerpV(p[0], p[1], t)
  const b = lerpV(p[1], p[2], t)
  const c = lerpV(p[2], p[3], t)
  const d = lerpV(a, b, t)
  const e = lerpV(b, c, t)
  const f = lerpV(d, e, t)
  return [
    [p[0], a, d, f],
    [f, e, c, p[3]]
  ]
}
const bezY = (p: V[], t: number) => splitBez(p, t)[0][3][1]
const C = (p: V[]) => `C${p[1][0].toFixed(1)} ${p[1][1].toFixed(1)} ${p[2][0].toFixed(1)} ${p[2][1].toFixed(1)} ${p[3][0].toFixed(1)} ${p[3][1].toFixed(1)}`
const CUT = -55
// Une plume, base en (0, 0), pointe vers le haut et un peu vers l'extérieur. Version « trait » : seulement la partie
// libre (au-dessus de CUT), pour que la base se fonde dans la tête sans trait de coupe.
const feather = (L: number, W: number, side: number, gap: boolean) => {
  const tx = side * L * 0.1
  const left: V[] = [[-W / 2, 34], [-W * 0.78, -L * 0.3], [tx - W * 0.32, -L * 0.78], [tx, -L]]
  const right: V[] = [[tx, -L], [tx + W * 0.32, -L * 0.78], [W * 0.78, -L * 0.3], [W / 2, 34]]
  if (!gap) return `M${-W / 2} 34${C(left)}${C(right)}Z`
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2
    if (bezY(left, m) > CUT) lo = m
    else hi = m
  }
  const l2 = splitBez(left, lo)[1]
  lo = 0
  hi = 1
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2
    if (bezY(right, m) < CUT) lo = m
    else hi = m
  }
  const r1 = splitBez(right, lo)[0]
  return `M${l2[0][0].toFixed(1)} ${l2[0][1].toFixed(1)}${C(l2)}${C(r1)}Z`
}
const FEATHER_D = FEATHERS.map((f) => feather(f.l, f.w, f.side, false))
const FEATHER_GAP = FEATHERS.map((f) => feather(f.l, f.w, f.side, true))

type Pose = {
  lean: number
  squash: number
  bob: number
  eyeOpen: number
  eyeSize: number
  /** Taille des pupilles (dilatées à l'écoute, serrées au travail). */
  pupil: number
  armL: number
  armR: number
  /** Aigrettes : échelle (dressées) et inclinaison vers l'extérieur (tombantes au repos). */
  perk: number
  ear: number
  /** La tête s'enfonce dans les épaules (positif) ou se hisse. */
  canY: number
  /** Rotation de la tête de chouette : le visage glisse sur le côté (-1 à 1). */
  turn: number
  gazeX: number
  gazeY: number
  tilt: number
  footL: number
  footR: number
  /** Langue tirée de concentration (0 à 1). */
  tongue: number
  /** Travail : l'ardoise tenue devant elle (0 à 1). */
  tool: number
}

const POSES: Record<PlumeState, Pose> = {
  rest: { lean: 2, squash: 0.975, bob: 8, eyeOpen: 0, eyeSize: 1, pupil: 1, armL: 12, armR: -12, perk: 0.95, ear: 20, canY: 20, turn: 0, gazeX: 0, gazeY: 6, tilt: 5, footL: 0, footR: 0, tongue: 0, tool: 0 },
  intro: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1, pupil: 1, armL: 18, armR: -18, perk: 1, ear: 0, canY: 0, turn: 0, gazeX: 0, gazeY: 0, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 0 },
  listen: { lean: -4, squash: 1.015, bob: -6, eyeOpen: 1.05, eyeSize: 1.16, pupil: 1.2, armL: 24, armR: -22, perk: 1.06, ear: -8, canY: -8, turn: 0, gazeX: -4, gazeY: 2, tilt: 10, footL: 0, footR: 0, tongue: 0, tool: 0 },
  think: { lean: -3, squash: 0.99, bob: 2, eyeOpen: 0.8, eyeSize: 0.97, pupil: 0.82, armL: -62, armR: 62, perk: 1, ear: 6, canY: 6, turn: 0, gazeX: 0, gazeY: 18, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 1 },
  speak: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1.06, pupil: 1, armL: 20, armR: -18, perk: 1.03, ear: -2, canY: 0, turn: 0, gazeX: 0, gazeY: 0, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 0 }
}
const KEYS = Object.keys(POSES.rest) as (keyof Pose)[]
// Raideur et amortissement par réglage : le corps avec un léger dépassement, le regard vif, les ailes souples.
const K: Partial<Record<keyof Pose, [number, number]>> = {
  gazeX: [520, 42],
  gazeY: [520, 42],
  armL: [110, 13],
  armR: [110, 13],
  eyeSize: [260, 16],
  pupil: [200, 20],
  turn: [150, 17],
  ear: [140, 9]
}

// Variations : chaque état a sa petite bibliothèque de gestes, tirés au hasard (jamais deux fois le même de suite),
// posés par-dessus la pose de l'état. Un geste ne fait que déplacer des cibles ou donner une impulsion.
type Fx = {
  /** Le geste dirige le regard (pas de saccades). */
  gaze: boolean
  /** Le geste ouvre le bec hors parole (bâillement, « oh ! »). */
  mouth: { open: number; wide: number } | null
  /** Plumes ébouriffées, 0 à 1. */
  rustle: number
  /** Vrai une seule fois par geste pour chaque numéro : les impulsions. */
  once: (n: number) => boolean
  push: (k: keyof Pose, v: number) => void
  /** Côté tiré au hasard au début du geste (-1 ou 1). */
  side: number
  /** Travail : intensité de la frappe des ailes (0 : posées, 1 : normal, plus : rafale). */
  typing: number
}
type Act = { name: string; dur: number; run: (k: number, t: Pose, fx: Fx) => void }
const ss = (x: number) => {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}
const env = (k: number, a = 0.2, r = 0.25) => (k < a ? ss(k / a) : k > 1 - r ? ss((1 - k) / r) : 1)
const mix = (a: number, b: number, e: number) => a + (b - a) * e

const ACTS: Partial<Record<PlumeState, Act[]>> = {
  rest: [
    {
      name: 'pique du nez',
      dur: 3200,
      run: (k, t, fx) => {
        const d = k < 0.75 ? ss(k / 0.75) : 1 - ss((k - 0.75) / 0.1)
        t.canY += 26 * d
        t.tilt += 8 * d * fx.side
        t.bob += 8 * d
        t.ear += 8 * d
        if (k > 0.75 && fx.once(1)) fx.push('bob', -280)
        if (k > 0.76 && k < 0.9) t.eyeOpen = 0.45 // elle entrouvre un œil… puis se rendort
      }
    },
    {
      name: 'bâille',
      dur: 2800,
      run: (k, t, fx) => {
        const e = env(k, 0.3, 0.3)
        t.armL += 75 * e
        t.armR -= 75 * e
        t.squash += 0.06 * e
        t.canY -= 16 * e
        t.tilt += 4 * e * fx.side
        t.ear -= 14 * e
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
        t.footL += 18 * a
        t.footR += 18 * b
        t.lean += 3 * (b - a)
      }
    },
    {
      name: 's’ébouriffe',
      dur: 1700,
      run: (k, t, fx) => {
        const e = env(k, 0.3, 0.4)
        t.squash -= 0.035 * e // elle gonfle ses plumes : plus ronde
        t.perk += 0.05 * e
        fx.rustle = 0.6 * e
        if (k > 0.55 && fx.once(1)) fx.push('squash', 0.6)
      }
    }
  ],
  listen: [
    {
      name: 'penche la tête',
      dur: 2400,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.3)
        t.tilt = mix(t.tilt, 17 * fx.side, e)
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
      name: 'tourne la tête',
      dur: 2300,
      run: (k, t, fx) => {
        const e = env(k, 0.14, 0.3)
        t.turn += fx.side * e
        fx.gaze = true
        t.gazeX = mix(t.gazeX, fx.side * 16, e)
        t.tilt -= 4 * e * fx.side
      }
    },
    {
      name: 'dresse les aigrettes',
      dur: 1800,
      run: (k, t, fx) => {
        const e = env(k, 0.12, 0.35)
        if (fx.once(1)) fx.push('ear', -160)
        t.ear -= 12 * e
        t.perk += 0.08 * e
        t.eyeSize += 0.1 * e
        t.canY -= 8 * e
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
        fx.mouth = { open: 0.14 * e, wide: -0.7 }
      }
    }
  ],
  // Travail : elle est affairée sur son ardoise (frappe, relit, écrit, s'essuie le front), elle ne rêvasse pas.
  think: [
    {
      name: 'rafale',
      dur: 2200,
      run: (k, t, fx) => {
        const e = env(k, 0.15, 0.25)
        fx.typing = 1 + 0.9 * e
        t.tongue = e
        t.lean -= 2 * e
        t.eyeOpen -= 0.12 * e
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
        t.gazeY = mix(t.gazeY, 10 + line * 5, e)
        t.lean += 2 * e
        if (k > 0.86 && fx.once(1)) fx.push('bob', 230)
      }
    },
    {
      name: 'écrit',
      dur: 2600,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.2)
        fx.typing = 1 - e
        t.armR = mix(t.armR, 66 + Math.sin(k * 90) * 7 + Math.cos(k * 57) * 5, e)
        t.armL = mix(t.armL, -50, e)
        fx.gaze = true
        t.gazeX = mix(t.gazeX, 9 + Math.sin(k * 20) * 3, e)
        t.gazeY = mix(t.gazeY, 20, e)
        t.tilt += 5 * e
        t.tongue = e
      }
    },
    {
      name: 's’essuie le front',
      dur: 1900,
      run: (k, t, fx) => {
        fx.typing = 1 - env(k, 0.1, 0.15)
        const up = env(k, 0.2, 0.35)
        // L'aile passe par l'extérieur et frotte le côté de la tête (jamais devant les yeux).
        t.armR = mix(t.armR, -142 + Math.sin(k * 28) * 10 * up, up)
        t.tilt += 6 * up
        t.eyeOpen -= 0.45 * up
        t.lean += 2 * up
        // Puis elle souffle : elle se tasse un peu.
        if (k > 0.65 && fx.once(1)) fx.push('squash', -0.8)
        fx.mouth = k > 0.62 && k < 0.85 ? { open: 0.3, wide: -0.7 } : null
      }
    },
    {
      name: 'se frotte les ailes',
      dur: 1300,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.25)
        fx.typing = 1 - e
        t.armL = mix(t.armL, -76 + Math.sin(k * 70) * 6, e)
        t.armR = mix(t.armR, 76 + Math.sin(k * 70) * 6, e)
        t.eyeSize += 0.12 * e
        t.gazeY -= 10 * e
        t.lean -= 2 * e
      }
    },
    {
      name: 'se gratte l’aigrette',
      dur: 2400,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.25)
        fx.typing = 1 - e
        t.armR = mix(t.armR, -168 + Math.sin(k * 60) * 9, e)
        t.tilt -= 7 * e
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
          fx.push('eyeSize', 4)
          fx.push('squash', -1.2)
          fx.push('ear', -200)
        }
        if (k > 0.1 && fx.once(2)) fx.push('bob', -480)
        const e = env(k, 0.1, 0.35)
        t.eyeSize += 0.2 * e
        t.pupil += 0.3 * e
        t.perk += 0.08 * e
        t.ear -= 14 * e
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
        if (fx.side > 0) t.armR = mix(t.armR, -140 + Math.sin(k * 25) * 12, e)
        else t.armL = mix(t.armL, 140 + Math.sin(k * 25) * 12, e)
      }
    },
    {
      name: 'ouvre les ailes',
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
        t.armL = mix(t.armL, 62, e)
        t.armR = mix(t.armR, -62, e)
        t.squash -= 0.04 * e
        t.canY += 14 * e
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
        t.ear -= 6 * e
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
const GAP: Record<PlumeState, [number, number]> = { rest: [3500, 8000], intro: [99999, 99999], listen: [2200, 5000], think: [700, 2200], speak: [800, 2400] }

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

// Paupières : celle du haut descend, celle du bas remonte ; fermées, elles se rejoignent en un arc tombant.
const lids = (e: { x: number; y: number }, open: number) => {
  const R = EYE_R
  const shut = 1 - Math.max(0, Math.min(1.1, open))
  const yU = mix(e.y - 1.45 * R, e.y - 0.22 * R, shut)
  const yL = mix(e.y + 1.05 * R, e.y - 0.2 * R, Math.max(0, shut))
  const x0 = e.x - R - 30
  const x1 = e.x + R + 30
  return {
    up: `M${x0} ${e.y - R - 40}L${x1} ${e.y - R - 40}L${x1} ${yU.toFixed(1)}Q${e.x} ${(yU + 0.7 * R).toFixed(1)} ${x0} ${yU.toFixed(1)}Z`,
    low: `M${x0} ${e.y + R + 40}L${x1} ${e.y + R + 40}L${x1} ${yL.toFixed(1)}Q${e.x} ${(yL + 0.7 * R).toFixed(1)} ${x0} ${yL.toFixed(1)}Z`
  }
}
// Bec : la bouche est un chemin à deux lèvres entre deux commissures, sous la mandibule supérieure ; la mandibule
// inférieure épouse la lèvre du bas et descend quand le bec s'ouvre.
const beak = (base: number, open: number, wide: number, smile: number) => {
  const o = Math.max(0, Math.min(1.1, open))
  const mw = base + o * (26 + wide * 16)
  const mh = o * (78 - wide * 16)
  const c = smile * (1 - o * 0.6)
  const uy = c * 0.6 - mh * 0.3
  const ly = c * 0.6 + mh * 1.15
  return {
    mw,
    mh,
    c,
    mouth: `M${(-mw).toFixed(1)} ${(-c).toFixed(1)}C${(-mw * 0.55).toFixed(1)} ${uy.toFixed(1)} ${(mw * 0.55).toFixed(1)} ${uy.toFixed(1)} ${mw.toFixed(1)} ${(-c).toFixed(1)}C${(mw * 0.7).toFixed(1)} ${ly.toFixed(1)} ${(-mw * 0.7).toFixed(1)} ${ly.toFixed(1)} ${(-mw).toFixed(1)} ${(-c).toFixed(1)}Z`,
    jaw: `M${(-mw).toFixed(1)} ${(-c).toFixed(1)}C${(-mw * 0.7).toFixed(1)} ${ly.toFixed(1)} ${(mw * 0.7).toFixed(1)} ${ly.toFixed(1)} ${mw.toFixed(1)} ${(-c).toFixed(1)}C${(mw * 0.62).toFixed(1)} ${(ly + 36).toFixed(1)} ${(-mw * 0.62).toFixed(1)} ${(ly + 36).toFixed(1)} ${(-mw).toFixed(1)} ${(-c).toFixed(1)}Z`
  }
}

export function Plume({ state, size, levels }: { state: PlumeState; size: number; levels?: (n: number) => number[] }) {
  const root = useRef<SVGSVGElement>(null)
  const stateRef = useRef(state)
  const levelsRef = useRef(levels)
  levelsRef.current = levels
  const init = useRef(state).current
  const id = useId().replace(/:/g, '')
  const kick = useRef<PlumeState | null>(null)
  if (stateRef.current !== state) {
    kick.current = state
    stateRef.current = state
  }

  useEffect(() => {
    const svg = root.current
    if (!svg) return
    const all = (sel: string) => Array.from(svg.querySelectorAll<SVGGraphicsElement>(sel))
    const el = {
      all: all('.p-all'),
      body: all('.p-body'),
      belly: all('.p-belly'),
      chevrons: CHEVRONS.map((_, i) => all(`.p-chev${i}`)),
      tuft: all('.p-tuft'),
      feathers: FEATHERS.map((_, i) => all(`.p-f${i}`)),
      feet: [all('.p-footL'), all('.p-footR')],
      armL: all('.p-armL'),
      armR: all('.p-armR'),
      chalk: all('.p-chalk'),
      face: all('.p-face'),
      eyes: [0, 1].map((i) => all(`.p-eye${i}`)),
      pupils: all('.p-pupil'),
      lidU: [0, 1].map((i) => all(`.p-lidU${i}`)),
      lidL: [0, 1].map((i) => all(`.p-lidL${i}`)),
      mouth: all('.p-mouth'),
      jaw: all('.p-jaw'),
      upper: all('.p-upper'),
      tongue: all('.p-tongue'),
      tongueOut: all('.p-tout'),
      tool: all('.p-tool'),
      lines: Array.from({ length: TOOL_LINES }, (_, i) => all(`.p-line${i}`))
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const first = stateRef.current
    const p = Object.fromEntries(KEYS.map((k) => [k, spring(POSES[first][k])])) as Record<keyof Pose, Spring>
    // Arrivée : elle apparaît en se dépliant depuis le sol.
    const grow = spring(first === 'intro' ? 0 : 1)
    const tuft = { x: spring(0), y: spring(0), r: spring(0) }
    const fr = FEATHERS.map(() => spring(0))
    let prevTop = { x: 0, y: 0 }
    let prevHead = { x: 0, y: 0, a: 0 }
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
    // Lignes de l'ardoise : la dernière s'allonge en tapant ; pleine, tout remonte d'un cran.
    const lines = [250, 160, 270, 30]
    // Débit de parole inventé quand on n'a pas le volume réel : syllabes de longueur et de forme variées, petites pauses.
    const nextSyllable = (at: number) => {
      const pause = Math.random() < 0.12
      return { start: at, end: at + (pause ? rnd(180, 420) : rnd(120, 240)), pause, open: rnd(0.35, 1), wide: rnd(-0.6, 0.9) }
    }
    let syl = nextSyllable(last)
    let accentAt = 0
    const mouth = { open: spring(0), wide: spring(0), smile: spring(SMILE[first]), base: spring(MOUTH_W[first]) }
    let raf = 0

    const frame = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000)
      last = now
      const s = now / 1000
      const st = stateRef.current

      // Impulsion d'anticipation au changement d'état : elle se tasse, puis rebondit dans la nouvelle pose.
      if (kick.current) {
        const to = kick.current
        kick.current = null
        p.squash.vel -= to === 'rest' ? 0.4 : 1.4
        if (to === 'listen') {
          p.bob.vel -= 420
          p.eyeSize.vel += 4
          p.ear.vel -= 120
        }
        if (to === 'think') tuft.r.vel += 40
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
        t.ear += Math.sin(s * 1.6 - 0.6) * 2
      } else {
        t.squash += Math.sin(s * 3.2) * 0.008
      }
      if (st === 'listen') t.lean += Math.sin(s * 0.8) * 1.5
      if (st === 'speak') t.lean += Math.sin(s * 1.3) * 2.5

      // Geste en cours, ou tirage du suivant.
      const fx: Fx = { gaze: false, mouth: null, rustle: 0, once: () => false, push: () => {}, side: 1, typing: 1 }
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
      // Travail : les ailes tapent en alternance sur l'ardoise (avec de petites pauses irrégulières), le corps suit.
      if (st === 'think' && !reduce) {
        const hz = 13 + fx.typing * 4
        const burst = 0.55 + 0.45 * Math.max(0, Math.sin(s * 1.7) * Math.sin(s * 0.63 + 1))
        const a = 9 * fx.typing * burst
        t.armL += Math.sin(s * hz) * a
        t.armR += Math.sin(s * hz + Math.PI) * a
        t.bob += Math.abs(Math.sin(s * hz)) * 3 * fx.typing * burst
        lines[TOOL_LINES - 1] += dt * 130 * fx.typing * burst
        if (lines[TOOL_LINES - 1] > LINE_MAX * (0.55 + 0.45 * Math.abs(Math.sin(s * 7.3)))) {
          lines.shift()
          lines.push(0)
        }
      }

      // Voix : l'énergie ouvre le bec, le timbre lui donne sa forme (graves : rond, aigus : étiré).
      // Sans volume réel, le débit inventé : attaque nette, tenue, relâchement, petites pauses.
      let say = 0
      let wide = 0
      if (st === 'speak') {
        const lv = levelsRef.current?.(8)
        if (lv && lv.length === 8) {
          const low = (lv[3] + lv[4]) / 2
          const mid = (lv[2] + lv[5]) / 2
          const high = (lv[0] + lv[1] + lv[6] + lv[7]) / 4
          say = Math.max(0, Math.min(1, ((low + mid + high) / 3 - 0.06) * 2.8))
          wide = Math.max(-0.7, Math.min(1, (high * 1.4 + mid * 0.4) / (low + 0.05) - 0.9))
        } else {
          if (now > syl.end) syl = nextSyllable(now)
          const k = (now - syl.start) / (syl.end - syl.start)
          const en = syl.pause ? 0 : k < 0.25 ? k / 0.25 : 1 - Math.max(0, (k - 0.55) / 0.45) * 0.85
          say = syl.open * en
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

      // Corps : inclinaison et écrasement autour des pattes.
      const sy = P.squash * grow.v
      const sx = (1 + (1 - P.squash) * 0.7) * grow.v
      const allT = `translate(0 ${P.bob}) rotate(${P.lean * 0.4} ${BASE.x} ${BASE.y}) translate(${BASE.x} ${BASE.y}) scale(${sx} ${sy}) translate(${-BASE.x} ${-BASE.y})`
      el.all.forEach((g) => g.setAttribute('transform', allT))

      // Corps souple : le bas pivote un peu, le reste de l'inclinaison est une courbure ; quand le corps bouge, le haut
      // traîne derrière le bas puis rattrape (gelée), et le ventre s'élargit quand elle se tasse.
      const rad = (P.lean * 0.4 * Math.PI) / 180
      const h = BASE.y - ANCHOR.y
      // Sans la croissance de l'arrivée : elle déplierait la gelée au lieu de la faire grandir.
      const top = { x: Math.sin(rad) * h * P.squash, y: P.bob + (1 - Math.cos(rad)) * h + (1 - P.squash) * h }
      const dTop = { x: top.x - prevTop.x, y: top.y - prevTop.y }
      prevTop = top
      soft.bend.v -= dTop.x * 0.9
      soft.sag.v -= dTop.y * 0.45
      stepSpring(soft.bend, P.lean * 10 + P.tilt * 2.5, 140, 9, dt)
      stepSpring(soft.sag, 0, 170, 10, dt)
      stepSpring(soft.bulge, Math.max(-0.04, soft.sag.v * 0.004 + (1 - P.squash) * 1.6), 180, 10, dt)
      const warp: Warp = (x, y) => {
        const u = Math.max(0, (BASE.y - y) / (BASE.y - BODY_TOP))
        const g = Math.exp(-(((y - 1420) / 230) ** 2))
        return { x: soft.bend.v * u * u + (x - BASE.x) * soft.bulge.v * g, y: soft.sag.v * u }
      }
      // Pente de la courbe à une hauteur donnée (degrés) : ce qui est posé dessus tourne avec.
      const slope = (y: number) => {
        const u = Math.max(0, (BASE.y - y) / (BASE.y - BODY_TOP))
        return ((2 * soft.bend.v * u) / (BASE.y - BODY_TOP)) * (180 / Math.PI)
      }
      const bd = pathOf(BODY_PTS, warp)
      el.body.forEach((g) => g.setAttribute('d', bd))
      const bl = pathOf(BELLY_PTS, warp)
      el.belly.forEach((g) => g.setAttribute('d', bl))
      CHEVRONS.forEach(([x, y], i) => {
        const d = warp(x, y)
        el.chevrons[i].forEach((g) => g.setAttribute('transform', `translate(${x + d.x} ${y + d.y}) rotate(${slope(y) * 0.6})`))
      })
      const DA = warp(ANCHOR.x, 760)
      const DF = warp(ANCHOR.x, 980)

      // Aigrettes : là où la tête est allée cette image, elles y vont avec retard (inertie), puis oscillent.
      const head = { x: top.x + DA.x + P.turn * 28, y: top.y + DA.y + P.canY, a: P.tilt + slope(760) }
      const dHead = { x: head.x - prevHead.x, y: head.y - prevHead.y, a: head.a - prevHead.a }
      prevHead = head
      tuft.x.v -= dHead.x * 0.45
      tuft.y.v -= dHead.y * 0.55
      tuft.r.v -= dHead.x * 0.05 + dHead.a * 0.3
      const tprev = { x: tuft.x.v, y: tuft.y.v, r: tuft.r.v }
      stepSpring(tuft.x, 0, 110, 7, dt)
      stepSpring(tuft.y, 0, 120, 7.5, dt)
      stepSpring(tuft.r, 0, 90, 6, dt)
      const dTuft = { x: tuft.x.v - tprev.x + dHead.x, r: tuft.r.v - tprev.r + dHead.a }
      const tuftT = `translate(${tuft.x.v + DA.x + P.turn * 28} ${tuft.y.v + P.canY + DA.y}) rotate(${tuft.r.v + P.tilt + slope(760)} ${ANCHOR.x} ${ANCHOR.y})`
      el.tuft.forEach((g) => g.setAttribute('transform', tuftT))
      // Chaque plume traîne derrière l'aigrette selon sa longueur ; elles frémissent quand elle s'ébouriffe ou parle.
      FEATHERS.forEach((f, i) => {
        const far = f.l / 260
        const R = fr[i]
        R.v -= (dTuft.r * 0.7 + dTuft.x * 0.09) * far
        let tr = 0
        if (!reduce) {
          tr += Math.sin(s * 31 + i * 1.7) * 7 * fx.rustle * far
          if (st === 'speak') tr += voice * 3 * Math.sin(i * 2.3 + s * 9)
          if (st === 'think') tr += Math.sin(s * 4 - i) * 1.2
        }
        stepSpring(R, tr, 190 / far, 5.5, dt)
        const ang = f.a + f.side * P.ear + R.v
        const tr2 = `translate(${f.x} ${f.y}) rotate(${ang}) scale(${P.perk})`
        el.feathers[i].forEach((g) => g.setAttribute('transform', tr2))
      })

      el.feet.forEach((fs, i) => {
        const lift = Math.max(0, i === 0 ? P.footL : P.footR)
        fs.forEach((g) => g.setAttribute('transform', `translate(0 ${-lift})`))
      })
      const DT = warp(TOOL.x, TOOL.y)
      const tl = Math.max(0, Math.min(1.1, P.tool))
      el.tool.forEach((g) => {
        g.setAttribute('opacity', tl < 0.03 ? '0' : String(Math.min(1, tl * 1.5)))
        g.setAttribute('transform', `translate(${DT.x} ${DT.y}) rotate(${slope(TOOL.y) * 0.6} ${TOOL.x} ${TOOL.y}) translate(${TOOL.x} ${TOOL.y + TOOL.h / 2}) scale(${0.6 + 0.4 * tl} ${tl}) translate(${-TOOL.x} ${-TOOL.y - TOOL.h / 2})`)
      })
      el.lines.forEach((ls, i) => ls.forEach((g) => g.setAttribute('width', String(Math.max(0, lines[i])))))
      el.chalk.forEach((g) => g.setAttribute('opacity', tl < 0.3 ? '0' : String(Math.min(1, (tl - 0.3) * 2))))
      const DL = warp(ARM_L.x, ARM_L.y)
      const DR = warp(ARM_R.x, ARM_R.y)
      el.armL.forEach((g) => g.setAttribute('transform', `translate(${ARM_L.x + DL.x} ${ARM_L.y + DL.y}) rotate(${P.armL + slope(ARM_L.y)})`))
      el.armR.forEach((g) => g.setAttribute('transform', `translate(${ARM_R.x + DR.x} ${ARM_R.y + DR.y}) rotate(${P.armR + slope(ARM_R.y)})`))

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
      el.face.forEach((g) =>
        g.setAttribute('transform', `translate(${DF.x + P.turn * 55} ${DF.y + P.canY}) rotate(${P.tilt * 0.8 + slope(980)} ${ANCHOR.x} ${ANCHOR.y}) translate(${P.gazeX * 0.35} ${P.gazeY * 0.3})`)
      )
      EYES.forEach((e, i) => {
        el.eyes[i].forEach((g) => g.setAttribute('transform', `translate(${e.x} ${e.y}) scale(${P.eyeSize}) translate(${-e.x} ${-e.y})`))
        const l = lids(e, open)
        el.lidU[i].forEach((g) => g.setAttribute('d', l.up))
        el.lidL[i].forEach((g) => g.setAttribute('d', l.low))
      })
      const pu = Math.max(0.5, P.pupil)
      el.pupils.forEach((g, i) => {
        const e = EYES[i % 2]
        g.setAttribute('transform', `translate(${P.gazeX * 0.6} ${P.gazeY * 0.6}) translate(${e.x} ${e.y}) scale(${pu}) translate(${-e.x} ${-e.y})`)
      })
      // Bec : deux lèvres entre deux commissures ; ouvert, on voit l'intérieur et la langue.
      stepSpring(mouth.open, say, 900, 46, dt)
      stepSpring(mouth.wide, wide, 350, 32, dt)
      stepSpring(mouth.smile, SMILE[st], 200, 22, dt)
      stepSpring(mouth.base, MOUTH_W[st], 200, 22, dt)
      const b = beak(mouth.base.v, mouth.open.v, mouth.wide.v, mouth.smile.v)
      el.mouth.forEach((g) => g.setAttribute('d', b.mouth))
      el.jaw.forEach((g) => g.setAttribute('d', b.jaw))
      el.upper.forEach((g) => g.setAttribute('transform', `translate(0 ${(-b.mh * 0.1).toFixed(1)})`))
      el.tongue.forEach((g) => {
        g.setAttribute('cy', String(b.c * 0.6 + b.mh * 0.8))
        g.setAttribute('rx', String(b.mw * 0.55))
        g.setAttribute('ry', String(b.mh * 0.38))
        g.setAttribute('opacity', b.mh > 22 ? '1' : '0')
      })
      const to = Math.max(0, Math.min(1, P.tongue))
      el.tongueOut.forEach((g) => {
        g.setAttribute('opacity', to < 0.05 ? '0' : '1')
        g.setAttribute('transform', `translate(26 4) scale(${to}) translate(-26 -4)`)
      })
    }
    // Une erreur dans une image ne doit jamais figer la chouette : on la signale une fois et la boucle continue.
    let warned = false
    const tick = (now: number) => {
      try {
        frame(now)
      } catch (e) {
        if (!warned) console.error('Plume :', e)
        warned = true
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Dessin initial complet (pose de l'état de départ) : la boucle d'animation prend ensuite le relais.
  const P0 = POSES[init]
  const gap = { stroke: 'black', strokeWidth: 26, strokeLinejoin: 'round' as const }
  const tufts = (fill: ((f: (typeof FEATHERS)[number]) => string) | null, extra?: typeof gap) => (
    <g className="p-tuft">
      {FEATHERS.map((f, i) => ({ f, i }))
        .sort((a, b) => a.f.f - b.f.f)
        .map(({ f, i }) => (
          <path key={i} className={`p-f${i}`} d={extra ? FEATHER_GAP[i] : FEATHER_D[i]} fill={fill ? fill(f) : 'black'} transform={`translate(${f.x} ${f.y}) rotate(${f.a + f.side * P0.ear}) scale(${P0.perk})`} {...extra} />
        ))}
    </g>
  )
  const wing = (cls: string, x: number, y: number, a: number, mask: boolean, chalk: boolean) =>
    mask ? (
      <path className={cls} d={ARM_GAP} fill="black" transform={`translate(${x} ${y}) rotate(${a})`} {...gap} />
    ) : (
      <g className={cls} transform={`translate(${x} ${y}) rotate(${a})`}>
        {chalk && <rect className="p-chalk" x={-11} y={250} width={22} height={58} rx={9} fill={BELLY} stroke={INK} strokeWidth={6} opacity="0" transform="rotate(-18 0 270)" />}
        <path d={ARM} fill={COLOR} />
        <path d="M-24 150Q-28 212-14 262M14 150Q20 212 22 260" stroke={WING_LINE} strokeWidth={9} strokeLinecap="round" fill="none" />
      </g>
    )
  const box = { x: -400, y: -400, width: 2800, height: 2800 }
  const b0 = beak(MOUTH_W[init], 0, 0, SMILE[init])

  return (
    <svg ref={root} className="ch ch-plume" viewBox="160 200 1680 1680" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={`${id}m`}>
          <path className="p-mouth" d={b0.mouth} />
        </clipPath>
        <clipPath id={`${id}v`}>
          <path className="p-body" d={BODY} />
        </clipPath>
        {EYES.map((e, i) => (
          <clipPath key={i} id={`${id}e${i}`}>
            <circle cx={e.x} cy={e.y} r={EYE_R} />
          </clipPath>
        ))}
        <mask id={`${id}b`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          {tufts(null, gap)}
          {wing('p-armL', ARM_L.x, ARM_L.y, P0.armL, true, false)}
          {wing('p-armR', ARM_R.x, ARM_R.y, P0.armR, true, false)}
        </mask>
        <mask id={`${id}f`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          <path className="p-body" d={BODY} fill="black" {...gap} />
        </mask>
        <mask id={`${id}a`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          {tufts(null, gap)}
        </mask>
      </defs>
      <g className="p-all">
        <g mask={`url(#${id}f)`}>
          {FEET.map((f, i) => (
            <g key={i} className={i === 0 ? 'p-footL' : 'p-footR'}>
              {[-30, 0, 30].map((a) => (
                <ellipse key={a} cx={f.x} cy={f.y + 26} rx={21} ry={36} fill={ORANGE} transform={`rotate(${a} ${f.x} ${f.y})`} />
              ))}
            </g>
          ))}
        </g>
        <g mask={`url(#${id}b)`}>
          <path className="p-body" d={BODY} fill={COLOR} />
          <g clipPath={`url(#${id}v)`}>
            <path className="p-belly" d={BELLY_D} fill={BELLY} />
          </g>
          {CHEVRONS.map(([x, y], i) => (
            <path key={i} className={`p-chev${i}`} d="M-26 -8Q0 16 26 -8" stroke={CHEVRON} strokeWidth={10} strokeLinecap="round" fill="none" transform={`translate(${x} ${y})`} />
          ))}
          <g className="p-face" transform={`translate(0 ${P0.canY})`}>
            <ellipse cx={1000} cy={985} rx={70} ry={120} fill={FACE} />
            {EYES.map((e, i) => {
              const l = lids(e, P0.eyeOpen)
              return (
                <g key={i} className={`p-eye${i}`}>
                  <circle cx={e.x} cy={e.y} r={170} fill={FACE} />
                  <circle cx={e.x} cy={e.y} r={EYE_R + 13} fill={INK} />
                  <g clipPath={`url(#${id}e${i})`}>
                    <circle cx={e.x} cy={e.y} r={EYE_R} fill={AMBER} />
                    <circle cx={e.x} cy={e.y} r={EYE_R * 0.74} fill="none" stroke={AMBER_D} strokeWidth={7} opacity={0.6} />
                    <g className="p-pupil">
                      <circle cx={e.x} cy={e.y} r={EYE_R * 0.47} fill={INK} />
                      <circle cx={e.x - EYE_R * 0.2} cy={e.y - EYE_R * 0.22} r={EYE_R * 0.15} fill="white" />
                    </g>
                    <path className={`p-lidU${i}`} d={l.up} fill={LID} stroke={INK} strokeWidth={10} strokeLinejoin="round" />
                    <path className={`p-lidL${i}`} d={l.low} fill={LID} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
                  </g>
                </g>
              )
            })}
            <g transform={`translate(${MOUTH.x} ${MOUTH.y})`}>
              <path className="p-mouth" d={b0.mouth} fill={INK} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
              <ellipse className="p-tongue" cx={0} cy={0} rx={0} ry={0} fill={TONGUE} clipPath={`url(#${id}m)`} opacity="0" />
              <path className="p-jaw" d={b0.jaw} fill={ORANGE_D} />
              <ellipse className="p-tout" cx={26} cy={22} rx={12} ry={14} fill={TONGUE} stroke={INK} strokeWidth={5} opacity="0" />
              <path className="p-upper" d={BEAK_UP} fill={ORANGE} />
            </g>
          </g>
        </g>
        <g className="p-tool" opacity="0">
          <rect x={TOOL.x - TOOL.w / 2} y={TOOL.y - TOOL.h / 2} width={TOOL.w} height={TOOL.h} rx={26} fill="#17181E" stroke="#7A5434" strokeWidth={16} />
          {Array.from({ length: TOOL_LINES }, (_, i) => (
            <rect key={i} className={`p-line${i}`} x={TOOL.x - TOOL.w / 2 + 44} y={TOOL.y - TOOL.h / 2 + 40 + i * 42} width={0} height={16} rx={8} fill={BELLY} opacity={i === TOOL_LINES - 1 ? 0.95 : 0.55} />
          ))}
        </g>
        <g mask={`url(#${id}a)`}>
          {wing('p-armL', ARM_L.x, ARM_L.y, P0.armL, false, false)}
          {wing('p-armR', ARM_R.x, ARM_R.y, P0.armR, false, true)}
        </g>
        {tufts((f) => (f.f ? COLOR : COLOR_BACK))}
      </g>
    </svg>
  )
}
