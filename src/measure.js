import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js'
import { distanceToSegment } from './walk.js'

const BAND = 25 // metres on each side of a street
const SQUARE = 50 // size of the squares used to look up nearby streets, in metres
const factory = new GeometryFactory()

function overlaps(a, b) {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
}

function crosses([ax, ay], [bx, by], [cx, cy], [dx, dy]) {
  const side = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px)
  return (
    side(ax, ay, bx, by, cx, cy) > 0 !== side(ax, ay, bx, by, dx, dy) > 0 &&
    side(cx, cy, dx, dy, ax, ay) > 0 !== side(cx, cy, dx, dy, bx, by) > 0
  )
}

function isInsideRing([x, y], ring) {
  let inside = false
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    if (y1 <= y !== y2 <= y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) inside = !inside
  }
  return inside
}

// Sorts street stretches into squares, so a building only has to look at the streets near it.
function indexLines(lines) {
  const squares = new Map()
  for (const line of lines) {
    const [[ax, ay], [bx, by]] = line
    for (let col = Math.floor(Math.min(ax, bx) / SQUARE); col <= Math.floor(Math.max(ax, bx) / SQUARE); col++) {
      for (let row = Math.floor(Math.min(ay, by) / SQUARE); row <= Math.floor(Math.max(ay, by) / SQUARE); row++) {
        const key = `${col},${row}`
        if (!squares.has(key)) squares.set(key, [])
        squares.get(key).push(line)
      }
    }
  }
  return squares
}

// The band is everything within 25 m of a reached street, so a building touches the band
// exactly when its footprint comes within 25 m of one of those streets.
function touchesBand(building, squares) {
  const { minX, maxX, minY, maxY } = building.bounds
  for (let col = Math.floor((minX - BAND) / SQUARE); col <= Math.floor((maxX + BAND) / SQUARE); col++) {
    for (let row = Math.floor((minY - BAND) / SQUARE); row <= Math.floor((maxY + BAND) / SQUARE); row++) {
      for (const [a, b] of squares.get(`${col},${row}`) ?? []) {
        if (isInsideRing(a, building.rings[0])) return true
        for (const ring of building.rings) {
          for (let i = 0; i < ring.length - 1; i++) {
            const p = ring[i]
            const q = ring[i + 1]
            if (
              crosses(a, b, p, q) ||
              distanceToSegment(p, a, b) <= BAND ||
              distanceToSegment(q, a, b) <= BAND ||
              distanceToSegment(a, p, q) <= BAND ||
              distanceToSegment(b, p, q) <= BAND
            ) {
              return true
            }
          }
        }
      }
    }
  }
  return false
}

function toPolygon(rings) {
  const toRing = (ring) => factory.createLinearRing(ring.map(([x, y]) => new Coordinate(x, y)))
  return factory.createPolygon(toRing(rings[0]), rings.slice(1).map(toRing))
}

// Plain lists of points for drawing: each polygon is its outline followed by any holes.
function polygonsOf(shape) {
  const points = (ring) => ring.getCoordinates().map((c) => [c.x, c.y])
  const polygons = []
  for (let g = 0; g < shape.getNumGeometries(); g++) {
    const polygon = shape.getGeometryN(g)
    const rings = [points(polygon.getExteriorRing())]
    for (let h = 0; h < polygon.getNumInteriorRing(); h++) rings.push(points(polygon.getInteriorRingN(h)))
    polygons.push(rings)
  }
  return polygons
}

// Turns the walked stretches into the joined bands, then counts the buildings and residents inside them.
export function measure(city, walked) {
  const tiers = new Uint8Array(city.buildings.length) // 0 = not reached, 1 = within 5 min, 2 = 10, 3 = 15

  const areas = walked.map(({ minutes, lines }) => {
    const streets = factory.createMultiLineString(
      lines.map((l) => factory.createLineString(l.map(([x, y]) => new Coordinate(x, y)))),
    )
    const shape = BufferOp.bufferOp(streets, BAND)
    const box = shape.getEnvelopeInternal()
    const bounds = { minX: box.getMinX(), maxX: box.getMaxX(), minY: box.getMinY(), maxY: box.getMaxY() }

    let residents = 0
    let cellsWithoutFigure = 0
    for (const cell of city.cells) {
      if (!overlaps(cell.bounds, bounds)) continue
      const square = toPolygon(cell.rings)
      const inside = OverlayOp.intersection(square, shape).getArea()
      if (inside <= 0) continue
      if (cell.population === null) cellsWithoutFigure++
      else residents += cell.population * (inside / square.getArea())
    }

    return {
      minutes,
      polygons: polygonsOf(shape),
      area: shape.getArea(),
      residents: Math.round(residents / 10) * 10,
      cellsWithoutFigure,
      buildings: 0,
    }
  })

  // Largest area first. Only a building reached in a longer walk can be reached in a shorter one,
  // and each building ends up tagged with the shortest walk that reaches it.
  for (let a = areas.length - 1; a >= 0; a--) {
    const squares = indexLines(walked[a].lines)
    city.buildings.forEach((building, i) => {
      if ((a === areas.length - 1 || tiers[i] === a + 2) && touchesBand(building, squares)) {
        tiers[i] = a + 1
        areas[a].buildings++
      }
    })
  }
  return { areas, tiers }
}
