import { CAN_THINK } from './useStorm.js'

function Bar({ label, value }) {
  return (
    <label className="bar">
      <span>{label}</span>
      <progress max={100} value={Math.round(value)} />
      <b>{Math.round(value)}</b>
    </label>
  )
}

function Entry({ entry }) {
  if (entry.kind !== 'thought') {
    return (
      <li className={`entry ${entry.kind}`}>
        {entry.clock && <time>{entry.clock}</time>} {entry.text}
      </li>
    )
  }
  return (
    <li className={`entry thought ${entry.ok ? '' : 'refused'}`}>
      <time>{entry.clock}</time>
      <dl>
        <dt>Noticed</dt>
        <dd>{entry.noticed}</dd>
        <dt>Did</dt>
        <dd>{entry.did}</dd>
        <dt>Why</dt>
        <dd>
          {entry.shock && <strong className="shock">{entry.shock}</strong>} {entry.why}
        </dd>
      </dl>
      <details>
        <summary>What the app sent ({entry.seconds?.toFixed(1)} s to answer)</summary>
        <pre>{JSON.stringify(entry.sent, null, 1)}</pre>
      </details>
    </li>
  )
}

export default function StormPanel({ storm }) {
  const { view, start, reset } = storm
  const running = view.phase === 'walking' || view.phase === 'sheltering'

  return (
    <>
      {!CAN_THINK && <p className="live-note">The family only thinks on localhost. Here they just follow the shortest way.</p>}
      {view.notice && <p className="hint alert">{view.notice}</p>}
      {!view.notice && view.phase === 'placing' && <p className="hint">Click a street to place the family.</p>}
      {!view.notice && view.phase === 'ready' && <p className="hint">Press Start, or click again to move them.</p>}
      {!view.notice && running && <p className="hint">You are the storm. Click a street to flood it. Click it again to clear it.</p>}
      {!view.notice && view.phase === 'arrived' && <p className="hint">They made it to the Fabrik.</p>}

      <div className="storm-actions">
        {(view.phase === 'ready' || view.phase === 'placing') && (
          <button className="active" disabled={view.phase === 'placing'} onClick={start}>
            Start
          </button>
        )}
        {(running || view.phase === 'arrived') && <button onClick={reset}>Start again</button>}
      </div>

      {view.phase !== 'placing' && view.phase !== 'ready' && (
        <>
          <h2>
            The family <span className="clock">{view.clock}</span>
          </h2>
          <p className="status">
            {view.phase === 'arrived' ? 'Inside the Fabrik' : view.heading}
            {view.waiting && ', stopped at the water'}. Rain: {view.rain}.
          </p>
          <Bar label="Wet" value={view.wet} />
          <Bar label="Tired" value={view.tired} />
          <h2>What the family thinks</h2>
          {view.thinking && <p className="small thinking">Thinking…</p>}
          <ol className="log">
            {view.log.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ol>
        </>
      )}

      <h2>How it works</h2>
      <ul className="method">
        <li>
          On your laptop, the app describes the moment to Claude, which plays the father and chooses one action: keep going,
          go around, shelter or head out. The app carries it out, and the log shows what was noticed, what was done and why.
          He was born and raised in Weimar and has never seen it flood, so each time he changes his route he says one
          shocked German word, chosen from a fixed list.
        </li>
        <li>
          The family thinks when the walk starts, when a street floods on their way, when they get very wet, when they reach
          a shelter, and every 30 seconds if nothing else happens (every 10 seconds while sheltering). Never more than once in 4 seconds, or 30 times in a walk.
        </li>
        <li>
          While Claude decides, the father's bubble shows one of his everyday lines instead of "Thinking…": a walking line on
          the street, a drying-off line inside a shelter. These lines are written in advance and picked at random; only his
          decisions and reasons come from Claude.
        </li>
        <li>Each click on a street strikes lightning. It's only an effect: it changes nothing in the story.</li>
        <li>Time runs at 16 times normal speed. They walk 60 m a minute, slower than the sun map's 80 m, because of the pram.</li>
      </ul>
      <h2>What's real and what's imagined</h2>
      <ul className="method">
        <li>Real: the streets and the buildings, their heights and their uses, from the city kit. The sunset time, from the same sun calculation as the sun map, for 7 November.</li>
        <li>
          Imagined: the rain, the floods and the family, and how wet and tired they get. The factory too: in this story, the Fabrik
          stands where the Weimar Atrium shopping centre is today, at Friedensstraße 1. The amber building is the Atrium's real
          footprint from the kit. It isn't really an abandoned factory or a community centre.
        </li>
        <li>Which buildings are open is a guess from their use: cafés and restaurants, hotels, venues, cultural and transport buildings. Places count as reached at the street junction nearest their middle, as the kit has no entrances.</li>
      </ul>
    </>
  )
}
