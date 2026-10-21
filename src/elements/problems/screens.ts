// The problem set screen and the template editor (SPEC-v2.md, "Authoring flow").
// A new problem starts from a real example: its numbers become variables, the
// answer is a formula typed in MathLive's math field, and five generated
// instances preview the result before saving.

import { textColorOn } from '../../colors'
import { h } from '../../dom'
import { backIcon, closeIcon, settingsIcon } from '../../icons'
import { count, formatNumber, parseNumber, separators } from '../../locale'
import { createMathField, type MathField } from '../../mathField'
import { back, elementHash, go, reviewHash, subHash } from '../../router'
import { studyPool, summarize } from '../../study/plan'
import { button, confirmDelete, deleteConfirmation, describeCounts, openSheet, sheetActions, submitButton } from '../../sheet'
import { db, deleteElement, updateElement } from '../../store/db'
import type { AnswerFormat, LocusElement, MathJSON, ProblemTemplate, VarSpec } from '../../types'
import { detectNumbers, suggestTitle } from './authoring'
import { formatAnswer, formulaNode, questionNode } from './display'
import { chooseOptions } from './distractors'
import { generate, newSeed, parseText, validate } from './engine'
import { nameToLatex, parse, ParseError, toLatex } from './latex'
import { isCall } from './mathjson'
import { asTemplate, SAMPLES } from './samples'
import { presentProblem } from './present'
import { createTemplate, deleteTemplate, emptyDraft, listTemplates, type TemplateDraft, updateTemplate } from './store'
import type { ProblemsData } from './type'

async function shell(el: LocusElement, title: HTMLElement, onBack: () => void, ...end: Node[]) {
  const locus = await db.loci.get(el.locusId)
  const color = locus?.color ?? '#0b0f14'
  const main = h('main', { class: 'locus-body' })
  const node = h(
    'div',
    { class: 'deck-screen', style: { '--c': color, '--fg': textColorOn(color) } },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: onBack }, backIcon()),
      h('div', { class: 'locus-title' }, h('span', { class: 'header-kicker' }, locus?.name ?? ''), title),
      ...end,
    ),
    main,
  )
  return { node, main }
}

// ---------- The set ----------

export async function renderProblemSet(initial: LocusElement<ProblemsData>): Promise<HTMLElement> {
  let set = initial
  const title = h('h1', {}, set.title)
  const locusHash = `#/locus/${encodeURIComponent(set.locusId)}`
  const { node, main } = await shell(set, title, () => back(locusHash), h('button', { class: 'icon-btn header-end', 'aria-label': 'Problem set settings', onclick: () => void settings() }, settingsIcon()))
  const stats = h('p', { class: 'deck-stats' })
  const list = h('div', { class: 'card-list' })
  let templates: ProblemTemplate[] = []

  const study = button('Study', () => go(reviewHash(set)), 'primary')

  async function reload() {
    templates = await listTemplates(set.id)
    const due = summarize(await studyPool([set], Date.now())).problems
    study.hidden = due === 0
    stats.textContent = templates.length === 0 ? 'Each problem gets new numbers every time it comes up.' : [count(templates.length, 'problem', 'problems'), due > 0 && `${formatNumber(due)} due`].filter(Boolean).join(' · ')
    list.replaceChildren(...(templates.length === 0 ? [h('p', { class: 'list-empty' }, 'No problems yet. Start one from a real example.')] : templates.map(row)))
  }

  function row(t: ProblemTemplate): HTMLElement {
    const g = generate(t, 'preview')
    return h(
      'button',
      { type: 'button', class: 'card-row template-row', onclick: () => go(subHash(set, 'template', t.id)) },
      h(
        'span',
        { class: 'card-text' },
        h('span', { class: 'card-front' }, t.title || 'Untitled problem'),
        g.ok ? h('span', { class: 'card-back' }, questionNode(g.instance)) : h('span', { class: 'card-back warn' }, t.tooTight || (!g.ok && g.reason === 'too-tight') ? 'No numbers fit the constraints. Open it to fix.' : 'Can’t generate yet.'),
        isCall(t.answer) || typeof t.answer === 'string' ? h('span', { class: 'template-formula' }, formulaNode(t.answer)) : null,
      ),
    )
  }

  async function settings() {
    const result = await setSettings(set, templates.length)
    if (result === 'deleted') back(locusHash)
    else if (result) {
      set = result
      title.textContent = set.title
    }
  }

  main.append(h('div', { class: 'deck-toolbar' }, stats, h('div', { class: 'deck-actions' }, button('New problem', () => go(subHash(set, 'template', 'new'))), study)), list)
  await reload()
  return node
}

