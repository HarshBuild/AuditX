/**
 * Ashoka-Chakra-inspired loader — 24 spokes in navy blue, slow rotation.
 * Used for government-grade progress moments (e.g. label analysis).
 * Decorative only (aria-hidden); pair with a text label for screen readers.
 */
export default function ChakraLoader({ size = 40 }: { size?: number }) {
  const spokes = Array.from({ length: 24 }, (_, i) => (i * 15 * Math.PI) / 180)
  const rOuter = 44
  const rInner = 34
  const c = 50
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="animate-spin text-[#1e3fae] dark:text-[#7aa2ff]"
      style={{ animationDuration: '3s' }}
    >
      <circle cx={c} cy={c} r={rOuter} fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx={c} cy={c} r={7} fill="currentColor" />
      {spokes.map((a, i) => (
        <line
          key={i}
          x1={c + rInner * Math.cos(a)}
          y1={c + rInner * Math.sin(a)}
          x2={c + rOuter * Math.cos(a)}
          y2={c + rOuter * Math.sin(a)}
          stroke="currentColor"
          strokeWidth="2.4"
        />
      ))}
    </svg>
  )
}
