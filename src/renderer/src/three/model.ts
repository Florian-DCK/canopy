import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { MediaItem } from '../../../shared/types'

// Modèles 3D des sessions : chargement (une fois par média), statistiques, mise au sol, vignettes figées.
// Chaque vue reçoit sa propre copie de la scène (SkeletonUtils.clone) : matériaux et géométries partagés.

export type Look = 'rendu' | 'argile' | 'fil' | 'normales'
export type Part = { id: string; name: string; triangles: number }
export type ModelStats = {
  triangles: number
  vertices: number
  parts: Part[]
  materials: { name: string; color?: string }[]
  textures: { name: string; w?: number; h?: number }[]
  animations: { name: string; duration: number }[]
  size: [number, number, number]
  /** Unité connue (glTF = mètres) ; sinon les cotes restent sans unité. */
  meters: boolean
}
type Raw = { root: THREE.Object3D; clips: THREE.AnimationClip[]; stats: ModelStats }

export const extOf = (name: string) => name.toLowerCase().replace(/^.*\./, '')
/** Le fichier est servi sous son nom : les fichiers voisins (textures, .mtl) se résolvent à côté. */
export const modelUrl = (m: MediaItem) => `atelier-media://media/${m.id}/${encodeURIComponent(m.name)}`

const cache = new Map<string, Promise<Raw>>()

export function loadModel(m: MediaItem): Promise<Raw> {
  let p = cache.get(m.id)
  if (!p) {
    p = loadRaw(m).then(normalize)
    p.catch(() => cache.delete(m.id))
    cache.set(m.id, p)
    if (cache.size > 12) cache.delete(cache.keys().next().value!)
  }
  return p
}

/** Copie indépendante pour une vue (squelettes compris). */
export async function instance(m: MediaItem) {
  const raw = await loadModel(m)
  return { root: SkeletonUtils.clone(raw.root), clips: raw.clips, stats: raw.stats }
}

async function loadRaw(m: MediaItem): Promise<{ root: THREE.Object3D; clips: THREE.AnimationClip[]; meters: boolean }> {
  const url = modelUrl(m)
  const ext = extOf(m.name)
  if (ext === 'glb' || ext === 'gltf') {
    const g = await new GLTFLoader().loadAsync(url)
    return { root: g.scene, clips: g.animations, meters: true }
  }
  if (ext === 'fbx') {
    const o = await new FBXLoader().loadAsync(url)
    return { root: o, clips: o.animations ?? [], meters: false }
  }
  if (ext === 'stl') {
    const geo = await new STLLoader().loadAsync(url)
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb9b5aa, roughness: 0.75, metalness: 0.05, name: 'Matière' }))
    mesh.name = m.name.replace(/\.[^.]+$/, '')
    return { root: mesh, clips: [], meters: false }
  }
  if (ext === 'obj') {
    const text = await (await fetch(url)).text()
    const loader = new OBJLoader()
    const lib = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim()
    if (lib) {
      try {
        const base = url.slice(0, url.lastIndexOf('/') + 1)
        const mats = await new MTLLoader().setPath(base).loadAsync(encodeURIComponent(lib))
        mats.preload()
        loader.setMaterials(mats)
      } catch {
        /* .mtl absent : matériaux par défaut */
      }
    }
    return { root: loader.parse(text), clips: [], meters: false }
  }
  throw new Error(`Format .${ext} non pris en charge`)
}

/** Pose le modèle au sol, centré, et relève ses statistiques. */
function normalize({ root, clips, meters }: { root: THREE.Object3D; clips: THREE.AnimationClip[]; meters: boolean }): Raw {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const c = box.getCenter(new THREE.Vector3())
  const group = new THREE.Group()
  root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z))
  group.add(root)
  const size = box.getSize(new THREE.Vector3())

  let triangles = 0
  let vertices = 0
  const parts: Part[] = []
  const mats = new Map<string, THREE.Material>()
  const texs = new Map<string, THREE.Texture>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const g = mesh.geometry
    const pos = g.attributes.position
    const t = Math.round((g.index ? g.index.count : pos?.count ?? 0) / 3)
    triangles += t
    vertices += pos?.count ?? 0
    // Identifiant stable d'une copie à l'autre (les uuid changent au clonage, userData est recopié).
    mesh.userData.partId = `p${parts.length}`
    parts.push({ id: mesh.userData.partId, name: mesh.name || `Maillage ${parts.length + 1}`, triangles: t })
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!mat) continue
      mats.set(mat.uuid, mat)
      for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) texs.set((v as THREE.Texture).uuid, v as THREE.Texture)
    }
  })
  const stats: ModelStats = {
    triangles,
    vertices,
    parts,
    materials: [...mats.values()].map((mt, i) => {
      const col = (mt as THREE.MeshStandardMaterial).color
      return { name: mt.name || `Matériau ${i + 1}`, color: col ? `#${col.getHexString()}` : undefined }
    }),
    textures: [...texs.values()].map((tx, i) => {
      const img = tx.image as { width?: number; height?: number; src?: string } | undefined
      const fromSrc = img?.src && !img.src.startsWith('blob:') && !img.src.startsWith('data:') ? decodeURIComponent(img.src.split('/').pop() ?? '') : ''
      return { name: tx.name || fromSrc || `Texture ${i + 1}`, w: img?.width, h: img?.height }
    }),
    animations: clips.map((a, i) => ({ name: a.name || `Animation ${i + 1}`, duration: a.duration })),
    size: [size.x, size.y, size.z],
    meters
  }
  return { root: group, clips, stats }
}

