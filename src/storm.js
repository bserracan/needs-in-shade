// The rainy evening: an imagined story on the real streets and buildings of the kit.
// The rain, wetness, tiredness, floods and the factory's story are invented rules, not measurements.

import { nearestNode } from './city.js'
import { clockTime, dayFromNumber, sunAt } from './sun.js'

export const FACTORY_ID = '23891' // the building that plays the factory: large, on an industrial and commercial plot
const STORY_DAY = 311 // 7 November
const AFTER_SUNSET = 15 // the story starts this many minutes after the sun has set

export const METRES_PER_SECOND = 16 // on screen. One real second is 16 story seconds, so the family walks 60 m a minute.
const STORY_METRES_PER_MINUTE = 60 // slower than the map's 80 m a minute, because of the pram
const SHELTER_REACH = 150 // metres of walking to a building the family could shelter in
const SHELTER_NEAR_STREET = 60 // metres from a building's middle to its street junction, or it is too far to count
const SHELTERS_OFFERED = 3

// Twice the walking speed means everything else runs twice as fast too, so the story plays out the same, only quicker.
const WET_PER_SECOND = 2 // in full rain, per real second, outside
const DRY_PER_SECOND = 1.2
const TIRE_PER_SECOND = 0.7
const REST_PER_SECOND = 1
const WADE_WET = 25
const WADE_TIRED = 8
export const VERY_WET = 70
const WET_AGAIN = 50 // they have to dry below this before "very wet" can happen again

// The rain follows a fixed pattern, in real seconds, then repeats.
const RAIN_PATTERN = [
  { until: 18, word: 'pouring', strength: 1 },
  { until: 30, word: 'easing', strength: 0.35 },
  { until: 43, word: 'heavy', strength: 0.75 },
  { until: 55, word: 'easing', strength: 0.35 },
]
const RAIN_CYCLE = 55

// Who would plausibly be open in the evening. Shops, offices and schools are taken to be closed.
const SHELTER_KINDS = {
  food_and_drink: 'café or restaurant',
  accommodation: 'hotel or guesthouse',
  entertainment: 'venue',
  culture: 'cultural building',
  transport: 'transport building',
}

function centreOf(ring) {
  const points = ring.slice(0, -1)
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
}

// The clock time, in minutes, when the story's sun has set: taken from the same sun calculation as the map.
function sunsetMinutes(center) {
  const day = dayFromNumber(STORY_DAY)
  let m = 12 * 60
  while (m < 24 * 60 && sunAt(day, m, center).altitude > 0) m += 1
  return m
}

export function buildStormWorld(city) {
  const factory = city.buildings.findIndex((b) => b.id === FACTORY_ID)
  const factoryCentre = centreOf(city.buildings[factory].rings[0])
  const shelters = []
  city.buildings.forEach((b, i) => {
    const kind = SHELTER_KINDS[b.use]
    if (!kind || i === factory) return
    const centre = centreOf(b.rings[0])
    const node = nearestNode(city, centre)
    const near = Math.hypot(city.nodes[node][0] - centre[0], city.nodes[node][1] - centre[1])
    if (near <= SHELTER_NEAR_STREET) shelters.push({ id: b.id, building: i, node, kind })
  })
  return {
    factory,
    factoryCentre,
    factoryNode: nearestNode(city, factoryCentre),
    shelters,
    startClock: sunsetMinutes(city.center) + AFTER_SUNSET,
  }
}

