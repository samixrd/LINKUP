/**
 * Decorative sticker doodles (hand-rolled inline SVG, no dependencies) that
 * echo the reference design's playful collage elements. All are aria-hidden.
 */

export function SmileySticker({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="27" fill="var(--yellow)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="22" cy="26" r="4" fill="var(--ink)" />
      <circle cx="42" cy="26" r="4" fill="var(--ink)" />
      <path d="M19 39 Q32 51 45 39" fill="none" stroke="var(--ink)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

export function StarSticker({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d="M24 2 L29.5 18.5 L46 24 L29.5 29.5 L24 46 L18.5 29.5 L2 24 L18.5 18.5 Z"
        fill="var(--accent)"
        stroke="var(--ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function QrSticker({ className }: { className?: string }) {
  const cells: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [2, 0],
    [4, 0],
    [0, 1],
    [2, 1],
    [3, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [4, 2],
    [1, 3],
    [3, 3],
    [0, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ]
  return (
    <svg className={className} viewBox="0 0 60 60" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="58" height="58" fill="var(--pink)" stroke="var(--ink)" strokeWidth="2" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={8 + x * 9} y={8 + y * 9} width="7" height="7" fill="var(--ink)" />
      ))}
    </svg>
  )
}

/** Curly green arrow used next to the "start here" hand note. */
export function HandArrow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 90 56" aria-hidden="true" focusable="false">
      <path
        d="M6 6 C 22 42, 52 52, 76 34"
        fill="none"
        stroke="var(--green)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M66 30 L78 33 L71 44"
        fill="none"
        stroke="var(--green)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
