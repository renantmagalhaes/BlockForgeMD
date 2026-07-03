import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Trash2, RotateCcw, X, FileText, Folder, Clock,
  AlertTriangle, CheckSquare, Brain, Brush, LayoutGrid,
} from 'lucide-react'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

interface TrashItem {
  id: string
  originalPath: string
  name: string
  type: string
  trashedAt: string
  expiresAt: string
  fileCount: number
  files: string[]
}

interface TrashPanelProps {
  onClose: () => void
  trashRetentionDays: number
  workspace: string
}

function getTypeIcon(item: TrashItem) {
  const name = item.originalPath
  if (item.type === 'folder') return <Folder size={15} className="text-slate-400 shrink-0" />
  if (name.endsWith('.board.md')) return <LayoutGrid size={15} className="text-violet-400 shrink-0" />
  if (name.endsWith('.mindmap.md')) return <Brain size={15} className="text-violet-400 shrink-0" />
  if (name.endsWith('.excalidraw.md') || name.endsWith('.drawio.md'))
    return <Brush size={15} className="text-emerald-400 shrink-0" />
  if (name.includes('/Tasks/') || name.includes('/Boards/'))
    return <CheckSquare size={15} className="text-amber-500 shrink-0" />
  return <FileText size={15} className="text-blue-400 shrink-0" />
}

function cleanName(name: string): string {
  return name
    .replace(/\.(board|excalidraw|drawio|mindmap)\.md$/, '')
    .replace(/\.md$/, '')
}

function daysUntil(iso: string): number | null {
  if (!iso || iso.startsWith('0001')) return null
  const diff = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Simple section label component
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 px-1 pb-1 pt-3">
      {children}
    </div>
  )
}

