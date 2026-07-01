import React, { useEffect, useState, useRef } from 'react'
import { useEditor, EditorContent, NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import { Node, mergeAttributes } from '@tiptap/core'
import { Excalidraw } from '@excalidraw/excalidraw'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { ImageEditorModal } from './ImageEditorModal'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { marked } from 'marked'
import TurndownService from 'turndown'
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  CheckSquare,
  Undo,
  Redo,
  Save,
  Loader2,
  Grid,
  Info,
  History,
  RotateCcw,
  X,
  Calendar,
  User,
  Tag,
  AlertCircle,
  Hash,
  Activity,
  Plus,
  FileText,
  LayoutGrid,
  Brush,
  Maximize2,
  AlignLeft,
  AlignCenter,
  ArrowLeftRight,
  BookMarked,
  MonitorPlay,
  Link2
} from 'lucide-react'

// Configure Turndown for clean Markdown serialization
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bullet: '-',
  codeBlockStyle: 'fenced'
} as any)

// Custom rule for task lists in Turndown
turndownService.addRule('taskListItems', {
  filter: (node) => {
    return (
      node.nodeName === 'LI' &&
      (node.getAttribute('data-type') === 'taskItem' ||
        node.parentElement?.getAttribute('data-type') === 'taskList')
    )
  },
  replacement: (content, node) => {
    const input = node.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    const checked = input ? input.checked : node.getAttribute('data-checked') === 'true'
    const status = checked ? '[x]' : '[ ]'
    return `- ${status} ${content.trim()}\n`
  }
})

// Custom rule for Tables in Turndown
turndownService.addRule('tables', {
  filter: ['table', 'thead', 'tbody', 'tr', 'th', 'td'],
  replacement: (content, node) => {
    const name = node.nodeName.toLowerCase()
    if (name === 'td' || name === 'th') {
      return ` ${content.trim()} |`
    }
    if (name === 'tr') {
      const isHeader = node.parentElement?.nodeName.toLowerCase() === 'thead' || node.querySelector('th')
      let suffix = '\n'
      if (isHeader) {
        const cellsCount = node.querySelectorAll('td, th').length
        const delimiter = `|${' --- |'.repeat(cellsCount)}\n`
        suffix = `\n${delimiter}`
      }
      return `|${content}${suffix}`
    }
    if (name === 'table') {
      return `\n${content}\n`
    }
    return content
  }
})

// Custom rule for iframes in Turndown
turndownService.addRule('iframe', {
  filter: (node) => node.nodeName.toLowerCase() === 'iframe',
  replacement: (_content, node) => {
    const src = (node as HTMLElement).getAttribute('src') || ''
    const width = (node as HTMLElement).getAttribute('width') || '100%'
    const height = (node as HTMLElement).getAttribute('height') || '450px'
    const frameborder = (node as HTMLElement).getAttribute('frameborder') || '0'
    const allowfullscreen = (node as HTMLElement).getAttribute('allowfullscreen') || 'true'
    return `\n<iframe src="${src}" width="${width}" height="${height}" frameborder="${frameborder}" allowfullscreen="${allowfullscreen}"></iframe>\n`
  }
})

// Custom rule for draw.io embeds in Turndown
turndownService.addRule('drawio', {
  filter: (node) => node.nodeName.toLowerCase() === 'drawio',
  replacement: (_content, node) => {
    const path = (node as HTMLElement).getAttribute('path') || ''
    return `\n<drawio path="${path}">drawio-canvas</drawio>\n`
  }
})

// Custom rule for excalidraw embeds in Turndown
turndownService.addRule('excalidraw', {
  filter: (node) => node.nodeName.toLowerCase() === 'excalidraw',
  replacement: (_content, node) => {
    const path = (node as HTMLElement).getAttribute('path') || ''
    return `\n<excalidraw path="${path}">excalidraw-canvas</excalidraw>\n`
  }
})

