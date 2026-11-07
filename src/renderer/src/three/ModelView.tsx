import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { MediaItem } from '../../../shared/types'
import { blobShadow, frameDistance, instance, lightScene, VIEWS, type Look, type ModelStats, type ViewName } from './model'

/** Commandes d'une vue 3D, pour la visionneuse. */
export type ModelApi = {
  setView: (v: ViewName) => void
  frame: () => void
  capture: () => string | null
  time: () => { t: number; d: number } | null
  seek: (t: number) => void
  setClip: (i: number) => void
}

/** Caméra partagée entre deux vues (comparaison) : direction et distance relative au cadrage de chacune. */
export type CameraSync = { subs: Set<(dir: THREE.Vector3, ratio: number, from: object) => void> }
export const makeSync = (): CameraSync => ({ subs: new Set() })

type Props = {
  m: MediaItem
  look?: Look
  theme?: 'light' | 'dark'
  /** Molette (zoom) et déplacement : visionneuse seulement ; dans le fil la molette fait défiler. */
  zoom?: boolean
  autoRotate?: boolean
  play?: boolean
  grid?: boolean
  axes?: boolean
  dims?: boolean
  selected?: string | null
  hidden?: Record<string, boolean>
  sync?: CameraSync
  /** Garder l'image rendue lisible (capture). */
  capture?: boolean
  apiRef?: MutableRefObject<ModelApi | null>
  onReady?: (s: ModelStats) => void
  onDoubleClick?: () => void
  className?: string
  style?: CSSProperties
}

type Ctx = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  root: THREE.Object3D
  grid: THREE.GridHelper
  shadow: THREE.Mesh
  box: THREE.Box3Helper
  sel: THREE.BoxHelper | null
  mixer: THREE.AnimationMixer | null
  action: THREE.AnimationAction | null
  clips: THREE.AnimationClip[]
  target: THREE.Vector3
  base: number
  r: number
  orig: WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>
  over: Partial<Record<Look, THREE.Material>>
}

const AXES = [
  { l: 'X', c: '#E5826B', v: new THREE.Vector3(1, 0, 0) },
  { l: 'Y', c: '#8DBF7A', v: new THREE.Vector3(0, 1, 0) },
  { l: 'Z', c: '#7FA8DA', v: new THREE.Vector3(0, 0, 1) }
]