export default function TrashPanel({ onClose, trashRetentionDays, workspace }: TrashPanelProps) {
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ content: string; filePath: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [folderFile, setFolderFile] = useState<string | null>(null)
  const [folderPreview, setFolderPreview] = useState<string | null>(null)
  const [folderFileLoading, setFolderFileLoading] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const showToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/trash?workspace=${encodeURIComponent(workspace)}`)
      if (res.ok) setItems(await res.json())
    } finally {
      setLoading(false)
    }
  }, [workspace])

  useEffect(() => { fetchItems() }, [fetchItems])

  // Auto-refresh the trash list whenever a file is deleted or restored
  // (the server broadcasts file_update events for both operations).
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/sync/events`)
    es.addEventListener('file_update', () => { fetchItems() })
    return () => es.close()
  }, [fetchItems])

  // Clear folder file selection whenever the selected trash item changes
  useEffect(() => {
    setFolderFile(null)
    setFolderPreview(null)
  }, [selected])

  const selectFolderFile = async (trashId: string, filePath: string) => {
    setFolderFile(filePath)
    setFolderPreview(null)
    setFolderFileLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/api/trash/content?workspace=${encodeURIComponent(workspace)}&id=${encodeURIComponent(trashId)}&path=${encodeURIComponent(filePath)}`
      )
      if (res.ok) {
        const data = await res.json()
        setFolderPreview(data.content)
      }
    } finally {
      setFolderFileLoading(false)
    }
  }

  const selectItem = async (item: TrashItem) => {
    setSelected(item.id)
    setPreview(null)
    if (item.type === 'file') {
      setPreviewLoading(true)
      try {
        const res = await fetch(
          `${API_BASE}/api/trash/content?workspace=${encodeURIComponent(workspace)}&id=${encodeURIComponent(item.id)}&path=${encodeURIComponent(item.originalPath)}`
        )
        if (res.ok) {
          const data = await res.json()
          setPreview({ content: data.content, filePath: item.originalPath })
        }
      } finally {
        setPreviewLoading(false)
      }
    }
  }

  const handleRestore = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/trash/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, workspace }),
      })
      if (!res.ok) {
        const msg = await res.text()
        showToast(msg || 'Restore failed')
        return
      }
      if (selected === id) { setSelected(null); setPreview(null) }
      showToast('Restored successfully')
      fetchItems()
    } catch {
      showToast('Restore failed')
    }
  }

  const handlePurge = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/trash?workspace=${encodeURIComponent(workspace)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) { showToast('Delete failed'); return }
      if (selected === id) { setSelected(null); setPreview(null) }
      showToast('Permanently deleted')
      fetchItems()
    } catch {
      showToast('Delete failed')
    }
  }

  const handleEmptyTrash = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/trash/all?workspace=${encodeURIComponent(workspace)}`, { method: 'DELETE' })
      if (!res.ok) { showToast('Failed to empty trash'); return }
      setSelected(null)
      setPreview(null)
      setConfirmEmpty(false)
      showToast('Trash emptied')
      fetchItems()
    } catch {
      showToast('Failed to empty trash')
    }
  }

  const selectedItem = items.find(i => i.id === selected)

  return (
    <div
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onMouseDown={onClose}
    >
      <motion.div
        className="bg-[#12151c] border border-slate-800 rounded-2xl w-full max-w-4xl h-[600px] shadow-2xl flex flex-col overflow-hidden"
        initial={{ scale: 0.96, opacity: 0, y: -10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: -10 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <Trash2 size={16} className="text-red-400" />
            <h3 className="font-bold text-slate-100 text-base">Trash</h3>
            {items.length > 0 && (
              <span className="text-xs text-slate-500 font-mono">
                {items.length} item{items.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              confirmEmpty ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-400">Empty all?</span>
                  <button
                    onClick={handleEmptyTrash}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white cursor-pointer transition"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmEmpty(false)}
                    className="px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200 cursor-pointer transition"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmEmpty(true)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium text-red-400 hover:bg-red-950/40 hover:text-red-300 cursor-pointer transition border border-red-900/40"
                >
                  Empty Trash
                </button>
              )
            )}
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Item list */}
          <div className="w-72 border-r border-slate-800 flex flex-col overflow-hidden shrink-0">
            <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-2">
              {loading ? (
                <div className="text-xs text-slate-500 text-center py-8">Loading…</div>
              ) : items.length === 0 ? (
                <div className="text-center py-16 space-y-2">
                  <Trash2 size={28} className="text-slate-700 mx-auto" />
                  <p className="text-xs text-slate-500">Trash is empty</p>
                </div>
              ) : (
                <>
                  {trashRetentionDays > 0 && (
                    <SectionHeader>
                      Auto-delete after {trashRetentionDays} day{trashRetentionDays !== 1 ? 's' : ''}
                    </SectionHeader>
                  )}
                  {items.map(item => {
                    const days = daysUntil(item.expiresAt)
                    const urgent = days !== null && days <= 3
                    return (
                      <button
                        key={item.id}
                        onClick={() => selectItem(item)}
                        className={`w-full text-left flex items-start gap-2.5 px-2.5 py-2 rounded-xl mb-1 transition cursor-pointer ${
                          selected === item.id
                            ? 'bg-slate-800 text-slate-100'
                            : 'hover:bg-slate-800/50 text-slate-300'
                        }`}
                      >
                        <div className="mt-0.5">{getTypeIcon(item)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{cleanName(item.name)}</div>
                          <div className="text-[10px] text-slate-500 truncate mt-0.5">
                            {item.originalPath.split('/').slice(0, -1).join('/')}
                          </div>
                          <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${urgent ? 'text-red-400' : 'text-slate-600'}`}>
                            <Clock size={9} />
                            {days === null
                              ? formatDate(item.trashedAt)
                              : days === 0
                              ? 'Expires today'
                              : `${days}d remaining`}
                          </div>
                        </div>
                        {item.type === 'folder' && (
                          <span className="text-[9px] text-slate-600 font-mono shrink-0 mt-0.5">
                            {item.fileCount}f
                          </span>
                        )}
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          </div>

          {/* Preview / detail pane */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {!selectedItem ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-slate-600">Select an item to preview</p>
              </div>
            ) : (
              <>
                {/* Detail header */}
                <div className="px-5 py-3 border-b border-slate-800 shrink-0 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(selectedItem)}
                      <span className="font-semibold text-sm text-slate-100 truncate">
                        {cleanName(selectedItem.name)}
                      </span>
                      {selectedItem.type === 'folder' && (
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          ({selectedItem.fileCount} file{selectedItem.fileCount !== 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 truncate">{selectedItem.originalPath}</div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      Deleted {formatDate(selectedItem.trashedAt)}
                      {daysUntil(selectedItem.expiresAt) !== null && (
                        <> · {daysUntil(selectedItem.expiresAt)} day{daysUntil(selectedItem.expiresAt) !== 1 ? 's' : ''} until permanent deletion</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRestore(selectedItem.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600/20 hover:bg-violet-600/35 text-violet-300 border border-violet-500/30 cursor-pointer transition"
                    >
                      <RotateCcw size={11} />
                      Restore
                    </button>
                    <button
                      onClick={() => handlePurge(selectedItem.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-950/30 hover:bg-red-950/50 text-red-400 border border-red-900/40 cursor-pointer transition"
                    >
                      <Trash2 size={11} />
                      Delete Forever
                    </button>
                  </div>
                </div>

                {/* Content preview */}
                {selectedItem.type === 'folder' ? (
                  <div className="flex flex-1 overflow-hidden min-h-0">
                    {/* File list column */}
                    <div className="w-48 shrink-0 border-r border-slate-800 overflow-y-auto no-scrollbar p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 px-1">
                        {selectedItem.fileCount} file{selectedItem.fileCount !== 1 ? 's' : ''}
                      </p>
                      {(selectedItem.files || []).map(f => {
                        const parts = f.split('/')
                        const name = parts[parts.length - 1]
                          .replace(/\.(board|excalidraw|drawio|mindmap)\.md$/, '')
                          .replace(/\.md$/, '')
                        const dir = parts.slice(0, -1).join('/')
                        return (
                          <button
                            key={f}
                            onClick={() => selectFolderFile(selectedItem.id, f)}
                            className={`w-full text-left flex items-start gap-1.5 py-1.5 px-2 rounded-lg mb-0.5 cursor-pointer transition ${
                              folderFile === f
                                ? 'bg-slate-700 text-slate-100'
                                : 'hover:bg-slate-800/50 text-slate-300'
                            }`}
                          >
                            <FileText size={10} className="text-slate-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="text-[11px] truncate">{name}</div>
                              {dir && <div className="text-[9px] text-slate-600 truncate">{dir}</div>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                    {/* Content preview column */}
                    <div className="flex-1 overflow-y-auto no-scrollbar p-5">
                      {folderFileLoading ? (
                        <div className="text-xs text-slate-500">Loading…</div>
                      ) : folderPreview ? (
                        <TrashContentPreview content={folderPreview} />
                      ) : (
                        <div className="text-xs text-slate-600 italic">Select a file to preview its contents</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto no-scrollbar p-5">
                    {previewLoading ? (
                      <div className="text-xs text-slate-500">Loading preview…</div>
                    ) : preview ? (
                      <TrashContentPreview content={preview.content} />
                    ) : (
                      <div className="text-xs text-slate-600 italic">No preview available</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Retention note footer */}
        {trashRetentionDays === 0 && (
          <div className="px-5 py-2.5 border-t border-slate-800 shrink-0 flex items-center gap-2 text-[11px] text-amber-500/80">
            <AlertTriangle size={11} />
            Trash is disabled — files are permanently deleted immediately. Change in Settings.
          </div>
        )}
      </motion.div>

      {/* Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium px-4 py-2 rounded-xl shadow-xl z-[99999]"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Content preview with image support ─────────────────────────────────────

function TrashContentPreview({ content }: { content: string }) {
  // Strip front matter
  const body = content.replace(/^---[\s\S]*?---\n?/, '').trim()

  // Split into lines and render basic markdown-like preview
  // Images with /api/trash-asset/... will render correctly since they're absolute API URLs
  return (
    <div className="prose-trash text-slate-300 text-xs leading-relaxed space-y-2 font-mono whitespace-pre-wrap break-words">
      <RawMarkdownPreview source={body} />
    </div>
  )
}

// Minimal markdown renderer that handles images and basic structure
function RawMarkdownPreview({ source }: { source: string }) {
  const lines = source.split('\n')

  const renderLine = (line: string, idx: number) => {
    // Heading
    const headingMatch = line.match(/^(#{1,6})\s(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = headingMatch[2]
      const sizes = ['text-lg', 'text-base', 'text-sm', 'text-xs', 'text-xs', 'text-xs']
      const weights = ['font-bold text-slate-100', 'font-bold text-slate-200', 'font-semibold text-slate-200', 'font-semibold text-slate-300', 'font-medium', 'font-medium']
      return <div key={idx} className={`${sizes[level - 1]} ${weights[level - 1]} mt-2`}>{text}</div>
    }

    // Markdown image: ![alt](url)
    const imgMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/)
    if (imgMatch) {
      const alt = imgMatch[1]
      const url = imgMatch[2]
      return (
        <div key={idx} className="my-2">
          <img
            src={url}
            alt={alt}
            className="max-w-full rounded-lg border border-slate-700"
            style={{ maxHeight: 300 }}
          />
        </div>
      )
    }

    // Empty line
    if (line.trim() === '') return <div key={idx} className="h-1" />

    // Regular text
    return <div key={idx} className="text-slate-400">{line}</div>
  }

  return <>{lines.map((line, idx) => renderLine(line, idx))}</>
}
