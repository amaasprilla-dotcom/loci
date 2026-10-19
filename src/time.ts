// Short, friendly times: "in 5m", "in 3h", "in 2d", "in 4mo".

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export function formatIn(ms: number): string {
  if (ms < MIN) return 'in <1m'
  if (ms < HOUR) return `in ${Math.round(ms / MIN)}m`
  if (ms < DAY) return `in ${Math.round(ms / HOUR)}h`
  if (ms < 60 * DAY) return `in ${Math.round(ms / DAY)}d`
  return `in ${Math.round(ms / (30 * DAY))}mo`
}
