import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GROUND, OUTSIDE, PLOT_LINE, REACH, STREET_SHADE, STREET_SUN, USE_GROUPS } from './palette.js'

const SUN_DISTANCE = 2500 // far enough to light the whole kit
const SHADOW_REACH = 1400 // half the width of the area that gets shadows, in metres
const SHADOW_COLOR = '#2c3550'
const SHADOW_STRENGTH = 0.1 // how dark shadows are: 10% shadow colour, 90% see-through

// Metres in the app are x east, y north. In the 3D scene y is up, so north becomes -z.

const toColors = (tones) => ({
  roof: new THREE.Color(tones.roof),
  wall: new THREE.Color(tones.wall),
  shade: new THREE.Color(tones.shade),
})

const groupTones = new Map(USE_GROUPS.map((g) => [g.key, toColors(g.tones)]))
const useTones = new Map(USE_GROUPS.flatMap((g) => g.uses.map((u) => [u, groupTones.get(g.key)])))
const reachTones = REACH.map(toColors)
const sunStreet = new THREE.Color(STREET_SUN)
const shadeStreet = new THREE.Color(STREET_SHADE)

// All buildings merged into one mesh, with thin white lines on every edge, so orbiting stays smooth.
// `faces` remembers which vertices belong to which face of which building, so faces can be recoloured.
function buildingGeometry(buildings) {
  const positions = []
  const lines = []
  const faces = []

  const vertex = (p, h) => positions.push(p.x, h, -p.y)
  const line = (p, ph, q, qh) => lines.push(p.x, ph, -p.y, q.x, qh, -q.y)

  buildings.forEach((b, building) => {
    // Each ring without its repeated last point: outlines anticlockwise, holes clockwise, so walls face outwards.
    const rings = b.rings.map((ring, r) => {
      const points = ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))
      return (r === 0) === THREE.ShapeUtils.isClockWise(points) ? points.reverse() : points
    })

    for (const ring of rings) {
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]
        const length = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const first = positions.length / 3
        vertex(p, 0)
        vertex(q, 0)
        vertex(q, b.height)
        vertex(p, 0)
        vertex(q, b.height)
        vertex(p, b.height)
        // The wall's outward direction, in the scene's x and z.
        faces.push({ building, first, count: 6, nx: (q.y - p.y) / length, nz: (q.x - p.x) / length })
        line(p, b.height, q, b.height)
        line(p, 0, q, 0)
        line(p, 0, p, b.height)
      })
    }

    const first = positions.length / 3
    const all = rings.flat()
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
      const [p, q, r] = [all[i], all[j], all[k]]
      const anticlockwise = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0
      for (const v of anticlockwise ? [p, q, r] : [p, r, q]) vertex(v, b.height)
    }
    faces.push({ building, first, count: positions.length / 3 - first, roof: true })
  })

  const mesh = new THREE.BufferGeometry()
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  mesh.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3))
  mesh.computeVertexNormals()
  const outline = new THREE.BufferGeometry()
  outline.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
  return { mesh, outline, faces }
}

// Which building a triangle of the merged mesh belongs to.
function buildingAt(faces, triangle) {
  const vertex = triangle * 3
  let low = 0
  let high = faces.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (faces[middle].first <= vertex) low = middle
    else high = middle - 1
  }
  return faces[low].building
}

