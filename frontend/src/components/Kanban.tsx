import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Calendar, User, Plus, Trash2, Edit3, X, Check,
  ChevronLeft, ChevronRight, Settings, Palette,
  Tag, ChevronDown, Search, ChevronsLeft, Copy, ArrowRight, GripVertical, ListChecks, Layers,
} from 'lucide-react'
import { Editor } from './Editor'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { alertDialog, confirmDialog, promptDialog } from '../lib/dialog'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

const splitFrontMatter = (content: string) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (match) return { fmStr: match[1], body: match[2].replace(/^\r?\n+/, '') }
  return { fmStr: '', body: content }
}

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

// Groups checkbox lines into separate checklists — each contiguous run of
// `- [ ]` lines (broken by any non-checkbox line: blank, heading, paragraph,
// ...) becomes its own checklist, shown on the card as its own progress bar
// and toggle rather than one big list mixing unrelated checklists together.
const parseChecklistGroups = (content: string): { done: boolean; text: string }[][] => {
  const groups: { done: boolean; text: string }[][] = []
  let current: { done: boolean; text: string }[] = []
  content.split('\n').forEach(line => {
    const m = line.match(/^[\s>-]*\[([x ])\]\s+(.+)/i)
    if (m) {
      current.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim() })
    } else if (current.length > 0) {
      groups.push(current)
      current = []
    }
  })
  if (current.length > 0) groups.push(current)
  return groups
}

interface PriorityDef {
  name: string
  color: string
}

interface KanbanProps {
  files: FileRecord[]
  onMoveCard: (path: string, newStatus: string) => Promise<void>
  onMoveCardToBoard?: (cardPath: string, targetBoardPath: string, targetColumn: string) => Promise<void>
  onSelectFile: (path: string) => void
  onCreateTaskInColumn: (title: string, status: string) => Promise<void>
  boardPath: string | null
  boardColumns: string[]
  onUpdateColumns?: (columns: string[]) => Promise<void>
  boardFrontMatter?: Record<string, string>
  onUpdateBoardFrontMatter?: (updates: Record<string, unknown>) => Promise<void>
  onUpdateTaskFrontMatter?: (path: string, updates: Record<string, unknown>) => Promise<void>
  onReorderCards?: (updates: { path: string; position: number }[]) => Promise<void>
  onDeleteCard?: (path: string) => void
  onRenameBoard?: (newName: string) => Promise<void>
  onCardSaved?: () => void
  initialCardViewMode?: 'modal' | 'sidebar' | 'fullscreen'
  onSaveCardViewMode?: (mode: 'modal' | 'sidebar' | 'fullscreen') => void
  initialPropertiesCollapsed?: boolean
  isMobile?: boolean
  autosaveDelay?: number
  activeWorkspace?: string
  tagColors?: Record<string, string>
  onEnsureTagColor?: (tag: string) => void
  onSetGlobalTagColor?: (tag: string, color: string) => void
}

const DEFAULT_PRIORITIES: PriorityDef[] = [
  { name: 'Urgent', color: '#ef4444' },
  { name: 'High',   color: '#dc2626' },
  { name: 'Medium', color: '#f59e0b' },
  { name: 'Low',    color: '#94a3b8' },
]

export const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#ec4899', '#f43f5e', '#64748b',
]

const DEFAULT_COL_COLORS = [
  '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
]

// Fixed colors for the well-known default columns every new board starts
// with — purple/blue/green reads as "not started / active / finished" and
// shouldn't shift just because a custom column happens to hash the same way.
const NAMED_COL_COLORS: Record<string, string> = {
  'todo': '#8b5cf6',
  'in progress': '#3b82f6',
  'done': '#10b981',
}

// Deterministic index derived from the column's own name, not its position in
// the board — so a column's default color stays put when columns are
// reordered, instead of following whichever slot it's dragged into.
function hashColumnName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

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
const isValidHexColor = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())

const ColorPalette: React.FC<{
  selected?: string
  onSelect: (color: string) => void
  style?: React.CSSProperties
}> = ({ selected, onSelect, style }) => {
  const [hexInput, setHexInput] = useState(selected ?? '')

  useEffect(() => { setHexInput(selected ?? '') }, [selected])

  const commitHex = () => { if (isValidHexColor(hexInput)) onSelect(hexInput.trim()) }

  return (
    <div
      className="p-2 bf-kanban-popover rounded-xl w-[176px]"
      style={{ position: 'fixed', zIndex: 9999, ...style }}
      onClick={e => e.stopPropagation()}
    >
      <div className="grid grid-cols-4 gap-1.5">
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
      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/10">
        <input
          type="color"
          value={isValidHexColor(hexInput) ? hexInput : '#8b5cf6'}
          // The native picker fires onChange continuously as the user drags
          // around it (every intermediate color, not just the final pick) —
          // only track it locally here. Committing on every change would
          // close this popover the instant they touched the picker.
          onChange={e => setHexInput(e.target.value)}
          onBlur={commitHex}
          title="Pick a custom color"
          className="bf-color-ball shrink-0"
        />
        <input
          type="text"
          value={hexInput}
          onChange={e => setHexInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitHex() }}
          onBlur={commitHex}
          placeholder="#RRGGBB"
          spellCheck={false}
          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 focus:border-violet-500 rounded px-1.5 py-1 text-[11px] font-mono outline-none transition"
        />
      </div>
    </div>
  )
}

