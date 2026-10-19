import { describe, expect, it } from 'vitest'
import { parseImport } from './import'

describe('parseImport', () => {
  it('reads front<TAB>back lines and skips the rest', () => {
    const text = [
      '#separator:tab', // Anki header
      '#html:false',
      'hola\thello',
      '  gato \t cat \t tag1 tag2', // extra Anki column (tags) ignored, spaces trimmed
      '',
      'no tab here',
      'perro\t', // empty back
      '\tempty front',
      'la casa\tthe house\r', // Windows line ending
    ].join('\n')
    expect(parseImport(text)).toEqual({
      cards: [
        { front: 'hola', back: 'hello' },
        { front: 'gato', back: 'cat' },
        { front: 'la casa', back: 'the house' },
      ],
      skipped: 3,
    })
  })
})
