// Registers every element type. Imported once at app start (main.ts), and by tests
// that need the types registered.

import { flashcardsType } from './flashcards/type'
import { goalsType } from './goals/type'
import { notesType } from './notes/type'
import { problemsType } from './problems/type'
import { registry } from './registry'
import { todosType } from './todos/type'

registry.set(flashcardsType.type, flashcardsType)
registry.set(problemsType.type, problemsType)
registry.set(notesType.type, notesType)
registry.set(todosType.type, todosType)
registry.set(goalsType.type, goalsType)
