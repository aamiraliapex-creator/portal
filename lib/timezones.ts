// Maps a US state (full name or abbreviation) to its primary IANA timezone.
// Falls back to America/Los_Angeles (the org's home base) when unknown.
const STATE_TZ: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Denver',
  IL: 'America/Chicago', IN: 'America/New_York', IA: 'America/Chicago', KS: 'America/Chicago',
  KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/New_York', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles',
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York',
}
const NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

export const DEFAULT_TZ = 'America/Los_Angeles'
export const OFFICE_TZ = 'America/New_York'

export function stateToTz(state?: string | null): string {
  if (!state) return DEFAULT_TZ
  const s = state.trim()
  if (s.length === 2) return STATE_TZ[s.toUpperCase()] || DEFAULT_TZ
  const abbr = NAME_TO_ABBR[s.toLowerCase()]
  return (abbr && STATE_TZ[abbr]) || DEFAULT_TZ
}

const TZ_ABBR: Record<string, string> = {
  'America/Los_Angeles': 'PT', 'America/Denver': 'MT', 'America/Phoenix': 'MT',
  'America/Chicago': 'CT', 'America/New_York': 'ET', 'America/Anchorage': 'AKT',
  'Pacific/Honolulu': 'HT',
}
export function tzAbbr(tz: string): string {
  return TZ_ABBR[tz] || tz.split('/').pop() || tz
}

export function formatInTz(iso: string, tz: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${date} · ${time} ${tzAbbr(tz)}`
}

export function formatTimeInTz(iso: string, tz: string): string {
  const d = new Date(iso)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
  return `${time} ${tzAbbr(tz)}`
}

// Converts a UTC instant into a "YYYY-MM-DDTHH:mm" wall-clock string as seen in `tz`,
// suitable for pre-filling an <input type="datetime-local">.
export function utcToLocalInputValue(iso: string, tz: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

// Converts a "YYYY-MM-DDTHH:mm" wall-clock string, interpreted as local time in `tz`,
// into an ISO UTC instant string.
export function localInputToUtcIso(local: string, tz: string): string {
  const asUtcGuess = new Date(local + ':00Z')
  const tzWall = new Date(asUtcGuess.toLocaleString('en-US', { timeZone: tz }))
  const utcWall = new Date(asUtcGuess.toLocaleString('en-US', { timeZone: 'UTC' }))
  const offset = utcWall.getTime() - tzWall.getTime()
  return new Date(asUtcGuess.getTime() + offset).toISOString()
}
