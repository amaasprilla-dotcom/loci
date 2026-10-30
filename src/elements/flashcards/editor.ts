// The deck screen: every card in the deck, with add, edit, delete, bulk import,
// search (for big decks) and the deck's settings.

import { textColorOn } from '../../colors'
import { h } from '../../dom'
import { backIcon, settingsIcon } from '../../icons'
import { onLongPress } from '../../press'
import { back, go, reviewHash } from '../../router'
import { button, confirmDelete, deleteConfirmation, describeCounts, openSheet, sheetActions, submitButton } from '../../sheet'
import { db, deleteElement, updateElement } from '../../store/db'
import { formatIn } from '../../time'
import type { Card, LocusElement } from '../../types'
import { linkedItemsSection } from '../../linkedItems'
import { parseImport } from './import'
import { planSession } from './session'
import { addCard, addCards, deckStats, deleteCard, type FlashcardsData, isNew, listCards, updateCard } from './store'
import { count, formatNumber } from '../../locale'

const SEARCH_FROM = 50 // the search box appears once a deck has more cards than this

export async function renderDeckScreen(initial: LocusElement<FlashcardsData>): Promise<HTMLElement> {
  let deck = initial
  const locus = await db.loci.get(deck.locusId)
  const locusHash = `#/locus/${encodeURIComponent(deck.locusId)}`
  let cards: Card[] = []
  let query = ''

  const title = h('h1', {}, deck.title)
  const stats = h('p', { class: 'deck-stats' })
  const list = h('div', { class: 'card-list' })
  const search = h('input', {
    class: 'input search',
    type: 'search',
    placeholder: 'Search cards',
    'aria-label': 'Search cards',
    oninput: () => {
      query = search.value.trim().toLowerCase()
      renderList()
    },
  })

  const study = button('Study', () => go(reviewHash(deck)), 'primary')

  async function reload() {
    cards = await listCards(deck.id)
    study.hidden = (await planSession(deck, Date.now())).length === 0
    renderList()
  }

  function renderList() {
    const now = Date.now()
    const s = deckStats(cards, now)
    stats.textContent = [
      count(s.total, 'card', 'cards'),
      s.due > 0 && `${formatNumber(s.due)} due`,
      s.fresh > 0 && `${formatNumber(s.fresh)} new`,
      s.due === 0 && s.nextDue != null && `next review ${formatIn(s.nextDue - now)}`,
    ]
      .filter(Boolean)
      .join(' · ')

    search.hidden = cards.length <= SEARCH_FROM
    if (search.hidden) query = ''

    const shown = query ? cards.filter((c) => c.front.toLowerCase().includes(query) || c.back.toLowerCase().includes(query)) : cards
    if (cards.length === 0) {
      list.replaceChildren(h('p', { class: 'list-empty' }, 'No cards yet. Add one, or import a list.'))
    } else if (shown.length === 0) {
      list.replaceChildren(h('p', { class: 'list-empty' }, 'No cards match.'))
    } else {
      list.replaceChildren(...shown.map((c) => cardRow(c, now)))
    }
  }

  function cardRow(card: Card, now: number): HTMLElement {
    const [label, kind] = isNew(card) ? ['New', 'new'] : card.srs.due <= now ? ['Due', 'due'] : [formatIn(card.srs.due - now), '']
    const row = h(
      'button',
      { type: 'button', class: 'card-row', onclick: () => void editCard(card) },
      h('span', { class: 'card-text' }, h('span', { class: 'card-front' }, card.front), h('span', { class: 'card-back' }, card.back)),
      h('span', { class: `card-due ${kind}` }, label),
    )
    onLongPress(row, () => void askDeleteCard(card))
    return row
  }

  // ----- Card sheets -----

  async function editCard(card?: Card) {
    const changed = await openCardSheet(deck.id, card)
    if (changed) await reload()
  }

  async function askDeleteCard(card: Card) {
    if (!(await confirmDelete('Delete this card?', `“${card.front}”`))) return
    await deleteCard(card.id)
    await reload()
  }

  async function importCards() {
    const count = await openImportSheet(deck.id)
    if (count) await reload()
  }

  async function openSettings() {
    const result = await openDeckSettings(deck, cards.length)
    if (result === 'deleted') {
      back(locusHash)
    } else if (result) {
      deck = result
      title.textContent = deck.title
      await reload() // the daily limits may change what's ready to study
    }
  }

  const screen = h(
    'div',
    { class: 'deck-screen', style: { '--c': locus?.color ?? '#0b0f14', '--fg': textColorOn(locus?.color ?? '#0b0f14') } },
    h(
      'header',
      { class: 'locus-header' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back(locusHash) }, backIcon()),
      h('div', { class: 'locus-title' }, locus && h('span', { class: 'header-kicker' }, locus.name), title),
      h('button', { class: 'icon-btn header-end', 'aria-label': 'Deck settings', onclick: () => void openSettings() }, settingsIcon()),
    ),
    h(
      'main',
      { class: 'locus-body' },
      h(
        'div',
        { class: 'deck-toolbar' },
        stats,
        h(
          'div',
          { class: 'deck-actions' },
          button('Import', () => void importCards()),
          button('Add card', () => void editCard()),
          study,
        ),
      ),
      search,
      list,
    ),
  )
  await reload()
  return screen
}

