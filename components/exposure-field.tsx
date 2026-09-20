"use client"

import * as React from "react"

// The hero's subject: an exposure field.
//
// One contract breaks, and the damage travels. A dense core (the protocol that was hit) is wired
// to a halo of dependent contracts, and every few seconds a shock leaves the core and lights the
// edges it can actually reach. It is WAKE's whole question in one image: the hit is obvious, the
// path is not. Drawn on a canvas so the motion stays cheap, still under reduced motion.

type Node = { x: number; y: number; z: number; r: number; core: boolean; seed: number }

const NODES = 260
const REACH = 0.17        // neighbour radius in normalized units
const MAX_EDGES = 3

export function ExposureField({ className }: { className?: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let frame = 0
    let width = 0
    let height = 0

    // A blob: dense in the middle, thinning outwards, squashed into an ellipse.
    const rand = (() => { let s = 20260920; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) })()
    const nodes: Node[] = Array.from({ length: NODES }, (_, i) => {
      const t = rand()
      const radius = Math.pow(t, 0.62)
      const angle = rand() * Math.PI * 2
      const tilt = (rand() - 0.5) * 0.9
      return {
        x: Math.cos(angle) * radius * 1.16,
        y: Math.sin(angle) * radius * 0.62 + tilt * radius * 0.28,
        z: (rand() - 0.5) * 0.7,
        r: 0.7 + rand() * 1.7,
        core: radius < 0.34,
        seed: i * 0.37,
      }
    })

    // Wire each node to a few near neighbours; that is the exposure graph.
    const edges: Array<[number, number, number]> = []
    for (let i = 0; i < nodes.length; i += 1) {
      const near = nodes
        .map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) }))
        .filter((n) => n.j !== i && n.d < REACH)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_EDGES)
      for (const n of near) if (i < n.j) edges.push([i, n.j, n.d])
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const draw = (time: number) => {
      const t = reduced ? 6200 : time
      const cx = width * 0.5
      const cy = height * 0.5
      const scale = Math.min(width * 0.72, height) * 0.86
      ctx.clearRect(0, 0, width, height)

      // Shock front: a ring of influence leaving the core every eight seconds.
      const wave = (t % 8000) / 8000
      const front = wave * 1.35

      const px = (n: Node) => cx + n.x * scale * (1 + n.z * 0.12) + Math.sin(t / 3400 + n.seed) * 3
      const py = (n: Node) => cy + n.y * scale * (1 + n.z * 0.12) + Math.cos(t / 3900 + n.seed) * 3

      // The core glow: the protocol that was hit.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.9)
      glow.addColorStop(0, "rgba(120, 175, 245, 0.30)")
      glow.addColorStop(0.35, "rgba(70, 125, 200, 0.14)")
      glow.addColorStop(0.7, "rgba(40, 80, 140, 0.05)")
      glow.addColorStop(1, "rgba(7, 8, 11, 0)")
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.ellipse(cx, cy, scale * 1.15, scale * 0.78, 0, 0, Math.PI * 2)
      ctx.fill()

      // Filaments crossing the frame: market data arriving from outside the incident.
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2 + t / 90_000
        const len = Math.max(width, height)
        const ox = cx + Math.cos(a) * len
        const oy = cy + Math.sin(a) * len * 0.55
        ctx.strokeStyle = "rgba(122, 158, 205, 0.10)"
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(ox, oy)
        ctx.stroke()
        // A packet travelling in along the filament.
        const travel = ((t / 5200 + i / 7) % 1)
        const dx = cx + Math.cos(a) * len * (1 - travel) * 0.55
        const dy = cy + Math.sin(a) * len * 0.55 * (1 - travel) * 0.55
        ctx.fillStyle = `rgba(90, 143, 214, ${(0.5 * travel).toFixed(2)})`
        ctx.beginPath()
        ctx.arc(dx, dy, 1.6, 0, Math.PI * 2)
        ctx.fill()
      }

      // Edges first, brightened as the front passes over them.
      for (const [a, b, d] of edges) {
        const na = nodes[a]
        const nb = nodes[b]
        const mid = Math.hypot((na.x + nb.x) / 2, (na.y + nb.y) / 2)
        const hit = Math.max(0, 1 - Math.abs(mid - front) * 7)
        const base = 0.05 + (1 - d / REACH) * 0.09
        ctx.strokeStyle = hit > 0.02
          ? `rgba(78, 208, 150, ${(base + hit * 0.55).toFixed(3)})`
          : `rgba(140, 180, 230, ${(base * 1.6).toFixed(3)})`
        ctx.lineWidth = hit > 0.02 ? 0.9 : 0.6
        ctx.beginPath()
        ctx.moveTo(px(na), py(na))
        ctx.lineTo(px(nb), py(nb))
        ctx.stroke()
      }

      // Nodes.
      for (const n of nodes) {
        const rad = Math.hypot(n.x, n.y)
        const hit = Math.max(0, 1 - Math.abs(rad - front) * 6)
        const x = px(n)
        const y = py(n)
        const size = n.r * (1 + hit * 0.7)
        if (n.core) {
          ctx.fillStyle = `rgba(226, 240, 255, ${0.72 + hit * 0.28})`
        } else {
          ctx.fillStyle = hit > 0.05 ? `rgba(78, 208, 150, ${0.45 + hit * 0.5})` : "rgba(168, 196, 232, 0.42)"
        }
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()
      }

      if (!reduced) frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
