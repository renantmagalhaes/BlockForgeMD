import React, { useEffect, useRef, useState } from 'react'
import MindElixir, { type MindElixirData, type MindElixirInstance } from 'mind-elixir'
import 'mind-elixir/style.css'
import { Maximize2, ZoomIn, ZoomOut, FoldVertical, UnfoldVertical } from 'lucide-react'

interface MindMapProps {
  filePath: string
  onSave: (content: string) => Promise<void>
  isSaving: boolean
  theme?: 'dark' | 'cyber'
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

const SHARED_VARS = {
  '--node-gap-x': '32px',
  '--node-gap-y': '8px',
  '--main-gap-x': '44px',
  '--main-gap-y': '12px',
  '--root-radius': '12px',
  '--main-radius': '8px',
  '--topic-padding': '5px 14px',
  '--map-padding': '60px',
}

const DARK_THEME = {
  name: 'blockforge-dark',
  type: 'dark' as const,
  palette: ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'],
  cssVar: {
    ...SHARED_VARS,
    '--main-color': '#f1f5f9',
    '--main-bgcolor': '#6d28d9',
    '--main-bgcolor-transparent': 'rgba(109,40,217,0.15)',
    '--color': '#94a3b8',
    '--bgcolor': '#111111',
    '--selected': '#8b5cf6',
    '--accent-color': '#8b5cf6',
    '--root-color': '#ffffff',
    '--root-bgcolor': '#7c3aed',
    '--root-border-color': '#a78bfa',
    '--panel-color': '#94a3b8',
    '--panel-bgcolor': '#0a0a0a',
    '--panel-border-color': 'rgba(255,255,255,0.08)',
  },
}


const CYBER_THEME = {
  name: 'blockforge-cyber',
  type: 'dark' as const,
  palette: ['#06b6d4', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#a855f7'],
  cssVar: {
    ...SHARED_VARS,
    '--main-color': '#22d3ee',
    '--main-bgcolor': '#0e4f5a',
    '--main-bgcolor-transparent': 'rgba(6,182,212,0.12)',
    '--color': '#9ca3af',
    '--bgcolor': '#1a2235',
    '--selected': '#06b6d4',
    '--accent-color': '#06b6d4',
    '--root-color': '#0b0f19',
    '--root-bgcolor': '#06b6d4',
    '--root-border-color': '#22d3ee',
    '--panel-color': '#9ca3af',
    '--panel-bgcolor': '#111827',
    '--panel-border-color': 'rgba(6,182,212,0.2)',
  },
}

function getMindElixirTheme(theme: string) {
  if (theme === 'cyber') return CYBER_THEME
  return DARK_THEME
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


function getTitleFromFrontMatter(fm: string): string {
  const m = fm.match(/title:\s*(.+)/)
  return m ? m[1].trim() : 'Mind Map'
}

const MindMapComponent: React.FC<MindMapProps> = ({ filePath, onSave, isSaving, theme = 'dark' }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const meRef = useRef<MindElixirInstance | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frontMatterRef = useRef<string>('')
  const themeRef = useRef(theme)
  themeRef.current = theme
  const [loading, setLoading] = useState(true)

  // Update MindElixir theme without re-initializing when the theme prop changes
  useEffect(() => {
    if (!meRef.current) return
    meRef.current.changeTheme(getMindElixirTheme(theme))
  }, [theme])

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false
    setLoading(true)

    if (meRef.current) {
      try { meRef.current.destroy() } catch {}
      meRef.current = null
    }
    containerRef.current.innerHTML = ''

    // Fetch our own content — avoids stale-prop race when navigating from another page
    fetch(`${API_BASE}/api/file?path=${encodeURIComponent(filePath)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled || !containerRef.current) return

        const content: string = data.content ?? ''
        frontMatterRef.current = extractFrontMatter(content)
        const title = getTitleFromFrontMatter(frontMatterRef.current)
        const initialData = extractData(content) || MindElixir.new(title)

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
            name: '🔍 Open Image in New Tab',
            onclick: () => {
              const node = me?.currentNode
              const url = (node as any)?.nodeObj?.image?.url
              if (!url) return
              fetch(url)
                .then(r => r.blob())
                .then(blob => {
                  const blobUrl = URL.createObjectURL(blob)
                  const w = window.open(blobUrl, '_blank')
                  // revoke after the tab has had time to load
                  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
                  if (!w) URL.revokeObjectURL(blobUrl)
                })
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
          theme: getMindElixirTheme(themeRef.current),
        })

        me.init(initialData)
        meRef.current = me
        setLoading(false)

        const schedulesSave = () => {
          if (saveTimer.current) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => {
            const d = me.getData()
            // Pass only the json block — App.tsx handleSaveFile prepends the frontmatter
            onSave(`\`\`\`json\n${JSON.stringify(d)}\n\`\`\`\n`)
          }, 800)
        }

