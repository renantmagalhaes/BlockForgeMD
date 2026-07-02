import React, { useState, useEffect, useRef } from 'react'
import {
  FileText,
  CheckSquare,
  LayoutGrid,
  Trash2,
  Brush,
  ChevronRight,
  ChevronDown,
  CloudLightning,
  AlertCircle,
  FilePlus,
  Layers,
  ArrowRight,
  Plus,
  X,
  Grid,
  Settings,
  Search,
  History as HistoryIcon
} from 'lucide-react'
import Editor from './components/Editor'
import Kanban from './components/Kanban'
import Canvas from './components/Canvas'
import Diagram from './components/Diagram'

interface TreeNode {
  name: string
  path: string
  isFolder: boolean
  children: TreeNode[]
  hasPage?: boolean
  filePath?: string
  type?: string
  title?: string
  frontMatter?: Record<string, string>
}

// ─── buildTree ───────────────────────────────────────────────────────────────
// Notion-style: every page can have sub-pages.
// A file at Documents/Note.md can have children at Documents/Note/SubNote.md.
// No README.md folders — the parent page IS the node.
const buildTree = (files: FileRecord[]): TreeNode[] => {
  const root: TreeNode = { name: 'Root', path: '', isFolder: true, children: [] }

  const nodeMap = new Map<string, {
    filePath: string
    title: string
    type: string
    frontMatter?: Record<string, string>
  }>()

  const hasChildren = (basePath: string) =>
    files.some(f => f.path !== basePath && f.path.startsWith(basePath + '/'))

  // Pass 1: determine node entries
  files.forEach((file) => {
    // Legacy README.md support
    if (file.path.endsWith('/README.md')) {
      const dir = file.path.slice(0, -'/README.md'.length)
      nodeMap.set(dir, { filePath: file.path, title: file.title, type: file.type, frontMatter: file.frontMatter })
      return
    }

    const stem = file.path.endsWith('.md') ? file.path.slice(0, -3) : file.path
    nodeMap.set(
      hasChildren(stem) ? stem : file.path,
      { filePath: file.path, title: file.title, type: file.type, frontMatter: file.frontMatter }
    )
  })

  // Pass 2: insert into tree
  nodeMap.forEach((meta, nodePath) => {
    const parts = nodePath.split('/')
    let current = root

    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      let child = current.children.find((c) => c.path === currentPath)
      if (!child) {
        child = { name: part, path: currentPath, isFolder: false, children: [] }
        current.children.push(child)
      }

      if (isLast) {
        child.hasPage = true
        child.filePath = meta.filePath
        child.title = meta.title
        child.type = meta.type
        child.frontMatter = meta.frontMatter
        child.isFolder = child.isFolder || files.some(f => {
          const stem = f.path.endsWith('.md') ? f.path.slice(0, -3) : f.path
          return stem.startsWith(currentPath + '/')
        })
      } else {
        child.isFolder = true
      }

      current = child
    })
  })

  // Pass 3: ensure intermediate dirs appear
  files.forEach(file => {
    const parts = file.path.split('/')
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        const parentPath = parts.slice(0, i).join('/')
        const parentParts = parentPath.split('/')
        let cur = root
        parentParts.forEach((part, pi) => {
          const cp = parentParts.slice(0, pi + 1).join('/')
          let ch = cur.children.find(c => c.path === cp)
          if (!ch) {
            ch = { name: part, path: cp, isFolder: true, children: [] }
            cur.children.push(ch)
          } else {
            ch.isFolder = true
          }
          cur = ch
        })
      }
    }
  })

  const sortTree = (nodes: TreeNode[], isRoot = false) => {
    nodes.sort((a, b) => {
      if (isRoot) {
        const order = ['Documents', 'Tasks', 'Canvas']
        const ia = order.indexOf(a.name)
        const ib = order.indexOf(b.name)
        if (ia !== -1 && ib !== -1) return ia - ib
        if (ia !== -1) return -1
        if (ib !== -1) return 1
      }
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      return (a.title || a.name).localeCompare(b.title || b.name)
    })
    nodes.forEach(n => { if (n.children.length > 0) sortTree(n.children) })
  }

  sortTree(root.children, true)
  return root.children
}

// Given a node, return the directory where new sub-items should be placed.
// For any page with a filePath, sub-items go INSIDE that page (under its stem).
// e.g. Documents/Note.md  → Documents/Note
//      Documents/NoteA    → Documents/NoteA  (parent page, path is already the stem)
//      Documents/MyFolder/README.md → Documents/MyFolder (legacy)
// For section roots (Documents, Tasks, Canvas) with no filePath → use node.path.
const getNodeParentPath = (node: TreeNode): string => {
  if (!node.filePath) return node.path  // section root: Documents, Tasks, Canvas
  if (node.filePath.endsWith('/README.md')) {
    return node.filePath.slice(0, -'/README.md'.length)  // legacy folder
  }
  const stem = node.filePath.endsWith('.md') ? node.filePath.slice(0, -3) : node.filePath
  return stem  // sub-pages nest under the page's own stem directory
}

// Compute parent path when creating from the right-click context menu.
// Right-clicking any page → new item goes INSIDE that page (sub-page).
const getContextParentPath = (path: string | null): string | undefined => {
  if (!path) return undefined
  if (path.endsWith('/README.md')) return path.slice(0, -'/README.md'.length)  // legacy folder
  // For section roots (no slash at all: Documents, Tasks, Canvas)
  if (!path.includes('/')) return path
  // For any page: new item goes under its stem
  const stem = path.endsWith('.md') ? path.slice(0, -3) : path
  return stem
}