// ─── BoardSettingsModal ────────────────────────────────────────────────────────
const BoardSettingsModal: React.FC<{
  priorities: PriorityDef[]
  tagColors: Record<string, string>
  allBoardTags: string[]
  columns?: string[]
  completedColumns?: string[]
  onClose: () => void
  onSavePriority: (idx: number, name: string, color: string) => Promise<void>
  onDeletePriority: (idx: number) => Promise<void>
  onAddPriority: (name: string, color: string) => Promise<void>
  onSetTagColor: (tag: string, color: string) => Promise<void>
  onToggleCompleted?: (col: string) => void
}> = ({ priorities, tagColors, allBoardTags, columns, completedColumns = [], onClose, onSavePriority, onDeletePriority, onAddPriority, onSetTagColor, onToggleCompleted }) => {
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

          {/* Column Status */}
          {columns && columns.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold bf-kanban-section-label uppercase tracking-widest mb-3">Column Status</h3>
              <p className="text-[11px] bf-kanban-hint mb-3">Mark columns as "Completed" — cards in those columns will appear dimmed with strikethrough.</p>
              <div className="flex flex-col gap-1.5">
                {columns.map(col => {
                  const isDone = completedColumns.some(c => c.toLowerCase() === col.toLowerCase())
                  return (
                    <label key={col} className="flex items-center gap-2.5 cursor-pointer group">
                      <div
                        onClick={() => onToggleCompleted?.(col)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition cursor-pointer flex-shrink-0 ${isDone ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600 hover:border-zinc-400'}`}
                      >
                        {isDone && <Check size={10} className="text-white" />}
                      </div>
                      <span className={`text-[12px] transition ${isDone ? 'line-through opacity-60' : 'group-hover:opacity-90'}`}>{col}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

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

// ─── KanbanFilterBar ──────────────────────────────────────────────────────────
const KanbanFilterBar: React.FC<{
  allTags: string[]
  allAssignees: string[]
  hasDueDates: boolean
  priorities: PriorityDef[]
  tagColors: Record<string, string>
  filterTags: string[]
  filterPriorities: string[]
  filterAssignees: string[]
  filterDueDate: string
  filterMode: 'hide' | 'highlight'
  searchText: string
  onTagToggle: (tag: string) => void
  onPriorityToggle: (name: string) => void
  onAssigneeToggle: (name: string) => void
  onDueDateChange: (date: string) => void
  onModeChange: (mode: 'hide' | 'highlight') => void
  onSearchChange: (v: string) => void
  onClear: () => void
}> = ({ allTags, allAssignees, hasDueDates, priorities, tagColors, filterTags, filterPriorities, filterAssignees, filterDueDate, filterMode, searchText, onTagToggle, onPriorityToggle, onAssigneeToggle, onDueDateChange, onModeChange, onSearchChange, onClear }) => {
  const [tagDropOpen, setTagDropOpen] = useState(false)
  const [assigneeDropOpen, setAssigneeDropOpen] = useState(false)
  const tagDropRef = useRef<HTMLDivElement>(null)
  const assigneeDropRef = useRef<HTMLDivElement>(null)
  const dueDateRef = useRef<HTMLInputElement>(null)
  const isActive = filterTags.length > 0 || filterPriorities.length > 0 || filterAssignees.length > 0 || filterDueDate !== '' || searchText.length > 0

  useEffect(() => {
    if (!tagDropOpen) return
    const handler = (e: MouseEvent) => {
      if (tagDropRef.current && !tagDropRef.current.contains(e.target as Node))
        setTagDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [tagDropOpen])

  useEffect(() => {
    if (!assigneeDropOpen) return
    const handler = (e: MouseEvent) => {
      if (assigneeDropRef.current && !assigneeDropRef.current.contains(e.target as Node))
        setAssigneeDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [assigneeDropOpen])

  return (
    <div className="flex items-center gap-2 flex-wrap mb-4 bf-kanban-filter-bar px-3 py-2 rounded-xl">

      {/* Mode segmented control */}
      <div className="flex items-center gap-0.5 p-0.5 bf-kanban-filter-mode-track rounded-lg shrink-0">
        {(['hide', 'highlight'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            className={`px-2.5 py-1 text-[10px] font-semibold rounded-md transition-all duration-150 cursor-pointer ${
              filterMode === mode ? 'bf-kanban-filter-mode-on' : 'bf-kanban-filter-mode-off'
            }`}
          >
            {mode === 'hide' ? '⊘ Hide' : '◎ Focus'}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bf-kanban-filter-sep shrink-0" />

      {/* Priority pills */}
      {priorities.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] bf-kanban-section-label font-semibold uppercase tracking-wider shrink-0 select-none">
            Priority
          </span>
          {priorities.map(p => {
            const on = filterPriorities.includes(p.name)
            return (
              <button
                key={p.name}
                onClick={() => onPriorityToggle(p.name)}
                className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md tracking-wider border transition-all duration-150 cursor-pointer"
                style={
                  on
                    ? { background: p.color + '28', borderColor: p.color + '80', color: p.color }
                    : { background: 'transparent', borderColor: p.color + '30', color: p.color + 'aa' }
                }
              >
                {p.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Tags dropdown */}
      {allTags.length > 0 && (
        <div className="relative shrink-0" ref={tagDropRef}>
          <button
            onClick={() => setTagDropOpen(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-all duration-150 cursor-pointer ${
              filterTags.length > 0 ? 'bf-kanban-filter-tag-active' : 'bf-kanban-btn'
            }`}
          >
            <Tag size={10} />
            Tags
            {filterTags.length > 0 && (
              <span className="px-1 bf-kanban-filter-tag-badge rounded text-[9px] font-bold leading-4">
                {filterTags.length}
              </span>
            )}
            <ChevronDown
              size={9}
              className="transition-transform duration-150"
              style={{ transform: tagDropOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </button>

          {tagDropOpen && (
            <div className="absolute top-full left-0 mt-1.5 bf-kanban-popover rounded-xl py-1.5 z-50 min-w-[170px] max-h-52 overflow-y-auto no-scrollbar">
              {allTags.map(tag => {
                const tc = tagColors[tag] || '#8b5cf6'
                const checked = filterTags.includes(tag)
                return (
                  <button
                    key={tag}
                    onClick={() => onTagToggle(tag)}
                    className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left cursor-pointer bf-kanban-popover-item transition-colors duration-100"
                  >
                    <span
                      className="w-3.5 h-3.5 rounded shrink-0 border flex items-center justify-center transition-all duration-150"
                      style={checked
                        ? { background: tc, borderColor: tc }
                        : { background: 'transparent', borderColor: 'var(--border-2)' }
                      }
                    >
                      {checked && <Check size={8} color="white" strokeWidth={3} />}
                    </span>
                    <span
                      className="px-1.5 py-0.5 text-[10px] rounded-md border font-medium"
                      style={{ background: tc + '18', borderColor: tc + '44', color: tc }}
                    >
                      {tag}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Assignees dropdown */}
      {allAssignees.length > 0 && (
        <div className="relative shrink-0" ref={assigneeDropRef}>
          <button
            onClick={() => setAssigneeDropOpen(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-all duration-150 cursor-pointer ${
              filterAssignees.length > 0 ? 'bf-kanban-filter-tag-active' : 'bf-kanban-btn'
            }`}
          >
            <User size={10} />
            Assignee
            {filterAssignees.length > 0 && (
              <span className="px-1 bf-kanban-filter-tag-badge rounded text-[9px] font-bold leading-4">
                {filterAssignees.length}
              </span>
            )}
            <ChevronDown
              size={9}
              className="transition-transform duration-150"
              style={{ transform: assigneeDropOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            />
          </button>

          {assigneeDropOpen && (
            <div className="absolute top-full left-0 mt-1.5 bf-kanban-popover rounded-xl py-1.5 z-50 min-w-[180px] max-h-52 overflow-y-auto no-scrollbar">
              {allAssignees.map(name => {
                const checked = filterAssignees.includes(name)
                return (
                  <button
                    key={name}
                    onClick={() => onAssigneeToggle(name)}
                    className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left cursor-pointer bf-kanban-popover-item transition-colors duration-100"
                  >
                    <span
                      className="w-3.5 h-3.5 rounded shrink-0 border flex items-center justify-center transition-all duration-150"
                      style={checked
                        ? { background: 'var(--accent)', borderColor: 'var(--accent)' }
                        : { background: 'transparent', borderColor: 'var(--border-2)' }
                      }
                    >
                      {checked && <Check size={8} color="white" strokeWidth={3} />}
                    </span>
                    <span className="text-[11px] bf-kanban-card-meta truncate">{name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Due date filter — only shown when board has cards with due dates */}
      {hasDueDates && (
        <div
          onClick={() => dueDateRef.current?.showPicker()}
          className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-150 shrink-0 cursor-pointer ${filterDueDate ? 'bf-kanban-filter-tag-active' : 'bf-kanban-btn'}`}
        >
          <Calendar size={10} className="shrink-0 opacity-70 pointer-events-none" />
          <span className="text-[10px] font-semibold select-none pointer-events-none">
            {filterDueDate || 'Due by'}
          </span>
          <input
            ref={dueDateRef}
            type="date"
            value={filterDueDate}
            onChange={e => onDueDateChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full pointer-events-none"
            style={{ colorScheme: 'dark' }}
            tabIndex={-1}
          />
          {filterDueDate && (
            <button
              onClick={e => { e.stopPropagation(); onDueDateChange('') }}
              className="shrink-0 opacity-60 hover:opacity-100 transition cursor-pointer relative z-10"
            >
              <X size={9} />
            </button>
          )}
        </div>
      )}

      {/* Search input */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-150 ${searchText ? 'bf-kanban-filter-tag-active' : 'bf-kanban-btn'}`}>
        <Search size={10} className="shrink-0 opacity-60" />
        <input
          type="text"
          value={searchText}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search cards…"
          className="bg-transparent outline-none text-[11px] w-28 min-w-0 placeholder:opacity-40"
        />
        {searchText && (
          <button onClick={() => onSearchChange('')} className="shrink-0 opacity-60 hover:opacity-100 transition cursor-pointer">
            <X size={9} />
          </button>
        )}
      </div>

      {/* Clear filters */}
      {isActive && (
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-all duration-150 cursor-pointer bf-kanban-filter-clear"
        >
          <X size={9} />
          Clear
        </button>
      )}
    </div>
  )
}

// ─── CardContextMenu ──────────────────────────────────────────────────────────
const CardContextMenu: React.FC<{
  x: number; y: number
  task: FileRecord
  currentCol: string
  columns: string[]
  priorities: PriorityDef[]
  onClose: () => void
  onOpen: () => void
  onMove: (col: string) => Promise<void>
  onSetPriority: (name: string) => void
  onSetDueDate: (date: string) => void
  onDelete?: () => void
  otherBoards?: { path: string; title: string; columns: string[] }[]
  onMoveToBoard?: (boardPath: string, column: string) => void
}> = ({ x, y, task, currentCol, columns, priorities, onClose, onOpen, onMove, onSetPriority, onSetDueDate, onDelete, otherBoards = [], onMoveToBoard }) => {
  const [sub, setSub] = useState<'move' | 'priority' | 'date' | 'moveBoard' | null>(null)
  const [moveBoardTarget, setMoveBoardTarget] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(x, window.innerWidth  - r.width  - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    })
  }, [x, y, sub, moveBoardTarget])

  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const key  = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])

  const currentPriority = task.frontMatter?.priority
  const currentDue      = task.frontMatter?.dueDate?.split('T')[0] ?? ''

  const Row: React.FC<{
    icon: React.ReactNode; label: string; onClick: () => void
    danger?: boolean; active?: boolean; expand?: boolean
  }> = ({ icon, label, onClick, danger, active, expand }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2 text-left text-[12px] transition cursor-pointer bf-kanban-popover-item rounded-md mx-1 ${danger ? 'hover:text-red-400' : ''} ${active ? 'bg-white/5' : ''}`}
      style={{ width: 'calc(100% - 8px)' }}
    >
      <span className="shrink-0 opacity-60">{icon}</span>
      <span className="flex-1 bf-kanban-modal-text">{label}</span>
      {expand && <ChevronDown size={10} className={`opacity-40 transition-transform ${active ? 'rotate-180' : ''}`} />}
    </button>
  )

  const Divider = () => <div className="my-1 mx-3 border-t border-[var(--border-0)]" />

  return (
    <div
      ref={ref}
      className="fixed z-[9999] bf-kanban-popover rounded-xl overflow-hidden shadow-2xl"
      style={{ top: pos.y, left: pos.x, minWidth: 210 }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-1)]">
        <span className="text-[10px] font-bold bf-kanban-section-label uppercase tracking-widest">Card Actions</span>
        <button onClick={onClose} className="bf-kanban-icon-btn p-0.5 rounded cursor-pointer"><X size={12} /></button>
      </div>

      <div className="py-1.5">
        <Row icon={<Edit3 size={13} />} label="Open card" onClick={() => { onOpen(); onClose() }} />

        <Divider />

        {/* Move to column */}
        <Row icon={<ArrowRight size={13} />} label="Move to column" active={sub === 'move'} expand onClick={() => setSub(sub === 'move' ? null : 'move')} />
        {sub === 'move' && (
          <div className="mx-2 mb-1 flex flex-col gap-0.5">
            {columns.filter(c => c.toLowerCase() !== currentCol.toLowerCase()).map(col => (
              <button
                key={col}
                onClick={() => { onMove(col); onClose() }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-[11px] rounded-lg bf-kanban-popover-item transition cursor-pointer bf-kanban-modal-text"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0" />{col}
              </button>
            ))}
          </div>
        )}

        {/* Move to another board */}
        {onMoveToBoard && otherBoards.length > 0 && (
          <>
            <Row
              icon={<Layers size={13} />}
              label="Move to another board"
              active={sub === 'moveBoard'}
              expand
              onClick={() => { setSub(sub === 'moveBoard' ? null : 'moveBoard'); setMoveBoardTarget(null) }}
            />
            {sub === 'moveBoard' && (
              <div className="mx-2 mb-1 flex flex-col gap-0.5">
                {otherBoards.map(board => (
                  <div key={board.path}>
                    <button
                      onClick={() => setMoveBoardTarget(moveBoardTarget === board.path ? null : board.path)}
                      className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-[11px] rounded-lg bf-kanban-popover-item transition cursor-pointer bf-kanban-modal-text"
                    >
                      <span className="flex-1 truncate">{board.title}</span>
                      <ChevronDown size={10} className={`opacity-40 shrink-0 transition-transform ${moveBoardTarget === board.path ? 'rotate-180' : ''}`} />
                    </button>
                    {moveBoardTarget === board.path && (
                      <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--border-0)] pl-2">
                        {board.columns.length === 0 ? (
                          <span className="px-2.5 py-1.5 text-[10px] opacity-50">No columns on this board</span>
                        ) : board.columns.map(col => (
                          <button
                            key={col}
                            onClick={() => { onMoveToBoard(board.path, col); onClose() }}
                            className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-[11px] rounded-lg bf-kanban-popover-item transition cursor-pointer bf-kanban-modal-text"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 shrink-0" />{col}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Set priority */}
        <Row icon={<Tag size={13} />} label="Set priority" active={sub === 'priority'} expand onClick={() => setSub(sub === 'priority' ? null : 'priority')} />
        {sub === 'priority' && (
          <div className="mx-2 mb-1 flex flex-col gap-0.5">
            {priorities.map(p => (
              <button
                key={p.name}
                onClick={() => { onSetPriority(p.name); onClose() }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-[11px] rounded-lg bf-kanban-popover-item transition cursor-pointer"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="bf-kanban-modal-text flex-1">{p.name}</span>
                {currentPriority?.toLowerCase() === p.name.toLowerCase() && <Check size={10} className="text-emerald-400" />}
              </button>
            ))}
          </div>
        )}

        {/* Due date */}
        <Row icon={<Calendar size={13} />} label="Edit due date" active={sub === 'date'} expand onClick={() => setSub(sub === 'date' ? null : 'date')} />
        {sub === 'date' && (
          <div className="mx-3 mb-2">
            <input
              type="date"
              defaultValue={currentDue}
              className="bf-kanban-input rounded-lg px-2 py-1.5 text-xs w-full outline-none"
              onChange={e => { if (e.target.value) { onSetDueDate(e.target.value); onClose() } }}
            />
          </div>
        )}

        <Divider />

        <Row
          icon={copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          label={copied ? 'Copied!' : 'Copy title'}
          onClick={() => {
            navigator.clipboard.writeText(task.title)
            setCopied(true)
            setTimeout(() => { setCopied(false); onClose() }, 800)
          }}
        />

        {onDelete && (
          <>
            <Divider />
            <Row
              icon={<Trash2 size={13} />}
              label="Delete card"
              danger
              onClick={() => { onDelete(); onClose() }}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ─── CardDetailPanel ──────────────────────────────────────────────────────────
type CardViewMode = 'modal' | 'sidebar' | 'fullscreen'

const CardDetailPanel: React.FC<{
  task: FileRecord
  viewMode: CardViewMode
  columns: string[]
  allBoardTags: string[]
  tagColors?: Record<string, string>
  onEnsureTagColor?: (tag: string) => void
  files: FileRecord[]
  onClose: () => void
  onSetMode: (mode: CardViewMode) => void
  onUpdateFrontMatter: (updates: Record<string, any>) => Promise<void>
  onDelete?: () => void
  onCardSaved?: () => void
  initialPropertiesCollapsed?: boolean
  closing?: boolean
  isMobile?: boolean
  autosaveDelay?: number
}> = ({ task, viewMode, columns, allBoardTags, tagColors, onEnsureTagColor, files, onClose, onSetMode, onUpdateFrontMatter, onDelete, onCardSaved, initialPropertiesCollapsed, closing, isMobile, autosaveDelay }) => {
  // Modal (80vw/80vh) and Sidebar (fixed 560px) modes don't fit a phone screen —
  // mobile always gets the fullscreen layout regardless of the saved preference.
  const effectiveViewMode: CardViewMode = isMobile ? 'fullscreen' : viewMode
  const [body, setBody]           = useState<string | null>(null)
  const [fmStr, setFmStr]         = useState('')
  const [isSaving, setIsSaving]   = useState(false)
  const [loadErr, setLoadErr]     = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(560)
  const [mounted, setMounted]     = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const prevPathRef = useRef(task.path)
  const taskPathRef = useRef(task.path)
  const [historyIntervalMin, setHistoryIntervalMin] = useState(0)

  const checkpointCardPath = (path: string) => {
    fetch(`${API_BASE}/api/file/history/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch(() => {})
  }

  // Fetch saved sidebar width + periodic auto-version interval on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/settings`)
      .then(r => r.json())
      .then(d => {
        if (typeof d?.kanban_panel_width === 'number' && d.kanban_panel_width >= 320) setSidebarWidth(d.kanban_panel_width)
        if (typeof d?.history_interval === 'number' && d.history_interval >= 0) setHistoryIntervalMin(d.history_interval)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Keep ref in sync so timers/listeners always checkpoint the currently open card
  useEffect(() => { taskPathRef.current = task.path }, [task.path])

  // Card-switch fade: when task changes while panel is already open
  useEffect(() => {
    if (prevPathRef.current !== task.path) {
      checkpointCardPath(prevPathRef.current)
      setContentVisible(false)
      prevPathRef.current = task.path
    }
  }, [task.path])

  // Checkpoint the card being viewed when the panel itself is closed/unmounted
  useEffect(() => {
    return () => { checkpointCardPath(taskPathRef.current) }
  }, [])

  // Periodic version checkpoint while the card panel is open (0 = disabled)
  useEffect(() => {
    if (!historyIntervalMin || historyIntervalMin <= 0) return
    const id = setInterval(() => checkpointCardPath(taskPathRef.current), historyIntervalMin * 60 * 1000)
    return () => clearInterval(id)
  }, [historyIntervalMin])

  // Checkpoint the open card when the tab is closed or backgrounded (mirrors
  // App.tsx's document-level beforeunload/visibilitychange checkpoints — the
  // outer selectedPath there never reflects a card opened from inside a board).
  useEffect(() => {
    const beacon = () => {
      navigator.sendBeacon(
        `${API_BASE}/api/file/history/checkpoint`,
        new Blob([JSON.stringify({ path: taskPathRef.current })], { type: 'application/json' })
      )
    }
    const visHandler = () => { if (document.visibilityState === 'hidden') beacon() }
    window.addEventListener('beforeunload', beacon)
    document.addEventListener('visibilitychange', visHandler)
    return () => {
      window.removeEventListener('beforeunload', beacon)
      document.removeEventListener('visibilitychange', visHandler)
    }
  }, [])

  useEffect(() => {
    setBody(null); setLoadErr(false)
    const t0 = Date.now()
    fetch(`${API_BASE}/api/file?path=${encodeURIComponent(task.path)}`)
      .then(r => { if (!r.ok) throw new Error('not ok'); return r.json() })
      .then(data => {
        const { fmStr: fm, body: b } = splitFrontMatter(data.content || '')
        setFmStr(fm); setBody(b)
        // Ensure the fade-out has at least 180ms to play before fading back in
        const delay = Math.max(0, 180 - (Date.now() - t0))
        setTimeout(() => setContentVisible(true), delay)
      })
      .catch(() => { setLoadErr(true); setContentVisible(true) })
  }, [task.path])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSave = async (content: string) => {
    const path = task.path
    setIsSaving(true)
    try {
      const full = fmStr ? `---\n${fmStr}\n---\n\n${content}` : content
      await fetch(`${API_BASE}/api/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content: full }),
      })
      // Only apply the saved content to this panel's shared body state if the
      // user is still on this same card — a save flushed on switching cards
      // (or any save that simply resolves late) must not overwrite whatever
      // card is open now with this one's content.
      if (taskPathRef.current === path) {
        setBody(content)
      }
      onCardSaved?.()
    } catch (e) {
      console.error('Error saving card', e)
    } finally {
      setIsSaving(false)
    }
  }

  // `onUpdateFrontMatter` (cover/attachment uploads, the Properties panel)
  // PATCHes the frontmatter straight to disk, but `fmStr` above is only ever
  // captured once when the card is opened. Without this, the very next body
  // autosave reconstructs the file from that stale snapshot and silently
  // wipes out whatever the PATCH just wrote (cover, attachments, tags,
  // status, ...) — this was the cause of the cover/attachment data-loss bug.
  const syncedUpdateFrontMatter = async (updates: Record<string, any>) => {
    await onUpdateFrontMatter(updates)
    try {
      const res = await fetch(`${API_BASE}/api/file?path=${encodeURIComponent(task.path)}`)
      if (res.ok) {
        const data = await res.json()
        setFmStr(splitFrontMatter(data.content || '').fmStr)
      }
    } catch (e) {
      console.error('Failed to refresh front matter after update', e)
    }
  }

  // Drag-to-resize sidebar handle
  const handleResizeDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    let finalWidth = startW
    const onMove = (ev: MouseEvent) => {
      finalWidth = Math.max(320, Math.min(window.innerWidth * 0.85, startW + (startX - ev.clientX)))
      setSidebarWidth(finalWidth)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kanban_panel_width: Math.round(finalWidth) }),
      }).catch(() => {})
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const toolbar = (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-1)] shrink-0 bf-kanban-col-header">
      {isMobile ? <div /> : (
        <div className="flex items-center gap-0.5 p-0.5 bf-kanban-filter-mode-track rounded-lg">
          {(['modal', 'sidebar', 'fullscreen'] as const).map(m => (
            <button
              key={m}
              onClick={() => onSetMode(m)}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded-md transition cursor-pointer ${viewMode === m ? 'bf-kanban-filter-mode-on' : 'bf-kanban-filter-mode-off'}`}
            >
              {m === 'modal' ? 'Modal' : m === 'sidebar' ? 'Sidebar' : 'Fullscreen'}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        {onDelete && (
          <button onClick={onDelete} title="Delete card" className="p-1.5 bf-kanban-icon-btn bf-kanban-icon-btn--danger rounded-lg transition cursor-pointer">
            <Trash2 size={13} />
          </button>
        )}
        <button onClick={onClose} title="Close (Esc)" className="p-1.5 bf-kanban-icon-btn rounded-lg transition cursor-pointer">
          <X size={14} />
        </button>
      </div>
    </div>
  )

  const editorArea = body === null && !loadErr ? (
    <div className="flex-1 flex items-center justify-center bf-kanban-hint text-sm">Loading…</div>
  ) : loadErr ? (
    <div className="flex-1 flex items-center justify-center text-red-400 text-sm">Failed to load card content.</div>
  ) : (
    <div className={`flex-1 overflow-hidden transition-opacity duration-200 ease-in-out ${contentVisible ? 'opacity-100' : 'opacity-0'}`}>
      <Editor
        key={task.path}
        filePath={task.path}
        initialContent={body!}
        onSave={handleSave}
        isSaving={isSaving}
        frontMatter={task.frontMatter}
        onUpdateFrontMatter={syncedUpdateFrontMatter}
        onTitleChange={(newTitle) => syncedUpdateFrontMatter({ title: newTitle })}
        boardColumns={columns}
        boardTags={allBoardTags}
        tagColors={tagColors}
        onEnsureTagColor={onEnsureTagColor}
        files={files}
        onSelectFile={() => {}}
        initialPropertiesCollapsed={initialPropertiesCollapsed}
        autosaveDelay={autosaveDelay}
      />
    </div>
  )

  const active = mounted && !closing

  // Fullscreen: fills the entire kanban area (app sidebar remains visible)
  if (effectiveViewMode === 'fullscreen') {
    return (
      <div
        data-card-detail-panel="true"
        className="fixed inset-0 z-[200] flex flex-col bf-kanban-modal overflow-hidden transition-opacity duration-200 ease-out"
        style={{ opacity: active ? 1 : 0 }}
      >
        {toolbar}
        {editorArea}
      </div>
    )
  }

  // Sidebar: fixed right panel, no backdrop, draggable left edge
  if (effectiveViewMode === 'sidebar') {
    return (
      <div
        data-card-detail-panel="true"
        className="fixed top-0 right-0 bottom-0 z-[200] flex flex-col bf-kanban-modal shadow-2xl border-l border-[var(--border-1)] transition-transform duration-300 ease-out"
        style={{ width: sidebarWidth, transform: active ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Drag handle */}
        <div
          onMouseDown={handleResizeDrag}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-violet-500/30 transition-colors"
          title="Drag to resize"
        />
        {toolbar}
        {editorArea}
      </div>
    )
  }

  // Modal: centered, 80% screen, no backdrop — outer wrapper passes clicks through
  return (
    <div className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center">
      <div
        data-card-detail-panel="true"
        className="pointer-events-auto bf-kanban-modal rounded-2xl flex flex-col overflow-hidden shadow-2xl border border-[var(--border-1)] transition-all duration-250 ease-out"
        style={{
          width: '80vw', height: '80vh',
          opacity: active ? 1 : 0,
          transform: active ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(12px)',
        }}
      >
        {toolbar}
        {editorArea}
      </div>
    </div>
  )
}

// ─── Main Kanban ───────────────────────────────────────────────────────────────
const Kanban: React.FC<KanbanProps> = ({
  files,
  onMoveCard,
  onMoveCardToBoard,
  onDeleteCard,
  onCreateTaskInColumn,
  boardPath,
  boardColumns,
  onUpdateColumns,
  boardFrontMatter,
  onUpdateBoardFrontMatter,
  onUpdateTaskFrontMatter,
  onReorderCards,
  onRenameBoard,
  onCardSaved,
  initialCardViewMode,
  onSaveCardViewMode,
  initialPropertiesCollapsed,
  isMobile,
  autosaveDelay,
  activeWorkspace,
  tagColors: globalTagColors,
  onEnsureTagColor,
  onSetGlobalTagColor,
}) => {
  const [newCardTitles, setNewCardTitles] = useState<Record<string, string>>({})
  const [editingColumn, setEditingColumn] = useState<string | null>(null)
  const [editColVal, setEditColVal]       = useState('')

  const [settingsOpen, setSettingsOpen]   = useState(false)

  // ── Filter state ───────────────────────────────────────────────────────────
  const [filterTags, setFilterTags]             = useState<string[]>([])
  const [filterPriorities, setFilterPriorities] = useState<string[]>([])
  const [filterAssignees, setFilterAssignees]   = useState<string[]>([])
  const [filterDueDate, setFilterDueDate]       = useState('')
  const [filterMode, setFilterMode]             = useState<'hide' | 'highlight'>('highlight')
  const [searchText, setSearchText]             = useState('')
  const [collapsedCols, setCollapsedCols]       = useState<Set<string>>(new Set())
  // Guards the one-time collapsedCols restore below against firing before
  // `files` (and thus boardFrontMatter) has actually loaded — see that effect.
  const restoredCollapseForBoardRef = useRef<string | null>(null)
  const [expandedChecklists, setExpandedChecklists] = useState<Set<string>>(new Set())

  // ── Edge auto-scroll while dragging a card ─────────────────────────────────
  // @hello-pangea/dnd only auto-scrolls a Droppable's own scroll container
  // (each column's vertical card list here) — the horizontal board container
  // that switches between columns isn't itself a Droppable, so dragging a card
  // to the left/right edge of the screen would otherwise get stuck on one
  // column. This drives that container's scrollLeft manually based on how
  // close the touch/mouse point is to either edge while a drag is active.
  const boardScrollRef = useRef<HTMLDivElement>(null)
  const isDraggingCardRef = useRef(false)
  const edgeScrollSpeedRef = useRef(0)
  const edgeScrollRafRef = useRef<number | null>(null)
  const EDGE_SCROLL_ZONE = 70
  const EDGE_SCROLL_MAX_SPEED = 16

  const stepEdgeScroll = () => {
    const el = boardScrollRef.current
    if (el && edgeScrollSpeedRef.current !== 0) {
      el.scrollLeft += edgeScrollSpeedRef.current
      edgeScrollRafRef.current = requestAnimationFrame(stepEdgeScroll)
    } else {
      edgeScrollRafRef.current = null
    }
  }

  const updateEdgeScrollSpeed = (clientX: number) => {
    const el = boardScrollRef.current
    if (!el || !isDraggingCardRef.current) { edgeScrollSpeedRef.current = 0; return }
    const rect = el.getBoundingClientRect()
    const distFromLeft = clientX - rect.left
    const distFromRight = rect.right - clientX
    let speed = 0
    if (distFromLeft >= 0 && distFromLeft < EDGE_SCROLL_ZONE) {
      speed = -EDGE_SCROLL_MAX_SPEED * (1 - distFromLeft / EDGE_SCROLL_ZONE)
    } else if (distFromRight >= 0 && distFromRight < EDGE_SCROLL_ZONE) {
      speed = EDGE_SCROLL_MAX_SPEED * (1 - distFromRight / EDGE_SCROLL_ZONE)
    }
    edgeScrollSpeedRef.current = speed
    if (speed !== 0 && edgeScrollRafRef.current === null) {
      edgeScrollRafRef.current = requestAnimationFrame(stepEdgeScroll)
    }
  }

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (isDraggingCardRef.current && e.touches[0]) updateEdgeScrollSpeed(e.touches[0].clientX)
    }
    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingCardRef.current) updateEdgeScrollSpeed(e.clientX)
    }
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [])

  const stopEdgeScroll = () => {
    isDraggingCardRef.current = false
    edgeScrollSpeedRef.current = 0
  }

  // Card context menu
  const [cardCtxMenu, setCardCtxMenu] = useState<{ x: number; y: number; task: FileRecord; col: string } | null>(null)

  // Priority picker: which card + where to position
  const [priorityPicker, setPriorityPicker] = useState<{ path: string; x: number; y: number } | null>(null)
  // Column color picker
  const [colColorPicker, setColColorPicker] = useState<{ col: string; x: number; y: number } | null>(null)
  // Tag inline editor
  const [tagEditorCard, setTagEditorCard] = useState<string | null>(null)
  const [tagInput, setTagInput]           = useState('')

  // Card detail panel
  const [openCardPath, setOpenCardPath]   = useState<string | null>(null)
  const [closingCard, setClosingCard]     = useState(false)
  const [cardViewMode, setCardViewMode]   = useState<CardViewMode>(initialCardViewMode ?? 'modal')

  // Opening/switching/closing a card pushes/pops real browser history entries
  // scoped to this board, so the back button steps out one card at a time
  // instead of jumping straight past the board to whatever page was open
  // before it (the card panel used to be pure local state, invisible to
  // history — a single Back press would skip over it entirely).
  const openCard = (path: string) => {
    setOpenCardPath(path)
    window.history.pushState({ filePath: boardPath, kanbanCardPath: path }, '', window.location.hash)
  }

  // NOTE: this is used directly as an onClick/onClose handler in several
  // places, so it must not take a meaningful parameter — React would pass
  // the SyntheticEvent as the first argument, silently breaking any
  // boolean flag here (a truthy event object, not `true`/`false`).
  const closeCardPanel = () => {
    setClosingCard(true)
    setTimeout(() => { setOpenCardPath(null); setClosingCard(false) }, 280)
    if (window.history.state?.kanbanCardPath) {
      window.history.back()
    }
  }

  // Keep the open card in sync with browser back/forward navigation within this board
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (e.state?.filePath !== boardPath) return  // navigating away from this board entirely
      const cardPath = e.state?.kanbanCardPath as string | undefined
      if (cardPath && cardPath !== openCardPath) {
        setClosingCard(false)
        setOpenCardPath(cardPath)
      } else if (!cardPath && openCardPath) {
        // Mirrors closeCardPanel's close animation, but skips the
        // history.back() call — we're already responding to one.
        setClosingCard(true)
        setTimeout(() => { setOpenCardPath(null); setClosingCard(false) }, 280)
      }
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [openCardPath, boardPath])

  const handleCardViewMode = (mode: CardViewMode) => {
    setCardViewMode(mode)
    onSaveCardViewMode?.(mode)
  }

  // Parse board-level config
  const columnColors = useMemo(
    () => parseJSON<Record<string, string>>(boardFrontMatter?.columnColors, {}),
    [boardFrontMatter?.columnColors],
  )
  const priorities = useMemo(() => {
    const p = parseJSON<PriorityDef[] | null>(boardFrontMatter?.priorities, null)
    return Array.isArray(p) && p.length > 0 ? p : DEFAULT_PRIORITIES
  }, [boardFrontMatter?.priorities])

  // Tag colors are global across the workspace (assigned randomly on first
  // use and shared by every board/document) rather than stored per-board.
  const tagColors = globalTagColors ?? {}

  const DONE_NAMES = ['done', 'complete', 'completed', 'finished', 'archive', 'archived', 'closed']
  const completedColumns = useMemo(() => {
    const stored = parseJSON<string[] | null>(boardFrontMatter?.completedColumns, null)
    if (Array.isArray(stored)) return stored
    // auto-detect on first load
    return boardColumns.filter(c => DONE_NAMES.includes(c.toLowerCase()))
  }, [boardFrontMatter?.completedColumns, boardColumns])

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

  // ── "More cards below" scroll hint per column ───────────────────────────────
  // Shows a subtle fade + down-arrow at the bottom of a column's card list
  // whenever it's scrolled somewhere short of its end, so a long column
  // doesn't look complete when there are actually more cards to scroll to.
  const [columnsWithOverflow, setColumnsWithOverflow] = useState<Set<string>>(new Set())
  const columnScrollRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const checkColumnOverflow = (col: string) => {
    const el = columnScrollRefs.current.get(col)
    if (!el) return
    const hasMore = el.scrollHeight - el.scrollTop - el.clientHeight > 8
    setColumnsWithOverflow(prev => {
      const has = prev.has(col)
      if (hasMore === has) return prev
      const next = new Set(prev)
      hasMore ? next.add(col) : next.delete(col)
      return next
    })
  }
  useEffect(() => {
    boardColumns.forEach(checkColumnOverflow)
  }, [tasks, boardColumns])
  useEffect(() => {
    const handler = () => boardColumns.forEach(checkColumnOverflow)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [boardColumns])

  // Tags used anywhere in the workspace — not just this board's own cards —
  // so a tag added on a document or another board is immediately suggested
  // here too, and a tag added on this board is suggested everywhere else.
  const allBoardTags = useMemo(() => {
    const prefix = activeWorkspace ? activeWorkspace + '/' : ''
    const s = new Set<string>()
    files.forEach(f => {
      if (prefix && !f.path.startsWith(prefix)) return
      parseTags(f.frontMatter?.tags).forEach(tag => s.add(tag))
    })
    return Array.from(s).sort()
  }, [files, activeWorkspace])

  // Other Kanban boards in this workspace — used by the card context menu's
  // "Move to another board" submenu. Excludes the board currently open.
  const otherBoards = useMemo(() => {
    const prefix = activeWorkspace ? activeWorkspace + '/' : ''
    return files
      .filter(f => f.type === 'board' && f.path !== boardPath && (!prefix || f.path.startsWith(prefix)))
      .map(f => {
        let columns: string[] = []
        try { columns = JSON.parse(f.frontMatter?.columns || '[]') } catch { /* */ }
        return { path: f.path, title: f.title, columns }
      })
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [files, activeWorkspace, boardPath])

  const allBoardAssignees = useMemo(() => {
    const s = new Set<string>()
    tasks.forEach(t => { if (t.frontMatter?.assignee) s.add(t.frontMatter.assignee) })
    return Array.from(s).sort()
  }, [tasks])

  const boardHasDueDates = useMemo(() =>
    tasks.some(t => !!t.frontMatter?.dueDate), [tasks])

  const getTasksByColumn = (col: string) =>
    tasks
      .filter(t => (t.frontMatter?.status || '').toLowerCase() === col.toLowerCase())
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  const getColumnColor = (col: string) =>
    columnColors[col] || NAMED_COL_COLORS[col.trim().toLowerCase()] || DEFAULT_COL_COLORS[hashColumnName(col) % DEFAULT_COL_COLORS.length]

  const getPriorityDef = (name?: string) =>
    priorities.find(p => p.name.toLowerCase() === (name || '').toLowerCase())

  // ── Drag (mouse, touch, and keyboard — all handled by @hello-pangea/dnd) ──
  const handleDragStart = () => { isDraggingCardRef.current = true }

  const handleDragEnd = (result: DropResult) => {
    stopEdgeScroll()
    const { source, destination, draggableId } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const movingTask = tasks.find(t => t.path === draggableId)
    if (!movingTask) return

    const destCol = destination.droppableId
    const sourceCol = source.droppableId
    const destItems = getTasksByColumn(destCol).filter(t => t.path !== draggableId)
    destItems.splice(destination.index, 0, movingTask)
    const updates = destItems.map((t, idx) => ({ path: t.path, position: idx + 1 }))

    if (sourceCol !== destCol) {
      // Both calls apply their own optimistic local update synchronously, so
      // firing them back-to-back (rather than chaining on the network request)
      // keeps the drop instant instead of snapping back while it's in flight.
      onMoveCard(draggableId, destCol)
      onReorderCards?.(updates)
    } else {
      onReorderCards?.(updates)
    }
  }

  // ── Quick create ──────────────────────────────────────────────────────────
  const handleQuickCreate = (e: React.FormEvent, col: string) => {
    e.preventDefault()
    const title = newCardTitles[col]?.trim()
    if (!title) return
    onCreateTaskInColumn(title, col)
    setNewCardTitles(prev => ({ ...prev, [col]: '' }))
    pendingScrollToCardRef.current = { col, title }
  }

  // Newly created cards land at the bottom of a (possibly already-scrolled)
  // column list — scroll the new card into view once it shows up in `tasks`
  // instead of leaving it hidden below the fold until the user scrolls manually.
  const pendingScrollToCardRef = useRef<{ col: string; title: string } | null>(null)
  useEffect(() => {
    const pending = pendingScrollToCardRef.current
    if (!pending) return
    const match = getTasksByColumn(pending.col).find(t => t.title === pending.title)
    if (!match) return
    pendingScrollToCardRef.current = null
    requestAnimationFrame(() => {
      document.querySelector(`[data-card-path="${CSS.escape(match.path)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }, [tasks])

  // ── Column ops ────────────────────────────────────────────────────────────
  const handleAddColumn = async () => {
    const raw = await promptDialog('Name for the new column:', '', { title: 'Add Group', placeholder: 'Column name…', confirmLabel: 'Add' })
    const name = raw?.trim()
    if (!name) return
    if (boardColumns.some(c => c.toLowerCase() === name.toLowerCase())) { await alertDialog('Column already exists.'); return }
    await onUpdateColumns?.([...boardColumns, name])
  }

  const saveRenameColumn = async (old: string) => {
    const next = editColVal.trim()
    if (!next || next === old) { setEditingColumn(null); return }
    if (boardColumns.some(c => c !== old && c.toLowerCase() === next.toLowerCase())) { await alertDialog('Column already exists.'); return }
    for (const c of getTasksByColumn(old)) await onMoveCard(c.path, next)
    await onUpdateColumns?.(boardColumns.map(c => c === old ? next : c))
    setEditingColumn(null)
  }

  const handleDeleteColumn = async (col: string) => {
    if (!await confirmDialog(`Delete "${col}"? Tasks here will be unassigned.`, { title: 'Delete column', confirmLabel: 'Delete', danger: true })) return
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
    onEnsureTagColor?.(t)
    setTagInput(''); setTagEditorCard(null)
  }

  const handleRemoveTag = async (path: string, tag: string, current: string[]) =>
    onUpdateTaskFrontMatter?.(path, { tags: current.filter(t => t !== tag) })

  const handleSetTagColor = async (tag: string, color: string) =>
    onSetGlobalTagColor?.(tag, color)

  // ── Filter ops ────────────────────────────────────────────────────────────
  const handleTagToggle = (tag: string) =>
    setFilterTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])

  const handlePriorityToggle = (name: string) =>
    setFilterPriorities(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])

  const handleAssigneeToggle = (name: string) =>
    setFilterAssignees(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])

  const handleClearFilters = () => {
    setFilterTags([]); setFilterPriorities([]); setFilterAssignees([]); setFilterDueDate(''); setSearchText('')
  }

  const handleToggleColumnCompleted = async (col: string) => {
    const next = completedColumns.some(c => c.toLowerCase() === col.toLowerCase())
      ? completedColumns.filter(c => c.toLowerCase() !== col.toLowerCase())
      : [...completedColumns, col]
    await onUpdateBoardFrontMatter?.({ completedColumns: next })
  }

  const toggleColCollapse = (col: string) => {
    const next = new Set(collapsedCols)
    next.has(col) ? next.delete(col) : next.add(col)
    setCollapsedCols(next)
    onUpdateBoardFrontMatter?.({ collapsedColumns: Array.from(next) })
  }

  // Reset filters whenever the board changes.
  useEffect(() => {
    setFilterTags([]); setFilterPriorities([]); setSearchText('')
  }, [boardPath])

  // Restore collapsed-column state from frontmatter — once per board. This is
  // intentionally NOT keyed on boardPath alone: right after a page reload
  // that restores a board straight from the URL hash, boardPath can become
  // set before `files` (and thus boardFrontMatter) has finished loading. If
  // we restored right then, we'd read collapsedColumns as undefined and wipe
  // it to empty — and since the effect wouldn't fire again once the real
  // frontmatter arrives, that wrong "everything expanded" state would stick
  // permanently. Waiting for boardFrontMatter to actually be defined (not
  // just re-running once) closes that race.
  useEffect(() => {
    if (!boardPath || boardFrontMatter === undefined) return
    if (restoredCollapseForBoardRef.current === boardPath) return
    restoredCollapseForBoardRef.current = boardPath
    const stored = parseJSON<string[] | null>(boardFrontMatter?.collapsedColumns, null)
    setCollapsedCols(new Set(Array.isArray(stored) ? stored : []))
  }, [boardPath, boardFrontMatter])

  // Close floating popovers on outside click
  useEffect(() => {
    const close = () => { setPriorityPicker(null); setColColorPicker(null) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // Close panel when clicking blank space outside it (not on another card or interactive element)
  useEffect(() => {
    if (!openCardPath) return
    const handler = (e: MouseEvent) => {
      // Use the path captured at dispatch time rather than e.target.closest(...):
      // some elements (e.g. the callout title) swap themselves for an <input>
      // on mousedown, and React can commit that synchronously before this
      // listener runs — by then e.target is already detached from the DOM,
      // with no ancestors left to walk, so closest() would wrongly report
      // "outside the panel" and close it.
      const path = e.composedPath().filter((el): el is Element => el instanceof Element)
      const matches = (sel: string) => path.some(el => el.matches(sel))
      if (matches('[data-card-detail-panel]')) return  // inside panel
      if (matches('[data-kanban-card]')) return         // clicking a card (will switch)
      if (matches('[data-image-editor-modal]')) return  // image markup modal (portaled to body)
      if (matches('[data-editor-popover]')) return      // editor popovers/modals (portaled to body)
      if (matches('button, input, select, a, [role="button"]')) return  // interactive controls
      closeCardPanel()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openCardPath])

  const boardName = boardPath
    ? boardPath.split('/').pop()?.replace('.board.md', '') ?? 'Board'
    : 'Workspace Board'

  const [editingBoardName, setEditingBoardName] = useState(false)
  const [boardNameVal, setBoardNameVal] = useState(boardName)
  useEffect(() => { setBoardNameVal(boardName) }, [boardName])

  const saveBoardName = async () => {
    setEditingBoardName(false)
    const trimmed = boardNameVal.trim()
    if (!trimmed || trimmed === boardName) return
    await onRenameBoard?.(trimmed)
  }

  return (
    <div className="relative flex flex-col h-auto md:h-full bf-kanban rounded-xl overflow-visible md:overflow-hidden p-2 md:p-6">
      {/* ── Header ── */}
      <div className="mb-4 flex justify-between items-center">
        <div>
          {editingBoardName ? (
            <input
              autoFocus
              value={boardNameVal}
              onChange={e => setBoardNameVal(e.target.value)}
              onBlur={saveBoardName}
              onKeyDown={e => { if (e.key === 'Enter') saveBoardName(); if (e.key === 'Escape') setEditingBoardName(false) }}
              className="text-2xl font-bold bg-transparent border-b border-violet-500 outline-none text-slate-100 w-64"
            />
          ) : (
            <h1
              className="text-2xl font-bold bf-kanban-title cursor-pointer hover:opacity-80"
              onDoubleClick={() => setEditingBoardName(true)}
              title="Double-click to rename"
            >{boardName}</h1>
          )}
          <p className="bf-kanban-hint text-xs mt-0.5">
            Drag to move · Double-click board title or column to rename · Click priority badge to change
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

      {/* ── Filter bar ── */}
      <KanbanFilterBar
        allTags={allBoardTags}
        allAssignees={allBoardAssignees}
        hasDueDates={boardHasDueDates}
        priorities={priorities}
        tagColors={tagColors}
        filterTags={filterTags}
        filterPriorities={filterPriorities}
        filterAssignees={filterAssignees}
        filterDueDate={filterDueDate}
        filterMode={filterMode}
        searchText={searchText}
        onTagToggle={handleTagToggle}
        onPriorityToggle={handlePriorityToggle}
        onAssigneeToggle={handleAssigneeToggle}
        onDueDateChange={setFilterDueDate}
        onModeChange={setFilterMode}
        onSearchChange={setSearchText}
        onClear={handleClearFilters}
      />

      {/* ── Board grid ── */}
      <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div ref={boardScrollRef} className="flex gap-4 flex-1 overflow-x-auto overflow-y-visible md:overflow-y-hidden pb-4 items-start bf-kanban-board-scroll">
        {boardColumns.map(col => {
          const colIdx  = boardColumns.indexOf(col)
          const accent  = getColumnColor(col)
          const isCollapsed = collapsedCols.has(col)

          if (isCollapsed) {
            const count = getTasksByColumn(col).length
            return (
              <Droppable droppableId={col} key={col}>
                {(dropProvided, dropSnapshot) => (
                  <div
                    ref={dropProvided.innerRef}
                    {...dropProvided.droppableProps}
                    onClick={() => toggleColCollapse(col)}
                    title={`${col} (${count} cards) — click to expand`}
                    className="flex flex-col items-center justify-start w-12 shrink-0 min-h-[500px] md:min-h-[180px] md:max-h-full rounded-xl bf-kanban-col cursor-pointer hover:opacity-80 transition pt-3 pb-3 gap-3 overflow-hidden"
                    style={{
                      borderTop: `3px solid ${accent}`,
                      background: dropSnapshot.isDraggingOver
                        ? `color-mix(in srgb, ${accent} 22%, var(--bg-surface))`
                        : `color-mix(in srgb, ${accent} 7%, var(--bg-surface))`,
                    }}
                  >
                    <span
                      className="text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center shrink-0"
                      style={{ background: accent + '22', color: accent, border: `1px solid ${accent}44` }}
                    >
                      {count}
                    </span>
                    <span
                      className="text-[11px] font-black uppercase tracking-widest flex-1"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: accent }}
                    >
                      {col}
                    </span>
                    <div className="w-0 h-0 overflow-hidden">{dropProvided.placeholder}</div>
                  </div>
                )}
              </Droppable>
            )
          }

          const colTasks    = getTasksByColumn(col)
          const isEditing   = editingColumn === col
          const isCompleted = completedColumns.some(c => c.toLowerCase() === col.toLowerCase())

          return (
            <div
              key={col}
              className="flex flex-col rounded-xl min-h-[500px] md:min-h-[180px] max-h-none md:max-h-full w-[272px] shrink-0 transition-all duration-200 bf-kanban-col"
              style={{
                borderTop: `3px solid ${accent}`,
                background: `color-mix(in srgb, ${accent} 7%, var(--bg-surface))`,
              }}
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
                    {/* Frosted-glass pill: dot (opens color picker) + label */}
                    <span
                      className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-lg text-[10.5px] font-bold uppercase tracking-wide shrink-0 backdrop-blur-md"
                      style={{
                        background: `color-mix(in srgb, ${accent} 22%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${accent} 42%, transparent)`,
                        color: accent,
                      }}
                    >
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          const r = e.currentTarget.getBoundingClientRect()
                          setColColorPicker(colColorPicker?.col === col ? null : { col, x: r.left, y: r.bottom + 6 })
                        }}
                        className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center transition cursor-pointer hover:brightness-125"
                        style={{ background: `color-mix(in srgb, ${accent} 32%, transparent)` }}
                        title="Change column color"
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                      </button>
                      <span className="truncate">{col}</span>
                    </span>
                    {/* Count — tinted to match the column's accent */}
                    <span className="text-xs font-bold bf-kanban-col-count" style={{ color: accent }}>{colTasks.length}</span>
                    {onUpdateColumns && <Edit3 size={9} className="bf-kanban-col-edit-icon opacity-0 group-hover:opacity-100 transition ml-auto" />}
                  </div>
                )}

                {!isEditing && (
                  <div className="flex items-center shrink-0 ml-1">
                    {/* Collapse button — always visible */}
                    <button
                      onClick={e => { e.stopPropagation(); toggleColCollapse(col) }}
                      className="p-1 bf-kanban-icon-btn rounded transition cursor-pointer"
                      title="Collapse column"
                    >
                      <ChevronsLeft size={11} />
                    </button>
                    {onUpdateColumns && (
                      <>
                        <button onClick={() => moveColumn(col, 'left')} disabled={colIdx === 0} className="p-1 bf-kanban-icon-btn disabled:opacity-10 rounded transition cursor-pointer"><ChevronLeft size={11} /></button>
                        <button onClick={() => moveColumn(col, 'right')} disabled={colIdx === boardColumns.length - 1} className="p-1 bf-kanban-icon-btn disabled:opacity-10 rounded transition cursor-pointer"><ChevronRight size={11} /></button>
                        <button onClick={() => handleDeleteColumn(col)} className="p-1 bf-kanban-icon-btn bf-kanban-icon-btn--danger rounded transition cursor-pointer"><Trash2 size={11} /></button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Cards */}
              <Droppable droppableId={col}>
                {(dropProvided, dropSnapshot) => (
                <div className="relative flex-1 min-h-0 flex flex-col">
                <div
                  ref={el => {
                    dropProvided.innerRef(el)
                    if (el) columnScrollRefs.current.set(col, el)
                    else columnScrollRefs.current.delete(col)
                  }}
                  {...dropProvided.droppableProps}
                  onScroll={() => checkColumnOverflow(col)}
                  className="flex-1 min-h-0 p-2 space-y-2 overflow-y-visible md:overflow-y-auto no-scrollbar transition-colors duration-150"
                  style={{ background: dropSnapshot.isDraggingOver ? `${accent}0d` : undefined }}
                >
                {colTasks.map((task, taskIdx) => {
                  const priority    = task.frontMatter?.priority
                  const pDef        = getPriorityDef(priority)
                  const pColor      = isCompleted ? '#64748b' : (pDef?.color || '#64748b')
                  const assignee    = task.frontMatter?.assignee
                  const dueDate     = task.frontMatter?.dueDate?.split('T')[0]
                  const duePast     = !!task.frontMatter?.dueDate && new Date(task.frontMatter.dueDate) < new Date()
                  const tags        = parseTags(task.frontMatter?.tags)
                  const cover       = task.frontMatter?.cover
                  const showTagEd   = tagEditorCard === task.path

                  // ── Filter + search logic ────────────────────────────────
                  const matchesTags     = filterTags.length === 0 || filterTags.every(t => tags.includes(t))
                  const matchesPriority = filterPriorities.length === 0 || filterPriorities.includes(priority || '')
                  const matchesAssignee = filterAssignees.length === 0 || filterAssignees.includes(assignee || '')
                  const matchesDueDate  = !filterDueDate || (
                    !!task.frontMatter?.dueDate &&
                    task.frontMatter.dueDate.split('T')[0] <= filterDueDate
                  )
                  const matchesFilter   = matchesTags && matchesPriority && matchesAssignee && matchesDueDate

                  const q = searchText.trim().toLowerCase()
                  const matchesSearch   = !q || task.title.toLowerCase().includes(q) ||
                    (task.frontMatter?.description || '').toLowerCase().includes(q)

                  const matchesAll = matchesFilter && matchesSearch

                  if (filterMode === 'hide' && !matchesAll) return null

                  const filterAttr = filterMode === 'highlight'
                    ? (matchesAll ? 'match' : 'dim')
                    : undefined

                  return (
                    <Draggable key={task.path} draggableId={task.path} index={taskIdx}>
                    {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      {...dragProvided.dragHandleProps}
                      onClick={() => openCard(task.path)}
                      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCardCtxMenu({ x: e.clientX, y: e.clientY, task, col }) }}
                      className={`p-3 rounded-lg cursor-grab active:cursor-grabbing transition-[background-color,box-shadow,opacity,border-color] duration-150 select-none group relative bf-kanban-card ${dragSnapshot.isDragging ? 'shadow-2xl' : isCompleted ? 'opacity-60' : ''}`}
                      data-kanban-card="true"
                      data-card-path={task.path}
                      data-dragging={dragSnapshot.isDragging}
                      data-filter={filterAttr}
                      style={{
                        ...(dragProvided.draggableProps.style as unknown as React.CSSProperties),
                        border: `1px solid ${accent}22`,
                        borderLeft: `3px solid ${accent}`,
                        ['--card-accent']: accent,
                      } as React.CSSProperties}
                    >
                      {/* Drag handle hint */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-30 transition-opacity pointer-events-none">
                        <GripVertical size={13} />
                      </div>

                      {/* Title */}
                      <div className={`font-medium bf-kanban-card-title transition mb-2.5 text-[13px] leading-snug break-words min-w-0 pr-4 ${isCompleted ? 'line-through' : ''}`}>
                        {task.title}
                      </div>

                      {/* Cover image */}
                      {cover && (
                        <div className="bf-kanban-card-cover mb-2.5 -mx-3">
                          <img src={cover} alt="" className="w-full h-36 object-cover block" draggable={false} />
                        </div>
                      )}

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
                            className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md tracking-wider border transition hover:opacity-90 cursor-pointer${priority?.toLowerCase() === 'urgent' && !isCompleted ? ' bf-kanban-priority-urgent' : ''}`}
                            style={{ background: pColor + '20', borderColor: pColor + '50', color: pColor }}
                          >
                            {priority || 'No priority'}
                          </button>

                          {dueDate && (
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] ${duePast && !isCompleted ? 'bg-red-500/15 text-red-400 border border-red-500/25' : 'bf-kanban-meta-badge'}`}>
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
                            const tc = isCompleted ? '#64748b' : (tagColors[tag] || '#8b5cf6')
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

                      {/* Checklist progress — one bar + toggle per separate checklist */}
                      {parseChecklistGroups(task.content || '').map((items, groupIdx) => {
                        const done  = items.filter(i => i.done).length
                        const total = items.length
                        const pct   = total ? (done / total) * 100 : 0
                        const allDone = done === total
                        const groupKey = `${task.path}::${groupIdx}`
                        const isExpanded = expandedChecklists.has(groupKey)
                        return (
                          <div key={groupIdx} className={groupIdx === 0 ? 'mt-2.5 pt-2 border-t border-[var(--border-0)]' : 'mt-1.5'}>
                            <button
                              className="flex items-center gap-2 w-full cursor-pointer"
                              onClick={e => {
                                e.stopPropagation()
                                setExpandedChecklists(prev => {
                                  const s = new Set(prev); s.has(groupKey) ? s.delete(groupKey) : s.add(groupKey); return s
                                })
                              }}
                            >
                              <ListChecks size={11} className="shrink-0 bf-kanban-hint" />
                              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: `${accent}25` }}>
                                <div
                                  className="h-full rounded-full transition-all duration-300"
                                  style={{ width: `${pct}%`, background: allDone ? '#10b981' : accent }}
                                />
                              </div>
                              <span className="text-[10px] bf-kanban-hint font-medium tabular-nums shrink-0">{done}/{total}</span>
                              <ChevronDown size={10} className={`bf-kanban-hint shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            {isExpanded && (
                              <div className="mt-2 space-y-1.5">
                                {items.map((item, idx) => (
                                  <div key={idx} className={`flex items-start gap-2 text-[11px] ${item.done ? 'opacity-50' : ''}`}>
                                    <div className={`mt-0.5 w-3 h-3 rounded border shrink-0 flex items-center justify-center transition-colors ${item.done ? 'bg-emerald-500 border-emerald-500' : 'border-current opacity-40'}`}>
                                      {item.done && <Check size={8} className="text-white" />}
                                    </div>
                                    <span className={`leading-snug break-words min-w-0 ${item.done ? 'line-through' : 'bf-kanban-modal-text'}`}>{item.text}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    )}
                    </Draggable>
                  )
                })}
                {dropProvided.placeholder}
                </div>
                {columnsWithOverflow.has(col) && (
                  <div
                    onClick={() => {
                      const el = columnScrollRefs.current.get(col)
                      el?.scrollBy({ top: el.clientHeight * 0.65, behavior: 'smooth' })
                    }}
                    className="absolute bottom-0 left-0 right-0 h-8 flex items-end justify-center pb-1 cursor-pointer"
                    style={{ background: `linear-gradient(to bottom, transparent, color-mix(in srgb, ${accent} 16%, var(--bg-surface)) 70%)` }}
                  >
                    <ChevronDown size={14} style={{ color: accent, opacity: 0.7 }} />
                  </div>
                )}
                </div>
                )}
              </Droppable>

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
      </DragDropContext>

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
          columns={boardColumns}
          completedColumns={completedColumns}
          onClose={() => setSettingsOpen(false)}
          onSavePriority={handleSavePriority}
          onDeletePriority={handleDeletePriority}
          onAddPriority={handleAddPriority}
          onSetTagColor={handleSetTagColor}
          onToggleCompleted={handleToggleColumnCompleted}
        />
      )}

      {/* ── Card context menu ── */}
      {cardCtxMenu && (
        <CardContextMenu
          x={cardCtxMenu.x}
          y={cardCtxMenu.y}
          task={cardCtxMenu.task}
          currentCol={cardCtxMenu.col}
          columns={boardColumns}
          priorities={priorities}
          onClose={() => setCardCtxMenu(null)}
          onOpen={() => openCard(cardCtxMenu.task.path)}
          onMove={col => onMoveCard(cardCtxMenu.task.path, col)}
          onSetPriority={name => handleSetCardPriority(cardCtxMenu.task.path, name)}
          onSetDueDate={date => onUpdateTaskFrontMatter?.(cardCtxMenu.task.path, { dueDate: date })}
          onDelete={onDeleteCard ? () => onDeleteCard(cardCtxMenu.task.path) : undefined}
          otherBoards={otherBoards}
          onMoveToBoard={onMoveCardToBoard ? (boardPath, col) => onMoveCardToBoard(cardCtxMenu.task.path, boardPath, col) : undefined}
        />
      )}

      {/* ── Card detail panel ── */}
      {openCardPath && (() => {
        const activeCard = tasks.find(t => t.path === openCardPath)
        if (!activeCard) return null
        return (
          <CardDetailPanel
            task={activeCard}
            viewMode={cardViewMode}
            columns={boardColumns}
            allBoardTags={allBoardTags}
            tagColors={tagColors}
            onEnsureTagColor={onEnsureTagColor}
            files={files}
            onClose={closeCardPanel}
            onSetMode={handleCardViewMode}
            onUpdateFrontMatter={updates => onUpdateTaskFrontMatter?.(openCardPath, updates) ?? Promise.resolve()}
            onDelete={onDeleteCard ? () => { onDeleteCard(openCardPath); setOpenCardPath(null) } : undefined}
            onCardSaved={onCardSaved}
            initialPropertiesCollapsed={initialPropertiesCollapsed}
            closing={closingCard}
            isMobile={isMobile}
            autosaveDelay={autosaveDelay}
          />
        )
      })()}
    </div>
  )
}

export default Kanban