function setSettings(set: LocusElement<ProblemsData>, problemCount: number): Promise<LocusElement<ProblemsData> | 'deleted' | null> {
  return openSheet<LocusElement<ProblemsData> | 'deleted'>('Problem set settings', (api) => {
    const titleInput = h('input', { class: 'input', type: 'text', maxlength: 80, 'aria-label': 'Title' })
    titleInput.value = set.title
    const newPerDay = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 0, max: 999, step: 1, 'aria-label': 'New problems per day' })
    newPerDay.value = String(set.data.newPerDay ?? 10)
    const form = [
      h('h2', {}, 'Problem set settings'),
      h('label', { class: 'field-label' }, 'Title', titleInput),
      h('label', { class: 'field-label' }, 'New problems per day', newPerDay),
      sheetActions(
        button(
          'Delete set',
          () =>
            api.show(
              ...deleteConfirmation(
                `Delete “${set.title}”?`,
                problemCount > 0 ? `This also deletes its ${describeCounts([[problemCount, 'problem', 'problems']])} and their history.` : '',
                () => api.show(...form),
                async () => {
                  await deleteElement(set.id)
                  api.close('deleted')
                },
              ),
            ),
          'danger-text',
        ),
        button('Cancel', () => api.close(null)),
        submitButton('Save'),
      ),
    ]
    return {
      content: form,
      onSubmit: async () => {
        const t = titleInput.value.trim()
        const n = Number(newPerDay.value)
        if (!t || !Number.isInteger(n) || n < 0) return
        const data: ProblemsData = { ...set.data, newPerDay: n }
        await updateElement(set.id, { title: t, data })
        api.close({ ...set, title: t, data })
      },
    }
  })
}

// ---------- The editor ----------

const ROUNDINGS: [string, string, AnswerFormat][] = [
  ['sf3', '3 significant figures', {}],
  ['d0', 'Whole number', { decimals: 0 }],
  ['d1', '1 decimal', { decimals: 1 }],
  ['d2', '2 decimals', { decimals: 2 }],
  ['d3', '3 decimals', { decimals: 3 }],
  ['sf2', '2 significant figures', { sigFigs: 2 }],
  ['sf4', '4 significant figures', { sigFigs: 4 }],
  ['sf5', '5 significant figures', { sigFigs: 5 }],
]
const roundingKey = (f: AnswerFormat) => (f.decimals != null ? `d${f.decimals}` : `sf${f.sigFigs ?? 3}`)