        // 'operation' fires for structural edits; 'expandNode' fires for collapse/expand clicks
        me.bus.addListener('operation', schedulesSave)
        me.bus.addListener('expandNode', schedulesSave)

        const handlePaste = (e: ClipboardEvent) => {
          if (!containerRef.current?.contains(document.activeElement)) return
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
        // Store cleanup on the me ref so the return can reach it
        ;(me as any)._pasteCleanup = () => document.removeEventListener('paste', handlePaste)
      })
      .catch(err => {
        if (!cancelled) {
          console.error('Failed to load mind map:', err)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (meRef.current) {
        ;(meRef.current as any)._pasteCleanup?.()
        try { meRef.current.destroy() } catch {}
        meRef.current = null
      }
    }
  }, [filePath])

  const walkNodes = (node: any, fn: (n: any) => void) => {
    fn(node)
    node.children?.forEach((c: any) => walkNodes(c, fn))
  }

  const saveData = (data: any) => {
    onSave(`\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`)
  }

  const handleExpandAll = () => {
    const me = meRef.current
    if (!me) return
    const data = me.getData()
    walkNodes(data.nodeData, (n: any) => {
      if (n.children && n.children.length > 0) n.expanded = true
    })
    me.refresh(data)
    saveData(data)
  }

  const handleCollapseAll = () => {
    const me = meRef.current
    if (!me) return
    const data = me.getData()
    data.nodeData.children?.forEach((child: any) => {
      walkNodes(child, (n: any) => {
        if (n.children && n.children.length > 0) n.expanded = false
      })
    })
    me.refresh(data)
    saveData(data)
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span className="text-xs font-mono bf-kanban-hint">
          {isSaving ? <span className="bf-kanban-modal-text">Saving…</span> : <span className="bf-kanban-hint">Saved</span>}
          <span className="ml-3">Tab = child · Enter = sibling · F2 = rename · Ctrl+V = paste image · Right-click = more</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExpandAll}
            className="p-1.5 bf-kanban-btn rounded-lg transition cursor-pointer"
            title="Expand all nodes"
          >
            <UnfoldVertical size={13} />
          </button>
          <button
            onClick={handleCollapseAll}
            className="p-1.5 bf-kanban-btn rounded-lg transition cursor-pointer"
            title="Collapse all nodes"
          >
            <FoldVertical size={13} />
          </button>
          <div className="w-px h-4 bg-[var(--border-0)] mx-0.5" />
          <button
            onClick={() => meRef.current?.scale(1.25)}
            className="p-1.5 bf-kanban-btn rounded-lg transition cursor-pointer"
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <button
            onClick={() => meRef.current?.scale(0.8)}
            className="p-1.5 bf-kanban-btn rounded-lg transition cursor-pointer"
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            onClick={() => meRef.current?.scaleFit()}
            className="p-1.5 bf-kanban-btn rounded-lg transition cursor-pointer"
            title="Fit to view"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      {/* Wrapper keeps container always in the DOM with real dimensions so mind-elixir
          can measure nodes during init. Loading overlay sits on top instead. */}
      <div className="flex-1 relative rounded-xl overflow-hidden bf-mindmap-canvas">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bf-kanban-hint text-sm select-none z-10 bf-mindmap-canvas">
            Loading…
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  )
}

export default MindMapComponent
