import { useEffect, useId, useRef } from 'react'
import { syllableFollower } from './syllables'

// Le gland : un corps terracotta en forme de noix, coiffé d'une cupule sombre à écailles (le chapeau), construit
// pièce par pièce pour être animé. Pièces : un corps (chemin déformable), un chapeau (dôme, queue, écailles), deux bras
// courts articulés à l'épaule, deux jambes à pieds, un visage (grands yeux à paupières, joues, bouche dessinée).
// Les traits sombres entre les pièces sont des masques : ils marchent sur n'importe quel fond.
//
// Mouvement : tout passe par des ressorts qui ne sont jamais remis à zéro. Un changement d'état ne fait que déplacer
// les cibles (et donner une impulsion d'anticipation) ; la pose en cours rejoint la nouvelle sans saut. Le chapeau est
// porté : il suit le corps avec retard (inertie), peut se soulever et se pencher ; la queue et chaque écaille ont leur
// propre retard.

export type GlandState = 'rest' | 'intro' | 'listen' | 'think' | 'speak'

const COLOR = '#CF6C4D'
const CAP = '#3B3431'
const CAP_LINE = '#1E1817'
const CREAM = '#F3E6D3'
const INK = '#1C1614'
const TONGUE = '#A84A33'
/** Part de l'inclinaison faite d'un bloc (le reste est une légère courbure) : un gland est dur. */
const RIGID = 0.85
const BASE = { x: 1000, y: 1778 }
const ANCHOR = { x: 1000, y: 980 }
const BODY_TOP = 800

// Contour fermé lisse passant par des points (Catmull-Rom converti en courbes de Bézier) : [x0 y0, puis c1 c2 p…].
const smooth = (P: [number, number][]) => {
  const n = P.length
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
// Corps : large et rond en haut (caché sous le chapeau, il continue dessous), le plus large au tiers, qui s'affine
// vers une petite pointe en bas. Il se déforme à chaque image : on garde ses points.
const BODY_PTS = smooth([
  [1000, 800],
  [1230, 830],
  [1360, 960],
  [1395, 1150],
  [1365, 1340],
  [1270, 1490],
  [1130, 1600],
  [1000, 1645],
  [870, 1600],
  [730, 1490],
  [635, 1340],
  [605, 1150],
  [640, 960],
  [770, 830]
])
const BODY = pathOf(BODY_PTS, still)
// Chapeau : un dôme plus large que le corps, au bord légèrement bombé vers le bas, coins arrondis.
const CAP_D = pathOf(
  smooth([
    [1000, 572],
    [1190, 590],
    [1345, 660],
    [1440, 770],
    [1468, 870],
    [1435, 925],
    [1230, 950],
    [1000, 962],
    [770, 950],
    [565, 925],
    [532, 870],
    [560, 770],
    [655, 660],
    [810, 590]
  ]),
  still
)
const HAT_SEAT = { x: 1000, y: 940 }
const STEM_BASE = { x: 1000, y: 600 }
// Écailles : des rangées d'arcs (convexes vers le bas), décalées d'une rangée à l'autre.
const SCALES: [number, number][] = [
  ...[-210, -105, 0, 105, 210].map((x) => [1000 + x, 655] as [number, number]),
  ...[-367, -262, -157, -52, 52, 157, 262, 367].map((x) => [1000 + x, 740] as [number, number]),
  ...[-420, -315, -210, -105, 0, 105, 210, 315, 420].map((x) => [1000 + x, 825] as [number, number]),
  ...[-367, -262, -157, -52, 52, 157, 262, 367].map((x) => [1000 + x, 905] as [number, number])
]
const SCALE = 'M-54 -24C-52 10-30 30 0 30C30 30 52 10 54 -24'

// Bras court : épaule arrondie (elle peut dépasser un peu du corps sans montrer de coupe), main avec un pouce.
const ARM = 'M-36 0C-40 70-44 170-42 232C-42 282-22 302 2 300C26 298 42 280 42 236C42 170 40 70 36 0A36 36 0 0 0 -36 0Z'
// Le trait de séparation ne longe que la partie libre du bras : à l'épaule, bras et corps se fondent.
const ARM_GAP = 'M-41 90C-43 160-44 200-42 232C-42 282-22 302 2 300C26 298 42 280 42 236C42 200 42 160 41 90Z'
const ARM_L = { x: 668, y: 1262 }
const ARM_R = { x: 1332, y: 1262 }
// Jambes : sous le corps (le trait de séparation vient du masque du corps), pied tourné vers l'extérieur.
const LEGS = [
  { x: 912, y: 1575, out: -1 },
  { x: 1088, y: 1575, out: 1 }
]
const EYE_R = 76
const EYES = [
  { x: 840, y: 1100 },
  { x: 1160, y: 1100 }
]
const CHEEKS = [
  { x: 792, y: 1232 },
  { x: 1208, y: 1232 }
]
const MOUTH = { x: 1000, y: 1218 }
// Bouche : sourire et largeur au repos selon l'état (au repos, un petit trait, comme sur le dessin).
const SMILE: Record<GlandState, number> = { rest: 4, intro: 3, listen: 8, think: -4, speak: 4 }
const MOUTH_W: Record<GlandState, number> = { rest: 20, intro: 20, listen: 24, think: 16, speak: 20 }
// Carnet du travail : un petit écran sombre (les mains s'y détachent) tenu à deux mains. Il est dessiné autour de son
// centre et placé à chaque image entre les deux paumes ; des lignes s'y écrivent caractère par caractère.
const TOOL = { x: 1000, y: 1450, w: 310, h: 200 }
const TOOL_LINES = 4
const LINE_MAX = 200
const LINE_X = -TOOL.w / 2 + 42
// Mots des lignes (tirets et espaces), pour que le texte se lise comme du texte.
const WORDS = ['44 30 28 30 62 30 22 30 50 30', '30 30 56 30 26 30 42 30 66 30', '60 30 22 30 38 30 32 30 54 30', '36 30 46 30 24 30 64 30 30 30']
const SCREEN = CREAM
/** Distance de l'épaule au creux de la paume. */
const HAND = 250
/** Centre du carnet sous la ligne des prises (repère du carnet). */
const GRIP_Y = 18
/** Inclinaison quand une main le lâche (degrés) : il pivote sur l'autre main et penche sous son poids. */
const DROOP = 12
/** Une frappe abaisse le bras de quelques degrés. */
const TAP_DEG = 3.5

type Pose = {
  lean: number
  squash: number
  bob: number
  eyeOpen: number
  eyeSize: number
  armL: number
  armR: number
  /** Échelle du chapeau. */
  perk: number
  /** Le chapeau descend (positif) ou se soulève. */
  canY: number
  /** Le chapeau se soulève d'un côté (positif : côté droit relevé). */
  hatTilt: number
  gazeX: number
  gazeY: number
  tilt: number
  footL: number
  footR: number
  /** Langue tirée de concentration (0 à 1). */
  tongue: number
  /** Travail : le carnet tenu devant lui (0 à 1). */
  tool: number
  /** Taille des joues. */
  blush: number
  /** Travail : le crayon sorti pour écrire (0 à 1). */
  pen: number
}

const POSES: Record<GlandState, Pose> = {
  rest: { lean: 2, squash: 0.975, bob: 8, eyeOpen: 0, eyeSize: 1, armL: 12, armR: -12, perk: 0.99, canY: 16, hatTilt: 4, gazeX: 0, gazeY: 6, tilt: 3, footL: 0, footR: 0, tongue: 0, tool: 0, blush: 1, pen: 0 },
  intro: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1, armL: 16, armR: -16, perk: 1, canY: 0, hatTilt: 0, gazeX: 0, gazeY: 0, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 0, blush: 1, pen: 0 },
  listen: { lean: -4, squash: 1.015, bob: -6, eyeOpen: 1.05, eyeSize: 1.16, armL: 24, armR: -22, perk: 1.02, canY: -14, hatTilt: -3, gazeX: -4, gazeY: 2, tilt: 5, footL: 0, footR: 0, tongue: 0, tool: 0, blush: 1.12, pen: 0 },
  think: { lean: -2, squash: 0.99, bob: 2, eyeOpen: 0.8, eyeSize: 0.97, armL: -48, armR: 48, perk: 1, canY: 6, hatTilt: 0, gazeX: 0, gazeY: 18, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 1, blush: 0.92, pen: 0 },
  speak: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1.06, armL: 20, armR: -18, perk: 1.02, canY: -4, hatTilt: 0, gazeX: 0, gazeY: 0, tilt: 0, footL: 0, footR: 0, tongue: 0, tool: 0, blush: 1.1, pen: 0 }
}
const KEYS = Object.keys(POSES.rest) as (keyof Pose)[]
// Raideur et amortissement par réglage : le corps avec un léger dépassement, le regard vif, les bras souples.
const K: Partial<Record<keyof Pose, [number, number]>> = {
  gazeX: [520, 42],
  gazeY: [520, 42],
  armL: [110, 13],
  armR: [110, 13],
  eyeSize: [260, 16],
  hatTilt: [120, 11],
  blush: [160, 18]
}

