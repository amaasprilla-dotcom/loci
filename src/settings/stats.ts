// Settings → Stats (SPEC-v5-now.md, "Event log"): how often the Now card gets started,
// seen here once in a while rather than on the home screen.

import { h } from '../dom'
import { formatNumber } from '../locale'
import { eventsCsv, startRate } from '../now/events'
import { button } from '../sheet'
import { download } from './backup'

export async function statsSection(): Promise<HTMLElement> {
  const { started, shown } = await startRate(Date.now())
  return h(
    'section',
    { class: 'settings-section' },
    h('h2', {}, 'Stats'),
    h(
      'p',
      { class: 'settings-text' },
      shown === 0
        ? 'Nothing logged yet. Each time the Now card shows something, Loci notes whether you started it within 10 minutes.'
        : `Started within 10 minutes of being shown, last 7 days: ${formatNumber(started)} of ${formatNumber(shown)}.`,
    ),
    button('Export activity log (CSV)', () => void exportLog()),
  )
}

async function exportLog() {
  download(new Blob([await eventsCsv()], { type: 'text/csv' }), `loci-activity-${new Date().toISOString().slice(0, 10)}.csv`)
}
