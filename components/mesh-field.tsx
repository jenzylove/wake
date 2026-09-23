"use client"

import React from "react"

// The hero: a network in depth, and a hit spreading through it.
//
// Nodes sit in a three dimensional volume and the whole field turns slowly, so near nodes are
// large, bright and sharp while far ones fall back into the haze. Edges join near neighbours. At
// intervals one node takes a hit and a pulse travels outward along the edges, node to node, fading
// as it goes: exactly what WAKE traces when a protocol is drained or a block hits an exchange.
//
// Drawn on a canvas because a few thousand edges a frame is not an SVG's job. It respects
// prefers-reduced-motion by drawing one still frame.

type Node = { x: number; y: number; z: number; vx: number; vy: number; vz: number }

const COUNT = 150
const LINK = 0.34      // neighbour distance, in the unit volume
const FOV = 1.9
const NEAR = 0.6

export function MeshField({ className }: { className?: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null)
  const pointer = React.useRef({ x: 0, y: 0 })

  React.useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const rand = (() => { let s = 20260922; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) })()
    const nodes: Node[] = Array.from({ length: COUNT }, () => ({
      x: rand() * 2 - 1, y: (rand() * 2 - 1) * 0.62, z: rand() * 2 - 1,
      vx: (rand() - 0.5) * 0.00042, vy: (rand() - 0.5) * 0.00032, vz: (rand() - 0.5) * 0.00042,
    }))
    // Who is near whom, recomputed rarely: the mesh drifts slowly enough that it holds.
    let links: Array<[number, number, number]> = []
    const relink = () => {
      links = []
      for (let i = 0; i < COUNT; i += 1) {
        for (let j = i + 1; j < COUNT; j += 1) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, dz = nodes[i].z - nodes[j].z
          const d = Math.hypot(dx, dy, dz)
          if (d < LINK) links.push([i, j, d])
        }
      }
    }
    relink()

    // A hit lands on one node; the pulse is a growing radius in graph space.
    let hit = { node: Math.floor(rand() * COUNT), at: performance.now() + 1200 }
    const dist = new Float32Array(COUNT)
    const spread = () => {
      dist.fill(Infinity)
      dist[hit.node] = 0
      for (let pass = 0; pass < 6; pass += 1) {
        for (const [i, j, d] of links) {
          if (dist[i] + d < dist[j]) dist[j] = dist[i] + d
          if (dist[j] + d < dist[i]) dist[i] = dist[j] + d
        }
      }
    }
    spread()

    let raf = 0
    let w = 0, h = 0, dpr = 1
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth - 0.5) * 0.5
      pointer.current.y = (e.clientY / window.innerHeight - 0.5) * 0.35
    }
    window.addEventListener("pointermove", onMove)

    let spin = 0
    let lastLink = 0
    const draw = (now: number) => {
      spin += reduced ? 0 : 0.00055
      const cos = Math.cos(spin), sin = Math.sin(spin)
      const tiltX = pointer.current.y, tiltY = pointer.current.x
      ctx.clearRect(0, 0, w, h)

      const px: number[] = [], py: number[] = [], scale: number[] = []
      for (let i = 0; i < COUNT; i += 1) {
        const n = nodes[i]
        if (!reduced) {
          n.x += n.vx; n.y += n.vy; n.z += n.vz
          if (n.x > 1 || n.x < -1) n.vx *= -1
          if (n.y > 0.62 || n.y < -0.62) n.vy *= -1
          if (n.z > 1 || n.z < -1) n.vz *= -1
        }
        // rotate about Y, then tilt with the pointer, then project
        const x1 = n.x * cos - n.z * sin
        const z1 = n.x * sin + n.z * cos
        const y1 = n.y + tiltX * z1
        const x2 = x1 + tiltY * z1
        const k = FOV / (FOV + z1 + NEAR)
        px[i] = w / 2 + x2 * k * w * 0.42
        py[i] = h / 2 + y1 * k * h * 0.72
        scale[i] = k
      }

      const elapsed = (now - hit.at) / 1000
      const front = elapsed * 0.55      // how far the pulse has travelled, in graph distance
      const lit = (d: number) => {
        if (elapsed < 0) return 0
        const band = front - d
        return band < 0 || band > 0.55 ? 0 : (1 - band / 0.55) * Math.max(0, 1 - d / 1.3)
      }

      for (const [i, j, d] of links) {
        const k = (scale[i] + scale[j]) / 2
        const depth = Math.max(0, Math.min(1, (k - 0.55) / 0.85))
        const near = 1 - d / LINK
        const glow = Math.max(lit(dist[i]), lit(dist[j]))
        const alpha = (0.05 + near * 0.16) * (0.25 + depth * 0.9)
        ctx.strokeStyle = glow > 0.01
          ? `rgba(47, 127, 209, ${(alpha + glow * 0.5).toFixed(3)})`
          : `rgba(120, 150, 185, ${alpha.toFixed(3)})`
        ctx.lineWidth = (glow > 0.01 ? 1.5 : 1) * (0.4 + depth)
        ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]); ctx.stroke()
      }

      for (let i = 0; i < COUNT; i += 1) {
        const k = scale[i]
        const depth = Math.max(0, Math.min(1, (k - 0.55) / 0.85))
        const glow = lit(dist[i])
        const r = (0.9 + depth * 2.6) * (1 + glow * 1.5)
        ctx.beginPath(); ctx.arc(px[i], py[i], r, 0, Math.PI * 2)
        ctx.fillStyle = glow > 0.01
          ? `rgba(31, 111, 208, ${(0.35 + glow * 0.6).toFixed(3)})`
          : `rgba(96, 129, 168, ${(0.16 + depth * 0.5).toFixed(3)})`
        ctx.fill()
        if (i === hit.node && elapsed > 0 && elapsed < 3) {
          ctx.beginPath(); ctx.arc(px[i], py[i], r + elapsed * 34, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(31, 111, 208, ${Math.max(0, 0.32 - elapsed * 0.11).toFixed(3)})`
          ctx.lineWidth = 1.2; ctx.stroke()
        }
      }

      if (!reduced) {
        if (elapsed > 9) { hit = { node: Math.floor(Math.random() * COUNT), at: now + 400 }; spread() }
        if (now - lastLink > 2600) { relink(); spread(); lastLink = now }
        raf = requestAnimationFrame(draw)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); window.removeEventListener("pointermove", onMove) }
  }, [])

  return <canvas ref={ref} className={className} aria-hidden="true" />
}
