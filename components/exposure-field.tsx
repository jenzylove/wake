"use client"

import * as React from "react"

// The hero's subject: an exposure field.
//
// A translucent body with a vein structure running through it. The body is the protocol that was
// hit; the veins are the paths the loss can travel along; the filaments crossing the frame are
// market data arriving from outside. Every few seconds a pulse runs the veins, which is the
// question WAKE exists to answer: the hit is obvious, the path is not.
//
// Body and veins are SVG, so the gradients and soft edges hold at any size. The filaments and
// their travelling packets are canvas, because they move. Both stand still under reduced motion.

type Branch = { d: string; width: number; depth: number }

// A deterministic vein tree, grown from the centre outwards.
function growVeins(): Branch[] {
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const out: Branch[] = []
  const grow = (x: number, y: number, angle: number, len: number, width: number, depth: number) => {
    if (depth > 5 || len < 6) return
    const spread = (rand() - 0.5) * 0.7
    const cx = x + Math.cos(angle) * len * 0.5
    const cy = y + Math.sin(angle) * len * 0.5 + spread * len * 0.35
    const nx = x + Math.cos(angle) * len
    const ny = y + Math.sin(angle) * len
    out.push({ d: `M ${x.toFixed(1)} ${y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`, width, depth })
    const forks = depth < 2 ? 3 : 2
    for (let i = 0; i < forks; i += 1) {
      grow(nx, ny, angle + (rand() - 0.5) * 1.15, len * (0.58 + rand() * 0.2), width * 0.62, depth + 1)
    }
  }
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2 + rand() * 0.5
    grow(500, 300, angle, 52 + rand() * 34, 3.1, 0)
  }
  return out
}

export function ExposureField({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const veins = React.useMemo(growVeins, [])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let frame = 0
    let width = 0
    let height = 0

    let seed = 91
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const filaments = Array.from({ length: 18 }, () => ({
      y: rand(),
      slope: (rand() - 0.5) * 0.55,
      bow: (rand() - 0.5) * 0.22,
      speed: 0.45 + rand() * 0.9,
      offset: rand(),
      warm: rand() > 0.42,
    }))

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
      const t = reduced ? 4000 : time
      ctx.clearRect(0, 0, width, height)

      for (const f of filaments) {
        const y0 = f.y * height
        const y1 = y0 + f.slope * height
        const ctrlY = (y0 + y1) / 2 + f.bow * height
        ctx.strokeStyle = f.warm ? "rgba(236, 110, 168, 0.32)" : "rgba(118, 146, 224, 0.28)"
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(-40, y0)
        ctx.quadraticCurveTo(width * 0.5, ctrlY, width + 40, y1)
        ctx.stroke()

        // Packets riding the filament, brightest as they pass the body.
        for (let k = 0; k < 3; k += 1) {
          const p = ((t / 9000) * f.speed + f.offset + k / 3) % 1
          const x = -40 + p * (width + 80)
          const y = (1 - p) * (1 - p) * y0 + 2 * (1 - p) * p * ctrlY + p * p * y1
          const near = 1 - Math.min(1, Math.abs(x - width * 0.5) / (width * 0.5))
          ctx.fillStyle = f.warm
            ? `rgba(233, 84, 150, ${(0.25 + near * 0.5).toFixed(2)})`
            : `rgba(88, 124, 216, ${(0.22 + near * 0.45).toFixed(2)})`
          ctx.beginPath()
          ctx.arc(x, y, 1.5 + near * 1.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      if (!reduced) frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [])

  return (
    <div className={className} aria-hidden="true">
      <svg className="wkc-body" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="wkc-core" cx="46%" cy="42%" r="62%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
            <stop offset="28%" stopColor="#cdeef7" stopOpacity="0.93" />
            <stop offset="58%" stopColor="#82cbe4" stopOpacity="0.8" />
            <stop offset="84%" stopColor="#5aa7d6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#4a86c8" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="wkc-deep" cx="52%" cy="56%" r="48%">
            <stop offset="0%" stopColor="#2f7fb8" stopOpacity="0.36" />
            <stop offset="70%" stopColor="#3f8fc4" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="wkc-sheen" cx="34%" cy="26%" r="34%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="wkc-vein" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f4fd4" />
            <stop offset="55%" stopColor="#3b63c8" />
            <stop offset="100%" stopColor="#2f8fc0" />
          </linearGradient>
          <filter id="wkc-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="11" />
          </filter>
          <filter id="wkc-veinglow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <g className="wkc-drift">
          <ellipse cx="500" cy="300" rx="300" ry="214" fill="url(#wkc-core)" filter="url(#wkc-soft)" />
          <ellipse cx="516" cy="318" rx="214" ry="150" fill="url(#wkc-deep)" filter="url(#wkc-soft)" />

          <g filter="url(#wkc-veinglow)">
            {veins.map((b, i) => (
              <path
                key={i}
                d={b.d}
                stroke="url(#wkc-vein)"
                strokeWidth={b.width}
                strokeLinecap="round"
                fill="none"
                className="wkc-vein"
                style={{ opacity: 0.92 - b.depth * 0.12, animationDelay: `${(b.depth * 0.4 + (i % 7) * 0.08).toFixed(2)}s` }}
              />
            ))}
          </g>

          <ellipse cx="428" cy="222" rx="118" ry="74" fill="url(#wkc-sheen)" filter="url(#wkc-soft)" />
          <ellipse cx="500" cy="300" rx="300" ry="214" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.2" filter="url(#wkc-soft)" />
        </g>
      </svg>
      <canvas ref={canvasRef} className="wkc-filaments" />
    </div>
  )
}
