import React, { useEffect, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import MindElixir from 'mind-elixir'
import 'mind-elixir/style.css'
import { ExternalLink } from 'lucide-react'
import { mindmapEmbedTheme } from '../lib/mindmapEmbedTheme'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

const openInNewTabHref = (path: string) =>
  `${window.location.origin}${window.location.pathname}#/${encodeURIComponent(path)}`

const OpenInNewTabButton: React.FC<{ path: string }> = ({ path }) => (
  <a
    href={openInNewTabHref(path)}
    target="_blank"
    rel="noopener noreferrer"
    className="bf-slideshow-canvas-open"
    title="Open in a new tab"
    onClick={(e) => e.stopPropagation()}
  >
    <ExternalLink size={13} />
  </a>
)

const fetchCodeBlock = async (path: string, lang: string): Promise<string | null> => {
  const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`)
  const data = await res.json()
  const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```')
  const match = typeof data?.content === 'string' ? data.content.match(re) : null
  return match ? match[1].trim() : null
}

export const SlideshowDrawio: React.FC<{ path: string }> = ({ path }) => {
  const [xml, setXml] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchCodeBlock(path, 'xml').then(x => { if (!cancelled) setXml(x) }).catch(() => {})
    return () => { cancelled = true }
  }, [path])

  useEffect(() => {
    if (!xml) return
    const handleMessage = (e: MessageEvent) => {
      if (
        e.origin !== 'https://embed.diagrams.net' &&
        e.origin !== 'https://app.diagrams.net' &&
        e.origin !== 'https://viewer.diagrams.net'
      ) return
      try {
        const data = JSON.parse(e.data)
        if (data.event === 'init') {
          iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ action: 'load', xml }), '*')
        }
      } catch {}
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [xml])

  return (
    <div className="bf-slideshow-canvas-embed">
      <OpenInNewTabButton path={path} />
      <iframe
        ref={iframeRef}
        src="https://viewer.diagrams.net/?embed=1&ui=dark&spin=1&proto=json"
        className="bf-slideshow-canvas-frame"
        title="Draw.io canvas"
      />
    </div>
  )
}

export const SlideshowExcalidraw: React.FC<{ path: string }> = ({ path }) => {
  const [elements, setElements] = useState<any[]>([])
  const [appState, setAppState] = useState<any>({ viewBackgroundColor: '#121212' })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchCodeBlock(path, 'json').then(raw => {
      if (cancelled) return
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed.elements)) setElements(parsed.elements)
          if (parsed.appState) setAppState(parsed.appState)
        } catch {}
      }
      setLoaded(true)
    }).catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [path])

  return (
    <div className="bf-slideshow-canvas-embed">
      <OpenInNewTabButton path={path} />
      {!loaded ? (
        <div className="bf-slideshow-canvas-loading">Loading canvas…</div>
      ) : (
        <Excalidraw
          viewModeEnabled
          initialData={{ elements, appState: { ...appState, theme: 'dark' } }}
          theme="dark"
        />
      )}
    </div>
  )
}

export const SlideshowMindmap: React.FC<{ path: string }> = ({ path }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const meRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current) return
    let destroyed = false
    fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(data => {
        if (destroyed || !containerRef.current || typeof data?.content !== 'string') return
        const m = data.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
        if (!m) return
        const mindData = JSON.parse(m[1])
        containerRef.current.innerHTML = ''
        const me = new MindElixir({
          el: containerRef.current,
          direction: MindElixir.SIDE,
          editable: false,
          contextMenu: false,
          toolBar: false,
          keypress: false,
          theme: mindmapEmbedTheme,
        })
        me.init(mindData)
        meRef.current = me
      })
      .catch(() => {})

    return () => {
      destroyed = true
      try { meRef.current?.destroy() } catch {}
      meRef.current = null
    }
  }, [path])

  return (
    <div className="bf-slideshow-canvas-embed">
      <OpenInNewTabButton path={path} />
      <div ref={containerRef} className="bf-slideshow-canvas-frame" />
    </div>
  )
}
