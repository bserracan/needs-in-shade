const PIECE_LENGTH = 5 // a street is tested for shade every 5 m
const HEIGHT_CELL = 2 // the building height map has one value per 2 m square
const EYE_HEIGHT = 1.5 // shade is tested at head height

// Turns longitude and latitude into metres around the kit's centre: x east, y north.
function makeProjection([lon0, lat0]) {
  const lat = (lat0 * Math.PI) / 180
  const perLat = 111132.92 - 559.82 * Math.cos(2 * lat) + 1.175 * Math.cos(4 * lat)
  const perLon = 111412.84 * Math.cos(lat) - 93.5 * Math.cos(3 * lat)
  return ([lon, lat]) => [(lon - lon0) * perLon, (lat - lat0) * perLat]
}

function boundsOf(ring) {
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

// Reads the raw kit files into the shapes the rest of the app works with, all in metres.
export function buildCity({ kit, buildings, plots, graph, zensus }) {
  const project = makeProjection(kit.center)

  const buildingList = buildings.features.map((f) => {
    const rings = f.geometry.coordinates.map((ring) => ring.map(project))
    return {
      height: f.properties.height,
      use: f.properties.use ?? 'undefined', // one building has no use recorded
      floorArea: f.properties.floor_area_m2 ?? {},
      rings,
      bounds: boundsOf(rings[0]),
    }
  })

  const cells = zensus.features.map((f) => {
    const rings = f.geometry.coordinates.map((ring) => ring.map(project))
    return {
      population: f.properties.population,
      avgAge: f.properties.avg_age,
      rent: f.properties.rent_eur_m2,
      rings,
      bounds: boundsOf(rings[0]),
    }
  })

  const plotList = (plots?.features ?? []).map((f) => ({
    landuse: f.properties.landuse,
    rings: f.geometry.coordinates.map((ring) => ring.map(project)),
  }))

  const nodeIndex = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const nodes = graph.nodes.map((n) => project([n.lon, n.lat]))
  const links = nodes.map(() => [])

  // Each edge is cut into equal pieces of about 5 m, because the sun can fall on one part of a street and not another.
  const pieceX = []
  const pieceY = []
  const edges = graph.edges
    .filter((e) => e.walkable)
    .map((e, i) => {
      const a = nodeIndex.get(e.from)
      const b = nodeIndex.get(e.to)
      links[a].push({ edge: i, node: b })
      links[b].push({ edge: i, node: a })
      const start = project(e.coords[0])
      const end = project(e.coords[e.coords.length - 1])
      const pieces = Math.max(1, Math.round(e.length / PIECE_LENGTH))
      const firstPiece = pieceX.length
      for (let p = 0; p < pieces; p++) {
        const t = (p + 0.5) / pieces
        pieceX.push(start[0] + (end[0] - start[0]) * t)
        pieceY.push(start[1] + (end[1] - start[1]) * t)
      }
      return { a, b, length: e.length, start, end, firstPiece, pieces, pieceLength: e.length / pieces }
    })

  return {
    center: kit.center,
    kitCorners: [project([kit.bbox[0], kit.bbox[1]]), project([kit.bbox[2], kit.bbox[3]])],
    buildings: buildingList,
    cells,
    plots: plotList,
    nodes,
    links,
    edges,
    pieceX: Float64Array.from(pieceX),
    pieceY: Float64Array.from(pieceY),
    heights: buildHeightMap(buildingList),
    project,
  }
}

// The walkable node closest to a point, in metres.
export function nearestNode(city, [x, y]) {
  let best = null
  let bestDistance = Infinity
  city.nodes.forEach((n, i) => {
    const d = (n[0] - x) ** 2 + (n[1] - y) ** 2
    if (city.links[i].length > 0 && d < bestDistance) {
      best = i
      bestDistance = d
    }
  })
  return best
}

// A grid over the city that holds the height of whatever building stands on each square.
function buildHeightMap(buildings) {
  const margin = 10
  const minX = Math.min(...buildings.map((b) => b.bounds.minX)) - margin
  const minY = Math.min(...buildings.map((b) => b.bounds.minY)) - margin
  const maxX = Math.max(...buildings.map((b) => b.bounds.maxX)) + margin
  const maxY = Math.max(...buildings.map((b) => b.bounds.maxY)) + margin
  const cols = Math.ceil((maxX - minX) / HEIGHT_CELL)
  const rows = Math.ceil((maxY - minY) / HEIGHT_CELL)
  const values = new Float32Array(cols * rows)
  let tallest = 0

  for (const b of buildings) {
    tallest = Math.max(tallest, b.height)
    const firstRow = Math.max(0, Math.floor((b.bounds.minY - minY) / HEIGHT_CELL))
    const lastRow = Math.min(rows - 1, Math.floor((b.bounds.maxY - minY) / HEIGHT_CELL))
    for (let row = firstRow; row <= lastRow; row++) {
      const y = minY + (row + 0.5) * HEIGHT_CELL
      const crossings = []
      for (const ring of b.rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i]
          const [x2, y2] = ring[i + 1]
          if (y1 <= y !== y2 <= y) crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1))
        }
      }
      crossings.sort((p, q) => p - q)
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        const from = Math.ceil((crossings[c] - minX) / HEIGHT_CELL - 0.5)
        const to = Math.floor((crossings[c + 1] - minX) / HEIGHT_CELL - 0.5)
        for (let col = Math.max(0, from); col <= Math.min(cols - 1, to); col++) {
          const at = row * cols + col
          if (b.height > values[at]) values[at] = b.height
        }
      }
    }
  }
  return { values, minX, minY, cols, rows, tallest }
}

// For every street piece: 1 if a building stands between it and the sun, 0 if not.
// Walks from head height towards the sun; the sight line climbs as it goes, and stops once it clears the tallest roof.
export function computeShade(city, sun) {
  const { values, minX, minY, cols, rows, tallest } = city.heights
  const stepX = Math.sin(sun.azimuth) * HEIGHT_CELL
  const stepY = Math.cos(sun.azimuth) * HEIGHT_CELL
  const climb = Math.tan(sun.altitude) * HEIGHT_CELL
  const steps = Math.ceil((tallest - EYE_HEIGHT) / climb)
  const shade = new Uint8Array(city.pieceX.length)

  for (let p = 0; p < shade.length; p++) {
    let x = city.pieceX[p]
    let y = city.pieceY[p]
    let sight = EYE_HEIGHT
    for (let s = 0; s <= steps; s++) {
      const col = Math.floor((x - minX) / HEIGHT_CELL)
      const row = Math.floor((y - minY) / HEIGHT_CELL)
      if (col < 0 || row < 0 || col >= cols || row >= rows) break
      if (values[row * cols + col] > sight) {
        shade[p] = 1
        break
      }
      x += stepX
      y += stepY
      sight += climb
    }
  }
  return shade
}

// How many metres of each edge lie in the sun right now.
export function sunnyMetres(city, shade) {
  return city.edges.map((e) => {
    let sunny = 0
    for (let p = 0; p < e.pieces; p++) if (!shade[e.firstPiece + p]) sunny += e.pieceLength
    return sunny
  })
}

// The share of all street metres in shade right now.
export function shadeShare(city, sunny) {
  const total = city.edges.reduce((sum, e) => sum + e.length, 0)
  return 1 - sunny.reduce((sum, s) => sum + s, 0) / total
}
