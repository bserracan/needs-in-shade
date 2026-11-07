// Colours from the illustration style guide: one hue family per group, three tones each.
const ORANGE = { roof: '#FBC77A', wall: '#F6A623', shade: '#D98A10' }
const PINK = { roof: '#F2A3B9', wall: '#E8638A', shade: '#C94A70' }
const GREEN = { roof: '#7CC47F', wall: '#2EA44F', shade: '#1F7D3B' }
const BLUE = { roof: '#8EC9EE', wall: '#2FA6E0', shade: '#1D82B8' }
const GREY_TEAL = { roof: '#A9B8BD', wall: '#5F8F9B', shade: '#4A6E78' }
const YELLOW = { roof: '#FFF6A8', wall: '#F5E663', shade: '#D9C93E' }
const TEAL = { roof: '#4FC3C3', wall: '#22A2A2', shade: '#187F7F' }
const RED = { roof: '#F0645A', wall: '#E53A2F', shade: '#B82A21' }
const NEUTRAL = { roof: '#E2E4DE', wall: '#C6CAC2', shade: '#A9AEA5' } // not in the guide: unknown use carries no hue

// The kit knows what a building is used for, not its housing type, so the guide's hues are given to uses.
// The purple family is kept for the walking areas.
export const USE_GROUPS = [
  { key: 'food', label: 'Food', uses: ['food_and_drink'], tones: ORANGE },
  { key: 'health', label: 'Health', uses: ['health'], tones: PINK },
  { key: 'school', label: 'School / education', uses: ['education'], tones: BLUE },
  { key: 'home', label: 'Residential', uses: ['residential'], tones: GREY_TEAL },
  { key: 'retail', label: 'Retail', uses: ['retail'], tones: YELLOW },
  { key: 'work', label: 'Office, service, transport, light industry', uses: ['office', 'service', 'transport', 'light_industrial'], tones: GREEN },
  { key: 'public', label: 'Civic, culture, sport', uses: ['civic', 'culture', 'sport'], tones: TEAL },
  { key: 'visit', label: 'Accommodation, entertainment', uses: ['accommodation', 'entertainment'], tones: RED },
  { key: 'unknown', label: 'Use not known', uses: ['undefined'], tones: NEUTRAL },
]

// Darkest for the shortest walk.
export const REACH = [
  { roof: '#7A6CAE', wall: '#5B4C94', shade: '#46397A' },
  { roof: '#B9AEDD', wall: '#9A8CCB', shade: '#7A6CAE' },
  { roof: '#E0DAF2', wall: '#C9C0E6', shade: '#ADA2D3' },
]

export const MAGENTA = '#E5007E'
export const STREET_SUN = '#FFFFFF'
export const STREET_SHADE = '#6F7C92'
export const OUTSIDE = '#F8F9F1'

export const GROUND = {
  default: '#EEF3DC',
  recreation: '#DDEBC2',
  cemetery: '#E2EBCB',
  square: '#F7F6F0',
  'flowing water': '#D3E7EE',
  'standing water': '#D3E7EE',
}
export const PLOT_LINE = '#CFDFAE'

// The rainy evening: cool blue-grey everywhere, with warm light as the only accent.
export const NIGHT = {
  outside: '#141A28',
  building: { roof: '#3A4661', wall: '#2B354C', shade: '#222A3E' },
  buildingLine: '#55617D',
  factory: { roof: '#FFC46B', wall: '#F6A623', shade: '#D98A10' },
  lit: { roof: '#FFE7A8', wall: '#FFD36B', shade: '#E8B54C' },
  plotLine: '#232C40',
  street: '#7E8CA8',
  flood: '#38B6FF',
  route: '#FFC46B',
  rain: '#C5D8F2',
  ground: {
    default: '#1A2133',
    recreation: '#1D2B2E',
    cemetery: '#1D2B2E',
    square: '#232B3F',
    'flowing water': '#173049',
    'standing water': '#173049',
  },
}
