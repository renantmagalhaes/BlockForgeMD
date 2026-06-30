import React, { useState, useEffect } from 'react'
import {
  FileText,
  CheckSquare,
  LayoutGrid,
  Trash2,
  Brush,
  ChevronRight,
  ChevronDown,
  Database,
  CloudLightning,
  AlertCircle,
  FilePlus,
  Layers,
  ArrowRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  X,
  Grid
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

const buildTree = (files: FileRecord[]): TreeNode[] => {
  const root: TreeNode = { name: 'Root', path: '', isFolder: true, children: [] }

  const nodeMap = new Map<string, {
    filePath: string
    title: string
    type: string
    frontMatter?: Record<string, string>
  }>()

  const folderPaths = new Set<string>()

  // Helper to check if a path has children
  const hasSubPages = (basePath: string) => {
    return files.some(f => {
      if (f.path === basePath) return false
      return f.path.startsWith(basePath + '/')
    })
  }

  files.forEach((file) => {
    if (file.path.endsWith('/README.md')) {
      const parentDir = file.path.substring(0, file.path.lastIndexOf('/'))
      nodeMap.set(parentDir, {
        filePath: file.path,
        title: file.title,
        type: file.type,
        frontMatter: file.frontMatter
      })
      folderPaths.add(parentDir)
    } else {
      const cleanPath = file.path.endsWith('.md') ? file.path.slice(0, -3) : file.path
      if (hasSubPages(cleanPath)) {
        nodeMap.set(cleanPath, {
          filePath: file.path,
          title: file.title,
          type: file.type,
          frontMatter: file.frontMatter
        })
        folderPaths.add(cleanPath)
      } else {
        nodeMap.set(file.path, {
          filePath: file.path,
          title: file.title,
          type: file.type,
          frontMatter: file.frontMatter
        })
      }
    }
  })

  // Build the hierarchical tree
  nodeMap.forEach((meta, nodePath) => {
    const parts = nodePath.split('/')
    let current = root

    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')
      const isFolder = folderPaths.has(currentPath) || !isLast

      let child = current.children.find((c) => c.name === part && c.isFolder === isFolder)
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          isFolder,
          children: [],
        }
        current.children.push(child)
      }

      if (isLast) {
        child.hasPage = true
        child.filePath = meta.filePath
        child.title = meta.title
        child.type = meta.type
        child.frontMatter = meta.frontMatter
      }

      current = child
    })
  })

  // Ensure folders that have no explicit README or merged file still appear as folders in the tree
  files.forEach(file => {
    const parts = file.path.split('/')
    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        const parentPath = parts.slice(0, i).join('/')
        let current = root
        const parentParts = parentPath.split('/')
        parentParts.forEach((part) => {
          let child = current.children.find(c => c.name === part && c.isFolder)
          if (!child) {
            child = {
              name: part,
              path: parentParts.slice(0, parentParts.indexOf(part) + 1).join('/'),
              isFolder: true,
              children: []
            }
            current.children.push(child)
          }
          current = child
        })
      }
    }
  })

  // Custom Sort function
  const sortTree = (nodes: TreeNode[], isRoot = false) => {
    nodes.sort((a, b) => {
      if (isRoot) {
        const order = ['Documents', 'Tasks', 'Canvas']
        const idxA = order.indexOf(a.name)
        const idxB = order.indexOf(b.name)
        if (idxA !== -1 && idxB !== -1) return idxA - idxB
        if (idxA !== -1) return -1
        if (idxB !== -1) return 1
      }
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      const nameA = a.title || a.name
      const nameB = b.title || b.name
      return nameA.localeCompare(nameB)
    })
    nodes.forEach((node) => {
      if (node.children.length > 0) {
        sortTree(node.children, false)
      }
    })
  }

  sortTree(root.children, true)
  return root.children
}

