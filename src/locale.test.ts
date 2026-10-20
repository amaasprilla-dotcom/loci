import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DAY, newSrs, outcomes, review } from './elements/flashcards/srs'
import { count, firstDayOfWeek, formatBytes, formatNumber, getNumberFormat, loadLocaleSettings, parseNumber, setNumberFormat } from './locale'

describe('number format', () => {
  it('1,234.5 and 1.234,5 format and parse their own way', async () => {
    await setNumberFormat('dot')
    expect(formatNumber(1234.5)).toBe('1,234.5')
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(count(1234, 'card', 'cards')).toBe('1,234 cards')

    await setNumberFormat('comma')
    expect(formatNumber(1234.5)).toBe('1.234,5')
    expect(parseNumber('1.234,5')).toBe(1234.5)
    expect(parseNumber('0,75')).toBe(0.75)
    expect(count(1, 'card', 'cards')).toBe('1 card')
  })

  it('rejects what isn’t a number', async () => {
    await setNumberFormat('dot')
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('-2.5')).toBe(-2.5)
  })

  it('is remembered in settings', async () => {
    await setNumberFormat('comma')
    await loadLocaleSettings()
    expect(getNumberFormat()).toBe('comma')
    await setNumberFormat('auto')
  })

  it('sizes read naturally', async () => {
    await setNumberFormat('dot')
    expect([formatBytes(512), formatBytes(2048), formatBytes(5.5 * 1024 * 1024)]).toEqual(['512 B', '2 KB', '5.5 MB'])
  })
})

describe('first day of the week', () => {
  it('is Sunday in the US and Monday in Italy', () => {
    expect(firstDayOfWeek('en-US')).toBe(7)
    expect(firstDayOfWeek('it-IT')).toBe(1)
  })
})

describe('desired retention', () => {
  it('a higher target schedules reviews sooner', () => {
    const now = new Date(2026, 0, 10, 15).getTime()
    let srs = review(review(newSrs(now - 20 * DAY), 2, now - 20 * DAY), 2, now - 20 * DAY + 600_000)
    srs = review(srs, 2, now - 10 * DAY)
    const relaxed = outcomes(srs, now, 0.8)[2].scheduled_days
    const strict = outcomes(srs, now, 0.95)[2].scheduled_days
    expect(strict).toBeLessThan(relaxed)
  })
})
