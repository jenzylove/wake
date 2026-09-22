"use client"

import React from "react"

// The hero: a market tape, and the moment an event lands on it.
//
// A price line runs left to right. At the event, a ring opens from the chain beneath the tape and
// meets the price; the part of the move the market had already made is drawn flat, and the part
// left over is the only thing WAKE would trade. Blocks tick along the base. Nothing here is
// decorative biology: every mark stands for something the agent looks at.

type Props = { className?: string }

const W = 1200
const H = 620
const BASE = 470          // the price line's resting level
const EVENT_X = 700       // where the event lands

// A deterministic walk, so the server and the client draw the same line.
function tape(seed = 7) {
  let s = seed
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5)
  const pts: Array<[number, number]> = []
  let y = BASE
  for (let x = 0; x <= W; x += 10) {
    const drift = x > EVENT_X ? 0.55 : 0 // the event tilts the tape down after it lands
    y += rand() * 13 + drift
    const settle = (BASE - y) * 0.06
    y += settle
    pts.push([x, y])
  }
  return pts
}

const path = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")

export function ImpactTape({ className }: Props) {
  const pts = React.useMemo(() => tape(), [])
  const before = pts.filter(([x]) => x <= EVENT_X)
  const after = pts.filter(([x]) => x >= EVENT_X)
  const eventY = before[before.length - 1][1]
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img"
      aria-label="A price tape with an on-chain event landing on it, the priced part of the move and the part left over">
      <defs>
        <linearGradient id="tapeFade" x1="0" x2="1">
          <stop offset="0" stopColor="#8aa3bd" stopOpacity="0" />
          <stop offset="0.18" stopColor="#8aa3bd" stopOpacity=".85" />
          <stop offset="1" stopColor="#8aa3bd" stopOpacity=".85" />
        </linearGradient>
        <linearGradient id="residual" x1="0" x2="1">
          <stop offset="0" stopColor="#1f6fd0" />
          <stop offset="1" stopColor="#1f6fd0" stopOpacity=".15" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%">
          <stop offset="0" stopColor="#1f6fd0" stopOpacity=".16" />
          <stop offset="100%" stopColor="#1f6fd0" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width={W} height={H} fill="none" />
      <g stroke="#dbe4ee" strokeWidth="1">
        {[0, 1, 2, 3, 4].map((i) => <line key={i} x1="0" x2={W} y1={200 + i * 90} y2={200 + i * 90} />)}
      </g>

      <circle cx={EVENT_X} cy={eventY} r="250" fill="url(#glow)" />

      {/* the tape before the event, and after it */}
      <path d={path(before)} fill="none" stroke="url(#tapeFade)" strokeWidth="2.4" strokeLinecap="round" />
      <path d={path(after)} fill="none" stroke="url(#residual)" strokeWidth="3" strokeLinecap="round" />

      {/* the event: a ring opening from the chain below and meeting the price */}
      <g>
        {[0, 1, 2].map((i) => (
          <circle key={i} cx={EVENT_X} cy={eventY} r="26" fill="none" stroke="#1f6fd0" strokeWidth="1.6" strokeOpacity=".5">
            {!reduced && <>
              <animate attributeName="r" values="26;190" dur="4.2s" begin={`${i * 1.4}s`} repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values=".5;0" dur="4.2s" begin={`${i * 1.4}s`} repeatCount="indefinite" />
            </>}
          </circle>
        ))}
        <line x1={EVENT_X} y1={eventY} x2={EVENT_X} y2={H - 96} stroke="#1f6fd0" strokeWidth="1.4" strokeDasharray="3 6" strokeOpacity=".55" />
        <circle cx={EVENT_X} cy={eventY} r="6" fill="#1f6fd0" />
      </g>

      {/* what the market already did, and what is left */}
      <g fontFamily="var(--mono)" fontSize="13" fill="#5b6e85">
        <line x1={EVENT_X} y1={eventY + 54} x2={EVENT_X + 150} y2={eventY + 54} stroke="#8aa3bd" strokeWidth="1.2" />
        <text x={EVENT_X + 8} y={eventY + 44}>already priced</text>
        <line x1={EVENT_X + 150} y1={eventY + 54} x2={W - 90} y2={eventY + 54} stroke="#1f6fd0" strokeWidth="1.6" />
        <text x={EVENT_X + 158} y={eventY + 44} fill="#1f6fd0">what is left to trade</text>
      </g>

      {/* blocks arriving underneath: the chain WAKE reads */}
      <g transform={`translate(0 ${H - 74})`}>
        {Array.from({ length: 40 }, (_, i) => (
          <rect key={i} x={i * 30} y={i % 7 === 0 ? 0 : 6} width="12" height={i % 7 === 0 ? 20 : 12} rx="2"
            fill={i * 30 > EVENT_X ? "#1f6fd0" : "#b9c8d8"} fillOpacity={i * 30 > EVENT_X ? ".55" : ".7"}>
            {!reduced && <animate attributeName="fill-opacity" values=".25;.8;.25" dur="3s" begin={`${(i % 10) * 0.3}s`} repeatCount="indefinite" />}
          </rect>
        ))}
      </g>
    </svg>
  )
}
