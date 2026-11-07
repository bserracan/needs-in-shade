import { useEffect, useMemo, useRef, useState } from 'react'
import {
  advance,
  applyAnswer,
  buildMoment,
  buildStormWorld,
  clockOf,
  decideWithoutThinking,
  newStory,
  offeredBuildings,
  pointOf,
  rainAt,
  replan,
  routePoints,
  toggleFlood,
} from './storm.js'
import { distanceToSegment, findStart } from './walk.js'

// The dev server has /api/think; the public page doesn't.
export const CAN_THINK = import.meta.env.DEV

const THINK_GAP = 4000 // never two thoughts within 4 seconds
const QUIET_WALKING = 30000 // if nothing happens on the way, think every 30 seconds
const QUIET_SHELTERING = 10000 // inside a shelter, reconsider every 10 seconds
const MAX_THOUGHTS = 30 // per walk, to spare your usage limit
const WAIT_FOR_ANSWER = 35000
const FLOOD_REACH = 40 // metres from a click to the street it floods
const TICK = 100
const REDRAW = 250

// What the father says out loud while he makes up his mind, instead of "Thinking…".
const SHELTER_LINES = [
  'Just drying off.',
  'Off again soon.',
  'At least we’re not the only ones wet.',
  'I should have brought an umbrella.',
  'The forecast didn’t say anything about rain!',
  'My socks are never going to dry.',
  'Is this ever going to stop?',
  'I’ll just wait five more minutes.',
]
const WALKING_LINES = [
  'I could walk this city with my eyes closed.',
  'I know every shortcut in this town.',
  'Trust me, there’s a faster way.',
  'Skip that street, take the alley behind the bakery.',
  'Tourists go left. Locals go right.',
  'That used to be a bookshop when I was a kid.',
  'Follow me, I know a shortcut.',
  'This way’s better.',
]

// A line for where they are, never the same as the one before.
function chatterFor(phase, previous) {
  const lines = (phase === 'sheltering' ? SHELTER_LINES : WALKING_LINES).filter((line) => line !== previous)
  return lines[Math.floor(Math.random() * lines.length)]
}

const EMPTY = {
  phase: 'placing',
  placed: null,
  notice: null,
  wet: 0,
  tired: 0,
  rain: 'pouring',
  rainStrength: 1,
  clock: '',
  heading: '',
  thinking: false,
  chatter: null,
  thought: null,
  log: [],
  route: [],
  floodLines: [],
  lit: [],
  focus: null,
  capped: false,
}

async function askFamily(moment, signal) {
  const response = await fetch(`${import.meta.env.BASE_URL}api/think`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(moment),
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? `The connection answered ${response.status}.`)
  return data
}