/** Vue 3D vivante d'un média « model ». Le contexte WebGL n'existe que tant que la vue est à l'écran. */
export function ModelView(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const giz = useRef<SVGSVGElement>(null)
  const ctx = useRef<Ctx | null>(null)
  const props = useRef(p)
  props.current = p
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  useEffect(() => {
    const el = host.current!
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const el = host.current!
    let dead = false
    let raf = 0
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!p.capture })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    const canvas = renderer.domElement
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none'
    el.prepend(canvas)
    const scene = new THREE.Scene()
    const env = lightScene(scene, renderer)
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.autoRotateSpeed = 1.2
    controls.enableZoom = !!p.zoom
    controls.enablePan = !!p.zoom

    const size = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      const c = ctx.current
      if (c) c.base = frameDistance(c.r, camera.fov, camera.aspect)
    }
    const ro = new ResizeObserver(size)
    ro.observe(el)
    size()

    let applying = false
    const onSync = (dir: THREE.Vector3, ratio: number, from: object) => {
      const c = ctx.current
      if (!c || from === ctx) return
      applying = true
      camera.position.copy(c.target).addScaledVector(dir, ratio * c.base)
      controls.update()
      applying = false
    }
    const sync = p.sync
    sync?.subs.add(onSync)
    controls.addEventListener('change', () => {
      const c = ctx.current
      if (!c || applying || !sync) return
      const d = camera.position.clone().sub(c.target)
      const dist = d.length()
      d.normalize()
      for (const f of sync.subs) f(d, dist / c.base, ctx)
    })

    const clock = new THREE.Clock()
    const tmp = new THREE.Vector3()
    const inv = new THREE.Quaternion()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = clock.getDelta()
      const c = ctx.current
      if (!c) return
      if (c.mixer && props.current.play) c.mixer.update(dt)
      controls.update()
      c.sel?.update()
      renderer.render(scene, camera)
      const svg = giz.current
      if (svg) {
        inv.copy(camera.quaternion).invert()
        AXES.forEach((a, i) => {
          tmp.copy(a.v).applyQuaternion(inv)
          const line = svg.children[i * 2] as SVGLineElement
          const txt = svg.children[i * 2 + 1] as SVGTextElement
          line.setAttribute('x2', String(32 + tmp.x * 18))
          line.setAttribute('y2', String(32 - tmp.y * 18))
          txt.setAttribute('x', String(32 + tmp.x * 27))
          txt.setAttribute('y', String(32 - tmp.y * 27 + 3.5))
        })
      }
    }

    instance(p.m)
      .then(({ root, clips, stats }) => {
        if (dead) return
        const [sx, sy, sz] = stats.size
        const r = Math.max(0.0001, Math.hypot(sx, sy, sz) / 2)
        const dark = props.current.theme !== 'light'
        const grid = new THREE.GridHelper(Math.max(sx, sz, sy) * 3, 12, dark ? 0xf0eee6 : 0x141413, dark ? 0xf0eee6 : 0x141413)
        const gm = grid.material as THREE.Material
        gm.transparent = true
        gm.opacity = dark ? 0.1 : 0.1
        gm.depthWrite = false
        const shadow = blobShadow(r * 0.9, dark ? 0.45 : 0.22)
        const box = new THREE.Box3Helper(new THREE.Box3().setFromObject(root), 0x8fb8e8)
        scene.add(root, grid, shadow, box)
        let mixer: THREE.AnimationMixer | null = null
        let action: THREE.AnimationAction | null = null
        if (clips.length) {
          mixer = new THREE.AnimationMixer(root)
          action = mixer.clipAction(clips[0])
          action.play()
        }
        camera.near = r / 100
        camera.far = r * 200
        camera.updateProjectionMatrix()
        controls.minDistance = r * 0.3
        controls.maxDistance = r * 20
        const target = new THREE.Vector3(0, sy / 2, 0)
        controls.target.copy(target)
        const base = frameDistance(r, camera.fov, camera.aspect)
        camera.position.copy(target).addScaledVector(VIEWS.troisQuarts.clone().normalize(), base)
        controls.update()
        ctx.current = { renderer, scene, camera, controls, root, grid, shadow, box, sel: null, mixer, action, clips, target, base, r, orig: new WeakMap(), over: {} }
        apply()
        setStatus('ready')
        props.current.onReady?.(stats)
        loop()
      })
      .catch((e: Error) => {
        if (dead) return
        setErr(e?.message || 'Lecture impossible')
        setStatus('error')
      })

    if (p.apiRef)
      p.apiRef.current = {
        setView: (v) => {
          const c = ctx.current
          if (!c) return
          camera.position.copy(c.target).addScaledVector(VIEWS[v].clone().normalize(), camera.position.distanceTo(c.target))
          controls.update()
        },
        frame: () => {
          const c = ctx.current
          if (!c) return
          controls.target.copy(c.target)
          const d = camera.position.clone().sub(c.target).normalize()
          camera.position.copy(c.target).addScaledVector(d, c.base)
          controls.update()
        },
        capture: () => {
          if (!ctx.current) return null
          renderer.render(scene, camera)
          return canvas.toDataURL('image/png')
        },
        time: () => {
          const a = ctx.current?.action
          if (!a) return null
          const d = a.getClip().duration
          return { t: d ? a.time % d : 0, d }
        },
        seek: (t) => {
          const c = ctx.current
          if (!c?.action || !c.mixer) return
          c.action.time = t
          c.mixer.update(0)
        },
        setClip: (i) => {
          const c = ctx.current
          if (!c?.mixer || !c.clips[i]) return
          const next = c.mixer.clipAction(c.clips[i])
          if (next === c.action) return
          c.mixer.stopAllAction()
          next.reset().play()
          c.action = next
        }
      }

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      sync?.subs.delete(onSync)
      controls.dispose()
      const c = ctx.current
      if (c) {
        Object.values(c.over).forEach((mt) => mt?.dispose())
        c.shadow.geometry.dispose()
        ;(c.shadow.material as THREE.MeshBasicMaterial).map?.dispose()
        c.grid.dispose()
        c.box.dispose()
        c.sel?.dispose()
        c.mixer?.stopAllAction()
      }
      env.dispose()
      renderer.dispose()
      canvas.remove()
      ctx.current = null
      if (p.apiRef) p.apiRef.current = null
      setStatus('loading')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.m.id, visible])

  function apply() {
    const c = ctx.current
    if (!c) return
    const q = props.current
    const look = q.look ?? 'rendu'
    const dark = q.theme !== 'light'
    if (look !== 'rendu' && !c.over[look])
      c.over[look] =
        look === 'argile'
          ? new THREE.MeshStandardMaterial({ color: 0xcfc9bc, roughness: 0.9, side: THREE.DoubleSide })
          : look === 'fil'
            ? new THREE.MeshBasicMaterial({ color: dark ? 0xf0eee6 : 0x3a3935, wireframe: true, transparent: true, opacity: 0.7 })
            : new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
    let selMesh: THREE.Mesh | null = null
    c.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      if (!c.orig.has(mesh)) c.orig.set(mesh, mesh.material)
      mesh.material = look === 'rendu' ? c.orig.get(mesh)! : c.over[look]!
      mesh.visible = !q.hidden?.[mesh.userData.partId]
      if (q.selected && mesh.userData.partId === q.selected) selMesh = mesh
    })
    if (c.sel) {
      c.scene.remove(c.sel)
      c.sel.dispose()
      c.sel = null
    }
    if (selMesh) {
      c.sel = new THREE.BoxHelper(selMesh, 0x8fb8e8)
      c.scene.add(c.sel)
    }
    c.grid.visible = q.grid !== false
    c.shadow.visible = look !== 'fil'
    c.box.visible = !!q.dims
    c.controls.autoRotate = !!q.autoRotate
    if (c.action) c.action.paused = !q.play
  }

  useEffect(apply, [p.look, p.grid, p.dims, p.selected, p.hidden, p.autoRotate, p.play, p.theme])

  return (
    <div ref={host} className={p.className} style={{ position: 'relative', overflow: 'hidden', ...p.style }} onDoubleClick={p.onDoubleClick}>
      {status !== 'ready' && (
        <span className="model-status" role={status === 'error' ? 'alert' : 'status'}>
          {status === 'error' ? `Aperçu impossible : ${err}` : 'Préparation de l’aperçu…'}
        </span>
      )}
      {p.axes && status === 'ready' && (
        <svg ref={giz} className="model-gizmo" aria-hidden="true" width="64" height="64" viewBox="0 0 64 64">
          {AXES.flatMap((a) => [
            <line key={a.l} x1="32" y1="32" x2="32" y2="32" stroke={a.c} strokeWidth="2" strokeLinecap="round" />,
            <text key={a.l + 't'} x="32" y="32" textAnchor="middle" fill={a.c} fontSize="10" fontWeight="600">{a.l}</text>
          ])}
        </svg>
      )}
    </div>
  )
}