// The shortest way between two nodes, optionally without the flooded edges. Null if there is none.
export function findPath(city, from, to, avoid = null) {
  const best = new Float64Array(city.nodes.length).fill(Infinity)
  const done = new Uint8Array(city.nodes.length)
  const cameBy = new Array(city.nodes.length).fill(null)
  best[from] = 0
  for (;;) {
    let node = -1
    for (let i = 0; i < best.length; i++) {
      if (!done[i] && best[i] !== Infinity && (node < 0 || best[i] < best[node])) node = i
    }
    if (node < 0) return null
    if (node === to) break
    done[node] = 1
    for (const link of city.links[node]) {
      if (avoid?.has(link.edge)) continue
      const through = best[node] + city.edges[link.edge].length
      if (through < best[link.node]) {
        best[link.node] = through
        cameBy[link.node] = { edge: link.edge, from: node }
      }
    }
  }
  const steps = []
  for (let at = to; cameBy[at]; at = cameBy[at].from) steps.push({ edge: cameBy[at].edge, to: at })
  steps.reverse()
  return { steps, metres: best[to] }
}

function distancesAvoiding(city, from, avoid, limit) {
  const best = new Float64Array(city.nodes.length).fill(Infinity)
  const done = new Uint8Array(city.nodes.length)
  best[from] = 0
  for (;;) {
    let node = -1
    for (let i = 0; i < best.length; i++) {
      if (!done[i] && best[i] <= limit && (node < 0 || best[i] < best[node])) node = i
    }
    if (node < 0) return best
    done[node] = 1
    for (const link of city.links[node]) {
      if (avoid.has(link.edge)) continue
      const through = best[node] + city.edges[link.edge].length
      if (through < best[link.node]) best[link.node] = through
    }
  }
}

export function rainAt(seconds) {
  const t = seconds % RAIN_CYCLE
  return RAIN_PATTERN.find((p) => t < p.until)
}

export function newStory(world, startNode) {
  return {
    phase: 'walking', // walking, sheltering or arrived
    goal: { kind: 'factory', node: world.factoryNode },
    shelter: null,
    node: startNode, // the last junction passed
    path: [], // the steps still to walk; the first may be partly done
    progress: 0, // metres along the first step
    floods: new Set(),
    wading: new Set(), // flooded edges the family has decided to wade through
    asked: new Set(), // flooded edges the family has already been asked about
    waiting: false,
    wet: 0,
    tired: 0,
    seconds: 0,
    wetWarned: false,
    metFlood: false, // whether the father has already reacted to a first flooded street
    last: null,
  }
}

const fromNode = (s) => (s.progress > 0 ? s.path[0].to : s.node)

// A new way to the goal: dry if there is one, otherwise the shortest. A street already started is finished first.
export function replan(city, s) {
  const kept = s.progress > 0 ? [s.path[0]] : []
  const from = fromNode(s)
  const way = findPath(city, from, s.goal.node, s.floods) ?? findPath(city, from, s.goal.node)
  s.path = [...kept, ...way.steps]
  s.waiting = false
}

export const clockOf = (world, s) => clockTime(Math.floor(world.startClock + (s.seconds * METRES_PER_SECOND) / 60) % (24 * 60))

// One small step of the story. Returns the events that happened.
export function advance(city, world, s, dt) {
  const events = []
  if (s.phase === 'arrived') return events
  s.seconds += dt
  const rain = rainAt(s.seconds)

  if (s.phase === 'sheltering') {
    s.wet = Math.max(0, s.wet - DRY_PER_SECOND * dt)
    s.tired = Math.max(0, s.tired - REST_PER_SECOND * dt)
  } else {
    s.wet = Math.min(100, s.wet + rain.strength * WET_PER_SECOND * dt)
    let left = METRES_PER_SECOND * dt
    s.waiting = false
    while (left > 0 && s.phase === 'walking') {
      if (s.path.length === 0) {
        s.node = s.goal.node
        s.progress = 0
        if (s.goal.kind === 'factory') {
          s.phase = 'arrived'
          events.push('arrived')
        } else {
          s.phase = 'sheltering'
          s.shelter = s.goal.shelter
          events.push('reached_shelter')
        }
        break
      }
      const step = s.path[0]
      if (s.progress === 0 && s.floods.has(step.edge)) {
        if (!s.wading.has(step.edge)) {
          s.waiting = true
          if (!s.asked.has(step.edge)) {
            s.asked.add(step.edge)
            events.push('street_flooded')
          }
          break
        }
        s.wet = Math.min(100, s.wet + WADE_WET)
        s.tired = Math.min(100, s.tired + WADE_TIRED)
      }
      const length = city.edges[step.edge].length
      const walked = Math.min(left, length - s.progress)
      s.progress += walked
      left -= walked
      s.tired = Math.min(100, s.tired + (walked / METRES_PER_SECOND) * TIRE_PER_SECOND)
      if (s.progress >= length) {
        s.node = step.to
        s.progress = 0
        s.path.shift()
      }
    }
  }

  if (s.wet >= VERY_WET && !s.wetWarned) {
    s.wetWarned = true
    if (s.phase === 'walking') events.push('very_wet')
  } else if (s.wet < WET_AGAIN) {
    s.wetWarned = false
  }
  return events
}

