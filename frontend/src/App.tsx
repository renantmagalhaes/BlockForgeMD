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
  Loader2,
  FilePlus,
  Layers,
  ArrowRight,
  Plus,
  X,
  Grid,
  Settings,
  Search,
  History as HistoryIcon,
  GripVertical,
  Pencil,
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronsDown,
  ChevronsUp,
  Brain,
  Moon,
  Sun,
  Star,
  Network,
  Home,
  LogOut,
  Key,
  Users,
  ListChecks,
  Presentation,
  BrainCircuit,
  Menu,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import Editor from './components/Editor'
import Kanban from './components/Kanban'
import Canvas from './components/Canvas'
import Diagram from './components/Diagram'
import MindMap from './components/MindMap'
import TrashPanel from './components/TrashPanel'
import { GraphView } from './components/GraphView'
import LoginScreen from './components/LoginScreen'
import { useIsMobile } from './lib/useIsMobile'
import { DialogHost, alertDialog, confirmDialog } from './lib/dialog'
import iconDocument from './assets/icons/document.png'
import iconTask from './assets/icons/tasks.svg'
import iconBoard from './assets/icons/kanban-board.svg'
import iconMindMap from './assets/icons/mind-map.png'
import iconExcalidraw from './assets/icons/excalidraw.png'
import iconDrawio from './assets/icons/drawio.png'
import iconCanvasMenu from './assets/icons/canva-menu.svg'

const TREE_ICON_CLASS = 'w-[13px] h-[13px] shrink-0 object-contain'
import BootstrapScreen from './components/BootstrapScreen'

// Active rail icon: a bright circular glow — per-section color — that fades
// outward from the center, rather than a flat tinted square.
const RAIL_ACTIVE_CLASS = 'text-white rounded-full'
const RAIL_INACTIVE_CLASS = 'text-white/90 hover:text-white hover:bg-slate-800/60 rounded-lg'
const RAIL_GLOW_RGB = {
  favorites: '139,92,246', // violet
  documents: '59,130,246', // blue
  boards: '250,204,21',    // yellow
  canvas: '16,185,129',    // green
  mindmaps: '139,92,246',  // violet
  graph: '139,92,246',     // violet
}
const railGlowStyle = (rgb: string): React.CSSProperties => ({
  background: `radial-gradient(circle, rgba(${rgb},0.95) 0%, rgba(${rgb},0.55) 45%, rgba(${rgb},0) 78%)`,
  boxShadow: `0 0 14px 2px rgba(${rgb},0.45)`,
})

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

const APP_VERSION = '0.9'

// ─── buildTree ───────────────────────────────────────────────────────────────
// Every page can have sub-pages.
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

    // Strip compound extensions before .md so board files nest their tasks correctly:
    // Boards/MyBoard.board.md → stem Boards/MyBoard (tasks live at Boards/MyBoard/*)
    const stem = file.path.endsWith('.board.md')
      ? file.path.slice(0, -'.board.md'.length)
      : file.path.endsWith('.md')
      ? file.path.slice(0, -3)
      : file.path
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

  // No sorting — ordering is controlled by the backend `position` field.
  // Section roots (Documents, Tasks, etc.) are hardcoded in the sidebar JSX.
  return root.children
}

// Returns children of a specific category section, filtering strictly by folder path AND allowed types.
// Handles workspace-prefixed paths (e.g. "Default/Documents") by navigating down the tree segments.
const getCategoryChildren = (filesList: FileRecord[], category: string, allowedTypes: string[]): TreeNode[] => {
  const filtered = filesList.filter(f =>
    f.path.startsWith(category + '/') && allowedTypes.includes(f.type)
  )
  const tree = buildTree(filtered)
  // Navigate down each path segment to reach the correct subtree node
  const parts = category.split('/')
  let nodes = tree
  for (const part of parts) {
    const found = nodes.find(n => n.name === part)
    if (!found) return []
    nodes = found.children
  }
  return nodes
}