// Variations : chaque état a sa petite bibliothèque de gestes, tirés au hasard (jamais deux fois le même de suite),
// posés par-dessus la pose de l'état. Un geste ne fait que déplacer des cibles ou donner une impulsion.
type Fx = {
  /** Le geste dirige le regard (pas de saccades). */
  gaze: boolean
  /** Le geste ouvre la bouche hors parole (bâillement, « oh ! »). */
  mouth: { open: number; wide: number } | null
  /** Frisson des écailles et du chapeau, 0 à 1. */
  rustle: number
  /** Vrai une seule fois par geste pour chaque numéro : les impulsions. */
  once: (n: number) => boolean
  push: (k: keyof Pose, v: number) => void
  /** Impulsion donnée au chapeau lui-même (il saute, il tourne), qui retombe par son inertie. */
  hat: (vy: number, vr: number) => void
  /** Côté tiré au hasard au début du geste (-1 ou 1). */
  side: number
  /** Travail : intensité de la frappe des mains (0 : posées, 1 : normal, plus : rafale). */
  typing: number
  /** Travail : la main lâche le carnet ([gauche, droite], 0 à 1) même si elle reste près du bord (écrire). */
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
// Bras levé vers le bord du chapeau, du côté donné (angle de rotation du bras).
const reach = (side: number) => (side > 0 ? -166 : 166)

const ACTS: Partial<Record<GlandState, Act[]>> = {
  rest: [
    {
      name: 'pique du nez',
      dur: 3200,
      run: (k, t, fx) => {
        const d = k < 0.75 ? ss(k / 0.75) : 1 - ss((k - 0.75) / 0.1)
        t.canY += 12 * d
        t.hatTilt -= 4 * d * fx.side
        t.tilt += 7 * d * fx.side
        t.bob += 10 * d
        if (k > 0.75 && fx.once(1)) {
          fx.push('bob', -280)
          fx.hat(-260, 0)
        }
        if (k > 0.76 && k < 0.9) t.eyeOpen = 0.45 // il entrouvre les yeux… puis se rendort
      }
    },
    {
      name: 'bâille',
      dur: 2800,
      run: (k, t, fx) => {
        const e = env(k, 0.3, 0.3)
        t.armL += 70 * e
        t.armR -= 70 * e
        t.squash += 0.06 * e
        t.canY -= 22 * e
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
        if (fx.once(1)) fx.hat(-120, 0)
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
    },
    {
      name: 'remet son chapeau',
      dur: 3000,
      run: (k, t, fx) => {
        // Le chapeau glisse doucement de travers, puis une main vient le redresser d'un petit coup.
        const slip = k < 0.55 ? ss(k / 0.55) : 1 - ss((k - 0.62) / 0.2)
        t.hatTilt += 9 * slip * fx.side
        t.canY += 6 * slip
        const up = env((k - 0.45) / 0.5, 0.3, 0.35)
        if (fx.side > 0) t.armR = mix(t.armR, reach(1), up)
        else t.armL = mix(t.armL, reach(-1), up)
        if (k > 0.65 && fx.once(1)) fx.hat(-160, -fx.side * 30)
      }
    }
  ],
  listen: [
    {
      name: 'soulève son chapeau pour écouter',
      dur: 2200,
      run: (k, t, fx) => {
        // Une main soulève le bord du chapeau, comme pour dégager l'oreille, puis le laisse retomber.
        const e = env(k, 0.25, 0.3)
        if (fx.side > 0) t.armR = mix(t.armR, reach(1), e)
        else t.armL = mix(t.armL, reach(-1), e)
        t.canY -= 30 * e
        t.hatTilt -= 10 * e * fx.side
        t.tilt += 6 * e * fx.side
        t.eyeSize += 0.08 * e
        if (k > 0.78 && fx.once(1)) fx.hat(-90, fx.side * 20)
      }
    },
    {
      name: 'penche la tête',
      dur: 2400,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.3)
        t.tilt += 10 * e * fx.side
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
        t.eyeSize += 0.1 * e
        t.bob -= 6 * e
        t.canY -= 10 * e
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
        t.eyeOpen -= 0.22 * e
        t.tilt += 6 * e * fx.side
        t.hatTilt += 4 * e * fx.side
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
        // La main gauche tient le carnet, la droite le lâche et y écrit au crayon, par petits traits.
        const e = env(k, 0.2, 0.2)
        fx.typing = 1 - e
        fx.free[1] = e
        fx.write = e
        t.pen = e
        t.armR = mix(t.armR, 55 + Math.sin(k * 90) * 4 + Math.cos(k * 57) * 3, e)
        fx.gaze = true
        t.gazeX = mix(t.gazeX, 9 + Math.sin(k * 20) * 3, e)
        t.gazeY = mix(t.gazeY, 18, e)
        t.tilt += 4 * e
        t.tongue = e
      }
    },
    {
      name: 's’essuie le front',
      dur: 2000,
      run: (k, t, fx) => {
        // La main passe sous le bord du chapeau, qui se soulève de ce côté ; puis il souffle.
        fx.typing = 1 - env(k, 0.1, 0.15)
        const up = env(k, 0.2, 0.35)
        // Le bras monte le long du flanc (jamais en travers des yeux) ; la main frotte sous le bord.
        const a = 176 + Math.sin(k * 28) * 7 * up
        // Le bras passe par l'extérieur (angle de même signe que le bras levé) : il ne balaie jamais le visage.
        if (fx.side > 0) t.armR = mix(t.armR, -a, up)
        else t.armL = mix(t.armL, a, up)
        t.hatTilt += 7 * up * fx.side
        t.canY -= 10 * up
        t.eyeOpen -= 0.5 * up
        t.lean += 2 * up
        if (k > 0.65 && fx.once(1)) fx.push('squash', -0.8)
        fx.mouth = k > 0.62 && k < 0.85 ? { open: 0.3, wide: -0.7 } : null
      }
    },
    {
      name: 'se frotte les mains',
      dur: 1300,
      run: (k, t, fx) => {
        // Sans lâcher le carnet : les mains frottent ses bords, vite, l'une contre l'autre.
        const e = env(k, 0.2, 0.25)
        fx.typing = 1 - e
        t.armL += Math.sin(k * 70) * 5 * e
        t.armR += Math.sin(k * 70) * 5 * e
        t.eyeSize += 0.12 * e
        t.gazeY -= 10 * e
        t.lean -= 2 * e
      }
    },
    {
      name: 'se gratte sous le chapeau',
      dur: 2400,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.25)
        fx.typing = 1 - e
        if (fx.side > 0) t.armR = mix(t.armR, reach(1) + Math.sin(k * 60) * 7, e)
        else t.armL = mix(t.armL, reach(-1) + Math.sin(k * 60) * 7, e)
        t.hatTilt += (8 + Math.sin(k * 60) * 1.5) * e * fx.side
        t.tilt -= 5 * e * fx.side
        t.eyeOpen -= 0.25 * e
        fx.gaze = true
        t.gazeY = mix(t.gazeY, -10, e)
        t.gazeX = mix(t.gazeX, 8 * fx.side, e)
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
        if (k > 0.1 && fx.once(2)) {
          fx.push('bob', -480)
          // Le chapeau saute de la tête et retombe en tournoyant un peu.
          fx.hat(-1800, fx.side * 90)
        }
        const e = env(k, 0.1, 0.35)
        t.eyeSize += 0.22 * e
        if (fx.side > 0) t.armR = mix(t.armR, -150, e)
        else t.armL = mix(t.armL, 150, e)
        fx.gaze = true
        t.gazeX = mix(t.gazeX, 0, e)
        t.gazeY = mix(t.gazeY, -4, e)
        fx.mouth = { open: 0.5 * e, wide: -0.6 }
      }
    }
  ],
  speak: [
    {
      name: 'tire son chapeau',
      dur: 1700,
      run: (k, t, fx) => {
        // Petit salut : il lève son chapeau bien haut, l'incline, puis le repose d'un coup.
        const e = env(k, 0.25, 0.3)
        if (fx.side > 0) t.armR = mix(t.armR, reach(1) - 20, e)
        else t.armL = mix(t.armL, reach(-1) + 20, e)
        t.canY -= 48 * env(k, 0.3, 0.3)
        t.hatTilt += 14 * env(k, 0.3, 0.3) * fx.side
        t.lean += 2 * e * fx.side
        if (k > 0.75 && fx.once(1)) fx.hat(-120, -fx.side * 25)
      }
    },
    {
      name: 'touche son chapeau',
      dur: 1500,
      run: (k, t, fx) => {
        const e = env(k, 0.25, 0.3)
        if (fx.side > 0) t.armR = mix(t.armR, reach(1), e)
        else t.armL = mix(t.armL, reach(-1), e)
        t.canY -= 26 * env(k, 0.35, 0.3)
        t.hatTilt += 4 * env(k, 0.35, 0.3) * fx.side
        t.tilt -= 3 * e * fx.side
      }
    },
    {
      name: 'ouvre les bras',
      dur: 1300,
      run: (k, t) => {
        const e = env(k, 0.25, 0.3)
        t.armL = mix(t.armL, 95, e)
        t.armR = mix(t.armR, -95, e)
        t.squash += 0.02 * e
        t.canY -= 8 * e
      }
    },
    {
      name: 'hausse les épaules',
      dur: 1100,
      run: (k, t, fx) => {
        const e = env(k, 0.25, 0.35)
        t.armL = mix(t.armL, 65, e)
        t.armR = mix(t.armR, -65, e)
        t.squash -= 0.04 * e
        t.canY -= 18 * e
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
        if (fx.side > 0) t.armR = mix(t.armR, -120 + Math.sin(k * 30) * 8, e)
        else t.armL = mix(t.armL, 120 + Math.sin(k * 30) * 8, e)
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
const GAP: Record<GlandState, [number, number]> = { rest: [3500, 8000], intro: [99999, 99999], listen: [2200, 5000], think: [700, 2200], speak: [800, 2400] }

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
// Limite douce : au-delà de `lim`, la valeur ne progresse plus qu'au quart (le chapeau ne descend jamais sur les yeux).
const soft = (v: number, lim: number) => (v > lim ? lim + (v - lim) * 0.25 : v)

// Paupières : deux pièces couleur corps, découpées dans l'œil ; leur bord est un trait sombre (fermées : un arc ∪).
const lids = (e: { x: number; y: number }, open: number) => {
  const R = EYE_R
  const shut = 1 - Math.max(0, Math.min(1.1, open))
  const yU = mix(e.y - 1.45 * R, e.y - 0.22 * R, shut)
  const yL = mix(e.y + 1.05 * R, e.y - 0.2 * R, Math.max(0, shut))
  // Bord de la paupière du haut : bombé vers le haut quand l'œil est entrouvert (regard doux, pas fâché),
  // en arc ∪ quand il est fermé (yeux de sommeil du dessin).
  const bow = -0.35 + 1.05 * Math.max(0, shut) ** 1.5
  const x0 = e.x - R - 30
  const x1 = e.x + R + 30
  return {
    up: `M${x0} ${e.y - R - 40}L${x1} ${e.y - R - 40}L${x1} ${yU.toFixed(1)}Q${e.x} ${(yU + bow * R).toFixed(1)} ${x0} ${yU.toFixed(1)}Z`,
    low: `M${x0} ${e.y + R + 40}L${x1} ${e.y + R + 40}L${x1} ${yL.toFixed(1)}Q${e.x} ${(yL + 0.7 * R).toFixed(1)} ${x0} ${yL.toFixed(1)}Z`
  }
}
// Bouche dessinée : deux lèvres entre deux commissures. Le contour épais et arrondi en fait un petit trait au repos.
const mouthOf = (base: number, open: number, wide: number, smile: number) => {
  const o = Math.max(0, Math.min(1.1, open))
  const mw = base + o * (44 + wide * 24)
  const mh = o * (92 - wide * 20)
  const c = smile * (1 - o * 0.6)
  const uy = c * 0.6 - mh * 0.3
  const ly = c * 0.6 + mh * 1.15
  return { d: `M${-mw} ${-c}C${-mw * 0.55} ${uy} ${mw * 0.55} ${uy} ${mw} ${-c}C${mw * 0.7} ${ly} ${-mw * 0.7} ${ly} ${-mw} ${-c}Z`, mw, mh, c }
}

export function Gland({ state, size, levels }: { state: GlandState; size: number; levels?: (n: number) => number[] }) {
  const root = useRef<SVGSVGElement>(null)
  const stateRef = useRef(state)
  const levelsRef = useRef(levels)
  levelsRef.current = levels
  const id = useId().replace(/:/g, '')
  const init = useRef(state).current
  const kick = useRef<GlandState | null>(null)
  if (stateRef.current !== state) {
    kick.current = state
    stateRef.current = state
  }

  useEffect(() => {
    const svg = root.current
    if (!svg) return
    const all = (sel: string) => Array.from(svg.querySelectorAll<SVGGraphicsElement>(sel))
    const el = {
      all: all('.g-all'),
      body: all('.g-body'),
      hat: all('.g-hat'),
      stem: all('.g-stem'),
      scales: SCALES.map((_, i) => all(`.g-sc${i}`)),
      legs: [all('.g-legL'), all('.g-legR')],
      armL: all('.g-armL'),
      armR: all('.g-armR'),
      face: all('.g-face'),
      eyes: EYES.map((_, i) => all(`.g-eye${i}`)),
      whites: all('.g-white'),
      lidU: EYES.map((_, i) => all(`.g-lidU${i}`)),
      lidL: EYES.map((_, i) => all(`.g-lidL${i}`)),
      pupils: all('.g-pupil'),
      cheeks: CHEEKS.map((_, i) => all(`.g-cheek${i}`)),
      mouth: all('.g-mouth'),
      tongue: all('.g-tongue'),
      tongueOut: all('.g-tout'),
      tool: all('.g-tool'),
      pencil: all('.g-pencil'),
      lines: Array.from({ length: TOOL_LINES }, (_, i) => all(`.g-line${i}`)),
      caret: all('.g-caret'),
      dots: [all('.g-dotL'), all('.g-dotR')],
      glow: all('.g-glow'),
      glints: all('.g-glint')
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const first = stateRef.current
    const p = Object.fromEntries(KEYS.map((k) => [k, spring(POSES[first][k])])) as Record<keyof Pose, Spring>
    // Arrivée : il pousse depuis le sol, et le chapeau lui tombe dessus d'un peu plus haut.
    const grow = spring(first === 'intro' ? 0 : 1)
    const hat = { x: spring(0), y: spring(first === 'intro' ? -420 : 0), r: spring(0) }
    const stem = spring(0)
    const scales = SCALES.map(() => ({ x: spring(0), y: spring(0) }))
    let prevTop = { x: 0, y: 0 }
    let prevHead = { x: 0, y: 0, a: 0 }
    // Souplesse du corps : courbure du haut, tassement, ventre.
    const body = { bend: spring(0), sag: spring(0), bulge: spring(0) }
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
    // Lignes du carnet : chaque frappe ajoute un caractère à la dernière ; pleine, tout remonte d'un cran.
    const lines = [170, 110, 190, 20]
    // Chaque ligne garde ses mots en remontant.
    const words = [0, 1, 2, 3]
    let lineEnd = LINE_MAX * 0.8
    // Le carnet suit les prises à travers un ressort : la frappe le secoue sans le faire trembler.
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
        if (to === 'think') hat.r.vel += 30
        if (to === 'speak') p.bob.vel -= 200
        if (to === 'intro') {
          grow.v = Math.min(grow.v, 0.2)
          hat.y.v = Math.min(hat.y.v, -420)
        }
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
      const fx: Fx = { gaze: false, mouth: null, rustle: 0, once: () => false, push: () => {}, hat: () => {}, side: 1, typing: 1, free: [0, 0], write: 0 }
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
          fx.hat = (vy, vr) => {
            hat.y.vel += vy
            hat.r.vel += vr
          }
          cur.a.run(k, t, fx)
        }
      }
      // Voix : l'énergie ouvre la bouche, le timbre lui donne sa forme (graves : ronde, aigus : étirée).
      // Sans volume réel, le débit inventé : attaque nette, tenue, relâchement, petites pauses.
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
          const e = syl.pause ? 0 : k < 0.25 ? k / 0.25 : 1 - Math.max(0, (k - 0.55) / 0.45) * 0.85
          say = syl.open * e
          wide = syl.wide
        }
      } else if (fx.mouth) {
        say = fx.mouth.open
        wide = fx.mouth.wide
      }
      // Une syllabe qui part fort : la tête l'accompagne d'un petit coup (et le chapeau le sent passer).
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
      const sx = (1 + (1 - P.squash) * 0.35) * grow.v
      const allT = `translate(0 ${P.bob}) rotate(${P.lean * RIGID} ${BASE.x} ${BASE.y}) translate(${BASE.x} ${BASE.y}) scale(${sx} ${sy}) translate(${-BASE.x} ${-BASE.y})`
      el.all.forEach((g) => g.setAttribute('transform', allT))

      // Un gland est dur : il pivote surtout d'un bloc, ne se courbe qu'à peine et ne fait pas la gelée ; seuls un léger
      // retard du haut et un petit tassement à l'atterrissage gardent le mouvement vivant.
      const rad = (P.lean * RIGID * Math.PI) / 180
      const h = BASE.y - ANCHOR.y
      // Sans la croissance de l'arrivée : elle déplierait la gelée au lieu de le faire grandir.
      const top = { x: Math.sin(rad) * h * P.squash, y: P.bob + (1 - Math.cos(rad)) * h + (1 - P.squash) * h }
      const dTop = { x: top.x - prevTop.x, y: top.y - prevTop.y }
      prevTop = top
      body.bend.v -= dTop.x * 0.25
      body.sag.v -= dTop.y * 0.15
      stepSpring(body.bend, P.lean * 2.5 + P.tilt * 0.8, 260, 26, dt)
      stepSpring(body.sag, 0, 320, 30, dt)
      stepSpring(body.bulge, Math.max(-0.015, body.sag.v * 0.001 + (1 - P.squash) * 0.5), 300, 28, dt)
      const warp: Warp = (x, y) => {
        const u = Math.max(0, (BASE.y - y) / (BASE.y - BODY_TOP))
        const g = Math.exp(-(((y - 1330) / 220) ** 2))
        return { x: body.bend.v * u * u + (x - BASE.x) * body.bulge.v * g, y: body.sag.v * u }
      }
      // Pente de la courbe à une hauteur donnée (degrés) : ce qui est posé dessus tourne avec.
      const slope = (y: number) => {
        const u = Math.max(0, (BASE.y - y) / (BASE.y - BODY_TOP))
        return ((2 * body.bend.v * u) / (BASE.y - BODY_TOP)) * (180 / Math.PI)
      }
      const bd = pathOf(BODY_PTS, warp)
      el.body.forEach((g) => g.setAttribute('d', bd))
      const DA = warp(HAT_SEAT.x, HAT_SEAT.y)
      const DF = warp(1000, 1110)

      // Chapeau : là où le haut du corps est allé cette image, il y va avec retard (inertie), puis oscille.
      const head = { x: top.x + DA.x, y: top.y + DA.y, a: P.tilt + slope(HAT_SEAT.y) }
      const dHead = { x: head.x - prevHead.x, y: head.y - prevHead.y, a: head.a - prevHead.a }
      prevHead = head
      hat.x.v -= dHead.x * 0.5
      hat.y.v -= dHead.y * 0.6
      hat.r.v -= dHead.x * 0.06 + dHead.a * 0.35
      const hprev = { x: hat.x.v, y: hat.y.v, r: hat.r.v }
      stepSpring(hat.x, 0, 95, 7, dt)
      stepSpring(hat.y, 0, 110, 7.5, dt)
      stepSpring(hat.r, 0, 80, 6, dt)
      const dHat = { x: hat.x.v - hprev.x + dHead.x, y: hat.y.v - hprev.y + dHead.y, r: hat.r.v - hprev.r + dHead.a }
      // Le chapeau peut sauter très haut mais ne descend jamais sur les yeux.
      const hy = soft(hat.y.v + P.canY, 24)
      const ht = P.hatTilt
      // Se soulever d'un côté : il pivote sur le bord opposé, donc ce côté monte et l'autre ne descend pas.
      const pivot = HAT_SEAT.x - Math.sign(ht) * 430
      const hatT = `translate(${hat.x.v + DA.x} ${hy + DA.y}) rotate(${hat.r.v + P.tilt + slope(HAT_SEAT.y)} ${ANCHOR.x} ${ANCHOR.y}) rotate(${-ht} ${pivot} 925) translate(${HAT_SEAT.x} ${HAT_SEAT.y}) scale(${P.perk}) translate(${-HAT_SEAT.x} ${-HAT_SEAT.y})`
      el.hat.forEach((g) => g.setAttribute('transform', hatT))
      // Queue : elle traîne derrière le chapeau, comme un ressort mou.
      stem.v -= dHat.r * 1.1 + dHat.x * 0.12
      let sr = 0
      if (!reduce) {
        sr += Math.sin(s * 30) * 6 * fx.rustle
        if (st === 'speak') sr += voice * 4 * Math.sin(s * 9)
      }
      stepSpring(stem, sr, 120, 4.5, dt)
      el.stem.forEach((g) => g.setAttribute('transform', `rotate(${Math.max(-40, Math.min(40, stem.v))} ${STEM_BASE.x} ${STEM_BASE.y})`))
      // Écailles : chacune traîne un peu derrière le chapeau, d'autant plus qu'elle est loin du centre ; elles frémissent.
      SCALES.forEach(([cx, cy], i) => {
        const S = scales[i]
        const far = Math.hypot(cx - HAT_SEAT.x, cy - 700) / 400
        S.x.v -= dHat.x * 0.25 * far
        S.y.v -= dHat.y * 0.25 * far
        let jx = 0
        let jy = 0
        if (!reduce) {
          jy += Math.sin(s * 34 - i * 1.3) * 5 * fx.rustle
          if (st === 'speak') jy += voice * 2.5 * Math.sin(i * 2.3 + s * 11)
          if (st === 'think') jx += Math.sin(s * 5 - i * 0.9) * 1.2
        }
        stepSpring(S.x, jx, 220, 10, dt)
        stepSpring(S.y, jy, 220, 10, dt)
        const ox = Math.max(-12, Math.min(12, S.x.v))
        const oy = Math.max(-12, Math.min(12, S.y.v))
        el.scales[i].forEach((g) => g.setAttribute('transform', `translate(${cx + ox} ${cy + oy})`))
      })

      el.legs.forEach((ls, i) => {
        const lift = Math.max(0, i === 0 ? P.footL : P.footR)
        ls.forEach((g) => g.setAttribute('transform', `translate(0 ${-lift})`))
      })
      // Carnet porté : sa place vient des mains. Les paumes sont calculées depuis les bras (angle, épaule, légère courbure
      // du corps), sans la frappe ; une main loin de sa prise l'a lâché.
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
      // Deux mains : entre les deux. Une seule : il pivote sur celle qui reste et penche du côté lâché. Aucune
      // (il arrive ou repart) : à sa place contre le ventre.
      const both = offL * offR
      // Il n'apparaît vraiment qu'une fois dans les mains (il grandit à mesure qu'elles arrivent).
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
      // rafales. Chaque coup secoue le carnet et ajoute un caractère ; le crayon qui écrit en ajoute aussi.
      if (st === 'think' && !reduce && tl > 0.6) {
        if (fx.typing > 0.1 && now > tapAt) {
          const off = [offL, offR]
          let hnd = Math.random() < 0.8 ? 1 - tapHand : tapHand
          if (off[hnd] > 0.3) hnd = 1 - hnd
          if (off[hnd] <= 0.3) {
            tapHand = hnd
            taps[hnd] = now
            tool.y.vel += 70
            tool.a.vel += hnd ? 12 : -12
            p.bob.vel += 12
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
        g.setAttribute('x', String(LINE_X + lines[curLine] + 15))
        g.setAttribute('opacity', now - lastKey < 500 || Math.sin(s * 9) > 0 ? '0.9' : '0')
      })
      // Le crayon n'est sorti que pour écrire.
      el.pencil.forEach((g) => g.setAttribute('opacity', String(Math.min(1, Math.max(0, P.pen) * 1.5) * Math.min(1, tl))))
      const rL = aL + TAP_DEG * dTap[0]
      const rR = aR - TAP_DEG * dTap[1]
      el.armL.forEach((g) => g.setAttribute('transform', `translate(${ARM_L.x + DL.x} ${ARM_L.y + DL.y}) rotate(${rL})`))
      el.armR.forEach((g) => g.setAttribute('transform', `translate(${ARM_R.x + DR.x} ${ARM_R.y + DR.y}) rotate(${rR})`))
      // Chaque coup allume un petit point sur l'écran, sous la main qui tape.
      const hands = [palm(ARM_L, DL, rL), palm(ARM_R, DR, rR)]
      ;[1, -1].forEach((inner, i) => {
        const d = dTap[i]
        const show = tv * (1 - (i ? offR : offL))
        const H = hands[i]
        const tip = 58
        el.dots[i].forEach((g) => {
          g.setAttribute('transform', `translate(${H.x + inner * tux * tip + tuy * 8} ${H.y + inner * tuy * tip - tux * 8})`)
          g.setAttribute('opacity', String(0.75 * d * show))
        })
      })
      // L'écran éclaire le bas du visage et se reflète dans les yeux.
      const lit = tv * (0.85 + 0.15 * flash)
      el.glow.forEach((g) => {
        g.setAttribute('opacity', String(0.3 * lit))
        g.setAttribute('transform', `translate(${tool.x.v + tuy * 210} ${tool.y.v - tux * 210}) rotate(${tool.a.v})`)
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
      el.face.forEach((g) => g.setAttribute('transform', `translate(${DF.x} ${DF.y}) rotate(${P.tilt * 0.8 + slope(1110)} ${ANCHOR.x} ${ANCHOR.y}) translate(${P.gazeX * 0.35} ${P.gazeY * 0.3})`))
      EYES.forEach((e, i) => {
        el.eyes[i].forEach((g) => g.setAttribute('transform', `translate(${e.x} ${e.y}) scale(${P.eyeSize}) translate(${-e.x} ${-e.y})`))
        const l = lids(e, open)
        el.lidU[i].forEach((g) => g.setAttribute('d', l.up))
        el.lidL[i].forEach((g) => g.setAttribute('d', l.low))
      })
      // Yeux fermés : on retire le blanc, sinon un liseré clair resterait au bord de la découpe.
      el.whites.forEach((g) => g.setAttribute('opacity', open < 0.04 ? '0' : '1'))
      el.pupils.forEach((g) => g.setAttribute('transform', `translate(${P.gazeX * 0.6} ${P.gazeY * 0.6})`))
      CHEEKS.forEach((c, i) => el.cheeks[i].forEach((g) => g.setAttribute('transform', `translate(${c.x} ${c.y}) scale(${P.blush})`)))
      stepSpring(mouth.open, say, 900, 46, dt)
      stepSpring(mouth.wide, wide, 350, 32, dt)
      stepSpring(mouth.smile, SMILE[st], 200, 22, dt)
      stepSpring(mouth.base, MOUTH_W[st], 200, 22, dt)
      const m = mouthOf(mouth.base.v, mouth.open.v, mouth.wide.v, mouth.smile.v)
      el.mouth.forEach((g) => g.setAttribute('d', m.d))
      el.tongue.forEach((g) => {
        g.setAttribute('cy', String(m.c * 0.6 + m.mh * 0.8))
        g.setAttribute('rx', String(m.mw * 0.6))
        g.setAttribute('ry', String(m.mh * 0.4))
        g.setAttribute('opacity', m.mh > 22 ? '1' : '0')
      })
      const to = Math.max(0, Math.min(1, P.tongue))
      el.tongueOut.forEach((g) => {
        g.setAttribute('opacity', to < 0.05 ? '0' : '1')
        g.setAttribute('transform', `translate(16 4) scale(${to}) translate(-16 -4)`)
      })
    }
    // Une erreur dans une image ne doit jamais figer le personnage : on la signale une fois et la boucle continue.
    let warned = false
    const tick = (now: number) => {
      try {
        frame(now)
      } catch (e) {
        if (!warned) console.error('Gland :', e)
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
  // Bras : le pouce est du côté du ventre ; le crayon (travail) est dans la main droite, derrière les doigts.
  const arm = (cls: string, at: { x: number; y: number }, a: number, inner: number, mask: boolean) => (
    <g className={cls} transform={`translate(${at.x} ${at.y}) rotate(${a})`}>
      {!mask && inner < 0 && (
        <g className="g-pencil" opacity="0" transform="rotate(28 0 262)">
          <rect x={-12} y={190} width={24} height={170} rx={6} fill="#E9B949" />
          <path d="M-12 360L12 360L0 396Z" fill={CREAM} />
          <path d="M-5 382L5 382L0 396Z" fill={INK} />
        </g>
      )}
      <path d={mask ? ARM_GAP : ARM} fill={mask ? 'black' : COLOR} {...(mask ? gap : {})} />
      <ellipse cx={inner * 36} cy={232} rx={16} ry={26} fill={mask ? 'black' : COLOR} transform={`rotate(${-inner * 28} ${inner * 36} 232)`} {...(mask ? gap : {})} />
    </g>
  )
  const legs = (fill: string) =>
    LEGS.map((l, i) => (
      <g key={i} className={i === 0 ? 'g-legL' : 'g-legR'}>
        <rect x={l.x - 40} y={l.y - 90} width={80} height={258} rx={36} fill={fill} />
        <ellipse cx={l.x + l.out * 22} cy={l.y + 170} rx={66} ry={34} fill={fill} />
      </g>
    ))
  const box = { x: -400, y: -400, width: 2800, height: 2800 }
  const m0 = mouthOf(MOUTH_W[init], 0, 0, SMILE[init])

  return (
    <svg ref={root} className="ch ch-gland" viewBox="160 250 1680 1680" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={`${id}m`}>
          <path className="g-mouth" d={m0.d} />
        </clipPath>
        <clipPath id={`${id}h`}>
          <path d={CAP_D} />
        </clipPath>
        {EYES.map((e, i) => (
          <clipPath key={i} id={`${id}e${i}`}>
            <circle cx={e.x} cy={e.y} r={EYE_R} />
          </clipPath>
        ))}
        <clipPath id={`${id}v`}>
          <path className="g-body" d={BODY} />
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
          {arm('g-armL', ARM_L, P0.armL, 1, true)}
          {arm('g-armR', ARM_R, P0.armR, -1, true)}
        </mask>
        <mask id={`${id}f`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="white" />
          <path className="g-body" d={BODY} fill="black" {...gap} />
        </mask>
      </defs>
      <g className="g-all">
        <g mask={`url(#${id}f)`}>{legs(COLOR)}</g>
        <g mask={`url(#${id}b)`}>
          <path className="g-body" d={BODY} fill={COLOR} />
          <g className="g-face">
            {CHEEKS.map((c, i) => (
              <ellipse key={i} className={`g-cheek${i}`} cx={0} cy={0} rx={54} ry={32} fill={CREAM} transform={`translate(${c.x} ${c.y})`} />
            ))}
            {EYES.map((e, i) => {
              const l = lids(e, P0.eyeOpen)
              return (
                <g key={i} className={`g-eye${i}`}>
                  <g clipPath={`url(#${id}e${i})`}>
                    <g className="g-white" opacity={P0.eyeOpen < 0.04 ? 0 : 1}>
                      <circle cx={e.x} cy={e.y} r={EYE_R - 1.5} fill={CREAM} />
                      <g className="g-pupil">
                        <circle cx={e.x} cy={e.y} r={EYE_R * 0.55} fill={INK} />
                        <rect className="g-glint" x={e.x - 15} y={e.y + 17} width={30} height={10} rx={5} fill={SCREEN} opacity="0" />
                      </g>
                    </g>
                    <path className={`g-lidU${i}`} d={l.up} fill={COLOR} stroke={INK} strokeWidth={12} strokeLinejoin="round" />
                    <path className={`g-lidL${i}`} d={l.low} fill={COLOR} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
                  </g>
                </g>
              )
            })}
            <g transform={`translate(${MOUTH.x} ${MOUTH.y})`}>
              <ellipse className="g-tout" cx={16} cy={17} rx={12} ry={14} fill={TONGUE} stroke={INK} strokeWidth={6} opacity="0" />
              <path className="g-mouth" d={m0.d} fill={INK} stroke={INK} strokeWidth={16} strokeLinejoin="round" />
              <ellipse className="g-tongue" cx={0} cy={0} rx={0} ry={0} fill={TONGUE} clipPath={`url(#${id}m)`} opacity="0" />
            </g>
          </g>
          <g clipPath={`url(#${id}v)`}>
            <ellipse className="g-glow" cx={0} cy={0} rx={330} ry={220} fill={`url(#${id}g)`} opacity="0" />
          </g>
        </g>
        <g className="g-tool" opacity="0" transform={`translate(${TOOL.x} ${TOOL.y})`}>
          <rect x={-TOOL.w / 2} y={-TOOL.h / 2} width={TOOL.w} height={TOOL.h} rx={26} fill="#231B18" />
          <rect x={-TOOL.w / 2 + 15} y={-TOOL.h / 2 + 15} width={TOOL.w - 30} height={TOOL.h - 30} rx={16} fill={`url(#${id}s)`} />
          {Array.from({ length: TOOL_LINES }, (_, i) => (
            <line key={i} className={`g-line${i}`} x1={LINE_X} x2={LINE_X} y1={-54 + i * 36} y2={-54 + i * 36} stroke={SCREEN} strokeWidth={15} strokeLinecap="round" strokeDasharray={WORDS[i]} opacity={i === TOOL_LINES - 1 ? 0.95 : 0.55} visibility="hidden" />
          ))}
          <rect className="g-caret" x={LINE_X} y={-54 + (TOOL_LINES - 1) * 36 - 13} width={6} height={26} rx={3} fill={SCREEN} opacity="0" />
        </g>
        {[0, 1].map((i) => (
          <circle key={i} className={i ? 'g-dotR' : 'g-dotL'} cx={0} cy={0} r={14} fill={SCREEN} opacity="0" />
        ))}
        {arm('g-armL', ARM_L, P0.armL, 1, false)}
        {arm('g-armR', ARM_R, P0.armR, -1, false)}
        <g className="g-hat" transform={`translate(0 ${P0.canY + (init === 'intro' ? -420 : 0)})`}>
          <path className="g-stem" d={`M${STEM_BASE.x} ${STEM_BASE.y + 20}Q${STEM_BASE.x - 4} 505 ${STEM_BASE.x - 44} 458`} stroke={CAP} strokeWidth={60} strokeLinecap="round" fill="none" />
          <path d={CAP_D} fill={CAP} />
          <g clipPath={`url(#${id}h)`}>
            {SCALES.map(([x, y], i) => (
              <path key={i} className={`g-sc${i}`} d={SCALE} transform={`translate(${x} ${y})`} stroke={CAP_LINE} strokeWidth={13} strokeLinecap="round" fill="none" />
            ))}
          </g>
        </g>
      </g>
    </svg>
  )
}
