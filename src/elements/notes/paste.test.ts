import { describe, expect, it } from 'vitest'
import { keepStyle, looksLikeMarkdown } from './paste'

describe('keepStyle', () => {
  it('keeps colors, drops black text', () => {
    expect(keepStyle('color', '#ff0000')).toBe(true)
    expect(keepStyle('color', 'rgb(17, 85, 204)')).toBe(true)
    expect(keepStyle('color', '#000000')).toBe(false)
    expect(keepStyle('color', 'rgb(31, 31, 31)')).toBe(false)
    expect(keepStyle('color', 'windowtext')).toBe(false)
  })

  it('keeps highlights, drops no background', () => {
    expect(keepStyle('background-color', '#ffff00')).toBe(true)
    expect(keepStyle('background-color', 'transparent')).toBe(false)
    expect(keepStyle('background-color', 'rgba(0, 0, 0, 0)')).toBe(false)
    expect(keepStyle('background-color', '#ffffff')).toBe(false)
  })

  it('keeps sizes that stand out, drops body-text sizes', () => {
    expect(keepStyle('font-size', '11pt')).toBe(false)
    expect(keepStyle('font-size', '16px')).toBe(false)
    expect(keepStyle('font-size', '20pt')).toBe(true)
    expect(keepStyle('font-size', '9px')).toBe(true)
    expect(keepStyle('font-size', 'medium')).toBe(false)
  })

  it('drops fonts, keeps everything else', () => {
    expect(keepStyle('font-family', 'Arial')).toBe(false)
    expect(keepStyle('font-weight', '700')).toBe(true)
    expect(keepStyle('text-align', 'center')).toBe(true)
  })
})

describe('looksLikeMarkdown', () => {
  it('spots Markdown', () => {
    expect(looksLikeMarkdown('# Title\nSome text')).toBe(true)
    expect(looksLikeMarkdown('Intro\n\n- one\n- two')).toBe(true)
    expect(looksLikeMarkdown('This is **important**.')).toBe(true)
    expect(looksLikeMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true)
    expect(looksLikeMarkdown('See [the docs](https://example.com)')).toBe(true)
  })

  it('leaves ordinary text alone', () => {
    expect(looksLikeMarkdown('Just a sentence, with a * in it.')).toBe(false)
    expect(looksLikeMarkdown('#hashtag and 3.5 apples')).toBe(false)
  })
})
