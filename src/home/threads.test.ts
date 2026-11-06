import { describe, expect, it } from 'vitest'
import { groupOf, tagEdges } from './threads'

const l = (id: string, tagIds: string[], x: number, y = 0) => ({ id, tagIds, x, y })

describe('tagEdges', () => {
  it('joins a tag of n loci with n - 1 lines, nearest first', () => {
    const loci = [l('a', ['t'], 0), l('b', ['t'], 10), l('c', ['t'], 20), l('d', ['t'], 30), l('e', ['t'], 40)]
    const edges = tagEdges(loci)
    expect(edges).toHaveLength(4)
    expect(edges.map((e) => `${e.a}${e.b}`).sort()).toEqual(['ab', 'bc', 'cd', 'de'])
  })

  it('draws one line for a pair sharing several tags', () => {
    const edges = tagEdges([l('a', ['t', 'u'], 0), l('b', ['u', 't'], 10)])
    expect(edges).toHaveLength(1)
    expect(edges[0].tagIds.sort()).toEqual(['t', 'u'])
  })

  it('leaves loci alone on their tag', () => {
    expect(tagEdges([l('a', ['t'], 0), l('b', ['u'], 10), l('c', [], 5)])).toEqual([])
  })
})

describe('groupOf', () => {
  const loci = [l('a', ['t'], 0), l('b', ['t', 'u'], 10), l('c', ['u'], 20), l('d', [], 30)]
  it('takes every locus sharing a tag', () => {
    expect(groupOf('b', loci, null).sort()).toEqual(['a', 'c'])
    expect(groupOf('a', loci, null)).toEqual(['b'])
    expect(groupOf('d', loci, null)).toEqual([])
  })
  it('moves alone while a tag is selected', () => {
    expect(groupOf('b', loci, 't')).toEqual([])
  })
})
