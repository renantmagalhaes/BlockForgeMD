import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { markdownToEditorHtml } from '../lib/markdownToHtml'
import { SlideshowDrawio, SlideshowExcalidraw, SlideshowMindmap } from './SlideshowEmbeds'

interface SlideshowProps {
  markdown: string
  title?: string
  onClose: () => void
}

// A line of 3+ dashes on its own is a slide break, unless it's inside a fenced
// code block (where `---` is just content, e.g. inside a YAML snippet).
const splitIntoSlides = (markdown: string): string[] => {
  const lines = markdown.split('\n')
  const slides: string[] = []
  let current: string[] = []
  let fence: string | null = null

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```|~~~)/)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1]
      else if (line.trim().startsWith(fence)) fence = null
      current.push(line)
      continue
    }
    if (!fence && /^\s*-{3,}\s*$/.test(line)) {
      slides.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  slides.push(current.join('\n'))

  const trimmed = slides.map(s => s.trim()).filter(Boolean)
  return trimmed.length > 0 ? trimmed : ['*Nothing to present yet.*']
}

const hexToRgba = (hex: string, alpha: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const r = parseInt(m[1].slice(0, 2), 16)
  const g = parseInt(m[1].slice(2, 4), 16)
  const b = parseInt(m[1].slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// markdownToEditorHtml renders callouts/columns as the data-* divs TipTap's
// node views expect, and leaves embeds (bookmark, mindmap, drawio,
// excalidraw, toc) as bare custom tags for TipTap's parseHTML to pick up.
// The slideshow has no TipTap instance, so it re-skins callouts/bookmarks
// into plain static markup here; canvas embeds (mindmap/drawio/excalidraw)
// are left as-is for splitSlideParts to swap for live viewer components.
const enrichPresentationHtml = (html: string): string => {
  let out = html.replace(
    /<div data-callout="true" data-callout-emoji="([^"]*)" data-callout-label="([^"]*)" data-callout-color="([^"]*)">([\s\S]*?)<\/div>/g,
    (_m, emoji, label, color, content) =>
      `<div class="bf-slideshow-callout" style="border-left-color:${color};background:${hexToRgba(color, 0.07)}">` +
      `<div class="bf-slideshow-callout-head" style="color:${color}"><span>${emoji}</span><span>${label}</span></div>` +
      `<div class="bf-slideshow-callout-body">${content}</div></div>`
  )

  out = out.replace(/<bookmark\b([^>]*)><\/bookmark>/gi, (_m, attrs) => {
    const get = (name: string) => (attrs.match(new RegExp(`${name}="([^"]*)"`, 'i')) || [])[1] || ''
    const url = get('url')
    const title = get('title') || url
    const description = get('description')
    return `<a class="bf-slideshow-embed-card" href="${url}" target="_blank" rel="noopener noreferrer">` +
      `<strong>${title}</strong>${description ? `<span>${description}</span>` : ''}</a>`
  })

  out = out.replace(/<toc-block[^>]*><\/toc-block>/gi, '')

  return out
}

type SlidePart =
  | { kind: 'html'; html: string }
  | { kind: 'drawio' | 'excalidraw' | 'mindmap'; path: string }

const CANVAS_TAG_RE = /<(drawio|excalidraw|mindmap)\b([^>]*)>[\s\S]*?<\/\1>/gi

// Breaks the slide's HTML into plain-HTML chunks and canvas-embed markers so
// mindmap/drawio/excalidraw can be mounted as real, live React components
// instead of inert markup inside a dangerouslySetInnerHTML block.
const splitSlideParts = (html: string): SlidePart[] => {
  const parts: SlidePart[] = []
  let lastIndex = 0
  CANVAS_TAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CANVAS_TAG_RE.exec(html))) {
    if (match.index > lastIndex) parts.push({ kind: 'html', html: html.slice(lastIndex, match.index) })
    const path = (match[2].match(/path="([^"]*)"/) || [])[1] || ''
    if (path) parts.push({ kind: match[1].toLowerCase() as 'drawio' | 'excalidraw' | 'mindmap', path })
    lastIndex = CANVAS_TAG_RE.lastIndex
  }
  if (lastIndex < html.length) parts.push({ kind: 'html', html: html.slice(lastIndex) })
  return parts
}

export const Slideshow: React.FC<SlideshowProps> = ({ markdown, title, onClose }) => {
  const slides = useMemo(() => splitIntoSlides(markdown), [markdown])
  const [index, setIndex] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const goNext = useCallback(() => setIndex(i => Math.min(i + 1, slides.length - 1)), [slides.length])
  const goPrev = useCallback(() => setIndex(i => Math.max(i - 1, 0)), [])

  // Request true fullscreen (hides browser chrome); the overlay below is a
  // fixed 100vw/100vh layer regardless, so the mode still looks right if the
  // browser denies or lacks the Fullscreen API (e.g. Safari on some setups).
  useEffect(() => {
    containerRef.current?.requestFullscreen?.().catch(() => {})
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  // If fullscreen is exited some other way (browser's native Esc handling,
  // F11, etc.), close the slideshow so state doesn't get out of sync.
  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement) onClose()
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [onClose])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goNext, goPrev, onClose])

  const resetIdleTimer = useCallback(() => {
    setControlsVisible(true)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setControlsVisible(false), 2200)
  }, [])

  useEffect(() => {
    resetIdleTimer()
    window.addEventListener('mousemove', resetIdleTimer)
    return () => {
      window.removeEventListener('mousemove', resetIdleTimer)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [resetIdleTimer])

  const slideParts = useMemo(
    () => splitSlideParts(enrichPresentationHtml(markdownToEditorHtml(slides[index] || ''))),
    [slides, index]
  )

  const atStart = index === 0
  const atEnd = index === slides.length - 1

  return createPortal(
    <div ref={containerRef} className="bf-slideshow" data-slideshow-root="true" data-editor-popover="true">
      <button
        type="button"
        onClick={goPrev}
        disabled={atStart}
        aria-label="Previous slide"
        className={`bf-slideshow-nav bf-slideshow-nav-left ${controlsVisible ? 'is-visible' : ''}`}
      >
        <ChevronLeft size={26} />
      </button>

      <button
        type="button"
        onClick={goNext}
        disabled={atEnd}
        aria-label="Next slide"
        className={`bf-slideshow-nav bf-slideshow-nav-right ${controlsVisible ? 'is-visible' : ''}`}
      >
        <ChevronRight size={26} />
      </button>

      <div className={`bf-slideshow-topbar ${controlsVisible ? 'is-visible' : ''}`}>
        <span className="bf-slideshow-title">{title}</span>
        <span className="bf-slideshow-counter">{index + 1} / {slides.length}</span>
        <button type="button" onClick={onClose} aria-label="Exit slideshow (Esc)" title="Exit (Esc)" className="bf-slideshow-exit">
          <X size={16} />
        </button>
      </div>

      <div className="bf-slideshow-stage">
        <div className="bf-slideshow-slide">
          {slideParts.map((part, i) => {
            if (part.kind === 'html') return <div key={i} dangerouslySetInnerHTML={{ __html: part.html }} />
            if (part.kind === 'drawio') return <SlideshowDrawio key={i} path={part.path} />
            if (part.kind === 'excalidraw') return <SlideshowExcalidraw key={i} path={part.path} />
            return <SlideshowMindmap key={i} path={part.path} />
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