const NAME = /^[A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*$/

function renameIn(expr: MathJSON, from: string, to: string): MathJSON {
  if (expr === from) return to
  if (isCall(expr)) return [expr[0], ...expr.slice(1).map((a) => renameIn(a, from, to))]
  return expr
}

const fmt = (n: number) => formatNumber(n, { maximumFractionDigits: 10, useGrouping: false })

// A formula typed in a math field, read into MathJSON as it changes.
interface FormulaField {
  field: MathField
  error: HTMLElement
  value: MathJSON | null // null while empty or unreadable
}

export async function renderTemplateEditor(el: LocusElement, id: string | null): Promise<HTMLElement> {
  const existing = id ? await db.problemTemplates.get(id) : undefined
  if (id && (!existing || existing.elementId !== el.id)) {
    location.replace(elementHash(el))
    return h('div')
  }
  const title = h('h1', {}, existing ? existing.title || 'Problem' : 'New problem')
  const { node, main } = await shell(el, title, () => back(elementHash(el)))

  const draft: TemplateDraft = existing
    ? {
        title: existing.title,
        texts: [...existing.texts],
        vars: existing.vars.map((v) => ({ ...v })),
        mode: existing.mode,
        answer: existing.answer,
        derived: existing.derived.map((d) => ({ ...d })),
        constraints: [...existing.constraints],
        answerFormat: { ...existing.answerFormat },
        customDistractors: existing.customDistractors.map((c) => ({ ...c })),
        answerMode: existing.answerMode,
      }
    : emptyDraft()
  // Numbers as written in the example, to put back if one is kept fixed.
  const literals = new Map<string, string>()

  if (!existing) {
    main.append(exampleStep())
    return node
  }
  await openEditor()
  return node

  // Step 1 of a new problem: paste a real one.
  function exampleStep(): HTMLElement {
    const input = h('textarea', { class: 'input', rows: 4, placeholder: 'e.g. A car travels 120 km in 2.5 h. What is its average speed?', 'aria-label': 'An example problem' })
    const error = h('p', { class: 'sheet-error', role: 'alert' })
    const find = () => {
      const detected = detectNumbers(input.value.trim(), separators().decimal === ',' ? ',' : '.')
      if (detected.vars.length === 0) {
        error.textContent = input.value.trim() ? 'No numbers found. A problem needs at least one number that changes.' : 'Write or paste a problem first.'
        return
      }
      draft.texts = [detected.text]
      draft.vars = detected.vars.map(({ original: _o, literal, ...v }) => {
        literals.set(v.name, literal)
        return v
      })
      draft.title = suggestTitle(detected.text)
      void openEditor()
    }
    return h(
      'section',
      { class: 'editor-step' },
      h('h2', { class: 'editor-heading' }, 'Start from a real problem'),
      h('p', { class: 'sheet-text' }, 'Write or paste one, numbers and all. Each number becomes a variable that changes every time, so the answer can’t be memorized.'),
      input,
      error,
      h('div', { class: 'editor-actions' }, button('Find the numbers', find, 'primary')),
      h(
        'div',
        { class: 'field-label' },
        'Or start from a sample',
        h(
          'div',
          { class: 'chips' },
          Object.values(SAMPLES).map((s) =>
            h(
              'button',
              {
                type: 'button',
                class: 'chip',
                onclick: () => {
                  Object.assign(draft, structuredClone(s))
                  void openEditor()
                },
              },
              s.title,
            ),
          ),
        ),
      ),
    )
  }

  async function openEditor() {
    title.textContent = existing ? draft.title || 'Problem' : 'New problem'
    // Variables, then derived values as currently named in the editor.
    const names = () => [...draft.vars.map((v) => v.name), ...derived.map((d) => d.name.value.trim()).filter(Boolean)]

    // ----- Formula fields -----
    async function formulaField(expr: MathJSON | null, label: string, onChange: () => void): Promise<FormulaField> {
      const field = await createMathField(expr == null ? '' : toLatex(expr), label)
      const f: FormulaField = { field, error: h('p', { class: 'sheet-error', role: 'alert' }), value: expr }
      const read = () => {
        const latex = field.value.trim()
        f.error.textContent = ''
        if (!latex) f.value = null
        else
          try {
            f.value = parse(latex, { names: names() })
          } catch (e) {
            f.value = null
            f.error.textContent = e instanceof ParseError ? e.message : 'This formula can’t be read.'
          }
      }
      field.addEventListener('input', () => {
        read()
        onChange()
      })
      return f
    }
    const insertChips = (target: () => FormulaField | null) =>
      h(
        'div',
        { class: 'chips var-chips' },
        names().map((name) =>
          h(
            'button',
            {
              type: 'button',
              class: 'chip var-chip',
              onmousedown: (e: Event) => e.preventDefault(), // keep the math field focused
              onclick: () => {
                const f = target()
                if (!f) return
                f.field.focus()
                f.field.insert(nameToLatex(name))
                f.field.dispatchEvent(new Event('input'))
              },
            },
            name.replace('_', ''),
          ),
        ),
      )

    const answer = await formulaField(existing || draft.vars.length ? (isZero(draft.answer) ? null : draft.answer) : null, 'Answer formula', () => {
      // Until a unit is typed, suggest one from the formula: d / t in km and h → km/h.
      if (!unitTouched && answer.value != null) {
        const guess = guessUnit(answer.value, draft.vars)
        unit.value = guess ?? ''
        draft.answerFormat.unit = guess
      }
      schedulePreview()
    })
    let unitTouched = !!draft.answerFormat.unit
    const derived: { name: HTMLInputElement; f: FormulaField; row: HTMLElement }[] = []
    const constraints: { f: FormulaField; row: HTMLElement }[] = []
    let lastFormula: FormulaField = answer

    // ----- Title -----
    const titleInput = h('input', { class: 'input', type: 'text', maxlength: 80, placeholder: 'e.g. Average speed', 'aria-label': 'Title', oninput: () => (draft.title = titleInput.value) })
    titleInput.value = draft.title

    // ----- Wordings -----
    const wordings = h('div', { class: 'wordings' })
    let lastText: HTMLTextAreaElement | null = null
    function renderWordings() {
      wordings.replaceChildren(
        ...draft.texts.map((text, i) => {
          const area = h('textarea', { class: 'input', rows: 3, 'aria-label': i === 0 ? 'Wording' : `Wording ${i + 1}` })
          area.value = text
          area.dataset.index = String(i)
          const chips = h('p', { class: 'wording-preview' })
          const show = () => chips.replaceChildren(...wordingPreview(area.value))
          area.addEventListener('input', () => {
            draft.texts[i] = area.value
            show()
            schedulePreview()
          })
          area.addEventListener('focus', () => (lastText = area))
          show()
          return h(
            'div',
            { class: 'wording' },
            h('div', { class: 'wording-head' }, h('span', { class: 'field-label' }, i === 0 ? 'Wording' : `Wording ${i + 1}`), i > 0 && h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Remove wording ${i + 1}`, onclick: () => { draft.texts.splice(i, 1); renderWordings(); schedulePreview() } }, closeIcon())),
            chips,
            area,
          )
        }),
      )
    }
    function wordingPreview(text: string): Node[] {
      const known = new Set(names())
      return parseText(text).map((seg) =>
        seg.kind === 'text'
          ? document.createTextNode(seg.text)
          : seg.kind === 'var'
            ? h('span', { class: `var-token${known.has(seg.name) ? '' : ' unknown'}` }, seg.name)
            : h('span', { class: 'alt-token' }, seg.options.join(' / ')),
      )
    }

    // ----- Variables -----
    const varList = h('div', { class: 'var-list' })
    const varError = h('p', { class: 'sheet-error', role: 'alert' })
    function renderVars() {
      varList.replaceChildren(...(draft.vars.length === 0 ? [h('p', { class: 'field-hint' }, 'No numbers change yet.')] : draft.vars.map(varRow)))
      answerChips.replaceChildren(insertChips(() => lastFormula))
      renderWordings()
    }
    function varRow(v: VarSpec, index: number): HTMLElement {
      const nameInput = h('input', { class: 'input var-name', type: 'text', maxlength: 12, 'aria-label': 'Name', autocomplete: 'off', spellcheck: false })
      nameInput.value = v.name
      nameInput.addEventListener('change', () => void rename(v, nameInput))
      const num = (value: number | undefined, label: string, set: (n: number) => void) => {
        const input = h('input', { class: 'input var-num', type: 'text', inputmode: 'decimal', 'aria-label': label, autocomplete: 'off' })
        if (value != null) input.value = fmt(value)
        input.addEventListener('input', () => {
          const n = parseNumber(input.value)
          if (n != null) set(n)
          else set(NaN)
          schedulePreview()
        })
        return input
      }
      const unit = h('input', { class: 'input var-unit', type: 'text', maxlength: 12, placeholder: 'unit', 'aria-label': 'Unit', oninput: () => (v.unit = unit.value.trim() || undefined) })
      unit.value = v.unit ?? ''
      const isRange = v.source.kind === 'range'
      const kind = h(
        'select',
        {
          class: 'input var-kind',
          'aria-label': 'Values',
          onchange: () => {
            const vals = possibleList(v)
            v.source = kind.value === 'range' ? { kind: 'range', min: Math.min(...vals), max: Math.max(...vals), step: 1 } : { kind: 'list', values: vals.slice(0, 12) }
            renderVars()
            schedulePreview()
          },
        },
        h('option', { value: 'range', ...(isRange && { selected: true }) }, 'Range'),
        h('option', { value: 'list', ...(!isRange && { selected: true }) }, 'List'),
      )
      let values: Node[]
      if (v.source.kind === 'range') {
        const s = v.source
        values = [
          h('span', { class: 'var-word' }, 'from'),
          num(s.min, 'From', (n) => (s.min = n)),
          h('span', { class: 'var-word' }, 'to'),
          num(s.max, 'To', (n) => (s.max = n)),
          h('span', { class: 'var-word' }, 'step'),
          num(s.step, 'Step', (n) => (s.step = n)),
        ]
      } else {
        const s = v.source
        const input = h('input', { class: 'input var-values', type: 'text', 'aria-label': 'Values, separated by spaces', placeholder: 'e.g. 3 5 8' })
        input.value = s.values.map(fmt).join(' ')
        input.addEventListener('input', () => {
          s.values = input.value
            .split(/[\s;]+/)
            .filter(Boolean)
            .map((t) => parseNumber(t) ?? NaN)
          schedulePreview()
        })
        values = [input]
      }
      return h(
        'div',
        { class: 'var-row' },
        h('div', { class: 'var-main' }, nameInput, kind, ...values, unit),
        h(
          'div',
          { class: 'var-actions' },
          h('button', { type: 'button', class: 'btn-link', onclick: () => keepFixed(index) }, 'Keep this number fixed'),
        ),
      )
    }
    function possibleList(v: VarSpec): number[] {
      if (v.source.kind === 'list') return v.source.values.filter(Number.isFinite).length ? v.source.values.filter(Number.isFinite) : [1]
      const { min, max, step } = v.source
      const out: number[] = []
      for (let x = min; x <= max + 1e-9 && out.length < 12; x += step || 1) out.push(Number(x.toFixed(10)))
      return out.length ? out : [1]
    }
    function keepFixed(index: number) {
      const v = draft.vars[index]
      const literal = literals.get(v.name) ?? fmt(v.source.kind === 'range' ? v.source.min : v.source.values[0])
      draft.texts = draft.texts.map((t) => t.split(`{${v.name}}`).join(literal))
      draft.vars.splice(index, 1)
      renderVars()
      schedulePreview()
    }
    async function rename(v: VarSpec, input: HTMLInputElement) {
      const to = input.value.trim()
      const from = v.name
      varError.textContent = ''
      if (to === from) return
      if (!NAME.test(to) || names().includes(to) || to === 'Pi') {
        varError.textContent = `“${to}” can’t be used: names start with a letter, use letters, digits or _, and differ from the others.`
        input.value = from
        return
      }
      v.name = to
      if (literals.has(from)) {
        literals.set(to, literals.get(from)!)
        literals.delete(from)
      }
      draft.texts = draft.texts.map((t) => t.split(`{${from}}`).join(`{${to}}`))
      for (const f of [answer, ...derived.map((d) => d.f), ...constraints.map((c) => c.f), ...customs.map((c) => c.f)]) {
        if (f.value == null) continue
        f.value = renameIn(f.value, from, to)
        f.field.value = toLatex(f.value)
      }
      renderVars()
      schedulePreview()
    }
    function addVariable() {
      const used = new Set(names())
      const name = 'abcdefghjkpqrsuwxyz'.split('').find((l) => !used.has(l)) ?? `x_${used.size + 1}`
      draft.vars.push({ name, source: { kind: 'range', min: 1, max: 10, step: 1 } })
      // Put it where the cursor was in the wording, or at the end.
      const area = lastText
      const i = area ? Number(area.dataset.index ?? 0) : 0
      const text = draft.texts[i] ?? ''
      const at = area ? area.selectionStart : text.length
      draft.texts[i] = `${text.slice(0, at)}{${name}}${text.slice(at)}`
      renderVars()
      schedulePreview()
    }

    // ----- Answer -----
    const answerChips = h('div')
    const unit = h('input', { class: 'input', type: 'text', maxlength: 16, placeholder: 'e.g. km/h', 'aria-label': 'Answer unit', oninput: () => { unitTouched = true; draft.answerFormat.unit = unit.value.trim() || undefined; schedulePreview() } })
    unit.value = draft.answerFormat.unit ?? ''
    const rounding = h(
      'select',
      {
        class: 'input',
        'aria-label': 'Rounding',
        onchange: () => {
          const f = ROUNDINGS.find(([k]) => k === rounding.value)![2]
          draft.answerFormat = { ...f, ...(draft.answerFormat.unit && { unit: draft.answerFormat.unit }) }
          schedulePreview()
        },
      },
      ROUNDINGS.map(([k, label]) => h('option', { value: k, ...(k === roundingKey(draft.answerFormat) && { selected: true }) }, label)),
    )
    const modes = (['choice', 'typed'] as const).map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: 'segment',
          role: 'radio',
          'aria-checked': String(draft.answerMode === m),
          onclick: () => {
            draft.answerMode = m
            modes.forEach((b, i) => b.setAttribute('aria-checked', String((['choice', 'typed'] as const)[i] === m)))
          },
        },
        m === 'choice' ? 'Pick from 4' : 'Type the number',
      ),
    )
    answer.field.addEventListener('focus', () => (lastFormula = answer))

    // ----- Derived values and constraints -----
    const derivedList = h('div', { class: 'formula-list' })
    const constraintList = h('div', { class: 'formula-list' })
    async function addDerived(name = '', expr: MathJSON | null = null) {
      const nameInput = h('input', { class: 'input var-name', type: 'text', maxlength: 12, placeholder: 'name', 'aria-label': 'Name', autocomplete: 'off' })
      nameInput.value = name
      const f = await formulaField(expr, 'Formula', () => schedulePreview())
      f.field.addEventListener('focus', () => (lastFormula = f))
      const entry = { name: nameInput, f, row: h('div') }
      nameInput.addEventListener('input', () => {
        answerChips.replaceChildren(insertChips(() => lastFormula))
        schedulePreview()
      })
      entry.row = h(
        'div',
        { class: 'formula-row' },
        h('div', { class: 'formula-line' }, nameInput, h('span', { class: 'var-word' }, '='), f.field, h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Remove', onclick: () => { derived.splice(derived.indexOf(entry), 1); entry.row.remove(); schedulePreview() } }, closeIcon())),
        f.error,
      )
      derived.push(entry)
      derivedList.append(entry.row)
    }
    async function addConstraint(expr: MathJSON | null = null) {
      const f = await formulaField(expr, 'Constraint', () => schedulePreview())
      f.field.addEventListener('focus', () => (lastFormula = f))
      const entry = { f, row: h('div') }
      entry.row = h(
        'div',
        { class: 'formula-row' },
        h('div', { class: 'formula-line' }, f.field, h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Remove', onclick: () => { constraints.splice(constraints.indexOf(entry), 1); entry.row.remove(); schedulePreview() } }, closeIcon())),
        f.error,
      )
      constraints.push(entry)
      constraintList.append(entry.row)
    }
    // The author's own wrong answers, offered before the rules' ones.
    const customList = h('div', { class: 'formula-list' })
    const customs: { f: FormulaField; label: HTMLInputElement; row: HTMLElement }[] = []
    async function addCustom(expr: MathJSON | null = null, labelText = '') {
      const f = await formulaField(expr, 'Wrong answer formula', () => schedulePreview())
      f.field.addEventListener('focus', () => (lastFormula = f))
      const label = h('input', { class: 'input', type: 'text', maxlength: 100, placeholder: 'The mistake, e.g. Used the diameter instead of the radius', 'aria-label': 'What the mistake is', oninput: () => schedulePreview() })
      label.value = labelText
      const entry = { f, label, row: h('div') }
      entry.row = h(
        'div',
        { class: 'formula-row custom-row' },
        h('div', { class: 'formula-line' }, f.field, h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Remove', onclick: () => { customs.splice(customs.indexOf(entry), 1); entry.row.remove(); schedulePreview() } }, closeIcon())),
        f.error,
        label,
      )
      customs.push(entry)
      customList.append(entry.row)
    }

    for (const d of draft.derived) await addDerived(d.name, d.expr)
    for (const c of draft.constraints) await addConstraint(c)
    for (const c of draft.customDistractors) await addCustom(c.expr, c.label)

    // ----- Preview -----
    const preview = h('div', { class: 'preview-list' })
    let seeds = Array.from({ length: 5 }, newSeed)
    let timer = 0
    function schedulePreview() {
      clearTimeout(timer)
      timer = window.setTimeout(renderPreview, 200)
    }
    // Everything typed so far, as a template; with what's still wrong.
    function collect(): { template: TemplateDraft; problems: string[] } {
      const problems: string[] = []
      const formulaErrors = [answer, ...derived.map((d) => d.f), ...constraints.map((c) => c.f), ...customs.map((c) => c.f)].filter((f) => f.error.textContent)
      if (formulaErrors.length) problems.push('A formula can’t be read yet; see the message under it.')
      if (answer.value == null && !answer.error.textContent) problems.push('Write the answer formula.')
      const template: TemplateDraft = {
        ...draft,
        title: draft.title.trim() || suggestTitle(draft.texts[0] ?? ''),
        texts: draft.texts.filter((t) => t.trim()),
        answer: answer.value ?? 0,
        derived: derived.filter((d) => d.f.value != null || d.name.value.trim()).map((d) => ({ name: d.name.value.trim(), expr: d.f.value ?? 0 })),
        constraints: constraints.filter((c) => c.f.value != null).map((c) => c.f.value!),
        customDistractors: customs.filter((c) => c.f.value != null).map((c) => ({ expr: c.f.value!, label: c.label.value.trim() || 'A common mistake' })),
      }
      for (const v of template.vars) {
        if (v.source.kind === 'range' && ![v.source.min, v.source.max, v.source.step].every(Number.isFinite)) problems.push(`“${v.name}”: fill in from, to and step with numbers.`)
        if (v.source.kind === 'list' && !v.source.values.every(Number.isFinite)) problems.push(`“${v.name}”: the list has something that isn’t a number.`)
      }
      if (!problems.length) problems.push(...validate({ ...template, texts: template.texts.length ? template.texts : [''] }))
      return { template, problems }
    }
    function renderPreview() {
      const { template, problems } = collect()
      if (problems.length) {
        preview.replaceChildren(h('ul', { class: 'problems-list' }, problems.map((p) => h('li', {}, p))))
        return
      }
      const t = asTemplate(template)
      const items: HTMLElement[] = []
      for (const seed of seeds) {
        let g
        try {
          g = generate(t, seed)
        } catch (e) {
          preview.replaceChildren(h('ul', { class: 'problems-list' }, h('li', {}, e instanceof Error ? e.message : 'This template can’t generate problems.')))
          return
        }
        if (!g.ok) {
          preview.replaceChildren(h('ul', { class: 'problems-list' }, h('li', {}, 'No numbers fit the constraints, even after 200 tries. Widen a range or loosen a constraint.')))
          return
        }
        const inst = g.instance
        items.push(
          h(
            'div',
            { class: 'preview-item' },
            questionNode(inst),
            h('p', { class: 'preview-answer' }, h('span', { class: 'worked' }, formulaNode(template.answer, inst.values)), ' = ', h('strong', {}, formatAnswer(inst.answer, template.answerFormat))),
            template.answerMode === 'choice' &&
              h(
                'div',
                { class: 'preview-options' },
                chooseOptions(t, inst).map((o) => h('span', { class: `preview-option${o.correct ? ' correct' : ''}`, title: o.why?.text ?? 'The answer' }, formatAnswer(o.value, template.answerFormat), !o.correct && h('span', { class: 'preview-why' }, o.why?.text ?? ''))),
              ),
          ),
        )
      }
      preview.replaceChildren(...items)
    }

    // Answer one, as it will come up in practice.
    async function tryIt() {
      const { template, problems } = collect()
      if (problems.length) {
        renderPreview()
        return
      }
      const t = asTemplate(template)
      await openSheet<boolean>('Try it', (api) => {
        const holder = h('div')
        const next = h('button', { type: 'button', class: 'btn btn-primary', hidden: true, onclick: () => show() }, 'Another one')
        function show() {
          const g = generate(t, newSeed())
          if (!g.ok) {
            holder.replaceChildren(h('p', { class: 'sheet-error' }, 'No numbers fit the constraints.'))
            return
          }
          const p = presentProblem(t, g.instance)
          next.hidden = true
          holder.replaceChildren(p.el)
          void p.done.then(() => {
            next.hidden = false
            next.focus()
          })
          setTimeout(() => p.focus(), 0)
        }
        show()
        return { content: [h('h2', {}, template.title || 'Try it'), holder, sheetActions(null, button('Close', () => api.close(null)), next)] }
      })
    }

    // ----- Saving -----
    const saveError = h('p', { class: 'sheet-error', role: 'alert' })
    async function save() {
      const { template, problems } = collect()
      if (problems.length) {
        saveError.textContent = 'Not ready to save yet: see the preview for what’s missing.'
        renderPreview()
        preview.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      if (existing) await updateTemplate(existing.id, template)
      else await createTemplate(el.id, template)
      back(elementHash(el))
    }
    async function remove() {
      if (!existing) return
      if (!(await confirmDelete(`Delete “${existing.title || 'this problem'}”?`, 'Its practice history goes too.'))) return
      await deleteTemplate(existing.id)
      back(elementHash(el))
    }

    renderVars()
    main.replaceChildren(
      h(
        'div',
        { class: 'template-editor' },
        section('Title', titleInput),
        section(
          'The problem',
          wordings,
          h('p', { class: 'field-hint' }, 'Numbers that change are in braces, like {d}. {Find|Calculate} picks one of the words at random.'),
          h('div', { class: 'editor-actions' }, button('Add another wording', () => { draft.texts.push(draft.texts[0] ?? ''); renderWordings() })),
        ),
        section('Numbers that change', varList, varError, h('div', { class: 'editor-actions' }, button('Add a number', addVariable))),
        section(
          'Answer',
          h('p', { class: 'field-hint' }, 'Type the formula; tap a name to put it in.'),
          answerChips,
          h('div', { class: 'formula-line' }, answer.field),
          answer.error,
          h('div', { class: 'field-row' }, h('label', { class: 'field-label' }, 'Unit', unit), h('label', { class: 'field-label' }, 'Rounding', rounding)),
          h('div', { class: 'field-label' }, 'Answered by', h('div', { class: 'segments segments-2', role: 'radiogroup', 'aria-label': 'Answered by' }, modes)),
        ),
        h(
          'details',
          { class: 'editor-section editor-more', ...((draft.derived.length || draft.constraints.length) && { open: true }) },
          h('summary', { class: 'editor-heading' }, 'Derived values and constraints'),
          h('p', { class: 'field-hint' }, 'Derived values are worked out from the numbers, in order, and can be used in the answer (e.g. D = b² − 4ac).'),
          derivedList,
          h('div', { class: 'editor-actions' }, button('Add a derived value', () => void addDerived().then(schedulePreview))),
          h('p', { class: 'field-hint' }, 'Constraints must all hold; other numbers are tried until they do (e.g. D ≥ 0).'),
          constraintList,
          h('div', { class: 'editor-actions' }, button('Add a constraint', () => void addConstraint().then(schedulePreview))),
        ),
        h(
          'details',
          { class: 'editor-section editor-more', ...(draft.customDistractors.length && { open: true }) },
          h('summary', { class: 'editor-heading' }, 'Wrong answers you expect'),
          h('p', { class: 'field-hint' }, 'Wrong options are made from common mistakes (a sign, a dropped factor, a unit…). Add ones you know students make: they’re offered first, and the feedback names them.'),
          customList,
          h('div', { class: 'editor-actions' }, button('Add a wrong answer', () => void addCustom().then(schedulePreview))),
        ),
        section('Preview', h('div', { class: 'editor-actions' }, button('New numbers', () => { seeds = Array.from({ length: 5 }, newSeed); renderPreview() }), button('Try it', () => void tryIt())), preview),
        h('div', { class: 'editor-footer' }, saveError, sheetActions(existing ? button('Delete', () => void remove(), 'danger-text') : null, button('Cancel', () => back(elementHash(el))), button('Save', () => void save(), 'primary'))),
      ),
    )
    renderPreview()
    if (!existing && answer.value == null) setTimeout(() => answer.field.focus(), 50)
  }
}

function section(heading: string, ...content: (Node | false | null)[]): HTMLElement {
  return h('section', { class: 'editor-section' }, h('h2', { class: 'editor-heading' }, heading), ...content)
}

function isZero(e: MathJSON): boolean {
  return e === 0
}

// The answer's unit, when the formula makes it plain: a single variable, a
// quotient of two (km / h → km/h) or a product of variables with units.
export function guessUnit(expr: MathJSON, vars: VarSpec[]): string | undefined {
  const unitOf = (e: MathJSON): string | undefined => (typeof e === 'string' ? vars.find((v) => v.name === e)?.unit : undefined)
  if (typeof expr === 'string') return unitOf(expr)
  if (!isCall(expr)) return undefined
  if (expr[0] === 'Divide') {
    const [a, b] = [unitOf(expr[1]), unitOf(expr[2])]
    return a && b && a !== b ? `${a}/${b}` : undefined
  }
  if (expr[0] === 'Multiply') {
    // Only plain products (m · a); powers and the like are left to the author.
    if (expr.slice(1).some((f) => typeof f !== 'string' && typeof f !== 'number')) return undefined
    const units = expr.slice(1).filter((f) => typeof f === 'string' && !['Pi', 'ExponentialE'].includes(f)).map(unitOf)
    return units.length > 0 && units.every(Boolean) ? units.join('·') : undefined
  }
  return undefined
}
