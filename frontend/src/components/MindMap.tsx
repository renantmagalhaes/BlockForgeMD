import React, { useEffect, useRef } from 'react'
import MindElixir, { type MindElixirData, type MindElixirInstance } from 'mind-elixir'
import 'mind-elixir/style.css'
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react'

interface MindMapProps {
  filePath: string
  initialContent: string
  onSave: (content: string) => Promise<void>
  isSaving: boolean
}

const DARK_THEME = {
  name: 'blockforge-dark',
  type: 'dark' as const,
  palette: ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'],
  cssVar: {
    '--node-gap-x': '32px',
    '--node-gap-y': '8px',
    '--main-gap-x': '44px',
    '--main-gap-y': '12px',
    '--main-color': '#f1f5f9',
    '--main-bgcolor': '#6d28d9',
    '--main-bgcolor-transparent': 'rgba(109,40,217,0.15)',
    '--color': '#cbd5e1',
    '--bgcolor': '#1e293b',
    '--selected': '#8b5cf6',
    '--accent-color': '#8b5cf6',
    '--root-color': '#ffffff',
    '--root-bgcolor': '#7c3aed',
    '--root-border-color': '#a78bfa',
    '--root-radius': '12px',
    '--main-radius': '8px',
    '--topic-padding': '5px 14px',
    '--panel-color': '#94a3b8',
    '--panel-bgcolor': '#1e293b',
    '--panel-border-color': '#334155',
    '--map-padding': '60px',
  },
}

function extractFrontMatter(content: string): string {
  const m = content.match(/^(---[\s\S]*?---\n?)/)
  return m ? m[1] : '---\ntype: mindmap\n---\n'
}

function extractData(content: string): MindElixirData | null {
  const m = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}

function buildContent(frontMatter: string, data: MindElixirData): string {
  return `${frontMatter}\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`
}

function getTitleFromFrontMatter(fm: string): string {
  const m = fm.match(/title:\s*(.+)/)
  return m ? m[1].trim() : 'Mind Map'
}

const MindMapComponent: React.FC<MindMapProps> = ({ filePath, initialContent, onSave, isSaving }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const meRef = useRef<MindElixirInstance | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frontMatterRef = useRef<string>('')

  useEffect(() => {
    if (!containerRef.current) return

    if (meRef.current) {
      try { meRef.current.destroy() } catch {}
      meRef.current = null
    }
    containerRef.current.innerHTML = ''

    frontMatterRef.current = extractFrontMatter(initialContent)
    const title = getTitleFromFrontMatter(frontMatterRef.current)
    const initialData = extractData(initialContent) || MindElixir.new(title)

    // Capture me before assignment so closures work after init
    let me: MindElixirInstance

    const contextMenuExtend = [
      {
        name: '🔗 Set Hyperlink',
        onclick: () => {
          const node = me?.currentNode
          if (!node) return
          const current = (node as any).nodeObj?.hyperLink ?? ''
          const url = prompt('Enter URL (leave empty to remove):', current)
          if (url === null) return
          me.reshapeNode(node, { hyperLink: url || undefined })
        },
      },
      {
        name: '🖼 Add / Replace Image',
        onclick: () => {
          const node = me?.currentNode
          if (!node) return
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/*'
          input.onchange = () => {
            const file = input.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = (evt) => {
              const dataUrl = evt.target?.result as string
              if (!dataUrl) return
              const img = new Image()
              img.onload = () => {
                const MAX_W = 280
                const scale = img.naturalWidth > MAX_W ? MAX_W / img.naturalWidth : 1
                me.reshapeNode(node, {
                  image: {
                    url: dataUrl,
                    width: Math.round(img.naturalWidth * scale),
                    height: Math.round(img.naturalHeight * scale),
                    fit: 'contain',
                  },
                })
              }
              img.src = dataUrl
            }
            reader.readAsDataURL(file)
          }
          input.click()
        },
      },
      {
        name: '✕ Remove Image',
        onclick: () => {
          const node = me?.currentNode
          if (!node || !(node as any).nodeObj?.image) return
          me.reshapeNode(node, { image: undefined as any })
        },
      },
    ]

    me = new MindElixir({
      el: containerRef.current,
      direction: MindElixir.SIDE,
      draggable: true,
      contextMenu: { extend: contextMenuExtend },
      toolBar: false,
      keypress: true,
      newTopicName: 'New Topic',
      allowUndo: true,
      theme: DARK_THEME,
    })

    me.init(initialData)
    meRef.current = me

    const onOperation = () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        const data = me.getData()
        onSave(buildContent(frontMatterRef.current, data))
      }, 800)
    }

    me.bus.addListener('operation', onOperation)

    const handlePaste = (e: ClipboardEvent) => {
      // Only act when this mind map container has focus
      if (!containerRef.current?.contains(document.activeElement)) return
      // Don't intercept while the user is editing a node's text
      if (document.activeElement?.getAttribute('contenteditable') === 'true') return
      const node = me?.currentNode
      if (!node) return
      const imageItem = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
      if (!imageItem) return
      e.preventDefault()
      const file = imageItem.getAsFile()
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        const dataUrl = evt.target?.result as string
        if (!dataUrl) return
        const img = new Image()
        img.onload = () => {
          const MAX_W = 280
          const scale = img.naturalWidth > MAX_W ? MAX_W / img.naturalWidth : 1
          me.reshapeNode(node, {
            image: {
              url: dataUrl,
              width: Math.round(img.naturalWidth * scale),
              height: Math.round(img.naturalHeight * scale),
              fit: 'contain',
            },
          })
        }
        img.src = dataUrl
      }
      reader.readAsDataURL(file)
    }

    document.addEventListener('paste', handlePaste)

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      document.removeEventListener('paste', handlePaste)
      try { me.destroy() } catch {}
      meRef.current = null
    }
  }, [filePath])

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span className="text-xs font-mono text-slate-600">
          {isSaving ? <span className="text-slate-400">Saving…</span> : <span className="text-slate-600">Saved</span>}
          <span className="ml-3">Tab = child · Enter = sibling · F2 = rename · Ctrl+V = paste image · Right-click = more</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => meRef.current?.scale(1.25)}
            className="p-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700/50 transition cursor-pointer"
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <button
            onClick={() => meRef.current?.scale(0.8)}
            className="p-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700/50 transition cursor-pointer"
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            onClick={() => meRef.current?.scaleFit()}
            className="p-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg border border-slate-700/50 transition cursor-pointer"
            title="Fit to view"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 rounded-xl overflow-hidden border border-slate-800"
        style={{ background: '#0d1117' }}
      />
    </div>
  )
}

export default MindMapComponent
