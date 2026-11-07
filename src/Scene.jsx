import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GROUND, MAGENTA, NIGHT, OUTSIDE, PLOT_LINE, REACH, STREET_SHADE, STREET_SUN, USE_GROUPS } from './palette.js'

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
const nightTones = toColors(NIGHT.building)
const factoryTones = toColors(NIGHT.factory)
const litTones = toColors(NIGHT.lit)
const nightStreet = new THREE.Color(NIGHT.street)

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

function Buildings({ city, needOfBuilding, tiers, sunDir, night, factory, lit, onPick, onHover }) {
  const invalidate = useThree((s) => s.invalidate)
  const { mesh, outline, faces } = useMemo(() => buildingGeometry(city.buildings), [city])

  // Roofs take the lightest tone. Walls facing the sun take the base colour, the others the darker shade.
  // On the rainy evening there is no sun: everything is dark, except the factory and the places the family could shelter.
  useEffect(() => {
    const colors = mesh.attributes.color
    const glowing = new Set(lit)
    for (const face of faces) {
      const b = city.buildings[face.building]
      const need = needOfBuilding[face.building]
      const tier = tiers ? tiers[face.building] : 0
      let tones
      if (night) tones = face.building === factory ? factoryTones : glowing.has(face.building) ? litTones : nightTones
      else tones = need ? groupTones.get(need) : tier ? reachTones[tier - 1] : useTones.get(b.use)
      const sunlit = !face.roof && face.nx * sunDir[0] + face.nz * sunDir[2] > 0
      const color = face.roof ? tones.roof : sunlit ? tones.wall : tones.shade
      for (let v = face.first; v < face.first + face.count; v++) colors.setXYZ(v, color.r, color.g, color.b)
    }
    colors.needsUpdate = true
    invalidate()
  }, [city, mesh, faces, needOfBuilding, tiers, sunDir, night, factory, lit, invalidate])

  return (
    <>
      <mesh
        geometry={mesh}
        castShadow
        onClick={(event) => onPick(event, buildingAt(faces, event.faceIndex))}
        onPointerMove={onHover && ((event) => onHover(buildingAt(faces, event.faceIndex)))}
        onPointerOut={onHover && (() => onHover(null))}
      >
        <meshBasicMaterial vertexColors polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      {/* The colours stay flat, so a see-through copy on top shows the shadows falling on other buildings. */}
      <mesh geometry={mesh} receiveShadow renderOrder={1}>
        <shadowMaterial color={SHADOW_COLOR} opacity={SHADOW_STRENGTH} depthWrite={false} />
      </mesh>
      <lineSegments geometry={outline}>
        <lineBasicMaterial color={night ? NIGHT.buildingLine : '#ffffff'} />
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
function Ground({ plots, night }) {
  const { layers, lines } = useMemo(() => {
    const byColor = new Map()
    const nightOf = new Map()
    const points = []
    for (const plot of plots) {
      const color = GROUND[plot.landuse] ?? GROUND.default
      if (!byColor.has(color)) byColor.set(color, [])
      byColor.get(color).push(plot.rings)
      nightOf.set(color, NIGHT.ground[plot.landuse] ?? NIGHT.ground.default)
      for (const ring of plot.rings) {
        for (let i = 0; i < ring.length - 1; i++) {
          points.push(ring[i][0], 0.1, -ring[i][1], ring[i + 1][0], 0.1, -ring[i + 1][1])
        }
      }
    }
    return {
      layers: [...byColor].map(([color, polygons]) => ({ color, nightColor: nightOf.get(color), geometry: new THREE.ShapeGeometry(shapesOf(polygons)) })),
      lines: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
    }
  }, [plots])

  return (
    <>
      {layers.map(({ color, nightColor, geometry }) => (
        <mesh key={color} geometry={geometry} rotation-x={-Math.PI / 2} position-y={0.05}>
          <meshBasicMaterial color={night ? nightColor : color} />
        </mesh>
      ))}
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={night ? NIGHT.plotLine : PLOT_LINE} />
      </lineSegments>
    </>
  )
}

// The network drawn thin: white where a street is in the sun, slate where it is in shade.
function Streets({ city, shade, night }) {
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
      const c = night ? nightStreet : shade[p] ? shadeStreet : sunStreet
      colors.setXYZ(p * 2, c.r, c.g, c.b)
      colors.setXYZ(p * 2 + 1, c.r, c.g, c.b)
    }
    colors.needsUpdate = true
    invalidate()
  }, [geometry, shade, night, invalidate])

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
function Label({ point, level = 0, className = '', children }) {
  return (
    <Html position={[point[0], 45 + level * 55, -point[1]]} center zIndexRange={[20, 0]} pointerEvents="none">
      <div className={`bubble ${className}`}>{children}</div>
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

const RAIN_DROPS = 2600
const RAIN_AREA = { x: 900, z: 1300, height: 500 }
const DROP = { x: 4, y: 28 } // a streak's lean and length, in metres
const FALL_SPEED = 430 // metres a second on screen, chosen by eye

// Rain: thin falling streaks. The view keeps redrawing while it falls.
function Rain({ strength }) {
  const still = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])
  const { geometry, drops } = useMemo(() => {
    const positions = new Float32Array(RAIN_DROPS * 6)
    const drops = Array.from({ length: RAIN_DROPS }, () => ({
      x: (Math.random() - 0.5) * RAIN_AREA.x * 2,
      y: Math.random() * RAIN_AREA.height,
      z: 150 + (Math.random() - 0.5) * RAIN_AREA.z * 2,
    }))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return { geometry: g, drops }
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame((state, delta) => {
    const dt = still ? 0 : Math.min(delta, 0.05)
    const positions = geometry.attributes.position.array
    drops.forEach((d, i) => {
      d.y -= FALL_SPEED * dt
      d.x -= (FALL_SPEED * dt * DROP.x) / DROP.y
      if (d.y < 0) {
        d.y += RAIN_AREA.height
        d.x = (Math.random() - 0.5) * RAIN_AREA.x * 2
      }
      positions.set([d.x, d.y, d.z, d.x + DROP.x, d.y + DROP.y, d.z], i * 6)
    })
    geometry.attributes.position.needsUpdate = true
    geometry.setDrawRange(0, Math.round(RAIN_DROPS * strength) * 2)
    state.invalidate()
  })

  return (
    <lineSegments geometry={geometry} frustumCulled={false} renderOrder={5}>
      <lineBasicMaterial color={NIGHT.rain} transparent opacity={0.28} depthWrite={false} />
    </lineSegments>
  )
}

// The family: a marker that follows the story, with its latest thought above it.
// While Claude is deciding, the father says one of his everyday lines instead.
function Family({ position, thought, thinking, chatter, started }) {
  const group = useRef()
  useFrame(() => {
    const [x, y] = position.current
    group.current.position.set(x, 0, -y)
  })
  const text = thinking ? chatter : started ? thought : 'The family'
  return (
    <group ref={group}>
      <mesh position-y={14}>
        <sphereGeometry args={[14, 20, 14]} />
        <meshBasicMaterial color={MAGENTA} />
      </mesh>
      {text && (
        <Html position={[0, 60, 0]} center zIndexRange={[30, 10]} pointerEvents="none">
          <div className={`bubble ${thought && !thinking ? 'thought' : ''}`}>{text}</div>
        </Html>
      )}
    </group>
  )
}

// When a walk starts, the camera glides to show the family and the factory together, once.
function CameraGuide({ focus }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const invalidate = useThree((s) => s.invalidate)
  const move = useRef(null)
  const home = useRef(null)

  // Leaving the rainy evening puts the camera back where it was, so the sun map stays as you left it.
  useEffect(
    () => () => {
      if (!home.current || !controls) return
      move.current = null
      camera.position.copy(home.current.camera)
      controls.target.copy(home.current.target)
      controls.update()
      home.current = null
      invalidate()
    },
    [camera, controls, invalidate],
  )

  useEffect(() => {
    if (!focus || !controls) return
    if (!home.current) home.current = { camera: camera.position.clone(), target: controls.target.clone() }
    const [[ax, ay], [bx, by]] = focus.points
    const target = new THREE.Vector3((ax + bx) / 2, 0, -(ay + by) / 2)
    const direction = camera.position.clone().sub(controls.target).normalize()
    const distance = Math.max(600, Math.hypot(ax - bx, ay - by) * 1.9 + 200)
    move.current = {
      t: 0,
      fromTarget: controls.target.clone(),
      toTarget: target,
      fromCamera: camera.position.clone(),
      toCamera: target.clone().addScaledVector(direction, distance),
    }
  }, [focus, camera, controls])

  useFrame((_, delta) => {
    const m = move.current
    if (!m) return
    m.t = Math.min(1, m.t + delta / 1.5)
    const eased = m.t * m.t * (3 - 2 * m.t)
    controls.target.lerpVectors(m.fromTarget, m.toTarget, eased)
    camera.position.lerpVectors(m.fromCamera, m.toCamera, eased)
    controls.update()
    if (m.t === 1) move.current = null
  })
  return null
}

// A line that only rebuilds when its points change, as the story redraws a few times a second.
function StormLine({ points, ...look }) {
  const lifted = useMemo(() => lift(points), [points])
  return <Line points={lifted} {...look} />
}

const FABRIK_INTRO = 10000 // the Fabrik's name shows for 10 seconds when the rainy evening opens

// The Fabrik's name: at first for a few seconds, then only while the pointer is over it, or after a click on it.
function useFabrikName(overFabrik, pinned) {
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), FABRIK_INTRO)
    return () => clearTimeout(timer)
  }, [])
  return intro || overFabrik || pinned
}

