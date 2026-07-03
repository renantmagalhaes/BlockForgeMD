import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Calendar, User, Plus, Trash2, Edit3, X, Check,
  ChevronLeft, ChevronRight, Settings, Palette,
} from 'lucide-react'

interface FileRecord {
  path: string
  title: string
  type: string
  contentHash: string
  updatedAt: string
  frontMatter?: Record<string, string>
}

interface PriorityDef {
  name: string
  color: string
}

interface KanbanProps {
  files: FileRecord[]
  onMoveCard: (path: string, newStatus: string) => Promise<void>
  onSelectFile: (path: string) => void
  onCreateTaskInColumn: (title: string, status: string) => Promise<void>
  boardPath: string | null
  boardColumns: string[]
  onUpdateColumns?: (columns: string[]) => Promise<void>
  boardFrontMatter?: Record<string, string>
  onUpdateBoardFrontMatter?: (updates: Record<string, unknown>) => Promise<void>
  onUpdateTaskFrontMatter?: (path: string, updates: Record<string, unknown>) => Promise<void>
}

const DEFAULT_PRIORITIES: PriorityDef[] = [
  { name: 'High',   color: '#ef4444' },
  { name: 'Medium', color: '#f59e0b' },
  { name: 'Low',    color: '#3b82f6' },
]

const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#ec4899', '#f43f5e', '#64748b',
]

const DEFAULT_COL_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
]

function parseTags(v?: string | string[]): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] }
  catch { return [] }
}

function parseJSON<T>(v: string | undefined, fallback: T): T {
  if (!v) return fallback
  try { return JSON.parse(v) as T }
  catch { return fallback }
}

