import { buildCity } from './city.js'
import { measure } from './measure.js'

// Runs the slow measuring in the background, so the page stays smooth while it happens.
let city = null

self.onmessage = ({ data }) => {
  if (data.raw) {
    city = buildCity(data.raw)
    return
  }
  self.postMessage({ id: data.id, ...measure(city, data.walked) })
}
