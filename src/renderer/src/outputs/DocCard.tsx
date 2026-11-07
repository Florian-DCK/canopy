import { useEffect, useState } from 'react'
import type { DocInfo, MediaItem } from '../../../shared/types'
import { fmtSize } from '../media'
import { api, useStore } from '../store'
import './outputs.css'

// Documents dans le fil (planche 49) : vignette de la première page, pages, titres ou diapositives,
// visionneuse au clic (PDF de Chromium ; Word / PowerPoint en texte et plan, ou aperçu fidèle converti).

type Info = DocInfo & { thumb?: string; pdf?: string }
const LABEL: Record<DocInfo['type'], string> = { pdf: 'PDF', word: 'WORD', powerpoint: 'POWERPOINT', excel: 'EXCEL' }
const APP: Record<DocInfo['type'], string> = { pdf: '', word: 'Word', powerpoint: 'PowerPoint', excel: 'Excel' }

/** Première page d'un PDF (pdf.js, chargé à la demande) et nombre de pages. */
async function pdfPreview(url: string, width = 264): Promise<{ thumb?: string; pages?: number }> {
  try {
    const pdfjs = await import('pdfjs-dist')
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = worker
    const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise
    const page = await doc.getPage(1)
    const vp0 = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: width / vp0.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: vp }).promise
    const pages = doc.numPages
    void doc.destroy()
    return { thumb: canvas.toDataURL('image/jpeg', 0.85), pages }
  } catch {
    return {}
  }
}

export function useDocInfo(m: MediaItem) {
  const [info, setInfo] = useState<Info | null>(null)
  useEffect(() => {
    let live = true
    api.docInfo(m.id).then(async (i) => {
      if (!live) return
      setInfo(i)
      if (i.pdf) {
        const p = await pdfPreview(i.pdf)
        if (live) setInfo({ ...i, thumb: p.thumb ?? i.thumb, pages: p.pages ?? i.pages })
      }
    })
    return () => {
      live = false
    }
  }, [m.id])
  return [info, setInfo] as const
}

const metaOf = (i: Info, m: MediaItem) =>
  [
    i.pages && (i.type === 'powerpoint' ? `${i.pages} diapositive${i.pages > 1 ? 's' : ''}` : `${i.pages} page${i.pages > 1 ? 's' : ''}`),
    fmtSize(m.size),
    i.words && `${i.words.toLocaleString('fr-BE')} mots`,
    i.comments && `${i.comments} commentaire${i.comments > 1 ? 's' : ''}`
  ].filter(Boolean).join(' · ')

export function DocCard({ m }: { m: MediaItem }) {
  const open = useStore((s) => s.openViewer)
  const [info] = useDocInfo(m)
  if (!info) return null
  const lead =
    info.type === 'word' && info.headings?.length
      ? `Titres : ${info.headings.filter((h) => h.level <= 2).slice(0, 4).map((h) => h.text).join(' · ')}`
      : info.type === 'powerpoint' && info.slides?.length
        ? info.slides.slice(0, 3).map((s) => s.title).filter(Boolean).join(' · ')
        : info.title
  return (
    <div className="out-card out-doc">
      <button type="button" className="out-doc-thumb" aria-label={`Ouvrir ${m.name}`} onClick={() => open({ sessionId: m.sessionId, mediaId: m.id, mode: 'single' })}>
        {info.thumb ? <img src={info.thumb} alt="" /> : <span className={`out-doc-blank ${info.type}`} aria-hidden="true"><span /><span /><span /><span /><span /></span>}
      </button>
      <div className="out-doc-body">
        <span className="out-doc-name">
          <span className={`out-doc-tag ${info.type}`}>{LABEL[info.type]}</span>
          <span className="mono">{m.name}</span>
        </span>
        <span className="small muted">{info.error ? `Lecture impossible : ${info.error}` : metaOf(info, m)}</span>
        {lead && <span className="out-doc-lead">{lead}</span>}
        <span style={{ flex: 1 }} />
        <span className="out-actions">
          <button type="button" className="btn sm" onClick={() => api.openMedia(m.id)}>{APP[info.type] ? `Ouvrir avec ${APP[info.type]}` : 'Ouvrir avec…'}</button>
          <button type="button" className="btn sm primary" onClick={() => open({ sessionId: m.sessionId, mediaId: m.id, mode: 'single' })}>Ouvrir</button>
        </span>
      </div>
    </div>
  )
}

/** Visionneuse d'un document : PDF de Chromium, sinon le texte et le plan, avec l'aperçu fidèle sur demande. */
export function DocViewer({ m, onClose }: { m: MediaItem; onClose: () => void }) {
  const [info, setInfo] = useDocInfo(m)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [slide, setSlide] = useState(0)
  const convert = async () => {
    setBusy(true)
    setErr('')
    const r = await api.docConvert(m.id)
    setBusy(false)
    if (r.error) setErr(r.error)
    else if (info) setInfo({ ...info, pdf: r.pdf })
  }
  return (
    <div className="viewer" role="dialog" aria-label={`Visionneuse — ${m.name}`}>
      <header className="viewer-bar">
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {m.name}
            {info && <span className="v-muted" style={{ fontWeight: 400 }}> · {metaOf(info, m)}</span>}
          </span>
          <span className="mono v-muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.path}</span>
        </span>
        {info && !info.pdf && (info.type === 'word' || info.type === 'powerpoint') && (
          <button type="button" className="v-btn" disabled={busy} onClick={convert}>{busy ? 'Conversion…' : 'Aperçu fidèle · quelques secondes'}</button>
        )}
        <button type="button" className="v-btn" onClick={() => navigator.clipboard.writeText(m.path)}>Copier le chemin</button>
        <button type="button" className="v-btn" onClick={() => api.showMediaInFolder(m.id)}>Ouvrir le dossier</button>
        <button type="button" className="v-btn" onClick={() => api.openMedia(m.id)}>{info && APP[info.type] ? `Ouvrir avec ${APP[info.type]}` : 'Ouvrir avec…'}</button>
        <button type="button" className="v-btn" aria-label="Fermer (Échap)" onClick={onClose}>✕</button>
      </header>
      {err && <div className="out-doc-err">{err}</div>}
      <div className="viewer-stage flush">
        {!info ? null : info.pdf ? (
          <iframe title={m.name} src={info.pdf} className="out-doc-frame" />
        ) : info.type === 'powerpoint' && info.slides?.length ? (
          <div className="out-slides">
            <div className="out-slide-list" role="tablist" aria-label="Diapositives">
              {info.slides.map((s, i) => (
                <button key={i} type="button" role="tab" aria-selected={slide === i} onClick={() => setSlide(i)}>
                  <span className="v-muted">{i + 1}</span>
                  <span>{s.title || 'Sans titre'}</span>
                </button>
              ))}
            </div>
            <div className="out-slide">
              <h2>{info.slides[slide].title || 'Sans titre'}</h2>
              <p>{info.slides[slide].text}</p>
              {info.slides[slide].notes && (
                <>
                  <span className="dbv-cap">Notes</span>
                  <p className="v-muted">{info.slides[slide].notes}</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="out-outline">
            {info.headings && info.headings.length > 0 && (
              <nav aria-label="Plan" className="out-outline-nav">
                {info.headings.map((h, i) => <span key={i} style={{ paddingLeft: Math.max(0, h.level - 1) * 14 }}>{h.text}</span>)}
              </nav>
            )}
            <div className="out-outline-text">{info.error ? `Lecture impossible : ${info.error}` : info.text}</div>
          </div>
        )}
      </div>
    </div>
  )
}
