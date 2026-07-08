import React, { useState, useEffect, useRef } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { Save, Loader2 } from 'lucide-react'

interface CanvasProps {
  filePath: string
  initialContent: string
  onSave: (content: string) => Promise<void>
  isSaving: boolean
}

const Canvas: React.FC<CanvasProps> = ({ filePath, initialContent, onSave, isSaving }) => {
  const [elements, setElements] = useState<any[]>([])
  const [appState, setAppState] = useState<any>({ theme: 'dark' })
  const [isLoaded, setIsLoaded] = useState(false)
  const excalidrawRef = useRef<any>(null)

  // Parse Markdown to extract drawing JSON
  useEffect(() => {
    try {
      const codeBlockMatch = initialContent.match(/```json\n([\s\S]*?)\n```/)
      if (codeBlockMatch && codeBlockMatch[1]) {
        const data = JSON.parse(codeBlockMatch[1])
        if (data && Array.isArray(data.elements)) {
          setElements(data.elements)
          if (data.appState) {
            setAppState({ ...data.appState, theme: 'dark' })
          }
        }
      } else {
        // Fallback for empty/new canvas drawings
        setElements([])
      }
    } catch (e) {
      console.error('Failed to parse excalidraw content', e)
    }
    setIsLoaded(true)
  }, [initialContent])

  const handleSave = () => {
    if (!isLoaded) return

    // Get current elements and state from state variables or direct API if ref available
    const currentElements = excalidrawRef.current
      ? excalidrawRef.current.getSceneElements()
      : elements
    const currentAppState = excalidrawRef.current
      ? excalidrawRef.current.getAppState()
      : appState

    const title = filePath.split('/').pop()?.replace('.excalidraw.md', '') || 'Untitled Drawing'

    const serializedData = {
      type: 'excalidraw',
      version: 2,
      elements: currentElements,
      appState: {
        viewBackgroundColor: currentAppState.viewBackgroundColor,
        theme: 'dark',
        scrollX: currentAppState.scrollX,
        scrollY: currentAppState.scrollY,
        zoom: currentAppState.zoom,
      }
    }

    const markdown = `---
title: ${title}
type: canvas
editor: excalidraw
---

# Drawing Canvas
Below is the embedded drawing data. Do not modify the code block manually.

\`\`\`json
${JSON.stringify(serializedData, null, 2)}
\`\`\`
`
    onSave(markdown)
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
      {/* Control Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-[#161b22]/80 backdrop-blur-md sticky top-0 z-10">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Drawing Board</h2>
          <span className="text-xs text-slate-500 font-mono">{filePath}</span>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white font-medium text-sm rounded-lg shadow-lg hover:shadow-violet-600/20 active:scale-95 transition cursor-pointer"
        >
          {isSaving ? (
            <>
              <Loader2 className="animate-spin" size={14} />
              Saving...
            </>
          ) : (
            <>
              <Save size={14} />
              Save Canvas
            </>
          )}
        </button>
      </div>

      {/* Excalidraw Area */}
      <div className="flex-1 relative w-full h-[600px] bg-[#121212]">
        {isLoaded ? (
          <Excalidraw
            excalidrawAPI={(api: any) => {
              excalidrawRef.current = api
            }}
            initialData={{
              elements: elements,
              appState: { ...appState, theme: 'dark' },
              libraryItems: []
            }}
            theme="dark"
          />
        ) : (
          <div className="absolute inset-0 flex justify-center items-center text-slate-500">
            <Loader2 className="animate-spin mr-2" /> Initializing Canvas...
          </div>
        )}
      </div>
    </div>
  )
}
export default Canvas
