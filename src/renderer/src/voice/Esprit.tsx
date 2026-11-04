import { useEffect, useId, useRef } from 'react'
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
const ARM = 'M-32 0C-36 60-46 118-42 150A42 42 0 0 0 42 150C46 118 34 60 32 0Z'
// Le trait de séparation ne longe que le bas du bras : à l'épaule, bras et corps se fondent.
const ARM_GAP = 'M-40 70C-44 110-46 130-42 150A42 42 0 0 0 42 150C46 130 44 110 40 70Z'
const ARM_L = { x: 738, y: 1250 }
const ARM_R = { x: 1305, y: 1215 }
const EYES = [
  { x: 922, y: 962 },
  { x: 1124, y: 948 }
]
const MOUTH = { x: 1026, y: 1028 }
// Bouche : sourire et largeur au repos selon l'état (au repos, presque un point, comme sur le dessin).
const SMILE: Record<MarkState, number> = { rest: 0, intro: 4, listen: 6, think: -3, speak: 3 }
const MOUTH_W: Record<MarkState, number> = { rest: 4, intro: 10, listen: 13, think: 8, speak: 11 }
const TONGUE = '#A84A33'
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
}

const POSES: Record<MarkState, Pose> = {
  rest: { lean: 2, squash: 0.975, bob: 8, eyeOpen: 0, eyeSize: 1, armL: 22, armR: -16, perk: 0.97, canY: 14, leaf: 0, gazeX: 0, gazeY: 6, tilt: 0, footL: 0, footR: 0 },
  intro: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1, armL: 25, armR: -18, perk: 1, canY: 0, leaf: 0, gazeX: 0, gazeY: 0, tilt: 0, footL: 0, footR: 0 },
  listen: { lean: -4, squash: 1.015, bob: -6, eyeOpen: 1, eyeSize: 1.22, armL: 30, armR: -26, perk: 1.05, canY: -8, leaf: 0, gazeX: -4, gazeY: 2, tilt: 0, footL: 0, footR: 0 },
  think: { lean: 3, squash: 1, bob: 0, eyeOpen: 0.9, eyeSize: 1, armL: 14, armR: -10, perk: 1.02, canY: 0, leaf: 1, gazeX: 14, gazeY: -18, tilt: 0, footL: 0, footR: 0 },
  speak: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1.08, armL: 26, armR: -22, perk: 1.03, canY: 0, leaf: 0, gazeX: 0, gazeY: 0, tilt: 0, footL: 0, footR: 0 }
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
  think: [
    {
      name: 'se gratte la canopée',
      dur: 2400,
      run: (k, t, fx) => {
        const e = env(k, 0.2, 0.25)
        t.armR = mix(t.armR, -172 + Math.sin(k * 60) * 9, e)
        t.tilt -= 6 * e
        t.eyeOpen -= 0.25 * e
        fx.rustle = 0.5 * e
      }
    },
    {
      name: 'main au menton',
      dur: 2600,
      run: (k, t) => {
        const e = env(k, 0.2, 0.25)
        t.armL = mix(t.armL, -128 + Math.sin(k * 28) * 5, e)
        t.tilt += 5 * e
        t.gazeY -= 4 * e
      }
    },
    {
      name: 'regarde autour',
      dur: 2800,
      run: (k, t, fx) => {
        const e = env(k, 0.15, 0.2)
        const gx = Math.sin(k * Math.PI * 2) * 24 * fx.side
        fx.gaze = true
        t.gazeX = mix(t.gazeX, gx, e)
        t.gazeY = mix(t.gazeY, -14, e)
        t.tilt += gx * 0.2 * e
      }
    },
    {
      name: 'eurêka',
      dur: 1500,
      run: (k, t, fx) => {
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
    },
    {
      name: 'suit la feuille',
      dur: 3200,
      run: (k, t, fx) => {
        const e = env(k, 0.15, 0.2)
        fx.gaze = true
        t.gazeX = mix(t.gazeX, 12 + 14 * k, e)
        t.gazeY = mix(t.gazeY, -22 + 50 * k, e)
        t.tilt += 6 * k * e
      }
    },
    {
      name: 'se dandine',
      dur: 2600,
      run: (k, t) => {
        const e = env(k, 0.15, 0.2)
        const w = Math.sin(k * Math.PI * 2)
        t.lean += 5 * w * e
        t.footL += Math.max(0, w) * 16 * e
        t.footR += Math.max(0, -w) * 16 * e
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
const GAP: Record<MarkState, [number, number]> = { rest: [3500, 8000], intro: [99999, 99999], listen: [2200, 5000], think: [1600, 3800], speak: [800, 2400] }

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
    // Débit de parole inventé quand on n'a pas le volume réel : syllabes de longueur et de forme variées, petites pauses.
    const nextSyllable = (at: number) => {
      const pause = Math.random() < 0.12
      return { start: at, end: at + (pause ? rnd(180, 420) : rnd(120, 240)), pause, open: rnd(0.35, 1), wide: rnd(-0.6, 0.9) }
    }
    let syl = nextSyllable(last)
    let accentAt = 0
    const mouth = { open: spring(0), wide: spring(0), smile: spring(SMILE[first]), base: spring(MOUTH_W[first]) }
    let raf = 0

    const tick = (now: number) => {
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
      if (st === 'think') {
        t.lean += Math.sin(s * 0.9) * 3
        t.armL += Math.sin(s * 0.9) * 6 // les bras suivent le balancement
        t.armR += Math.sin(s * 0.9) * 6
      }
      if (st === 'speak') t.lean += Math.sin(s * 1.3) * 2.5

      // Geste en cours, ou tirage du suivant.
      const fx: Fx = { gaze: false, mouth: null, rustle: 0, once: () => false, push: () => {}, side: 1 }
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
          say = Math.max(0, Math.min(1, ((low + mid + high) / 3 - 0.06) * 2.8))
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
        sacc = st === 'think' ? { x: (Math.random() < 0.5 ? -1 : 1) * rnd(10, 26), y: rnd(-6, 4) } : { x: rnd(-10, 10) * amp, y: rnd(-6, 6) * amp }
        saccadeAt = now + (st === 'think' ? rnd(900, 1800) : rnd(1400, 3600))
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
      <path className="e-armL" d={extra ? ARM_GAP : ARM} fill={fill} {...extra} />
      <path className="e-armR" d={extra ? ARM_GAP : ARM} fill={fill} {...extra} />
    </>
  )
  const box = { x: -400, y: -400, width: 2800, height: 2800 }

  return (
    <svg ref={root} className="ch ch-esprit" viewBox="140 110 1650 1650" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={`${id}m`}>
          <path className="e-mouth" />
        </clipPath>
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
                  </g>
                </g>
                <path className="e-shut" d={`M${e.x - 40} ${e.y - 4}Q${e.x} ${e.y + 30} ${e.x + 40} ${e.y - 4}`} stroke={INK} strokeWidth={14} fill="none" strokeLinecap="round" opacity="0" />
              </g>
            ))}
            <g transform={`translate(${MOUTH.x} ${MOUTH.y})`}>
              <path className="e-mouth" fill={INK} stroke={INK} strokeWidth={13} strokeLinejoin="round" />
              <ellipse className="e-tongue" cx={0} cy={0} rx={0} ry={0} fill={TONGUE} clipPath={`url(#${id}m)`} opacity="0" />
            </g>
          </g>
        </g>
        <g mask={`url(#${id}a)`}>{arms(COLOR)}</g>
        <g className="e-can" fill={COLOR}>{lobeShapes()}</g>
      </g>
    </svg>
  )
}