// Returns boards (with their tasks as children) plus any standalone tasks in Tasks/.
// workspace param is the active workspace name (e.g. "Default"), used to scope paths.
const getBoardChildren = (filesList: FileRecord[], workspace: string): TreeNode[] => {
  const prefix = workspace ? `${workspace}/` : ''
  const filtered = filesList.filter(f =>
    (f.path.startsWith(`${prefix}Boards/`) || f.path.startsWith(`${prefix}Tasks/`)) &&
    (f.type === 'board' || f.type === 'task' || f.type === 'folder')
  )
  const tree = buildTree(filtered)

  const getSection = (sectionName: string): TreeNode[] => {
    const parts = workspace ? [workspace, sectionName] : [sectionName]
    let nodes = tree
    for (const p of parts) {
      const found = nodes.find(n => n.name === p)
      if (!found) return []
      nodes = found.children
    }
    return nodes
  }

  return [...getSection('Boards'), ...getSection('Tasks')]
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
  // Board files use compound extension; tasks nest under the bare name
  if (node.filePath.endsWith('.board.md')) {
    return node.filePath.slice(0, -'.board.md'.length)
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
  // Board files: strip .board.md so tasks nest under the bare folder name
  if (path.endsWith('.board.md')) return path.slice(0, -'.board.md'.length)
  // For any page: new item goes under its stem
  const stem = path.endsWith('.md') ? path.slice(0, -3) : path
  return stem
}

const SECTION_ALLOWED_TYPES: Record<string, string[]> = {
  documents: ['document', 'folder'],
  boards: ['board', 'task', 'folder'],
  canvas: ['canvas', 'folder'],
  mindmaps: ['mindmap', 'folder'],
}

const getFileTypeIcon = (type?: string, editor?: string) => {
  switch (type) {
    case 'task':    return <img src={iconTask} alt="" className={TREE_ICON_CLASS} />
    case 'canvas':  return <img src={editor === 'drawio' ? iconDrawio : iconExcalidraw} alt="" className={TREE_ICON_CLASS} />
    case 'board':   return <img src={iconBoard} alt="" className={TREE_ICON_CLASS} />
    case 'mindmap': return <img src={iconMindMap} alt="" className={TREE_ICON_CLASS} />
    case 'folder':  return <Folder size={13} className="text-slate-400 shrink-0" />
    default:        return <img src={iconDocument} alt="" className={TREE_ICON_CLASS} />
  }
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
  draggingPath: string | null
  draggingType?: string
  sectionType?: 'documents' | 'boards' | 'canvas' | 'mindmaps'
  onDragStart: (filePath: string, nodeType?: string) => void
  onDragEnd: () => void
  onDropNode: (fromFilePath: string, toNode: TreeNode) => void
  onReorderNode?: (fromFilePath: string, toFilePath: string, pos: 'before' | 'after') => void
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
  draggingPath,
  draggingType,
  sectionType,
  onDragStart,
  onDragEnd,
  onDropNode,
  onReorderNode,
}) => {
  const getIsCollapsed = () => {
    if (collapsedPaths[node.path] !== undefined) return collapsedPaths[node.path]
    if (node.path === 'Documents' || node.name === 'Documents') return false
    return true
  }

  const isCollapsed = getIsCollapsed()
  const isSelected = selectedPath && node.hasPage && node.filePath === selectedPath
  const isBeingDragged = !!(node.filePath && draggingPath === node.filePath)

  // 'before' | 'after' = reorder indicator, 'on' = sub-page drop highlight, null = none
  const [dropZone, setDropZone] = React.useState<'before' | 'after' | 'on' | null>(null)

  const computeDropZone = (e: React.DragEvent): 'before' | 'after' | 'on' => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pct = (e.clientY - rect.top) / rect.height
    if (pct < 0.3) return 'before'
    if (pct > 0.7) return 'after'
    return 'on'
  }

  const handleDragStart = (e: React.DragEvent) => {
    if (!node.filePath) { e.preventDefault(); return }
    e.dataTransfer.setData('text/plain', node.filePath)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart(node.filePath, node.type)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!node.filePath || isBeingDragged) return

    const zone = computeDropZone(e)

    if (zone === 'before' || zone === 'after') {
      // Block cross-type drops even for reorder/peer-move zones
      if (sectionType && draggingType !== undefined) {
        const allowed = SECTION_ALLOWED_TYPES[sectionType] ?? []
        if (!allowed.includes(draggingType)) { setDropZone(null); return }
      }
      e.dataTransfer.dropEffect = 'move'
      setDropZone(zone)
      return
    }

    // 'on' zone = sub-page drop (existing behavior) — requires type compatibility
    if (!node.hasPage) { setDropZone(null); return }
    if (sectionType && draggingType !== undefined) {
      const allowed = SECTION_ALLOWED_TYPES[sectionType] ?? []
      if (!allowed.includes(draggingType)) { setDropZone(null); return }
    }
    if (draggingPath) {
      const dragStem = draggingPath.endsWith('.board.md') ? draggingPath.slice(0, -'.board.md'.length)
        : draggingPath.endsWith('.excalidraw.md') ? draggingPath.slice(0, -'.excalidraw.md'.length)
        : draggingPath.endsWith('.drawio.md') ? draggingPath.slice(0, -'.drawio.md'.length)
        : draggingPath.endsWith('.mindmap.md') ? draggingPath.slice(0, -'.mindmap.md'.length)
        : draggingPath.endsWith('.md') ? draggingPath.slice(0, -3) : draggingPath
      if (node.filePath.startsWith(dragStem + '/')) { setDropZone(null); return }
    }
    e.dataTransfer.dropEffect = 'move'
    setDropZone('on')
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZone(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const fromPath = e.dataTransfer.getData('text/plain')
    const zone = dropZone
    setDropZone(null)

    if (!fromPath || fromPath === node.filePath) { onDragEnd(); return }

    if ((zone === 'before' || zone === 'after') && node.filePath) {
      onReorderNode?.(fromPath, node.filePath, zone)
    } else if (zone === 'on' && node.hasPage && node.filePath) {
      const canDrop = !sectionType || !draggingType ||
        (SECTION_ALLOWED_TYPES[sectionType] ?? []).includes(draggingType)
      if (canDrop) onDropNode(fromPath, node)
    }
    onDragEnd()
  }

  const handleDragEnd = () => {
    onDragEnd()
    setDropZone(null)
  }

  const handleRowClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const actAsFolder = node.isFolder || node.type === 'folder'
    if (node.hasPage && node.filePath) {
      if (node.type === 'folder') {
        onToggleCollapse(node.path)
      } else {
        onSelectFile(node.filePath)
        if (actAsFolder) onToggleCollapse(node.path)
      }
    } else if (actAsFolder) {
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
    if (node.type === 'folder') {
      return isCollapsed
        ? <Folder size={13} className="text-slate-400 shrink-0" />
        : <FolderOpen size={13} className="text-slate-300 shrink-0" />
    }
    switch (node.type) {
      case 'task':    return <img src={iconTask} alt="" className={TREE_ICON_CLASS} />
      case 'canvas':  return <img src={node.frontMatter?.editor === 'drawio' ? iconDrawio : iconExcalidraw} alt="" className={TREE_ICON_CLASS} />
      case 'board':   return <img src={iconBoard} alt="" className={TREE_ICON_CLASS} />
      case 'mindmap': return <img src={iconMindMap} alt="" className={TREE_ICON_CLASS} />
      default:        return <img src={iconDocument} alt="" className={TREE_ICON_CLASS} />
    }
  }

  return (
    <div className="flex flex-col select-none relative">
      {dropZone === 'before' && (
        <div className="absolute top-0 left-3 right-1 h-0.5 bg-violet-400 rounded-full z-10 pointer-events-none" />
      )}
      <div
        draggable={!!node.filePath}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleRowClick}
        onContextMenu={handleContextMenu}
        data-sidebar-path={node.filePath || undefined}
        style={{ paddingLeft: `${depth * 8 + 6}px` }}
        className={`flex items-center justify-between group py-1 px-2 rounded-lg text-xs transition bf-tree-item ${isSelected ? 'selected' : ''} ${
          isBeingDragged
            ? 'opacity-30 cursor-grabbing'
            : dropZone === 'on'
            ? 'bg-violet-600/15 border border-violet-500/40 text-violet-300 cursor-copy'
            : isSelected
            ? 'bg-slate-800 text-violet-400 font-semibold border border-slate-700/50 hover:bg-slate-800/80 cursor-pointer'
            : 'hover:bg-slate-800/40 text-slate-300 cursor-pointer'
        }`}
      >
        <div className="flex items-center gap-1 truncate min-w-0">
          {/* Drag handle — takes fixed width so layout doesn't shift */}
          <span
            className={`shrink-0 transition-opacity ${
              node.filePath
                ? 'opacity-0 group-hover:opacity-50 hover:opacity-100 text-slate-500 cursor-grab active:cursor-grabbing'
                : 'invisible'
            }`}
            style={{ width: 12 }}
          >
            {node.filePath && <GripVertical size={10} />}
          </span>
          {(node.isFolder || node.type === 'folder') ? (
            <span
              onClick={handleChevronClick}
              className="text-slate-500 hover:text-slate-200 p-0.5 hover:bg-slate-700/50 rounded transition shrink-0"
            >
              {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            </span>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {getIcon()}
          <span className="truncate ml-0.5">{node.title || node.name}</span>
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
      {dropZone === 'after' && (
        <div className="absolute bottom-0 left-3 right-1 h-0.5 bg-violet-400 rounded-full z-10 pointer-events-none" />
      )}

      <AnimatePresence initial={false}>
        {(node.isFolder || node.type === 'folder') && !isCollapsed && node.children && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
            className="flex flex-col mt-0.5 border-l border-slate-800/60 ml-2.5 space-y-0.5"
          >
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
                draggingPath={draggingPath}
                draggingType={draggingType}
                sectionType={sectionType}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDropNode={onDropNode}
                onReorderNode={onReorderNode}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
  position?: number
}

const splitFrontMatter = (content: string) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (match) {
    return { frontMatterStr: match[1], body: match[2].replace(/^\r?\n+/, '') }
  }
  return { frontMatterStr: '', body: content }
}

const API_BASE = ''

// Font choices for the "App Font" setting (Settings → Appearance). The id is
// what's persisted to the backend; `stack` is the full CSS font-family value
// applied to --font-ui. Google Fonts are loaded via the @import in index.css
// — Maple Mono NF isn't on Google Fonts, so it only renders if the user has
// it installed locally (common for anyone who already uses it in a terminal
// or code editor), falling back to JetBrains Mono / system monospace otherwise.
const FONT_OPTIONS: { id: string; label: string; stack: string }[] = [
  { id: 'inter', label: 'Inter (default)', stack: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { id: 'system', label: 'System Default', stack: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { id: 'roboto', label: 'Roboto', stack: "'Roboto', system-ui, sans-serif" },
  { id: 'open-sans', label: 'Open Sans', stack: "'Open Sans', system-ui, sans-serif" },
  { id: 'lato', label: 'Lato', stack: "'Lato', system-ui, sans-serif" },
  { id: 'poppins', label: 'Poppins', stack: "'Poppins', system-ui, sans-serif" },
  { id: 'nunito', label: 'Nunito', stack: "'Nunito', system-ui, sans-serif" },
  { id: 'source-sans-3', label: 'Source Sans 3', stack: "'Source Sans 3', system-ui, sans-serif" },
  { id: 'maple-mono-nf', label: 'Maple Mono NF (monospace, requires local install)', stack: "'Maple Mono NF', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace" },
]

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

// ─── UsersTab ────────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState<{ id: string; username: string; createdAt: string }[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; username: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteError, setDeleteError] = useState('')

  function reload() {
    fetch('/api/users', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setUsers(d.users ?? []))
      .catch(() => {})
  }

  useEffect(() => { reload() }, [])

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSuccess('')
    const res = await fetch('/api/users', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (res.ok) { setSuccess('User created.'); setUsername(''); setPassword(''); reload() }
    else { const t = await res.text(); setError(t || 'Failed.') }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteConfirm !== deleteTarget.username) return
    setDeleteError('')
    const res = await fetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) {
      setDeleteTarget(null); setDeleteConfirm(''); reload()
    } else {
      const t = await res.text(); setDeleteError(t || 'Failed to delete user.')
    }
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <h4 className="font-bold text-sm text-slate-100">Users</h4>
      <div className="space-y-1">
        {users.map(u => (
          <div key={u.id} className="flex items-center justify-between px-3 py-2 bg-slate-900/50 rounded-lg text-xs text-slate-300">
            <span className="font-medium">{u.username}</span>
            <div className="flex items-center gap-3">
              <span className="text-slate-500">{u.createdAt?.slice(0, 10)}</span>
              <button
                onClick={() => { setDeleteTarget(u); setDeleteConfirm(''); setDeleteError('') }}
                className="text-slate-600 hover:text-red-400 transition"
                title="Delete user"
              >
                <X size={11} />
              </button>
            </div>
          </div>
        ))}
        {users.length === 0 && <p className="text-xs text-slate-500">No users found.</p>}
      </div>

      {/* Delete confirmation inline panel */}
      {deleteTarget && (
        <div className="bg-red-950/30 border border-red-800/40 rounded-xl p-4 space-y-3">
          <p className="text-xs text-red-300 font-semibold">Delete user <span className="font-mono">{deleteTarget.username}</span>?</p>
          <p className="text-[10px] text-slate-400">This will also revoke all their sessions and API keys. Type the username to confirm.</p>
          <input
            autoFocus
            value={deleteConfirm}
            onChange={e => setDeleteConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmDelete()}
            placeholder={deleteTarget.username}
            className="w-full bg-slate-900 border border-red-800/50 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-red-500 transition font-mono"
          />
          {deleteError && <p className="text-red-400 text-[10px]">{deleteError}</p>}
          <div className="flex gap-2">
            <button
              onClick={confirmDelete}
              disabled={deleteConfirm !== deleteTarget.username}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 text-xs font-medium transition"
            >
              Delete
            </button>
            <button
              onClick={() => { setDeleteTarget(null); setDeleteConfirm('') }}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg px-3 py-1.5 text-xs font-medium transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <form onSubmit={createUser} className="space-y-2 border-t border-slate-800 pt-4">
        <p className="text-xs font-semibold text-slate-400">Add user</p>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" required
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition" />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min 6)" type="password" required
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition" />
        {error && <p className="text-red-400 text-[10px]">{error}</p>}
        {success && <p className="text-emerald-400 text-[10px]">{success}</p>}
        <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3 py-2 text-xs font-medium transition">
          Create user
        </button>
      </form>
    </div>
  )
}

// ─── AccessTab ───────────────────────────────────────────────────────────────
function AccessTab({ currentUserId }: { currentUserId: string }) {
  const [keys, setKeys] = useState<{ id: string; label: string; createdAt: string; lastUsedAt?: string }[]>([])
  const [label, setLabel] = useState('')
  const [newKey, setNewKey] = useState('')
  const [error, setError] = useState('')

  function reload() {
    fetch('/api/keys', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setKeys(d.keys ?? []))
      .catch(() => {})
  }

  useEffect(() => { reload() }, [currentUserId])

  async function generate(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setNewKey('')
    const res = await fetch('/api/keys', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label || 'API Key' }),
    })
    if (res.ok) { const d = await res.json(); setNewKey(d.key); setLabel(''); reload() }
    else { setError('Failed to create key.') }
  }

  async function revoke(id: string) {
    await fetch(`/api/keys/${id}`, { method: 'DELETE', credentials: 'include' })
    reload()
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <h4 className="font-bold text-sm text-slate-100">API Keys</h4>
      <div className="space-y-1">
        {keys.map(k => (
          <div key={k.id} className="flex items-center justify-between px-3 py-2 bg-slate-900/50 rounded-lg text-xs">
            <div>
              <span className="text-slate-300">{k.label}</span>
              <span className="text-slate-500 ml-2">created {k.createdAt?.slice(0, 10)}</span>
            </div>
            <button onClick={() => revoke(k.id)} className="text-slate-600 hover:text-red-400 transition text-[10px]">Revoke</button>
          </div>
        ))}
        {keys.length === 0 && <p className="text-xs text-slate-500">No API keys yet.</p>}
      </div>
      {newKey && (
        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-3 space-y-1">
          <p className="text-[10px] text-emerald-400 font-semibold">Key generated — copy it now, it won't be shown again.</p>
          <code className="text-[10px] text-emerald-300 break-all select-all">{newKey}</code>
        </div>
      )}
      {error && <p className="text-red-400 text-[10px]">{error}</p>}
      <form onSubmit={generate} className="flex gap-2 border-t border-slate-800 pt-4">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional)"
          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition" />
        <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-3 py-2 text-xs font-medium transition whitespace-nowrap">
          Generate key
        </button>
      </form>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  // Seed from localStorage to avoid flash on initial paint; backend is authoritative
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const s = localStorage.getItem('bf-theme')
    return s === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const handleSetTheme = (t: 'dark' | 'light') => {
    setTheme(t)
    localStorage.setItem('bf-theme', t)
    fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: t }),
    }).catch(e => console.error('Failed to save theme', e))
  }

  // ── Sidebar color customization ──────────────────────────────────────────
  // Empty string = "use theme default". Applied as inline custom properties
  // on <html> so .bf-sidebar's var(--sidebar-bg-override, var(--bg-surface))
  // fallback chain resolves correctly (see index.css for why they're never
  // declared in the stylesheet itself).
  const [sidebarBgColor, setSidebarBgColorState] = useState<string>(
    () => localStorage.getItem('bf-sidebar-bg') || ''
  )
  const [sidebarTextColor, setSidebarTextColorState] = useState<string>(
    () => localStorage.getItem('bf-sidebar-text') || ''
  )
  useEffect(() => {
    if (sidebarBgColor) document.documentElement.style.setProperty('--sidebar-bg-override', sidebarBgColor)
    else document.documentElement.style.removeProperty('--sidebar-bg-override')
  }, [sidebarBgColor])
  useEffect(() => {
    if (sidebarTextColor) document.documentElement.style.setProperty('--sidebar-text-override', sidebarTextColor)
    else document.documentElement.style.removeProperty('--sidebar-text-override')
  }, [sidebarTextColor])

  // ── App font ──────────────────────────────────────────────────────────────
  const [appFont, setAppFont] = useState<string>(() => {
    return localStorage.getItem('blockforge_app_font') || 'inter'
  })
  useEffect(() => {
    const opt = FONT_OPTIONS.find(f => f.id === appFont) || FONT_OPTIONS[0]
    document.documentElement.style.setProperty('--font-ui', opt.stack)
  }, [appFont])

  const handleSetAppFont = (id: string) => {
    setAppFont(id)
    localStorage.setItem('blockforge_app_font', id)
    fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_font: id }),
    }).catch(e => console.error('Failed to save app_font', e))
  }

  const handleSetSidebarBgColor = (c: string) => {
    setSidebarBgColorState(c)
    localStorage.setItem('bf-sidebar-bg', c)
    fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sidebar_bg_color: c }),
    }).catch(e => console.error('Failed to save sidebar_bg_color', e))
  }

  const handleSetSidebarTextColor = (c: string) => {
    setSidebarTextColorState(c)
    localStorage.setItem('bf-sidebar-text', c)
    fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sidebar_text_color: c }),
    }).catch(e => console.error('Failed to save sidebar_text_color', e))
  }

  const [files, setFiles] = useState<FileRecord[]>([])
  const [activeView, setActiveView] = useState<'board' | 'editor' | 'graph'>('editor')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedContent, setSelectedContent] = useState<string>('')
  const [currentFrontMatterStr, setCurrentFrontMatterStr] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [isSyncing, setIsSyncing] = useState(true)
  const [syncError, setSyncError] = useState(false)
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({})

  // ── Workspace state ────────────────────────────────────────────────────────
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<string>(
    () => localStorage.getItem('blockforge_workspace') || ''
  )
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false)
  const [newWorkspaceModal, setNewWorkspaceModal] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<string | null>(null)
  const [renameWorkspaceName, setRenameWorkspaceName] = useState('')

  // ── Favorites ──────────────────────────────────────────────────────────────
  const [favorites, setFavorites] = useState<string[]>([])
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false)

  // Reload favorites from backend whenever the active workspace changes.
  // Guard against the initial empty-string state before fetchWorkspaces resolves.
  useEffect(() => {
    if (!activeWorkspace) return
    const controller = new AbortController()
    fetch(`${API_BASE}/api/favorites?workspace=${encodeURIComponent(activeWorkspace)}`, {
      signal: controller.signal,
    })
      .then(r => r.ok ? r.json() : { favorites: [] })
      .then(data => setFavorites(data.favorites || []))
      .catch(err => { if (err.name !== 'AbortError') setFavorites([]) })
    return () => controller.abort()
  }, [activeWorkspace]) // eslint-disable-line react-hooks/exhaustive-deps

  // W(section) → workspace-qualified section root path
  const W = (section: string) => activeWorkspace ? `${activeWorkspace}/${section}` : section

  const revealInSidebar = (filePath: string) => {
    const stem = filePath.endsWith('.board.md') ? filePath.slice(0, -'.board.md'.length)
      : filePath.endsWith('.excalidraw.md') ? filePath.slice(0, -'.excalidraw.md'.length)
      : filePath.endsWith('.drawio.md') ? filePath.slice(0, -'.drawio.md'.length)
      : filePath.endsWith('.mindmap.md') ? filePath.slice(0, -'.mindmap.md'.length)
      : filePath.endsWith('.md') ? filePath.slice(0, -3)
      : filePath
    const parts = stem.split('/')
    const ancestors: string[] = []
    for (let i = 1; i < parts.length; i++) ancestors.push(parts.slice(0, i).join('/'))
    if (ancestors.length > 0) {
      setCollapsedPaths(prev => {
        const next = { ...prev }
        ancestors.forEach(p => { next[p] = false })
        return next
      })
    }
  }

  // Collect all collapsible node paths within given section dirs (to support collapse/expand all)
  const getSectionPaths = (dirs: string[]): string[] => {
    const set = new Set<string>()
    files.forEach(f => {
      if (!dirs.some(d => f.path.startsWith(d + '/'))) return
      const stem = f.path.endsWith('.board.md') ? f.path.slice(0, -'.board.md'.length)
        : f.path.endsWith('.excalidraw.md') ? f.path.slice(0, -'.excalidraw.md'.length)
        : f.path.endsWith('.drawio.md') ? f.path.slice(0, -'.drawio.md'.length)
        : f.path.endsWith('.mindmap.md') ? f.path.slice(0, -'.mindmap.md'.length)
        : f.path.endsWith('.md') ? f.path.slice(0, -3)
        : f.path
      const parts = stem.split('/')
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'))
    })
    return [...set]
  }

  const isSectionExpanded = (dirs: string[]): boolean =>
    getSectionPaths(dirs).some(p => collapsedPaths[p] === false)

  const toggleSectionCollapse = (dirs: string[]) => {
    const paths = getSectionPaths(dirs)
    const collapse = paths.some(p => collapsedPaths[p] === false)
    setCollapsedPaths(prev => {
      const next = { ...prev }
      paths.forEach(p => { next[p] = collapse })
      return next
    })
  }

  const defaultColumns = ['Todo', 'In Progress', 'Done']

  const subpageCallbackRef = useRef<((newPath: string, title: string) => string) | null>(null)

  const [createModal, setCreateModal] = useState<{
    isOpen: boolean
    type: 'document' | 'task' | 'canvas' | 'board' | 'diagram' | 'folder' | 'mindmap' | null
    parentPath?: string
    allowedTypes?: ('document' | 'task' | 'canvas' | 'board' | 'diagram' | 'folder' | 'mindmap')[]
    modeLabel?: string
  }>({ isOpen: false, type: null })
  const [createNameInput, setCreateNameInput] = useState('')

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const isMobile = useIsMobile()
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  type SidebarSection = 'favorites' | 'documents' | 'boards' | 'canvas' | 'mindmaps'
  const [activeSidebarSection, setActiveSidebarSection] = useState<SidebarSection>('documents')
  const [kanbanCardViewMode, setKanbanCardViewMode] = useState<'modal' | 'sidebar' | 'fullscreen'>('modal')
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false)
  const [autosaveDelay, setAutosaveDelay] = useState(1500)
  const [autosaveDelayInput, setAutosaveDelayInput] = useState('1500')
  const [historyInterval, setHistoryInterval] = useState(0)
  const [historyIntervalInput, setHistoryIntervalInput] = useState('0')
  const selectedPathRef = useRef<string | null>(null)
  const [sidebarTooltip, setSidebarTooltip] = useState<{ label: string; y: number } | null>(null)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showTooltip(label: string) {
    return (e: React.MouseEvent<HTMLElement>) => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
      const rect = e.currentTarget.getBoundingClientRect()
      setSidebarTooltip({ label, y: rect.top + rect.height / 2 })
    }
  }
  function hideTooltip() {
    tooltipTimerRef.current = setTimeout(() => setSidebarTooltip(null), 100)
  }
  // Rail icons are always visible (level 1); clicking one opens/switches the
  // level 2 panel to that section, or collapses it if it's already the one showing.
  const openSidebarSection = (section: SidebarSection) => {
    if (!sidebarCollapsed && activeSidebarSection === section) {
      saveSidebarCollapsed(true)
    } else {
      setActiveSidebarSection(section)
      if (sidebarCollapsed) saveSidebarCollapsed(false)
    }
  }

  // Which level-2 section a given file path belongs to, based on its root folder.
  const sectionFromPath = (path: string): SidebarSection | null => {
    if (path.startsWith(W('Documents') + '/')) return 'documents'
    if (path.startsWith(W('Boards') + '/') || path.startsWith(W('Tasks') + '/')) return 'boards'
    if (path.startsWith(W('Canvas') + '/')) return 'canvas'
    if (path.startsWith(W('MindMaps') + '/')) return 'mindmaps'
    return null
  }

  const [authStatus, setAuthStatus] = useState<'loading' | 'bootstrap' | 'unauthenticated' | 'authenticated'>('loading')
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string } | null>(null)
  const [adminModalOpen, setAdminModalOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'general' | 'appearance' | 'editor' | 'history' | 'about' | 'users' | 'access'>('general')
  const settingsScrollRef = useRef<HTMLDivElement>(null)
  const [settingsScrollable, setSettingsScrollable] = useState(false)
  const checkSettingsScroll = () => {
    const el = settingsScrollRef.current
    if (!el) return
    setSettingsScrollable(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }
  useEffect(() => {
    if (!adminModalOpen) return
    // Wait a frame so the newly-rendered tab content has been laid out.
    const id = requestAnimationFrame(checkSettingsScroll)
    return () => cancelAnimationFrame(id)
  }, [settingsTab, adminModalOpen])
  useEffect(() => {
    if (!adminModalOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setAdminModalOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [adminModalOpen])
  const [defaultPage, setDefaultPage] = useState<string>('')
  const [defaultPageSearch, setDefaultPageSearch] = useState('')
  const [defaultPageDropdownOpen, setDefaultPageDropdownOpen] = useState(false)
  const [globalLayoutOverride, setGlobalLayoutOverride] = useState<string>(() => {
    return localStorage.getItem('blockforge_global_layout_override') || 'per-page'
  })
  const [globalColumnWidthOverride, setGlobalColumnWidthOverride] = useState<string>(() => {
    return localStorage.getItem('blockforge_global_column_width_override') || 'per-page'
  })
  const [historyLimitInput, setHistoryLimitInput] = useState('50')
  const [trashRetentionDays, setTrashRetentionDays] = useState(30)
  const [trashRetentionInput, setTrashRetentionInput] = useState('30')
  const [showTrash, setShowTrash] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean; x: number; y: number; path: string | null; isFolder: boolean
    sectionType?: 'documents' | 'boards' | 'canvas' | 'mindmaps'
    nodeType?: string
  }>({ isOpen: false, x: 0, y: 0, path: null, isFolder: false })

  const [renameModal, setRenameModal] = useState<{ isOpen: boolean; path: string; currentName: string }>({ isOpen: false, path: '', currentName: '' })
  const [renameInput, setRenameInput] = useState('')

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

  const SECTION_NAMES = new Set(['Documents', 'Boards', 'Canvas', 'MindMaps', 'Tasks'])

  const fetchWorkspaces = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/workspaces`)
      if (!res.ok) return
      const data = await res.json()
      const list: string[] = data.workspaces || []

      // Detect legacy flat structure (section dirs at vault root)
      if (list.some(w => SECTION_NAMES.has(w))) {
        const migrateRes = await fetch(`${API_BASE}/api/workspaces/migrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Default' }),
        })
        if (migrateRes.ok) {
          const migrateData = await migrateRes.json()
          const ws = migrateData.name as string
          setWorkspaces([ws])
          setActiveWorkspace(ws)
          localStorage.setItem('blockforge_workspace', ws)
          fetchFiles()
        }
        return
      }

      if (list.length === 0) {
        // Fresh install — create Default workspace
        const createRes = await fetch(`${API_BASE}/api/workspaces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Default' }),
        })
        if (createRes.ok) {
          const createData = await createRes.json()
          const ws = createData.name as string
          setWorkspaces([ws])
          setActiveWorkspace(ws)
          localStorage.setItem('blockforge_workspace', ws)
        }
        return
      }

      setWorkspaces(list)
      const saved = localStorage.getItem('blockforge_workspace')
      const ws = (saved && list.includes(saved)) ? saved : list[0]
      setActiveWorkspace(ws)
      localStorage.setItem('blockforge_workspace', ws)
    } catch (e) {
      console.error('Error fetching workspaces', e)
    }
  }

  const handleCreateWorkspace = async () => {
    const name = newWorkspaceName.trim()
    if (!name) return
    try {
      const res = await fetch(`${API_BASE}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) { alertDialog('Failed to create workspace'); return }
      const data = await res.json()
      const ws = data.name as string
      setWorkspaces(prev => [...prev, ws])
      setActiveWorkspace(ws)
      localStorage.setItem('blockforge_workspace', ws)
      setNewWorkspaceModal(false)
      setNewWorkspaceName('')
      setSelectedPath(null)
      setActiveView('editor')
    } catch (e) {
      console.error('Error creating workspace', e)
    }
  }

  const handleRenameWorkspace = async () => {
    if (!renameWorkspaceTarget) return
    const newName = renameWorkspaceName.trim()
    if (!newName || newName === renameWorkspaceTarget) return
    try {
      const res = await fetch(`${API_BASE}/api/workspaces/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName: renameWorkspaceTarget, newName }),
      })
      if (!res.ok) { alertDialog('Failed to rename workspace'); return }
      setWorkspaces(prev => prev.map(w => w === renameWorkspaceTarget ? newName : w))
      if (activeWorkspace === renameWorkspaceTarget) {
        setActiveWorkspace(newName)
        localStorage.setItem('blockforge_workspace', newName)
      }
      setRenameWorkspaceTarget(null)
      setRenameWorkspaceName('')
      fetchFiles()
    } catch (e) {
      console.error('Error renaming workspace', e)
    }
  }

  const handleSwitchWorkspace = (ws: string) => {
    setActiveWorkspace(ws)
    localStorage.setItem('blockforge_workspace', ws)
    setWorkspaceDropdownOpen(false)
    setSelectedPath(null)
    setCollapsedPaths({})
    setActiveView('editor')
  }

  const handleToggleFavorite = (path: string) => {
    const next = favorites.includes(path)
      ? favorites.filter(p => p !== path)
      : [path, ...favorites]
    setFavorites(next)
    fetch(`${API_BASE}/api/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: activeWorkspace, favorites: next }),
    }).catch(e => console.error('Failed to save favorites', e))
  }

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`)
      if (res.ok) {
        const data = await res.json()
        if (data && typeof data.history_limit === 'number') {
          setHistoryLimitInput(data.history_limit.toString())
        }
        if (data?.theme === 'dark' || data?.theme === 'light') {
          setTheme(data.theme)
          localStorage.setItem('bf-theme', data.theme)
        }
        if (typeof data?.trash_retention_days === 'number') {
          setTrashRetentionDays(data.trash_retention_days)
          setTrashRetentionInput(data.trash_retention_days.toString())
        }
        if (typeof data?.default_page === 'string' && data.default_page) {
          setDefaultPage(data.default_page)
          // Open default page if no URL hash targeted a specific file
          const hash = window.location.hash
          const hasHashTarget = hash.startsWith('#/') && decodeURIComponent(hash.slice(2)).length > 0
          if (!hasHashTarget) {
            fetchFileContent(data.default_page, true)
          }
        }
        if (typeof data?.sidebar_collapsed === 'boolean') {
          setSidebarCollapsed(data.sidebar_collapsed)
        }
        if (data?.kanban_card_view_mode === 'modal' || data?.kanban_card_view_mode === 'sidebar' || data?.kanban_card_view_mode === 'fullscreen') {
          setKanbanCardViewMode(data.kanban_card_view_mode)
        }
        if (typeof data?.properties_collapsed === 'boolean') {
          setPropertiesCollapsed(data.properties_collapsed)
        }
        if (typeof data?.autosave_delay === 'number' && data.autosave_delay >= 100) {
          setAutosaveDelay(data.autosave_delay)
          setAutosaveDelayInput(data.autosave_delay.toString())
        }
        if (typeof data?.history_interval === 'number' && data.history_interval >= 0) {
          setHistoryInterval(data.history_interval)
          setHistoryIntervalInput(data.history_interval.toString())
        }
        if (typeof data?.sidebar_bg_color === 'string') {
          setSidebarBgColorState(data.sidebar_bg_color)
          localStorage.setItem('bf-sidebar-bg', data.sidebar_bg_color)
        }
        if (typeof data?.sidebar_text_color === 'string') {
          setSidebarTextColorState(data.sidebar_text_color)
          localStorage.setItem('bf-sidebar-text', data.sidebar_text_color)
        }
        if (typeof data?.global_layout_override === 'string') {
          setGlobalLayoutOverride(data.global_layout_override)
          localStorage.setItem('blockforge_global_layout_override', data.global_layout_override)
        }
        if (typeof data?.global_column_width_override === 'string') {
          setGlobalColumnWidthOverride(data.global_column_width_override)
          localStorage.setItem('blockforge_global_column_width_override', data.global_column_width_override)
        }
        if (typeof data?.app_font === 'string') {
          setAppFont(data.app_font)
          localStorage.setItem('blockforge_app_font', data.app_font)
        }
      }
    } catch (e) {
      console.error('Failed to fetch settings', e)
    }
  }

  const saveSidebarCollapsed = async (collapsed: boolean) => {
    setSidebarCollapsed(collapsed)
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebar_collapsed: collapsed }),
      })
    } catch (e) {
      console.error('Failed to save sidebar_collapsed', e)
    }
  }

  const savePropertiesCollapsed = async (collapsed: boolean) => {
    setPropertiesCollapsed(collapsed)
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties_collapsed: collapsed }),
      })
    } catch (e) {
      console.error('Failed to save properties_collapsed', e)
    }
  }

  const saveHistoryInterval = async (minutes: number) => {
    setHistoryInterval(minutes)
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history_interval: minutes }),
      })
    } catch (e) { console.error('Failed to save history_interval', e) }
  }

  const saveAutosaveDelay = async (ms: number) => {
    setAutosaveDelay(ms)
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autosave_delay: ms }),
      })
    } catch (e) { console.error('Failed to save autosave_delay', e) }
  }

  const saveKanbanCardViewMode = async (mode: 'modal' | 'sidebar' | 'fullscreen') => {
    setKanbanCardViewMode(mode)
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kanban_card_view_mode: mode }),
      })
    } catch (e) {
      console.error('Failed to save kanban_card_view_mode', e)
    }
  }

  const saveDefaultPage = async (path: string) => {
    setDefaultPage(path)
    try {
      await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_page: path }),
      })
    } catch (e) {
      console.error('Failed to save default page', e)
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

  const createCheckpoint = (path: string) => {
    fetch(`${API_BASE}/api/file/history/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {})
  }

  const fetchFileContent = async (path: string, skipHistory = false, highlightTerm: string | null = null) => {
    // Checkpoint the file we're navigating away from
    if (selectedPath && selectedPath !== path) {
      createCheckpoint(selectedPath)
    }
    setActiveSearchHighlight(highlightTerm)
    setMobileDrawerOpen(false)
    try {
      const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error('Failed to fetch file content')
      const data = await res.json()
      const { frontMatterStr, body } = splitFrontMatter(data.content)
      setSelectedContent(body)
      setCurrentFrontMatterStr(frontMatterStr)
      setSelectedPath(path)
      revealInSidebar(path)
      setActiveView(data.meta?.type === 'board' ? 'board' : 'editor')
      // Follow the file into its own sidebar section — e.g. opening a Kanban
      // task from search while the Documents panel is showing switches over.
      const section = sectionFromPath(path)
      if (section) {
        setActiveSidebarSection(section)
        if (sidebarCollapsed) saveSidebarCollapsed(false)
      }
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

  // Auth status check on mount
  useEffect(() => {
    fetch('/auth/status', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.bootstrapRequired) {
          setAuthStatus('bootstrap')
        } else if (data.user) {
          setCurrentUser(data.user)
          setAuthStatus('authenticated')
        } else {
          setAuthStatus('unauthenticated')
        }
      })
      .catch(() => setAuthStatus('unauthenticated'))
  }, [])

  const handleLogout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
    setCurrentUser(null)
    setAuthStatus('unauthenticated')
  }

  useEffect(() => {
    if (authStatus !== 'authenticated') return
    fetchWorkspaces()
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
  }, [selectedPath, isSaving, authStatus])

  // Keep ref in sync so the interval timer always checkpoints the current file
  useEffect(() => { selectedPathRef.current = selectedPath }, [selectedPath])

  // Periodic version checkpoint (0 = disabled)
  useEffect(() => {
    if (!historyInterval || historyInterval <= 0) return
    const id = setInterval(() => {
      const path = selectedPathRef.current
      if (path) {
        fetch(`${API_BASE}/api/file/history/checkpoint`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        }).catch(() => {})
      }
    }, historyInterval * 60 * 1000)
    return () => clearInterval(id)
  }, [historyInterval])

  // Checkpoint current file when the tab/window is closed
  useEffect(() => {
    const handler = () => {
      if (selectedPath) {
        navigator.sendBeacon(
          `${API_BASE}/api/file/history/checkpoint`,
          new Blob([JSON.stringify({ path: selectedPath })], { type: 'application/json' })
        )
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [selectedPath])

  // Checkpoint current file whenever the tab is backgrounded — switched away
  // from, minimized, or the OS suspends it (mobile app-switch, laptop lid
  // close). This is the reliable complement to beforeunload: browsers throttle
  // setInterval timers in background tabs and don't always fire beforeunload
  // when a tab is merely hidden or memory-reclaimed rather than truly closed,
  // so a page left open in the background can silently miss both the
  // periodic timer AND the close-window checkpoint. visibilitychange fires
  // promptly regardless of that throttling.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'hidden' && selectedPath) {
        navigator.sendBeacon(
          `${API_BASE}/api/file/history/checkpoint`,
          new Blob([JSON.stringify({ path: selectedPath })], { type: 'application/json' })
        )
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [selectedPath])

  // Scroll selected sidebar item into view after it becomes visible (e.g. after expanding ancestors)
  useEffect(() => {
    if (!selectedPath) return
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-sidebar-path="${selectedPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 80)
    return () => clearTimeout(timer)
  }, [selectedPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore file from URL hash on initial page load
  // (default page on startup is handled inside fetchSettings after the API call resolves)
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#/')) {
      const path = decodeURIComponent(hash.slice(2))
      if (path) fetchFileContent(path, true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle browser back / forward navigation
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const path = e.state?.filePath
      if (path) {
        // Kanban pushes its own history entries (scoped to the same board's
        // filePath) for opening/closing cards without leaving the board —
        // skip the redundant re-fetch when we're already on that file. Uses
        // the ref (not `selectedPath` directly) since this listener is
        // registered once with an empty dependency array.
        if (path !== selectedPathRef.current) fetchFileContent(path, true)
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
      // Match on physical key position (e.code), not e.key — e.key flips to
      // 'K' with Caps Lock on or certain keyboard layouts, silently breaking
      // the exact 'k' string comparison this used to rely on.
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
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
        const url = `${API_BASE}/api/search?q=${encodeURIComponent(searchQuery)}&workspace=${encodeURIComponent(activeWorkspace)}`
        const res = await fetch(url)
        if (res.ok) {
          const data: FileRecord[] = await res.json() || []
          // Client-side guard: keep only files that belong to the active workspace
          const SECTION_ROOTS = new Set(['Documents', 'Tasks', 'Boards', 'Canvas', 'MindMaps'])
          const scoped = data.filter(f =>
            activeWorkspace
              ? f.path.startsWith(activeWorkspace + '/')
              : SECTION_ROOTS.has(f.path.split('/')[0])
          )
          setSearchResults(scoped)
          setSearchSelectedIndex(0)
        }
      } catch (e) {
        console.error('Search query failed', e)
      } finally {
        setIsSearching(false)
      }
    }, 150)

    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery, searchOpen, activeWorkspace])

  useEffect(() => {
    const close = () => {
      setContextMenu(p => p.isOpen ? { ...p, isOpen: false } : p)
      setWorkspaceDropdownOpen(false)
    }
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
      alertDialog('Failed to save file changes to disk.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleMoveCard = async (path: string, newStatus: string) => {
    // Optimistic update — without this, the card would snap back to its old
    // column for the duration of the request, then jump once the refetch
    // lands, producing a visible "flick" right after the drag-and-drop drops it.
    setFiles(prev => prev.map(f => f.path === path ? { ...f, frontMatter: { ...f.frontMatter, status: newStatus } } : f))
    try {
      await fetch(`${API_BASE}/api/file/front-matter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, updates: { status: newStatus } }),
      })
    } catch (e) {
      console.error('Error moving Kanban card', e)
      fetchFiles()
    }
  }

  const handleUpdateFrontMatter = async (path: string, updates: Record<string, any>) => {
    try {
      await fetch(`${API_BASE}/api/file/front-matter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, updates }),
      })
      fetchFiles()
      // currentFrontMatterStr is only captured once when the file is opened
      // (see fetchFileContent) — without refreshing it here, the next body
      // autosave would reconstruct the file from that stale snapshot and
      // silently revert whatever this PATCH just wrote (cover, attachments,
      // tags, status, ...). Only relevant if this is the file currently open
      // in the main editor — Kanban cards keep their own separate snapshot.
      if (path === selectedPathRef.current) {
        const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`)
        if (res.ok) {
          const data = await res.json()
          setCurrentFrontMatterStr(splitFrontMatter(data.content).frontMatterStr)
        }
      }
    } catch (e) { console.error('Error updating front matter', e) }
  }

  const handleCreateTaskWithStatus = async (title: string, status: string) => {
    const sanitizedName = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
    if (!sanitizedName) return

    // Resolve target parent folder from selectedPath (the parent board page)
    let parentFolder = W('Tasks') + '/'
    if (selectedPath) {
      let stem = selectedPath
      if (stem.endsWith('.board.md')) {
        stem = stem.slice(0, -9)
      } else if (stem.endsWith('.md')) {
        stem = stem.slice(0, -3)
      }
      parentFolder = stem + '/'
    }

    const path = `${parentFolder}${sanitizedName}.md`
    const content = `---\ntitle: ${title}\ntype: task\nstatus: ${status}\ntags: []\n---\n`
    try {
      // createOnly: two cards with the same title must not collide — the
      // backend disambiguates the filename instead of overwriting.
      await fetch(`${API_BASE}/api/file`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content, createOnly: true }) })
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
    type: 'document' | 'task' | 'canvas' | 'board' | 'diagram' | 'folder' | 'mindmap' | null,
    parentPath?: string,
    onCreated?: (newPath: string, title: string) => string,
    allowedTypes?: ('document' | 'task' | 'canvas' | 'board' | 'diagram' | 'folder' | 'mindmap')[],
    modeLabel?: string
  ) => {
    subpageCallbackRef.current = onCreated || null
    setCreateModal({ isOpen: true, type, parentPath, allowedTypes, modeLabel })
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
      path = parentPath ? `${parentPath}/${name}.drawio.md` : `${W('Canvas')}/${name}.drawio.md`
      content = `---\ntitle: ${title}\ntype: canvas\neditor: drawio\n---\n\n\`\`\`xml\n<mxfile host="app.diagrams.net"><diagram id="1" name="Page-1"><mxGraphModel dx="1000" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel></diagram></mxfile>\n\`\`\`\n`
    } else if (type === 'board') {
      path = parentPath ? `${parentPath}/${name}.board.md` : `${W('Boards')}/${name}.board.md`
      content = `---\ntitle: ${title}\ntype: board\ncolumns: ["Todo", "In Progress", "Done"]\n---\n`
    } else if (type === 'task') {
      path = parentPath ? `${parentPath}/${name}.md` : `${W('Tasks')}/${name}.md`
      content = `---\ntitle: ${title}\ntype: task\nstatus: Todo\ntags: []\n---\n`
    } else if (type === 'canvas') {
      path = parentPath ? `${parentPath}/${name}.excalidraw.md` : `${W('Canvas')}/${name}.excalidraw.md`
      content = `---\ntitle: ${title}\ntype: canvas\neditor: excalidraw\n---\n\n\`\`\`json\n{\n  "type": "excalidraw",\n  "version": 2,\n  "elements": [],\n  "appState": {"viewBackgroundColor": "#121212","theme": "dark"}\n}\n\`\`\`\n`
    } else if (type === 'mindmap') {
      path = parentPath ? `${parentPath}/${name}.mindmap.md` : `${W('MindMaps')}/${name}.mindmap.md`
      content = `---\ntitle: ${title}\ntype: mindmap\n---\n\n\`\`\`json\n{"nodeData":{"id":"root","topic":"${title}","root":true,"children":[]},"arrows":[],"summaries":[],"direction":2}\n\`\`\`\n`
    } else if (type === 'folder') {
      path = parentPath ? `${parentPath}/${name}.md` : `${W('Documents')}/${name}.md`
      content = `---\ntitle: ${title}\ntype: folder\n---\n`
    } else {
      path = parentPath ? `${parentPath}/${name}.md` : `${W('Documents')}/${name}.md`
      content = `---\ntitle: ${title}\ntype: document\n---\n`
    }

    try {
      const res = await fetch(`${API_BASE}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // createOnly: never clobber an existing file that happens to share
        // this same generated path — the backend disambiguates it instead.
        body: JSON.stringify({ path, content, createOnly: true }),
      })
      if (!res.ok) throw new Error('Failed to create file')
      const data = await res.json()
      const finalPath: string = data?.file?.path || path

      // Save parent link first if subpage was created via editor command
      if (subpageCallbackRef.current && selectedPath) {
        const callback = subpageCallbackRef.current
        subpageCallbackRef.current = null
        const parentNewContent = callback(finalPath, title)
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
      fetchFileContent(finalPath) // also follows the new item into its sidebar section
    } catch (e) {
      console.error('Error creating file', e)
      alertDialog('Failed to create item.')
    }
  }

  const handleDeleteFile = async (path: string) => {
    const fileRecord = files.find(f => f.path === path)
    const fileType = fileRecord?.type
    const isFolder = fileType === 'folder'
    const isBoard = fileType === 'board'
    const label = isFolder ? 'folder and all its contents'
      : isBoard ? 'board and all its tasks'
      : 'file'
    const action = trashRetentionDays > 0 ? 'Move to Trash' : 'Permanently Delete'
    if (!await confirmDialog(`${path}`, { title: `${action}: ${label}?`, confirmLabel: action, danger: true })) return
    try {
      // Always use the file endpoint — the backend now auto-collects children
      // for boards, canvases, and any other type with a same-stem directory.
      const endpoint = isFolder ? 'folder' : 'file'
      const res = await fetch(`${API_BASE}/api/${endpoint}?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Failed to delete ${label}`)
      if (favorites.includes(path)) handleToggleFavorite(path)
      fetchFiles()
      // Navigate away if the open file is the deleted item or a child of it
      const stem = path.endsWith('.board.md') ? path.slice(0, -'.board.md'.length)
        : path.endsWith('.excalidraw.md') ? path.slice(0, -'.excalidraw.md'.length)
        : path.endsWith('.drawio.md') ? path.slice(0, -'.drawio.md'.length)
        : path.endsWith('.mindmap.md') ? path.slice(0, -'.mindmap.md'.length)
        : path.endsWith('.md') ? path.slice(0, -'.md'.length)
        : path
      if (selectedPath === path || selectedPath?.startsWith(stem + '/')) {
        setSelectedPath(null)
        setSelectedContent('')
        setCurrentFrontMatterStr('')
        setActiveView('editor')
        window.history.replaceState(null, '', window.location.pathname)
      }
    } catch (e) { console.error('Error deleting', e) }
  }

  const activeFile = files.find((f) => f.path === selectedPath)

  // Tags from sibling tasks in the same board folder — passed to Editor for autocomplete
  const boardTagsForEditor = React.useMemo(() => {
    if (!selectedPath) return []
    const slash = selectedPath.lastIndexOf('/')
    const folder = slash === -1 ? '' : selectedPath.slice(0, slash + 1)
    const tagSet = new Set<string>()
    files.forEach(f => {
      if (f.path === selectedPath) return
      const fSlash = f.path.lastIndexOf('/')
      const fFolder = fSlash === -1 ? '' : f.path.slice(0, fSlash + 1)
      if (fFolder !== folder) return
      if (!(f.type === 'task' || f.frontMatter?.status)) return
      const raw = f.frontMatter?.tags
      if (!raw) return
      try { (JSON.parse(raw) as string[]).forEach(t => tagSet.add(t)) } catch { /* */ }
    })
    return Array.from(tagSet).sort()
  }, [files, selectedPath])

  // ── Sidebar drag-and-drop state ──────────────────────────────────────────
  const [dragging, setDragging] = useState<{ path: string; type?: string } | null>(null)
  const draggingPath = dragging?.path ?? null
  const draggingType = dragging?.type
  const [dragOverSection, setDragOverSection] = useState<string | null>(null)

  const handleMoveToSectionRoot = async (fromFilePath: string, sectionDir: string) => {
    const fileName = fromFilePath.split('/').pop()!
    const toFilePath = `${sectionDir}/${fileName}`
    if (toFilePath === fromFilePath) return
    try {
      const res = await fetch(`${API_BASE}/api/file/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromFilePath, to: toFilePath }),
      })
      if (!res.ok) throw new Error('Failed to move file')
      fetchFiles()
      if (selectedPath === fromFilePath) fetchFileContent(toFilePath)
    } catch (e) {
      console.error('Error moving file:', e)
      alertDialog('Failed to move item.')
    }
  }

  const handleMoveNode = async (fromFilePath: string, toNode: TreeNode) => {
    if (!toNode.filePath) return
    // Compute destination: the dropped item becomes a child of the target node
    const targetStem = getNodeParentPath(toNode)
    const fileName = fromFilePath.split('/').pop()!
    const toFilePath = `${targetStem}/${fileName}`
    if (toFilePath === fromFilePath) return // already in that folder, no-op

    try {
      const res = await fetch(`${API_BASE}/api/file/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromFilePath, to: toFilePath }),
      })
      if (!res.ok) throw new Error('Failed to move file')
      fetchFiles()
      // If we moved the currently open file, follow it to its new path
      if (selectedPath === fromFilePath) fetchFileContent(toFilePath)
    } catch (e) {
      console.error('Error moving file', e)
      alertDialog('Failed to move item.')
    }
  }

  const handleSidebarReorder = async (fromFilePath: string, relToFilePath: string, pos: 'before' | 'after') => {
    const parentOf = (p: string) => p.split('/').slice(0, -1).join('/')
    const fromParent = parentOf(fromFilePath)
    const toParent = parentOf(relToFilePath)

    if (fromParent === toParent) {
      // Same directory → reorder by position
      const siblings = [...files]
        .filter(f => parentOf(f.path) === fromParent)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

      const fromFile = siblings.find(f => f.path === fromFilePath)
      if (!fromFile) return
      const without = siblings.filter(f => f.path !== fromFilePath)
      const toIdx = without.findIndex(f => f.path === relToFilePath)
      if (toIdx === -1) return
      const insertIdx = pos === 'before' ? toIdx : toIdx + 1
      const newOrder = [...without.slice(0, insertIdx), fromFile, ...without.slice(insertIdx)]
      const updates = newOrder.map((f, idx) => ({ path: f.path, position: idx + 1 }))

      setFiles(prev => {
        const posMap = new Map(updates.map(u => [u.path, u.position]))
        return [...prev].sort((a, b) => {
          const pa = posMap.get(a.path) ?? a.position ?? 0
          const pb = posMap.get(b.path) ?? b.position ?? 0
          return pa - pb
        }).map(f => posMap.has(f.path) ? { ...f, position: posMap.get(f.path)! } : f)
      })

      try {
        await fetch(`${API_BASE}/api/files/reorder`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
      } catch (e) {
        console.error('Reorder failed', e)
        fetchFiles()
      }
    } else {
      // Different directory → move the file to become a peer (sibling) of the target
      const fileName = fromFilePath.split('/').pop()!
      const newPath = toParent ? `${toParent}/${fileName}` : fileName
      if (newPath === fromFilePath) return
      try {
        const res = await fetch(`${API_BASE}/api/file/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fromFilePath, to: newPath }),
        })
        if (!res.ok) throw new Error('Failed to move file')

        // The move handler immediately re-indexes the new path with MAX(position)+1.
        // Compute the desired order among the new siblings and fix the position now.
        const newSiblings = files
          .filter(f => parentOf(f.path) === toParent && f.path !== fromFilePath)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        const toIdx = newSiblings.findIndex(f => f.path === relToFilePath)
        if (toIdx !== -1) {
          const insertIdx = pos === 'before' ? toIdx : toIdx + 1
          const ordered = [
            ...newSiblings.slice(0, insertIdx),
            { path: newPath },
            ...newSiblings.slice(insertIdx),
          ]
          const updates = ordered.map((f, idx) => ({ path: f.path, position: idx + 1 }))
          await fetch(`${API_BASE}/api/files/reorder`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          })
        }

        fetchFiles()
        if (selectedPath === fromFilePath) fetchFileContent(newPath)
      } catch (e) {
        console.error('Error moving file:', e)
        alertDialog('Failed to move item.')
      }
    }
  }

  const handleReorderCards = async (updates: { path: string; position: number }[]) => {
    // Optimistic update
    setFiles(prev => {
      const posMap = new Map(updates.map(u => [u.path, u.position]))
      return prev.map(f => posMap.has(f.path) ? { ...f, position: posMap.get(f.path)! } : f)
    })
    try {
      await fetch(`${API_BASE}/api/files/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    } catch (e) {
      console.error('Card reorder failed', e)
      fetchFiles()
    }
  }

  const handleRenameFile = async (oldPath: string, newTitle: string) => {
    const trimmed = newTitle.trim()
    if (!trimmed || !oldPath) return
    try {
      // Fetch the full file content (frontmatter + body)
      const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(oldPath)}`)
      if (!res.ok) return
      const data = await res.json()
      let fullContent: string = data.content || ''

      // Update `title:` field in frontmatter (first matching line)
      fullContent = fullContent.replace(/^title:.*$/m, `title: ${trimmed}`)

      // Update or insert the first H1 in the body.
      // Three cases:
      //  1. H1 already exists → replace it
      //  2. No H1, but the first body line is the typed title text → promote it to H1
      //  3. No H1 and first line is different (or body is empty) → prepend H1
      const { frontMatterStr, body } = splitFrontMatter(fullContent)
      let updatedBody: string
      if (/^# .+/m.test(body)) {
        updatedBody = body.replace(/^# .+$/m, `# ${trimmed}`)
      } else {
        const firstLineMatch = body.match(/^([^\n]*)/)
        const firstLine = firstLineMatch ? firstLineMatch[1].trim() : ''
        if (firstLine === trimmed) {
          // User typed the title as a plain paragraph — promote it to H1
          updatedBody = `# ${trimmed}${body.slice(firstLine.length)}`
        } else {
          // Body starts with something else (or is empty) — prepend H1
          updatedBody = `# ${trimmed}\n\n${body.trimStart()}`
        }
      }
      fullContent = frontMatterStr
        ? `---\n${frontMatterStr}\n---\n\n${updatedBody}`
        : updatedBody

      // Save the patched content back to the old path
      await fetch(`${API_BASE}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: oldPath, content: fullContent }),
      })

      // Derive new file path from the new title slug
      const slug = trimmed.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
      const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/') + 1) : ''
      const oldFileName = oldPath.split('/').pop()!
      const ext = oldFileName.endsWith('.board.md') ? '.board.md'
        : oldFileName.endsWith('.excalidraw.md') ? '.excalidraw.md'
        : oldFileName.endsWith('.drawio.md') ? '.drawio.md'
        : oldFileName.endsWith('.mindmap.md') ? '.mindmap.md'
        : '.md'
      const newPath = `${dir}${slug}${ext}`

      if (newPath !== oldPath) {
        const moveRes = await fetch(`${API_BASE}/api/file/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: oldPath, to: newPath }),
        })
        if (!moveRes.ok) { alertDialog('Failed to rename file.'); return }
      }

      if (selectedPath === oldPath) {
        // Optimistically update files so activeFile stays defined during transition (prevents welcome-screen flicker)
        setFiles(prev => prev.map(f => f.path === oldPath ? { ...f, path: newPath, title: trimmed } : f))
        setSelectedPath(newPath)
        fetchFileContent(newPath)
      }
      fetchFiles()
    } catch (e) {
      console.error('Error renaming file:', e)
      alertDialog('Failed to rename file.')
    }
  }

  const COMMAND_ITEMS = [
    { id: 'create-doc',     label: 'Create New Document',          icon: <FilePlus size={14} className="text-blue-400" />,    action: () => handleCreateFile('document', W('Documents'), undefined, ['document']) },
    { id: 'create-board',   label: 'Create New Kanban Board',      icon: <LayoutGrid size={14} className="text-rose-400" />,  action: () => handleCreateFile('board', W('Boards'), undefined, ['board']) },
    { id: 'create-canvas',  label: 'Create New Canvas',            icon: <Brush size={14} className="text-emerald-400" />,    action: () => handleCreateFile('canvas', W('Canvas'), undefined, ['canvas', 'diagram']) },
    { id: 'create-mindmap', label: 'Create New Mind Map',          icon: <Brain size={14} className="text-violet-400" />,     action: () => handleCreateFile('mindmap', W('MindMaps'), undefined, ['mindmap']) },
    { id: 'open-settings',  label: 'Open Settings',                icon: <Settings size={14} className="text-slate-400" />,   action: () => setAdminModalOpen(true) },
  ]

  if (authStatus === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm">Loading…</div>
  }
  if (authStatus === 'bootstrap') {
    return <BootstrapScreen onBootstrapped={user => { setCurrentUser(user); setAuthStatus('authenticated') }} />
  }
  if (authStatus === 'unauthenticated') {
    return <LoginScreen onLoggedIn={user => { setCurrentUser(user); setAuthStatus('authenticated') }} />
  }

  return (
    <div className="flex h-screen bg-[#0d1117] text-slate-100 font-sans overflow-hidden app-layout-root bf-root">
      {/* ── Mobile drawer backdrop ───────────────────────────────────────── */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-[999] bg-black/50 md:hidden"
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      {/* Mobile: fixed off-canvas drawer, hidden by default, slides in over content.
          Desktop (md+): back to a normal, always-visible flex column. */}
      <div className={`fixed inset-y-0 left-0 z-[1000] w-[85vw] max-w-[320px] transform transition-transform duration-200 ease-in-out ${mobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'} md:static md:inset-auto md:z-auto md:translate-x-0 md:transition-[width] ${sidebarCollapsed ? 'md:w-16' : 'md:w-80'} bg-[#161b22] border-r border-slate-800 flex no-print bf-sidebar overflow-hidden shrink-0`}>

        {/* ── Level 1: icon rail — always visible ─────────────────────────── */}
        <div className="w-16 shrink-0 flex flex-col h-full items-center pt-4 pb-3 gap-1 border-r border-slate-800/60">
          {/* Logo */}
          <div onClick={() => saveSidebarCollapsed(!sidebarCollapsed)} onMouseEnter={showTooltip(sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar')} onMouseLeave={hideTooltip} className="h-8 w-8 rounded-lg bg-gradient-to-tr from-violet-600 to-blue-500 flex items-center justify-center font-bold text-white shadow-lg text-xs mb-2 shrink-0 cursor-pointer" title="Toggle sidebar panel">BF</div>

          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            title="Search (Ctrl+K)"
            onMouseEnter={showTooltip('Search')} onMouseLeave={hideTooltip}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
          >
            <Search size={16} />
          </button>

          <div className="w-8 border-t border-slate-700/60 my-1 shrink-0" />

          {/* Section icons — monochrome, single accent color when active */}
          {favorites.filter(p => files.some(f => f.path === p)).length > 0 && (() => {
            const active = !sidebarCollapsed && activeSidebarSection === 'favorites'
            return (
              <button
                onClick={() => openSidebarSection('favorites')}
                title="Favorites"
                onMouseEnter={showTooltip('Favorites')} onMouseLeave={hideTooltip}
                style={active ? railGlowStyle(RAIL_GLOW_RGB.favorites) : undefined}
                className={`w-9 h-9 flex items-center justify-center transition-all cursor-pointer ${active ? RAIL_ACTIVE_CLASS : RAIL_INACTIVE_CLASS}`}
              >
                <Star size={16} />
              </button>
            )
          })()}
          {(() => {
            const active = !sidebarCollapsed && activeSidebarSection === 'documents'
            return (
              <button
                onClick={() => openSidebarSection('documents')}
                title="Documents"
                onMouseEnter={showTooltip('Documents')} onMouseLeave={hideTooltip}
                style={active ? railGlowStyle(RAIL_GLOW_RGB.documents) : undefined}
                className={`w-9 h-9 flex items-center justify-center transition-all cursor-pointer ${active ? RAIL_ACTIVE_CLASS : RAIL_INACTIVE_CLASS}`}
              >
                <FileText size={16} />
              </button>
            )
          })()}
          {(() => {
            const active = !sidebarCollapsed && activeSidebarSection === 'boards'
            return (
              <button
                onClick={() => openSidebarSection('boards')}
                title="Boards"
                onMouseEnter={showTooltip('Boards')} onMouseLeave={hideTooltip}
                style={active ? railGlowStyle(RAIL_GLOW_RGB.boards) : undefined}
                className={`w-9 h-9 flex items-center justify-center transition-all cursor-pointer ${active ? RAIL_ACTIVE_CLASS : RAIL_INACTIVE_CLASS}`}
              >
                <ListChecks size={16} />
              </button>
            )
          })()}
          {(() => {
            const active = !sidebarCollapsed && activeSidebarSection === 'canvas'
            return (
              <button
                onClick={() => openSidebarSection('canvas')}
                title="Canvas"
                onMouseEnter={showTooltip('Canvas')} onMouseLeave={hideTooltip}
                style={active ? railGlowStyle(RAIL_GLOW_RGB.canvas) : undefined}
                className={`w-9 h-9 flex items-center justify-center transition-all cursor-pointer ${active ? RAIL_ACTIVE_CLASS : RAIL_INACTIVE_CLASS}`}
              >
                <Presentation size={16} />
              </button>
            )
          })()}
          {(() => {
            const active = !sidebarCollapsed && activeSidebarSection === 'mindmaps'
            return (
              <button
                onClick={() => openSidebarSection('mindmaps')}
                title="Mind Maps"
                onMouseEnter={showTooltip('Mind Maps')} onMouseLeave={hideTooltip}
                style={active ? railGlowStyle(RAIL_GLOW_RGB.mindmaps) : undefined}
                className={`w-9 h-9 flex items-center justify-center transition-all cursor-pointer ${active ? RAIL_ACTIVE_CLASS : RAIL_INACTIVE_CLASS}`}
              >
                <BrainCircuit size={16} />
              </button>
            )
          })()}

          <div className="flex-1" />

          <div className="w-8 border-t border-slate-700/60 mb-1 shrink-0" />

          {/* Bottom actions */}
          <button
            onClick={() => setAdminModalOpen(true)}
            title="Settings"
            onMouseEnter={showTooltip('Settings')} onMouseLeave={hideTooltip}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:text-violet-400 transition cursor-pointer"
          >
            <Settings size={15} />
          </button>
          <button
            onClick={() => setShowTrash(true)}
            title="Trash"
            onMouseEnter={showTooltip('Trash')} onMouseLeave={hideTooltip}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-400 transition cursor-pointer"
          >
            <Trash2 size={15} />
          </button>
          <button
            onClick={() => setActiveView(v => v === 'graph' ? 'editor' : 'graph')}
            title="Knowledge Graph"
            onMouseEnter={showTooltip('Knowledge Graph')} onMouseLeave={hideTooltip}
            style={activeView === 'graph' ? railGlowStyle(RAIL_GLOW_RGB.graph) : undefined}
            className={`w-9 h-9 flex items-center justify-center transition-all cursor-pointer ${
              activeView === 'graph' ? RAIL_ACTIVE_CLASS : 'rounded-lg text-slate-300 hover:text-violet-400'
            }`}
          >
            <Network size={15} />
          </button>

          {/* Sync/vault status — lives on the rail (not the collapsible panel
              below) since the rail is always visible regardless of panel
              collapse state; a status indicator that can disappear isn't
              much of a status indicator. */}
          <div
            className="w-9 h-9 flex items-center justify-center"
            title={isSyncing ? 'Syncing Vault…' : syncError ? 'Vault Offline' : 'Vault Online — Sync Active'}
            onMouseEnter={showTooltip(isSyncing ? 'Syncing Vault…' : syncError ? 'Vault Offline' : 'Vault Online — Sync Active')} onMouseLeave={hideTooltip}
          >
            {isSyncing ? (
              <Loader2 size={14} className="animate-spin text-amber-500" />
            ) : syncError ? (
              <AlertCircle size={14} className="text-red-400" />
            ) : (
              <CloudLightning size={14} className="text-emerald-500" />
            )}
          </div>

          <div className="w-8 border-t border-slate-700/60 my-1 shrink-0" />

          {/* Panel toggle */}
          <button
            onClick={() => saveSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expand panel' : 'Collapse panel'}
            onMouseEnter={showTooltip(sidebarCollapsed ? 'Expand Panel' : 'Collapse Panel')} onMouseLeave={hideTooltip}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
          >
            <ChevronRight size={16} className={`transition-transform ${sidebarCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        {/* ── Level 2: section panel ──────────────────────────────────────── */}
        {!sidebarCollapsed && <div className="w-64 shrink-0 flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b border-slate-800 bf-sidebar-header">
            <h1 className="font-bold text-sm tracking-tight">
              {activeSidebarSection === 'mindmaps' ? 'Mind Maps' : activeSidebarSection.charAt(0).toUpperCase() + activeSidebarSection.slice(1)}
            </h1>
            {/* Workspace switcher */}
            <div className="mt-3 relative">
              <button
                onClick={e => { e.stopPropagation(); setWorkspaceDropdownOpen(o => !o) }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] border border-slate-800 hover:border-violet-500/50 rounded-lg text-xs transition cursor-pointer group bf-ws-trigger"
              >
                <span className="flex items-center gap-1.5 text-slate-300 font-medium truncate">
                  <Layers size={11} className="text-violet-400 shrink-0" />
                  <span className="truncate">{activeWorkspace || 'No Workspace'}</span>
                </span>
                <ChevronDown size={11} className="text-slate-500 group-hover:text-slate-300 transition shrink-0" />
              </button>
              {workspaceDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1c2433] border border-slate-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden bf-ws-dropdown">
                  {workspaces.map(ws => (
                    <div key={ws} className="flex items-center group/ws">
                      <button
                        onClick={e => { e.stopPropagation(); handleSwitchWorkspace(ws) }}
                        className={`flex-1 text-left px-3 py-1.5 text-xs hover:bg-slate-700/50 transition cursor-pointer flex items-center gap-2 min-w-0 ${ws === activeWorkspace ? 'text-violet-400 font-semibold' : 'text-slate-300'}`}
                      >
                        <Layers size={10} className={ws === activeWorkspace ? 'text-violet-400' : 'text-slate-500'} shrink-0 />
                        <span className="truncate">{ws}</span>
                        {ws === activeWorkspace && <span className="text-[9px] text-violet-500 shrink-0">active</span>}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setWorkspaceDropdownOpen(false); setRenameWorkspaceTarget(ws); setRenameWorkspaceName(ws) }}
                        className="pr-2 pl-1 py-1.5 text-slate-600 hover:text-slate-300 opacity-0 group-hover/ws:opacity-100 transition cursor-pointer shrink-0"
                        title="Rename workspace"
                      >
                        <Pencil size={10} />
                      </button>
                    </div>
                  ))}
                  <div className="border-t border-slate-700/60 mt-1 pt-1">
                    <button
                      onClick={e => { e.stopPropagation(); setWorkspaceDropdownOpen(false); setNewWorkspaceModal(true) }}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-violet-400 hover:bg-slate-700/30 transition cursor-pointer flex items-center gap-2"
                    >
                      <Plus size={10} />
                      New Workspace
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-3 pt-3 pb-1">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center justify-between px-3 py-1.5 bg-[#0d1117] border border-slate-800 hover:border-slate-700 rounded-lg text-xs transition text-slate-400 hover:text-slate-200 cursor-pointer select-none bf-search-trigger"
            >
              <div className="flex items-center gap-2">
                <Search size={14} className="text-slate-500" />
                <span>Search...</span>
              </div>
              <span className="text-[9px] bg-[#161b22] px-1 py-0.5 rounded font-mono border border-slate-800 text-slate-500">Ctrl+K</span>
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 no-scrollbar">
          <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${activeWorkspace}::${activeSidebarSection}`}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.16, ease: 'easeInOut' }}
            className="space-y-4"
          >
            {/* ── Favorites ──────────────────────────────────────────────── */}
            {activeSidebarSection === 'favorites' && favorites.filter(p => files.some(f => f.path === p)).length > 0 && (
              <div className="space-y-1">
                <div
                  className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex justify-between items-center rounded-lg transition text-slate-500 select-none"
                >
                  <span className="flex items-center gap-1.5">
                    <Star size={12} className="text-amber-400 fill-amber-400/30" />
                    Favorites
                  </span>
                  <button
                    onClick={() => setFavoritesCollapsed(p => !p)}
                    className="hover:text-white transition cursor-pointer"
                    title={favoritesCollapsed ? 'Expand' : 'Collapse'}
                  >
                    {favoritesCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {!favoritesCollapsed && (
                    <motion.div
                      key="fav-list"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeInOut' }}
                      style={{ overflow: 'hidden' }}
                      className="space-y-0.5 pl-1.5"
                    >
                      {favorites.map(path => {
                        const file = files.find(f => f.path === path)
                        if (!file) return null
                        const isSelected = selectedPath === path
                        return (
                          <div
                            key={path}
                            onClick={() => fetchFileContent(path)}
                            className={`flex items-center justify-between group/fav py-1 px-2 rounded-lg text-xs transition bf-tree-item cursor-pointer ${isSelected ? 'selected' : 'text-slate-300 hover:bg-slate-800/40'}`}
                            style={{ paddingLeft: '14px' }}
                          >
                            <div className="flex items-center gap-1.5 truncate min-w-0">
                              {getFileTypeIcon(file.type, file.frontMatter?.editor)}
                              <span className="truncate ml-0.5">{file.title}</span>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); handleToggleFavorite(path) }}
                              className="opacity-0 group-hover/fav:opacity-100 p-0.5 hover:bg-red-900/40 hover:text-red-400 rounded text-slate-500 transition cursor-pointer shrink-0 ml-1"
                              title="Remove from Favorites"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="border-b border-slate-800/60 mx-1 pt-1" />
              </div>
            )}

            {/* Menu 1 - Documents */}
            {activeSidebarSection === 'documents' && (
            <div className="space-y-1">
              <div
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex justify-between items-center group rounded-lg transition ${
                  dragOverSection === 'documents' ? 'text-violet-400 bg-violet-600/15 border border-violet-500/40' : 'text-slate-500'
                }`}
                onDragOver={(e) => {
                  if (!draggingPath) return
                  const allowed = SECTION_ALLOWED_TYPES.documents
                  if (draggingType && !allowed.includes(draggingType)) return
                  e.preventDefault()
                  e.stopPropagation()
                  setDragOverSection('documents')
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSection(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverSection(null)
                  if (draggingPath) handleMoveToSectionRoot(draggingPath, W('Documents'))
                }}
              >
                <span className="flex items-center gap-1.5">
                  <FileText size={12} className="text-blue-400" />
                  Documents
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => toggleSectionCollapse([W('Documents')])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title={isSectionExpanded([W('Documents')]) ? 'Collapse all' : 'Expand all'}
                  >
                    {isSectionExpanded([W('Documents')]) ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
                  </button>
                  <button
                    onClick={() => handleCreateFile('folder', W('Documents'), undefined, ['folder'])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title="New Folder"
                  >
                    <FolderPlus size={12} />
                  </button>
                  <button
                    onClick={() => handleCreateFile('document', W('Documents'), undefined, ['document'])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title="New Document"
                  >
                    <Plus size={12} />
                  </button>
                </span>
              </div>
              <div className="space-y-0.5 pl-1.5">
                {getCategoryChildren(files, W('Documents'), ['document', 'folder']).length === 0 ? (
                  <div className="px-3 py-1 text-[11px] text-slate-600 italic select-none">No documents</div>
                ) : (
                  getCategoryChildren(files, W('Documents'), ['document', 'folder']).map((node) => (
                    <TreeNodeComponent
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={selectedPath}
                      collapsedPaths={collapsedPaths}
                      onToggleCollapse={(path) => setCollapsedPaths((prev) => ({ ...prev, [path]: !prev[path] }))}
                      onSelectFile={fetchFileContent}
                      onCreateSubPage={(parentPath) => handleCreateFile('document', parentPath, undefined, ['document'], 'Sub Page')}
                      onDeletePath={handleDeleteFile}
                      onContextMenu={(e, targetNode) => {
                        e.preventDefault()
                        setContextMenu({
                          isOpen: true,
                          x: e.clientX,
                          y: e.clientY,
                          path: targetNode.filePath || targetNode.path,
                          isFolder: targetNode.isFolder,
                          sectionType: 'documents',
                          nodeType: targetNode.type,
                        })
                      }}
                      draggingPath={draggingPath}
                      draggingType={draggingType}
                      sectionType="documents"
                      onDragStart={(p, t) => setDragging({ path: p, type: t })}
                      onDragEnd={() => setDragging(null)}
                      onDropNode={handleMoveNode}
                      onReorderNode={handleSidebarReorder}
                    />
                  ))
                )}
              </div>
            </div>
            )}

            {/* Menu 2 - Kanban Boards */}
            {activeSidebarSection === 'boards' && (
            <div className="space-y-1">
              <div
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex justify-between items-center group rounded-lg transition ${
                  dragOverSection === 'boards' ? 'text-violet-400 bg-violet-600/15 border border-violet-500/40' : 'text-slate-500'
                }`}
                onDragOver={(e) => {
                  if (!draggingPath) return
                  const allowed = SECTION_ALLOWED_TYPES.boards
                  if (draggingType && !allowed.includes(draggingType)) return
                  e.preventDefault()
                  e.stopPropagation()
                  setDragOverSection('boards')
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSection(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverSection(null)
                  if (draggingPath) handleMoveToSectionRoot(draggingPath, W('Boards'))
                }}
              >
                <span className="flex items-center gap-1.5">
                  <LayoutGrid size={12} className="text-amber-400" />
                  Kanban Boards
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => toggleSectionCollapse([W('Boards'), W('Tasks')])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title={isSectionExpanded([W('Boards'), W('Tasks')]) ? 'Collapse all' : 'Expand all'}
                  >
                    {isSectionExpanded([W('Boards'), W('Tasks')]) ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
                  </button>
                  <button
                    onClick={() => handleCreateFile('folder', W('Boards'), undefined, ['folder'])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title="New Folder"
                  >
                    <FolderPlus size={12} />
                  </button>
                  <button
                    onClick={() => handleCreateFile('board', W('Boards'), undefined, ['board'])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title="New Kanban Board"
                  >
                    <Plus size={12} />
                  </button>
                </span>
              </div>
              <div className="space-y-0.5 pl-1.5">
                {getBoardChildren(files, activeWorkspace).length === 0 ? (
                  <div className="px-3 py-1 text-[11px] text-slate-600 italic select-none">No boards</div>
                ) : (
                  getBoardChildren(files, activeWorkspace).map((node) => (
                    <TreeNodeComponent
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={selectedPath}
                      collapsedPaths={collapsedPaths}
                      onToggleCollapse={(path) => setCollapsedPaths((prev) => ({ ...prev, [path]: !prev[path] }))}
                      onSelectFile={fetchFileContent}
                      onCreateSubPage={(parentPath) => handleCreateFile('task', parentPath, undefined, ['task'])}
                      onDeletePath={handleDeleteFile}
                      onContextMenu={(e, targetNode) => {
                        e.preventDefault()
                        setContextMenu({
                          isOpen: true,
                          x: e.clientX,
                          y: e.clientY,
                          path: targetNode.filePath || targetNode.path,
                          isFolder: targetNode.isFolder,
                          sectionType: 'boards',
                          nodeType: targetNode.type,
                        })
                      }}
                      draggingPath={draggingPath}
                      draggingType={draggingType}
                      sectionType="boards"
                      onDragStart={(p, t) => setDragging({ path: p, type: t })}
                      onDragEnd={() => setDragging(null)}
                      onDropNode={handleMoveNode}
                      onReorderNode={handleSidebarReorder}
                    />
                  ))
                )}
              </div>
            </div>
            )}

            {/* Menu 3 - Canvas */}
            {activeSidebarSection === 'canvas' && (
            <div className="space-y-1">
              <div
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex justify-between items-center group rounded-lg transition ${
                  dragOverSection === 'canvas' ? 'text-violet-400 bg-violet-600/15 border border-violet-500/40' : 'text-slate-500'
                }`}
                onDragOver={(e) => {
                  if (!draggingPath) return
                  const allowed = SECTION_ALLOWED_TYPES.canvas
                  if (draggingType && !allowed.includes(draggingType)) return
                  e.preventDefault()
                  e.stopPropagation()
                  setDragOverSection('canvas')
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSection(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverSection(null)
                  if (draggingPath) handleMoveToSectionRoot(draggingPath, W('Canvas'))
                }}
              >
                <span className="flex items-center gap-1.5">
                  <img src={iconCanvasMenu} alt="" className="w-3 h-3 shrink-0 object-contain" />
                  Canvas
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => toggleSectionCollapse([W('Canvas')])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title={isSectionExpanded([W('Canvas')]) ? 'Collapse all' : 'Expand all'}
                  >
                    {isSectionExpanded([W('Canvas')]) ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
                  </button>
                  <button
                    onClick={() => handleCreateFile('folder', W('Canvas'), undefined, ['folder'])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title="New Folder"
                  >
                    <FolderPlus size={12} />
                  </button>
                  <button
                    onClick={() => handleCreateFile('canvas', W('Canvas'), undefined, ['canvas', 'diagram'])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title="New Canvas"
                  >
                    <Plus size={12} />
                  </button>
                </span>
              </div>
              <div className="space-y-0.5 pl-1.5">
                {getCategoryChildren(files, W('Canvas'), ['canvas', 'folder']).length === 0 ? (
                  <div className="px-3 py-1 text-[11px] text-slate-600 italic select-none">No canvases</div>
                ) : (
                  getCategoryChildren(files, W('Canvas'), ['canvas', 'folder']).map((node) => (
                    <TreeNodeComponent
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={selectedPath}
                      collapsedPaths={collapsedPaths}
                      onToggleCollapse={(path) => setCollapsedPaths((prev) => ({ ...prev, [path]: !prev[path] }))}
                      onSelectFile={fetchFileContent}
                      onCreateSubPage={(parentPath) => handleCreateFile('canvas', parentPath, undefined, ['canvas', 'diagram'])}
                      onDeletePath={handleDeleteFile}
                      onContextMenu={(e, targetNode) => {
                        e.preventDefault()
                        setContextMenu({
                          isOpen: true,
                          x: e.clientX,
                          y: e.clientY,
                          path: targetNode.filePath || targetNode.path,
                          isFolder: targetNode.isFolder,
                          sectionType: 'canvas',
                          nodeType: targetNode.type,
                        })
                      }}
                      draggingPath={draggingPath}
                      draggingType={draggingType}
                      sectionType="canvas"
                      onDragStart={(p, t) => setDragging({ path: p, type: t })}
                      onDragEnd={() => setDragging(null)}
                      onDropNode={handleMoveNode}
                      onReorderNode={handleSidebarReorder}
                    />
                  ))
                )}
              </div>
            </div>
            )}

            {/* Menu 4 - Mind Maps */}
            {activeSidebarSection === 'mindmaps' && (
            <div className="space-y-1">
              <div
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider flex justify-between items-center group rounded-lg transition ${
                  dragOverSection === 'mindmaps' ? 'text-violet-400 bg-violet-600/15 border border-violet-500/40' : 'text-slate-500'
                }`}
                onDragOver={(e) => {
                  if (!draggingPath) return
                  const allowed = SECTION_ALLOWED_TYPES.mindmaps
                  if (draggingType && !allowed.includes(draggingType)) return
                  e.preventDefault()
                  e.stopPropagation()
                  setDragOverSection('mindmaps')
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverSection(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverSection(null)
                  if (draggingPath) handleMoveToSectionRoot(draggingPath, W('MindMaps'))
                }}
              >
                <span className="flex items-center gap-1.5">
                  <Brain size={12} className="text-violet-400" />
                  Mind Maps
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => toggleSectionCollapse([W('MindMaps')])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title={isSectionExpanded([W('MindMaps')]) ? 'Collapse all' : 'Expand all'}
                  >
                    {isSectionExpanded([W('MindMaps')]) ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
                  </button>
                  <button
                    onClick={() => handleCreateFile('folder', W('MindMaps'), undefined, ['folder'])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title="New Folder"
                  >
                    <FolderPlus size={12} />
                  </button>
                  <button
                    onClick={() => handleCreateFile('mindmap', W('MindMaps'), undefined, ['mindmap'])}
                    className="hover:text-white text-slate-500 transition cursor-pointer"
                    title="New Mind Map"
                  >
                    <Plus size={12} />
                  </button>
                </span>
              </div>
              <div className="space-y-0.5 pl-1.5">
                {getCategoryChildren(files, W('MindMaps'), ['mindmap', 'folder']).length === 0 ? (
                  <div className="px-3 py-1 text-[11px] text-slate-600 italic select-none">No mind maps</div>
                ) : (
                  getCategoryChildren(files, W('MindMaps'), ['mindmap', 'folder']).map((node) => (
                    <TreeNodeComponent
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={selectedPath}
                      collapsedPaths={collapsedPaths}
                      onToggleCollapse={(path) => setCollapsedPaths((prev) => ({ ...prev, [path]: !prev[path] }))}
                      onSelectFile={fetchFileContent}
                      onCreateSubPage={(parentPath) => handleCreateFile('mindmap', parentPath, undefined, ['mindmap'])}
                      onDeletePath={handleDeleteFile}
                      onContextMenu={(e, targetNode) => {
                        e.preventDefault()
                        setContextMenu({
                          isOpen: true,
                          x: e.clientX,
                          y: e.clientY,
                          path: targetNode.filePath || targetNode.path,
                          isFolder: targetNode.isFolder,
                          sectionType: 'mindmaps',
                          nodeType: targetNode.type,
                        })
                      }}
                      draggingPath={draggingPath}
                      draggingType={draggingType}
                      sectionType="mindmaps"
                      onDragStart={(p, t) => setDragging({ path: p, type: t })}
                      onDragEnd={() => setDragging(null)}
                      onDropNode={handleMoveNode}
                      onReorderNode={handleSidebarReorder}
                    />
                  ))
                )}
              </div>
            </div>
            )}
          </motion.div>
          </AnimatePresence>
          </div>

          <div className="p-4 border-t border-slate-800 bg-[#161b22]/50 space-y-3 bf-sidebar-footer">
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => handleCreateFile('document', W('Documents'), undefined, ['document'])}
              className="flex flex-col items-center justify-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition text-[10px] font-semibold cursor-pointer bf-quick-create-btn"
            >
              <FilePlus size={16} className="text-blue-400 mb-1" />
              Doc
            </button>
            <button
              onClick={() => handleCreateFile('board', W('Boards'), undefined, ['board'])}
              className="flex flex-col items-center justify-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition text-[10px] font-semibold cursor-pointer bf-quick-create-btn"
            >
              <LayoutGrid size={16} className="text-amber-500 mb-1" />
              Board
            </button>
            <button
              onClick={() => handleCreateFile('canvas', W('Canvas'), undefined, ['canvas', 'diagram'])}
              className="flex flex-col items-center justify-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition text-[10px] font-semibold cursor-pointer bf-quick-create-btn"
            >
              <Brush size={16} className="text-emerald-400 mb-1" />
              Canvas
            </button>
            <button
              onClick={() => handleCreateFile('mindmap', W('MindMaps'), undefined, ['mindmap'])}
              className="flex flex-col items-center justify-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition text-[10px] font-semibold cursor-pointer bf-quick-create-btn"
            >
              <Brain size={16} className="text-violet-400 mb-1" />
              Map
            </button>
          </div>

          {currentUser && (
            <div className="flex items-center justify-between text-[10px] border-t border-slate-800/60 pt-2 mb-1">
              <span className="text-slate-500 truncate max-w-[120px]">{currentUser.username}</span>
              <button onClick={handleLogout} title="Sign out" className="flex items-center gap-1 text-slate-600 hover:text-red-400 transition cursor-pointer">
                <LogOut size={10} />
                <span>Sign out</span>
              </button>
            </div>
          )}
          </div>
        </div>}
      </div>

      {/* ── Mobile top bar — hamburger + current page title, hidden on desktop ── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-[500] h-12 flex items-center gap-3 px-3 bg-[#161b22] border-b border-slate-800 no-print">
        <button
          onClick={() => { setMobileDrawerOpen(true); if (sidebarCollapsed) saveSidebarCollapsed(false) }}
          className="p-2 -ml-1 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition cursor-pointer shrink-0"
          title="Open menu"
        >
          <Menu size={18} />
        </button>
        <span className="text-sm font-semibold text-slate-200 truncate">{activeFile?.title || 'BlockForgeMD'}</span>
      </div>

      {/* ── Main Panel ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0d1117] bf-main pt-12 md:pt-0">
        <AnimatePresence mode="wait" initial={false}>
          {activeView === 'graph' ? (
            <motion.div
              key="graph"
              className="flex-1 overflow-hidden flex flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <GraphView
                workspace={activeWorkspace}
                currentPath={selectedPath}
                onSelectFile={(path) => { fetchFileContent(path); setActiveView('editor') }}
              />
            </motion.div>
          ) : activeView === 'board' && !selectedPath ? (
            <motion.div
              key="board-empty"
              className="flex-1 flex flex-col justify-center items-center text-slate-400 p-12"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
            >
              <div className="max-w-md w-full bg-[#161b22]/40 border border-slate-800/80 rounded-2xl p-8 backdrop-blur-md shadow-2xl flex flex-col items-center text-center">
                <div className="h-16 w-16 bg-rose-600/10 border border-rose-500/25 rounded-2xl flex items-center justify-center text-rose-400 shadow-xl shadow-rose-500/5 mb-6">
                  <LayoutGrid size={32} />
                </div>
                <h2 className="text-xl font-bold text-slate-100 mb-2">No Kanban board yet</h2>
                <p className="text-sm text-slate-400 mb-6">This workspace doesn't have a board. Create one to start adding tasks — tasks only appear on the board that owns them.</p>
                <button
                  onClick={() => handleCreateFile('board', W('Boards'), undefined, ['board'])}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition cursor-pointer text-xs font-semibold"
                >
                  <Plus size={14} />
                  Create your first Kanban board
                </button>
              </div>
            </motion.div>
          ) : activeView === 'board' ? (
            <motion.div
              key="board"
              className="flex-1 p-0 md:p-6 overflow-y-auto overflow-x-hidden md:overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <Kanban
                files={files}
                onMoveCard={handleMoveCard}
                onSelectFile={fetchFileContent}
                onCreateTaskInColumn={handleCreateTaskWithStatus}
                boardPath={selectedPath ?? null}
                boardColumns={
                  activeFile?.frontMatter?.columns
                    ? (() => { try { return JSON.parse(activeFile.frontMatter.columns) } catch { return defaultColumns } })()
                    : defaultColumns
                }
                onUpdateColumns={
                  selectedPath
                    ? (newCols) => handleUpdateBoardColumns(selectedPath, newCols)
                    : undefined
                }
                boardFrontMatter={activeFile?.frontMatter}
                onUpdateBoardFrontMatter={selectedPath ? (updates) => handleUpdateFrontMatter(selectedPath, updates) : undefined}
                onUpdateTaskFrontMatter={(path, updates) => handleUpdateFrontMatter(path, updates)}
                onReorderCards={handleReorderCards}
                onDeleteCard={handleDeleteFile}
                onRenameBoard={selectedPath ? async (newName: string) => {
                  const parts = selectedPath.split('/')
                  parts[parts.length - 1] = newName + '.board.md'
                  const newPath = parts.join('/')
                  await fetch(`${API_BASE}/api/file/move`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from: selectedPath, to: newPath }),
                  })
                  await fetchFiles()
                  fetchFileContent(newPath)
                } : undefined}
                onCardSaved={fetchFiles}
                initialCardViewMode={kanbanCardViewMode}
                onSaveCardViewMode={saveKanbanCardViewMode}
                initialPropertiesCollapsed={propertiesCollapsed}
                isMobile={isMobile}
              />
            </motion.div>
          ) : selectedPath && activeFile ? (
            <motion.div
              key={`editor-${selectedPath}`}
              className="flex-1 p-0 md:p-6 flex flex-col overflow-hidden main-content-pane"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
            >
              <div className="flex justify-between items-center mb-4 no-print">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <button onClick={() => { setSelectedPath(null); setSelectedContent(''); setCurrentFrontMatterStr(''); setActiveView('editor') }} className="hover:text-violet-400 hover:underline transition">Home</button>
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
                {activeFile.type === 'mindmap' ? (
                  <MindMap filePath={selectedPath} onSave={handleSaveFile} isSaving={isSaving} theme={theme} />
                ) : activeFile.type === 'canvas' && activeFile.frontMatter?.editor === 'drawio' ? (
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
                    onTitleChange={(newTitle) => handleRenameFile(selectedPath, newTitle)}
                    boardColumns={defaultColumns}
                    onCreateSubPage={(parentPath, onCreated) => handleCreateFile('document', parentPath, onCreated, ['document'], 'Sub Page')}
                    onSelectFile={fetchFileContent}
                    files={files}
                    boardTags={boardTagsForEditor}
                    globalLayoutOverride={globalLayoutOverride}
                    globalColumnWidthOverride={globalColumnWidthOverride}
                    highlightSearchTerm={activeSearchHighlight}
                    onClearSearchHighlight={() => setActiveSearchHighlight(null)}
                    initialPropertiesCollapsed={propertiesCollapsed}
                    onSavePropertiesCollapsed={savePropertiesCollapsed}
                    autosaveDelay={autosaveDelay}
                  />
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="welcome"
              className="flex-1 flex flex-col justify-center items-center text-slate-400 p-12"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
            >
              <div className="max-w-md w-full bg-[#161b22]/40 border border-slate-800/80 rounded-2xl p-8 backdrop-blur-md shadow-2xl flex flex-col items-center text-center">
                <div className="h-16 w-16 bg-violet-600/10 border border-violet-500/25 rounded-2xl flex items-center justify-center text-violet-400 shadow-xl shadow-violet-500/5 mb-6">
                  <Layers size={32} />
                </div>
                <h2 className="text-xl font-bold text-slate-100 mb-2">Welcome to BlockForgeMD</h2>
                <p className="text-sm text-slate-400 mb-6">Your local-first knowledge base. Every note lives as plain Markdown on disk — portable, open, and fully yours.</p>
                <div className="w-full space-y-3">
                  <button
                    onClick={() => handleCreateFile('board', W('Boards'), undefined, ['board'])}
                    className="w-full flex items-center justify-between px-4 py-3 bg-[#161b22] hover:bg-slate-800 border border-slate-800 rounded-xl transition text-left cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <LayoutGrid size={16} className="text-violet-400" />
                      <div>
                        <div className="font-semibold text-slate-200">Create Kanban Board</div>
                        <div className="text-[10px] text-slate-500">Boards are independent — pick one from the sidebar</div>
                      </div>
                    </div>
                    <ArrowRight size={14} className="text-slate-500" />
                  </button>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <button onClick={() => handleCreateFile('document', W('Documents'), undefined, ['document'])} className="flex flex-col items-center justify-center p-4 bg-[#161b22]/50 hover:bg-slate-800 border border-slate-800 rounded-xl transition cursor-pointer">
                      <FileText size={20} className="text-blue-400 mb-2" />
                      <span className="font-semibold text-slate-300">Document</span>
                    </button>
                    <button onClick={() => handleCreateFile('canvas', W('Canvas'), undefined, ['canvas', 'diagram'])} className="flex flex-col items-center justify-center p-4 bg-[#161b22]/50 hover:bg-slate-800 border border-slate-800 rounded-xl transition cursor-pointer">
                      <Brush size={20} className="text-emerald-400 mb-2" />
                      <span className="font-semibold text-slate-300">Canvas</span>
                    </button>
                    <button onClick={() => handleCreateFile('mindmap', W('MindMaps'), undefined, ['mindmap'])} className="flex flex-col items-center justify-center p-4 bg-[#161b22]/50 hover:bg-slate-800 border border-slate-800 rounded-xl transition cursor-pointer">
                      <Brain size={20} className="text-violet-400 mb-2" />
                      <span className="font-semibold text-slate-300">Mind Map</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Creation Modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
      {createModal.isOpen && (() => {
        const TYPE_LABEL_MAP: Record<string, string> = {
          document: 'Document',
          task: 'Task',
          canvas: 'Excalidraw Canvas',
          diagram: 'Draw.io Diagram',
          board: 'Kanban Board',
          folder: 'Folder',
          mindmap: 'Mind Map',
        }
        const ALL_TYPE_ITEMS = [
          { id: 'document', label: 'Document',   icon: <FileText    size={16} className="text-blue-400"    /> },
          { id: 'task',     label: 'Task',        icon: <CheckSquare size={16} className="text-amber-500"   /> },
          { id: 'canvas',   label: 'Excalidraw',  icon: <Brush       size={16} className="text-emerald-400" /> },
          { id: 'diagram',  label: 'Draw.io',     icon: <Grid        size={16} className="text-violet-400"  /> },
          { id: 'board',    label: 'Board',        icon: <LayoutGrid  size={16} className="text-rose-400"    /> },
          { id: 'mindmap',  label: 'Mind Map',    icon: <Brain       size={16} className="text-violet-400"  /> },
          { id: 'folder',   label: 'Folder',      icon: <Folder      size={16} className="text-slate-400"   /> },
        ]
        const visibleTypes = createModal.allowedTypes
          ? ALL_TYPE_ITEMS.filter(item => createModal.allowedTypes!.includes(item.id as any))
          : ALL_TYPE_ITEMS
        const isSingleType = visibleTypes.length === 1
        const folderName = createModal.parentPath?.split('/').pop()
        const singleLabel = isSingleType ? TYPE_LABEL_MAP[visibleTypes[0].id] : null
        const effectiveLabel = createModal.modeLabel || singleLabel
        const modalTitle = createModal.parentPath
          ? effectiveLabel
            ? `New ${effectiveLabel} in "${folderName}"`
            : `New item in "${folderName}"`
          : effectiveLabel
          ? `New ${effectiveLabel}`
          : 'Create New Item'

        return (
          <motion.div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[1200] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className="bg-[#161b22] border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 overflow-hidden"
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-base text-slate-100">{modalTitle}</h3>
                <button onClick={() => setCreateModal({ isOpen: false, type: null })} className="text-slate-500 hover:text-slate-300 transition cursor-pointer">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Only show type picker when there's more than one option */}
                {!isSingleType && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Select Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {visibleTypes.map((item) => (
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
                )}

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
                  <button type="button" disabled={!createModal.type || !createNameInput.trim()} onClick={handleCreateConfirm} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer">Create</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )
      })()}
      </AnimatePresence>

      {/* ── Rename Modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
      {renameModal.isOpen && (
        <motion.div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[1200] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="bg-[#161b22] border border-slate-800 rounded-2xl max-w-sm w-full shadow-2xl p-6"
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-base text-slate-100">Rename</h3>
              <button onClick={() => setRenameModal({ isOpen: false, path: '', currentName: '' })} className="text-slate-500 hover:text-slate-300 transition cursor-pointer">
                <X size={16} />
              </button>
            </div>
            <input
              autoFocus
              type="text"
              value={renameInput}
              onChange={e => setRenameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && renameInput.trim()) {
                  const { path } = renameModal
                  setRenameModal({ isOpen: false, path: '', currentName: '' })
                  handleRenameFile(path, renameInput)
                }
                if (e.key === 'Escape') setRenameModal({ isOpen: false, path: '', currentName: '' })
              }}
              className="w-full bg-slate-950 border border-slate-700 focus:border-violet-500 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none transition"
              placeholder="New name…"
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setRenameModal({ isOpen: false, path: '', currentName: '' })}
                className="px-4 py-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer"
              >Cancel</button>
              <button
                type="button"
                disabled={!renameInput.trim() || renameInput.trim() === renameModal.currentName}
                onClick={() => {
                  const { path } = renameModal
                  setRenameModal({ isOpen: false, path: '', currentName: '' })
                  handleRenameFile(path, renameInput)
                }}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
              >Rename</button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Trash Panel ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showTrash && (
          <TrashPanel
            onClose={() => setShowTrash(false)}
            trashRetentionDays={trashRetentionDays}
            workspace={activeWorkspace}
          />
        )}
      </AnimatePresence>

      {/* ── Settings Menu Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
      {adminModalOpen && (
        <motion.div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[1200] flex items-center justify-center p-4 select-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setAdminModalOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setAdminModalOpen(false) }}
        >
          <motion.div
            className="bg-[#161b22] border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl p-6 overflow-hidden text-slate-200 flex flex-col h-[480px] max-h-[85vh]"
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
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
                    { id: 'general'    as const, label: 'General',           icon: <Home size={14} className="text-emerald-400" /> },
                    { id: 'appearance' as const, label: 'Appearance',        icon: <Sun size={14} className="text-amber-400" /> },
                    { id: 'editor'     as const, label: 'Document Layout',  icon: <LayoutGrid size={14} className="text-violet-400" /> },
                    { id: 'history'    as const, label: 'Backups & History', icon: <HistoryIcon size={14} className="text-rose-400" /> },
                    { id: 'users'      as const, label: 'Users',             icon: <Users size={14} className="text-cyan-400" /> },
                    { id: 'access'     as const, label: 'API Keys',          icon: <Key size={14} className="text-yellow-400" /> },
                    { id: 'about'      as const, label: 'About & System',   icon: <Layers size={14} className="text-blue-400" /> },
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
                  v{APP_VERSION}
                </div>
              </div>

              {/* Settings Content Pane */}
              <div className="flex-1 pl-6 flex flex-col min-h-0">
                <div className="relative flex-1 min-h-0">
                  <div
                    ref={settingsScrollRef}
                    onScroll={checkSettingsScroll}
                    className="h-full overflow-y-auto no-scrollbar pr-1"
                  >
                  {settingsTab === 'general' && (
                    <div className="space-y-6 animate-in fade-in duration-150">
                      {/* Default Page */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Default Page on Startup
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Choose a page to open automatically when the app loads without a URL. Leave blank to show the home screen.
                        </p>
                        <div className="relative">
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <input
                                type="text"
                                value={defaultPageSearch || defaultPage}
                                onFocus={() => { setDefaultPageSearch(defaultPage); setDefaultPageDropdownOpen(true) }}
                                onChange={e => { setDefaultPageSearch(e.target.value); setDefaultPageDropdownOpen(true) }}
                                onBlur={() => setTimeout(() => setDefaultPageDropdownOpen(false), 150)}
                                placeholder="Search pages…"
                                className="w-full bg-[#0d1220] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-500 placeholder-slate-600"
                              />
                              {defaultPageDropdownOpen && (() => {
                                const q = defaultPageSearch.toLowerCase()
                                const matches = files.filter(f =>
                                  f.path.startsWith(activeWorkspace ? activeWorkspace + '/' : '') &&
                                  (f.title?.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) &&
                                  f.type !== 'folder'
                                ).slice(0, 12)
                                return matches.length > 0 ? (
                                  <div className="absolute top-full left-0 right-0 mt-1 bg-[#161b22] border border-slate-700 rounded-xl shadow-2xl py-1 z-50 max-h-52 overflow-y-auto no-scrollbar">
                                    {matches.map(f => (
                                      <button
                                        key={f.path}
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={() => {
                                          saveDefaultPage(f.path)
                                          setDefaultPageSearch('')
                                          setDefaultPageDropdownOpen(false)
                                        }}
                                        className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-800 transition flex flex-col gap-0.5 ${f.path === defaultPage ? 'text-violet-300' : 'text-slate-300'}`}
                                      >
                                        <span className="font-medium truncate">{f.title || f.path}</span>
                                        <span className="text-[10px] text-slate-500 truncate font-mono">{f.path}</span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null
                              })()}
                            </div>
                            {defaultPage && (
                              <button
                                onClick={() => {
                                  saveDefaultPage('')
                                  setDefaultPageSearch('')
                                }}
                                className="px-2 py-1 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 rounded-lg transition cursor-pointer"
                                title="Clear default page"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                          {defaultPage && (
                            <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                              <Home size={11} className="text-emerald-400 shrink-0" />
                              <span className="text-[11px] text-emerald-300 font-mono truncate">{defaultPage}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Autosave delay */}
                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Autosave Delay
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          How long after you stop typing before changes are saved to disk. Minimum 100 ms. Lower values feel more responsive but write more frequently.
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={100}
                            step={100}
                            value={autosaveDelayInput}
                            onChange={e => setAutosaveDelayInput(e.target.value)}
                            onBlur={() => {
                              const v = Math.max(100, parseInt(autosaveDelayInput) || 1500)
                              setAutosaveDelayInput(v.toString())
                              saveAutosaveDelay(v)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                            }}
                            className="w-28 bg-[#0d1220] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-violet-500"
                          />
                          <span className="text-xs text-slate-400">ms</span>
                          <span className="text-[11px] text-slate-500 ml-1">
                            {autosaveDelay < 500 ? '⚡ very fast' : autosaveDelay <= 1000 ? '· fast' : autosaveDelay <= 2000 ? '· default' : '· slow'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

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
                              fetch(`${API_BASE}/api/settings`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ global_layout_override: val }),
                              }).catch(e => console.error('Failed to save global_layout_override', e))
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
                              fetch(`${API_BASE}/api/settings`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ global_column_width_override: val }),
                              }).catch(e => console.error('Failed to save global_column_width_override', e))
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

                  {settingsTab === 'appearance' && (
                    <div className="space-y-5 animate-in fade-in duration-150">
                      {/* Theme */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Theme
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Choose the colour theme for the interface.
                        </p>
                        <div className="flex gap-2">
                          {([
                            { id: 'dark' as const, label: 'Dark', icon: <Moon size={14} /> },
                            { id: 'light' as const, label: 'Light', icon: <Sun size={14} /> },
                          ]).map(t => (
                            <button
                              key={t.id}
                              onClick={() => handleSetTheme(t.id)}
                              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                                theme === t.id
                                  ? 'bg-violet-600/15 border-violet-500/40 text-violet-300'
                                  : 'bg-[#1f242c] border-slate-700/80 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                              }`}
                            >
                              {t.icon}
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* App Font */}
                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          App Font
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Changes the typeface used across the app's interface and document headings.
                        </p>
                        <div className="relative">
                          <select
                            value={appFont}
                            onChange={(e) => handleSetAppFont(e.target.value)}
                            className="w-full bg-[#1f242c] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500 transition cursor-pointer appearance-none font-medium"
                            style={{ fontFamily: FONT_OPTIONS.find(f => f.id === appFont)?.stack }}
                          >
                            {FONT_OPTIONS.map(f => (
                              <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                              <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Sidebar Colors */}
                      <div className="space-y-3 pt-2 border-t border-slate-800">
                        <div>
                          <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                            Sidebar Colors
                          </label>
                          <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
                            Override the sidebar's background and text color independently of the theme above. Changes apply instantly — use the preview to check readability before it's saved.
                          </p>
                        </div>

                        <div className="flex gap-4">
                          {/* Background color */}
                          <div className="flex-1 space-y-1.5">
                            <span className="text-[11px] font-semibold text-slate-400">Background</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={sidebarBgColor || (theme === 'light' ? '#ffffff' : '#0a0a0a')}
                                onChange={e => handleSetSidebarBgColor(e.target.value)}
                                className="w-8 h-8 rounded-lg border border-slate-700 bg-transparent cursor-pointer p-0 shrink-0"
                                title="Sidebar background color"
                              />
                              <input
                                type="text"
                                value={sidebarBgColor}
                                placeholder="Default"
                                onChange={e => {
                                  const v = e.target.value
                                  if (v === '' || /^#[0-9a-fA-F]{6}$/.test(v)) handleSetSidebarBgColor(v)
                                  else setSidebarBgColorState(v)
                                }}
                                className="w-full bg-[#0d1220] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500 placeholder-slate-600 font-mono"
                              />
                              {sidebarBgColor && (
                                <button
                                  onClick={() => handleSetSidebarBgColor('')}
                                  className="text-[10px] text-slate-500 hover:text-slate-300 transition cursor-pointer whitespace-nowrap"
                                  title="Reset to theme default"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Text color */}
                          <div className="flex-1 space-y-1.5">
                            <span className="text-[11px] font-semibold text-slate-400">Text</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={sidebarTextColor || (theme === 'light' ? '#334155' : '#94a3b8')}
                                onChange={e => handleSetSidebarTextColor(e.target.value)}
                                className="w-8 h-8 rounded-lg border border-slate-700 bg-transparent cursor-pointer p-0 shrink-0"
                                title="Sidebar text color"
                              />
                              <input
                                type="text"
                                value={sidebarTextColor}
                                placeholder="Default"
                                onChange={e => {
                                  const v = e.target.value
                                  if (v === '' || /^#[0-9a-fA-F]{6}$/.test(v)) handleSetSidebarTextColor(v)
                                  else setSidebarTextColorState(v)
                                }}
                                className="w-full bg-[#0d1220] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-500 placeholder-slate-600 font-mono"
                              />
                              {sidebarTextColor && (
                                <button
                                  onClick={() => handleSetSidebarTextColor('')}
                                  className="text-[10px] text-slate-500 hover:text-slate-300 transition cursor-pointer whitespace-nowrap"
                                  title="Reset to theme default"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Live preview */}
                        <div>
                          <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">Preview</span>
                          <div
                            className="bf-sidebar-preview"
                            style={{
                              backgroundColor: sidebarBgColor || 'var(--bg-surface)',
                              color: sidebarTextColor || 'var(--txt-2)',
                            }}
                          >
                            <div className="bf-sidebar-preview-header">Spaces</div>
                            <div className="bf-sidebar-preview-item active">
                              <CheckSquare size={13} />
                              <span>Tasks</span>
                            </div>
                            <div className="bf-sidebar-preview-item">
                              <FileText size={13} />
                              <span>Notes</span>
                            </div>
                            <div className="bf-sidebar-preview-item">
                              <Folder size={13} />
                              <span>Canvas</span>
                            </div>
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

                      <div className="space-y-2 pt-2">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Trash Retention (days)
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          How long deleted files are kept in the Trash before being permanently removed.
                          Set to <strong className="text-slate-300">0</strong> to skip the Trash entirely and delete immediately.
                        </p>
                        <input
                          type="number"
                          min={0}
                          max={365}
                          value={trashRetentionInput}
                          onChange={(e) => {
                            setTrashRetentionInput(e.target.value)
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val) && val >= 0) {
                              setTrashRetentionDays(val)
                              fetch(`${API_BASE}/api/settings`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ trash_retention_days: val }),
                              }).catch(e => console.error('Failed to save trash retention', e))
                            }
                          }}
                          className="w-full bg-[#1f242c] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500 transition font-medium"
                        />
                        {trashRetentionDays === 0 && (
                          <p className="text-[11px] text-amber-500/80">
                            Trash is disabled — files are permanently deleted without recovery.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2 pt-2 border-t border-slate-800">
                        <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                          Periodic Auto-Version
                        </label>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Automatically save a version snapshot of the open page every N minutes. Set to <strong className="text-slate-300">0</strong> to disable. Versions on page switch always happen regardless.
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={historyIntervalInput}
                            onChange={e => setHistoryIntervalInput(e.target.value)}
                            onBlur={() => {
                              const v = Math.max(0, parseInt(historyIntervalInput) || 0)
                              setHistoryIntervalInput(v.toString())
                              saveHistoryInterval(v)
                            }}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className="w-28 bg-[#1f242c] border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500 transition font-medium"
                          />
                          <span className="text-xs text-slate-400">minutes</span>
                          {historyInterval > 0 && (
                            <span className="text-[11px] text-emerald-400/80 ml-1">· active</span>
                          )}
                          {historyInterval === 0 && (
                            <span className="text-[11px] text-slate-500 ml-1">· disabled</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {settingsTab === 'about' && (
                    <div className="space-y-4 animate-in fade-in duration-150">
                      <div className="space-y-1.5">
                        <div className="flex items-baseline gap-2">
                          <h4 className="font-bold text-sm text-slate-100">BlockForgeMD</h4>
                          <span className="text-[10px] font-semibold text-violet-400 bg-violet-500/10 border border-violet-500/25 px-1.5 py-0.5 rounded-full">v{APP_VERSION}</span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          A local-first knowledge base built on plain Markdown. Your notes live as files on disk — portable, integrable with any tool, and independent of any cloud service.
                        </p>
                      </div>

                      <div className="bg-slate-900/50 border border-slate-850 rounded-xl p-4 space-y-3">
                        <div className="text-xs text-slate-400">
                          BlockForgeMD workspace operates fully offline, reading and writing files directly to your storage disk directory. No third-party servers tracking or storing your notes.
                        </div>
                        <div className="flex justify-between items-center text-xs border-t border-slate-850 pt-2.5">
                          <span className="text-slate-500">Version:</span>
                          <span className="text-slate-400 font-mono">{APP_VERSION}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500">License:</span>
                          <span className="text-slate-400 font-medium">MIT (Open Source)</span>
                        </div>
                      </div>

                      {/* System & Sync status */}
                      <div className="space-y-1.5 pt-2">
                        <h4 className="font-bold text-sm text-slate-100">System & Sync</h4>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Workspace notes are stored as plain Markdown files on disk, but indexed in SQLite for high-speed search and kanban filters.
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

                  {settingsTab === 'users' && (
                    <UsersTab />
                  )}

                  {settingsTab === 'access' && (
                    <AccessTab currentUserId={currentUser?.id ?? ''} />
                  )}
                  </div>

                  {/* Scroll-for-more hint — only shown while there's unscrolled content below */}
                  {settingsScrollable && (
                    <div className="pointer-events-none absolute bottom-0 left-0 right-1 h-10 flex items-end justify-center pb-1 bg-gradient-to-t from-[#161b22] to-transparent">
                      <ChevronsDown size={13} className="text-slate-500 animate-bounce" />
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
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Context Menu ─────────────────────────────────────────────────── */}
      <AnimatePresence>
      {contextMenu.isOpen && (() => {
        const ctxParent = getContextParentPath(contextMenu.path)
        const closeMenu = () => setContextMenu(p => ({ ...p, isOpen: false }))
        const ctxBtn = (label: string, icon: React.ReactNode, onClick: () => void) => (
          <button
            key={label}
            onClick={() => { onClick(); closeMenu() }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            {icon}{label}
          </button>
        )

        return (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -4 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
            style={{ position: 'fixed', top: `${contextMenu.y}px`, left: `${contextMenu.x}px`, zIndex: 99999 }}
            className="w-52 bg-[#161b22] border border-slate-800 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 no-scrollbar select-none"
          >
            <div className="px-2.5 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-850/60 mb-1 truncate">
              {contextMenu.path?.split('/').pop()?.replace(/\.(board|excalidraw|drawio|mindmap)\.md$/, '').replace(/\.md$/, '') || contextMenu.path}
            </div>

            {/* Documents section */}
            {contextMenu.sectionType === 'documents' && (
              <>
                {ctxBtn('New Sub Page', <FileText size={13} className="text-blue-400" />,
                  () => handleCreateFile('document', ctxParent, undefined, ['document'], 'Sub Page'))}
                {ctxBtn('New Folder', <FolderPlus size={13} className="text-slate-400" />,
                  () => handleCreateFile('folder', ctxParent, undefined, ['folder']))}
              </>
            )}

            {/* Boards section */}
            {contextMenu.sectionType === 'boards' && (contextMenu.nodeType === 'board' || !contextMenu.nodeType) && (
              <>
                {ctxBtn('New Task', <CheckSquare size={13} className="text-amber-500" />,
                  () => handleCreateFile('task', ctxParent, undefined, ['task']))}
                {ctxBtn('New Folder', <FolderPlus size={13} className="text-slate-400" />,
                  () => handleCreateFile('folder', ctxParent, undefined, ['folder']))}
              </>
            )}

            {/* Canvas section */}
            {contextMenu.sectionType === 'canvas' && (
              <>
                {ctxBtn('New Excalidraw', <Brush size={13} className="text-emerald-400" />,
                  () => handleCreateFile('canvas', ctxParent, undefined, ['canvas']))}
                {ctxBtn('New Draw.io', <Grid size={13} className="text-violet-400" />,
                  () => handleCreateFile('diagram', ctxParent, undefined, ['diagram']))}
                {ctxBtn('New Folder', <FolderPlus size={13} className="text-slate-400" />,
                  () => handleCreateFile('folder', ctxParent, undefined, ['folder']))}
              </>
            )}

            {/* Mind Maps section */}
            {contextMenu.sectionType === 'mindmaps' && (
              <>
                {ctxBtn('New Mind Map', <Brain size={13} className="text-violet-400" />,
                  () => handleCreateFile('mindmap', ctxParent, undefined, ['mindmap']))}
                {ctxBtn('New Folder', <FolderPlus size={13} className="text-slate-400" />,
                  () => handleCreateFile('folder', ctxParent, undefined, ['folder']))}
              </>
            )}

            {/* Rename — available for all page types */}
            {!contextMenu.isFolder && (() => {
              const fileTitle = files.find(f => f.path === contextMenu.path)?.title
                || contextMenu.path?.split('/').pop()?.replace(/\.(board|excalidraw|drawio|mindmap)\.md$/, '').replace(/\.md$/, '')
                || ''
              return ctxBtn('Rename', <Pencil size={13} className="text-violet-400" />, () => {
                setRenameInput(fileTitle)
                setRenameModal({ isOpen: true, path: contextMenu.path!, currentName: fileTitle })
              })
            })()}

            {/* Favorites toggle — available for all non-folder page types */}
            {contextMenu.path && contextMenu.nodeType !== 'folder' && (() => {
              const isFav = favorites.includes(contextMenu.path!)
              return ctxBtn(
                isFav ? 'Remove from Favorites' : 'Add to Favorites',
                <Star
                  size={13}
                  className={isFav ? 'text-amber-400 fill-amber-400' : 'text-amber-400'}
                />,
                () => handleToggleFavorite(contextMenu.path!)
              )
            })()}

            <div className="border-t border-slate-850/60 my-1" />
            <button
              onClick={() => {
                if (contextMenu.path) handleDeleteFile(contextMenu.path)
                closeMenu()
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-red-950/40 text-slate-400 hover:text-red-400 rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
            >
              <Trash2 size={13} className="text-red-500" />
              {trashRetentionDays > 0
                ? (contextMenu.isFolder ? 'Move Folder to Trash' : 'Move to Trash')
                : (contextMenu.isFolder ? 'Delete Folder Forever' : 'Delete Forever')}
            </button>
          </motion.div>
        )
      })()}
      </AnimatePresence>

      {/* ── Search & Command Palette Modal ─────────────────────────────── */}
      <AnimatePresence>
      {searchOpen && (
        <motion.div
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-[1200] flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={() => setSearchOpen(false)}
        >
          <motion.div
            className="bg-[#161b22] border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[500px]"
            initial={{ scale: 0.96, y: -12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: -12 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
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
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── Rename Workspace Modal ───────────────────────────────────────── */}
      <AnimatePresence>
      {renameWorkspaceTarget && (
        <motion.div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1200]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setRenameWorkspaceTarget(null)}
        >
          <motion.div
            className="bg-[#1c2433] border border-slate-700 rounded-2xl shadow-2xl p-6 w-80"
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Pencil size={14} className="text-violet-400" />
              <h2 className="text-sm font-bold text-slate-100">Rename Workspace</h2>
            </div>
            <p className="text-[11px] text-slate-500 mb-4">Renaming <span className="text-slate-400 font-mono">{renameWorkspaceTarget}</span></p>
            <input
              autoFocus
              type="text"
              value={renameWorkspaceName}
              onChange={e => setRenameWorkspaceName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRenameWorkspace(); if (e.key === 'Escape') setRenameWorkspaceTarget(null) }}
              placeholder="New name..."
              className="w-full bg-[#0d1117] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-violet-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRenameWorkspaceTarget(null)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer">Cancel</button>
              <button
                onClick={handleRenameWorkspace}
                disabled={!renameWorkspaceName.trim() || renameWorkspaceName.trim() === renameWorkspaceTarget}
                className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Rename
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* ── New Workspace Modal ───────────────────────────────────────────── */}
      <AnimatePresence>
      {newWorkspaceModal && (
        <motion.div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[1200]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setNewWorkspaceModal(false)}
        >
          <motion.div
            className="bg-[#1c2433] border border-slate-700 rounded-2xl shadow-2xl p-6 w-80"
            initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4">
              <Layers size={16} className="text-violet-400" />
              <h2 className="text-sm font-bold text-slate-100">New Workspace</h2>
            </div>
            <input
              autoFocus
              type="text"
              value={newWorkspaceName}
              onChange={e => setNewWorkspaceName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreateWorkspace(); if (e.key === 'Escape') setNewWorkspaceModal(false) }}
              placeholder="Workspace name..."
              className="w-full bg-[#0d1117] border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-violet-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setNewWorkspaceModal(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer">Cancel</button>
              <button
                onClick={handleCreateWorkspace}
                disabled={!newWorkspaceName.trim()}
                className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Create
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {sidebarTooltip && (
        <div className="bf-sidebar-tip" style={{ top: sidebarTooltip.y }}>
          <span className="bf-sidebar-tip-label">{sidebarTooltip.label}</span>
        </div>
      )}

      <DialogHost />
    </div>
  )
}

export default App