function Buildings({ city, needOfBuilding, tiers, sunDir, onPick }) {
  const invalidate = useThree((s) => s.invalidate)
  const { mesh, outline, faces } = useMemo(() => buildingGeometry(city.buildings), [city])

  // Roofs take the lightest tone. Walls facing the sun take the base colour, the others the darker shade.
  useEffect(() => {
    const colors = mesh.attributes.color
    for (const face of faces) {
      const b = city.buildings[face.building]
      const need = needOfBuilding[face.building]
      const tier = tiers ? tiers[face.building] : 0
      const tones = need ? groupTones.get(need) : tier ? reachTones[tier - 1] : useTones.get(b.use)
      const lit = !face.roof && face.nx * sunDir[0] + face.nz * sunDir[2] > 0
      const color = face.roof ? tones.roof : lit ? tones.wall : tones.shade
      for (let v = face.first; v < face.first + face.count; v++) colors.setXYZ(v, color.r, color.g, color.b)
    }
    colors.needsUpdate = true
    invalidate()
  }, [city, mesh, faces, needOfBuilding, tiers, sunDir, invalidate])

  return (
    <>
      <mesh geometry={mesh} castShadow onClick={(event) => onPick(event, buildingAt(faces, event.faceIndex))}>
        <meshBasicMaterial vertexColors polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      {/* The colours stay flat, so a see-through copy on top shows the shadows falling on other buildings. */}
      <mesh geometry={mesh} receiveShadow renderOrder={1}>
        <shadowMaterial color={SHADOW_COLOR} opacity={SHADOW_STRENGTH} depthWrite={false} />
      </mesh>
      <lineSegments geometry={outline}>
        <lineBasicMaterial color="#ffffff" />
      </lineSegments>
    </>
  )
}

function shapesOf(polygons) {
  const toPoints = (ring) => ring.map(([x, y]) => new THREE.Vector2(x, y))
  return polygons.map((rings) => {
    const shape = new THREE.Shape(toPoints(rings[0]))
    shape.holes = rings.slice(1).map((ring) => new THREE.Path(toPoints(ring)))
    return shape
  })
}

// Pale ground from the plots: lawn by default, with parks, squares and water told apart, and thin green plot lines.
function Ground({ plots }) {
  const { layers, lines } = useMemo(() => {
    const byColor = new Map()
    const points = []
    for (const plot of plots) {
      const color = GROUND[plot.landuse] ?? GROUND.default
      if (!byColor.has(color)) byColor.set(color, [])
      byColor.get(color).push(plot.rings)
      for (const ring of plot.rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          points.push(ring[i][0], 0.1, -ring[i][1], ring[i + 1][0], 0.1, -ring[i + 1][1])
        }
      }
    }
    return {
      layers: [...byColor].map(([color, polygons]) => ({ color, geometry: new THREE.ShapeGeometry(shapesOf(polygons)) })),
      lines: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
    }
  }, [plots])

  return (
    <>
      {layers.map(({ color, geometry }) => (
        <mesh key={color} geometry={geometry} rotation-x={-Math.PI / 2} position-y={0.05}>
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={PLOT_LINE} />
      </lineSegments>
    </>
  )
}

// The network drawn thin: white where a street is in the sun, slate where it is in shade.
function Streets({ city, shade }) {
  const invalidate = useThree((s) => s.invalidate)
  const geometry = useMemo(() => {
    const positions = []
    for (const e of city.edges) {
      for (let p = 0; p < e.pieces; p++) {
        const [t0, t1] = [p / e.pieces, (p + 1) / e.pieces]
        positions.push(
          e.start[0] + (e.end[0] - e.start[0]) * t0, 1.2, -(e.start[1] + (e.end[1] - e.start[1]) * t0),
          e.start[0] + (e.end[0] - e.start[0]) * t1, 1.2, -(e.start[1] + (e.end[1] - e.start[1]) * t1),
        )
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3))
    return g
  }, [city])

  useEffect(() => {
    const colors = geometry.attributes.color
    for (let p = 0; p < shade.length; p++) {
      const c = shade[p] ? shadeStreet : sunStreet
      colors.setXYZ(p * 2, c.r, c.g, c.b)
      colors.setXYZ(p * 2 + 1, c.r, c.g, c.b)
    }
    colors.needsUpdate = true
    invalidate()
  }, [geometry, shade, invalidate])

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  )
}

function FlatShape({ polygons, color, opacity, height }) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(shapesOf(polygons)), [polygons])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} rotation-x={-Math.PI / 2} position-y={height} renderOrder={2}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

const lift = (points) => points.map(([x, y]) => [x, 3, -y])

// The shadiest way as a solid line with a white edge, the fastest way as a thin dashed line.
function Route({ way, color, dashed }) {
  if (!way || way.points.length < 2) return null
  const points = lift(way.points)
  if (dashed) return <Line points={points} color={color} lineWidth={2} dashed dashSize={10} gapSize={8} />
  return (
    <>
      <Line points={points} color="#ffffff" lineWidth={7} />
      <Line points={points} color={color} lineWidth={4} position-y={0.2} />
    </>
  )
}