// ─── TagInput ─────────────────────────────────────────────────────────────────
const TagInput: React.FC<{
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  onSubmit: (tag: string) => void
  onCancel: () => void
}> = ({ value, onChange, suggestions, onSubmit, onCancel }) => {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const filtered = value
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value)
    : suggestions

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) { e.preventDefault(); onSubmit(value.trim()) }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        placeholder="tag…"
        className="w-20 bf-kanban-input rounded px-1.5 py-0.5 text-[10px] outline-none"
      />
      {filtered.length > 0 && (
        <div className="absolute top-full left-0 mt-0.5 bf-kanban-popover rounded-lg py-1 z-50 min-w-[110px] max-h-28 overflow-y-auto no-scrollbar">
          {filtered.map(s => (
            <button
              key={s}
              onMouseDown={e => { e.preventDefault(); onSubmit(s) }}
              className="flex w-full px-2 py-1 text-[10px] bf-kanban-popover-item text-left cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ColorPalette ─────────────────────────────────────────────────────────────
const ColorPalette: React.FC<{
  selected?: string
  onSelect: (color: string) => void
  style?: React.CSSProperties
}> = ({ selected, onSelect, style }) => (
  <div
    className="p-2 bf-kanban-popover rounded-xl grid grid-cols-4 gap-1.5"
    style={{ position: 'fixed', zIndex: 9999, ...style }}
    onClick={e => e.stopPropagation()}
  >
    {COLOR_PALETTE.map(c => (
      <button
        key={c}
        onClick={() => onSelect(c)}
        className="w-5 h-5 rounded-full hover:scale-110 transition cursor-pointer"
        style={{
          background: c,
          outline: selected === c ? '2px solid white' : '2px solid transparent',
          outlineOffset: '1px',
        }}
      />
    ))}
  </div>
)

// ─── BoardSettingsModal ────────────────────────────────────────────────────────
const BoardSettingsModal: React.FC<{
  priorities: PriorityDef[]
  tagColors: Record<string, string>
  allBoardTags: string[]
  onClose: () => void
  onSavePriority: (idx: number, name: string, color: string) => Promise<void>
  onDeletePriority: (idx: number) => Promise<void>
  onAddPriority: (name: string, color: string) => Promise<void>
  onSetTagColor: (tag: string, color: string) => Promise<void>
}> = ({ priorities, tagColors, allBoardTags, onClose, onSavePriority, onDeletePriority, onAddPriority, onSetTagColor }) => {
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editName, setEditName]     = useState('')
  const [editColor, setEditColor]   = useState('')
  const [newName, setNewName]       = useState('')
  const [newColor, setNewColor]     = useState('#8b5cf6')
  const [colorPicker, setColorPicker] = useState<{ key: string; x: number; y: number } | null>(null)

  const startEdit = (idx: number) => {
    setEditingIdx(idx)
    setEditName(priorities[idx].name)
    setEditColor(priorities[idx].color)
  }

  const openPicker = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setColorPicker(colorPicker?.key === key ? null : { key, x: r.right + 6, y: r.top })
  }

  const handlePickerSelect = (color: string) => {
    if (!colorPicker) return
    if (colorPicker.key === 'new') { setNewColor(color) }
    else if (colorPicker.key === 'edit') { setEditColor(color) }
    else { onSetTagColor(colorPicker.key, color) }
    setColorPicker(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bf-kanban-modal rounded-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-5 py-4 bf-kanban-modal-header">
          <h2 className="bf-kanban-modal-title font-semibold text-sm">Board Settings</h2>
          <button onClick={onClose} className="bf-kanban-icon-btn rounded transition cursor-pointer"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-7 max-h-[70vh] overflow-y-auto no-scrollbar">
          {/* Priorities */}
          <div>
            <h3 className="text-[10px] font-bold bf-kanban-section-label uppercase tracking-widest mb-3">Priorities</h3>
            <p className="text-[11px] bf-kanban-hint mb-3">Renaming a priority will update all cards on this board.</p>
            <div className="space-y-1.5">
              {priorities.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2 group">
                  {editingIdx === idx ? (
                    <>
                      <button
                        className="w-5 h-5 rounded-full shrink-0 border-2 bf-kanban-color-swatch cursor-pointer hover:opacity-80 transition"
                        style={{ background: editColor }}
                        onClick={e => openPicker('edit', e)}
                        title="Change color"
                      />
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && editName.trim()) { onSavePriority(idx, editName.trim(), editColor); setEditingIdx(null) } if (e.key === 'Escape') setEditingIdx(null) }}
                        className="flex-1 bf-kanban-input rounded px-2 py-1 text-xs outline-none"
                        autoFocus
                      />
                      <button onClick={() => { if (editName.trim()) { onSavePriority(idx, editName.trim(), editColor); setEditingIdx(null) } }} className="p-1 text-emerald-400 bf-kanban-icon-btn rounded cursor-pointer"><Check size={12} /></button>
                      <button onClick={() => setEditingIdx(null)} className="p-1 bf-kanban-icon-btn rounded cursor-pointer"><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="flex-1 text-sm bf-kanban-modal-text">{p.name}</span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => startEdit(idx)} className="p-1 bf-kanban-icon-btn rounded cursor-pointer"><Edit3 size={11} /></button>
                        <button onClick={() => onDeletePriority(idx)} className="p-1 bf-kanban-icon-btn bf-kanban-icon-btn--danger rounded cursor-pointer"><Trash2 size={11} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Add new priority */}
            <div className="flex items-center gap-2 mt-3 pt-3 bf-kanban-divider">
              <button
                className="w-5 h-5 rounded-full shrink-0 border-2 bf-kanban-color-swatch cursor-pointer hover:opacity-80 transition"
                style={{ background: newColor }}
                onClick={e => openPicker('new', e)}
                title="Pick color"
              />
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { onAddPriority(newName.trim(), newColor); setNewName(''); setNewColor('#8b5cf6') } }}
                placeholder="New priority name…"
                className="flex-1 bf-kanban-input rounded px-2 py-1 text-xs outline-none"
              />
              <button
                onClick={() => { if (newName.trim()) { onAddPriority(newName.trim(), newColor); setNewName(''); setNewColor('#8b5cf6') } }}
                disabled={!newName.trim()}
                className="p-1.5 bf-kanban-accent-btn rounded disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          {/* Tag colors */}
          {allBoardTags.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold bf-kanban-section-label uppercase tracking-widest mb-3">Tag Colors</h3>
              <p className="text-[11px] bf-kanban-hint mb-3">Click a tag to change its color.</p>
              <div className="flex flex-wrap gap-2">
                {allBoardTags.map(tag => {
                  const tc = tagColors[tag] || '#8b5cf6'
                  return (
                    <button
                      key={tag}
                      onClick={e => openPicker(tag, e)}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border font-medium cursor-pointer hover:opacity-80 transition"
                      style={{ background: tc + '18', borderColor: tc + '44', color: tc }}
                    >
                      <Palette size={9} />
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {colorPicker && (
        <ColorPalette
          selected={colorPicker.key === 'new' ? newColor : colorPicker.key === 'edit' ? editColor : tagColors[colorPicker.key]}
          onSelect={handlePickerSelect}
          style={{ top: colorPicker.y, left: colorPicker.x }}
        />
      )}
    </div>
  )
}

// ─── Main Kanban ───────────────────────────────────────────────────────────────
export const Kanban: React.FC<KanbanProps> = ({
  files,
  onMoveCard,
  onSelectFile,
  onCreateTaskInColumn,
  boardPath,
  boardColumns,
  onUpdateColumns,
  boardFrontMatter,
  onUpdateBoardFrontMatter,
  onUpdateTaskFrontMatter,
}) => {
  const [draggingPath, setDraggingPath]   = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [newCardTitles, setNewCardTitles] = useState<Record<string, string>>({})
  const [editingColumn, setEditingColumn] = useState<string | null>(null)
  const [editColVal, setEditColVal]       = useState('')

  const [settingsOpen, setSettingsOpen]   = useState(false)

  // Priority picker: which card + where to position
  const [priorityPicker, setPriorityPicker] = useState<{ path: string; x: number; y: number } | null>(null)
  // Column color picker
  const [colColorPicker, setColColorPicker] = useState<{ col: string; x: number; y: number } | null>(null)
  // Tag inline editor
  const [tagEditorCard, setTagEditorCard] = useState<string | null>(null)
  const [tagInput, setTagInput]           = useState('')

  // Parse board-level config
  const columnColors = useMemo(
    () => parseJSON<Record<string, string>>(boardFrontMatter?.columnColors, {}),
    [boardFrontMatter?.columnColors],
  )
  const priorities = useMemo(() => {
    const p = parseJSON<PriorityDef[] | null>(boardFrontMatter?.priorities, null)
    return Array.isArray(p) && p.length > 0 ? p : DEFAULT_PRIORITIES
  }, [boardFrontMatter?.priorities])

  const tagColors = useMemo(
    () => parseJSON<Record<string, string>>(boardFrontMatter?.tagColors, {}),
    [boardFrontMatter?.tagColors],
  )

  const getParentDir = (p: string) => { const i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i + 1) }

  const boardFolder = boardPath
    ? boardPath.endsWith('.board.md')
      ? boardPath.slice(0, -'.board.md'.length) + '/'
      : getParentDir(boardPath)
    : ''

  const tasks = useMemo(() => files.filter(f => {
    if (!(f.type === 'task' || f.frontMatter?.status)) return false
    const folder = getParentDir(f.path)
    if (boardFolder) return folder === boardFolder
    return folder === '' || folder === 'Tasks/'
  }), [files, boardFolder])

  const allBoardTags = useMemo(() => {
    const s = new Set<string>()
    tasks.forEach(t => parseTags(t.frontMatter?.tags).forEach(tag => s.add(tag)))
    return Array.from(s).sort()
  }, [tasks])

  const getTasksByColumn = (col: string) =>
    tasks.filter(t => (t.frontMatter?.status || '').toLowerCase() === col.toLowerCase())

  const getColumnColor = (col: string, idx: number) =>
    columnColors[col] || DEFAULT_COL_COLORS[idx % DEFAULT_COL_COLORS.length]

  const getPriorityDef = (name?: string) =>
    priorities.find(p => p.name.toLowerCase() === (name || '').toLowerCase())

  // ── Drag ──────────────────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('text/plain', path); setDraggingPath(path)
  }
  const handleDragEnd = () => { setDraggingPath(null); setDragOverColumn(null) }
  const handleDrop = (e: React.DragEvent, col: string) => {
    e.preventDefault()
    const path = e.dataTransfer.getData('text/plain')
    if (path) onMoveCard(path, col)
    setDraggingPath(null); setDragOverColumn(null)
  }

  // ── Quick create ──────────────────────────────────────────────────────────
  const handleQuickCreate = (e: React.FormEvent, col: string) => {
    e.preventDefault()
    const title = newCardTitles[col]?.trim()
    if (!title) return
    onCreateTaskInColumn(title, col)
    setNewCardTitles(prev => ({ ...prev, [col]: '' }))
  }

  // ── Column ops ────────────────────────────────────────────────────────────
  const handleAddColumn = async () => {
    const name = prompt('New column name:')?.trim()
    if (!name) return
    if (boardColumns.some(c => c.toLowerCase() === name.toLowerCase())) { alert('Column already exists.'); return }
    await onUpdateColumns?.([...boardColumns, name])
  }

  const saveRenameColumn = async (old: string) => {
    const next = editColVal.trim()
    if (!next || next === old) { setEditingColumn(null); return }
    if (boardColumns.some(c => c !== old && c.toLowerCase() === next.toLowerCase())) { alert('Column already exists.'); return }
    for (const c of getTasksByColumn(old)) await onMoveCard(c.path, next)
    await onUpdateColumns?.(boardColumns.map(c => c === old ? next : c))
    setEditingColumn(null)
  }

  const handleDeleteColumn = async (col: string) => {
    if (!confirm(`Delete "${col}"? Tasks here will be unassigned.`)) return
    for (const c of getTasksByColumn(col)) await onMoveCard(c.path, '')
    await onUpdateColumns?.(boardColumns.filter(c => c !== col))
  }

  const moveColumn = async (col: string, dir: 'left' | 'right') => {
    const idx = boardColumns.indexOf(col)
    const to  = dir === 'left' ? idx - 1 : idx + 1
    if (to < 0 || to >= boardColumns.length) return
    const next = [...boardColumns];
    [next[idx], next[to]] = [next[to], next[idx]]
    await onUpdateColumns?.(next)
  }

  // ── Column color ──────────────────────────────────────────────────────────
  const handleSetColumnColor = async (col: string, color: string) => {
    await onUpdateBoardFrontMatter?.({ columnColors: { ...columnColors, [col]: color } })
    setColColorPicker(null)
  }

  // ── Priority ops ──────────────────────────────────────────────────────────
  const handleSetCardPriority = async (path: string, name: string) => {
    await onUpdateTaskFrontMatter?.(path, { priority: name })
    setPriorityPicker(null)
  }

  const handleSavePriority = async (idx: number, name: string, color: string) => {
    const old = priorities[idx].name
    await onUpdateBoardFrontMatter?.({ priorities: priorities.map((p, i) => i === idx ? { name, color } : p) })
    if (old !== name) {
      for (const t of tasks) {
        if (t.frontMatter?.priority?.toLowerCase() === old.toLowerCase()) {
          await onUpdateTaskFrontMatter?.(t.path, { priority: name })
        }
      }
    }
  }

  const handleDeletePriority = async (idx: number) =>
    onUpdateBoardFrontMatter?.({ priorities: priorities.filter((_, i) => i !== idx) })

  const handleAddPriority = async (name: string, color: string) =>
    onUpdateBoardFrontMatter?.({ priorities: [...priorities, { name, color }] })

  // ── Tag ops ───────────────────────────────────────────────────────────────
  const handleAddTag = async (path: string, tag: string, current: string[]) => {
    const t = tag.trim()
    if (!t || current.includes(t)) return
    await onUpdateTaskFrontMatter?.(path, { tags: [...current, t] })
    setTagInput(''); setTagEditorCard(null)
  }

  const handleRemoveTag = async (path: string, tag: string, current: string[]) =>
    onUpdateTaskFrontMatter?.(path, { tags: current.filter(t => t !== tag) })

  const handleSetTagColor = async (tag: string, color: string) =>
    onUpdateBoardFrontMatter?.({ tagColors: { ...tagColors, [tag]: color } })

  // Close floating popovers on outside click
  useEffect(() => {
    const close = () => { setPriorityPicker(null); setColColorPicker(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const boardName = boardPath
    ? boardPath.split('/').pop()?.replace('.board.md', '') ?? 'Board'
    : 'Workspace Board'

  return (
    <div className="flex flex-col h-full bf-kanban rounded-xl overflow-hidden p-6">
      {/* ── Header ── */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold bf-kanban-title">{boardName}</h1>
          <p className="bf-kanban-hint text-xs mt-0.5">
            Drag to move · Double-click column to rename · Click priority badge to change
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); setSettingsOpen(true) }}
            className="flex items-center gap-1.5 px-3 py-2 bf-kanban-btn text-xs rounded-lg transition cursor-pointer"
          >
            <Settings size={12} /> Settings
          </button>
          {onUpdateColumns && (
            <button
              onClick={handleAddColumn}
              className="flex items-center gap-1.5 px-4 py-2 bf-kanban-accent-btn font-medium text-xs rounded-lg active:scale-95 transition cursor-pointer"
            >
              <Plus size={14} /> Add Group
            </button>
          )}
        </div>
      </div>

      {/* ── Board grid ── */}
      <div className="flex gap-4 flex-1 overflow-x-auto overflow-y-hidden pb-4 no-scrollbar items-start">
        {boardColumns.map((col, colIdx) => {
          const colTasks    = getTasksByColumn(col)
          const isOver      = dragOverColumn === col
          const isEditing   = editingColumn === col
          const accent      = getColumnColor(col, colIdx)

          return (
            <div
              key={col}
              onDragOver={e => { e.preventDefault(); setDragOverColumn(col) }}
              onDragEnter={() => setDragOverColumn(col)}
              onDrop={e => handleDrop(e, col)}
              className={`flex flex-col rounded-xl min-h-[500px] max-h-full w-[272px] shrink-0 transition-all duration-200 bf-kanban-col ${isOver ? 'scale-[1.01]' : ''}`}
              data-over={isOver}
              style={{ borderTop: `3px solid ${accent}` }}
            >
              {/* Column header */}
              <div className="flex justify-between items-center px-3 py-3 bf-kanban-col-header shrink-0 select-none">
                {isEditing ? (
                  <div className="flex items-center gap-1 flex-1 mr-1">
                    <input
                      value={editColVal}
                      onChange={e => setEditColVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveRenameColumn(col); if (e.key === 'Escape') setEditingColumn(null) }}
                      className="bf-kanban-input rounded px-2 py-0.5 text-xs outline-none w-full"
                      autoFocus
                    />
                    <button onClick={() => saveRenameColumn(col)} className="p-1 text-emerald-400 bf-kanban-icon-btn rounded cursor-pointer"><Check size={11} /></button>
                    <button onClick={() => setEditingColumn(null)} className="p-1 bf-kanban-icon-btn rounded cursor-pointer"><X size={11} /></button>
                  </div>
                ) : (
                  <div
                    onDoubleClick={() => onUpdateColumns && (setEditingColumn(col), setEditColVal(col))}
                    className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer group"
                    title={onUpdateColumns ? 'Double-click to rename' : undefined}
                  >
                    {/* Color dot */}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        setColColorPicker(colColorPicker?.col === col ? null : { col, x: r.left, y: r.bottom + 6 })
                      }}
                      className="w-3 h-3 rounded-full shrink-0 ring-1 ring-black/30 hover:ring-white/30 transition cursor-pointer"
                      style={{ background: accent }}
                      title="Change column color"
                    />
                    {/* Colored badge */}
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest shrink-0"
                      style={{ background: accent + '22', border: `1px solid ${accent}44`, color: accent }}
                    >
                      {col}
                    </span>
                    <span className="text-xs font-bold bf-kanban-col-count">{colTasks.length}</span>
                    {onUpdateColumns && <Edit3 size={9} className="bf-kanban-col-edit-icon opacity-0 group-hover:opacity-100 transition ml-auto" />}
                  </div>
                )}

                {onUpdateColumns && !isEditing && (
                  <div className="flex items-center shrink-0 ml-1">
                    <button onClick={() => moveColumn(col, 'left')} disabled={colIdx === 0} className="p-1 bf-kanban-icon-btn disabled:opacity-10 rounded transition cursor-pointer"><ChevronLeft size={11} /></button>
                    <button onClick={() => moveColumn(col, 'right')} disabled={colIdx === boardColumns.length - 1} className="p-1 bf-kanban-icon-btn disabled:opacity-10 rounded transition cursor-pointer"><ChevronRight size={11} /></button>
                    <button onClick={() => handleDeleteColumn(col)} className="p-1 bf-kanban-icon-btn bf-kanban-icon-btn--danger rounded transition cursor-pointer"><Trash2 size={11} /></button>
                  </div>
                )}
              </div>

              {/* Cards */}
              <div className="flex-1 p-2 space-y-2 overflow-y-auto no-scrollbar">
                {colTasks.map(task => {
                  const priority    = task.frontMatter?.priority
                  const pDef        = getPriorityDef(priority)
                  const pColor      = pDef?.color || '#64748b'
                  const assignee    = task.frontMatter?.assignee
                  const dueDate     = task.frontMatter?.dueDate?.split('T')[0]
                  const tags        = parseTags(task.frontMatter?.tags)
                  const isDragging  = draggingPath === task.path
                  const showTagEd   = tagEditorCard === task.path

                  return (
                    <div
                      key={task.path}
                      draggable
                      onDragStart={e => handleDragStart(e, task.path)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onSelectFile(task.path)}
                      className={`p-3 rounded-lg cursor-pointer transition select-none group relative bf-kanban-card ${isDragging ? 'opacity-40 scale-95' : ''}`}
                      data-dragging={isDragging}
                      style={{ borderLeft: `3px solid ${accent}55` }}
                    >
                      {/* Title */}
                      <div className="font-medium bf-kanban-card-title transition mb-2.5 text-[13px] leading-snug break-words min-w-0">
                        {task.title}
                      </div>

                      {/* Meta */}
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Priority — clickable */}
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              const r = e.currentTarget.getBoundingClientRect()
                              setPriorityPicker(
                                priorityPicker?.path === task.path
                                  ? null
                                  : { path: task.path, x: r.left, y: r.bottom + 4 }
                              )
                            }}
                            className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md tracking-wider border transition hover:opacity-90 cursor-pointer"
                            style={{ background: pColor + '20', borderColor: pColor + '50', color: pColor }}
                          >
                            {priority || 'No priority'}
                          </button>

                          {dueDate && (
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bf-kanban-meta-badge">
                              <Calendar size={9} /><span>{dueDate}</span>
                            </div>
                          )}
                          {assignee && assignee !== 'Unassigned' && (
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] bf-kanban-meta-badge">
                              <User size={9} /><span>{assignee}</span>
                            </div>
                          )}
                        </div>

                        {/* Tags */}
                        <div className="flex flex-wrap gap-1 items-center" onClick={e => e.stopPropagation()}>
                          {tags.map(tag => {
                            const tc = tagColors[tag] || '#8b5cf6'
                            return (
                              <span
                                key={tag}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded-md border font-medium group/tag"
                                style={{ background: tc + '18', borderColor: tc + '44', color: tc }}
                              >
                                {tag}
                                <button
                                  onClick={() => handleRemoveTag(task.path, tag, tags)}
                                  className="ml-0.5 opacity-0 group-hover/tag:opacity-100 hover:text-red-400 transition cursor-pointer"
                                >
                                  <X size={8} />
                                </button>
                              </span>
                            )
                          })}

                          {showTagEd ? (
                            <TagInput
                              value={tagInput}
                              onChange={setTagInput}
                              suggestions={allBoardTags.filter(t => !tags.includes(t))}
                              onSubmit={tag => handleAddTag(task.path, tag, tags)}
                              onCancel={() => { setTagEditorCard(null); setTagInput('') }}
                            />
                          ) : (
                            <button
                              onClick={() => setTagEditorCard(task.path)}
                              className={`px-1.5 py-0.5 text-[10px] rounded-md border border-dashed transition cursor-pointer bf-kanban-tag-btn ${
                                tags.length === 0 ? 'opacity-0 group-hover:opacity-100' : ''
                              }`}
                            >
                              + tag
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Quick create */}
              <div className="p-2.5 bf-kanban-col-footer shrink-0">
                <form onSubmit={e => handleQuickCreate(e, col)} className="flex gap-1.5">
                  <input
                    type="text"
                    required
                    placeholder="Add task…"
                    value={newCardTitles[col] || ''}
                    onChange={e => setNewCardTitles(prev => ({ ...prev, [col]: e.target.value }))}
                    className="flex-1 bf-kanban-input rounded-lg px-3 py-1.5 text-xs outline-none transition"
                  />
                  <button
                    type="submit"
                    className="flex items-center justify-center w-7 h-7 bf-kanban-add-btn rounded-lg transition cursor-pointer"
                  >
                    <Plus size={13} />
                  </button>
                </form>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Fixed-position popovers ── */}
      {priorityPicker && (
        <div
          className="fixed z-[9999] bf-kanban-popover rounded-xl py-1.5 min-w-[160px]"
          style={{ top: priorityPicker.y, left: priorityPicker.x }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 pb-1 text-[10px] font-semibold bf-kanban-section-label uppercase tracking-wider">Priority</div>
          {priorities.map(p => {
            const isCurrent = tasks.find(t => t.path === priorityPicker.path)?.frontMatter?.priority?.toLowerCase() === p.name.toLowerCase()
            return (
              <button
                key={p.name}
                onClick={() => handleSetCardPriority(priorityPicker.path, p.name)}
                className="flex items-center gap-2 w-full px-3 py-1.5 bf-kanban-popover-item text-left text-xs transition cursor-pointer"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="bf-kanban-modal-text">{p.name}</span>
                {isCurrent && <Check size={10} className="text-emerald-400 ml-auto" />}
              </button>
            )
          })}
        </div>
      )}

      {colColorPicker && (
        <ColorPalette
          selected={columnColors[colColorPicker.col]}
          onSelect={color => handleSetColumnColor(colColorPicker.col, color)}
          style={{ top: colColorPicker.y, left: colColorPicker.x }}
        />
      )}

      {/* ── Settings modal ── */}
      {settingsOpen && (
        <BoardSettingsModal
          priorities={priorities}
          tagColors={tagColors}
          allBoardTags={allBoardTags}
          onClose={() => setSettingsOpen(false)}
          onSavePriority={handleSavePriority}
          onDeletePriority={handleDeletePriority}
          onAddPriority={handleAddPriority}
          onSetTagColor={handleSetTagColor}
        />
      )}
    </div>
  )
}

export default Kanban