// Runs the story: moves the family, decides when they think, and carries out what they decide.
export function useStorm(city, active) {
  const world = useMemo(() => city && buildStormWorld(city), [city])
  const position = useRef([0, 0])
  const [view, setView] = useState(EMPTY)
  const live = useRef(null)
  if (!live.current) live.current = freshRun()
  const nextId = useRef(1)

  function freshRun() {
    return { story: null, placed: null, notice: null, pending: new Set(), lastThought: -Infinity, thoughts: 0, thinking: false, capped: false, thought: null, log: [], lit: [], focus: null, floodLines: [], route: [], routeKey: '', abort: null }
  }

  const addLog = (entry) => {
    const run = live.current
    const clock = run.story ? clockOf(world, run.story) : ''
    run.log = [{ id: nextId.current++, clock, ...entry }, ...run.log]
  }

  const draw = () => {
    const run = live.current
    const s = run.story
    if (s) {
      const key = `${s.phase}:${s.node}:${s.path.length}:${s.path[s.path.length - 1]?.edge}`
      if (key !== run.routeKey) {
        run.routeKey = key
        run.route = routePoints(city, s)
      }
    }
    const rain = rainAt(s?.seconds ?? 0)
    setView({
      phase: s ? s.phase : run.placed !== null ? 'ready' : 'placing',
      placed: run.placed !== null ? city.nodes[run.placed] : null,
      notice: run.notice,
      wet: s?.wet ?? 0,
      tired: s?.tired ?? 0,
      rain: rain.word,
      rainStrength: rain.strength,
      clock: s ? clockOf(world, s) : '',
      heading: s ? (s.phase === 'sheltering' ? `Sheltering in a ${s.shelter.kind}` : s.goal.kind === 'factory' ? 'Heading to the Fabrik' : `Heading to a ${s.goal.shelter.kind}`) : '',
      waiting: s?.waiting ?? false,
      thinking: run.thinking,
      chatter: run.chatter,
      thought: run.thought,
      log: run.log,
      route: run.route,
      floodLines: run.floodLines,
      lit: run.lit,
      focus: run.focus,
      capped: run.capped,
    })
  }

  const think = async () => {
    const run = live.current
    const s = run.story
    const events = [...run.pending]
    run.pending.clear()
    const moment = buildMoment(city, world, s, events)
    run.thinking = true
    run.chatter = chatterFor(s.phase, run.chatter)
    run.thoughts += 1
    run.lastThought = performance.now()
    run.lit = s.phase === 'sheltering' ? [s.shelter.building] : offeredBuildings(world, moment)
    const abort = new AbortController()
    run.abort = abort
    const timer = setTimeout(() => abort.abort(), WAIT_FOR_ANSWER)
    try {
      const answer = await askFamily(moment, abort.signal)
      if (live.current !== run) return
      run.thinking = false
      const result = applyAnswer(city, world, s, answer, moment)
      run.thought = answer.shock ? `${answer.shock} ${answer.reason}` : answer.reason
      addLog({ kind: 'thought', noticed: answer.noticed, did: result.did, shock: answer.shock, why: answer.reason, ok: result.ok, sent: moment, seconds: answer.seconds })
      if (!result.ok) decideWithoutThinking(city, s)
      if (s.phase === 'sheltering') run.lit = [s.shelter.building]
      else if (s.goal.kind === 'shelter') run.lit = [s.goal.shelter.building]
    } catch (error) {
      if (live.current !== run) return
      run.thinking = false
      if (run.paused) {
        events.forEach((e) => run.pending.add(e)) // the mode was switched: think about this when back
        return
      }
      addLog({ kind: 'problem', text: `Couldn't think this time: ${error.message} The family carries on.` })
      decideWithoutThinking(city, s)
    } finally {
      clearTimeout(timer)
      if (live.current === run) draw()
    }
  }

  // The story's clock, while Rainy evening is open.
  useEffect(() => {
    if (!active || !world) return
    live.current.paused = false
    let previous = performance.now()
    let lastDraw = 0
    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.25, (now - previous) / 1000)
      previous = now
      const run = live.current
      const s = run.story
      if (s) {
        for (const event of advance(city, world, s, dt)) {
          if (event === 'arrived') {
            addLog({ kind: 'story', text: 'They reached the Fabrik. People open the door.' })
            run.pending.clear()
            run.lit = []
          } else {
            if (event === 'reached_shelter') {
              addLog({ kind: 'story', text: `They reached the ${s.shelter.kind} and came inside.` })
              run.lit = [s.shelter.building]
            }
            run.pending.add(event)
          }
        }
        position.current = pointOf(city, s)

        if (s.phase !== 'arrived') {
          if (CAN_THINK && run.thoughts < MAX_THOUGHTS) {
            if (!run.thinking && !document.hidden) {
              const quiet = s.phase === 'sheltering' ? QUIET_SHELTERING : QUIET_WALKING
              if (now - run.lastThought >= quiet) run.pending.add('quiet_minute')
              if (run.pending.size > 0 && now - run.lastThought >= THINK_GAP) think()
            }
          } else {
            if (CAN_THINK && !run.capped) {
              run.capped = true
              addLog({ kind: 'story', text: `That's ${MAX_THOUGHTS} thoughts for this walk, so the family stops thinking now, to spare your usage limit. They take the shortest dry way.` })
            }
            run.pending.clear()
            decideWithoutThinking(city, s)
            if (s.phase === 'sheltering') {
              s.phase = 'walking'
              s.goal = { kind: 'factory', node: world.factoryNode }
              replan(city, s)
            }
          }
        }
      }
      if (now - lastDraw >= REDRAW) {
        lastDraw = now
        draw()
      }
    }
    const timer = setInterval(tick, TICK)
    return () => {
      clearInterval(timer)
      live.current.paused = true
      live.current.abort?.abort()
    }
  }, [active, world, city])

  const start = () => {
    const run = live.current
    if (run.placed === null) return
    run.story = newStory(world, run.placed)
    replan(city, run.story)
    run.pending = new Set(['walk_started'])
    run.lastThought = -Infinity
    run.notice = null
    run.focus = { id: nextId.current++, points: [city.nodes[run.placed], world.factoryCentre] }
    position.current = city.nodes[run.placed]
    addLog({ kind: 'story', text: 'The family sets off in the rain.' })
    draw()
  }

  const reset = () => {
    live.current.abort?.abort()
    live.current = freshRun()
    draw()
  }

  // Returns 'street' when the click placed the family or flooded or cleared a street, so the page can strike lightning.
  const click = (point) => {
    const run = live.current
    const s = run.story
    let hit = null
    if (s && s.phase === 'arrived') {
      run.notice = 'They\'re safe inside. Press Start again for a new walk.'
    } else if (s) {
      let edge = -1
      let nearest = Infinity
      city.edges.forEach((e, i) => {
        const d = distanceToSegment(point, e.start, e.end)
        if (d < nearest) {
          nearest = d
          edge = i
        }
      })
      if (nearest > FLOOD_REACH) {
        run.notice = 'Click closer to a street to flood it.'
      } else {
        const { flooded, onRoute } = toggleFlood(s, edge)
        hit = 'street'
        run.notice = null
        const e = city.edges[edge]
        run.floodLines = flooded ? [...run.floodLines, { edge, points: [e.start, e.end] }] : run.floodLines.filter((f) => f.edge !== edge)
        if (onRoute) run.pending.add('street_flooded')
        addLog({ kind: 'storm', text: !flooded ? 'You cleared a street.' : onRoute ? 'You flooded a street on their way.' : 'You flooded a street, but it isn\'t on their way.' })
      }
    } else {
      const node = findStart(city, point)
      if (node === null) {
        run.notice = 'There is no walkable street within 100 m of that point. Try closer to the streets.'
      } else {
        run.placed = node
        hit = 'street'
        run.notice = null
        position.current = city.nodes[node]
      }
    }
    draw()
    return hit
  }

  return { view, position, world, start, reset, click }
}
