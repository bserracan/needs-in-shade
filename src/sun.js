const RAD = Math.PI / 180

// Shortcuts to useful dates, as the day's number in the year.
export const QUICK_DAYS = [
  { label: '1 June', number: 152 },
  { label: '21 June', number: 172 },
  { label: '21 Sept', number: 264 },
  { label: '21 Dec', number: 355 },
]

// Summer time in 2026 runs from 29 March to 25 October: Weimar's clock is then 2 hours ahead of UTC, otherwise 1.
const SUMMER_TIME_START = Date.UTC(2026, 2, 29)
const SUMMER_TIME_END = Date.UTC(2026, 9, 25)

// A day of the year, from 1 (1 January) to 365 (31 December).
export function dayFromNumber(number) {
  const date = Date.UTC(2026, 0, number)
  return {
    date,
    utcOffset: date >= SUMMER_TIME_START && date < SUMMER_TIME_END ? 2 : 1,
    label: new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }),
  }
}

// Below this height the sun is too low to give a useful shadow, so the time slider stops there.
const LOWEST_SUN = 3 * RAD

// Where the sun stands at a clock time (minutes after midnight in Weimar).
// Altitude is the angle above the horizon. Azimuth is the compass bearing, clockwise from north. Both in radians.
export function sunAt(day, minutes, [lon, lat]) {
  const utc = day.date + (minutes - day.utcOffset * 60) * 60000
  const d = utc / 86400000 + 2440587.5 - 2451545 // days since the year 2000 reference date

  const anomaly = (357.529 + 0.98560028 * d) * RAD
  const meanLon = 280.459 + 0.98564736 * d
  const eclipticLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD
  const tilt = (23.439 - 0.00000036 * d) * RAD

  const rightAscension = Math.atan2(Math.cos(tilt) * Math.sin(eclipticLon), Math.cos(eclipticLon))
  const declination = Math.asin(Math.sin(tilt) * Math.sin(eclipticLon))
  const siderealDegrees = (18.697374558 + 24.06570982441908 * d) * 15
  const hourAngle = siderealDegrees * RAD + lon * RAD - rightAscension

  const latR = lat * RAD
  const altitude = Math.asin(
    Math.sin(latR) * Math.sin(declination) + Math.cos(latR) * Math.cos(declination) * Math.cos(hourAngle),
  )
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(declination) * Math.cos(latR) - Math.sin(latR) * Math.cos(hourAngle),
  )
  return { altitude, azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI) }
}

// The first and last clock times of the day with the sun high enough, in 5-minute steps.
export function daylight(day, center) {
  let start = null
  let end = null
  for (let m = 0; m < 24 * 60; m += 5) {
    if (sunAt(day, m, center).altitude >= LOWEST_SUN) {
      if (start === null) start = m
      end = m
    }
  }
  return { start, end }
}

// A unit arrow pointing at the sun, in the 3D scene's axes: x east, y up, z south.
export function sunDirection({ altitude, azimuth }) {
  return [
    Math.sin(azimuth) * Math.cos(altitude),
    Math.sin(altitude),
    -Math.cos(azimuth) * Math.cos(altitude),
  ]
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

export function compassWord(azimuth) {
  return COMPASS[Math.round(azimuth / (Math.PI / 4)) % 8]
}

export function clockTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