// Add (no card) or edit a card. Resolves true if anything was saved.
function openCardSheet(elementId: string, card?: Card): Promise<boolean | null> {
  const editing = card != null
  let saved = false

  return openSheet<boolean>(editing ? 'Edit card' : 'New card', (api) => {
    const front = h('textarea', { class: 'input', rows: 3, 'aria-label': 'Front', oninput: () => sync() })
    const back = h('textarea', { class: 'input', rows: 3, 'aria-label': 'Back', oninput: () => sync() })
    front.value = card?.front ?? ''
    back.value = card?.back ?? ''
    const note = h('p', { class: 'sheet-note', 'aria-live': 'polite' })
    const save = submitButton('Save')
    const another = button('Save & add another', () => void saveAndAnother())

    function valid() {
      return front.value.trim() !== '' && back.value.trim() !== ''
    }
    function sync() {
      save.disabled = another.disabled = !valid()
    }

    async function persist() {
      if (card) await updateCard(card.id, front.value, back.value)
      else await addCard(elementId, front.value, back.value)
      saved = true
    }

    let added = 0
    async function saveAndAnother() {
      if (!valid()) return
      await persist()
      added++
      note.textContent = `${count(added, 'card', 'cards')} added`
      front.value = back.value = ''
      sync()
      front.focus()
    }

    async function submit() {
      if (!valid()) return
      await persist()
      api.close(true)
    }

    // Ctrl+Enter (or ⌘+Enter) saves without reaching for the mouse.
    const shortcut = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      if (editing) void submit()
      else void saveAndAnother()
    }
    front.addEventListener('keydown', shortcut)
    back.addEventListener('keydown', shortcut)

    const form = [
      h('h2', {}, editing ? 'Edit card' : 'New card'),
      h('label', { class: 'field-label' }, 'Front', front),
      h('label', { class: 'field-label' }, 'Back', back),
      note,
      editing && linkedItemsSection({ type: 'card', id: card.id }, () => api.close(saved)),
      sheetActions(
        editing &&
          button(
            'Delete',
            () =>
              api.show(
                ...deleteConfirmation(
                  'Delete this card?',
                  '',
                  () => api.show(...form),
                  async () => {
                    await deleteCard(card.id)
                    api.close(true)
                  },
                ),
              ),
            'danger-text',
          ),
        button('Cancel', () => api.close(saved)),
        !editing && another,
        save,
      ),
    ]
    sync()
    return { content: form, onSubmit: () => void submit(), focus: editing ? undefined : front }
  }).then((result) => result ?? saved) // closed with Escape after "add another": still refresh
}