// Labels sit at different heights, so ones close together on the map don't cover each other.
function Label({ point, level = 0, children }) {
  return (
    <Html position={[point[0], 45 + level * 55, -point[1]]} center zIndexRange={[20, 0]} pointerEvents="none">
      <div className="bubble">{children}</div>
    </Html>
  )
}

// The sun: the only light in the scene, there to cast shadows. The building colours don't depend on it.
function Sun({ direction }) {
  return (
    <directionalLight
      position={direction.map((d) => d * SUN_DISTANCE)}
      castShadow
      shadow-mapSize={[4096, 4096]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.8}
      shadow-camera-left={-SHADOW_REACH}
      shadow-camera-right={SHADOW_REACH}
      shadow-camera-top={SHADOW_REACH}
      shadow-camera-bottom={-SHADOW_REACH}
      shadow-camera-near={100}
      shadow-camera-far={SUN_DISTANCE + SHADOW_REACH * 1.5}
    />
  )
}

export default function Scene({ city, needOfBuilding, sunDir, shade, tiers, areas, ways, placeWay, missing, startPoint, onPick }) {
  // A drag to orbit also ends in a click, so only a press that barely moved counts as choosing a point.
  const pick = (event, building = null) => {
    event.stopPropagation()
    if (event.delta > 4) return
    onPick([event.point.x, -event.point.z], building)
  }

  // A narrow screen needs the camera further back to fit the whole kit.
  const distance = window.innerWidth < 820 ? 1.2 : 1

  return (
    <Canvas
      shadows
      flat
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [260 * distance, 1500 * distance, 1900 * distance], fov: 36, near: 20, far: 12000 }}
      fallback={<p className="notice">This page needs WebGL, which your browser has turned off.</p>}
    >
      <color attach="background" args={[OUTSIDE]} />
      <Sun direction={sunDir} />

      <mesh rotation-x={-Math.PI / 2} onClick={pick}>
        <planeGeometry args={[20000, 20000]} />
        <meshBasicMaterial color={OUTSIDE} />
      </mesh>
      <Ground plots={city.plots} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.15} receiveShadow renderOrder={1}>
        <planeGeometry args={[7000, 7000]} />
        <shadowMaterial color={SHADOW_COLOR} opacity={SHADOW_STRENGTH} depthWrite={false} />
      </mesh>

      {missing.map(({ cell, share }) => (
        <FlatShape key={cell} polygons={[city.cells[cell].rings]} color="#E5007E" opacity={0.1 + 0.35 * share} height={0.2} />
      ))}

      {areas
        ?.slice()
        .reverse()
        .map((area, i) => (
          <FlatShape
            key={area.minutes}
            polygons={area.polygons}
            color={REACH[areas.length - 1 - i].wall}
            opacity={0.35}
            height={0.4 + i * 0.2}
          />
        ))}

      <Buildings city={city} needOfBuilding={needOfBuilding} tiers={tiers} sunDir={sunDir} onPick={pick} />
      <Streets city={city} shade={shade} />

      {(placeWay ? [placeWay] : (ways ?? [])).map((way, i) => {
        const color = USE_GROUPS.find((g) => g.key === way.key).tones.wall
        const end = way.shadiest?.points[way.shadiest.points.length - 1]
        return (
          <group key={way.key}>
            {(way.fastest?.node !== way.shadiest?.node || way.fastest?.sun !== way.shadiest?.sun) && (
              <Route way={way.fastest} color={color} dashed />
            )}
            <Route way={way.shadiest} color={color} />
            {way.shadiest && way.shadiest.points.length > 1 && (
              <Label point={end} level={i + 1}>
                {way.label}
              </Label>
            )}
          </group>
        )
      })}

      {startPoint && <Label point={startPoint}>Start</Label>}

      <OrbitControls
        makeDefault
        target={[0, 0, 150]}
        screenSpacePanning={false}
        minDistance={120}
        maxDistance={5000}
        maxPolarAngle={1.45}
      />
    </Canvas>
  )
}