function StormLayers({ storm, position, overFabrik }) {
  const showName = useFabrikName(overFabrik, storm.fabrikPinned)
  return (
    <>
      <Rain strength={storm.rainStrength} />
      <CameraGuide focus={storm.focus} />
      {storm.floodLines.map((flood) => (
        <StormLine key={flood.edge} points={flood.points} color={NIGHT.flood} lineWidth={6} />
      ))}
      {storm.route.length > 1 && <StormLine points={storm.route} color={NIGHT.route} lineWidth={2.5} dashed dashSize={10} gapSize={7} />}
      {showName && (
        <Label point={storm.factoryCentre} className="pop">
          Fabrik community centre (imagined, in the Atrium's place)
        </Label>
      )}
      {storm.placed && <Family position={position} thought={storm.thought} thinking={storm.thinking} chatter={storm.chatter} started={storm.started} />}
    </>
  )
}

export default function Scene({ city, needOfBuilding, sunDir, shade, tiers, areas, ways, placeWay, missing, startPoint, storm, stormPosition, onPick }) {
  // A drag to orbit also ends in a click, so only a press that barely moved counts as choosing a point.
  const pick = (event, building = null) => {
    event.stopPropagation()
    if (event.delta > 4) return
    onPick([event.point.x, -event.point.z], building)
  }

  // A narrow screen needs the camera further back to fit the whole kit.
  const distance = window.innerWidth < 820 ? 1.2 : 1
  const night = Boolean(storm)

  // On the rainy evening, whether the pointer is over the Fabrik, with a hand cursor to show it can be clicked.
  const [overFabrik, setOverFabrik] = useState(false)
  const hover = (building) => setOverFabrik(building !== null && building === storm?.factory)
  useEffect(() => {
    document.body.style.cursor = night && overFabrik ? 'pointer' : ''
  }, [night, overFabrik])

  return (
    <Canvas
      shadows
      flat
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [260 * distance, 1500 * distance, 1900 * distance], fov: 36, near: 20, far: 12000 }}
      fallback={<p className="notice">This page needs WebGL, which your browser has turned off.</p>}
    >
      <color key={night ? 'night' : 'day'} attach="background" args={[night ? NIGHT.outside : OUTSIDE]} />
      {!night && <Sun direction={sunDir} />}

      <mesh rotation-x={-Math.PI / 2} onClick={pick}>
        <planeGeometry args={[20000, 20000]} />
        <meshBasicMaterial color={night ? NIGHT.outside : OUTSIDE} />
      </mesh>
      <Ground plots={city.plots} night={night} />
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

      <Buildings
        city={city}
        needOfBuilding={needOfBuilding}
        tiers={tiers}
        sunDir={sunDir}
        night={night}
        factory={storm?.factory}
        lit={storm?.lit}
        onPick={pick}
        onHover={night ? hover : undefined}
      />
      <Streets city={city} shade={shade} night={night} />

      {night && <StormLayers storm={storm} position={stormPosition} overFabrik={overFabrik} />}

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