// Where the family is now, in metres.
export function pointOf(city, s) {
  if (s.progress > 0) {
    const edge = city.edges[s.path[0].edge]
    const t = s.progress / edge.length
    const towardsEnd = city.nodes[edge.b] === city.nodes[s.path[0].to]
    const [a, b] = towardsEnd ? [edge.start, edge.end] : [edge.end, edge.start]
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }
  return city.nodes[s.node]
}

// The way still to walk, as points for the map.
export function routePoints(city, s) {
  if (s.phase !== 'walking') return []
  return [pointOf(city, s), ...s.path.map((step) => city.nodes[step.to])]
}

const metresLeft = (city, s) => s.path.reduce((sum, step) => sum + city.edges[step.edge].length, 0) - s.progress
const toMinutes = (metres) => Math.round((metres / STORY_METRES_PER_MINUTE) * 10) / 10

// Flooded streets on the way that the family hasn't started on and hasn't agreed to wade through.
function floodedAhead(s) {
  return s.path.filter((step, i) => !(i === 0 && s.progress > 0) && s.floods.has(step.edge)).map((step) => step.edge)
}

// A street floods or clears. Reports whether it matters to the family right now.
export function toggleFlood(s, edge) {
  if (s.floods.has(edge)) {
    s.floods.delete(edge)
    s.wading.delete(edge)
    s.asked.delete(edge)
    return { flooded: false, onRoute: false }
  }
  s.floods.add(edge)
  const onRoute = s.phase === 'walking' && s.path.some((step, i) => step.edge === edge && !(i === 0 && s.progress > 0))
  if (onRoute) s.asked.add(edge)
  return { flooded: true, onRoute }
}

// Everything the family gets to know for one decision.
export function buildMoment(city, world, s, events) {
  const walking = s.phase === 'walking'
  const from = walking ? fromNode(s) : s.node
  const toFabrik = findPath(city, from, world.factoryNode, s.floods) ?? findPath(city, from, world.factoryNode)
  const flooded = walking ? floodedAhead(s) : []
  const around = flooded.length > 0 ? findPath(city, from, s.goal.node, s.floods) : null

  let shelters = []
  if (walking && s.goal.kind === 'factory') {
    const reach = distancesAvoiding(city, from, s.floods, SHELTER_REACH)
    shelters = world.shelters
      .filter((p) => reach[p.node] <= SHELTER_REACH)
      .sort((p, q) => reach[p.node] - reach[q.node])
      .slice(0, SHELTERS_OFFERED)
      .map((p) => ({ id: p.id, kind: p.kind, metres: Math.round(reach[p.node]) }))
  }

  const allowed = walking
    ? ['keep_going', ...(around ? ['go_around'] : []), ...(shelters.length ? ['shelter'] : []), ...(s.goal.kind === 'shelter' ? ['head_out'] : [])]
    : ['shelter', 'head_out']

  return {
    events,
    time: clockOf(world, s),
    rain: rainAt(s.seconds).word,
    wet: Math.round(s.wet),
    tired: Math.round(s.tired),
    place: walking ? 'walking' : 'sheltering',
    heading_to: s.goal.kind === 'factory' ? 'Fabrik' : 'shelter',
    sheltering_in: walking ? null : s.shelter?.kind ?? null,
    way_now: walking ? { minutes: toMinutes(metresLeft(city, s)), flooded_streets: flooded.length } : null,
    way_around: around ? { minutes: toMinutes(around.metres + (s.progress > 0 ? metresLeft(city, s) - pathMetresFromNext(city, s) : 0)), flooded_streets: 0 } : null,
    fabrik_minutes: toMinutes(toFabrik.metres),
    shelters,
    allowed,
    first_flood: events.includes('street_flooded') && !s.metFlood,
    last: s.last,
  }
}

