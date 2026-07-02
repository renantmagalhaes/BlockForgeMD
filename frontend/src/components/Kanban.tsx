import React, { useState } from 'react'
import { Calendar, User, Tag, Plus, Trash2, Edit3, X, Check, ChevronLeft, ChevronRight } from 'lucide-react'

interface FileRecord {
  path: string
  title: string
  type: string
  contentHash: string
  updatedAt: string
  frontMatter?: Record<string, string>
}

interface KanbanProps {
  files: FileRecord[]
  onMoveCard: (path: string, newStatus: string) => Promise<void>
  onSelectFile: (path: string) => void
  onCreateTaskInColumn: (title: string, status: string) => Promise<void>
  boardPath: string | null
  boardColumns: string[]
  onUpdateColumns?: (columns: string[]) => Promise<void>
}

export const Kanban: React.FC<KanbanProps> = ({
  files,
  onMoveCard,
  onSelectFile,
  onCreateTaskInColumn,
  boardPath,
  boardColumns,
  onUpdateColumns,
}) => {
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [newCardTitles, setNewCardTitles] = useState<Record<string, string>>({})

  // States for column renaming
  const [editingColumn, setEditingColumn] = useState<string | null>(null)
  const [editColVal, setEditColVal] = useState('')

  // Helper to resolve parent directory folder
  const getParentDir = (filePath: string): string => {
    const lastSlash = filePath.lastIndexOf('/')
    if (lastSlash === -1) return ''
    return filePath.substring(0, lastSlash + 1)
  }

  // Tasks live under the board's stem folder (Boards/board1/), not its parent dir (Boards/).
  // Strip .board.md to get the stem; fall back to parent dir for non-.board.md paths.
  const boardFolder = boardPath
    ? boardPath.endsWith('.board.md')
      ? boardPath.slice(0, -'.board.md'.length) + '/'
      : getParentDir(boardPath)
    : ''

  // Filter tasks from indexed files belonging to the same folder scope
  const tasks = files.filter((f) => {
    const isTask = f.type === 'task' || (f.frontMatter && f.frontMatter.status)
    if (!isTask) return false

    const taskFolder = getParentDir(f.path)
    
    // If the board is in a folder, match strictly inside that folder
    if (boardFolder) {
      return taskFolder === boardFolder
    }
    
    // If board is at the root, show root tasks or Tasks/ folder tasks
    return taskFolder === '' || taskFolder === 'Tasks/'
  })

  // Group tasks by status
  const getTasksByColumn = (col: string) => {
    return tasks.filter((t) => {
      const status = t.frontMatter?.status || ''
      return status.toLowerCase() === col.toLowerCase()
    })
  }

  // HTML5 Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, path: string) => {
    e.dataTransfer.setData('text/plain', path)
    setDraggingPath(path)
  }

  const handleDragEnd = () => {
    setDraggingPath(null)
    setDragOverColumn(null)
  }

  const handleDragEnter = (col: string) => {
    setDragOverColumn(col)
  }

  const handleDrop = (e: React.DragEvent, col: string) => {
    e.preventDefault()
    const path = e.dataTransfer.getData('text/plain')
    if (path) {
      onMoveCard(path, col)
    }
    setDraggingPath(null)
    setDragOverColumn(null)
  }

  const handleQuickCreateSubmit = (e: React.FormEvent, col: string) => {
    e.preventDefault()
    const title = newCardTitles[col]?.trim()
    if (!title) return
    onCreateTaskInColumn(title, col)
    setNewCardTitles((prev) => ({ ...prev, [col]: '' }))
  }

  // Column Modification Actions
  const handleAddColumn = async () => {
    const colName = prompt('Enter new column name:')
    if (!colName) return
    const sanitized = colName.trim()
    if (!sanitized) return

    if (boardColumns.some((c) => c.toLowerCase() === sanitized.toLowerCase())) {
      alert('A column with that name already exists.')
      return
    }

    if (onUpdateColumns) {
      await onUpdateColumns([...boardColumns, sanitized])
    }
  }

  const startRenameColumn = (col: string) => {
    setEditingColumn(col)
    setEditColVal(col)
  }

  const saveRenameColumn = async (oldName: string) => {
    const newName = editColVal.trim()
    if (!newName || newName === oldName) {
      setEditingColumn(null)
      return
    }

    if (boardColumns.some((c) => c !== oldName && c.toLowerCase() === newName.toLowerCase())) {
      alert('A column with that name already exists.')
      return
    }

    const updatedCols = boardColumns.map((c) => (c === oldName ? newName : c))

    // Asynchronously update status of all tasks currently in this column
    const cardsInCol = getTasksByColumn(oldName)
    for (const card of cardsInCol) {
      await onMoveCard(card.path, newName)
    }

    if (onUpdateColumns) {
      await onUpdateColumns(updatedCols)
    }
    setEditingColumn(null)
  }

  const handleDeleteColumn = async (colName: string) => {
    if (!confirm(`Are you sure you want to delete the column "${colName}"? Tasks in this column will be unassigned.`)) {
      return
    }

    const updatedCols = boardColumns.filter((c) => c !== colName)

    // Clear status of tasks in this column
    const cardsInCol = getTasksByColumn(colName)
    for (const card of cardsInCol) {
      await onMoveCard(card.path, '')
    }

    if (onUpdateColumns) {
      await onUpdateColumns(updatedCols)
    }
  }

  const moveColumn = async (col: string, direction: 'left' | 'right') => {
    if (!onUpdateColumns) return
    const idx = boardColumns.indexOf(col)
    if (idx === -1) return
    const newIdx = direction === 'left' ? idx - 1 : idx + 1
    if (newIdx < 0 || newIdx >= boardColumns.length) return

    const updated = [...boardColumns]
    const temp = updated[idx]
    updated[idx] = updated[newIdx]
    updated[newIdx] = temp

    await onUpdateColumns(updated)
  }

  const getPriorityColor = (priority?: string) => {
    switch (priority?.toLowerCase()) {
      case 'high':
        return 'bg-red-500/20 text-red-400 border border-red-500/30'
      case 'medium':
        return 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
      case 'low':
        return 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
      default:
        return 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden shadow-2xl p-6">
      {/* Header Area */}
      <div className="mb-6 flex justify-between items-center bg-[#0d1117]">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">
            {boardPath ? boardPath.split('/').pop()?.replace('.board.md', '') : 'Workspace Board'}
          </h1>
          <p className="text-slate-400 text-sm">
            Drag cards between columns to update front matter status. Double click column text to edit, use arrows to reorder.
          </p>
        </div>

        {onUpdateColumns && (
          <button
            onClick={handleAddColumn}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs rounded-lg shadow-lg hover:shadow-violet-600/20 active:scale-95 transition cursor-pointer"
          >
            <Plus size={14} />
            Add Column
          </button>
        )}
      </div>

      {/* Board Grid */}
      <div className="flex gap-6 flex-1 overflow-x-auto overflow-y-hidden pb-4 no-scrollbar items-start">
        {boardColumns.map((col, colIdx) => {
          const colTasks = getTasksByColumn(col)
          const isOver = dragOverColumn === col
          const isEditing = editingColumn === col

          return (
            <div
              key={col}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverColumn(col)
              }}
              onDragEnter={() => handleDragEnter(col)}
              onDrop={(e) => handleDrop(e, col)}
              className={`flex flex-col bg-[#161b22]/50 border rounded-xl overflow-hidden min-h-[500px] max-h-full w-80 shrink-0 transition-all duration-200 ${
                isOver ? 'border-violet-500 bg-[#1d1e2e]/50 scale-[1.01] shadow-2xl' : 'border-slate-800'
              }`}
            >
              {/* Column Header */}
              <div className="flex justify-between items-center px-4 py-3 bg-[#161b22] border-b border-slate-800 shrink-0 select-none">
                {isEditing ? (
                  <div className="flex items-center gap-1 flex-1 mr-2">
                    <input
                      type="text"
                      value={editColVal}
                      onChange={(e) => setEditColVal(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveRenameColumn(col)}
                      className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 outline-none w-full"
                      autoFocus
                    />
                    <button
                      onClick={() => saveRenameColumn(col)}
                      className="p-1 text-emerald-400 hover:bg-slate-800 rounded transition cursor-pointer"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => setEditingColumn(null)}
                      className="p-1 text-red-400 hover:bg-slate-800 rounded transition cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div
                    onDoubleClick={() => onUpdateColumns && startRenameColumn(col)}
                    className="flex items-center gap-2 cursor-pointer flex-1 truncate group"
                    title={onUpdateColumns ? 'Double click to rename' : undefined}
                  >
                    <span className="font-semibold text-slate-200 truncate">{col}</span>
                    <span className="px-2 py-0.5 text-xs font-mono font-bold bg-slate-800 text-slate-400 rounded-full shrink-0">
                      {colTasks.length}
                    </span>
                    {onUpdateColumns && (
                      <Edit3 size={10} className="text-slate-500 opacity-0 group-hover:opacity-100 transition shrink-0 ml-1" />
                    )}
                  </div>
                )}

                {onUpdateColumns && !isEditing && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => moveColumn(col, 'left')}
                      disabled={colIdx === 0}
                      className="p-1 hover:bg-slate-800 text-slate-500 hover:text-slate-300 disabled:opacity-10 rounded transition cursor-pointer"
                      title="Move Left"
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <button
                      onClick={() => moveColumn(col, 'right')}
                      disabled={colIdx === boardColumns.length - 1}
                      className="p-1 hover:bg-slate-800 text-slate-500 hover:text-slate-300 disabled:opacity-10 rounded transition cursor-pointer"
                      title="Move Right"
                    >
                      <ChevronRight size={12} />
                    </button>
                    <button
                      onClick={() => handleDeleteColumn(col)}
                      className="p-1 hover:bg-slate-800 text-slate-500 hover:text-red-400 rounded transition cursor-pointer"
                      title="Delete Column"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* Cards List Area */}
              <div className="flex-1 p-3 space-y-3 overflow-y-auto no-scrollbar">
                {colTasks.map((task) => {
                  const priority = task.frontMatter?.priority
                  const assignee = task.frontMatter?.assignee
                  const dueDate = task.frontMatter?.dueDate
                  const tags = task.frontMatter?.tags
                    ? typeof task.frontMatter.tags === 'string'
                      ? JSON.parse(task.frontMatter.tags)
                      : task.frontMatter.tags
                    : []

                  const isDraggingThisCard = draggingPath === task.path

                  return (
                    <div
                      key={task.path}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.path)}
                      onDragEnd={handleDragEnd}
                      onClick={() => onSelectFile(task.path)}
                      className={`p-4 bg-[#0d1117] hover:bg-[#161b22]/90 border rounded-lg cursor-grab active:cursor-grabbing transition shadow-md hover:shadow-lg select-none group relative ${
                        isDraggingThisCard
                          ? 'opacity-40 border-violet-500 border-dashed scale-95'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {/* Card Title */}
                      <div className="font-medium text-slate-200 group-hover:text-violet-400 transition mb-2">
                        {task.title}
                      </div>

                      {/* Metadata fields */}
                      <div className="space-y-2 text-xs text-slate-400">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {priority && (
                            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md tracking-wider ${getPriorityColor(priority)}`}>
                              {priority}
                            </span>
                          )}
                          {dueDate && (
                            <div className="flex items-center gap-1 bg-slate-800/50 px-2 py-0.5 rounded-md border border-slate-800 text-[10px]">
                              <Calendar size={10} />
                              <span>{dueDate}</span>
                            </div>
                          )}
                        </div>

                        {assignee && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-400">
                            <User size={10} className="text-slate-500" />
                            <span>Assignee: <strong className="text-slate-300">{assignee}</strong></span>
                          </div>
                        )}

                        {/* Tags */}
                        {Array.isArray(tags) && tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {tags.map((tag: string) => (
                              <span
                                key={tag}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 bg-violet-600/10 text-violet-400 border border-violet-500/20 text-[9px] rounded-md font-medium"
                              >
                                <Tag size={8} />
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Quick Create task inside column footer */}
              <div className="p-3 bg-[#161b22]/30 border-t border-slate-800/60 shrink-0">
                <form onSubmit={(e) => handleQuickCreateSubmit(e, col)} className="flex gap-1.5">
                  <input
                    type="text"
                    required
                    placeholder="Add task..."
                    value={newCardTitles[col] || ''}
                    onChange={(e) => setNewCardTitles((prev) => ({ ...prev, [col]: e.target.value }))}
                    className="flex-1 bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none transition"
                  />
                  <button
                    type="submit"
                    className="flex items-center justify-center p-2 bg-slate-800 hover:bg-violet-600 hover:text-white text-slate-400 rounded-lg transition cursor-pointer"
                    title="Add Task"
                  >
                    <Plus size={14} />
                  </button>
                </form>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
export default Kanban
