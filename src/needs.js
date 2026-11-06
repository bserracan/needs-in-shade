import { nearestNode } from './city.js'
import { MAX_WALK, METRES_PER_MINUTE, distancesFrom } from './walk.js'

export const NEEDS = [
  { key: 'food', use: 'food_and_drink', label: 'Food' },
  { key: 'health', use: 'health', label: 'Health' },
  { key: 'school', use: 'education', label: 'School' },
]

export const TESTS = [
  { key: 'within15', label: 'Over 15 min' },
  { key: 'within5', label: 'Over 5 min' },
  { key: 'shady', label: 'No shady way' },
]

const MIN_FLOOR_AREA = 50 // m² of a use before a building counts as a place for it, unless it is the main use
const MAX_SUN = 100 // metres in full sun that a walk may have and still count as a shady way
const HOME_SPLIT = 5 // each census cell is split 5 × 5, so homes in one cell can have different walks
const EDGE_ZONE = 100 // metres from the kit's edge

function centreOf(ring) {
  const points = ring.slice(0, -1)
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
}

// Finds the buildings that serve each need, and where the residents of each census cell are.
export function buildNeeds(city) {
  const places = {}
  const needOfBuilding = new Array(city.buildings.length).fill(null)
  for (const need of NEEDS) {
    places[need.key] = []
    city.buildings.forEach((b, i) => {
      if (b.use !== need.use && (b.floorArea[need.use] ?? 0) < MIN_FLOOR_AREA) return
      places[need.key].push({ building: i, node: nearestNode(city, centreOf(b.rings[0])) })
      // A building with more than one need takes the colour of the one with the most floor area.
      const current = needOfBuilding[i]
      const currentUse = NEEDS.find((n) => n.key === current)?.use
      if (!current || (b.floorArea[need.use] ?? 0) > (b.floorArea[currentUse] ?? 0)) needOfBuilding[i] = need.key
    })
  }

  const nearest = {}
  for (const need of NEEDS) nearest[need.key] = distancesFrom(city, places[need.key].map((p) => p.node))

  const homes = []
  city.cells.forEach((cell, c) => {
    if (cell.population === null) return
    const { minX, maxX, minY, maxY } = cell.bounds
    for (let i = 0; i < HOME_SPLIT; i++) {
      for (let j = 0; j < HOME_SPLIT; j++) {
        const x = minX + ((i + 0.5) * (maxX - minX)) / HOME_SPLIT
        const y = minY + ((j + 0.5) * (maxY - minY)) / HOME_SPLIT
        homes.push({ node: nearestNode(city, [x, y]), cell: c, residents: cell.population / HOME_SPLIT ** 2 })
      }
    }
  })

  const cellsLeftOut = city.cells.filter((c) => c.population === null).length
  const nodeOfBuilding = new Map(NEEDS.flatMap((need) => places[need.key].map((p) => [p.building, p.node])))
  return { places, needOfBuilding, nodeOfBuilding, nearest, homes, cellsLeftOut }
}

class Queue {
  items = []
  push(item) {
    const items = this.items
    let i = items.push(item) - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].length <= item.length) break
      items[i] = items[parent]
      i = parent
    }
    items[i] = item
  }
  pop() {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length > 0) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= items.length) break
        if (child + 1 < items.length && items[child + 1].length < items[child].length) child++
        if (items[child].length >= last.length) break
        items[i] = items[child]
        i = child
      }
      items[i] = last
    }
    return top
  }
  get size() {
    return this.items.length
  }
}

// Explores every way out from the sources up to 15 minutes, shortest first. A longer way to a node is only
// worth keeping if it has less sun than every shorter way there. So for each node, the first way found is
// the fastest, and the last way found is the one with the least sun that still fits in 15 minutes.
export function searchWalks(city, sources, sunny) {
  const fastest = new Array(city.nodes.length).fill(null)
  const shadiest = new Array(city.nodes.length).fill(null)
  const queue = new Queue()
  for (const node of new Set(sources)) queue.push({ node, length: 0, sun: 0, previous: null, edge: null })

  while (queue.size > 0) {
    const way = queue.pop()
    const known = shadiest[way.node]
    if (known && way.sun >= known.sun) continue
    if (!known) fastest[way.node] = way
    shadiest[way.node] = way
    for (const link of city.links[way.node]) {
      const edge = city.edges[link.edge]
      const length = way.length + edge.length
      if (length <= MAX_WALK) {
        queue.push({ node: link.node, length, sun: way.sun + sunny[link.edge], previous: way, edge })
      }
    }
  }
  return { fastest, shadiest }
}