// ─── TreeNodeComponent ───────────────────────────────────────────────────────
const TreeNodeComponent: React.FC<{
  node: TreeNode
  depth: number
  selectedPath: string | null
  collapsedPaths: Record<string, boolean>
  onToggleCollapse: (path: string) => void
  onSelectFile: (path: string) => void
  onCreateSubPage: (parentPath: string) => void
  onDeletePath: (path: string) => void
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void
}> = ({
  node,
  depth,
  selectedPath,
  collapsedPaths,
  onToggleCollapse,
  onSelectFile,
  onCreateSubPage,
  onDeletePath,
  onContextMenu,
}) => {
  const getIsCollapsed = () => {
    if (collapsedPaths[node.path] !== undefined) return collapsedPaths[node.path]
    if (node.path === 'Documents') return false
    return true
  }

  const isCollapsed = getIsCollapsed()
  const isSelected = selectedPath && node.hasPage && node.filePath === selectedPath

  const handleRowClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.hasPage && node.filePath) {
      onSelectFile(node.filePath)
      // If this page also has children, expand it so the tree is visible
      if (node.isFolder) {
        onToggleCollapse(node.path)
      }
    } else if (node.isFolder) {
      onToggleCollapse(node.path)
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleCollapse(node.path)
  }

  const handleAddClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onCreateSubPage(getNodeParentPath(node) || node.path)
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDeletePath(node.filePath || node.path)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node)
  }

  const getIcon = () => {
    switch (node.type) {
      case 'task':   return <CheckSquare size={13} className="text-amber-500 shrink-0" />
      case 'canvas': return <Brush size={13} className="text-emerald-400 shrink-0" />
      case 'board':  return <LayoutGrid size={13} className="text-violet-400 shrink-0" />
      default:       return <FileText size={13} className="text-blue-400 shrink-0" />
    }
  }

  return (
    <div className="flex flex-col select-none">
      <div
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: `${depth * 8 + 6}px` }}
        className={`flex items-center justify-between group py-1 px-2 rounded-lg text-xs transition cursor-pointer hover:bg-slate-800/40 ${
          isSelected ? 'bg-slate-800 text-violet-400 font-semibold border border-slate-700/50' : 'text-slate-300'
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {node.isFolder ? (
            <span
              onClick={handleChevronClick}
              className="text-slate-500 hover:text-slate-200 p-0.5 hover:bg-slate-700/50 rounded transition shrink-0"
            >
              {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            </span>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {getIcon()}
          <span className="truncate">{node.title || node.name}</span>
        </div>

        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 ml-1">
          <button
            onClick={handleAddClick}
            className="p-0.5 hover:bg-slate-700 hover:text-white rounded text-slate-500 transition cursor-pointer"
            title="Add Sub-page"
          >
            <Plus size={10} />
          </button>
          <button
            onClick={handleDeleteClick}
            className="p-0.5 hover:bg-red-900/50 hover:text-red-400 rounded text-slate-500 transition cursor-pointer"
            title="Delete"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {node.isFolder && !isCollapsed && node.children && (
        <div className="flex flex-col mt-0.5 border-l border-slate-800/60 ml-2.5 space-y-0.5">
          {node.children.map((child) => (
            <TreeNodeComponent
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              collapsedPaths={collapsedPaths}
              onToggleCollapse={onToggleCollapse}
              onSelectFile={onSelectFile}
              onCreateSubPage={onCreateSubPage}
              onDeletePath={onDeletePath}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── FileRecord ───────────────────────────────────────────────────────────────
interface FileRecord {
  path: string
  title: string
  type: string
  contentHash: string
  updatedAt: string
  content?: string
  frontMatter?: Record<string, string>
}

const splitFrontMatter = (content: string) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (match) {
    return { frontMatterStr: match[1], body: match[2].replace(/^\r?\n+/, '') }
  }
  return { frontMatterStr: '', body: content }
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

const getSearchSnippet = (content: string, query: string) => {
  if (!content || !query) return ''
  const index = content.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) {
    const cleanContent = content.replace(/^---[\s\S]*?---/, '').trim().replace(/\s+/g, ' ')
    return cleanContent.slice(0, 70) + (cleanContent.length > 70 ? '...' : '')
  }
  const start = Math.max(0, index - 35)
  const end = Math.min(content.length, index + query.length + 35)
  let snippet = content.slice(start, end).replace(/\s+/g, ' ')
  if (start > 0) snippet = '...' + snippet
  if (end < content.length) snippet = snippet + '...'
  return snippet
}

// ─── App ──────────────────────────────────────────────────────────────────────
export const App: React.FC = () => {
  const [files, setFiles] = useState<FileRecord[]>([])
  const [activeView, setActiveView] = useState<'board' | 'editor'>('board')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string>('')
  const [currentFrontMatterStr, setCurrentFrontMatterStr] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [isSyncing, setIsSyncing] = useState(true)
  const [syncError, setSyncError] = useState(false)
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({})
  const [defaultColumns, setDefaultColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('blockforge_default_columns')
    return saved ? JSON.parse(saved) : ['Todo', 'In Progress', 'Done']
  })

  const subpageCallbackRef = useRef<((newPath: string, title: string) => string) | null>(null)

  const [createModal, setCreateModal] = useState<{
    isOpen: boolean
    type: 'document' | 'task' | 'canvas' | 'board' | 'diagram' | null
    parentPath?: string
  }>({ isOpen: false, type: null })
  const [createNameInput, setCreateNameInput] = useState('')

  const [adminModalOpen, setAdminModalOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'editor' | 'history' | 'cache' | 'about'>('editor')
  const [globalLayoutOverride, setGlobalLayoutOverride] = useState<string>(() => {
    return localStorage.getItem('blockforge_global_layout_override') || 'per-page'
  })
  const [globalColumnWidthOverride, setGlobalColumnWidthOverride] = useState<string>(() => {
    return localStorage.getItem('blockforge_global_column_width_override') || 'per-page'
  })
  const [historyLimitInput, setHistoryLimitInput] = useState('50')
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean; x: number; y: number; path: string | null; isFolder: boolean
  }>({ isOpen: false, x: 0, y: 0, path: null, isFolder: false })

  // Search & Command Palette States
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileRecord[]>([])
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0)
  const [isSearching, setIsSearching] = useState(false)
  const [activeSearchHighlight, setActiveSearchHighlight] = useState<string | null>(null)

  const fetchFiles = async () => {
    try {
      setSyncError(false)
      const res = await fetch(`${API_BASE}/api/files`)
      if (!res.ok) throw new Error('Failed to fetch files')
      setFiles((await res.json()) || [])
    } catch (e) {
      console.error('Error fetching files', e)
      setSyncError(true)
    } finally {
      setIsSyncing(false)
    }
  }

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`)
      if (res.ok) {
        const data = await res.json()
        if (data && typeof data.history_limit === 'number') {
          setHistoryLimitInput(data.history_limit.toString())
        }
      }
    } catch (e) {
      console.error('Failed to fetch settings', e)
    }
  }

  const handleSaveHistoryLimit = async (limit: number) => {
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history_limit: limit }),
      })
    } catch (e) {
      console.error('Failed to save settings', e)
    }
  }

  const fetchFileContent = async (path: string, skipHistory = false, highlightTerm: string | null = null) => {
    setActiveSearchHighlight(highlightTerm)
    try {
      const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error('Failed to fetch file content')
      const data = await res.json()
      const { frontMatterStr, body } = splitFrontMatter(data.content)
      setSelectedContent(body)
      setCurrentFrontMatterStr(frontMatterStr)
      setSelectedPath(path)
      setActiveView(data.meta?.type === 'board' ? 'board' : 'editor')
      // Sync URL hash so the file can be restored on refresh or shared
      if (!skipHistory) {
        const hash = '#/' + encodeURIComponent(path)
        if (window.location.hash !== hash) {
          window.history.pushState({ filePath: path }, '', hash)
        }
      }
    } catch (e) {
      console.error('Error loading file content', e)
    }
  }

  useEffect(() => {
    fetchFiles()
    fetchSettings()
    const es = new EventSource(`${API_BASE}/api/sync/events`)
    es.addEventListener('file_update', (e: any) => {
      fetchFiles()
      if (selectedPath && selectedPath === e.data && !isSaving) fetchFileContent(selectedPath)
    })
    es.onerror = () => setSyncError(true)
    es.onopen = () => setSyncError(false)
    return () => es.close()
  }, [selectedPath, isSaving])

  // Restore file from URL hash on initial page load
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#/')) {
      const path = decodeURIComponent(hash.slice(2))
      if (path) fetchFileContent(path, true) // true = don't push again to history
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle browser back / forward navigation
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const path = e.state?.filePath
      if (path) {
        fetchFileContent(path, true)
      } else {
        // Hash is now empty — return to the welcome/home view
        const hash = window.location.hash
        if (!hash || hash === '#' || hash === '#/') {
          setSelectedPath(null)
          setSelectedContent('')
          setCurrentFrontMatterStr('')
        } else if (hash.startsWith('#/')) {
          fetchFileContent(decodeURIComponent(hash.slice(2)), true)
        }
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for Ctrl+K / Cmd+K to toggle Search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Fetch search results from backend when query changes
  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery('')
      setSearchResults([])
      return
    }

    if (!searchQuery.trim()) {
      setSearchResults([])
      setSearchSelectedIndex(0)
      return
    }

    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data || [])
          setSearchSelectedIndex(0)
        }
      } catch (e) {
        console.error('Search query failed', e)
      } finally {
        setIsSearching(false)
      }
    }, 150)

    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery, searchOpen])

  useEffect(() => {
    const close = () => setContextMenu(p => p.isOpen ? { ...p, isOpen: false } : p)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const handleSaveFile = async (content: string) => {
    if (!selectedPath) return
    setIsSaving(true)
    const full = currentFrontMatterStr ? `---\n${currentFrontMatterStr}\n---\n\n${content}` : content
    try {
      const res = await fetch(`${API_BASE}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, content: full }),
      })
      if (!res.ok) throw new Error('Failed to save file')
      setSelectedContent(content)
      fetchFiles()
    } catch (e) {
      console.error('Error saving file', e)
      alert('Failed to save file changes to disk.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleMoveCard = async (path: string, newStatus: string) => {
    try {
      await fetch(`${API_BASE}/api/file/front-matter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, updates: { status: newStatus } }),
      })
      fetchFiles()
    } catch (e) { console.error('Error moving Kanban card', e) }
  }

  const handleUpdateFrontMatter = async (path: string, updates: Record<string, any>) => {
    try {
      await fetch(`${API_BASE}/api/file/front-matter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, updates }),
      })
      fetchFiles()
    } catch (e) { console.error('Error updating front matter', e) }
  }

  const handleCreateTaskWithStatus = async (title: string, status: string) => {
    const sanitizedName = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
    if (!sanitizedName) return
    const path = `Tasks/${sanitizedName}.md`
    const content = `---\ntitle: ${title}\ntype: task\nstatus: ${status}\npriority: Medium\ndueDate: ${new Date().toISOString().split('T')[0]}\nassignee: Unassigned\ntags: []\n---\n\n# ${title}\n\nTask created directly from Kanban Board.\n`
    try {
      await fetch(`${API_BASE}/api/file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content }) })
      fetchFiles()
    } catch (e) { console.error('Error creating task', e) }
  }

  const handleUpdateBoardColumns = async (path: string, newColumns: string[]) => {
    try {
      await fetch(`${API_BASE}/api/file/front-matter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, updates: { columns: newColumns } }),
      })
      fetchFiles()
    } catch (e) { console.error('Error updating board columns', e) }
  }

  const handleCreateFile = (
    type: 'document' | 'task' | 'canvas' | 'board' | 'diagram' | null,
    parentPath?: string,
    onCreated?: (newPath: string, title: string) => string
  ) => {
    subpageCallbackRef.current = onCreated || null
    setCreateModal({ isOpen: true, type, parentPath })
    setCreateNameInput('')
  }

  const handleCreateConfirm = async () => {
    const { type, parentPath } = createModal
    if (!type) return
    const title = createNameInput.trim()
    if (!title) return
    const name = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
    if (!name) return

    let path = ''
    let content = ''

    if (type === 'diagram') {
      path = parentPath ? `${parentPath}/${name}.drawio.md` : `Canvas/${name}.drawio.md`
      content = `---\ntitle: ${title}\ntype: canvas\neditor: drawio\n---\n\n# Draw.io Diagram\nBelow is the embedded diagram layout in XML.\n\n\`\`\`xml\n<mxfile host="app.diagrams.net"><diagram id="1" name="Page-1"><mxGraphModel dx="1000" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel></diagram></mxfile>\n\`\`\`\n`
    } else if (type === 'board') {
      path = parentPath ? `${parentPath}/${name}.board.md` : `Documents/${name}.board.md`
      content = `---\ntitle: ${title}\ntype: board\ncolumns: ["Todo", "In Progress", "Done"]\n---\n\n# ${title} Kanban Board\n\nCustomizable Kanban layout.\n`
    } else if (type === 'task') {
      path = parentPath ? `${parentPath}/${name}.md` : `Tasks/${name}.md`
      content = `---\ntitle: ${title}\ntype: task\nstatus: Todo\npriority: Medium\ndueDate: ${new Date().toISOString().split('T')[0]}\nassignee: Unassigned\ntags: []\n---\n\n# ${title}\n\nDescribe the task details here.\n`
    } else if (type === 'canvas') {
      path = parentPath ? `${parentPath}/${name}.excalidraw.md` : `Canvas/${name}.excalidraw.md`
      content = `---\ntitle: ${title}\ntype: canvas\neditor: excalidraw\n---\n\n# Drawing Canvas\nBelow is the embedded drawing data.\n\n\`\`\`json\n{\n  "type": "excalidraw",\n  "version": 2,\n  "elements": [],\n  "appState": {"viewBackgroundColor": "#121212","theme": "dark"}\n}\n\`\`\`\n`
    } else {
      path = parentPath ? `${parentPath}/${name}.md` : `Documents/${name}.md`
      content = `---\ntitle: ${title}\ntype: document\n---\n\n# ${title}\n\nStart writing note content here.\n`
    }

    try {
      const res = await fetch(`${API_BASE}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      })
      if (!res.ok) throw new Error('Failed to create file')

      // Save parent link first if subpage was created via editor command
      if (subpageCallbackRef.current && selectedPath) {
        const callback = subpageCallbackRef.current
        subpageCallbackRef.current = null
        const parentNewContent = callback(path, title)
        const saveRes = await fetch(`${API_BASE}/api/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: selectedPath, content: parentNewContent }),
        })
        if (!saveRes.ok) console.warn('Failed to auto-save parent file with subpage link')
      }

      setCreateModal({ isOpen: false, type: null })
      setCreateNameInput('')
      fetchFiles()
      fetchFileContent(path)
    } catch (e) {
      console.error('Error creating file', e)
      alert('Failed to create item.')
    }
  }

  const handleDeleteFile = async (path: string) => {
    if (!confirm('Are you sure you want to delete this file permanently from disk?')) return
    try {
      const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete file')
      fetchFiles()
      if (selectedPath === path) {
        setSelectedPath(null)
        setSelectedContent('')
        setCurrentFrontMatterStr('')
        setActiveView('board')
        // Clear hash so refresh doesn't attempt to reload a deleted file
        window.history.replaceState(null, '', window.location.pathname)
      }
    } catch (e) { console.error('Error deleting file', e) }
  }

  const activeFile = files.find((f) => f.path === selectedPath)

  const COMMAND_ITEMS = [
    { id: 'create-doc',     label: 'Create New Document',          icon: <FilePlus size={14} className="text-blue-400" />,    action: () => handleCreateFile('document') },
    { id: 'create-board',   label: 'Create New Kanban Board',      icon: <LayoutGrid size={14} className="text-rose-400" />,  action: () => handleCreateFile('board') },
    { id: 'create-canvas',  label: 'Create New Excalidraw Canvas',  icon: <Brush size={14} className="text-emerald-400" />,       action: () => handleCreateFile('canvas') },
    { id: 'create-diagram', label: 'Create New Draw.io Diagram',   icon: <Grid size={14} className="text-violet-400" />,        action: () => handleCreateFile('diagram') },
    { id: 'create-folder',  label: 'Create New Folder',            icon: <Plus size={14} className="text-slate-400" />,        action: () => handleCreateFile(null) },
    { id: 'goto-kanban',    label: 'Go to Kanban Board Dashboard', icon: <LayoutGrid size={14} className="text-slate-400" />,  action: () => { setActiveView('board'); setSelectedPath(null) } },
    { id: 'open-settings',  label: 'Open Settings',                icon: <Settings size={14} className="text-slate-400" />,    action: () => setAdminModalOpen(true) },
  ]

  return (
    <div className="flex h-screen bg-[#0d1117] text-slate-100 font-sans overflow-hidden app-layout-root">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className="w-64 bg-[#161b22] border-r border-slate-800 flex flex-col justify-between no-print">
        <div>
          <div className="p-5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-violet-600 to-blue-500 flex items-center justify-center font-bold text-white shadow-lg">BF</div>
              <div>
                <h1 className="font-bold text-sm tracking-tight">BlockForgeMD</h1>
                <span className="text-[10px] text-slate-500 font-mono">Local-First Vault</span>
              </div>
            </div>
          </div>

          <div className="px-3 pt-3 pb-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center justify-between px-3 py-1.5 bg-[#0d1117] border border-slate-800 hover:border-slate-700 rounded-lg text-xs transition text-slate-400 hover:text-slate-200 cursor-pointer select-none"
            >
              <div className="flex items-center gap-2">
                <Search size={14} className="text-slate-500" />
                <span>Search...</span>
              </div>
              <span className="text-[9px] bg-[#161b22] px-1 py-0.5 rounded font-mono border border-slate-800 text-slate-500">Ctrl+K</span>
            </button>
          </div>

          <div className="p-3">
            <button
              onClick={() => { setActiveView('board'); setSelectedPath(null) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition font-medium cursor-pointer ${
                activeView === 'board' && !selectedPath
                  ? 'bg-violet-600/10 text-violet-400 border border-violet-500/20'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <LayoutGrid size={16} />
              <span>Kanban Board</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 max-h-[calc(100vh-280px)] no-scrollbar">
            <div className="px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider flex justify-between items-center">
              <span>Workspace Explorer</span>
              <button
                onClick={() => handleCreateFile('document')}
                className="hover:text-white text-slate-500 transition cursor-pointer"
                title="New Document"
              >
                <FilePlus size={12} className="inline mr-1" />
              </button>
            </div>
            <div className="mt-1 space-y-0.5">
              {buildTree(files).map((node) => (
                <TreeNodeComponent
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={selectedPath}
                  collapsedPaths={collapsedPaths}
                  onToggleCollapse={(path) => setCollapsedPaths((prev) => ({ ...prev, [path]: !prev[path] }))}
                  onSelectFile={fetchFileContent}
                  onCreateSubPage={(parentPath) => handleCreateFile(null, parentPath)}
                  onDeletePath={handleDeleteFile}
                  onContextMenu={(e, targetNode) => {
                    setContextMenu({
                      isOpen: true,
                      x: e.clientX,
                      y: e.clientY,
                      path: targetNode.filePath || targetNode.path,
                      isFolder: targetNode.isFolder,
                    })
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-[#161b22]/50 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { type: 'document' as const, label: 'Doc',    icon: <FilePlus    size={16} className="text-blue-400 mb-1"    /> },
              { type: 'task'     as const, label: 'Task',   icon: <CheckSquare size={16} className="text-amber-500 mb-1"   /> },
              { type: 'canvas'   as const, label: 'Canvas', icon: <Brush       size={16} className="text-emerald-400 mb-1" /> },
            ].map(({ type, label, icon }) => (
              <button
                key={type}
                onClick={() => handleCreateFile(type)}
                className="flex flex-col items-center justify-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition text-[10px] font-semibold cursor-pointer"
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between text-[10px] border-t border-slate-800/60 pt-3">
            <button
              onClick={() => setAdminModalOpen(true)}
              className="flex items-center gap-1.5 text-slate-500 hover:text-violet-400 transition cursor-pointer select-none"
            >
              <Settings size={10} />
              <span>Settings</span>
            </button>
            {isSyncing ? (
              <span className="text-amber-500 animate-pulse">Syncing...</span>
            ) : syncError ? (
              <span className="text-red-400 flex items-center gap-0.5"><AlertCircle size={8} /> Offline</span>
            ) : (
              <span className="text-emerald-500 flex items-center gap-0.5"><CloudLightning size={8} /> Live Synced</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Panel ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0d1117]">
        {activeView === 'board' ? (
          <div className="flex-1 p-6 overflow-hidden">
            <Kanban
              files={files}
              onMoveCard={handleMoveCard}
              onSelectFile={fetchFileContent}
              onCreateTaskInColumn={handleCreateTaskWithStatus}
              boardPath={selectedPath && activeFile?.type === 'board' ? selectedPath : null}
              boardColumns={
                selectedPath && activeFile?.type === 'board' && activeFile?.frontMatter?.columns
                  ? JSON.parse(activeFile.frontMatter.columns)
                  : defaultColumns
              }
              onUpdateColumns={
                selectedPath && activeFile?.type === 'board'
                  ? (newCols) => handleUpdateBoardColumns(selectedPath, newCols)
                  : async (newCols) => { setDefaultColumns(newCols); localStorage.setItem('blockforge_default_columns', JSON.stringify(newCols)) }
              }
            />
          </div>
        ) : selectedPath && activeFile ? (
          <div className="flex-1 p-6 flex flex-col overflow-hidden main-content-pane">
            <div className="flex justify-between items-center mb-4 no-print">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <button onClick={() => setActiveView('board')} className="hover:text-violet-400 hover:underline transition">Workspace</button>
                <ChevronRight size={12} />
                <span className="font-mono text-slate-500">{selectedPath}</span>
              </div>
              <button
                onClick={() => handleDeleteFile(selectedPath)}
                className="flex items-center gap-1 px-3 py-1 hover:bg-red-500/10 text-slate-500 hover:text-red-400 border border-transparent hover:border-red-500/20 text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              {activeFile.type === 'canvas' && activeFile.frontMatter?.editor === 'drawio' ? (
                <Diagram filePath={selectedPath} initialContent={selectedContent} onSave={handleSaveFile} isSaving={isSaving} />
              ) : activeFile.type === 'canvas' ? (
                <Canvas filePath={selectedPath} initialContent={selectedContent} onSave={handleSaveFile} isSaving={isSaving} />
              ) : (
                <Editor
                  filePath={selectedPath}
                  initialContent={selectedContent}
                  onSave={handleSaveFile}
                  isSaving={isSaving}
                  frontMatter={activeFile?.frontMatter}
                  onUpdateFrontMatter={(updates) => handleUpdateFrontMatter(selectedPath, updates)}
                  boardColumns={defaultColumns}
                  onCreateSubPage={(parentPath, onCreated) => handleCreateFile('document', parentPath, onCreated)}
                  onSelectFile={fetchFileContent}
                  files={files}
                  globalLayoutOverride={globalLayoutOverride}
                  globalColumnWidthOverride={globalColumnWidthOverride}
                  highlightSearchTerm={activeSearchHighlight}
                  onClearSearchHighlight={() => setActiveSearchHighlight(null)}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-center items-center text-slate-400 p-12">
            <div className="max-w-md w-full bg-[#161b22]/40 border border-slate-800/80 rounded-2xl p-8 backdrop-blur-md shadow-2xl flex flex-col items-center text-center">
              <div className="h-16 w-16 bg-violet-600/10 border border-violet-500/25 rounded-2xl flex items-center justify-center text-violet-400 shadow-xl shadow-violet-500/5 mb-6">
                <Layers size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-100 mb-2">Welcome to BlockForgeMD</h2>
              <p className="text-sm text-slate-400 mb-6">A high-performance, local-first alternative to Notion. All files saved as Markdown on disk.</p>
              <div className="w-full space-y-3">
                <button
                  onClick={() => setActiveView('board')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-[#161b22] hover:bg-slate-800 border border-slate-800 rounded-xl transition text-left cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-3">
                    <LayoutGrid size={16} className="text-violet-400" />
                    <div>
                      <div className="font-semibold text-slate-200">Open Kanban Board</div>
                      <div className="text-[10px] text-slate-500">View tasks grouped by column status</div>
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-slate-500" />
                </button>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <button onClick={() => handleCreateFile('document')} className="flex flex-col items-center justify-center p-4 bg-[#161b22]/50 hover:bg-slate-800 border border-slate-800 rounded-xl transition cursor-pointer">
                    <FileText size={20} className="text-blue-400 mb-2" />
                    <span className="font-semibold text-slate-300">Create Document</span>
                  </button>
                  <button onClick={() => handleCreateFile('canvas')} className="flex flex-col items-center justify-center p-4 bg-[#161b22]/50 hover:bg-slate-800 border border-slate-800 rounded-xl transition cursor-pointer">
                    <Brush size={20} className="text-emerald-400 mb-2" />
                    <span className="font-semibold text-slate-300">Create Canvas</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Creation Modal ────────────────────────────────────────────────── */}
      {createModal.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b22] border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-base text-slate-100">
                {createModal.parentPath
                  ? `New item inside "${createModal.parentPath.split('/').pop()}"`
                  : 'Create New Item'}
              </h3>
              <button onClick={() => setCreateModal({ isOpen: false, type: null })} className="text-slate-500 hover:text-slate-300 transition cursor-pointer">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Select Item Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'document', label: 'Doc',        icon: <FileText    size={16} className="text-blue-400"    /> },
                    { id: 'task',     label: 'Task',       icon: <CheckSquare size={16} className="text-amber-500"   /> },
                    { id: 'canvas',   label: 'Excalidraw', icon: <Brush       size={16} className="text-emerald-400" /> },
                    { id: 'diagram',  label: 'Draw.io',    icon: <Grid        size={16} className="text-violet-400"  /> },
                    { id: 'board',    label: 'Board',      icon: <LayoutGrid  size={16} className="text-rose-400"    /> },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCreateModal((prev) => ({ ...prev, type: item.id as any }))}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-[11px] font-medium transition cursor-pointer ${
                        createModal.type === item.id
                          ? 'bg-violet-600/10 border-violet-500 text-violet-300'
                          : 'bg-slate-900/50 border-slate-850 hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="mb-1.5">{item.icon}</div>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Name / Title</label>
                <input
                  type="text"
                  placeholder="Enter name..."
                  value={createNameInput}
                  onChange={(e) => setCreateNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateConfirm()}
                  className="w-full bg-slate-950 border border-slate-850 focus:border-violet-500 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none transition"
                  autoFocus
                />
              </div>

              <div className="text-[10px] text-slate-500 font-mono">
                Location: <strong className="text-slate-400">{createModal.parentPath ? `${createModal.parentPath}/` : 'Root (/)'}</strong>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-850">
                <button type="button" onClick={() => setCreateModal({ isOpen: false, type: null })} className="px-4 py-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer">Cancel</button>
                <button type="button" disabled={!createModal.type || !createNameInput.trim()} onClick={handleCreateConfirm} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer">Create Item</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Menu Modal ─────────────────────────────────────────── */}
      {adminModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
          <div className="bg-[#161b22] border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl p-6 overflow-hidden animate-in zoom-in-95 duration-150 text-slate-200 flex flex-col h-[480px]">
            {/* Modal Header */}
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <Settings className="text-violet-400" size={18} />
                <h3 className="font-bold text-base text-slate-100">Settings</h3>
              </div>
              <button 
                onClick={() => setAdminModalOpen(false)} 
                className="text-slate-500 hover:text-slate-300 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body (Sidebar + Content Panel) */}
            <div className="flex-1 flex overflow-hidden min-h-0">
              {/* Settings Sidebar Submenu */}
              <div className="w-44 border-r border-slate-800 pr-4 space-y-1 shrink-0 flex flex-col justify-between">
                <div className="space-y-1">
                  {[
                    { id: 'editor' as const, label: 'Editor Layout', icon: <LayoutGrid size={14} className="text-violet-400" /> },
                    { id: 'history' as const, label: 'Backups & History', icon: <HistoryIcon size={14} className="text-rose-400" /> },
                    { id: 'cache'  as const, label: 'System & Sync', icon: <CheckSquare size={14} className="text-amber-500" /> },
                    { id: 'about'  as const, label: 'About Vault',  icon: <Layers size={14} className="text-blue-400" /> },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setSettingsTab(tab.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer text-left ${
                        settingsTab === tab.id
                          ? 'bg-violet-600/10 border-violet-500/35 text-violet-300'
                          : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-500 font-mono pl-3">
                  v1.2.0-stable
                </div>
              </div>

              {/* Settings Content Pane */}
              <div className="flex-1 pl-6 flex flex-col min-h-0">
                <div className="flex-1 overflow-y-auto no-scrollbar pr-1 min-h-0">
                  {settingsTab === 'editor' && (
                    <div className="space-y-5 animate-in fade-in duration-150">
                      {/* Global Layout Alignment Dropdown */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Global Layout Alignment
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Force a specific layout alignment (Left, Center, or Full Width) across all notes, or let each page define its own.
                        </p>
                        <div className="relative">
                          <select
                            value={globalLayoutOverride}
                            onChange={(e) => {
                              const val = e.target.value
                              localStorage.setItem('blockforge_global_layout_override', val)
                              setGlobalLayoutOverride(val)
                            }}
                            className="w-full bg-[#1f242c] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500 transition cursor-pointer appearance-none font-medium"
                          >
                            <option value="per-page">Per-Page (Respect Page Frontmatter)</option>
                            <option value="left">Force Left Aligned</option>
                            <option value="center">Force Center Aligned</option>
                            <option value="full">Force Full Width</option>
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Global Margin Width Override Dropdown */}
                      <div className="space-y-2 pt-2">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Global Margin Width
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Force column layout width boundaries (Narrow, Normal, or Wide lateral margins) for left and center aligned modes.
                        </p>
                        <div className="relative">
                          <select
                            value={globalColumnWidthOverride}
                            onChange={(e) => {
                              const val = e.target.value
                              localStorage.setItem('blockforge_global_column_width_override', val)
                              setGlobalColumnWidthOverride(val)
                            }}
                            className="w-full bg-[#1f242c] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500 transition cursor-pointer appearance-none font-medium"
                          >
                            <option value="per-page">Per-Page (Respect Page Frontmatter)</option>
                            <option value="narrow">Force Narrow (Large Margins / 672px)</option>
                            <option value="normal">Force Normal Margins (896px)</option>
                            <option value="wide">Force Wide (Small Margins / 1152px)</option>
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                            </svg>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {settingsTab === 'history' && (
                    <div className="space-y-4 animate-in fade-in duration-150">
                      <div className="space-y-1.5">
                        <h4 className="font-bold text-sm text-slate-100">Backups & History</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Configure automatic snapshot backup settings. When document contents change, timestamped markdown backups are created to allow comparison previews and rollbacks.
                        </p>
                      </div>

                      <div className="space-y-2 pt-2">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Version Rollback Limit
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Maximum number of timestamped backup snapshots kept per note (oldest are automatically pruned).
                        </p>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={historyLimitInput}
                          onChange={(e) => {
                            setHistoryLimitInput(e.target.value)
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val) && val > 0) {
                              handleSaveHistoryLimit(val)
                            }
                          }}
                          className="w-full bg-[#1f242c] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500 transition font-medium"
                        />
                      </div>
                    </div>
                  )}

                  {settingsTab === 'cache' && (
                    <div className="space-y-4 animate-in fade-in duration-150">
                      <div className="space-y-1.5">
                        <h4 className="font-bold text-sm text-slate-100">Local Cache & SQLite</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Manage internal index caches. Workspace notes are stored as plain Markdown files on disk, but indexed in SQLite for high-speed search and kanban filters.
                        </p>
                      </div>

                      <div className="bg-slate-900/50 border border-slate-850 rounded-xl p-4 space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400 font-medium">Index Database:</span>
                          <span className="font-mono text-slate-300">sqlite3 (local)</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400 font-medium">Sync State:</span>
                          {isSyncing ? (
                            <span className="text-amber-500 animate-pulse font-semibold">Syncing Cache...</span>
                          ) : syncError ? (
                            <span className="text-red-400 font-semibold">Offline (Local Cache Active)</span>
                          ) : (
                            <span className="text-emerald-500 font-semibold">Live Synced</span>
                          )}
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-400 font-medium">Local Documents:</span>
                          <span className="font-mono text-slate-300 font-bold">{files.length} indexed files</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {settingsTab === 'about' && (
                    <div className="space-y-4 animate-in fade-in duration-150">
                      <div className="space-y-1.5">
                        <h4 className="font-bold text-sm text-slate-100">BlockForgeMD</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          A high-performance, local-first alternative to Notion. Built with standard Markdown, Go back-end servers, SQLite indexes, and React client editors.
                        </p>
                      </div>

                      <div className="bg-slate-900/50 border border-slate-850 rounded-xl p-4 space-y-3">
                        <div className="text-xs text-slate-400">
                          BlockForgeMD workspace operates fully offline, reading and writing files directly to your storage disk directory. No third-party servers tracking or storing your notes.
                        </div>
                        <div className="flex justify-between items-center text-xs border-t border-slate-850 pt-2.5">
                          <span className="text-slate-500">License:</span>
                          <span className="text-slate-400 font-medium">MIT (Open Source)</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Done Button */}
                <div className="pt-4 border-t border-slate-800 flex justify-end shrink-0 mt-4">
                  <button
                    type="button"
                    onClick={() => setAdminModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Context Menu ─────────────────────────────────────────────────── */}
      {contextMenu.isOpen && (
        <div
          style={{ position: 'fixed', top: `${contextMenu.y}px`, left: `${contextMenu.x}px`, zIndex: 99999 }}
          className="w-48 bg-[#161b22] border border-slate-800 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 no-scrollbar select-none animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2.5 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-850/60 mb-1 truncate">
            {contextMenu.path}
          </div>

          {(
            [
              { type: 'document', label: 'New Sub-page',  icon: <FileText    size={13} className="text-blue-400"    /> },
              { type: 'task',     label: 'New Task',       icon: <CheckSquare size={13} className="text-amber-500"   /> },
              { type: 'canvas',   label: 'New Excalidraw', icon: <Brush       size={13} className="text-emerald-400" /> },
              { type: 'diagram',  label: 'New Draw.io',    icon: <Grid        size={13} className="text-violet-400"  /> },
              { type: 'board',    label: 'New Board',      icon: <LayoutGrid  size={13} className="text-rose-400"    /> },
            ] as const
          ).map(({ type, label, icon }) => (
            <button
              key={type}
              onClick={() => {
                const parent = getContextParentPath(contextMenu.path)
                handleCreateFile(type, parent)
                setContextMenu(p => ({ ...p, isOpen: false }))
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
            >
              {icon}{label}
            </button>
          ))}

          <div className="border-t border-slate-850/60 my-1" />
          <button
            onClick={() => {
              if (contextMenu.path) handleDeleteFile(contextMenu.path)
              setContextMenu(p => ({ ...p, isOpen: false }))
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-red-950/40 text-slate-400 hover:text-red-400 rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            <Trash2 size={13} className="text-red-500" /> Delete Item
          </button>
        </div>
      )}

      {/* ── Search & Command Palette Modal ─────────────────────────────── */}
      {searchOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-[12vh]"
          onMouseDown={() => setSearchOpen(false)}
        >
          <div 
            className="bg-[#161b22] border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-100 flex flex-col max-h-[500px]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Search Input Header */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800">
              <Search className="text-slate-500" size={18} />
              <input
                type="text"
                placeholder="Search files and contents, or type commands..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder-slate-500"
                autoFocus
                onKeyDown={(e) => {
                  const filteredCommands = COMMAND_ITEMS.filter(item => 
                    item.label.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  const allResults = [
                    ...filteredCommands.map(c => ({ type: 'command' as const, ...c })),
                    ...searchResults.map(f => ({ 
                      type: 'file' as const, 
                      id: f.path, 
                      label: f.title, 
                      path: f.path, 
                      fileType: f.type, 
                      action: () => fetchFileContent(f.path, false, searchQuery) 
                    }))
                  ]

                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSearchSelectedIndex(prev => (prev + 1) % Math.max(1, allResults.length))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSearchSelectedIndex(prev => (prev - 1 + allResults.length) % Math.max(1, allResults.length))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (allResults[searchSelectedIndex]) {
                      allResults[searchSelectedIndex].action()
                      setSearchOpen(false)
                    }
                  } else if (e.key === 'Escape') {
                    setSearchOpen(false)
                  }
                }}
              />
              {isSearching && (
                <div className="h-4 w-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" />
              )}
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-3 max-h-[380px] no-scrollbar">
              {/* Commands Section */}
              {COMMAND_ITEMS.filter(item => 
                item.label.toLowerCase().includes(searchQuery.toLowerCase())
              ).length > 0 && (
                <div className="space-y-1">
                  <div className="px-3 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                    Commands
                  </div>
                  {COMMAND_ITEMS.filter(item => 
                    item.label.toLowerCase().includes(searchQuery.toLowerCase())
                  ).map((item, idx) => {
                    const globalIdx = idx
                    const isSelected = globalIdx === searchSelectedIndex
                    return (
                      <button
                        key={item.id}
                        onClick={() => { item.action(); setSearchOpen(false) }}
                        onMouseEnter={() => setSearchSelectedIndex(globalIdx)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition font-medium cursor-pointer ${
                          isSelected ? 'bg-violet-600/15 text-violet-300 border border-violet-500/20' : 'text-slate-300 border border-transparent hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-slate-400 leading-none">{item.icon}</span>
                          <span>{item.label}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Files Section */}
              {searchResults.length > 0 && (
                <div className="space-y-1">
                  <div className="px-3 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-t border-slate-800/40 pt-2.5">
                    Files & Contents
                  </div>
                  {searchResults.map((file, idx) => {
                    const commandsCount = COMMAND_ITEMS.filter(item => 
                      item.label.toLowerCase().includes(searchQuery.toLowerCase())
                    ).length
                    const globalIdx = commandsCount + idx
                    const isSelected = globalIdx === searchSelectedIndex
                    return (
                      <button
                        key={file.path}
                        onClick={() => { fetchFileContent(file.path, false, searchQuery); setSearchOpen(false) }}
                        onMouseEnter={() => setSearchSelectedIndex(globalIdx)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition font-medium cursor-pointer ${
                          isSelected ? 'bg-violet-600/15 text-violet-300 border border-violet-500/20' : 'text-slate-300 border border-transparent hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 w-full">
                          <span className="text-slate-400 shrink-0">
                            {file.type === 'canvas' ? <Brush size={14} /> : <FileText size={14} />}
                          </span>
                          <div className="truncate flex-1">
                            <div className="font-semibold text-slate-200">{file.title}</div>
                            <div className="text-[10px] text-slate-500 truncate">{file.path}</div>
                            {getSearchSnippet(file.content || '', searchQuery) && (
                              <div className="text-[10px] text-slate-400 font-sans italic font-normal mt-0.5 max-w-full truncate">
                                {getSearchSnippet(file.content || '', searchQuery)}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Empty State */}
              {COMMAND_ITEMS.filter(item => 
                item.label.toLowerCase().includes(searchQuery.toLowerCase())
              ).length === 0 && searchResults.length === 0 && (
                <div className="p-8 text-center text-xs text-slate-500">
                  No matching files or commands found.
                </div>
              )}
            </div>

            {/* Footer with key descriptions */}
            <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800 text-[10px] text-slate-500 flex justify-between shrink-0 font-mono">
              <div className="flex items-center gap-2">
                <span>↑↓ navigate</span>
                <span>⏎ select</span>
              </div>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
