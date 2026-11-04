"""Génère src/renderer/src/voice/CanopyMark.tsx : le logo (canopy-mark.svg) découpé en calques animables.

Soleil = disque r344 + tracé exact ; arbres = trous d'un masque qui bougent (pivot au pied du tronc) ;
petits éclats entre les branches = îlots argile qui suivent leur arbre. Au repos : identique au logo.
Relancer après une retouche du logo : python design/logo/make_canopy_mark.py"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
d = re.search(r' d="([^"]+)"', open(os.path.join(HERE, "canopy-mark.svg"), encoding="utf-8").read()).group(1)
subs = ["M " + s.strip() for s in d.split("M ") if s.strip()]
key = {s.split()[1]: s for s in subs}
outer, center = key["483"], key["516"]
isl_c = key["534.724"] + " " + key["476.700"]
isl_l = key["308.649"] + " " + key["361.500"]
isl_r = key["706.995"] + " " + key["652.026"]
mark = " ".join(subs[1:-1])  # sans les deux poussières de coin du tracé

TSX = f'''// Généré par design/logo/make_canopy_mark.py à partir de design/logo/canopy-mark.svg : ne pas éditer à la main.
import {{ useEffect, useId, useRef }} from 'react'

export type MarkState = 'rest' | 'intro' | 'listen' | 'think' | 'speak'

const OUTER = '{outer}'
const CENTER = '{center}'
const ISL_C = '{isl_c}'
const ISL_L = '{isl_l}'
const ISL_R = '{isl_r}'
const MARK = '{mark}'

/** Barres de l'onde qui remplace le trait du sol quand Claude parle (même épaisseur que le trait au repos). */
const BARS = Array.from({{ length: 37 }}, (_, k) => 214 + k * 16)

/** Le logo Canopy vivant (planche 31) : écoute (arbres au vent), réfléchit (orbite), parle (le sol devient l'onde
 * de la voix). `levels` donne, à chaque image, le volume de la voix par barre (0 à 1). */
export function CanopyMark({{ state, size, levels }}: {{ state: MarkState; size: number; levels?: (n: number) => number[] }}) {{
  const u = useId().replace(/:/g, '')
  const id = (k: string) => `${{k}}-${{u}}`
  const url = (k: string) => `url(#${{id(k)}})`
  const wave = useRef<SVGGElement>(null)
  useEffect(() => {{
    if (state !== 'speak' || !levels || !wave.current) return
    const bars = [...wave.current.querySelectorAll<SVGRectElement>('rect')]
    let raf = 0
    const tick = () => {{
      const lv = levels(bars.length)
      // On change la hauteur, pas l'échelle : les bouts restent bien ronds.
      bars.forEach((b, k) => (b.style.height = `${{17 + (lv[k] ?? 0) * 85}}px`))
      raf = requestAnimationFrame(tick)
    }}
    raf = requestAnimationFrame(tick)
    return () => {{
      cancelAnimationFrame(raf)
      bars.forEach((b) => (b.style.height = ''))
    }}
  }}, [state, levels])
  return (
    <svg className={{`cmark cm-${{state}}${{levels ? ' cm-live' : ''}}`}} viewBox="150 150 724 724" width={{size}} height={{size}} aria-hidden="true">
      <defs>
        <clipPath id={{id('sky')}}><rect x="100" y="100" width="824" height="700" /></clipPath>
        <clipPath id={{id('nog')}}><rect x="0" y="0" width="1024" height="798" /></clipPath>
        <clipPath id={{id('gnd')}}><rect x="0" y="796" width="1024" height="60" /></clipPath>
        <clipPath id={{id('l')}}><rect x="150" y="150" width="362" height="660" /></clipPath>
        <clipPath id={{id('r')}}><rect x="512" y="150" width="362" height="660" /></clipPath>
        <mask id={{id('side')}} maskUnits="userSpaceOnUse" x="100" y="100" width="824" height="824">
          <circle cx="512" cy="512" r="344" fill="#fff" clipPath={{url('sky')}} />
          <path d={{OUTER}} fill="#000" />
        </mask>
        <mask id={{id('trees')}} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect x="0" y="0" width="1024" height="1024" fill="#fff" />
          <g className="cm-tree cm-t1">
            <g mask={{url('side')}} clipPath={{url('l')}}><rect x="180" y="420" width="290" height="380" fill="#000" /></g>
            <path d={{ISL_L}} fill="#fff" />
          </g>
          <g className="cm-tree cm-t2">
            <path d={{CENTER}} fill="#000" />
            <path d={{ISL_C}} fill="#fff" />
          </g>
          <g className="cm-tree cm-t3">
            <g mask={{url('side')}} clipPath={{url('r')}}><rect x="554" y="420" width="290" height="380" fill="#000" /></g>
            <path d={{ISL_R}} fill="#fff" />
          </g>
        </mask>
      </defs>
      <g className="cm-rings">
        <circle className="cm-ring" cx="512" cy="512" r="350" />
        <circle className="cm-ring cm-ring2" cx="512" cy="512" r="350" />
      </g>
      <g className="cm-orbit">
        <circle cx="512" cy="512" r="392" fill="none" stroke="#D57151" strokeWidth="10" strokeLinecap="round" strokeDasharray="180 2283" />
        <circle cx="512" cy="512" r="420" fill="none" stroke="#D57151" strokeWidth="8" strokeLinecap="round" strokeDasharray="70 2569" strokeDashoffset="-420" opacity="0.5" />
      </g>
      <g mask={{url('trees')}}>
        <g className="cm-clay">
          <circle cx="512" cy="512" r="344" fill="#D57151" clipPath={{url('sky')}} />
          <path d={{MARK}} fill="#D57151" fillRule="evenodd" clipPath={{url('nog')}} />
        </g>
      </g>
      <g className="cm-wave" ref={{wave}}>
        {{BARS.map((x) => <rect key={{x}} x={{x}} y="799" width="12" height="17" rx="6" fill="#D57151" />)}}
      </g>
      {{/* Le trait du sol reste par-dessus : l'onde pend dessous, ses bouts du haut cachés, sans jour entre le soleil et elle. */}}
      <path className="cm-ground" d={{MARK}} fill="#D57151" fillRule="evenodd" clipPath={{url('gnd')}} />
    </svg>
  )
}}
'''
out = os.path.join(HERE, "..", "..", "src", "renderer", "src", "voice", "CanopyMark.tsx")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8", newline="\n").write(TSX)
print("écrit", os.path.normpath(out))
