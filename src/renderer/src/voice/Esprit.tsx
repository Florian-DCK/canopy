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
}

const POSES: Record<MarkState, Pose> = {
  rest: { lean: 2, squash: 0.975, bob: 8, eyeOpen: 0, eyeSize: 1, armL: 22, armR: -16, perk: 0.97, canY: 14, leaf: 0, gazeX: 0, gazeY: 6 },
  intro: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1, armL: 25, armR: -18, perk: 1, canY: 0, leaf: 0, gazeX: 0, gazeY: 0 },
  listen: { lean: -4, squash: 1.015, bob: -6, eyeOpen: 1, eyeSize: 1.22, armL: 30, armR: -26, perk: 1.05, canY: -8, leaf: 0, gazeX: -4, gazeY: 2 },
  think: { lean: 3, squash: 1, bob: 0, eyeOpen: 0.9, eyeSize: 1, armL: 14, armR: -10, perk: 1.02, canY: 0, leaf: 1, gazeX: 14, gazeY: -18 },
  speak: { lean: 0, squash: 1, bob: 0, eyeOpen: 1, eyeSize: 1.08, armL: 26, armR: -22, perk: 1.03, canY: 0, leaf: 0, gazeX: 0, gazeY: 0 }
}
const KEYS = Object.keys(POSES.rest) as (keyof Pose)[]
// Raideur et amortissement par réglage : le corps avec un léger dépassement, le regard vif, les bras souples.
const K: Partial<Record<keyof Pose, [number, number]>> = { gazeX: [520, 42], gazeY: [520, 42], armL: [110, 13], armR: [110, 13], eyeSize: [260, 16] }

