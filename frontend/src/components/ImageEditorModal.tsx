import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { alertDialog, confirmDialog } from '../lib/dialog'

interface ImageEditorModalProps {
  src: string
  notePath: string
  apiBase: string
  onClose: () => void
  onSave: (newUrl: string) => void
}

interface TextOverlay {
  canvasX: number
  canvasY: number
  screenX: number
  screenY: number
  value: string
  dragging: boolean
  dragOffsetX: number
  dragOffsetY: number
}

export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  src, notePath, apiBase, onClose, onSave,
}) => {
  // Strip any old cache-bust query from src and build a fresh URL computed once on mount.
  // This ensures both the viewer and the canvas always load the current file from disk,
  // not a browser-cached stale version.
  const [freshSrc] = useState<string>(() => {
    const base = src.split('?')[0]
    const absolute = base.startsWith('/') ? `${apiBase}${base}` : base
    return `${absolute}?_=${Date.now()}`
  })

  const [isEditing, setIsEditing]   = useState(false)
  const [zoom, setZoom]             = useState(1.0)
  const [rotation, setRotation]     = useState(0)
  const [isSaving, setIsSaving]     = useState(false)

  // Viewer pan
  const [panOffset, setPanOffset]   = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning]   = useState(false)
  const panStartRef                 = useRef({ x: 0, y: 0 })

  // Edit pan (Select/Pan tool)
  const [editPan, setEditPan]       = useState({ x: 0, y: 0 })
  const [isEditPanning, setIsEditPanning] = useState(false)
  const editPanStart                = useRef({ x: 0, y: 0 })

  type ToolType = 'none' | 'draw' | 'highlight' | 'rect' | 'arrow' | 'circle' | 'text' | 'crop' | 'blur'
  const [tool, setTool]             = useState<ToolType>('none')
  const [color, setColor]           = useState('#ef4444')
  const [lineWidth, setLineWidth]   = useState(4)
  const [filled, setFilled]         = useState(false)   // fill for rect/circle
  const [blurStrength, setBlurStrength] = useState(10) // blur radius px

  // Persistent original backup URL (backend-stored, survives saves)
  const [persistentOriginalUrl, setPersistentOriginalUrl] = useState<string | null>(null)

  // Canvas
  const canvasRef                   = useRef<HTMLCanvasElement | null>(null)
  const containerRef                = useRef<HTMLDivElement | null>(null)
  const isDrawingRef                = useRef(false)
  const lastPosRef                  = useRef({ x: 0, y: 0 })
  const pointsRef                   = useRef<{ x: number; y: number }[]>([])
  const [undoStack, setUndoStack]   = useState<string[]>([])
  // Captured once on first canvas load — used for in-session reset fallback
  const originalDataUrl             = useRef<string | null>(null)

  const [dragStart, setDragStart]   = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)
  const savedImageDataRef           = useRef<ImageData | null>(null)

  // Text overlay
  const [textOverlay, setTextOverlay] = useState<TextOverlay | null>(null)
  const textInputRef                = useRef<HTMLTextAreaElement | null>(null)

  // On mount: check if a backend original backup already exists for this image
  useEffect(() => {
    const clean = src.split('?')[0]
    const dot   = clean.lastIndexOf('.')
    if (dot === -1) return
    const origPath = clean.slice(0, dot) + '._orig' + clean.slice(dot)
    const origUrl  = `${apiBase}${origPath}`
    fetch(origUrl, { method: 'HEAD' })
      .then(r => { if (r.ok) setPersistentOriginalUrl(origUrl) })
      .catch(() => {})
  }, [])

  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  // Load image on edit entry — use freshSrc so we always get the current file, not a stale cache hit
  useEffect(() => {
    if (!isEditing) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = freshSrc
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      const dataUrl = canvas.toDataURL()
      // Capture original only on the very first load so Reset always goes back to opening state
      if (!originalDataUrl.current) originalDataUrl.current = dataUrl
      setUndoStack([dataUrl])
      setRotation(0)
      setDragStart(null)
      setDragCurrent(null)
      setEditPan({ x: 0, y: 0 })
      setTextOverlay(null)
    }
  }, [isEditing, freshSrc])

  // Focus text input when overlay appears
  useEffect(() => {
    if (textOverlay && !textOverlay.dragging) {
      setTimeout(() => textInputRef.current?.focus(), 30)
    }
  }, [textOverlay])

  const saveHistory = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    setUndoStack(prev => [...prev, canvas.toDataURL()])
  }

  const handleUndo = () => {
    if (undoStack.length <= 1) return
    const newStack = undoStack.slice(0, -1)
    setUndoStack(newStack)
    const img = new Image()
    img.src = newStack[newStack.length - 1]
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      canvas.width  = img.width
      canvas.height = img.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
    }
  }

  const handleReset = async () => {
    const usingPersistent = !!persistentOriginalUrl
    const label = usingPersistent
      ? 'Reset to original image? This removes ALL annotations ever saved on this image (the original file is preserved). You can still Save to commit the clean version.'
      : 'Reset to original? This removes annotations added in this session. You can still Undo after resetting.'
    if (!await confirmDialog(label, { title: 'Reset image', confirmLabel: 'Reset', danger: true })) return

    if (usingPersistent) {
      // Load the permanent backup from the server with cache-bust
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = `${persistentOriginalUrl}?_=${Date.now()}`
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width  = img.naturalWidth
        canvas.height = img.naturalHeight
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        const dataUrl = canvas.toDataURL()
        setUndoStack([dataUrl])
        setDragStart(null)
        setDragCurrent(null)
      }
    } else {
      // Fall back to the in-session captured state
      const dataUrl = originalDataUrl.current
      if (!dataUrl) return
      const img = new Image()
      img.src = dataUrl
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width  = img.width
        canvas.height = img.height
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        setUndoStack([dataUrl])
        setDragStart(null)
        setDragCurrent(null)
      }
    }
  }

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width)  * canvas.width,
      y: ((e.clientY - rect.top)  / rect.height) * canvas.height,
    }
  }

  // Arrow: stop the line before the head so they don't overlap
  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    start: { x: number; y: number },
    end: { x: number; y: number },
    strokeColor: string,
    width: number,
  ) => {
    const headLength = Math.max(width * 3 + 6, 12)
    const angle = Math.atan2(end.y - start.y, end.x - start.x)
    // Line stops at the base of the arrowhead
    const lineEnd = {
      x: end.x - headLength * Math.cos(angle),
      y: end.y - headLength * Math.sin(angle),
    }

    ctx.strokeStyle = strokeColor
    ctx.fillStyle   = strokeColor
    ctx.lineWidth   = width
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'

    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(lineEnd.x, lineEnd.y)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fill()
  }

  // Apply Gaussian blur to a canvas region
  const applyBlur = (x: number, y: number, w: number, h: number) => {
    const canvas = canvasRef.current
    if (!canvas || w < 2 || h < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const tmp = document.createElement('canvas')
    tmp.width  = canvas.width
    tmp.height = canvas.height
    const tmpCtx = tmp.getContext('2d')!
    tmpCtx.drawImage(canvas, 0, 0)

    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.filter = `blur(${blurStrength}px)`
    // Draw slightly oversized to avoid edge artifacts from the blur
    const pad = blurStrength * 2
    ctx.drawImage(tmp, x - pad, y - pad, w + pad * 2, h + pad * 2, x - pad, y - pad, w + pad * 2, h + pad * 2)
    ctx.filter = 'none'
    ctx.restore()
  }

  // Commit text overlay to canvas
  const commitText = useCallback(() => {
    if (!textOverlay || !textOverlay.value.trim()) { setTextOverlay(null); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const fontSize = lineWidth * 4 + 14
    ctx.font         = `bold ${fontSize}px sans-serif`
    ctx.fillStyle    = color
    ctx.textBaseline = 'top'
    // Multi-line support
    const lines = textOverlay.value.split('\n')
    lines.forEach((line, i) => {
      ctx.fillText(line, textOverlay.canvasX, textOverlay.canvasY + i * (fontSize + 4))
    })
    saveHistory()
    setTextOverlay(null)
  }, [textOverlay, color, lineWidth])

  // Canvas mouse down
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const coords = getCanvasCoords(e)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (tool === 'none') {
      // Pan canvas
      setIsEditPanning(true)
      editPanStart.current = { x: e.clientX - editPan.x, y: e.clientY - editPan.y }
      return
    }

    if (tool === 'draw') {
      isDrawingRef.current = true
      lastPosRef.current   = coords
    } else if (tool === 'highlight') {
      isDrawingRef.current         = true
      savedImageDataRef.current    = ctx.getImageData(0, 0, canvas.width, canvas.height)
      pointsRef.current            = [coords]
    } else if (tool === 'rect' || tool === 'arrow' || tool === 'circle' || tool === 'crop' || tool === 'blur') {
      savedImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
      setDragStart(coords)
      setDragCurrent(coords)
    } else if (tool === 'text') {
      // Commit any existing overlay first
      if (textOverlay) { commitText(); return }
      const containerRect = containerRef.current?.getBoundingClientRect()
      const canvasRect    = canvas.getBoundingClientRect()
      if (!containerRect || !canvasRect) return
      setTextOverlay({
        canvasX:     coords.x,
        canvasY:     coords.y,
        screenX:     canvasRect.left - containerRect.left + (e.clientX - canvasRect.left),
        screenY:     canvasRect.top  - containerRect.top  + (e.clientY - canvasRect.top),
        value:       '',
        dragging:    false,
        dragOffsetX: 0,
        dragOffsetY: 0,
      })
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (tool === 'none' && isEditPanning) {
      setEditPan({
        x: e.clientX - editPanStart.current.x,
        y: e.clientY - editPanStart.current.y,
      })
      return
    }

    if (tool === 'draw' && isDrawingRef.current) {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth   = lineWidth
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
      ctx.lineTo(coords.x, coords.y)
      ctx.stroke()
      lastPosRef.current = coords
    } else if (tool === 'highlight' && isDrawingRef.current && savedImageDataRef.current) {
      ctx.putImageData(savedImageDataRef.current, 0, 0)
      pointsRef.current.push(coords)
      ctx.beginPath()
      ctx.strokeStyle = hexToRgba(color, 0.22)
      ctx.lineWidth   = lineWidth * 5
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.moveTo(pointsRef.current[0].x, pointsRef.current[0].y)
      for (let i = 1; i < pointsRef.current.length; i++) {
        ctx.lineTo(pointsRef.current[i].x, pointsRef.current[i].y)
      }
      ctx.stroke()
    } else if ((tool === 'rect' || tool === 'arrow' || tool === 'circle' || tool === 'crop' || tool === 'blur') && dragStart && savedImageDataRef.current) {
      setDragCurrent(coords)
      ctx.putImageData(savedImageDataRef.current, 0, 0)

      const x = Math.min(dragStart.x, coords.x)
      const y = Math.min(dragStart.y, coords.y)
      const w = Math.abs(dragStart.x - coords.x)
      const h = Math.abs(dragStart.y - coords.y)

      if (tool === 'rect') {
        ctx.strokeStyle = color
        ctx.fillStyle   = color
        ctx.lineWidth   = lineWidth
        if (filled) {
          ctx.globalAlpha = 0.35
          ctx.fillRect(x, y, w, h)
          ctx.globalAlpha = 1
          ctx.strokeRect(x, y, w, h)
        } else {
          ctx.strokeRect(x, y, w, h)
        }
      } else if (tool === 'arrow') {
        drawArrow(ctx, dragStart, coords, color, lineWidth)
      } else if (tool === 'circle') {
        const radius = Math.sqrt(w * w + h * h) / 2
        const cx = (dragStart.x + coords.x) / 2
        const cy = (dragStart.y + coords.y) / 2
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
        ctx.strokeStyle = color
        ctx.lineWidth   = lineWidth
        ctx.stroke()
        if (filled) {
          ctx.globalAlpha = 0.35
          ctx.fillStyle   = color
          ctx.fill()
          ctx.globalAlpha = 1
        }
      } else if (tool === 'crop' || tool === 'blur') {
        // Just show the selection overlay (no canvas draw needed — CSS overlay handles it)
      }
    }
  }

  const handleMouseUp = () => {
    if (tool === 'none') {
      setIsEditPanning(false)
      return
    }
    if (tool === 'draw' && isDrawingRef.current) {
      isDrawingRef.current = false
      saveHistory()
    } else if (tool === 'highlight' && isDrawingRef.current) {
      isDrawingRef.current         = false
      savedImageDataRef.current    = null
      pointsRef.current            = []
      saveHistory()
    } else if ((tool === 'rect' || tool === 'arrow' || tool === 'circle') && dragStart) {
      savedImageDataRef.current = null
      setDragStart(null)
      setDragCurrent(null)
      saveHistory()
    } else if (tool === 'blur' && dragStart && dragCurrent) {
      const x = Math.min(dragStart.x, dragCurrent.x)
      const y = Math.min(dragStart.y, dragCurrent.y)
      const w = Math.abs(dragStart.x - dragCurrent.x)
      const h = Math.abs(dragStart.y - dragCurrent.y)
      savedImageDataRef.current = null
      setDragStart(null)
      setDragCurrent(null)
      applyBlur(x, y, w, h)
      saveHistory()
    } else if (tool === 'crop') {
      savedImageDataRef.current = null
      // Keep dragStart/dragCurrent so the apply-crop button stays visible
    }
  }

  const applyCrop = () => {
    if (!dragStart || !dragCurrent) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const x = Math.min(dragStart.x, dragCurrent.x)
    const y = Math.min(dragStart.y, dragCurrent.y)
    const w = Math.abs(dragStart.x - dragCurrent.x)
    const h = Math.abs(dragStart.y - dragCurrent.y)
    if (w < 5 || h < 5) return
    const tmp = document.createElement('canvas')
    tmp.width  = w
    tmp.height = h
    const tmpCtx = tmp.getContext('2d')!
    tmpCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h)
    canvas.width  = w
    canvas.height = h
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(tmp, 0, 0)
    setDragStart(null)
    setDragCurrent(null)
    setTool('none')
    saveHistory()
  }

  const rotateClockwise = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const tmp = document.createElement('canvas')
    tmp.width  = canvas.width
    tmp.height = canvas.height
    const tmpCtx = tmp.getContext('2d')!
    tmpCtx.drawImage(canvas, 0, 0)
    canvas.width  = tmp.height
    canvas.height = tmp.width
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((90 * Math.PI) / 180)
    ctx.drawImage(tmp, -tmp.width / 2, -tmp.height / 2)
    saveHistory()
  }

  // Viewer pan handlers
  const handleViewerMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return
    e.preventDefault()
    setIsPanning(true)
    panStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y }
  }
  const handleViewerMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || isEditing) return
    e.preventDefault()
    setPanOffset({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y })
  }
  const handleViewerMouseUp = () => setIsPanning(false)

  const handleSave = async () => {
    if (textOverlay) commitText()
    const canvas = canvasRef.current
    if (!canvas) return
    setIsSaving(true)
    canvas.toBlob(async (blob) => {
      if (!blob) { setIsSaving(false); return }
      const file = new File([blob], 'edited-image.png', { type: 'image/png' })
      const formData = new FormData()
      formData.append('file', file)
      try {
        const cleanSrc = src.split('?')[0]
        const res  = await fetch(`${apiBase}/api/upload?overwritePath=${encodeURIComponent(cleanSrc)}`, { method: 'POST', body: formData })
        if (!res.ok) {
          let message = 'Failed to save edited image on the backend.'
          try {
            const errData = await res.json()
            if (errData?.error) message = errData.error
          } catch { /* response wasn't JSON */ }
          throw new Error(message)
        }
        const data = await res.json()
        // If the backend created (or already had) an original backup, remember it
        if (data.originalUrl) setPersistentOriginalUrl(`${apiBase}${data.originalUrl}`)
        onSave(`${data.url}?t=${Date.now()}`)
        onClose()
      } catch (e) {
        console.error('Error saving image modifications', e)
        alertDialog(e instanceof Error ? e.message : 'Failed to save edited image on the backend.')
      } finally {
        setIsSaving(false)
      }
    }, 'image/png')
  }

  // Crop/blur selection overlay styles (relative to canvas position within container)
  const getSelectionOverlayStyles = () => {
    if (!dragStart || !dragCurrent || !canvasRef.current || !containerRef.current) return null
    const canvas = canvasRef.current
    const canvasRect    = canvas.getBoundingClientRect()
    const containerRect = containerRef.current.getBoundingClientRect()
    const scaleX = canvasRect.width  / canvas.width
    const scaleY = canvasRect.height / canvas.height
    const offsetX = canvasRect.left - containerRect.left
    const offsetY = canvasRect.top  - containerRect.top
    const x1 = offsetX + Math.min(dragStart.x, dragCurrent.x) * scaleX
    const y1 = offsetY + Math.min(dragStart.y, dragCurrent.y) * scaleY
    const w  = Math.abs(dragStart.x - dragCurrent.x) * scaleX
    const h  = Math.abs(dragStart.y - dragCurrent.y) * scaleY
    return { left: `${x1}px`, top: `${y1}px`, width: `${w}px`, height: `${h}px` }
  }
  const selectionStyles = getSelectionOverlayStyles()

  // Text overlay screen position for the textarea
  const getTextOverlayStyle = () => {
    if (!textOverlay || !canvasRef.current) return {}
    const canvas    = canvasRef.current
    const container = containerRef.current
    if (!container) return {}
    const canvasRect    = canvas.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const scaleX = canvasRect.width  / canvas.width
    const scaleY = canvasRect.height / canvas.height
    return {
      left: `${canvasRect.left - containerRect.left + textOverlay.canvasX * scaleX}px`,
      top:  `${canvasRect.top  - containerRect.top  + textOverlay.canvasY * scaleY}px`,
    }
  }

  const changeTool = (t: ToolType) => {
    if (textOverlay) commitText()
    setTool(t)
    setDragStart(null)
    setDragCurrent(null)
  }

  const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#000000']
  const showColorSize  = tool !== 'none' && tool !== 'crop'
  const showFill       = tool === 'rect' || tool === 'circle'
  const showBlurSlider = tool === 'blur'
  const cropReady      = tool === 'crop' && dragStart && dragCurrent

  return createPortal(
    <div data-image-editor-modal="true" className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md">
      <div className="relative max-w-5xl w-full h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-900/50 shrink-0">
          <div className="flex items-center gap-3">
            <span className="p-1.5 rounded-lg bg-violet-600/10 text-violet-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-bold">Image Markup</h3>
              <p className="text-[10px] text-slate-400">{notePath.split('/').pop()}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode toggle + toolbar */}
        <div className="shrink-0 border-b border-slate-800 bg-slate-950">
          {/* Mode row */}
          <div className="flex items-center gap-2 px-5 pt-2.5 pb-2">
            <button
              onClick={() => { setIsEditing(false); changeTool('none') }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${!isEditing ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            >
              Viewer
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${isEditing ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            >
              Editor Markup
            </button>

            {/* Viewer controls */}
            {!isEditing && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button onClick={() => setZoom(z => Math.max(0.2, z - 0.2))} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300" title="Zoom Out">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" /></svg>
                </button>
                <span className="text-xs font-mono w-10 text-center text-slate-400">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(4.0, z + 0.2))} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300" title="Zoom In">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                </button>
                <button onClick={() => { setZoom(1.0); setRotation(0); setPanOffset({ x: 0, y: 0 }) }} className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs text-slate-300 font-semibold">Reset</button>
                <button onClick={() => setRotation(r => (r + 90) % 360)} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300" title="Rotate">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38" /></svg>
                </button>
              </div>
            )}
          </div>

          {/* Editor toolbar — always same height, no layout shift */}
          {isEditing && (
            <div className="flex items-center gap-3 px-5 pb-2.5 flex-wrap">
              {/* Tool buttons */}
              <div className="flex items-center gap-0.5 bg-slate-900 p-0.5 rounded-lg border border-slate-800 shrink-0">
                {([
                  ['none',      'Select'],
                  ['draw',      'Pen'],
                  ['highlight', 'Highlight'],
                  ['arrow',     'Arrow'],
                  ['rect',      'Rect'],
                  ['circle',    'Circle'],
                  ['text',      'Text'],
                  ['blur',      'Blur'],
                  ['crop',      'Crop'],
                ] as [ToolType, string][]).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => changeTool(t)}
                    className={`px-2 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                      tool === t ? 'bg-slate-700 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Color picker — always visible, dimmed when not applicable */}
              <div className={`flex items-center gap-1 transition-opacity ${showColorSize ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-4 h-4 rounded-full border transition-all cursor-pointer ${
                      color === c ? 'ring-2 ring-violet-500 border-white scale-110' : 'border-slate-700'
                    }`}
                  />
                ))}
              </div>

              {/* Size slider — always visible */}
              <div className={`flex items-center gap-1.5 border-l border-slate-800 pl-3 transition-opacity ${showColorSize ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                <span className="text-[10px] text-slate-500 uppercase font-mono">Size</span>
                <input
                  type="range" min="1" max="20" value={lineWidth}
                  onChange={e => setLineWidth(Number(e.target.value))}
                  className="w-16 accent-violet-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-[10px] font-mono text-slate-400 w-4">{lineWidth}</span>
              </div>

              {/* Fill toggle for rect/circle */}
              {showFill && (
                <button
                  onClick={() => setFilled(f => !f)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer ${
                    filled ? 'bg-violet-600/20 border-violet-500 text-violet-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-sm border ${filled ? 'bg-violet-400 border-violet-300' : 'border-slate-500'}`} />
                  Fill
                </button>
              )}

              {/* Blur strength slider */}
              {showBlurSlider && (
                <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                  <span className="text-[10px] text-slate-500 uppercase font-mono">Blur</span>
                  <input
                    type="range" min="2" max="30" value={blurStrength}
                    onChange={e => setBlurStrength(Number(e.target.value))}
                    className="w-16 accent-violet-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-slate-400 w-6">{blurStrength}px</span>
                </div>
              )}

              {/* Crop apply */}
              {cropReady && (
                <button
                  onClick={applyCrop}
                  className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-[11px] font-bold transition cursor-pointer"
                >
                  ✓ Apply Crop
                </button>
              )}

              {/* Spacer + rotate + undo + reset */}
              <div className="flex items-center gap-1 ml-auto border-l border-slate-800 pl-3">
                <button onClick={rotateClockwise} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 cursor-pointer" title="Rotate 90° CW">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38" /></svg>
                </button>
                <button onClick={handleUndo} disabled={undoStack.length <= 1} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 disabled:opacity-40 cursor-pointer" title="Undo last action">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                </button>
                <button
                  onClick={handleReset}
                  disabled={!persistentOriginalUrl && !originalDataUrl.current}
                  className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 hover:border-red-500/60 hover:text-red-400 text-slate-400 text-[10px] font-semibold disabled:opacity-30 cursor-pointer transition-colors"
                  title={persistentOriginalUrl ? 'Reset to original image (before any annotations were ever saved)' : 'Reset to session start'}
                >
                  {persistentOriginalUrl ? 'Reset to original' : 'Reset'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Canvas / Image area */}
        <div
          className="flex-1 bg-slate-950 overflow-hidden flex items-center justify-center relative select-none"
          onMouseDown={handleViewerMouseDown}
          onMouseMove={handleViewerMouseMove}
          onMouseUp={handleViewerMouseUp}
          onMouseLeave={handleViewerMouseUp}
        >
          {!isEditing ? (
            <div
              className={`transition-transform duration-75 ease-out select-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
              style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom}) rotate(${rotation}deg)` }}
            >
              <img
                src={freshSrc}
                alt="preview"
                className="max-h-[65vh] max-w-[85vw] object-contain rounded shadow-2xl select-none"
                draggable={false}
              />
            </div>
          ) : (
            <div
              ref={containerRef}
              className="relative flex items-center justify-center shadow-2xl"
              style={{ transform: `translate(${editPan.x}px, ${editPan.y}px)` }}
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className={`max-h-[65vh] max-w-[85vw] object-contain block border border-slate-800 rounded ${
                  tool === 'none' ? 'cursor-grab' : 'cursor-crosshair'
                }`}
              />

              {/* Crop / blur selection overlay */}
              {(tool === 'crop' || tool === 'blur') && selectionStyles && (
                <div
                  style={selectionStyles}
                  className={`absolute pointer-events-none border border-dashed ${
                    tool === 'blur' ? 'border-blue-400 bg-blue-500/10' : 'border-violet-500 bg-violet-500/15'
                  }`}
                />
              )}

              {/* Text overlay */}
              {textOverlay && (
                <div
                  style={{ ...getTextOverlayStyle(), position: 'absolute', zIndex: 20 }}
                  className="bg-slate-900/80 border border-violet-500 rounded shadow-lg"
                  onMouseDown={e => {
                    e.stopPropagation()
                    const canvas = canvasRef.current
                    const container = containerRef.current
                    if (!canvas || !container) return
                    const canvasRect    = canvas.getBoundingClientRect()
                    const containerRect = container.getBoundingClientRect()
                    setTextOverlay(prev => prev ? {
                      ...prev,
                      dragging:    true,
                      dragOffsetX: e.clientX - (canvasRect.left - containerRect.left + prev.canvasX * (canvasRect.width / canvas.width)),
                      dragOffsetY: e.clientY - (canvasRect.top  - containerRect.top  + prev.canvasY * (canvasRect.height / canvas.height)),
                    } : null)
                  }}
                  onMouseMove={e => {
                    if (!textOverlay.dragging) return
                    e.stopPropagation()
                    const canvas    = canvasRef.current
                    const container = containerRef.current
                    if (!canvas || !container) return
                    const canvasRect    = canvas.getBoundingClientRect()
                    const containerRect = container.getBoundingClientRect()
                    const scaleX = canvas.width  / canvasRect.width
                    const scaleY = canvas.height / canvasRect.height
                    const screenX = e.clientX - textOverlay.dragOffsetX
                    const screenY = e.clientY - textOverlay.dragOffsetY
                    setTextOverlay(prev => prev ? {
                      ...prev,
                      screenX,
                      screenY,
                      canvasX: (screenX - (canvasRect.left - containerRect.left)) * scaleX,
                      canvasY: (screenY - (canvasRect.top  - containerRect.top))  * scaleY,
                    } : null)
                  }}
                  onMouseUp={e => { e.stopPropagation(); setTextOverlay(prev => prev ? { ...prev, dragging: false } : null) }}
                >
                  {/* Drag handle */}
                  <div className="flex items-center justify-between px-2 py-1 border-b border-slate-700 cursor-move select-none">
                    <span className="text-[10px] text-slate-400 font-semibold">Text · drag to move</span>
                    <div className="flex items-center gap-1">
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); commitText() }}
                        className="px-2 py-0.5 bg-violet-600 hover:bg-violet-500 text-white text-[10px] rounded font-bold cursor-pointer"
                      >
                        Place
                      </button>
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); setTextOverlay(null) }}
                        className="text-slate-400 hover:text-slate-200 text-[11px] px-1 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={textInputRef}
                    value={textOverlay.value}
                    onChange={e => setTextOverlay(prev => prev ? { ...prev, value: e.target.value } : null)}
                    onMouseDown={e => e.stopPropagation()}
                    onKeyDown={e => {
                      e.stopPropagation()
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText() }
                      if (e.key === 'Escape') setTextOverlay(null)
                    }}
                    placeholder="Type text… Enter to place, Shift+Enter for new line"
                    rows={3}
                    className="w-56 bg-transparent outline-none text-slate-100 text-sm px-2 py-1.5 resize-none placeholder:text-slate-500"
                    style={{ fontSize: `${Math.max(12, lineWidth * 2)}px`, color }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-slate-400">
            {isEditing
              ? tool === 'none'      ? 'Drag canvas to pan · switch tools above to annotate'
              : tool === 'text'      ? 'Click image to place text · drag the box to reposition before placing'
              : tool === 'blur'      ? 'Drag to select region → applies Gaussian blur'
              : tool === 'crop'      ? 'Drag to select area → click Apply Crop'
              : tool === 'highlight' ? 'Draw to highlight · semi-transparent stroke'
              : 'Draw on the image · Undo reverts last action'
              : 'Drag to pan · use zoom controls above'}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-1.5 border border-slate-700 rounded-xl hover:bg-slate-800 transition text-sm font-semibold text-slate-300 cursor-pointer">
              Cancel
            </button>
            {isEditing && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-bold transition shadow-lg flex items-center gap-2 cursor-pointer"
              >
                {isSaving ? (
                  <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Saving…</>
                ) : 'Save Changes'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body,
  )
}
