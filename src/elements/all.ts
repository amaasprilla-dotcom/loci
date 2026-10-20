// Registers every element type. Imported once at app start (main.ts), and by tests
// that need the types registered.

import { flashcardsType } from './flashcards/type'
import { registry } from './registry'

registry.set(flashcardsType.type, flashcardsType)
