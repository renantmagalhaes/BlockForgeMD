import React, { useEffect, useRef, useState, useCallback } from 'react'
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
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null)

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

    const g = svg.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (e) => g.attr('transform', e.transform))
    svg.call(zoom)
    svg.call(zoom.translateTo, W / 2, H / 2)

    const nodes: GraphNode[] = data.nodes.map(n => ({ ...n }))
    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    const resolveId = (n: string | GraphNode) => (typeof n === 'string' ? n : n.id)
    const links: GraphEdge[] = data.edges
      .filter(e => nodeMap.has(resolveId(e.source)) && nodeMap.has(resolveId(e.target)))
      .map(e => ({
        source: nodeMap.get(resolveId(e.source))!,
        target: nodeMap.get(resolveId(e.target))!,
      }))

    const isTag = (d: GraphNode) => d.type === 'tag'
    const baseRadius = (d: GraphNode) => isTag(d) ? 8 : (d.id === currentPath ? 9 : 6)
    const baseFill = (d: GraphNode) => isTag(d) ? '#b45309' : (d.id === currentPath ? '#7c3aed' : '#4b5563')
    const baseStroke = (d: GraphNode) => isTag(d) ? '#f59e0b' : (d.id === currentPath ? '#a78bfa' : '#6b7280')

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphEdge>(links).id(n => n.id).distance(80).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(d => isTag(d as GraphNode) ? 24 : 18))
    simulationRef.current = sim

    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#334155')
      .attr('stroke-width', 1.2)
      .attr('stroke-opacity', 0.6)

    const node = g.append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )
      .on('click', (_event, d) => { if (!isTag(d)) onSelectFile(d.id) })

    node.append('circle')
      .attr('r', baseRadius)
      .attr('fill', baseFill)
      .attr('stroke', baseStroke)
      .attr('stroke-width', 1.5)
      .on('mouseover', function(_, d) {
        d3.select(this).attr('fill', isTag(d) ? '#f59e0b' : '#7c3aed').attr('r', isTag(d) ? 11 : 9)
      })
      .on('mouseout', function(_, d) {
        d3.select(this).attr('fill', baseFill(d)).attr('r', baseRadius(d))
      })

    node.append('text')
      .text(d => d.title.length > 20 ? d.title.slice(0, 20) + '…' : d.title)
      .attr('font-size', 10)
      .attr('fill', d => isTag(d) ? '#fbbf24' : '#94a3b8')
      .attr('font-weight', d => isTag(d) ? 600 : 400)
      .attr('dy', '1.8em')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none')

    sim.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x ?? 0)
        .attr('y1', d => (d.source as GraphNode).y ?? 0)
        .attr('x2', d => (d.target as GraphNode).x ?? 0)
        .attr('y2', d => (d.target as GraphNode).y ?? 0)
      node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => { sim.stop() }
  }, [data, currentPath, onSelectFile])

  useEffect(() => {
    const cleanup = draw()
    return () => { cleanup?.(); simulationRef.current?.stop() }
  }, [draw])

  useEffect(() => {
    if (!svgRef.current || !search.trim()) return
    const q = search.toLowerCase()
    d3.select(svgRef.current).selectAll<SVGCircleElement, GraphNode>('circle')
      .attr('fill', d => {
        if (d.title.toLowerCase().includes(q)) return '#a78bfa'
        if (d.type === 'tag') return '#b45309'
        return d.id === currentPath ? '#7c3aed' : '#4b5563'
      })
  }, [search, currentPath])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
      Loading graph…
    </div>
  )
  if (error) return (
    <div className="flex-1 flex items-center justify-center text-red-400 text-sm">{error}</div>
  )

  const nodeCount = data?.nodes.length ?? 0
  const edgeCount = data?.edges.length ?? 0

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-[#161b22] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-200">Knowledge Graph</span>
          <span className="text-[10px] text-slate-500">{nodeCount} pages · {edgeCount} links</span>
        </div>
        <input
          type="text"
          placeholder="Search nodes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-xs bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-300 placeholder-slate-600 outline-none focus:border-violet-500 w-40"
        />
      </div>
      <div className="flex-1 relative overflow-hidden">
        <svg ref={svgRef} className="w-full h-full" />
        <div className="absolute bottom-3 right-3 text-[9px] text-slate-600 select-none">
          Scroll to zoom · Drag to pan · Click node to open
        </div>
      </div>
    </div>
  )
}