// Paste lines of "front<TAB>back". Resolves with how many cards were added.
function openImportSheet(elementId: string): Promise<number | null> {
  return openSheet<number>('Import cards', (api) => {
    const text = h('textarea', {
      class: 'input mono',
      rows: 8,
      placeholder: 'hola\thello\ngato\tcat',
      'aria-label': 'Cards to import',
      spellcheck: 'false',
      oninput: () => preview(),
    })
    // In this box the Tab key types a tab (the separator) instead of moving on.
    text.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.shiftKey) return
      e.preventDefault()
      text.setRangeText('\t', text.selectionStart, text.selectionEnd, 'end')
      preview()
    })
    const summary = h('p', { class: 'sheet-note' })
    const submit = submitButton('Import')

    function preview() {
      const { cards, skipped } = parseImport(text.value)
      submit.disabled = cards.length === 0
      submit.textContent = cards.length > 0 ? `Import ${count(cards.length, 'card', 'cards')}` : 'Import'
      summary.textContent =
        text.value.trim() === ''
          ? ''
          : `${count(cards.length, 'card', 'cards')} found` +
            (skipped > 0 ? ` · ${count(skipped, 'line', 'lines')} skipped (need a tab between front and back)` : '')
    }
    preview()

    return {
      content: [
        h('h2', {}, 'Import cards'),
        h(
          'p',
          { class: 'sheet-text' },
          'Paste one card per line: the front, a tab, then the back. Two columns copied from a spreadsheet work, and so does Anki’s “Notes in Plain Text” export.',
        ),
        text,
        summary,
        sheetActions(null, button('Cancel', () => api.close(null)), submit),
      ],
      onSubmit: async () => {
        const { cards } = parseImport(text.value)
        if (cards.length === 0) return
        api.close(await addCards(elementId, cards))
      },
      focus: text,
    }
  })
}

// Title and daily limits; also where the deck is deleted.
function openDeckSettings(deck: LocusElement<FlashcardsData>, cardCount: number): Promise<LocusElement<FlashcardsData> | 'deleted' | null> {
  return openSheet<LocusElement<FlashcardsData> | 'deleted'>('Deck settings', (api) => {
    const titleInput = h('input', { class: 'input', type: 'text', maxlength: 80, 'aria-label': 'Title', oninput: () => sync() })
    titleInput.value = deck.title
    const numberInput = (value: number, min: number, max: number, label: string) => {
      const input = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min, max, step: 1, 'aria-label': label, oninput: () => sync() })
      input.value = String(value)
      return input
    }
    const newPerDay = numberInput(deck.data.newPerDay, 0, 999, 'New cards per day')
    const maxReviews = numberInput(deck.data.maxReviewsPerDay, 1, 9999, 'Maximum reviews per day')
    let answerMode = deck.data.answerMode ?? 'flip'
    const modes = [
      { value: 'flip' as const, label: 'Flip' },
      { value: 'type' as const, label: 'Type' },
    ]
    const modeButtons = modes.map((m) =>
      h(
        'button',
        {
          type: 'button',
          class: 'segment',
          role: 'radio',
          'aria-checked': String(m.value === answerMode),
          onclick: () => {
            answerMode = m.value
            modeButtons.forEach((b, i) => b.setAttribute('aria-checked', String(modes[i].value === answerMode)))
          },
        },
        m.label,
      ),
    )
    const save = submitButton('Save')

    function sync() {
      save.disabled = titleInput.value.trim() === '' || !newPerDay.checkValidity() || !maxReviews.checkValidity() || newPerDay.value === '' || maxReviews.value === ''
    }

    const form = [
      h('h2', {}, 'Deck settings'),
      h('label', { class: 'field-label' }, 'Title', titleInput),
      h(
        'div',
        { class: 'field-row' },
        h('label', { class: 'field-label' }, 'New cards per day', newPerDay),
        h('label', { class: 'field-label' }, 'Most reviews per day', maxReviews),
      ),
      h(
        'div',
        { class: 'field-label' },
        'Answers',
        h('div', { class: 'segments segments-2', role: 'radiogroup', 'aria-label': 'Answers' }, modeButtons),
        h('span', { class: 'field-hint' }, 'Type: you type the answer and Loci checks it. Cards with long backs still flip.'),
      ),
      sheetActions(
        button(
          'Delete deck',
          () =>
            api.show(
              ...deleteConfirmation(
                `Delete “${deck.title}”?`,
                cardCount > 0 ? `This also deletes its ${describeCounts([[cardCount, 'card', 'cards']])}.` : '',
                () => api.show(...form),
                async () => {
                  await deleteElement(deck.id)
                  api.close('deleted')
                },
              ),
            ),
          'danger-text',
        ),
        button('Cancel', () => api.close(null)),
        save,
      ),
    ]
    sync()

    return {
      content: form,
      onSubmit: async () => {
        if (save.disabled) return
        const data: FlashcardsData = { ...deck.data, newPerDay: Number(newPerDay.value), maxReviewsPerDay: Number(maxReviews.value), answerMode }
        const title = titleInput.value.trim()
        await updateElement(deck.id, { title, data })
        api.close({ ...deck, title, data })
      },
    }
  })
}
