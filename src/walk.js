import { nearestNode } from './city.js'

export const MINUTES = [5, 10, 15]
export const METRES_PER_MINUTE = 80 // 4.8 km/h
export const MAX_WALK = 15 * METRES_PER_MINUTE
const MAX_START_DISTANCE = 100 // metres from the click to the nearest street

export function distanceToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

// Finds the node to start from, or null if no walkable street is within 100 m of the click.
export function findStart(city, point) {
  const nearestStreet = Math.min(...city.edges.map((e) => distanceToSegment(point, e.start, e.end)))
  return nearestStreet > MAX_START_DISTANCE ? null : nearestNode(city, point)
}

// The shortest walking distance from any of the source nodes to every node (Dijkstra's method).
export function distancesFrom(city, sources) {
  const best = new Float64Array(city.nodes.length).fill(Infinity)
  const done = new Uint8Array(city.nodes.length)
  for (const s of sources) best[s] = 0
  for (;;) {
    let node = -1
    for (let i = 0; i < best.length; i++) {
      if (!done[i] && best[i] !== Infinity && (node < 0 || best[i] < best[node])) node = i
    }
    if (node < 0) return best
    done[node] = 1
    for (const link of city.links[node]) {
      const through = best[node] + city.edges[link.edge].length
      if (through < best[link.node]) best[link.node] = through
    }
  }
}

function pointAlong(edge, metres) {
  const t = metres / edge.length
  return [edge.start[0] + (edge.end[0] - edge.start[0]) * t, edge.start[1] + (edge.end[1] - edge.start[1]) * t]
}

// For 5, 10 and 15 minutes: the street stretches reached from the start, including the reachable part of the last edge.
export function walk(city, start) {
  const best = distancesFrom(city, [start])
  return MINUTES.map((minutes) => {
    const allowance = minutes * METRES_PER_MINUTE
    const lines = []
    const add = (edge, from, to) => {
      if (to > from) lines.push([pointAlong(edge, from), pointAlong(edge, to)])
    }
    for (const e of city.edges) {
      const fromA = Math.min(e.length, Math.max(0, allowance - best[e.a]))
      const fromB = Math.min(e.length, Math.max(0, allowance - best[e.b]))
      if (fromA + fromB >= e.length) {
        add(e, 0, e.length)
      } else {
        add(e, 0, fromA)
        add(e, e.length - fromB, e.length)
      }
    }
    return { minutes, lines }
  })
}
