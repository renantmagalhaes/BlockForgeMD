import React, { useState, useEffect, useRef } from 'react'
import { Save, Loader2, RefreshCw } from 'lucide-react'

interface DiagramProps {
  filePath: string
  initialContent: string
  onSave: (content: string) => Promise<void>
  isSaving: boolean
}

export const Diagram: React.FC<DiagramProps> = ({ filePath, initialContent, onSave, isSaving }) => {
  const [initialXml, setInitialXml] = useState('')
  const [isLoaded, setIsLoaded] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Extract XML drawing code from raw markdown
  useEffect(() => {
    try {
      const codeBlockMatch = initialContent.match(/```xml\n([\s\S]*?)\n```/)
      if (codeBlockMatch && codeBlockMatch[1]) {
        setInitialXml(codeBlockMatch[1].trim())
      } else {
        setInitialXml('')
      }
    } catch (e) {
      console.error('Failed to parse draw.io content', e)
    }
    setIsLoaded(true)
  }, [initialContent])

  // Handle postMessage API communication with Draw.io iframe
  useEffect(() => {
    if (!isLoaded) return

    const handleMessage = (e: MessageEvent) => {
      // Allow messages from diagrams.net or app.diagrams.net
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
          // Iframe is initialized. Send existing XML code
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({
              action: 'load',
              xml: initialXml,
            }),
            '*'
          )
          setIframeLoaded(true)
        } else if (data.event === 'save') {
          // Draw.io user clicked save or we triggered a manual save request
          const title = filePath.split('/').pop()?.replace('.md', '') || 'Untitled Diagram'
          const markdown = `---
title: ${title}
type: canvas
editor: drawio
---

# Draw.io Diagram
Below is the embedded diagram layout in XML. Do not modify the code block manually.

\`\`\`xml
${data.xml}
\`\`\`
`
          onSave(markdown)
        } else if (data.event === 'exit') {
          // Handle editor exit if needed
        }
      } catch (err) {
        // Not JSON or other message, ignore
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [isLoaded, initialXml, filePath, onSave])

  const handleSaveClick = () => {
    // Send a save action postMessage to the iframe to trigger the 'save' event callback
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({
        action: 'save',
        exit: false,
      }),
      '*'
    )
  }

  const handleReload = () => {
    setIframeLoaded(false)
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
      {/* Control Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-[#161b22]/80 backdrop-blur-md sticky top-0 z-10 select-none">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Draw.io Diagram Board</h2>
          <span className="text-xs text-slate-500 font-mono">{filePath}</span>
        </div>

        <div className="flex items-center gap-3">
          {!iframeLoaded && (
            <span className="flex items-center gap-1 text-[10px] text-violet-400 font-medium">
              <Loader2 className="animate-spin" size={10} />
              Loading Draw.io editor...
            </span>
          )}

          <button
            onClick={handleReload}
            className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition cursor-pointer"
            title="Reload Diagram Editor"
          >
            <RefreshCw size={14} />
          </button>

          <button
            onClick={handleSaveClick}
            disabled={isSaving || !iframeLoaded}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 text-white font-medium text-sm rounded-lg shadow-lg hover:shadow-violet-600/20 active:scale-95 transition cursor-pointer"
          >
            {isSaving ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                Saving Diagram...
              </>
            ) : (
              <>
                <Save size={14} />
                Save Diagram
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor Iframe Area */}
      <div className="flex-1 relative w-full h-[650px] bg-[#121212]">
        <iframe
          id="drawio-iframe"
          ref={iframeRef}
          src="https://embed.diagrams.net/?embed=1&ui=dark&spin=1&proto=json"
          className="w-full h-full border-none"
          title="Draw.io Diagram Editor"
        />
      </div>
    </div>
  )
}
export default Diagram
