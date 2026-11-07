import { useMemo } from 'react'

// A jagged bolt from a point on the edge of the screen towards the middle, with one small branch.
// Coordinates are in percent of the screen, from 0 to 100.
function makeBolt() {
  const side = Math.floor(Math.random() * 4) // top, right, bottom, left
  const along = 10 + Math.random() * 80
  let [x, y] = [[along, 0], [100, along], [along, 100], [0, along]][side]
  const target = [30 + Math.random() * 40, 30 + Math.random() * 40]
  const length = 0.35 + Math.random() * 0.25 // how far towards the middle it reaches
  const steps = 9
  const dx = ((target[0] - x) * length) / steps
  const dy = ((target[1] - y) * length) / steps
  const points = [[x, y]]
  for (let i = 0; i < steps; i++) {
    x += dx + (Math.random() - 0.5) * 6
    y += dy + (Math.random() - 0.5) * 6
    points.push([x, y])
  }
  const fork = points[3 + Math.floor(Math.random() * 3)]
  const branch = [fork]
  let [bx, by] = fork
  for (let i = 0; i < 4; i++) {
    bx += dx * 0.8 + (Math.random() - 0.3) * 7
    by += dy * 0.8 + (Math.random() - 0.7) * 7
    branch.push([bx, by])
  }
  const line = (list) => list.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  return { main: line(points), branch: line(branch) }
}

// Plays once each time it is given a new key: a short flash and two or three bolts around the edges.
export default function Lightning() {
  const bolts = useMemo(() => Array.from({ length: 2 + Math.floor(Math.random() * 2) }, makeBolt), [])
  return (
    <div className="lightning" aria-hidden="true">
      <div className="flash" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {bolts.map((b, i) => (
          <g key={i} style={{ animationDelay: `${i * 70}ms` }}>
            <polyline points={b.main} />
            <polyline className="branch" points={b.branch} />
          </g>
        ))}
      </svg>
    </div>
  )
}
