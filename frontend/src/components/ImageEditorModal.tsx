import React, { useState, useEffect, useRef } from 'react'

interface ImageEditorModalProps {
  src: string
  notePath: string
  apiBase: string
  onClose: () => void
  onSave: (newUrl: string) => void
}

export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  src,
  notePath,
  apiBase,
  onClose,
  onSave,
}) => {
  // Mode & UI States
  const [isEditing, setIsEditing] = useState(false)
  const [zoom, setZoom] = useState(1.0)
  const [rotation, setRotation] = useState(0) // degrees (0, 90, 180, 270)
  const [isSaving, setIsSaving] = useState(false)

  // Viewer Pan States (Drag to Pan when zoomed in)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0 })

  // Drawing Tools States
  const [tool, setTool] = useState<'draw' | 'highlight' | 'rect' | 'arrow' | 'circle' | 'text' | 'crop' | 'none'>('none')
  const [color, setColor] = useState('#ef4444') // Tailwind red-500
  const [lineWidth, setLineWidth] = useState(4)

  // Canvas Refs & State
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawingRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const pointsRef = useRef<{ x: number; y: number }[]>([])
  const [undoStack, setUndoStack] = useState<string[]>([])
  
  // Drag Shape & Crop Coordinates (relative to canvas pixels)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)
  const savedImageDataRef = useRef<ImageData | null>(null)

  // Helper to convert hex color to RGBA
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  // Load image into Canvas when entering Edit Mode
  useEffect(() => {
    if (isEditing) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = src.startsWith('/') ? `${apiBase}${src}` : src
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        
        setUndoStack([canvas.toDataURL()])
        setRotation(0)
        setDragStart(null)
        setDragCurrent(null)
      }
    }
  }, [isEditing, src, apiBase])

  const saveHistory = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL()
    setUndoStack((prev) => [...prev, dataUrl])
  }

  const handleUndo = () => {
    if (undoStack.length <= 1) return
    const newStack = undoStack.slice(0, -1)
    setUndoStack(newStack)
    
    const previousState = newStack[newStack.length - 1]
    const img = new Image()
    img.src = previousState
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      
      canvas.width = img.width
      canvas.height = img.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
    }
  }

  // Convert Client coordinates to Canvas pixels
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    
    const rect = canvas.getBoundingClientRect()
    let clientX = 0
    let clientY = 0
    
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 }
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }
    
    const x = ((clientX - rect.left) / rect.width) * canvas.width
    const y = ((clientY - rect.top) / rect.height) * canvas.height
    return { x, y }
  }

  // Draw Arrow Helper
  const drawArrow = (ctx: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }, strokeColor: string, width: number) => {
    ctx.strokeStyle = strokeColor
    ctx.fillStyle = strokeColor
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Draw main line
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    // Calculate angle & draw arrowhead
    const angle = Math.atan2(end.y - start.y, end.x - start.x)
    const headLength = width * 3 + 6

    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(
      end.x - headLength * Math.cos(angle - Math.PI / 6),
      end.y - headLength * Math.sin(angle - Math.PI / 6)
    )
    ctx.lineTo(
      end.x - headLength * Math.cos(angle + Math.PI / 6),
      end.y - headLength * Math.sin(angle + Math.PI / 6)
    )
    ctx.closePath()
    ctx.fill()
  }

  // Mouse Handlers on Canvas
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (tool === 'draw') {
      isDrawingRef.current = true
      lastPosRef.current = coords
    } else if (tool === 'highlight') {
      isDrawingRef.current = true
      savedImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
      pointsRef.current = [coords]
    } else if (tool === 'rect' || tool === 'arrow' || tool === 'circle' || tool === 'crop') {
      // Cache canvas image state before shape preview drags
      savedImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
      setDragStart(coords)
      setDragCurrent(coords)
    } else if (tool === 'text') {
      const text = prompt('Enter text to insert:')
      if (text) {
        ctx.font = `bold ${lineWidth * 4 + 14}px sans-serif`
        ctx.fillStyle = color
        ctx.textBaseline = 'middle'
        ctx.fillText(text, coords.x, coords.y)
        saveHistory()
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (tool === 'draw' && isDrawingRef.current) {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
      ctx.lineTo(coords.x, coords.y)
      ctx.stroke()
      lastPosRef.current = coords
    } else if (tool === 'highlight' && isDrawingRef.current && savedImageDataRef.current) {
      ctx.putImageData(savedImageDataRef.current, 0, 0)
      pointsRef.current.push(coords)

      ctx.beginPath()
      ctx.strokeStyle = hexToRgba(color, 0.22) // Softer, transparent alpha
      ctx.lineWidth = lineWidth * 5 // Make highlighter wider
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      
      if (pointsRef.current.length > 0) {
        ctx.moveTo(pointsRef.current[0].x, pointsRef.current[0].y)
        for (let i = 1; i < pointsRef.current.length; i++) {
          ctx.lineTo(pointsRef.current[i].x, pointsRef.current[i].y)
        }
        ctx.stroke()
      }
    } else if ((tool === 'rect' || tool === 'arrow' || tool === 'circle' || tool === 'crop') && dragStart && savedImageDataRef.current) {
      setDragCurrent(coords)

      // Restore clean canvas state before drawing temporary shape preview
      ctx.putImageData(savedImageDataRef.current, 0, 0)
      
      const x = Math.min(dragStart.x, coords.x)
      const y = Math.min(dragStart.y, coords.y)
      const w = Math.abs(dragStart.x - coords.x)
      const h = Math.abs(dragStart.y - coords.y)

      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (tool === 'rect') {
        ctx.strokeRect(x, y, w, h)
      } else if (tool === 'arrow') {
        drawArrow(ctx, dragStart, coords, color, lineWidth)
      } else if (tool === 'circle') {
        const radius = Math.sqrt(w * w + h * h) / 2
        const cx = (dragStart.x + coords.x) / 2
        const cy = (dragStart.y + coords.y) / 2
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI)
        ctx.stroke()
      }
    }
  }

  const handleMouseUp = () => {
    if (tool === 'draw' && isDrawingRef.current) {
      isDrawingRef.current = false
      saveHistory()
    } else if (tool === 'highlight' && isDrawingRef.current) {
      isDrawingRef.current = false
      savedImageDataRef.current = null
      pointsRef.current = []
      saveHistory()
    } else if ((tool === 'rect' || tool === 'arrow' || tool === 'circle') && dragStart) {
      savedImageDataRef.current = null
      setDragStart(null)
      setDragCurrent(null)
      saveHistory()
    } else if (tool === 'crop') {
      savedImageDataRef.current = null
      // Keep dragStart/dragCurrent for crop selection overlay box rendering
    }
  }

  // Touch Handlers for tablets/mobile
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (tool === 'draw') {
      isDrawingRef.current = true
      lastPosRef.current = coords
    } else if (tool === 'highlight') {
      isDrawingRef.current = true
      savedImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
      pointsRef.current = [coords]
    }
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (tool === 'draw' && isDrawingRef.current) {
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.lineCap = 'round'
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
      ctx.lineTo(coords.x, coords.y)
      ctx.stroke()
      lastPosRef.current = coords
    } else if (tool === 'highlight' && isDrawingRef.current && savedImageDataRef.current) {
      ctx.putImageData(savedImageDataRef.current, 0, 0)
      pointsRef.current.push(coords)

      ctx.beginPath()
      ctx.strokeStyle = hexToRgba(color, 0.22)
      ctx.lineWidth = lineWidth * 5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      
      if (pointsRef.current.length > 0) {
        ctx.moveTo(pointsRef.current[0].x, pointsRef.current[0].y)
        for (let i = 1; i < pointsRef.current.length; i++) {
          ctx.lineTo(pointsRef.current[i].x, pointsRef.current[i].y)
        }
        ctx.stroke()
      }
    }
  }

  const handleTouchEnd = () => {
    if (tool === 'draw' && isDrawingRef.current) {
      isDrawingRef.current = false
      saveHistory()
    } else if (tool === 'highlight' && isDrawingRef.current) {
      isDrawingRef.current = false
      savedImageDataRef.current = null
      pointsRef.current = []
      saveHistory()
    }
  }

  // Rotates canvas image 90deg clockwise
  const rotateClockwise = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = canvas.width
    tempCanvas.height = canvas.height
    const tempCtx = tempCanvas.getContext('2d')
    if (!tempCtx) return
    tempCtx.drawImage(canvas, 0, 0)

    canvas.width = tempCanvas.height
    canvas.height = tempCanvas.width

    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((90 * Math.PI) / 180)
    ctx.drawImage(tempCanvas, -tempCanvas.width / 2, -tempCanvas.height / 2)

    saveHistory()
  }

  // Crop Canvas Function
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

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = w
    tempCanvas.height = h
    const tempCtx = tempCanvas.getContext('2d')
    if (!tempCtx) return
    tempCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h)

    canvas.width = w
    canvas.height = h
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(tempCanvas, 0, 0)

    setDragStart(null)
    setDragCurrent(null)
    setTool('none')
    saveHistory()
  }

  // Viewer Panning Handlers
  const handleViewerMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return
    e.preventDefault()
    setIsPanning(true)
    panStartRef.current = {
      x: e.clientX - panOffset.x,
      y: e.clientY - panOffset.y,
    }
  }

  const handleViewerMouseMove = (e: React.MouseEvent) => {
    if (!isPanning || isEditing) return
    e.preventDefault()
    setPanOffset({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    } )
  }

  const handleViewerMouseUp = () => {
    setIsPanning(false)
  }

  // Save/Upload Changes to Backend
  const handleSave = async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    setIsSaving(true)
    canvas.toBlob(async (blob) => {
      if (!blob) {
        setIsSaving(false)
        return
      }

      const file = new File([blob], 'edited-image.png', { type: 'image/png' })
      const formData = new FormData()
      formData.append('file', file)

      try {
        const cleanSrc = src.split('?')[0]
        const res = await fetch(`${apiBase}/api/upload?overwritePath=${encodeURIComponent(cleanSrc)}`, {
          method: 'POST',
          body: formData,
        })
        
        if (!res.ok) throw new Error('Failed to overwrite image asset')
        const data = await res.json()
        
        // Add cache buster parameter to trigger refresh in editor
        const cacheBustedUrl = `${data.url}?t=${Date.now()}`
        onSave(cacheBustedUrl)
        onClose()
      } catch (e) {
        console.error('Error saving image modifications', e)
        alert('Failed to save edited image on the backend.')
      } finally {
        setIsSaving(false)
      }
    }, 'image/png')
  }

  // Calculate crop indicator overlay bounding box coordinates
  const getCropBoxStyles = () => {
    if (tool !== 'crop' || !dragStart || !dragCurrent || !canvasRef.current) return null
    const canvas = canvasRef.current
    
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width / canvas.width
    const scaleY = rect.height / canvas.height

    const x1 = dragStart.x * scaleX
    const y1 = dragStart.y * scaleY
    const x2 = dragCurrent.x * scaleX
    const y2 = dragCurrent.y * scaleY

    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    const width = Math.abs(x1 - x2)
    const height = Math.abs(y1 - y2)

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    }
  }

  const cropStyles = getCropBoxStyles()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md transition-opacity">
      <div className="relative max-w-5xl w-full h-[88vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <div className="flex items-center space-x-3">
            <span className="p-2 rounded-lg bg-violet-600/10 text-violet-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </span>
            <div>
              <h3 className="text-lg font-bold tracking-wide">Image Markup & Viewer</h3>
              <p className="text-xs text-slate-400">Editing asset associated with {notePath.split('/').pop()}</p>
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-950 border-b border-slate-850 text-sm">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => { setIsEditing(false); setTool('none'); }}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                !isEditing ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              Viewer
            </button>
            <button
              onClick={() => { setIsEditing(true); setTool('none'); }}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                isEditing ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              Editor Markup
            </button>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center space-x-4">
            {!isEditing ? (
              // Viewer Controls
              <>
                <button
                  onClick={() => setZoom((z) => Math.max(0.2, z - 0.2))}
                  className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300"
                  title="Zoom Out"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4" />
                  </svg>
                </button>
                <span className="text-xs font-mono w-12 text-center text-slate-400">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(4.0, z + 0.2))}
                  className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300"
                  title="Zoom In"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
                <button
                  onClick={() => { setZoom(1.0); setRotation(0); setPanOffset({ x: 0, y: 0 }); }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs text-slate-300 font-semibold"
                >
                  Reset
                </button>
                <button
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300"
                  title="Rotate View"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3 3 3m-3-3v12" />
                  </svg>
                </button>
              </>
            ) : (
              // Editor Tools
              <div className="flex items-center space-x-4">
                {/* Tools Grid */}
                <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => { setTool('none'); setDragStart(null); setDragCurrent(null); }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tool === 'none' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Select/Pan
                  </button>
                  <button
                    onClick={() => { setTool('draw'); setDragStart(null); setDragCurrent(null); }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tool === 'draw' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Pen
                  </button>
                  <button
                    onClick={() => { setTool('highlight'); setDragStart(null); setDragCurrent(null); }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tool === 'highlight' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Highlight
                  </button>
                  <button
                    onClick={() => { setTool('arrow'); setDragStart(null); setDragCurrent(null); }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tool === 'arrow' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Arrow
                  </button>
                  <button
                    onClick={() => { setTool('rect'); setDragStart(null); setDragCurrent(null); }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tool === 'rect' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Rect
                  </button>
                  <button
                    onClick={() => { setTool('circle'); setDragStart(null); setDragCurrent(null); }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tool === 'circle' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Circle
                  </button>
                  <button
                    onClick={() => { setTool('text'); setDragStart(null); setDragCurrent(null); }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tool === 'text' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => { setTool('crop'); setDragStart(null); setDragCurrent(null); }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      tool === 'crop' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Crop
                  </button>
                </div>

                {/* Colors and brush width */}
                {tool !== 'none' && tool !== 'crop' && (
                  <>
                    {/* Brush Colors */}
                    <div className="flex items-center space-x-1">
                      {['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#ffffff', '#000000'].map((c) => (
                        <button
                          key={c}
                          onClick={() => setColor(c)}
                          style={{ backgroundColor: c }}
                          className={`w-4.5 h-4.5 rounded-full border ${
                            color === c ? 'ring-2 ring-violet-500 border-white' : 'border-slate-700'
                          }`}
                        />
                      ))}
                    </div>

                    {/* Width slider */}
                    <div className="flex items-center space-x-1.5 border-l border-slate-800 pl-3">
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Size</span>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        value={lineWidth}
                        onChange={(e) => setLineWidth(Number(e.target.value))}
                        className="w-16 accent-violet-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-xs font-mono w-4 text-slate-450">{lineWidth}</span>
                    </div>
                  </>
                )}

                {tool === 'crop' && dragStart && dragCurrent && (
                  <button
                    onClick={applyCrop}
                    className="px-3 py-1 bg-violet-600 hover:bg-violet-750 text-white rounded text-xs font-bold transition shadow"
                  >
                    Apply Crop
                  </button>
                )}

                {/* Undo / Rotate buttons */}
                <div className="flex items-center space-x-1.5 border-l border-slate-800 pl-3">
                  <button
                    onClick={rotateClockwise}
                    className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300"
                    title="Rotate Image 90° Clockwise"
                  >
                    {/* Clean rotate right SVG */}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l.56-1.9" />
                    </svg>
                  </button>
                  <button
                    onClick={handleUndo}
                    disabled={undoStack.length <= 1}
                    className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 disabled:opacity-40"
                    title="Undo Last Action"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Workspace Canvas / View Container */}
        <div 
          className="flex-1 bg-slate-950 overflow-hidden flex items-center justify-center relative select-none"
          onMouseDown={handleViewerMouseDown}
          onMouseMove={handleViewerMouseMove}
          onMouseUp={handleViewerMouseUp}
          onMouseLeave={handleViewerMouseUp}
        >
          {!isEditing ? (
            // Viewer Window
            <div 
              className={`transition-transform duration-75 ease-out select-none flex items-center justify-center ${
                isPanning ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
              }}
            >
              <img
                src={src.startsWith('/') ? `${apiBase}${src}` : src}
                alt="Enlarged note asset preview"
                className="max-h-[60vh] max-w-[80vw] object-contain rounded shadow-2xl select-none"
                draggable={false}
              />
            </div>
          ) : (
            // Editor Window
            <div className="relative max-h-[60vh] max-w-[80vw] flex items-center justify-center select-none shadow-2xl border border-slate-800 rounded bg-slate-900">
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className={`max-h-[60vh] max-w-[80vw] object-contain cursor-crosshair block bg-transparent ${
                  tool === 'none' ? 'cursor-default' : ''
                }`}
              />

              {/* Crop indicator overlay */}
              {tool === 'crop' && cropStyles && (
                <div
                  style={cropStyles}
                  className="absolute border border-dashed border-violet-500 bg-violet-500/15 pointer-events-none shadow"
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {isEditing 
              ? 'Draw lines, highlights, arrows, rectangles, circles or text directly. Click Save Changes to update the note.'
              : 'Zoom using controls. Click and drag the image to pan around when zoomed in.'}
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-800 rounded-xl hover:bg-slate-800 transition text-sm font-semibold text-slate-300"
            >
              Cancel
            </button>
            {isEditing && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2 bg-violet-600 hover:bg-violet-750 text-white rounded-xl text-sm font-bold transition shadow-lg flex items-center space-x-2"
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Changes</span>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