// The metres still to walk after the street the family is on.
function pathMetresFromNext(city, s) {
  return s.path.slice(1).reduce((sum, step) => sum + city.edges[step.edge].length, 0)
}

// Carries out Claude's answer. Returns what the family did, in words for the log.
export function applyAnswer(city, world, s, answer, moment) {
  const wasWalking = moment.place === 'walking'
  if ((s.phase === 'walking') !== wasWalking || s.phase === 'arrived') {
    return { ok: false, did: 'Nothing: things had already moved on when the answer came.' }
  }
  if (!moment.allowed.includes(answer.action)) {
    return { ok: false, did: `Stayed on course: "${answer.action}" wasn't possible right now.` }
  }

  switch (answer.action) {
    case 'keep_going': {
      const flooded = floodedAhead(s)
      flooded.forEach((edge) => s.wading.add(edge))
      s.waiting = false
      remember(s, answer, moment)
      if (flooded.length > 0) return { ok: true, did: 'Kept going, through the water.' }
      return { ok: true, did: s.goal.kind === 'factory' ? 'Kept walking to the Fabrik.' : 'Kept walking to the shelter.' }
    }
    case 'go_around': {
      const around = findPath(city, fromNode(s), s.goal.node, s.floods)
      if (!around) return { ok: false, did: 'Stayed on course: there was no dry way any more.' }
      replan(city, s)
      remember(s, answer, moment)
      return { ok: true, did: 'Went around the flooded street.' }
    }
    case 'shelter': {
      if (s.phase === 'sheltering') {
        remember(s, answer, moment)
        return { ok: true, did: `Stayed in the ${s.shelter.kind}.` }
      }
      const offered = moment.shelters.find((p) => p.id === answer.shelter_id)
      if (!offered) return { ok: false, did: 'Stayed on course: that building wasn\'t one of the nearby shelters.' }
      const place = world.shelters.find((p) => p.id === offered.id)
      s.goal = { kind: 'shelter', node: place.node, shelter: place }
      replan(city, s)
      remember(s, answer, moment)
      return { ok: true, did: `Headed for a nearby ${place.kind}, ${offered.metres} m away.` }
    }
    case 'head_out': {
      s.phase = 'walking'
      s.shelter = null
      s.goal = { kind: 'factory', node: world.factoryNode }
      replan(city, s)
      remember(s, answer, moment)
      return { ok: true, did: 'Set off for the Fabrik.' }
    }
    default:
      return { ok: false, did: 'Stayed on course.' }
  }
}

function remember(s, answer, moment) {
  s.last = { action: answer.action, reason: answer.reason, shock: answer.shock ?? null }
  if (moment.first_flood) s.metFlood = true
}

// With nobody thinking (the live page, or if Claude can't answer), they take the shortest dry way, or wade if there is none.
export function decideWithoutThinking(city, s) {
  if (!s.waiting) return
  const dry = findPath(city, fromNode(s), s.goal.node, s.floods)
  if (dry) replan(city, s)
  else floodedAhead(s).forEach((edge) => s.wading.add(edge))
  s.waiting = false
}

// Buildings the family could go to right now, for lighting them up on the map.
export function offeredBuildings(world, moment) {
  return moment.shelters.map((p) => world.shelters.find((q) => q.id === p.id)?.building).filter((b) => b !== undefined)
}
