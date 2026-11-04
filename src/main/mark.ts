import { BrowserWindow, screen } from 'electron'
import type { CaptureResult, MarkParams, MarkTarget } from '../shared/types'
import { locate } from './act'
import { captureScreen } from './screen'

// Mode compagnon (planche 37) : Claude met en évidence une zone de l'écran. Une fenêtre transparente au-dessus de tout,
// que les clics traversent, où l'on dessine à main levée : entourer, souligner, projecteur, étapes numérotées.
// Le style suit ce qu'on montre (texte : souligner ; élément, graphique : entourer ; photo, image : projecteur).

let win: BrowserWindow | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden}
svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.d{fill:none;stroke:#D97757;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:loop 1.7s cubic-bezier(.5,.1,.3,1) 2,draw 1.1s cubic-bezier(.5,.1,.3,1) 3.4s forwards}
.f{opacity:0;animation:fade .35s ease forwards}
.dim{opacity:0;animation:fade .5s ease forwards}
.out{transition:opacity .4s ease;opacity:0!important}
@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
/* Le trait se dessine deux fois puis reste : l'œil a le temps de le suivre et de trouver l'endroit. */
@keyframes loop{0%{stroke-dashoffset:1;opacity:1}60%{stroke-dashoffset:0;opacity:1}85%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes fade{to{opacity:1}}
text{font-family:Georgia,serif}
</style><svg id="s"></svg>
<script>
const NS='http://www.w3.org/2000/svg', s=document.getElementById('s');
function rng(seed){return()=>{seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296}}
function closed(pts,seed,wob){const r=rng(seed),n=pts.length,p=pts.map(([x,y])=>[x+(r()-.5)*2*wob,y+(r()-.5)*2*wob]),o=[],tot=Math.floor(n*1.12)+1;
for(let i=0;i<tot;i++){const a=p[(i-1+n)%n],b=p[i%n],c=p[(i+1)%n],d=p[(i+2)%n];for(let k=0;k<10;k++){const t=k/10,t2=t*t,t3=t2*t;
o.push([.5*(2*b[0]+(-a[0]+c[0])*t+(2*a[0]-5*b[0]+4*c[0]-d[0])*t2+(-a[0]+3*b[0]-3*c[0]+d[0])*t3),.5*(2*b[1]+(-a[1]+c[1])*t+(2*a[1]-5*b[1]+4*c[1]-d[1])*t2+(-a[1]+3*b[1]-3*c[1]+d[1])*t3)])}}
return 'M'+o.map(q=>q[0].toFixed(1)+' '+q[1].toFixed(1)).join(' L')}
function ell(cx,cy,rx,ry,n){const o=[];for(let i=0;i<n;i++){const a=-2.2+2*Math.PI*i/n;o.push([cx+rx*Math.cos(a),cy+ry*Math.sin(a)])}return o}
function grow(pts,d){const cx=pts.reduce((a,p)=>a+p[0],0)/pts.length,cy=pts.reduce((a,p)=>a+p[1],0)/pts.length;return pts.map(([x,y])=>{const dx=x-cx,dy=y-cy,L=Math.hypot(dx,dy)||1;return[x+dx/L*d,y+dy/L*d]})}
function line(x0,y0,x1,y1,seed,amp){const r=rng(seed),ph=r()*6,o=[];for(let i=0;i<=24;i++){const t=i/24;o.push((x0+(x1-x0)*t).toFixed(1)+' '+(y0+(y1-y0)*t+amp*Math.sin(t*6.5+ph)).toFixed(1))}return 'M'+o.join(' L')}
function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);(parent||s).appendChild(e);return e}
function stroke(d,w,delay,op){return el('path',{d,class:'d','stroke-width':w,pathLength:1,opacity:op??1,style:'animation-delay:'+delay+'s,'+(delay+3.4)+'s'})}
function bbox(t){if(t.points){const xs=t.points.map(p=>p[0]),ys=t.points.map(p=>p[1]);const x=Math.min(...xs),y=Math.min(...ys);return{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y}}return t}
function outline(t){const b=bbox(t);if(t.points)return grow(t.points,16);if(t.shape==='ellipse')return ell(b.x+b.w/2,b.y+b.h/2,b.w/2+12,b.h/2+12,8);return ell(b.x+b.w/2,b.y+b.h/2,b.w/2+Math.min(26,8+b.w*.08),b.h/2+Math.min(18,8+b.h*.2),10)}
function holeOf(t){const b=bbox(t);if(t.lines)return t.lines.map(l=>'M'+(l.x-6)+' '+(l.y-3)+'H'+(l.x+l.w+6)+'V'+(l.y+l.h+3)+'H'+(l.x-6)+'Z').join(' ');
if(t.points){const p=grow(t.points,12);return 'M'+p.map(q=>q[0].toFixed(1)+' '+q[1].toFixed(1)).join(' L')+'Z'}
if(t.shape==='ellipse'){const rx=b.w/2+10,ry=b.h/2+10,cx=b.x+b.w/2,cy=b.y+b.h/2;return 'M'+(cx-rx)+' '+cy+'A'+rx+' '+ry+' 0 1 0 '+(cx+rx)+' '+cy+'A'+rx+' '+ry+' 0 1 0 '+(cx-rx)+' '+cy+'Z'}
const x=b.x-10,y=b.y-10,w=b.w+20,h=b.h+20,r=Math.min(16,h/2);return 'M'+(x+r)+' '+y+'H'+(x+w-r)+'A'+r+' '+r+' 0 0 1 '+(x+w)+' '+(y+r)+'V'+(y+h-r)+'A'+r+' '+r+' 0 0 1 '+(x+w-r)+' '+(y+h)+'H'+(x+r)+'A'+r+' '+r+' 0 0 1 '+x+' '+(y+h-r)+'V'+(y+r)+'A'+r+' '+r+' 0 0 1 '+(x+r)+' '+y+'Z'}
function linesOf(t){if(t.lines)return t.lines;const b=bbox(t),n=Math.max(1,Math.round(b.h/26)),h=b.h/n,o=[];for(let i=0;i<n;i++)o.push({x:b.x,y:b.y+i*h,w:b.w,h});return o}
function badge(n,x,y,delay){const g=el('g',{class:'f',style:'animation-delay:'+delay+'s'});el('circle',{cx:x,cy:y,r:15,fill:'#D97757'},g);const t=el('text',{x,y:y+6,'text-anchor':'middle','font-size':17,fill:'#fff'},g);t.textContent=n}
window.show=(spec)=>{s.innerHTML='';s.classList.remove('out');const W=innerWidth,H=innerHeight;let delay=0;
const spots=spec.targets.filter(t=>t.style==='spotlight');
if(spots.length){el('path',{class:'dim','fill-rule':'evenodd',fill:'rgba(20,20,19,0.55)',d:'M0 0H'+W+'V'+H+'H0Z '+spots.map(holeOf).join(' ')})}
spec.targets.forEach((t,i)=>{const seed=7+i*13;
if(t.style==='circle'){stroke(closed(outline(t),seed,t.points?5:3),4.5,delay);stroke(closed(outline(t),seed+5,4),2,delay+.08,.5)}
else if(t.style==='underline'){linesOf(t).forEach((l,k)=>stroke(line(l.x-2,l.y+l.h+3,l.x+l.w+2,l.y+l.h+4.5,seed+k,1.8),4,delay+k*.4))}
else{const p=el('path',{class:'f',d:holeOf(t),fill:'none',stroke:'#D97757','stroke-width':3,'stroke-linejoin':'round',style:'animation-delay:'+delay+'s'})}
if(spec.steps){const b=bbox(t);badge(i+1,b.x-14,b.y-14,delay)}
if(spec.steps)delay+=1.1});
};
window.clear=()=>{s.classList.add('out')};
</script>`

function ensureWindow(): BrowserWindow {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      ...d.bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true)
  } else win.setBounds(d.bounds)
  return win
}

/** Effacer les marques (fondu, puis la fenêtre se cache). */
export function clearMarks() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const w = win
  void w.webContents.executeJavaScript('clear()').catch(() => {})
  setTimeout(() => {
    if (!w.isDestroyed()) w.hide()
  }, 450)
}

/** Ce qu'on montre décide du style quand Claude ne l'impose pas. */
function styleFor(kind: MarkTarget['kind'] | undefined): 'circle' | 'underline' | 'spotlight' {
  if (kind === 'text') return 'underline'
  if (kind === 'image') return 'spotlight'
  return 'circle'
}

type Box = { x: number; y: number; w: number; h: number }

export async function runMark(p: MarkParams): Promise<CaptureResult> {
  if (p.clear) {
    clearMarks()
    return { ok: true, info: 'Marques effacées.' }
  }
  if (!p.targets?.length) return { ok: false, info: 'Rien à montrer : donne au moins une cible.' }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // Coordonnées données en pixels de la capture de l'outil écran (réduite à 1600 de large au plus).
  const scale = Math.min(1, 1600 / d.size.width)
  const cap = (x: number, y: number) => [x / scale, y / scale]
  const capBox = (b: Box): Box => ({ x: b.x / scale, y: b.y / scale, w: b.w / scale, h: b.h / scale })
  const targets: object[] = []
  const missing: string[] = []
  for (const t of p.targets) {
    let box: Box | undefined
    if (t.target) {
      const loc = await locate(t.target, t.uiKind)
      if (!loc) {
        missing.push(t.target)
        continue
      }
      const dip = screen.screenToDipRect(null, { x: loc.x, y: loc.y, width: loc.w, height: loc.h })
      box = { x: dip.x - d.bounds.x, y: dip.y - d.bounds.y, w: dip.width, h: dip.height }
    } else if (t.w !== undefined && t.h !== undefined && t.x !== undefined && t.y !== undefined) box = capBox({ x: t.x, y: t.y, w: t.w, h: t.h })
    const points = t.points?.length && t.points.length >= 3 ? t.points.map(([x, y]) => cap(x, y)) : undefined
    const lines = t.lines?.length ? t.lines.map(capBox) : undefined
    if (!box && !points && !lines) {
      missing.push('cible sans position')
      continue
    }
    const kind = t.kind ?? p.kind
    const style = p.style && p.style !== 'auto' ? p.style : styleFor(kind)
    const lb = lines
      ? (() => {
          const x = Math.min(...lines.map((l) => l.x))
          const y = Math.min(...lines.map((l) => l.y))
          return { x, y, w: Math.max(...lines.map((l) => l.x + l.w)) - x, h: Math.max(...lines.map((l) => l.y + l.h)) - y }
        })()
      : undefined
    targets.push({ ...(box ?? lb ?? {}), shape: t.shape ?? 'rect', points, lines, style })
  }
  if (!targets.length) return { ok: false, info: `Introuvable à l'écran : ${missing.join(', ')}.` }
  const w = ensureWindow()
  if (w.webContents.getURL() === '') await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
  if (hideTimer) clearTimeout(hideTimer)
  if (!w.isVisible()) w.showInactive()
  await w.webContents.executeJavaScript(`show(${JSON.stringify({ targets, steps: !!p.steps })})`).catch(() => {})
  const secs = Math.max(2, Math.min(60, p.seconds ?? (p.steps ? 7 + targets.length * 1.5 : 10)))
  hideTimer = setTimeout(clearMarks, secs * 1000)
  const styles = [...new Set(targets.map((t) => (t as { style: string }).style))].join(', ')
  const info = `Mis en évidence (${styles}) pendant ${Math.round(secs)} s.${missing.length ? ` Introuvable : ${missing.join(', ')}.` : ''}`
  if (!p.look) return { ok: true, info }
  // Le premier tracé est complet vers 1,7 s : la capture montre la marque en place.
  await new Promise((r) => setTimeout(r, 1900))
  const shot = await captureScreen('screen')
  return { ok: true, info: `${info} Capture jointe : vérifie que la marque tombe juste, sinon recommence avec la position corrigée.`, image: shot.image }
}