const TreeNodeComponent: React.FC<{
  node: TreeNode
  depth: number
  selectedPath: string | null
  collapsedPaths: Record<string, boolean>
  onToggleCollapse: (path: string) => void
  onSelectFile: (path: string) => void
  onCreateInFolder: (type: 'document' | 'task' | 'canvas' | 'folder' | 'board' | 'diagram' | null, parentPath?: string) => void
  onDeletePath: (path: string) => void
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void
}> = ({
  node,
  depth,
  selectedPath,
  collapsedPaths,
  onToggleCollapse,
  onSelectFile,
  onCreateInFolder,
  onDeletePath,
  onContextMenu,
}) => {
  const getIsCollapsed = () => {
    if (collapsedPaths[node.path] !== undefined) {
      return collapsedPaths[node.path]
    }
    if (node.path === 'Documents') return false
    if (node.path === 'Tasks' || node.path === 'Canvas') return true
    return true
  }

  const isCollapsed = getIsCollapsed()
  const isSelected = selectedPath && node.hasPage && node.filePath === selectedPath

  const handleRowClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.hasPage && node.filePath) {
      onSelectFile(node.filePath)
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
    const parentPath = node.filePath?.endsWith('.md') ? node.filePath.slice(0, -3) : node.path
    onCreateInFolder(null, parentPath)
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (node.filePath) {
      onDeletePath(node.filePath)
    } else {
      onDeletePath(node.path)
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node)
  }

  const getIcon = () => {
    if (node.isFolder && !node.hasPage) {
      return isCollapsed ? (
        <Folder size={14} className="text-slate-400 shrink-0" />
      ) : (
        <FolderOpen size={14} className="text-violet-400 shrink-0" />
      )
    }
    switch (node.type) {
      case 'task':
        return <CheckSquare size={13} className="text-amber-500 shrink-0" />
      case 'canvas':
        return <Brush size={13} className="text-emerald-400 shrink-0" />
      case 'board':
        return <LayoutGrid size={13} className="text-violet-400 shrink-0" />
      default:
        return <FileText size={13} className="text-blue-400 shrink-0" />
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
          {node.isFolder && (
            <span
              onClick={handleChevronClick}
              className="text-slate-500 hover:text-slate-200 p-0.5 hover:bg-slate-700/50 rounded transition shrink-0"
            >
              {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            </span>
          )}
          {!node.isFolder && <span className="w-4 shrink-0" />}
          {getIcon()}
          <span className="truncate">{node.title || node.name}</span>
        </div>

        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 ml-1">
          <button
            onClick={handleAddClick}
            className="p-0.5 hover:bg-slate-700 hover:text-white rounded text-slate-500 transition cursor-pointer"
            title="Create Sub-item"
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
              onCreateInFolder={onCreateInFolder}
              onDeletePath={onDeletePath}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FileRecord {
  path: string
  title: string
  type: string
  contentHash: string
  updatedAt: string
  frontMatter?: Record<string, string>
}

const splitFrontMatter = (content: string) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (match) {
    return {
      frontMatterStr: match[1],
      body: match[2].replace(/^\r?\n+/, ''),
    }
  }
  return {
    frontMatterStr: '',
    body: content,
  }
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

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

  const [createModal, setCreateModal] = useState<{
    isOpen: boolean
    type: 'document' | 'task' | 'canvas' | 'folder' | 'board' | 'diagram' | null
    parentPath?: string
  }>({ isOpen: false, type: null })
  const [createNameInput, setCreateNameInput] = useState('')

  // Right-click Context Menu states
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean
    x: number
    y: number
    path: string | null
    isFolder: boolean
  }>({ isOpen: false, x: 0, y: 0, path: null, isFolder: false })

  // Fetch all files from backend cache
  const fetchFiles = async () => {
    try {
      setSyncError(false)
      const res = await fetch(`${API_BASE}/api/files`)
      if (!res.ok) throw new Error('Failed to fetch files')
      const data = await res.json()
      setFiles(data || [])
    } catch (e) {
      console.error('Error fetching files', e)
      setSyncError(true)
    } finally {
      setIsSyncing(false)
    }
  }

  // Fetch specific file details (content)
  const fetchFileContent = async (path: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error('Failed to fetch file content')
      const data = await res.json()
      const { frontMatterStr, body } = splitFrontMatter(data.content)
      setSelectedContent(body)
      setCurrentFrontMatterStr(frontMatterStr)
      setSelectedPath(path)
      if (data.meta && data.meta.type === 'board') {
        setActiveView('board')
      } else {
        setActiveView('editor')
      }
    } catch (e) {
      console.error('Error loading file content', e)
    }
  }

  // Setup Server-Sent Events (SSE) for Real-Time Sync
  useEffect(() => {
    fetchFiles()

    const sseUrl = `${API_BASE}/api/sync/events`
    console.log('Connecting to SSE:', sseUrl)
    const eventSource = new EventSource(sseUrl)

    eventSource.addEventListener('file_update', (e: any) => {
      console.log('Live-sync: file updated on disk:', e.data)
      fetchFiles() // Re-fetch list
      
      // If we are currently editing the updated file, reload its content (unless we are in the middle of saving)
      if (selectedPath && selectedPath === e.data && !isSaving) {
        fetchFileContent(selectedPath)
      }
    })

    eventSource.onerror = () => {
      console.warn('SSE connection failed. Retrying...')
      setSyncError(true)
    }

    eventSource.onopen = () => {
      setSyncError(false)
    }

    return () => {
      eventSource.close()
    }
  }, [selectedPath, isSaving])

  // Setup Window Click Listener to close context menu
  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu((prev) => {
        if (prev.isOpen) return { ...prev, isOpen: false }
        return prev
      })
    }
    window.addEventListener('click', handleWindowClick)
    return () => window.removeEventListener('click', handleWindowClick)
  }, [])

  // Save modified content back to backend disk
  const handleSaveFile = async (content: string) => {
    if (!selectedPath) return
    setIsSaving(true)
    const fullContent = currentFrontMatterStr
      ? `---\n${currentFrontMatterStr}\n---\n\n${content}`
      : content

    try {
      const res = await fetch(`${API_BASE}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, content: fullContent }),
      })
      if (!res.ok) throw new Error('Failed to save file')
      const data = await res.json()
      console.log('File saved successfully:', data)
      setSelectedContent(content)
      fetchFiles()
    } catch (e) {
      console.error('Error saving file', e)
      alert('Failed to save file changes to disk.')
    } finally {
      setIsSaving(false)
    }
  }

  // Move card in Kanban board (updates front matter)
  const handleMoveCard = async (path: string, newStatus: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/file/front-matter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          updates: { status: newStatus },
        }),
      })
      if (!res.ok) throw new Error('Failed to update card status')
      fetchFiles()
    } catch (e) {
      console.error('Error moving Kanban card', e)
    }
  }

  // Update front-matter fields generic handler
  const handleUpdateFrontMatter = async (path: string, updates: Record<string, any>) => {
    try {
      const res = await fetch(`${API_BASE}/api/file/front-matter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, updates }),
      })
      if (!res.ok) throw new Error('Failed to update front matter')
      fetchFiles()
    } catch (e) {
      console.error('Error updating front matter', e)
    }
  }

  // Create task directly in a specific column status
  const handleCreateTaskWithStatus = async (title: string, status: string) => {
    const sanitizedName = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
    if (!sanitizedName) return

    const path = `Tasks/${sanitizedName}.md`
    const content = `---
title: ${title}
type: task
status: ${status}
priority: Medium
dueDate: ${new Date().toISOString().split('T')[0]}
assignee: Unassigned
tags: []
---

# ${title}

Task created directly from Kanban Board.
`
    try {
      const res = await fetch(`${API_BASE}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      })
      if (!res.ok) throw new Error('Failed to create task')
      fetchFiles()
    } catch (e) {
      console.error('Error creating task', e)
    }
  }

  // Update board columns metadata in board markdown front-matter
  const handleUpdateBoardColumns = async (path: string, newColumns: string[]) => {
    try {
      const res = await fetch(`${API_BASE}/api/file/front-matter`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          updates: { columns: newColumns },
        }),
      })
      if (!res.ok) throw new Error('Failed to update board columns')
      fetchFiles()
    } catch (e) {
      console.error('Error updating board columns', e)
    }
  }

  // Open custom creation modal
  const handleCreateFile = async (type: 'document' | 'task' | 'canvas' | 'folder' | 'board' | 'diagram' | null, parentPath?: string) => {
    setCreateModal({
      isOpen: true,
      type,
      parentPath,
    })
    setCreateNameInput('')
  }

  // Execute actual item creation from modal details
  const handleCreateConfirm = async () => {
    const { type, parentPath } = createModal
    if (!type) return
    const title = createNameInput.trim()
    if (!title) return

    const sanitizedName = title.replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
    if (!sanitizedName) return

    let path = ''
    let content = ''

    if (type === 'diagram') {
      path = parentPath ? `${parentPath}/${sanitizedName}.drawio.md` : `Canvas/${sanitizedName}.drawio.md`
      content = `---
title: ${title}
type: canvas
editor: drawio
---

# Draw.io Diagram
Below is the embedded diagram layout in XML. Do not modify the code block manually.

\`\`\`xml
<mxfile host="app.diagrams.net"><diagram id="1" name="Page-1"><mxGraphModel dx="1000" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /></root></mxGraphModel></diagram></mxfile>
\`\`\`
`
    } else if (type === 'board') {
      path = parentPath ? `${parentPath}/${sanitizedName}.board.md` : `Documents/${sanitizedName}.board.md`
      content = `---
title: ${title}
type: board
columns: ["Todo", "In Progress", "Done"]
---

# ${title} Kanban Board

Customizable Kanban layout. Create, edit, and move status columns.
`
    } else if (type === 'folder') {
      path = parentPath ? `${parentPath}/${sanitizedName}/README.md` : `Documents/${sanitizedName}/README.md`
      content = `---
title: ${title} Folder
type: document
---

# ${title} Folder

Folder created recursively on disk. Add subnotes or tasks here.
`
    } else if (type === 'task') {
      path = parentPath ? `${parentPath}/${sanitizedName}.md` : `Tasks/${sanitizedName}.md`
      content = `---
title: ${title}
type: task
status: Todo
priority: Medium
dueDate: ${new Date().toISOString().split('T')[0]}
assignee: Unassigned
tags: []
---

# ${title}

Describe the task details here.
`
    } else if (type === 'canvas') {
      path = parentPath ? `${parentPath}/${sanitizedName}.excalidraw.md` : `Canvas/${sanitizedName}.excalidraw.md`
      content = `---
title: ${title}
type: canvas
editor: excalidraw
---

# Drawing Canvas
Below is the embedded drawing data. Do not modify the code block manually.

\`\`\`json
{
  "type": "excalidraw",
  "version": 2,
  "elements": [],
  "appState": {
    "viewBackgroundColor": "#121212",
    "theme": "dark"
  }
}
\`\`\`
`
    } else {
      path = parentPath ? `${parentPath}/${sanitizedName}.md` : `Documents/${sanitizedName}.md`
      content = `---
title: ${title}
type: document
---

# ${title}

Start writing note content here.
`
    }

    try {
      const res = await fetch(`${API_BASE}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      })
      if (!res.ok) throw new Error('Failed to create file')
      
      setCreateModal({ isOpen: false, type: null })
      setCreateNameInput('')
      fetchFiles()
      
      // Auto select and load the new file content immediately
      fetchFileContent(path)
    } catch (e) {
      console.error('Error creating file', e)
      alert('Failed to create item.')
    }
  }

  // Delete current active file
  const handleDeleteFile = async (path: string) => {
    if (!confirm('Are you sure you want to delete this file permanently from disk?')) return
    try {
      const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete file')
      fetchFiles()
      if (selectedPath === path) {
        setSelectedPath(null)
        setActiveView('board')
      }
    } catch (e) {
      console.error('Error deleting file', e)
    }
  }



  const getActiveFile = () => {
    return files.find((f) => f.path === selectedPath)
  }

  const activeFile = getActiveFile()

  return (
    <div className="flex h-screen bg-[#0d1117] text-slate-100 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="w-64 bg-[#161b22] border-r border-slate-800 flex flex-col justify-between">
        {/* Logo and Global board toggle */}
        <div>
          <div className="p-5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-violet-600 to-blue-500 flex items-center justify-center font-bold text-white shadow-lg">
                BF
              </div>
              <div>
                <h1 className="font-bold text-sm tracking-tight">BlockForgeMD</h1>
                <span className="text-[10px] text-slate-500 font-mono">Local-First Vault</span>
              </div>
            </div>
          </div>

          <div className="p-3">
            <button
              onClick={() => {
                setActiveView('board')
                setSelectedPath(null)
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition font-medium cursor-pointer ${
                activeView === 'board'
                  ? 'bg-violet-600/10 text-violet-400 border border-violet-500/20'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <LayoutGrid size={16} />
              <span>Kanban Board</span>
            </button>
          </div>

          {/* Scrolled items list (Workspace Explorer Tree) */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 max-h-[calc(100vh-280px)] no-scrollbar">
            <div className="px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider flex justify-between items-center">
              <span>Workspace Explorer</span>
              <button
                onClick={() => handleCreateFile('folder')}
                className="hover:text-white text-slate-500 transition cursor-pointer"
                title="Create Root Folder"
              >
                <FolderPlus size={12} className="inline mr-1" />
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
                  onCreateInFolder={handleCreateFile}
                  onDeletePath={handleDeleteFile}
                  onContextMenu={(e, targetNode) => {
                    setContextMenu({
                      isOpen: true,
                      x: e.clientX,
                      y: e.clientY,
                      path: targetNode.filePath || targetNode.path,
                      isFolder: targetNode.isFolder
                    })
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Action Panel Bottom */}
        <div className="p-4 border-t border-slate-800 bg-[#161b22]/50 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleCreateFile('document')}
              className="flex flex-col items-center justify-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition text-[10px] font-semibold cursor-pointer"
              title="Add Page"
            >
              <FilePlus size={16} className="text-blue-400 mb-1" />
              Doc
            </button>
            <button
              onClick={() => handleCreateFile('task')}
              className="flex flex-col items-center justify-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition text-[10px] font-semibold cursor-pointer"
              title="Add Task"
            >
              <CheckSquare size={16} className="text-amber-500 mb-1" />
              Task
            </button>
            <button
              onClick={() => handleCreateFile('canvas')}
              className="flex flex-col items-center justify-center py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition text-[10px] font-semibold cursor-pointer"
              title="Add Canvas"
            >
              <Brush size={16} className="text-emerald-400 mb-1" />
              Canvas
            </button>
          </div>

          {/* Sync status indicators */}
          <div className="flex items-center justify-between text-[10px] border-t border-slate-800/60 pt-3">
            <div className="flex items-center gap-1 text-slate-500">
              <Database size={10} />
              <span>SQLite Cache</span>
            </div>
            {isSyncing ? (
              <span className="text-amber-500 animate-pulse">Syncing...</span>
            ) : syncError ? (
              <span className="text-red-400 flex items-center gap-0.5">
                <AlertCircle size={8} /> Offline
              </span>
            ) : (
              <span className="text-emerald-500 flex items-center gap-0.5">
                <CloudLightning size={8} /> Live Synced
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Panel Content Area */}
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
                  : async (newCols) => {
                      setDefaultColumns(newCols)
                      localStorage.setItem('blockforge_default_columns', JSON.stringify(newCols))
                    }
              }
            />
          </div>
        ) : selectedPath && activeFile ? (
          <div className="flex-1 p-6 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <button
                  onClick={() => setActiveView('board')}
                  className="hover:text-violet-400 hover:underline transition"
                >
                  Workspace
                </button>
                <ChevronRight size={12} />
                <span className="font-mono text-slate-500">{selectedPath}</span>
              </div>

              {/* Delete Button */}
              <button
                onClick={() => handleDeleteFile(selectedPath)}
                className="flex items-center gap-1 px-3 py-1 hover:bg-red-500/10 text-slate-500 hover:text-red-400 border border-transparent hover:border-red-500/20 text-xs font-semibold rounded-lg transition cursor-pointer"
                title="Delete File Permanently"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>

            <div className="flex-1 overflow-hidden">
              {activeFile.type === 'canvas' && activeFile.frontMatter?.editor === 'drawio' ? (
                <Diagram
                  filePath={selectedPath}
                  initialContent={selectedContent}
                  onSave={handleSaveFile}
                  isSaving={isSaving}
                />
              ) : activeFile.type === 'canvas' ? (
                <Canvas
                  filePath={selectedPath}
                  initialContent={selectedContent}
                  onSave={handleSaveFile}
                  isSaving={isSaving}
                />
              ) : (
                <Editor
                  filePath={selectedPath}
                  initialContent={selectedContent}
                  onSave={handleSaveFile}
                  isSaving={isSaving}
                  frontMatter={activeFile?.frontMatter}
                  onUpdateFrontMatter={(updates) => handleUpdateFrontMatter(selectedPath, updates)}
                  boardColumns={defaultColumns}
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
              <p className="text-sm text-slate-400 mb-6">
                A high-performance, local-first alternative to Notion. All files are saved as standard Markdown on your disk.
              </p>

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
                  <button
                    onClick={() => handleCreateFile('document')}
                    className="flex flex-col items-center justify-center p-4 bg-[#161b22]/50 hover:bg-slate-800 border border-slate-800 rounded-xl transition cursor-pointer"
                  >
                    <FileText size={20} className="text-blue-400 mb-2" />
                    <span className="font-semibold text-slate-300">Create Document</span>
                  </button>
                  <button
                    onClick={() => handleCreateFile('canvas')}
                    className="flex flex-col items-center justify-center p-4 bg-[#161b22]/50 hover:bg-slate-800 border border-slate-800 rounded-xl transition cursor-pointer"
                  >
                    <Brush size={20} className="text-emerald-400 mb-2" />
                    <span className="font-semibold text-slate-300">Create Canvas</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Creation Modal */}
      {createModal.isOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b22] border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-base text-slate-100">
                Create New Item
              </h3>
              <button
                onClick={() => setCreateModal({ isOpen: false, type: null })}
                className="text-slate-500 hover:text-slate-300 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Type Selection Grid */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Select Item Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'document', label: 'Doc', icon: <FileText size={16} className="text-blue-400" /> },
                    { id: 'task', label: 'Task', icon: <CheckSquare size={16} className="text-amber-500" /> },
                    { id: 'canvas', label: 'Excalidraw', icon: <Brush size={16} className="text-emerald-400" /> },
                    { id: 'diagram', label: 'Draw.io', icon: <Grid size={16} className="text-violet-400" /> },
                    { id: 'folder', label: 'Folder', icon: <Folder size={16} className="text-slate-400" /> },
                    { id: 'board', label: 'Board', icon: <LayoutGrid size={16} className="text-rose-400" /> },
                  ].map((item) => {
                    const isSelected = createModal.type === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setCreateModal((prev) => ({ ...prev, type: item.id as any }))}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border text-[11px] font-medium transition cursor-pointer ${
                          isSelected
                            ? 'bg-violet-600/10 border-violet-500 text-violet-300'
                            : 'bg-slate-900/50 border-slate-850 hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="mb-1.5">{item.icon}</div>
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Name Input */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Name / Title
                </label>
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

              {/* Path Context */}
              <div className="text-[10px] text-slate-500 font-mono">
                Location: <strong className="text-slate-400">{createModal.parentPath ? `${createModal.parentPath}/` : 'Root (/)'}</strong>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-850">
                <button
                  type="button"
                  onClick={() => setCreateModal({ isOpen: false, type: null })}
                  className="px-4 py-2 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!createModal.type || !createNameInput.trim()}
                  onClick={handleCreateConfirm}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
                >
                  Create Item
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right-click Context Menu */}
      {contextMenu.isOpen && (
        <div
          style={{
            position: 'fixed',
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            zIndex: 99999,
          }}
          className="w-48 bg-[#161b22] border border-slate-800 rounded-xl shadow-2xl p-1.5 flex flex-col space-y-0.5 no-scrollbar select-none animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2.5 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-850/60 mb-1 truncate">
            {contextMenu.path}
          </div>
          
          <button
            onClick={() => {
              const cleanParent = contextMenu.path?.endsWith('.md') ? contextMenu.path.slice(0, -3) : contextMenu.path
              handleCreateFile('document', cleanParent || undefined)
              setContextMenu((prev) => ({ ...prev, isOpen: false }))
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            <FileText size={13} className="text-blue-400" />
            New Page
          </button>
          
          <button
            onClick={() => {
              const cleanParent = contextMenu.path?.endsWith('.md') ? contextMenu.path.slice(0, -3) : contextMenu.path
              handleCreateFile('task', cleanParent || undefined)
              setContextMenu((prev) => ({ ...prev, isOpen: false }))
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            <CheckSquare size={13} className="text-amber-500" />
            New Task
          </button>

          <button
            onClick={() => {
              const cleanParent = contextMenu.path?.endsWith('.md') ? contextMenu.path.slice(0, -3) : contextMenu.path
              handleCreateFile('canvas', cleanParent || undefined)
              setContextMenu((prev) => ({ ...prev, isOpen: false }))
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            <Brush size={13} className="text-emerald-400" />
            New Excalidraw
          </button>

          <button
            onClick={() => {
              const cleanParent = contextMenu.path?.endsWith('.md') ? contextMenu.path.slice(0, -3) : contextMenu.path
              handleCreateFile('diagram', cleanParent || undefined)
              setContextMenu((prev) => ({ ...prev, isOpen: false }))
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            <Grid size={13} className="text-violet-400" />
            New Draw.io
          </button>

          <button
            onClick={() => {
              const cleanParent = contextMenu.path?.endsWith('.md') ? contextMenu.path.slice(0, -3) : contextMenu.path
              handleCreateFile('folder', cleanParent || undefined)
              setContextMenu((prev) => ({ ...prev, isOpen: false }))
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            <Folder size={13} className="text-slate-400" />
            New Folder
          </button>

          <button
            onClick={() => {
              const cleanParent = contextMenu.path?.endsWith('.md') ? contextMenu.path.slice(0, -3) : contextMenu.path
              handleCreateFile('board', cleanParent || undefined)
              setContextMenu((prev) => ({ ...prev, isOpen: false }))
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            <LayoutGrid size={13} className="text-rose-400" />
            New Board
          </button>

          <div className="border-t border-slate-850/60 my-1" />

          <button
            onClick={() => {
              if (contextMenu.path) {
                handleDeleteFile(contextMenu.path)
              }
              setContextMenu((prev) => ({ ...prev, isOpen: false }))
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-red-950/40 text-slate-400 hover:text-red-400 rounded-lg text-xs transition cursor-pointer text-left w-full font-medium"
          >
            <Trash2 size={13} className="text-red-500" />
            Delete Item
          </button>
        </div>
      )}
    </div>
  )
}
export default App
