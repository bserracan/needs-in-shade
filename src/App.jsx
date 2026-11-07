import { useEffect, useMemo, useRef, useState } from 'react'
import '@fontsource/barlow-condensed/300.css'
import '@fontsource/barlow-condensed/700.css'
import Scene from './Scene.jsx'
import StormPanel from './StormPanel.jsx'
import Lightning from './Lightning.jsx'
import { useStorm } from './useStorm.js'
import { buildCity, computeShade, shadeShare, sunnyMetres } from './city.js'
import { findStart, walk } from './walk.js'
import { NEEDS, TESTS, buildNeeds, waysToNeeds, waysToPlace, whoMissesOut } from './needs.js'
import { QUICK_DAYS, clockTime, compassWord, dayFromNumber, daylight, sunAt, sunDirection } from './sun.js'
import { GROUND, NIGHT, REACH, STREET_SHADE, STREET_SUN, USE_GROUPS } from './palette.js'

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

const number = (n) => n.toLocaleString('en-GB')
const minutesText = (m) => `${m.toFixed(1)} min`

async function loadKit() {
  const load = async (file) => {
    const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`)
    if (!response.ok) throw new Error(`data/${file}: ${response.status}`)
    return response.json()
  }
  const [kit, buildings, plots, graph, zensus] = await Promise.all(
    ['kit.json', 'buildings.geojson', 'plots.geojson', 'streets.graph.json', 'zensus.geojson'].map(load),
  )
  return { kit, buildings, plots, graph, zensus }
}

// Measures the walked areas in a background worker, and hands back the newest result.
function useMeasure(raw, walked) {
  const [result, setResult] = useState(null)
  const worker = useRef(null)
  const latest = useRef(0)

  useEffect(() => {
    if (!raw) return
    const w = new Worker(new URL('./measure.worker.js', import.meta.url), { type: 'module' })
    const { plots, ...withoutPlots } = raw
    w.postMessage({ raw: withoutPlots })
    w.onmessage = ({ data }) => {
      if (data.id === latest.current) setResult(data)
    }
    worker.current = w
    return () => w.terminate()
  }, [raw])

  useEffect(() => {
    setResult(null)
    if (!walked || !worker.current) return
    latest.current += 1
    worker.current.postMessage({ id: latest.current, walked })
  }, [walked])

  return result
}

function House({ tones }) {
  return (
    <svg className="house" viewBox="0 0 24 20" aria-hidden="true">
      <polygon points="9,1 22,4 22,11 16,19 2,19 2,9" fill={tones.wall} stroke="#fff" />
      <polygon points="16,11 22,4 22,11 16,19" fill={tones.shade} stroke="#fff" />
      <polygon points="9,1 22,4 16,11 2,9" fill={tones.roof} stroke="#fff" />
    </svg>
  )
}

function Legend() {
  return (
    <aside className="legend" aria-label="Legend">
      <h2>Buildings</h2>
      <ul>
        {USE_GROUPS.map((g) => (
          <li key={g.key}>
            <House tones={g.tones} /> {g.label}
          </li>
        ))}
      </ul>
      <p className="small">Colour shows the main use. Any building with 50 m² or more of food, health or education takes that colour.</p>
      <h2>Your walk</h2>
      <ul>
        {REACH.map((tones, i) => (
          <li key={i}>
            <House tones={tones} /> Within {[5, 10, 15][i]} minutes
          </li>
        ))}
        <li>
          <span className="line" style={{ background: 'var(--ink)' }} /> Solid: shadiest way
        </li>
        <li>
          <span className="line dashed" /> Dashed: fastest way
        </li>
      </ul>
      <h2>Ground</h2>
      <ul>
        <li>
          <span className="line thick" style={{ background: STREET_SUN }} /> Street in the sun
        </li>
        <li>
          <span className="line thick" style={{ background: STREET_SHADE }} /> Street in shade
        </li>
        <li>
          <span className="swatch" style={{ background: '#dae0ce' }} /> Shadow of a building
        </li>
        <li>
          <span className="swatch" style={{ background: GROUND.recreation }} /> Park or green space
        </li>
        <li>
          <span className="swatch" style={{ background: GROUND['flowing water'] }} /> Water
        </li>
        <li>
          <span className="swatch" style={{ background: 'rgba(229, 0, 126, 0.4)' }} /> Who misses out
        </li>
      </ul>
    </aside>
  )
}

function StormLegend() {
  return (
    <aside className="legend" aria-label="Legend">
      <h2>Rainy evening</h2>
      <ul>
        <li>
          <House tones={NIGHT.factory} /> The Fabrik, in the Atrium's place (imagined)
        </li>
        <li>
          <House tones={NIGHT.lit} /> A shelter on offer
        </li>
        <li>
          <House tones={NIGHT.building} /> Other buildings
        </li>
        <li>
          <span className="swatch" style={{ background: 'var(--magenta)', borderRadius: '50%', width: 12 }} /> The family
        </li>
        <li>
          <span className="line dashed route" /> The way they're taking
        </li>
        <li>
          <span className="line thick" style={{ background: NIGHT.flood }} /> Flooded street
        </li>
      </ul>
    </aside>
  )
}

function WaysTable({ ways }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Need</th>
          <th>Fastest</th>
          <th>Shadiest</th>
        </tr>
      </thead>
      <tbody>
        {ways.map((way) => {
          const group = USE_GROUPS.find((g) => g.key === way.key)
          const places = `${way.count} ${way.count === 1 ? 'place' : 'places'} in 15 min`
          if (!way.shadiest) {
            return (
              <tr key={way.key}>
                <td>
                  <House tones={group.tones} /> {way.label}
                </td>
                <td colSpan="2">None within 15 min</td>
              </tr>
            )
          }
          const here = way.shadiest.metres === 0
          const shade = here ? 100 : Math.round(100 * (1 - way.shadiest.sun / way.shadiest.metres))
          return (
            <tr key={way.key}>
              <td>
                <House tones={group.tones} /> {way.label}
                <small>{places}</small>
              </td>
              <td>
                {way.fastest.metres === 0 ? 'You are there' : minutesText(way.fastest.minutes)}
                {way.fastest.metres > 0 && <small>{Math.round(way.fastest.sun)} m in sun</small>}
              </td>
              <td>
                {here ? 'You are there' : minutesText(way.shadiest.minutes)}
                {!here && (
                  <small>
                    {Math.round(way.shadiest.sun)} m in sun, {shade}% shade
                  </small>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function PlaceWay({ way }) {
  const group = USE_GROUPS.find((g) => g.key === way.key)
  if (!way.shadiest) {
    return (
      <p>
        <House tones={group.tones} /> That place is more than 15 minutes away.
      </p>
    )
  }
  const shadeOf = (w) => (w.metres === 0 ? 100 : Math.round(100 * (1 - w.sun / w.metres)))
  const same = way.fastest.sun === way.shadiest.sun
  return (
    <div className="place">
      <p>
        <House tones={group.tones} /> <strong>Your chosen place ({way.label.toLowerCase()})</strong>
      </p>
      <table>
        <thead>
          <tr>
            <th>Way</th>
            <th>Walk</th>
            <th>In the sun</th>
            <th>In shade</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Fastest</td>
            <td>{minutesText(way.fastest.minutes)}</td>
            <td>{Math.round(way.fastest.sun)} m</td>
            <td>{shadeOf(way.fastest)}%</td>
          </tr>
          <tr>
            <td>Shadiest</td>
            <td>{minutesText(way.shadiest.minutes)}</td>
            <td>{Math.round(way.shadiest.sun)} m</td>
            <td>{shadeOf(way.shadiest)}%</td>
          </tr>
        </tbody>
      </table>
      {same && <p className="small">No way within 15 minutes has less sun than the fastest one.</p>}
    </div>
  )
}

function ReachTable({ measured }) {
  if (!measured) return <p className="small">Measuring the areas…</p>
  return (
    <table>
      <thead>
        <tr>
          <th>Walk</th>
          <th>Buildings</th>
          <th>About residents</th>
        </tr>
      </thead>
      <tbody>
        {measured.areas.map((area, i) => (
          <tr key={area.minutes}>
            <td>
              <House tones={REACH[i]} /> {area.minutes} min
            </td>
            <td>{number(area.buildings)}</td>
            <td>
              {number(area.residents)}
              <small>
                {area.cellsWithoutFigure} {area.cellsWithoutFigure === 1 ? 'cell' : 'cells'} without a figure
              </small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function WhoMissesOut({ who, needs, chosen, onChoose }) {
  const result = who.table[chosen.need][chosen.test]
  const need = NEEDS.find((n) => n.key === chosen.need)
  const place = need.label.toLowerCase()
  const farthest = Math.max(...needs.nearest[chosen.need]) / 80

  let sentence
  if (result.residents === 0 && chosen.test !== 'shady') {
    sentence = `Nobody. No street in the kit is more than ${farthest.toFixed(1)} minutes from ${place}.`
  } else if (result.residents === 0) {
    sentence = `Nobody. Everyone has a way to ${place} with under 100 m in full sun.`
  } else if (chosen.test === 'shady') {
    sentence = `About ${number(result.residents)} residents have no way to ${place} within 15 minutes with under 100 m in full sun.`
  } else {
    sentence = `About ${number(result.residents)} residents live more than ${chosen.test === 'within5' ? 5 : 15} minutes from ${place}.`
  }

  return (
    <>
      <table className="choices">
        <thead>
          <tr>
            <th>Residents</th>
            {TESTS.map((t) => (
              <th key={t.key}>{t.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NEEDS.map((n) => (
            <tr key={n.key}>
              <td>{n.label}</td>
              {TESTS.map((t) => {
                const active = chosen.need === n.key && chosen.test === t.key
                return (
                  <td key={t.key}>
                    <button
                      className={active ? 'active' : ''}
                      aria-pressed={active}
                      onClick={() => onChoose({ need: n.key, test: t.key })}
                    >
                      {number(who.table[n.key][t.key].residents)}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p>{sentence}</p>
      {result.residents > 0 && (
        <p className="small">
          Their average age is {result.avgAge.toFixed(1)} (everyone: {who.everyone.avgAge.toFixed(1)}). Their average rent
          is €{result.avgRent.toFixed(2)} per m² (everyone: €{who.everyone.avgRent.toFixed(2)}). The pink squares on the map show where they live.
        </p>
      )}
      {result.residents > 0 && (
        <p className="small">
          {Math.round(result.edgeShare * 100)}% of them live in cells within 100 m of the kit's edge, where a place just outside the kit isn't counted, so they may not really miss out.
        </p>
      )}
      <p className="small">
        {needs.cellsLeftOut} census {needs.cellsLeftOut === 1 ? 'cell has' : 'cells have'} no resident figure and {needs.cellsLeftOut === 1 ? 'is' : 'are'} left out.
      </p>
    </>
  )
}

export default function App() {
  const [raw, setRaw] = useState(null)
  const [error, setError] = useState(null)
  const [dayNumber, setDayNumber] = useState(QUICK_DAYS[0].number)
  const [minutes, setMinutes] = useState(17 * 60)
  const [start, setStart] = useState(null)
  const [place, setPlace] = useState(null)
  const [notice, setNotice] = useState(null)
  const [chosen, setChosen] = useState({ need: 'food', test: 'within15' })
  const [mode, setMode] = useState('sun')
  const [fabrikPinned, setFabrikPinned] = useState(false) // the Fabrik's name stays on after a click on it
  const [strikes, setStrikes] = useState(0) // counts street clicks in the rain, each one strikes lightning
  const raining = mode === 'rain'

  useEffect(() => {
    loadKit().then(setRaw).catch((e) => setError(e.message))
  }, [])

  const city = useMemo(() => raw && buildCity(raw), [raw])
  const needs = useMemo(() => city && buildNeeds(city), [city])
  const storm = useStorm(city, raining)

  const day = useMemo(() => dayFromNumber(dayNumber), [dayNumber])
  const range = useMemo(() => city && daylight(day, city.center), [city, day])
  const time = range ? Math.min(range.end, Math.max(range.start, minutes)) : minutes

  const sun = useMemo(() => city && sunAt(day, time, city.center), [city, day, time])
  const sunDir = useMemo(() => sun && sunDirection(sun), [sun])
  const shade = useMemo(() => city && computeShade(city, sun), [city, sun])
  const sunny = useMemo(() => city && sunnyMetres(city, shade), [city, shade])

  const walked = useMemo(() => (city && start !== null ? walk(city, start) : null), [city, start])
  const measured = useMeasure(raw, walked)
  const ways = useMemo(
    () => (city && start !== null ? waysToNeeds(city, needs, start, sunny) : null),
    [city, needs, start, sunny],
  )
  const placeWay = useMemo(() => {
    if (!city || start === null || place === null) return null
    const key = needs.needOfBuilding[place]
    const label = NEEDS.find((n) => n.key === key).label
    return { key, label, ...waysToPlace(city, start, needs.nodeOfBuilding.get(place), sunny) }
  }, [city, needs, start, place, sunny])
  const who = useMemo(() => city && whoMissesOut(city, needs, sunny), [city, needs, sunny])

  const missing = useMemo(() => {
    if (!who) return []
    return [...who.table[chosen.need][chosen.test].byCell].map(([cell, share]) => ({ cell, share }))
  }, [who, chosen])

  const stormScene = useMemo(
    () =>
      raining && storm.world
        ? {
            factory: storm.world.factory,
            factoryCentre: storm.world.factoryCentre,
            lit: storm.view.lit,
            floodLines: storm.view.floodLines,
            route: storm.view.route,
            focus: storm.view.focus,
            placed: storm.view.placed,
            started: storm.view.phase !== 'placing' && storm.view.phase !== 'ready',
            thought: storm.view.thought,
            thinking: storm.view.thinking,
            chatter: storm.view.chatter,
            fabrikPinned,
            rainStrength: storm.view.rainStrength,
          }
        : null,
    [raining, storm.world, storm.view, fabrikPinned],
  )

  const pick = (point, building) => {
    if (raining) {
      // A click on the Fabrik shows or hides its name. Any other click hides it and goes to the story.
      if (building !== null && building === storm.world?.factory) {
        setFabrikPinned((shown) => !shown)
        return
      }
      setFabrikPinned(false)
      if (storm.click(point) === 'street') setStrikes((n) => n + 1)
      return
    }
    // Once you have a start, a food, health or school building becomes the place to walk to.
    if (start !== null && building !== null && needs.needOfBuilding[building]) {
      setNotice(null)
      setPlace(building)
      return
    }
    const node = findStart(city, point)
    if (node === null) {
      setNotice('There is no walkable street within 100 m of that point. Try closer to the streets.')
      return
    }
    setNotice(null)
    setPlace(null)
    setStart(node)
  }

  if (error) return <p className="notice error">The city kit didn't load ({error}).</p>
  if (!city) return <p className="notice">Loading the city…</p>

  return (
    <div className="app">
      <section className="panel">
        <header>
          <h1>Daily needs in the shade</h1>
          <p className="subtitle">Assessing Access to Daily Needs, Spatial Inequalities and Heat-Resilient Walking Routes in Weimar’s 15-Minute City</p>
        </header>

        <div className="chips mode" role="group" aria-label="Choose a map">
          <button className={raining ? '' : 'active'} aria-pressed={!raining} onClick={() => setMode('sun')}>
            Sun and shade
          </button>
          <button className={raining ? 'active' : ''} aria-pressed={raining} onClick={() => setMode('rain')}>
            Rainy evening
          </button>
        </div>

        {raining ? (
          <StormPanel storm={storm} />
        ) : (
          <>
        {notice && <p className="hint alert">{notice}</p>}
        {start === null && !notice && <p className="hint">Click anywhere on the map to start your walk.</p>}

        {ways && (
          <>
            <p className="small">Click an orange, pink or blue building for the shadiest way to it. Click anywhere else to move your start.</p>
            {placeWay && <PlaceWay way={placeWay} />}
            <h2>From your point</h2>
            <p className="small">The nearest of each need, and the way to any of them with the least sun.</p>
            <WaysTable ways={ways} />
            <ReachTable measured={measured} />
          </>
        )}

        <h2>Who misses out</h2>
        <p className="small">Pick a number to see those residents on the map.</p>
        <WhoMissesOut who={who} needs={needs} chosen={chosen} onChoose={setChosen} />

        <h2>Sun</h2>
        <div className="chips">
          {QUICK_DAYS.map((d) => (
            <button
              key={d.number}
              className={d.number === dayNumber ? 'active' : ''}
              aria-pressed={d.number === dayNumber}
              onClick={() => setDayNumber(d.number)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <label className="date">
          <span>{day.label}</span>
          <input
            type="range"
            aria-label="Date"
            min={1}
            max={365}
            value={dayNumber}
            onChange={(e) => setDayNumber(Number(e.target.value))}
          />
        </label>
        <label className="time">
          <span>{clockTime(time)}</span>
          <input
            type="range"
            aria-label="Time of day"
            min={range.start}
            max={range.end}
            step={5}
            value={time}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
        <p className="small">
          The sun stands {Math.round((sun.altitude * 180) / Math.PI)}° above the horizon, in the {compassWord(sun.azimuth)}.{' '}
          {Math.round(shadeShare(city, sunny) * 100)}% of all streets are in shade.
        </p>

        <h2>How it works</h2>
        <ul className="method">
          <li>
            You walk at 4.8 km/h, which is 80 m a minute, along the pedestrian network, from the nearest junction to your
            click. Each area is the street reached in that time with a band of 25 m on each side, joined into one shape.
          </li>
          <li>
            Residents in an area: each census cell's population times the share of the cell inside, added up and rounded to
            the nearest 10. Cells without a figure aren't zero, so they are left out and counted next to the sum.
          </li>
          <li>
            The sun's position comes from the date, the clock time and Weimar's location, and it casts the shadows you see.
            A street is in shade if a building blocks the line from a person's head (1.5 m up) to the sun, tested every 5 m.
            The shadiest way is the walk of up to 15 minutes, to any place with that need, with the fewest metres in the sun.
          </li>
          <li>
            Who misses out: each census cell is split into 25 squares, and each square counts from its nearest junction.
            "No shady way" means the best walk has more than 100 m in the sun. That 100 m is a chosen limit, not a measurement.
          </li>
        </ul>
        <h2>Limits</h2>
        <ul className="method">
          <li>Only buildings cast shade: the kit has no trees, so parks and tree-lined streets look sunnier than they are. The ground counts as flat.</li>
          <li>Food means cafés and restaurants: food shops are inside "retail" and can't be told apart. School means all education buildings, including the university.</li>
          <li>Places count as reached at the junction nearest their middle, as the kit has no entrances. Nothing outside the kit is counted, so walks and places stop at its edge, and people near the edge may only seem to miss out.</li>
          <li>Roofs are drawn flat because the kit only has one height per building, measured to the top of the roof.</li>
        </ul>
          </>
        )}
      </section>

      <section className="map" aria-label="3D map of Weimar">
        <Scene
          city={city}
          needOfBuilding={needs.needOfBuilding}
          sunDir={sunDir}
          shade={shade}
          tiers={raining ? undefined : measured?.tiers}
          areas={raining ? undefined : measured?.areas}
          ways={raining ? null : ways}
          placeWay={raining ? null : placeWay}
          missing={raining ? [] : missing}
          startPoint={!raining && start !== null ? city.nodes[start] : null}
          storm={stormScene}
          stormPosition={storm.position}
          onPick={pick}
        />
        <p className="attribution">{ATTRIBUTION}</p>
      </section>

      {raining ? <StormLegend /> : <Legend />}
      {raining && strikes > 0 && <Lightning key={strikes} />}
    </div>
  )
}