function describeWay(city, way) {
  const points = []
  for (let w = way; w; w = w.previous) points.push(city.nodes[w.node])
  points.reverse()
  return { points, node: way.node, minutes: way.length / METRES_PER_MINUTE, metres: way.length, sun: way.sun }
}

// From the clicked start: for each need, how many places lie within 15 minutes, the fastest way to the nearest
// of them, and the way to any of them with the least sun.
export function waysToNeeds(city, needs, start, sunny) {
  const { fastest, shadiest } = searchWalks(city, [start], sunny)
  return NEEDS.map((need) => {
    let quickest = null
    let leastSun = null
    let count = 0
    for (const place of needs.places[need.key]) {
      const quick = fastest[place.node]
      const shady = shadiest[place.node]
      if (!quick) continue
      count++
      if (!quickest || quick.length < quickest.length) quickest = quick
      if (!leastSun || shady.sun < leastSun.sun || (shady.sun === leastSun.sun && shady.length < leastSun.length)) {
        leastSun = shady
      }
    }
    return {
      ...need,
      count,
      fastest: quickest && describeWay(city, quickest),
      shadiest: leastSun && describeWay(city, leastSun),
    }
  })
}

// The fastest and the shadiest way from the start to one chosen place, if it is within 15 minutes.
export function waysToPlace(city, start, node, sunny) {
  const { fastest, shadiest } = searchWalks(city, [start], sunny)
  if (!fastest[node]) return { fastest: null, shadiest: null }
  return { fastest: describeWay(city, fastest[node]), shadiest: describeWay(city, shadiest[node]) }
}

// For each need and each test: how many residents miss out, which cells they are in, and who they are.
export function whoMissesOut(city, needs, sunny) {
  const weighted = (homes) => {
    let age = 0
    let ageWeight = 0
    let rent = 0
    let rentWeight = 0
    for (const home of homes) {
      const cell = city.cells[home.cell]
      if (cell.avgAge !== null) {
        age += cell.avgAge * home.residents
        ageWeight += home.residents
      }
      if (cell.rent !== null) {
        rent += cell.rent * home.residents
        rentWeight += home.residents
      }
    }
    return { avgAge: ageWeight ? age / ageWeight : null, avgRent: rentWeight ? rent / rentWeight : null }
  }

  // Places just outside the kit aren't in the data, so people in cells near its edge may only seem to miss out.
  const [[west, south], [east, north]] = city.kitCorners
  const nearEdge = ({ bounds }) =>
    bounds.minX < west + EDGE_ZONE || bounds.maxX > east - EDGE_ZONE || bounds.minY < south + EDGE_ZONE || bounds.maxY > north - EDGE_ZONE

  const result = { everyone: weighted(needs.homes), table: {} }
  for (const need of NEEDS) {
    const nearest = needs.nearest[need.key]
    const { shadiest } = searchWalks(city, needs.places[need.key].map((p) => p.node), sunny)
    const missing = {
      within15: (home) => nearest[home.node] > MAX_WALK,
      within5: (home) => nearest[home.node] > 5 * METRES_PER_MINUTE,
      shady: (home) => !shadiest[home.node] || shadiest[home.node].sun > MAX_SUN,
    }
    result.table[need.key] = {}
    for (const test of TESTS) {
      const homes = needs.homes.filter(missing[test.key])
      const total = homes.reduce((sum, h) => sum + h.residents, 0)
      const byCell = new Map()
      for (const home of homes) byCell.set(home.cell, (byCell.get(home.cell) ?? 0) + 1 / HOME_SPLIT ** 2)
      const atEdge = homes.filter((h) => nearEdge(city.cells[h.cell])).reduce((sum, h) => sum + h.residents, 0)
      result.table[need.key][test.key] = {
        residents: Math.round(total / 10) * 10,
        edgeShare: total ? atEdge / total : 0,
        byCell,
        ...weighted(homes),
      }
    }
  }
  return result
}
