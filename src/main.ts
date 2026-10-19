// App boot. The hash router (#/locus/:id, #/tasks, ...) arrives in milestone 3.

import '@fontsource-variable/inter'
import './style.css'
import { renderHome } from './home/view'
import { requestPersistentStorage } from './store/db'

const root = document.getElementById('app')!

requestPersistentStorage().catch(() => {})
renderHome(root)
