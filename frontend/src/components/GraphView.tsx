import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8080' : ''

interface GraphNode {
  id: string
  title: string
  type?: 'file' | 'tag'
  x?: number
  y?: number
  fx?: number | null
  fy?: number | null
}

interface GraphEdge {
  source: string | GraphNode
  target: string | GraphNode
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

interface GraphViewProps {
  workspace: string
  onSelectFile: (path: string) => void
  currentPath?: string | null
}

export const GraphView: React.FC<GraphViewProps> = ({ workspace, onSelectFile, currentPath }) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const [data, setData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null)
  const nodeClickTimerRef = useRef<number | null>(null)
  // App currently provides this callback inline, so its identity changes on
  // ordinary parent renders (file sync, sidebar state, etc.). Keeping the
  // latest function in a ref prevents those unrelated renders from tearing
  // down and rebuilding the force simulation, which looked like a reload.
  const onSelectFileRef = useRef(onSelectFile)

  useEffect(() => { onSelectFileRef.current = onSelectFile }, [onSelectFile])

  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query || !data) return []
    return data.nodes
      .filter(node => node.title.toLowerCase().includes(query))
      .sort((a, b) => Number(b.type === 'tag') - Number(a.type === 'tag') || a.title.localeCompare(b.title))
      .slice(0, 8)
  }, [data, search])

  const focusNode = (node: GraphNode) => {
    setSearch(node.title)
    setFocusedNodeId(node.id)
    setSuggestionsOpen(false)
  }

  useEffect(() => () => {
    if (nodeClickTimerRef.current !== null) window.clearTimeout(nodeClickTimerRef.current)
  }, [])

  useEffect(() => {
    setLoading(true)
    fetch(`${API_BASE}/api/graph?workspace=${encodeURIComponent(workspace)}`)
      .then(r => r.json())
      .then(d => { setData(d); setError(null) })
      .catch(() => setError('Failed to load graph data'))
      .finally(() => setLoading(false))
  }, [workspace])

  const draw = useCallback(() => {
    if (!svgRef.current || !data) return

    const container = svgRef.current.parentElement!
    const W = container.clientWidth || 800
    const H = container.clientHeight || 600
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', W).attr('height', H)

    const graph = svg.append('g')
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', event => graph.attr('transform', event.transform))
    svg.call(zoom)
    svg.call(zoom.translateTo, W / 2, H / 2)
    svg.on('click.clear-graph-focus', event => {
      if (event.target === svgRef.current) {
        setFocusedNodeId(null)
        setSearch('')
      }
    })

    const nodes = data.nodes.map(node => ({ ...node }))
    const nodeMap = new Map(nodes.map(node => [node.id, node]))
    const resolveId = (node: string | GraphNode) => typeof node === 'string' ? node : node.id
    const links: GraphEdge[] = data.edges
      .filter(edge => nodeMap.has(resolveId(edge.source)) && nodeMap.has(resolveId(edge.target)))
      .map(edge => ({ source: nodeMap.get(resolveId(edge.source))!, target: nodeMap.get(resolveId(edge.target))! }))

    const isTag = (node: GraphNode) => node.type === 'tag'
    const connectedNodeIds = new Set<string>()
    const highlightedLinks = new Set<GraphEdge>()
    if (focusedNodeId) {
      links.forEach(link => {
        const source = (link.source as GraphNode).id
        const target = (link.target as GraphNode).id
        if (source === focusedNodeId || target === focusedNodeId) {
          connectedNodeIds.add(source)
          connectedNodeIds.add(target)
          highlightedLinks.add(link)
        }
      })
    }
    const isFocused = (node: GraphNode) => node.id === focusedNodeId
    const isConnected = (node: GraphNode) => connectedNodeIds.has(node.id)
    const isDimmed = (node: GraphNode) => focusedNodeId !== null && !isConnected(node)
    const baseRadius = (node: GraphNode) => isTag(node) ? 8 : (node.id === currentPath ? 9 : 6)
    const nodeRadius = (node: GraphNode) => isFocused(node) ? (isTag(node) ? 13 : 11) : baseRadius(node)
    const nodeFill = (node: GraphNode) => {
      if (isFocused(node)) return isTag(node) ? '#fbbf24' : '#c4b5fd'
      if (isConnected(node)) return isTag(node) ? '#d97706' : '#7c3aed'
      return isTag(node) ? '#b45309' : (node.id === currentPath ? '#7c3aed' : '#4b5563')
    }
    const nodeStroke = (node: GraphNode) => isFocused(node) ? '#ffffff' : (isTag(node) ? '#f59e0b' : (node.id === currentPath ? '#a78bfa' : '#6b7280'))

    const defs = svg.append('defs')
    const addGlow = (id: string, deviation: number) => {
      const filter = defs.append('filter').attr('id', id).attr('x', '-100%').attr('y', '-100%').attr('width', '300%').attr('height', '300%')
      filter.append('feGaussianBlur').attr('stdDeviation', deviation).attr('result', 'blur')
      const merge = filter.append('feMerge')
      merge.append('feMergeNode').attr('in', 'blur')
      merge.append('feMergeNode').attr('in', 'SourceGraphic')
    }
    addGlow('graph-focus-glow', 4)
    addGlow('graph-connected-glow', 2)

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(links).id(node => node.id).distance(80).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(node => isTag(node as GraphNode) ? 24 : 18))
    simulationRef.current = sim

    const link = graph.append('g').selectAll('line').data(links).join('line')
      .attr('stroke', edge => highlightedLinks.has(edge) ? '#c4b5fd' : '#334155')
      .attr('stroke-width', edge => highlightedLinks.has(edge) ? 2.5 : 1.2)
      .attr('stroke-opacity', edge => focusedNodeId === null ? 0.6 : (highlightedLinks.has(edge) ? 1 : 0.08))
      .attr('filter', edge => highlightedLinks.has(edge) ? 'url(#graph-connected-glow)' : null)

    const node = graph.append('g').selectAll<SVGGElement, GraphNode>('g').data(nodes).join('g')
      .attr('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null }),
      )
      // Delay a single-click selection just enough to distinguish it from a
      // double-click. This keeps double-click reliable even though selecting
      // a node redraws the graph to apply its focus treatment.
      .on('click', (event, d) => {
        if (event.defaultPrevented) return
        if (nodeClickTimerRef.current !== null) window.clearTimeout(nodeClickTimerRef.current)
        nodeClickTimerRef.current = window.setTimeout(() => {
          focusNode(d)
          nodeClickTimerRef.current = null
        }, 220)
      })
      .on('dblclick', (event, d) => {
        event.preventDefault()
        event.stopPropagation()
        if (nodeClickTimerRef.current !== null) {
          window.clearTimeout(nodeClickTimerRef.current)
          nodeClickTimerRef.current = null
        }
        if (!isTag(d)) onSelectFileRef.current(d.id)
      })

    const circles = node.append('circle')
      .attr('r', nodeRadius)
      .attr('fill', nodeFill)
      .attr('stroke', nodeStroke)
      .attr('stroke-width', node => isFocused(node) ? 2.5 : 1.5)
      .attr('opacity', node => isDimmed(node) ? 0.16 : 1)
      .attr('filter', node => isFocused(node) ? 'url(#graph-focus-glow)' : isConnected(node) && !isFocused(node) ? 'url(#graph-connected-glow)' : null)
      .on('mouseover', function (_, node) { d3.select(this).attr('fill', isTag(node) ? '#f59e0b' : '#7c3aed').attr('r', isTag(node) ? 11 : 9) })
      .on('mouseout', function (_, node) { d3.select(this).attr('fill', nodeFill(node)).attr('r', nodeRadius(node)) })

    circles.filter(isFocused).append('animate')
      .attr('attributeName', 'r').attr('values', node => `${nodeRadius(node)};${nodeRadius(node) + 4};${nodeRadius(node)}`)
      .attr('dur', '1.1s').attr('repeatCount', 'indefinite')
    circles.filter(node => isConnected(node) && !isFocused(node)).append('animate')
      .attr('attributeName', 'opacity').attr('values', '0.7;1;0.7')
      .attr('dur', '1.5s').attr('repeatCount', 'indefinite')

    node.append('text')
      .text(node => node.title.length > 20 ? `${node.title.slice(0, 20)}…` : node.title)
      .attr('font-size', 10).attr('fill', node => isFocused(node) ? '#ffffff' : (isTag(node) ? '#fbbf24' : '#94a3b8'))
      // The focused circle pulses four pixels beyond its base radius. Keep
      // its label outside that maximum radius so the glow never washes it
      // out partway through the animation.
      .attr('font-weight', node => isTag(node) ? 600 : 400).attr('dy', node => isFocused(node) ? '2.6em' : '1.8em')
      .attr('text-anchor', 'middle').attr('pointer-events', 'none')
      .attr('opacity', node => isDimmed(node) ? 0.16 : 1)

    let centeredFocusedNode = false
    sim.on('tick', () => {
      link
        .attr('x1', edge => (edge.source as GraphNode).x ?? 0).attr('y1', edge => (edge.source as GraphNode).y ?? 0)
        .attr('x2', edge => (edge.target as GraphNode).x ?? 0).attr('y2', edge => (edge.target as GraphNode).y ?? 0)
      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
      const focusedNode = nodes.find(node => node.id === focusedNodeId)
      if (!centeredFocusedNode && focusedNode?.x != null && focusedNode.y != null) {
        centeredFocusedNode = true
        const scale = 1.8
        svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - focusedNode.x * scale, H / 2 - focusedNode.y * scale).scale(scale))
      }
    })

    return () => sim.stop()
  }, [data, currentPath, focusedNodeId])

  useEffect(() => {
    const cleanup = draw()
    return () => { cleanup?.(); simulationRef.current?.stop() }
  }, [draw])

  if (loading) return <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Loading graph…</div>
  if (error) return <div className="flex-1 flex items-center justify-center text-red-400 text-sm">{error}</div>

  const nodeCount = data?.nodes.length ?? 0
  const edgeCount = data?.edges.length ?? 0

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-200">Knowledge Graph</span>
          <span className="text-[10px] text-slate-500">{nodeCount} pages · {edgeCount} links</span>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Find tags or nodes…"
            value={search}
            onFocus={() => setSuggestionsOpen(true)}
            onChange={event => { setSearch(event.target.value); setFocusedNodeId(null); setActiveSuggestion(0); setSuggestionsOpen(true) }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown' && suggestions.length > 0) { event.preventDefault(); setActiveSuggestion(index => Math.min(index + 1, suggestions.length - 1)) }
              if (event.key === 'ArrowUp' && suggestions.length > 0) { event.preventDefault(); setActiveSuggestion(index => Math.max(index - 1, 0)) }
              if (event.key === 'Enter' && suggestions.length > 0) { event.preventDefault(); focusNode(suggestions[activeSuggestion] ?? suggestions[0]) }
              if (event.key === 'Escape') setSuggestionsOpen(false)
            }}
            className="text-xs bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-300 placeholder-slate-600 outline-none focus:border-violet-500 w-48"
          />
          {suggestionsOpen && suggestions.length > 0 && (
            <div className="absolute right-0 top-full mt-1 z-20 w-64 overflow-hidden rounded-lg border border-slate-700 bg-[#161b22] py-1 shadow-xl">
              {suggestions.map((node, index) => (
                <button
                  key={node.id}
                  onMouseDown={event => { event.preventDefault(); focusNode(node) }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition ${index === activeSuggestion ? 'bg-violet-500/20 text-violet-100' : 'text-slate-300 hover:bg-slate-800'}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${node.type === 'tag' ? 'bg-amber-500' : 'bg-slate-500'}`} />
                  <span className="min-w-0 flex-1 truncate">{node.title}</span>
                  <span className="text-[9px] uppercase tracking-wide text-slate-500">{node.type === 'tag' ? 'tag' : 'page'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <svg ref={svgRef} className="w-full h-full" />
        <div className="absolute bottom-3 right-3 text-[9px] text-slate-600 select-none">Scroll to zoom · Drag to pan · Click to focus · Double-click a page to open</div>
      </div>
    </div>
  )
}