type Spring = { v: number; vel: number }
const spring = (v: number): Spring => ({ v, vel: 0 })
const stepSpring = (s: Spring, target: number, k: number, c: number, dt: number) => {
  s.vel += (k * (target - s.v) - c * s.vel) * dt
  s.v += s.vel * dt
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
      can: all('.e-can'),
      lobes: LOBES.map((_, i) => all(`.e-lobe${i}`)),
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
    let last = performance.now()
    let blinkAt = last + rnd(1500, 3500)
    let blinkStart = -1
    let doubleBlink = false
    let saccadeAt = last
    let sacc = { x: 0, y: 0 }
    let nodAt = last + rnd(1800, 3200)
    let gestureAt = last + rnd(900, 1800)
    let gesture: { arm: 'L' | 'R'; until: number; angle: number } | null = null
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
        gesture = null
        gestureAt = now + rnd(700, 1500)
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
      }
      // Une syllabe qui part fort : la tête l'accompagne d'un petit coup.
      if (say - voice > 0.35 && now > accentAt) {
        p.bob.vel -= 160 * say
        p.lean.vel += rnd(-14, 14)
        accentAt = now + 180
      }
      voice += (say - voice) * Math.min(1, dt * (say > voice ? 30 : 14))

      // Cibles du moment : la pose de l'état, plus la vie propre de l'état.
      const t: Pose = { ...POSES[st] }
      if (st === 'rest') {
        t.lean += Math.sin(s * 0.45) * 2
        t.squash += Math.sin(s * 1.6) * 0.022 // grande respiration de sommeil
      } else {
        t.squash += Math.sin(s * 3.2) * 0.008
      }
      if (st === 'listen') {
        t.lean += Math.sin(s * 0.8) * 1.5
        if (now > nodAt) {
          p.bob.vel += 260 // petit hochement
          p.lean.vel -= 18
          nodAt = now + rnd(2200, 4200)
        }
      }
      if (st === 'think') {
        t.lean += Math.sin(s * 0.9) * 3
        t.armL += Math.sin(s * 0.9) * 6 // les bras suivent le balancement
        t.armR += Math.sin(s * 0.9) * 6
      }
      if (st === 'speak') {
        t.squash += voice * 0.05
        t.bob -= voice * 18
        t.lean += Math.sin(s * 1.3) * 2.5
        if (!gesture && now > gestureAt) {
          const arm = Math.random() < 0.55 ? 'R' : 'L'
          gesture = { arm, until: now + rnd(600, 1100), angle: arm === 'R' ? rnd(-155, -125) : rnd(125, 155) }
        }
        if (gesture) {
          if (now > gesture.until) {
            gesture = null
            gestureAt = now + rnd(1200, 3200)
          } else if (gesture.arm === 'R') t.armR = gesture.angle + Math.sin(s * 9) * 8
          else t.armL = gesture.angle + Math.sin(s * 9) * 8
        }
      }
      // Regard : petits sauts (saccades) autour de la direction de l'état, sauf yeux fermés.
      if (now > saccadeAt) {
        const amp = st === 'think' ? 1 : st === 'listen' ? 0.4 : 0.6
        sacc = st === 'think' ? { x: (Math.random() < 0.5 ? -1 : 1) * rnd(10, 26), y: rnd(-6, 4) } : { x: rnd(-10, 10) * amp, y: rnd(-6, 6) * amp }
        saccadeAt = now + (st === 'think' ? rnd(900, 1800) : rnd(1400, 3600))
      }
      if (st !== 'rest') {
        t.gazeX += sacc.x
        t.gazeY += sacc.y
      }

      const sub = reduce ? 1 : 2
      for (let i = 0; i < sub; i++) {
        const h = dt / sub
        for (const k of KEYS) {
          const [kk, cc] = K[k] ?? [130, 14]
          stepSpring(p[k], t[k], kk, cc, h)
        }
        stepSpring(grow, 1, 90, 10, h)
      }
      const P = Object.fromEntries(KEYS.map((k) => [k, p[k].v])) as Pose

      // Corps : inclinaison et écrasement autour des pieds.
      const sy = P.squash * grow.v
      const sx = (1 + (1 - P.squash) * 0.7) * grow.v
      const allT = `translate(0 ${P.bob}) rotate(${P.lean} ${BASE.x} ${BASE.y}) translate(${BASE.x} ${BASE.y}) scale(${sx} ${sy}) translate(${-BASE.x} ${-BASE.y})`
      el.all.forEach((g) => g.setAttribute('transform', allT))

      // Canopée : où le haut du corps est allé cette image, elle y va avec retard (inertie), puis oscille.
      const rad = (P.lean * Math.PI) / 180
      const h = BASE.y - ANCHOR.y
      const top = { x: Math.sin(rad) * h * sy, y: P.bob + (1 - Math.cos(rad)) * h + (1 - sy) * h }
      const dTop = { x: top.x - prevTop.x, y: top.y - prevTop.y }
      prevTop = top
      can.x.v -= dTop.x * 0.55
      can.y.v -= dTop.y * 0.7
      can.r.v -= dTop.x * 0.06
      const cprev = { x: can.x.v, y: can.y.v }
      stepSpring(can.x, 0, 95, 7, dt)
      stepSpring(can.y, 0, 110, 7.5, dt)
      stepSpring(can.r, 0, 80, 6, dt)
      const dCan = { x: can.x.v - cprev.x, y: can.y.v - cprev.y }
      const canT = `translate(${can.x.v} ${can.y.v + P.canY}) rotate(${can.r.v} ${ANCHOR.x} ${ANCHOR.y}) translate(${ANCHOR.x} 820) scale(${P.perk}) translate(${-ANCHOR.x} -820)`
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
        }
        stepSpring(L.x, 0, 170, 9, dt)
        stepSpring(L.y, 0, 170, 9, dt)
        stepSpring(L.s, ts, 200, 14, dt)
        const tr = `translate(${L.x.v} ${L.y.v}) translate(${cx} ${cy}) scale(${L.s.v}) translate(${-cx} ${-cy})`
        el.lobes[i].forEach((g) => g.setAttribute('transform', tr))
      })

      el.armL.forEach((g) => g.setAttribute('transform', `translate(${ARM_L.x} ${ARM_L.y}) rotate(${P.armL})`))
      el.armR.forEach((g) => g.setAttribute('transform', `translate(${ARM_R.x} ${ARM_R.y}) rotate(${P.armR})`))

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
      el.face.forEach((g) => g.setAttribute('transform', `translate(${P.gazeX * 0.35} ${P.gazeY * 0.3})`))
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
          <path d={BODY} fill="black" {...gap} />
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
          <ellipse cx={870} cy={1640} rx={72} ry={58} fill={COLOR} />
          <ellipse cx={1110} cy={1645} rx={70} ry={55} fill={COLOR} />
        </g>
        <g mask={`url(#${id}b)`}>
          <path d={BODY} fill={COLOR} />
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
