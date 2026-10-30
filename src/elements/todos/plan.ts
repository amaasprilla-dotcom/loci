// Checking if-then plans (SPEC-v3-coach.md, "Rejecting vague plans"). A plan works
// when the action is something you can physically start, with a size, at a set
// moment. These checks are deliberately simple word lists (English first, all in
// this file so they can be translated); they catch the common vague plans, and
// the user can always keep a plan as written.

import type { Level, TodoPlan, When } from '../../types'

export interface PlanProblem {
  id: 'vagueVerb' | 'noVerb' | 'vagueWords' | 'noSize' | 'noWhen' | 'tooBig' | 'vagueBackup'
  field: 'action' | 'when' | 'backup'
  message: string
  hint: string
}

export interface PlanInput {
  title: string
  when: When | null // null: not chosen yet (not a problem: the form asks for one)
  difficulty: Level
  plan?: TodoPlan
}

// Starts that say what you'll think about, not what you'll do.
const VAGUE_STARTS = ['work on', 'focus on', 'deal with', 'think about', 'get into', 'get better', 'get on with', 'try to', 'be more', 'be better', 'improve', 'do more', 'do better', 'keep up', 'look into', 'sort out']

// Words that leave "how much?" open, unless a size is named too ("read 10 more pages").
const AMOUNT_WORDS = ['more', 'less', 'better', 'harder', 'some', 'something', 'stuff', 'things', 'a bit', 'a little']
// Words that leave "when?" or "whether?" open, size or not.
const HEDGE_WORDS = ['improve', 'improving', 'regularly', 'often', 'properly', 'as much as', 'whenever', 'when i can', 'if i have time', 'if i can', 'at some point', 'eventually']

// One-word actions that are verbs on their own ("Run", "Study"): they still need a size.
const BARE_VERBS = new Set(['study', 'read', 'write', 'run', 'exercise', 'practise', 'practice', 'revise', 'review', 'clean', 'tidy', 'walk', 'swim', 'cycle', 'meditate', 'stretch', 'work', 'train', 'learn', 'code', 'draw', 'paint', 'journal', 'plan', 'call', 'email', 'cook', 'workout', 'jog', 'lift'])

// Something countable: a number, a duration, a quantity word.
const SIZE = /\d|\b(one|two|three|four|five|ten|twenty|half|single|first|whole|all|each|every)\b/

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'\s-]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
const phrase = (s: string) => ` ${words(s).join(' ')} `

// Minutes named in the action ("90 min", "3 h", "2 hours"), for "too big".
export function namedMinutes(title: string): number | null {
  const m = title.toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return m[2].startsWith('h') ? n * 60 : n
}

function vagueStart(text: string): string | null {
  const p = phrase(text)
  return VAGUE_STARTS.find((v) => p.startsWith(` ${v} `)) ?? null
}

function vagueWord(text: string): string | null {
  const p = phrase(text)
  const sized = SIZE.test(text.toLowerCase())
  return HEDGE_WORDS.find((v) => p.includes(` ${v} `)) ?? (sized ? null : (AMOUNT_WORDS.find((v) => p.includes(` ${v} `)) ?? null))
}

// What's wrong with this plan, if anything; at most one problem per kind.
export function checkPlan(input: PlanInput): PlanProblem[] {
  const out: PlanProblem[] = []
  const title = input.title.trim()
  const w = words(title)
  if (w.length === 0) return out

  const start = vagueStart(title)
  if (start) {
    out.push({ id: 'vagueVerb', field: 'action', message: `“${capital(start)}” doesn’t say what you’ll do.`, hint: 'Start with what you’ll physically do: write, read, run, call…' })
  } else if (w.length === 1 && !BARE_VERBS.has(w[0])) {
    out.push({ id: 'noVerb', field: 'action', message: 'That’s a topic, not an action.', hint: `What will you do? “Read 5 pages of ${title}”, “Write 1 paragraph on ${title}”.` })
  }

  const vague = vagueWord(title)
  if (vague) out.push({ id: 'vagueWords', field: 'action', message: `“${vague}” leaves “how much?” open.`, hint: '“Read 10 pages” beats “read more”.' })

  if (w.length === 1 && BARE_VERBS.has(w[0]) && !SIZE.test(title.toLowerCase())) {
    out.push({ id: 'noSize', field: 'action', message: 'How much?', hint: `Add a size: “${capital(w[0])} for 20 min”, “${capital(w[0])} 1 page”.` })
  }

  if (input.when?.kind === 'someday') out.push({ id: 'noWhen', field: 'when', message: 'A plan needs a when.', hint: 'Pick a time, or a moment like “after breakfast”.' })

  const minutes = namedMinutes(title)
  if ((minutes != null && minutes > 120) || (input.difficulty === 4 && !input.plan?.firstStep?.trim())) {
    out.push({ id: 'tooBig', field: 'action', message: 'That’s a big step.', hint: 'Make it smaller, or add a first step of two minutes or less.' })
  }

  const backup = input.plan?.obstacleAction?.trim()
  if (backup && (vagueStart(backup) || vagueWord(backup))) {
    out.push({ id: 'vagueBackup', field: 'backup', message: 'The backup plan is vague too.', hint: 'Make it small and certain: “do just 5 minutes”, “read 1 page”.' })
  }
  return out
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