// Custom rule for bookmark embeds in Turndown
turndownService.addRule('bookmark', {
  filter: (node) => node.nodeName.toLowerCase() === 'bookmark',
  replacement: (_content, node) => {
    const el = node as HTMLElement
    const url = (el.getAttribute('url') || '').replace(/"/g, '&quot;')
    const title = (el.getAttribute('title') || '').replace(/"/g, '&quot;')
    const description = (el.getAttribute('description') || '').replace(/"/g, '&quot;')
    const image = (el.getAttribute('image') || '').replace(/"/g, '&quot;')
    const favicon = (el.getAttribute('favicon') || '').replace(/"/g, '&quot;')
    const siteName = (el.getAttribute('siteName') || '').replace(/"/g, '&quot;')
    return `\n<bookmark url="${url}" title="${title}" description="${description}" image="${image}" favicon="${favicon}" siteName="${siteName}"></bookmark>\n`
  }
})

const IframeViewerComponent = (props: any) => {
  const { src, width, height } = props.node.attrs
  const containerRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      
      const newWidth = Math.max(200, Math.min(e.clientX - rect.left, window.innerWidth - rect.left - 40))
      const newHeight = Math.max(150, e.clientY - rect.top)

      props.updateAttributes({
        width: `${newWidth}px`,
        height: `${newHeight}px`
      })
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, props])

  return (
    <NodeViewWrapper 
      ref={containerRef}
      style={{ width: width || '100%', height: height || '450px' }}
      className="iframe-embed my-4 border border-slate-800 rounded-xl overflow-hidden shadow-lg bg-[#0d1117] relative group flex flex-col"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22]/50 select-none h-9 shrink-0">
        <div className="flex items-center space-x-2">
          <span className="text-violet-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
          </span>
          <span className="text-xs font-semibold text-slate-350 truncate">Embedded Web Frame: {src}</span>
        </div>
      </div>

      {/* Frame wrapper container */}
      <div className="relative w-full flex-1 min-w-[200px] min-h-[110px]">
        {isResizing && <div className="absolute inset-0 z-10 bg-transparent" />}

        <iframe
          src={src}
          className="w-full h-full border-none"
          title="Iframe Embed"
          allowFullScreen
        />

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute bottom-1 right-1 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 z-20 hover:scale-110 active:scale-95 transition"
        >
          <svg className="w-3.5 h-3.5 text-slate-400 hover:text-violet-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 19H5m14-6H11m8-6h-5" />
          </svg>
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export const IframeNode = Node.create({
  name: 'iframe',
  group: 'block',
  selectable: true,
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      width: {
        default: '100%',
      },
      height: {
        default: '450px',
      },
      frameborder: {
        default: '0',
      },
      allowfullscreen: {
        default: 'true',
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'iframe',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['iframe', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(IframeViewerComponent)
  },
})

const DrawioViewerComponent = (props: any) => {
  const filePath = props.node.attrs.path
  const [xml, setXml] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!filePath) return
    // Fetch the canvas file content to extract Draw.io XML
    fetch(`/api/file?path=${encodeURIComponent(filePath)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.content) {
          const codeBlockMatch = data.content.match(/```xml\n([\s\S]*?)\n```/)
          if (codeBlockMatch && codeBlockMatch[1]) {
            setXml(codeBlockMatch[1].trim())
          }
        }
      })
      .catch((err) => console.error('Failed to load embedded draw.io file', err))
  }, [filePath])

  useEffect(() => {
    if (!xml) return

    const handleMessage = (e: MessageEvent) => {
      if (
        e.origin !== 'https://embed.diagrams.net' &&
        e.origin !== 'https://app.diagrams.net' &&
        e.origin !== 'https://viewer.diagrams.net'
      ) {
        return
      }
      try {
        const data = JSON.parse(e.data)
        if (data.event === 'init') {
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({
              action: 'load',
              xml: xml,
            }),
            '*'
          )
        }
      } catch (err) {
        // Ignore
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [xml])

  return (
    <NodeViewWrapper className="drawio-embed my-4 border border-slate-800 rounded-xl overflow-hidden shadow-lg bg-[#0d1117] text-slate-200">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22]/50">
        <div className="flex items-center space-x-2 select-none">
          <span className="text-violet-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
          </span>
          <span className="text-xs font-semibold text-slate-350 truncate">Embedded Draw.io Canvas: {filePath ? filePath.split('/').pop() : 'Untitled'}</span>
        </div>
        <a
          href={`/${filePath}`}
          onClick={(e) => {
            e.preventDefault();
            props.extension.options.onSelectFile?.(filePath)
          }}
          className="text-[10px] text-violet-400 hover:text-violet-300 font-bold underline transition cursor-pointer select-none"
        >
          Edit Canvas
        </a>
      </div>
      <div className="relative w-full h-[400px] bg-[#121212]">
        <iframe
          ref={iframeRef}
          src="https://viewer.diagrams.net/?embed=1&ui=dark&spin=1&proto=json"
          className="w-full h-full border-none"
          title="Draw.io Embedded Viewer"
        />
      </div>
    </NodeViewWrapper>
  )
}

export const DrawioNode = Node.create({
  name: 'drawio',
  group: 'block',
  selectable: true,
  draggable: true,
  atom: true,

  addOptions() {
    return {
      onSelectFile: null,
    }
  },

  addAttributes() {
    return {
      path: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'drawio',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['drawio', mergeAttributes(HTMLAttributes), 'drawio-canvas']
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawioViewerComponent)
  },
})

const ExcalidrawViewerComponent = (props: any) => {
  const filePath = props.node.attrs.path
  const [elements, setElements] = useState<any[]>([])
  const [appState, setAppState] = useState<any>({ theme: 'dark', viewBackgroundColor: '#121212' })
  const [isLoaded, setIsLoaded] = useState(false)
  const excalidrawRef = useRef<any>(null)

  useEffect(() => {
    if (!filePath) return
    fetch(`/api/file?path=${encodeURIComponent(filePath)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.content) {
          const codeBlockMatch = data.content.match(/```json\n([\s\S]*?)\n```/)
          if (codeBlockMatch && codeBlockMatch[1]) {
            const parsed = JSON.parse(codeBlockMatch[1])
            if (parsed && Array.isArray(parsed.elements)) {
              setElements(parsed.elements)
              if (parsed.appState) {
                setAppState({ ...parsed.appState, theme: 'dark' })
              }
            }
          }
        }
        setIsLoaded(true)
      })
      .catch((err) => console.error('Failed to load embedded excalidraw file', err))
  }, [filePath])

  useEffect(() => {
    if (isLoaded && elements.length > 0 && excalidrawRef.current) {
      const hasCustomScroll = appState.scrollX !== undefined && appState.scrollX !== 0
      const hasCustomZoom = appState.zoom && appState.zoom.value !== undefined && appState.zoom.value !== 1
      
      if (!hasCustomScroll && !hasCustomZoom) {
        const timer = setTimeout(() => {
          excalidrawRef.current?.scrollToContent()
        }, 250)
        return () => clearTimeout(timer)
      }
    }
  }, [isLoaded, elements, appState])

  return (
    <NodeViewWrapper className="excalidraw-embed my-4 border border-slate-800 rounded-xl overflow-hidden shadow-lg bg-[#0d1117] text-slate-200">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22]/50">
        <div className="flex items-center space-x-2 select-none">
          <span className="text-violet-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </span>
          <span className="text-xs font-semibold text-slate-350 truncate">Embedded Excalidraw Canvas: {filePath ? filePath.split('/').pop() : 'Untitled'}</span>
        </div>
        <a
          href={`/${filePath}`}
          onClick={(e) => {
            e.preventDefault();
            props.extension.options.onSelectFile?.(filePath)
          }}
          className="text-[10px] text-violet-400 hover:text-violet-300 font-bold underline transition cursor-pointer select-none"
        >
          Edit Canvas
        </a>
      </div>
      <div className="relative w-full h-[400px] bg-[#121212] flex items-center justify-center">
        {!isLoaded ? (
          <div className="text-xs text-slate-500 select-none">Loading Excalidraw viewer...</div>
        ) : (
          <Excalidraw
            excalidrawAPI={(api: any) => {
              excalidrawRef.current = api
            }}
            viewModeEnabled={true}
            initialData={{
              elements,
              appState: { ...appState, theme: 'dark' },
            }}
            theme="dark"
          />
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const ExcalidrawNode = Node.create({
  name: 'excalidraw',
  group: 'block',
  selectable: true,
  draggable: true,
  atom: true,

  addOptions() {
    return {
      onSelectFile: null,
    }
  },

  addAttributes() {
    return {
      path: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'excalidraw',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['excalidraw', mergeAttributes(HTMLAttributes), 'excalidraw-canvas']
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExcalidrawViewerComponent)
  },
})

const BookmarkComponent = (props: any) => {
  const { url, title, description, image, favicon, siteName } = props.node.attrs
  const [loading, setLoading] = useState(!title)

  useEffect(() => {
    if (title) return // Already fetched and stored

    setLoading(true)
    const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''
    fetch(`${API_BASE}/api/link-preview?url=${encodeURIComponent(url)}`)
      .then(res => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(data => {
        props.updateAttributes({
          title: data.title || url,
          description: data.description || '',
          image: data.image || '',
          favicon: data.favicon || '',
          siteName: data.siteName || '',
        })
        setLoading(false)
      })
      .catch(() => {
        props.updateAttributes({
          title: url,
          description: '',
          image: '',
          favicon: '',
          siteName: '',
        })
        setLoading(false)
      })
  }, [url, title]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayTitle = title || url
  const displayHost = (() => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  })()

  return (
    <NodeViewWrapper className="bookmark-card my-4 border border-slate-800 bg-[#161b22]/40 hover:bg-[#161b22]/70 hover:border-violet-500/40 rounded-xl overflow-hidden shadow-md transition-all duration-200">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-stretch text-slate-200 no-underline cursor-pointer select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 p-4 min-w-0 flex flex-col justify-between">
          <div className="min-w-0">
            {loading ? (
              <div className="flex items-center space-x-2 text-slate-500 text-xs py-2">
                <Loader2 className="animate-spin w-3.5 h-3.5" />
                <span>Loading link preview...</span>
              </div>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-slate-250 truncate leading-snug hover:text-violet-400 transition-colors">
                  {displayTitle}
                </h4>
                {description && (
                  <p className="text-xs text-slate-455 mt-1 line-clamp-2 leading-relaxed">
                    {description}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex items-center space-x-2 mt-3 text-[11px] text-slate-500 min-w-0">
            {favicon ? (
              <img
                src={favicon}
                alt=""
                className="w-3.5 h-3.5 object-contain rounded shrink-0"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : (
              <Link2 size={12} className="text-slate-500 shrink-0" />
            )}
            <span className="font-semibold truncate text-slate-400">{siteName || displayHost}</span>
            <span className="text-slate-700 font-bold shrink-0">·</span>
            <span className="truncate max-w-[150px] font-mono text-[10px] text-slate-500">{displayHost}</span>
          </div>
        </div>
        {image && !loading && (
          <div className="w-1/4 max-w-[140px] min-w-[100px] relative border-l border-slate-800 bg-[#0d1117] hidden sm:block">
            <img src={image} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </div>
        )}
      </a>
    </NodeViewWrapper>
  )
}

export const BookmarkNode = Node.create({
  name: 'bookmark',
  group: 'block',
  selectable: true,
  draggable: true,
  atom: true,

  addAttributes() {
    return {
      url: {
        default: '',
      },
      title: {
        default: '',
      },
      description: {
        default: '',
      },
      image: {
        default: '',
      },
      favicon: {
        default: '',
      },
      siteName: {
        default: '',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'bookmark',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['bookmark', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkComponent)
  },
})

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'bash', label: 'Bash / Shell' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'xml', label: 'XML' },
]

const CodeBlockComponent = (props: any) => {
  const { language } = props.node.attrs

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    props.updateAttributes({ language: e.target.value })
  }

  return (
    <NodeViewWrapper className="code-block-container my-4 relative rounded-xl overflow-hidden border border-slate-800 bg-[#0d1117] group">
      {/* Header with language selection */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#161b22] border-b border-slate-850 select-none">
        <select
          value={language || 'javascript'}
          onChange={handleLanguageChange}
          className="bg-transparent text-slate-400 hover:text-slate-200 text-xs font-semibold focus:outline-none border-none py-0.5 pr-6 cursor-pointer rounded-lg transition-colors"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.value} value={lang.value} className="bg-[#161b22] text-slate-350">
              {lang.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-slate-500 font-mono select-none opacity-0 group-hover:opacity-100 transition-opacity pr-2">
          Code Block
        </span>
      </div>

      {/* Editor Content Area */}
      <pre style={{ backgroundColor: 'transparent', padding: '1rem', border: 'none', margin: 0, borderRadius: 0 }} className="overflow-x-auto text-xs font-mono text-slate-100 focus:outline-none leading-relaxed">
        <NodeViewContent as={"code" as any} />
      </pre>
    </NodeViewWrapper>
  )
}

export const CustomCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent)
  },
})




interface FileRecord {
  path: string
  title: string
  type: string
  contentHash: string
  updatedAt: string
  frontMatter?: Record<string, string>
}

interface EditorProps {
  filePath: string
  initialContent: string
  onSave: (content: string) => Promise<void>
  isSaving: boolean
  frontMatter?: Record<string, string>
  onUpdateFrontMatter?: (updates: Record<string, any>) => Promise<void>
  boardColumns: string[]
  onCreateSubPage?: (parentPath: string, onCreated: (newPath: string, title: string) => string) => void
  onSelectFile?: (path: string) => void
  files: FileRecord[]
  globalLayoutOverride?: string
  globalColumnWidthOverride?: string
}

interface HistoryVersion {
  timestamp: number
  date: string
  size: number
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

const COMMANDS = [
  { id: 'h1', label: 'Heading 1', desc: 'Large section header', search: 'h1 heading1 large text' },
  { id: 'h2', label: 'Heading 2', desc: 'Medium section header', search: 'h2 heading2 medium text' },
  { id: 'h3', label: 'Heading 3', desc: 'Small section header', search: 'h3 heading3 small text' },
  { id: 'bullet', label: 'Bullet List', desc: 'Simple bulleted list', search: 'bullet list unordered' },
  { id: 'number', label: 'Numbered List', desc: 'Ordered numbered list', search: 'number list ordered' },
  { id: 'task', label: 'Task List', desc: 'Checkbox checklist', search: 'task todo checklist check' },
  { id: 'quote', label: 'Blockquote', desc: 'Indented block quote', search: 'quote blockquote indent' },
  { id: 'callout', label: 'Callout Box', desc: 'Highlighted info box', search: 'callout note alert warning info' },
  { id: 'table', label: 'Table Grid', desc: 'Insert a 2x2 grid table', search: 'table grid columns cell' },
  { id: 'code', label: 'Code Block', desc: 'Monospace fenced code block', search: 'code block script pre' },
  { id: 'subpage', label: 'Sub-page', desc: 'Create a sub-page inside this page', search: 'subpage sub page child nested' },
  { id: 'embed', label: 'Embed Link / Canvas', desc: 'Embed a website link, iframe, or Draw.io canvas', search: 'embed iframe link website canvas drawio' },
]

export const Editor: React.FC<EditorProps> = ({
  filePath,
  initialContent,
  onSave,
  isSaving,
  frontMatter,
  onUpdateFrontMatter,
  boardColumns,
  onCreateSubPage,
  onSelectFile,
  files,
  globalLayoutOverride,
  globalColumnWidthOverride,
}) => {
  // Slash command states
  const [commandActive, setCommandActive] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandCoords, setCommandCoords] = useState({ top: 0, left: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Auto-save states
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved')
  const saveTimeoutRef = useRef<any | null>(null)

  // Version history states
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyList, setHistoryList] = useState<HistoryVersion[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  // Tag manager input state
  const [newTagInput, setNewTagInput] = useState('')

  // Image Viewer & Editor state
  const [editingImageSrc, setEditingImageSrc] = useState<string | null>(null)

  // Embed states
  const [embedModalOpen, setEmbedModalOpen] = useState(false)
  const [embedType, setEmbedType] = useState<'url' | 'drawio'>('url')
  const [embedUrl, setEmbedUrl] = useState('')
  const [selectedCanvasPath, setSelectedCanvasPath] = useState('')

  // Layout state (left, center, full)
  const [localLayout, setLocalLayout] = useState<'left' | 'center' | 'full'>('left')
  const pageLayout = frontMatter && onUpdateFrontMatter
    ? (frontMatter.layout as 'left' | 'center' | 'full' || 'left')
    : localLayout

  // Apply global layout override if set
  const layout = globalLayoutOverride && globalLayoutOverride !== 'per-page'
    ? (globalLayoutOverride as 'left' | 'center' | 'full')
    : pageLayout

  const cycleLayout = async () => {
    let nextLayout: 'left' | 'center' | 'full' = 'left'
    if (pageLayout === 'left') nextLayout = 'center'
    else if (pageLayout === 'center') nextLayout = 'full'
    else nextLayout = 'left'

    if (frontMatter && onUpdateFrontMatter) {
      await onUpdateFrontMatter({ layout: nextLayout })
    } else {
      setLocalLayout(nextLayout)
    }
  }

  // Column width / lateral margins state (narrow, normal, wide) for left & center aligned modes
  const [localColumnWidth, setLocalColumnWidth] = useState<'narrow' | 'normal' | 'wide'>('normal')
  const pageColumnWidth = frontMatter && onUpdateFrontMatter
    ? (frontMatter.columnWidth as 'narrow' | 'normal' | 'wide' || 'normal')
    : localColumnWidth

  // Apply global column width override if set
  const columnWidth = globalColumnWidthOverride && globalColumnWidthOverride !== 'per-page'
    ? (globalColumnWidthOverride as 'narrow' | 'normal' | 'wide')
    : pageColumnWidth

  const cycleColumnWidth = async () => {
    let nextWidth: 'narrow' | 'normal' | 'wide' = 'normal'
    if (columnWidth === 'narrow') nextWidth = 'normal'
    else if (columnWidth === 'normal') nextWidth = 'wide'
    else nextWidth = 'narrow'

    if (frontMatter && onUpdateFrontMatter) {
      await onUpdateFrontMatter({ columnWidth: nextWidth })
    } else {
      setLocalColumnWidth(nextWidth)
    }
  }

  const getWidthClass = () => {
    if (layout === 'full') return 'max-w-none w-full'
    const widthKey = columnWidth === 'narrow' ? 'max-w-2xl' :
                     columnWidth === 'wide' ? 'max-w-6xl' :
                     'max-w-4xl'
    if (layout === 'center') return `${widthKey} mx-auto w-full`
    return widthKey
  }

  // Mention states
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionCoords, setMentionCoords] = useState({ top: 0, left: 0 })
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0)

  // Link paste non-blocking toast state
  const [pasteInfo, setPasteInfo] = useState<{ url: string; from: number; to: number; x: number; y: number } | null>(null)
  const pasteInfoRef = useRef(pasteInfo)
  useEffect(() => {
    pasteInfoRef.current = pasteInfo
  }, [pasteInfo])

  const lastSavedContentRef = useRef<string>(initialContent || '')
  const lastFilePathRef = useRef<string | null>(null)



  // Click outside to close paste popup
  useEffect(() => {
    if (!pasteInfo) return
    const handler = (e: MouseEvent) => {
      const el = document.getElementById('link-paste-popup')
      if (el && !el.contains(e.target as any)) {
        setPasteInfo(null)
      }
    }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler)
    }, 50)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handler)
    }
  }, [pasteInfo])

  const toEmbedUrl = (url: string) => {
    // YouTube Watch URLs
    const ytMatch1 = url.match(/(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)
    if (ytMatch1) {
      return `https://www.youtube.com/embed/${ytMatch1[1]}`
    }
    // Vimeo URLs
    const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
    if (vimeoMatch) {
      return `https://player.vimeo.com/video/${vimeoMatch[1]}`
    }
    return url
  }

  const handleToastConvert = (type: 'bookmark' | 'embed') => {
    if (!pasteInfo || !editor) return
    const { url, from, to } = pasteInfo
    setPasteInfo(null)

    const content = type === 'bookmark'
      ? {
          type: 'bookmark',
          attrs: { url, title: '', description: '', image: '', favicon: '', siteName: '' }
        }
      : {
          type: 'iframe',
          attrs: { src: toEmbedUrl(url), width: '100%', height: '450px' }
        }

    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .deleteSelection()
      .insertContent(content)
      .run()
    triggerAutoSave()
  }

  // Avoid stale closures in TipTap callback handlers via refs
  const commandActiveRef = useRef(commandActive)
  const selectedIndexRef = useRef(selectedIndex)
  const commandQueryRef = useRef(commandQuery)

  const mentionActiveRef = useRef(mentionActive)
  const mentionSelectedIndexRef = useRef(mentionSelectedIndex)
  const mentionQueryRef = useRef(mentionQuery)

  const getHTMLFromMarkdown = (markdown: string) => {
    if (!markdown.trim()) return '<p></p>'
    let rawHtml = marked.parse(markdown)
    if (typeof rawHtml !== 'string') rawHtml = ''
    rawHtml = rawHtml
      .replace(/<p>\s*(<bookmark[^>]*>.*?<\/bookmark>)\s*<\/p>/gi, '$1')
      .replace(/<p>\s*(<drawio[^>]*>.*?<\/drawio>)\s*<\/p>/gi, '$1')
      .replace(/<p>\s*(<excalidraw[^>]*>.*?<\/excalidraw>)\s*<\/p>/gi, '$1')
    return rawHtml
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'mention-link text-violet-400 font-semibold underline hover:text-violet-300 cursor-pointer',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full rounded-xl border border-slate-800 shadow-lg my-4',
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      IframeNode,
      BookmarkNode,
      CustomCodeBlock,
      DrawioNode.configure({
        onSelectFile: (path: string) => onSelectFile?.(path)
      } as any),
      ExcalidrawNode.configure({
        onSelectFile: (path: string) => onSelectFile?.(path)
      } as any),
    ],
    content: getHTMLFromMarkdown(initialContent),
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[450px] text-slate-200 px-4 py-2',
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (items) {
          let hasImage = false
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
              const file = items[i].getAsFile()
              if (file) {
                hasImage = true
                uploadImageAndInsert(file)
              }
            }
          }
          if (hasImage) return true
        }

        const pastedText = event.clipboardData?.getData('text/plain')?.trim()
        if (pastedText && /^https?:\/\/[^\s]+$/i.test(pastedText)) {
          const { state, dispatch } = view
          const { selection } = state
          
          // Insert standard link node
          const linkMark = state.schema.marks.link.create({ href: pastedText })
          const textNode = state.schema.text(pastedText, [linkMark])
          const tr = state.tr.replaceSelectionWith(textNode)
          tr.removeStoredMark(state.schema.marks.link)
          dispatch(tr)

          triggerAutoSave()

          try {
            const coords = view.coordsAtPos(selection.from)
            setPasteInfo({
              url: pastedText,
              from: selection.from,
              to: selection.from + pastedText.length,
              x: coords.left,
              y: coords.bottom + 8
            })
          } catch (e) {
            setPasteInfo({
              url: pastedText,
              from: selection.from,
              to: selection.from + pastedText.length,
              x: window.innerWidth / 2 - 150,
              y: window.innerHeight / 2
            })
          }
          return true
        }

        return false
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        let hasImage = false
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.indexOf('image') !== -1) {
            hasImage = true
            uploadImageAndInsert(files[i])
          }
        }
        return hasImage
      },
      handleClick: (view, _pos, event) => {
        let target = event.target as HTMLElement | null
        while (target && target !== view.dom) {
          if (target.nodeName === 'A') {
            const href = target.getAttribute('href')
            if (href) {
              event.preventDefault()
              event.stopPropagation()
              if (href.startsWith('http://') || href.startsWith('https://')) {
                window.open(href, '_blank', 'noopener,noreferrer')
              } else {
                onSelectFile?.(href)
              }
              return true
            }
          }
          if (target.nodeName === 'IMG') {
            const src = target.getAttribute('src')
            if (src) {
              event.preventDefault()
              event.stopPropagation()
              setEditingImageSrc(src)
              return true
            }
          }
          target = target.parentElement
        }
        return false
      },
      handleKeyDown: (_view, event) => {
        // If link paste choices popup is open, dismiss it on any content keypress
        if (pasteInfoRef.current) {
          if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
            setPasteInfo(null)
          }
        }

        if (commandActiveRef.current) {
          const filtered = getFilteredCommands()
          if (filtered.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelectedIndex((prev) => (prev + 1) % filtered.length)
              return true
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
              return true
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              executeCommand(filtered[selectedIndexRef.current].id)
              return true
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setCommandActive(false)
              return true
            }
          }
        }

        if (mentionActiveRef.current) {
          const filtered = getFilteredMentions()
          if (filtered.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setMentionSelectedIndex((prev) => (prev + 1) % filtered.length)
              return true
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setMentionSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
              return true
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              executeMention(filtered[mentionSelectedIndexRef.current])
              return true
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMentionActive(false)
              return true
            }
          }
        }

        return false
      }
    },
    onUpdate: () => {
      triggerAutoSave()
    },
    onSelectionUpdate: () => {
      // Don't auto-dismiss in selectionUpdate as that is triggered by editor events
    }
  })

  // Synchronize state values to refs on every render
  useEffect(() => {
    commandActiveRef.current = commandActive
    selectedIndexRef.current = selectedIndex
    commandQueryRef.current = commandQuery

    mentionActiveRef.current = mentionActive
    mentionSelectedIndexRef.current = mentionSelectedIndex
    mentionQueryRef.current = mentionQuery
  })

  // Floating Table Controls coordinates state
  const [activeTableRect, setActiveTableRect] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)

  const updateTableRect = () => {
    if (!editor || !editor.isFocused) {
      setActiveTableRect(null)
      return
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      setActiveTableRect(null)
      return
    }

    try {
      const range = selection.getRangeAt(0)
      const cell = range.startContainer.nodeType === 3
        ? range.startContainer.parentElement?.closest('td, th')
        : (range.startContainer as HTMLElement)?.closest?.('td, th')

      const table = cell?.closest('table')
      if (table) {
        const rect = table.getBoundingClientRect()
        setActiveTableRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        })
      } else {
        setActiveTableRect(null)
      }
    } catch (e) {
      setActiveTableRect(null)
    }
  }

  // Sync table selection & scroll updates
  useEffect(() => {
    if (!editor) return

    const handleUpdate = () => {
      updateTableRect()
    }

    const handleUpdateDelayed = () => {
      setTimeout(handleUpdate, 10)
    }

    editor.on('selectionUpdate', handleUpdateDelayed)
    editor.on('focus', handleUpdateDelayed)
    editor.on('blur', handleUpdateDelayed)

    window.addEventListener('scroll', handleUpdate, true)
    window.addEventListener('resize', handleUpdate)

    return () => {
      editor.off('selectionUpdate', handleUpdateDelayed)
      editor.off('focus', handleUpdateDelayed)
      editor.off('blur', handleUpdateDelayed)
      window.removeEventListener('scroll', handleUpdate, true)
      window.removeEventListener('resize', handleUpdate)
    }
  }, [editor])

  // Watch for text patterns (e.g. typing / or @)
  useEffect(() => {
    if (!editor) return

    const handleUpdate = () => {
      const { selection } = editor.state
      const textBeforeCursor = editor.state.doc.textBetween(
        Math.max(0, selection.from - 20),
        selection.from,
        '\n'
      )
      
      const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([a-zA-Z0-9]*)$/)
      const mentionMatch = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z0-9\s-]*)$/)

      if (slashMatch) {
        setCommandActive(true)
        setCommandQuery(slashMatch[1])
        setMentionActive(false)
        try {
          const coords = editor.view.coordsAtPos(selection.from)
          setCommandCoords({
            top: coords.bottom + 8,
            left: coords.left,
          })
        } catch (e) {}
      } else if (mentionMatch) {
        setMentionActive(true)
        setMentionQuery(mentionMatch[1])
        setCommandActive(false)
        try {
          const coords = editor.view.coordsAtPos(selection.from)
          setMentionCoords({
            top: coords.bottom + 8,
            left: coords.left,
          })
        } catch (e) {}
      } else {
        setCommandActive(false)
        setMentionActive(false)
      }
    }

    editor.on('selectionUpdate', handleUpdate)
    editor.on('update', handleUpdate)
    return () => {
      editor.off('selectionUpdate', handleUpdate)
      editor.off('update', handleUpdate)
    }
  }, [editor])


  // Track initial content updates (switching files or external non-focused updates)
  useEffect(() => {
    if (editor && initialContent !== undefined) {
      const fileChanged = lastFilePathRef.current !== filePath
      const contentChangedExternally = initialContent !== lastSavedContentRef.current

      if (fileChanged) {
        lastFilePathRef.current = filePath
        lastSavedContentRef.current = initialContent
        const html = getHTMLFromMarkdown(initialContent)
        editor.commands.setContent(html)
        setSaveStatus('saved')
      } else if (contentChangedExternally && !editor.isFocused) {
        lastSavedContentRef.current = initialContent
        const html = getHTMLFromMarkdown(initialContent)
        editor.commands.setContent(html)
        setSaveStatus('saved')
      }

      if (historyOpen && fileChanged) {
        fetchHistory()
      }
    }
  }, [initialContent, filePath, editor, historyOpen])

  // Fetch Version History snapshots
  const fetchHistory = async () => {
    setIsLoadingHistory(true)
    try {
      const res = await fetch(`${API_BASE}/api/file/history?path=${encodeURIComponent(filePath)}`)
      if (!res.ok) throw new Error('Failed to fetch history')
      const data = await res.json()
      setHistoryList(data || [])
    } catch (e) {
      console.error('Error fetching version history', e)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  // Toggle history panel
  useEffect(() => {
    if (historyOpen) {
      fetchHistory()
    }
  }, [historyOpen, filePath])

  // Auto-save debounce trigger
  const triggerAutoSave = () => {
    setSaveStatus('dirty')
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      executeAutoSave()
    }, 1500) // 1.5 seconds debounce
  }

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const executeAutoSave = async () => {
    if (!editor) return
    setSaveStatus('saving')
    const html = editor.getHTML()
    const markdown = turndownService.turndown(html)
    try {
      await onSave(markdown)
      lastSavedContentRef.current = markdown
      setSaveStatus('saved')
      if (historyOpen) {
        fetchHistory()
      }
    } catch (e) {
      console.error('Auto-save error', e)
      setSaveStatus('dirty')
    }
  }

  const handleRollback = async (timestamp: number) => {
    if (!confirm('Do you want to roll back the page to this version? Your current state will be saved as a backup snapshot.')) {
      return
    }
    setSaveStatus('saving')
    try {
      const res = await fetch(`${API_BASE}/api/file/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, timestamp }),
      })
      if (!res.ok) throw new Error('Failed to rollback')
      const data = await res.json()
      
      const html = getHTMLFromMarkdown(data.content)
      lastSavedContentRef.current = data.content
      editor.commands.setContent(html)
      setSaveStatus('saved')
      fetchHistory()
    } catch (e) {
      console.error('Rollback error', e)
      alert('Failed to rollback version.')
      setSaveStatus('dirty')
    }
  }

  const uploadImageAndInsert = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`${API_BASE}/api/upload?notePath=${encodeURIComponent(filePath)}`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      if (data.url && editor) {
        editor.chain().focus().setImage({ src: data.url }).run()
      }
    } catch (e) {
      console.error('Failed to upload pasted/dropped image', e)
      alert('Failed to upload image to assets directory.')
    }
  }

  const getRelativePath = (url: string) => {
    try {
      const parsed = new URL(url, window.location.origin)
      return parsed.pathname
    } catch (e) {
      return url.startsWith('/') ? url : '/' + url
    }
  }

  const handleImageSave = (newUrl: string) => {
    if (!editor) return

    const oldBaseUrl = getRelativePath(editingImageSrc || '').split('?')[0]
    const newRelativeUrl = getRelativePath(newUrl)
    
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') {
        const nodeBaseUrl = getRelativePath(node.attrs.src).split('?')[0]
        if (nodeBaseUrl === oldBaseUrl) {
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              src: newRelativeUrl,
            })
          )
        }
      }
    })

    // Trigger auto-save immediately to save modified markdown content
    executeAutoSave()
  }

  const handleInsertEmbed = () => {
    if (!editor) return

    if (embedType === 'url') {
      if (!embedUrl.trim()) {
        alert('Please enter a URL to embed.')
        return
      }
      
      let finalSrc = embedUrl.trim()
      
      // Auto-convert standard YouTube watch URLs to embed URLs
      if (finalSrc.includes('youtube.com/watch?v=')) {
        const videoId = finalSrc.split('v=')[1]?.split('&')[0]
        if (videoId) {
          finalSrc = `https://www.youtube.com/embed/${videoId}`
        }
      } else if (finalSrc.includes('youtu.be/')) {
        const videoId = finalSrc.split('youtu.be/')[1]?.split('?')[0]
        if (videoId) {
          finalSrc = `https://www.youtube.com/embed/${videoId}`
        }
      }

      editor.chain().focus().insertContent(`<iframe src="${finalSrc}"></iframe>`).run()
    } else {
      if (!selectedCanvasPath) {
        alert('Please select a canvas drawing to embed.')
        return
      }

      const selectedFile = files.find(f => f.path === selectedCanvasPath)
      const editorType = selectedFile?.frontMatter?.editor || 'excalidraw'

      if (editorType === 'drawio') {
        editor.chain().focus().insertContent(`<drawio path="${selectedCanvasPath}">drawio-canvas</drawio>`).run()
      } else {
        editor.chain().focus().insertContent(`<excalidraw path="${selectedCanvasPath}">excalidraw-canvas</excalidraw>`).run()
      }
    }

    setEmbedModalOpen(false)
    triggerAutoSave()
  }

  const getFilteredCommands = () => {
    const query = commandQuery.toLowerCase()
    return COMMANDS.filter(
      (cmd) => cmd.label.toLowerCase().includes(query) || cmd.search.toLowerCase().includes(query)
    )
  }

  const executeCommand = (cmdId: string) => {
    if (!editor) return

    const { selection } = editor.state
    const queryLength = commandQuery.length + 1

    editor.chain()
      .focus()
      .deleteRange({ from: selection.from - queryLength, to: selection.from })
      .run()

    switch (cmdId) {
      case 'h1':
        editor.chain().focus().toggleHeading({ level: 1 }).run()
        break
      case 'h2':
        editor.chain().focus().toggleHeading({ level: 2 }).run()
        break
      case 'h3':
        editor.chain().focus().toggleHeading({ level: 3 }).run()
        break
      case 'bullet':
        editor.chain().focus().toggleBulletList().run()
        break
      case 'number':
        editor.chain().focus().toggleOrderedList().run()
        break
      case 'task':
        editor.chain().focus().toggleTaskList().run()
        break
      case 'quote':
        editor.chain().focus().toggleBlockquote().run()
        break
      case 'callout':
        editor.chain().focus().insertContent('<blockquote><p>💡 <strong>Note:</strong> </p></blockquote>').run()
        break
      case 'table':
        editor.chain().focus().insertContent('<table><thead><tr><th>Header 1</th><th>Header 2</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>').run()
        break
      case 'code':
        editor.chain().focus().insertContent('<pre><code>\n// Code here\n</code></pre>').run()
        break
      case 'subpage': {
        // Derive the parent path from the current filePath:
        // Documents/Note.md → sub-pages go in Documents/Note/
        let parentPath = filePath
        if (parentPath.endsWith('/README.md')) {
          parentPath = parentPath.slice(0, -'/README.md'.length)
        } else if (parentPath.endsWith('.md')) {
          parentPath = parentPath.slice(0, -3)
        }
        onCreateSubPage?.(parentPath, (newFilePath: string, newTitle: string) => {
          editor.chain()
            .focus()
            .insertContent(`<a href="${newFilePath}">${newTitle}</a> `)
            .run()
          const html = editor.getHTML()
          const markdown = turndownService.turndown(html)
          return markdown
        })
        break
      }
      case 'embed': {
        setEmbedUrl('')
        setSelectedCanvasPath('')
        setEmbedType('url')
        setEmbedModalOpen(true)
        break
      }
    }
    setCommandActive(false)
  }

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'task':   return <CheckSquare size={13} className="text-amber-500 shrink-0" />
      case 'canvas': return <Brush size={13} className="text-emerald-400 shrink-0" />
      case 'board':  return <LayoutGrid size={13} className="text-violet-400 shrink-0" />
      default:       return <FileText size={13} className="text-blue-400 shrink-0" />
    }
  }

  const getFilteredMentions = () => {
    const query = mentionQuery.toLowerCase().trim()
    const otherFiles = files.filter(f => f.path !== filePath)
    if (!query) return otherFiles
    return otherFiles.filter(
      (f) =>
        f.title.toLowerCase().includes(query) ||
        f.path.toLowerCase().includes(query)
    )
  }

  const executeMention = (file: FileRecord) => {
    if (!editor) return

    const { selection } = editor.state
    const queryLength = mentionQuery.length + 1 // +1 for the '@'

    editor.chain()
      .focus()
      .deleteRange({ from: selection.from - queryLength, to: selection.from })
      .run()

    editor.chain()
      .focus()
      .insertContent(`<a href="${file.path}">${file.title || file.path.split('/').pop() || 'Untitled'}</a> `)
      .run()

    setMentionActive(false)
  }

  // Tags Array helper
  const getTagsArray = () => {
    if (!frontMatter || !frontMatter.tags) return []
    try {
      const parsed = typeof frontMatter.tags === 'string' ? JSON.parse(frontMatter.tags) : frontMatter.tags
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      return []
    }
  }

  const handleAddTagSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleanTag = newTagInput.trim()
    if (!cleanTag) return
    const currentTags = getTagsArray()
    if (!currentTags.includes(cleanTag)) {
      onUpdateFrontMatter?.({ tags: [...currentTags, cleanTag] })
    }
    setNewTagInput('')
  }

  const handleRemoveTag = (tagToRemove: string) => {
    const currentTags = getTagsArray()
    onUpdateFrontMatter?.({ tags: currentTags.filter((t) => t !== tagToRemove) })
  }

  if (!editor) {
    return (
      <div className="flex justify-center items-center h-64 text-slate-400">
        <Loader2 className="animate-spin mr-2" /> Loading Editor...
      </div>
    )
  }

  const filteredList = getFilteredCommands()
  const tags = getTagsArray()

  const getSaveStatusIndicator = () => {
    switch (saveStatus) {
      case 'saving':
        return (
          <span className="flex items-center gap-1 text-[10px] text-violet-400 font-medium">
            <Loader2 className="animate-spin" size={10} />
            Saving changes...
          </span>
        )
      case 'dirty':
        return (
          <span className="flex items-center gap-1 text-[10px] text-amber-500 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            Unsaved changes
          </span>
        )
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            ✓ Saved to disk
          </span>
        )
    }
  }

  return (
    <div className="flex h-full bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden shadow-2xl relative">
      {/* Editor Main Work Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Control Toolbar */}
        <div className="flex flex-wrap items-center justify-between p-3 border-b border-slate-800 bg-[#161b22]/80 backdrop-blur-md sticky top-0 z-10 select-none">
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                editor.isActive('bold') ? 'bg-violet-600/20 text-violet-400 font-bold border border-violet-500/30' : 'text-slate-400'
              }`}
              title="Bold"
            >
              <Bold size={16} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                editor.isActive('italic') ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'text-slate-400'
              }`}
              title="Italic"
            >
              <Italic size={16} />
            </button>

            <span className="w-px h-6 bg-slate-800 mx-1" />

            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                editor.isActive('heading', { level: 1 }) ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'text-slate-400'
              }`}
              title="Heading 1"
            >
              <Heading1 size={16} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                editor.isActive('heading', { level: 2 }) ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'text-slate-400'
              }`}
              title="Heading 2"
            >
              <Heading2 size={16} />
            </button>

            <span className="w-px h-6 bg-slate-800 mx-1" />

            <button
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              className={`p-2 rounded-lg hover:bg-slate-800 hover:text-white transition ${
                editor.isActive('taskList') ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'text-slate-400'
              }`}
              title="Task Checklist"
            >
              <CheckSquare size={16} />
            </button>
            <button
              onClick={() => editor.chain().focus().insertContent('<table><thead><tr><th>Header 1</th><th>Header 2</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr></tbody></table>').run()}
              className="p-2 rounded-lg hover:bg-slate-800 hover:text-white text-slate-400 transition"
              title="Insert Table"
            >
              <Grid size={16} />
            </button>

            <span className="w-px h-6 bg-slate-800 mx-1" />

            <button
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              className="p-2 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent text-slate-400 hover:text-white transition"
              title="Undo"
            >
              <Undo size={16} />
            </button>
            <button
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              className="p-2 rounded-lg hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent text-slate-400 hover:text-white transition"
              title="Redo"
            >
              <Redo size={16} />
            </button>
          </div>

          {/* Right Toolbar Actions */}
          <div className="flex items-center gap-3">
            {getSaveStatusIndicator()}

            <button
              onClick={cycleLayout}
              className={`p-2 rounded-lg hover:bg-slate-800 transition cursor-pointer flex items-center gap-1.5 ${
                layout !== 'left' ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'text-slate-400'
              }`}
              title={`Layout: ${layout === 'left' ? 'Left Aligned' : layout === 'center' ? 'Center Aligned' : 'Full Width'}`}
            >
              {layout === 'left' && <AlignLeft size={16} />}
              {layout === 'center' && <AlignCenter size={16} />}
              {layout === 'full' && <Maximize2 size={16} />}
              <span className="text-[9px] font-bold uppercase tracking-wider select-none text-slate-500">
                {layout}
              </span>
            </button>

            {layout !== 'full' && (
              <button
                onClick={cycleColumnWidth}
                className="p-2 rounded-lg hover:bg-slate-800 transition cursor-pointer flex items-center gap-1.5 text-slate-400 hover:text-white"
                title={`Margins: ${columnWidth === 'narrow' ? 'Large Margins (Narrow)' : columnWidth === 'normal' ? 'Normal Margins' : 'Small Margins (Wide)'}`}
              >
                <ArrowLeftRight size={16} />
                <span className="text-[9px] font-bold uppercase tracking-wider select-none text-slate-500">
                  {columnWidth}
                </span>
              </button>
            )}

            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              className={`p-2 rounded-lg hover:bg-slate-800 transition cursor-pointer ${
                historyOpen ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'text-slate-400'
              }`}
              title="Version History"
            >
              <History size={16} />
            </button>

            <button
              onClick={() => executeAutoSave()}
              disabled={saveStatus === 'saved' || isSaving}
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg shadow transition cursor-pointer"
            >
              <Save size={12} />
              Save Now
            </button>
          </div>
        </div>

        {/* Editor Body & Notion-Style Properties Panel */}
        <div className="flex-1 overflow-y-auto px-8 py-6 no-scrollbar flex flex-col">
          {/* File path breadcrumbs */}
          <div className="text-[10px] text-slate-500 font-mono mb-4 uppercase tracking-wider select-none">
            {filePath}
          </div>

          {/* Notion Page Properties Panel */}
          {frontMatter && onUpdateFrontMatter && (
            <div className={`mb-6 p-4 bg-[#161b22]/40 border border-slate-800/80 rounded-xl space-y-3.5 select-none transition-all duration-300 ${getWidthClass()}`}>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                <Activity size={10} className="text-violet-400" />
                Page Attributes
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* 1. Title Input (syncs back to front matter) */}
                <div className="flex items-center gap-3 group">
                  <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                    <Info size={12} />
                    Title
                  </span>
                  <input
                    type="text"
                    value={frontMatter.title || ''}
                    onChange={(e) => onUpdateFrontMatter({ title: e.target.value })}
                    className="flex-1 bg-transparent hover:bg-slate-800/40 focus:bg-slate-900 border border-transparent focus:border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none transition"
                  />
                </div>

                {/* 2. Status Select Lane */}
                <div className="flex items-center gap-3">
                  <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                    <CheckSquare size={12} />
                    Status
                  </span>
                  <select
                    value={frontMatter.status || ''}
                    onChange={(e) => onUpdateFrontMatter({ status: e.target.value })}
                    className="flex-1 bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded px-2.5 py-1 outline-none transition cursor-pointer"
                  >
                    <option value="">Unassigned (Document)</option>
                    {boardColumns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3. Priority Level */}
                <div className="flex items-center gap-3">
                  <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                    <AlertCircle size={12} />
                    Priority
                  </span>
                  <select
                    value={frontMatter.priority || 'Medium'}
                    onChange={(e) => onUpdateFrontMatter({ priority: e.target.value })}
                    className="flex-1 bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded px-2.5 py-1 outline-none transition cursor-pointer"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>

                {/* 4. Due Date Picker */}
                <div className="flex items-center gap-3">
                  <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                    <Calendar size={12} />
                    Due Date
                  </span>
                  <input
                    type="date"
                    value={frontMatter.dueDate || ''}
                    onChange={(e) => onUpdateFrontMatter({ dueDate: e.target.value })}
                    className="flex-1 bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded px-2.5 py-1 outline-none transition cursor-pointer"
                  />
                </div>

                {/* 5. Assignee */}
                <div className="flex items-center gap-3">
                  <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                    <User size={12} />
                    Assignee
                  </span>
                  <input
                    type="text"
                    value={frontMatter.assignee || ''}
                    placeholder="Assignee name..."
                    onChange={(e) => onUpdateFrontMatter({ assignee: e.target.value })}
                    className="flex-1 bg-transparent hover:bg-slate-800/40 focus:bg-slate-900 border border-transparent focus:border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none transition"
                  />
                </div>

                {/* 6. Document Type */}
                <div className="flex items-center gap-3">
                  <span className="w-20 text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                    <Hash size={12} />
                    Doc Type
                  </span>
                  <select
                    value={frontMatter.type || 'document'}
                    onChange={(e) => onUpdateFrontMatter({ type: e.target.value })}
                    className="flex-1 bg-slate-900/50 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded px-2.5 py-1 outline-none transition cursor-pointer"
                  >
                    <option value="document">document (Note Page)</option>
                    <option value="task">task (Kanban Lane Task)</option>
                    <option value="board">board (Dynamic Kanban Board)</option>
                  </select>
                </div>
              </div>

              {/* Tags Field (with badge list and new tags insert field) */}
              <div className="border-t border-slate-800/50 pt-3 flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
                  <Tag size={12} />
                  Tags
                </span>

                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 px-2 py-0.5 bg-violet-600/15 text-violet-400 border border-violet-500/20 text-[10px] rounded-md font-semibold"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-red-400 font-bold transition ml-0.5 cursor-pointer"
                        title="Remove tag"
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  <form onSubmit={handleAddTagSubmit} className="flex items-center gap-1 ml-1.5">
                    <input
                      type="text"
                      placeholder="Add tag..."
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      className="bg-slate-900 border border-slate-850 focus:border-slate-700 text-[10px] rounded px-2 py-0.5 outline-none text-slate-300 w-20 focus:w-28 transition-all"
                    />
                    <button
                      type="submit"
                      className="p-1 bg-slate-800 hover:bg-violet-600 rounded text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      <Plus size={10} />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* Document Content Block */}
          <div className={`flex-1 transition-all duration-300 ${getWidthClass()}`}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {/* Version History Sidebar Drawer */}
      {historyOpen && (
        <div className="w-80 border-l border-slate-800 bg-[#161b22]/70 backdrop-blur-md flex flex-col shrink-0 select-none animate-in slide-in-from-right duration-250">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-[#161b22]">
            <div className="flex items-center gap-2">
              <History size={16} className="text-violet-400" />
              <h3 className="font-bold text-sm text-slate-200">Version History</h3>
            </div>
            <button
              onClick={() => setHistoryOpen(false)}
              className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
            {isLoadingHistory ? (
              <div className="flex justify-center py-10 text-slate-500 text-xs">
                <Loader2 className="animate-spin mr-1.5" size={14} /> Loading versions...
              </div>
            ) : historyList.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs">
                No rollback versions recorded yet.<br />
                <span className="text-[10px] text-slate-600 mt-2 block">Versions are created automatically when changes are auto-saved.</span>
              </div>
            ) : (
              historyList.map((ver) => (
                <div
                  key={ver.timestamp}
                  className="p-3 bg-[#0d1117] border border-slate-800 rounded-lg hover:border-slate-700 transition flex flex-col justify-between"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold text-slate-300">{ver.date}</span>
                    <span className="text-[9px] font-mono text-slate-500">{(ver.size / 1024).toFixed(2)} KB</span>
                  </div>
                  <div className="mt-3.5 flex justify-end">
                    <button
                      onClick={() => handleRollback(ver.timestamp)}
                      className="flex items-center gap-1.5 px-3 py-1 bg-violet-600/10 hover:bg-violet-600 text-violet-400 hover:text-white border border-violet-500/20 rounded-md text-[10px] font-bold tracking-wide uppercase transition cursor-pointer"
                    >
                      <RotateCcw size={10} />
                      Rollback
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Floating Slash Command Popup Menu */}
      {commandActive && filteredList.length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: `${commandCoords.top}px`,
            left: `${commandCoords.left}px`,
            zIndex: 9999,
          }}
          className="w-64 max-h-72 overflow-y-auto bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 no-scrollbar select-none"
        >
          <div className="px-2.5 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
            Basic Blocks
          </div>
          {filteredList.map((cmd, i) => {
            const isSelected = i === selectedIndex
            return (
              <div
                key={cmd.id}
                onClick={() => executeCommand(cmd.id)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition ${
                  isSelected ? 'bg-violet-600/10 text-violet-400 border border-violet-500/20' : 'text-slate-300'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {cmd.id === 'table' ? (
                    <Grid size={14} className={isSelected ? 'text-violet-400' : 'text-slate-400'} />
                  ) : (
                    <Info size={14} className={isSelected ? 'text-violet-400' : 'text-slate-400'} />
                  )}
                </div>
                <div>
                  <div className="font-semibold text-xs leading-none mb-0.5">{cmd.label}</div>
                  <div className="text-[10px] text-slate-500 leading-tight">{cmd.desc}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Floating Mention Popup Menu */}
      {mentionActive && getFilteredMentions().length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: `${mentionCoords.top}px`,
            left: `${mentionCoords.left}px`,
            zIndex: 9999,
          }}
          className="w-80 max-h-72 overflow-y-auto bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 no-scrollbar select-none animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2.5 py-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800/40 mb-1">
            Link to Page
          </div>
          {getFilteredMentions().map((file, i) => {
            const isSelected = i === mentionSelectedIndex
            const icon = getFileIcon(file.type)
            return (
              <div
                key={file.path}
                onClick={() => executeMention(file)}
                onMouseEnter={() => setMentionSelectedIndex(i)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition ${
                  isSelected ? 'bg-violet-600/15 text-violet-300 border border-violet-500/20' : 'text-slate-300 hover:bg-slate-800/40'
                }`}
              >
                <div className="shrink-0">
                  {icon}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold truncate">{file.title || file.path.split('/').pop() || 'Untitled'}</span>
                  <span className="text-[9px] text-slate-500 font-mono truncate">{file.path}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {mentionActive && getFilteredMentions().length === 0 && (
        <div
          style={{
            position: 'fixed',
            top: `${mentionCoords.top}px`,
            left: `${mentionCoords.left}px`,
            zIndex: 9999,
          }}
          className="w-80 bg-[#161b22] border border-slate-700/80 rounded-xl shadow-2xl p-3 text-center text-slate-500 text-xs select-none"
        >
          No matching pages found
        </div>
      )}

      {editingImageSrc && (
        <ImageEditorModal
          src={getRelativePath(editingImageSrc)}
          notePath={filePath}
          apiBase={API_BASE}
          onClose={() => setEditingImageSrc(null)}
          onSave={handleImageSave}
        />
      )}

      {embedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm transition-opacity">
          <div className="bg-[#161b22] border border-slate-700/80 rounded-2xl shadow-2xl p-6 max-w-md w-full text-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-bold tracking-wide flex items-center gap-2">
                <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                Insert Rich Embed
              </h3>
              <button
                onClick={() => setEmbedModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Type selector tabs */}
            <div className="flex gap-2 p-1 bg-[#0d1117] rounded-xl mb-5 border border-slate-800/80">
              <button
                onClick={() => setEmbedType('url')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  embedType === 'url' ? 'bg-violet-600 text-white shadow-md' : 'text-slate-455 hover:text-slate-200'
                }`}
              >
                Website URL / Iframe
              </button>
              <button
                onClick={() => {
                  setEmbedType('drawio')
                  const canvasFiles = files.filter(f => f.type === 'canvas')
                  if (canvasFiles.length > 0 && !selectedCanvasPath) {
                    setSelectedCanvasPath(canvasFiles[0].path)
                  }
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  embedType === 'drawio' ? 'bg-violet-600 text-white shadow-md' : 'text-slate-455 hover:text-slate-200'
                }`}
              >
                Canvas Drawing
              </button>
            </div>

            {/* Content panel */}
            <div className="space-y-4 mb-6">
              {embedType === 'url' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-455 mb-1.5 uppercase tracking-wider">Embed Link / URL</label>
                  <input
                    type="text"
                    value={embedUrl}
                    onChange={(e) => setEmbedUrl(e.target.value)}
                    placeholder="e.g. https://youtube.com/watch?v=... or https://example.com"
                    className="w-full bg-[#0d1117] border border-slate-750 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500/80 focus:ring-1 focus:ring-violet-500/30 transition placeholder-slate-655"
                  />
                  <p className="text-[10px] text-slate-500 mt-1.5 font-medium">Supports regular websites, direct iframe src URLs, YouTube videos, and more.</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-455 mb-1.5 uppercase tracking-wider">Select Workspace Drawing</label>
                  {files.filter(f => f.type === 'canvas').length > 0 ? (
                    <select
                      value={selectedCanvasPath}
                      onChange={(e) => setSelectedCanvasPath(e.target.value)}
                      className="w-full bg-[#0d1117] border border-slate-750 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500/80 focus:ring-1 focus:ring-violet-500/30 transition cursor-pointer"
                    >
                      {files.filter(f => f.type === 'canvas').map(f => (
                        <option key={f.path} value={f.path}>
                          {f.title || f.path.split('/').pop()} ({f.frontMatter?.editor === 'drawio' ? 'Draw.io' : 'Excalidraw'})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-center py-4 bg-[#0d1117] border border-slate-800 rounded-xl select-none">
                      <p className="text-xs text-slate-500 font-medium">No canvas drawings found in the vault.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Create an Excalidraw or Draw.io canvas page from the sidebar menu first.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 select-none">
              <button
                onClick={() => setEmbedModalOpen(false)}
                className="px-4 py-2 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleInsertEmbed}
                disabled={embedType === 'drawio' && files.filter(f => f.type === 'canvas').length === 0}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-550 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition shadow-lg cursor-pointer"
              >
                Insert Embed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Link Paste Option Picker */}
      {pasteInfo && (
        <div
          id="link-paste-popup"
          style={{
            position: 'fixed',
            top: `${pasteInfo.y}px`,
            left: `${pasteInfo.x}px`,
            zIndex: 9999,
          }}
          className="bg-[#1e2330] border border-slate-700/80 rounded-xl shadow-2xl p-1 px-1.5 text-xs text-slate-200 select-none animate-in fade-in zoom-in-95 duration-100 flex flex-col space-y-0.5"
        >
          <div className="px-2 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800 mb-1 truncate max-w-[200px]">
            {pasteInfo.url}
          </div>
          <button
            onClick={() => setPasteInfo(null)}
            className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-350 hover:text-slate-100 text-left cursor-pointer transition-colors w-full group"
          >
            <Link2 size={13} className="text-violet-400 shrink-0" />
            <div className="flex flex-col">
              <span className="font-semibold text-[11px] leading-tight">Inline Link</span>
              <span className="text-[9px] text-slate-550">Keep standard hyperlink</span>
            </div>
          </button>
          <button
            onClick={() => handleToastConvert('bookmark')}
            className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-350 hover:text-slate-100 text-left cursor-pointer transition-colors w-full group"
          >
            <BookMarked size={13} className="text-emerald-400 shrink-0" />
            <div className="flex flex-col">
              <span className="font-semibold text-[11px] leading-tight">Bookmark Card</span>
              <span className="text-[9px] text-slate-550">Create rich preview card</span>
            </div>
          </button>
          <button
            onClick={() => handleToastConvert('embed')}
            className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-350 hover:text-slate-100 text-left cursor-pointer transition-colors w-full group"
          >
            <MonitorPlay size={13} className="text-amber-400 shrink-0" />
            <div className="flex flex-col">
              <span className="font-semibold text-[11px] leading-tight">Embed</span>
              <span className="text-[9px] text-slate-550">Insert interactive iframe</span>
            </div>
          </button>
        </div>
      )}
      {/* Floating Table Add Row/Col Hover Overlays */}
      {activeTableRect && (
        <>
          {/* Row "+" button below the table */}
          <button
            onMouseDown={(e) => {
              // preventDefault keeps editor focus + selection intact before command runs
              e.preventDefault()
              e.stopPropagation()
              editor.chain().addRowAfter().run()
            }}
            title="Add Row"
            style={{
              position: 'fixed',
              top: `${activeTableRect.top + activeTableRect.height + 6}px`,
              left: `${activeTableRect.left + activeTableRect.width / 2 - 12}px`,
              zIndex: 9999,
            }}
            className="bg-[#1e2330] hover:bg-violet-600 border border-slate-700 hover:border-violet-500 text-slate-400 hover:text-white rounded-full w-6 h-6 shadow-2xl transition cursor-pointer flex items-center justify-center"
          >
            <Plus size={12} />
          </button>

          {/* Column "+" button to the right of the table */}
          <button
            onMouseDown={(e) => {
              // preventDefault keeps editor focus + selection intact before command runs
              e.preventDefault()
              e.stopPropagation()
              editor.chain().addColumnAfter().run()
            }}
            title="Add Column"
            style={{
              position: 'fixed',
              top: `${activeTableRect.top + activeTableRect.height / 2 - 12}px`,
              left: `${activeTableRect.left + activeTableRect.width + 6}px`,
              zIndex: 9999,
            }}
            className="bg-[#1e2330] hover:bg-violet-600 border border-slate-700 hover:border-violet-500 text-slate-400 hover:text-white rounded-full w-6 h-6 shadow-2xl transition cursor-pointer flex items-center justify-center"
          >
            <Plus size={12} />
          </button>
        </>
      )}
    </div>
  )
}
export default Editor
