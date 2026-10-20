// Numbers, dates and weeks in the user's format (SPEC-v2.md, "Locale and number format").
// The number format follows the device unless set in Settings: Auto, 1,234.5 or 1.234,5.
// Dates and times always follow the device, through Intl.DateTimeFormat.

import { db } from './store/db'

export type NumberFormatPref = 'auto' | 'dot' | 'comma'
const PREFS: NumberFormatPref[] = ['auto', 'dot', 'comma']
const SETTING_KEY = 'numberFormat'

let pref: NumberFormatPref = 'auto'
const formatters = new Map<string, Intl.NumberFormat>()

// Read once at start, before anything is drawn.
export async function loadLocaleSettings(): Promise<void> {
  const row = await db.settings.get(SETTING_KEY)
  pref = PREFS.includes(row?.value as NumberFormatPref) ? (row!.value as NumberFormatPref) : 'auto'
  formatters.clear()
}

export function getNumberFormat(): NumberFormatPref {
  return pref
}

export async function setNumberFormat(next: NumberFormatPref): Promise<void> {
  pref = next
  formatters.clear()
  await db.settings.put({ key: SETTING_KEY, value: next, updatedAt: Date.now() })
}

export function deviceLocale(): string {
  return Intl.NumberFormat().resolvedOptions().locale
}

// A locale that formats numbers the chosen way.
export function numberLocale(): string {
  if (pref === 'dot') return 'en-US' // 1,234.5
  if (pref === 'comma') return 'de-DE' // 1.234,5
  return deviceLocale()
}

export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}): string {
  const key = numberLocale() + JSON.stringify(options)
  let f = formatters.get(key)
  if (!f) formatters.set(key, (f = new Intl.NumberFormat(numberLocale(), options)))
  return f.format(n)
}

// "1 card", "1.234 cards"
export function count(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

export function separators(): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(numberLocale()).formatToParts(12345.6)
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  }
}

// Reads a number typed in the chosen format ("1.234,5" or "1,234.5"); null if it isn't one.
export function parseNumber(text: string): number | null {
  const { group, decimal } = separators()
  let s = text.trim().replace(/[\s  ]/g, '')
  if (!s) return null
  s = s.split(group).join('')
  if (decimal !== '.') s = s.replace(decimal, '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null
  return Number(s)
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${formatNumber(value, { maximumFractionDigits: value < 10 && i > 0 ? 1 : 0 })} ${units[i]}`
}

// First day of the week for the device's locale: 1 = Monday … 7 = Sunday (Sunday in the US).
export function firstDayOfWeek(locale = deviceLocale()): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    if (info) return info.firstDay
  } catch {
    // fall through
  }
  const region = new Intl.Locale(locale).maximize().region
  return region && ['US', 'CA', 'MX', 'BR', 'JP', 'IL', 'PH', 'IN', 'ZA'].includes(region) ? 7 : 1
}
