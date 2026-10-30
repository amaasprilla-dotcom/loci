import { describe, expect, it } from 'vitest'
import { formatKey, generateKey, incomingWins, isSyncedTable, KEY_ALPHABET, KEY_LENGTH, normalizeKey } from './rules'

describe('incomingWins', () => {
  it('lets the later change win', () => {
    expect(incomingWins({ changedAt: 200, device: 'a' }, { changedAt: 100, device: 'b' })).toBe(true)
    expect(incomingWins({ changedAt: 100, device: 'b' }, { changedAt: 200, device: 'a' })).toBe(false)
  })

  it('wins when there is nothing yet', () => {
    expect(incomingWins({ changedAt: 0, device: 'a' }, undefined)).toBe(true)
  })

  it('breaks ties by the larger device id, the same way from either side', () => {
    expect(incomingWins({ changedAt: 100, device: 'b' }, { changedAt: 100, device: 'a' })).toBe(true)
    expect(incomingWins({ changedAt: 100, device: 'a' }, { changedAt: 100, device: 'b' })).toBe(false)
  })

  it('does not let the very same change win twice', () => {
    expect(incomingWins({ changedAt: 100, device: 'a' }, { changedAt: 100, device: 'a' })).toBe(false)
  })
})

describe('sync keys', () => {
  it('are 24 characters from the alphabet, different every time', () => {
    const keys = Array.from({ length: 50 }, generateKey)
    for (const key of keys) {
      expect(key).toHaveLength(KEY_LENGTH)
      for (const char of key) expect(KEY_ALPHABET).toContain(char)
    }
    expect(new Set(keys).size).toBe(50)
  })

  it('leave out look-alike characters', () => {
    for (const char of '01OIL') expect(KEY_ALPHABET).not.toContain(char)
  })

  it('are shown in groups of four', () => {
    expect(formatKey('ABCDEFGHJKMNPQRSTUVWXYZ2')).toBe('ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2')
  })

  it('ignore spaces, dashes and case when typed', () => {
    const key = generateKey()
    expect(normalizeKey(formatKey(key))).toBe(key)
    expect(normalizeKey(` ${formatKey(key).toLowerCase().replaceAll('-', ' ')} `)).toBe(key)
  })

  it('reject the wrong length or characters outside the alphabet', () => {
    expect(normalizeKey('ABCD')).toBeNull()
    expect(normalizeKey('ABCDEFGHJKMNPQRSTUVWXYZ0')).toBeNull()
    expect(normalizeKey('')).toBeNull()
  })
})

describe('synced tables', () => {
  it('include content and settings, not sync bookkeeping', () => {
    expect(isSyncedTable('notes')).toBe(true)
    expect(isSyncedTable('settings')).toBe(true)
    expect(isSyncedTable('syncOutbox')).toBe(false)
    expect(isSyncedTable('syncState')).toBe(false)
  })
})
