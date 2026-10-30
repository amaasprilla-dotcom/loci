// The Cloudflare Worker (SPEC-v4-sync.md, "Server"). Files from `dist` are served
// without running this code (wrangler.jsonc: assets.run_worker_first is /api/* only);
// /api/sync/* goes to the one Durable Object that holds the synced data.

import { DurableObject } from 'cloudflare:workers'
import { handleSync } from './api.ts'
import { SyncStore } from './store.ts'

interface Env {
  SYNC: DurableObjectNamespace<SyncObject>
  ASSETS: Fetcher
}

// One per Worker: all devices of the one person this Worker serves talk to it,
// so every push is applied in order.
export class SyncObject extends DurableObject<Env> {
  private store: SyncStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new SyncStore(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn))
  }

  override fetch(request: Request): Promise<Response> {
    return handleSync(request, this.store)
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/sync/')) {
      const response = await env.SYNC.get(env.SYNC.idFromName('main')).fetch(request)
      // Wrong keys wait a second, to slow down guessing.
      if (response.status === 401) await new Promise((resolve) => setTimeout(resolve, 1000))
      return response
    }
    if (pathname.startsWith('/api/')) return Response.json({ error: 'not-found' }, { status: 404 })
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