/** Direction de caméra des vues nommées (le modèle regarde +Z). */
export const VIEWS = {
  face: new THREE.Vector3(0, 0.08, 1),
  cote: new THREE.Vector3(1, 0.08, 0),
  dessus: new THREE.Vector3(0, 1, 0.0001),
  troisQuarts: new THREE.Vector3(0.8, 0.5, 1)
} as const
export type ViewName = keyof typeof VIEWS

/** Distance pour cadrer une sphère de rayon r avec un champ vertical fov (degrés) et un rapport largeur/hauteur. */
export function frameDistance(r: number, fov: number, aspect: number) {
  const v = THREE.MathUtils.degToRad(fov) / 2
  const h = Math.atan(Math.tan(v) * aspect)
  return (r / Math.sin(Math.min(v, h))) * 1.08
}

/** Lumières communes : environnement studio (PBR) + soleil doux. */
export function lightScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = env
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(-3, 6, 4)
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.6))
  return env
}

/** Ombre de contact floue (disque dégradé) sous le modèle. */
export function blobShadow(radius: number, strength = 0.35) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, `rgba(0,0,0,${strength})`)
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.001
  mesh.renderOrder = -1
  return mesh
}

// ── Vignettes figées : un seul contexte WebGL pour toutes les miniatures (le nombre de contextes est limité). ──

let snapRenderer: THREE.WebGLRenderer | null = null
let snapScene: THREE.Scene | null = null
const snaps = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()

export function snapshot(m: MediaItem, w: number, h: number): Promise<string> {
  const key = `${m.id}:${w}x${h}`
  let p = snaps.get(key)
  if (!p) {
    p = (queue = queue.then(() => renderSnap(m, w, h)).catch(() => '')) as Promise<string>
    snaps.set(key, p)
  }
  return p
}

async function renderSnap(m: MediaItem, w: number, h: number): Promise<string> {
  const { root, stats } = await instance(m)
  if (!snapRenderer) {
    snapRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    snapRenderer.outputColorSpace = THREE.SRGBColorSpace
    snapRenderer.toneMapping = THREE.ACESFilmicToneMapping
    snapScene = new THREE.Scene()
    lightScene(snapScene, snapRenderer)
  }
  const ratio = 2
  snapRenderer.setPixelRatio(ratio)
  snapRenderer.setSize(w, h, false)
  const [sx, sy, sz] = stats.size
  const r = Math.max(0.0001, Math.hypot(sx, sy, sz) / 2)
  const shadow = blobShadow(r * 0.9, 0.22)
  snapScene!.add(root, shadow)
  const cam = new THREE.PerspectiveCamera(35, w / h, r / 100, r * 100)
  const target = new THREE.Vector3(0, sy / 2, 0)
  cam.position.copy(VIEWS.troisQuarts.clone().normalize().multiplyScalar(frameDistance(r, 35, w / h)).add(target))
  cam.lookAt(target)
  snapRenderer.setClearColor(0x000000, 0)
  snapRenderer.render(snapScene!, cam)
  const url = snapRenderer.domElement.toDataURL('image/png')
  snapScene!.remove(root, shadow)
  shadow.geometry.dispose()
  ;(shadow.material as THREE.MeshBasicMaterial).map?.dispose()
  return url
}

export const fmtInt = (n: number) => n.toLocaleString('fr-BE')
export const fmtDim = (n: number) => n.toLocaleString('fr-BE', { maximumFractionDigits: n < 10 ? 2 : 0 })
