// The Cloudflare Worker (SPEC-v4-sync.md, "Server"). Files from `dist` are served
// without running this code (wrangler.jsonc: assets.run_worker_first is /api/* only);
// /api/sync/* goes to the one Durable Object that holds the synced data.

import { DurableObject } from 'cloudflare:workers'
import { handleSync, hashKey } from './api.ts'
import { changedMessage, parseHello, PING, PONG, WRONG_KEY_CLOSE } from './live.ts'
import { SyncStore } from './store.ts'

interface Env {
  SYNC: DurableObjectNamespace<SyncObject>
  ASSETS: Fetcher
  // Which synced space this Worker serves. Unset: "main". Setting another value in
  // the dashboard starts sync over with empty storage, e.g. after losing the key on
  // every device (README, "Sync between devices").
  SYNC_SPACE?: string
}

// What a live socket remembers once its hello was accepted (it survives the
// Durable Object hibernating between messages).
interface Greeted {
  device: string
}

// One per Worker: all devices of the one person this Worker serves talk to it,
// so every push is applied in order.
export class SyncObject extends DurableObject<Env> {
  private store: SyncStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new SyncStore(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn))
    // Heartbeats are answered without waking this object (worker/live.ts).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  override fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/api/sync/live') return Promise.resolve(this.openLive(request))
    return handleSync(request, this.store, {
      pushed: (device) => this.tellOthers(device),
      rekeyed: () => this.closeLive(),
    })
  }

  // Accepted with the hibernation API: an idle socket costs nothing.
  private openLive(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') return Response.json({ error: 'websocket-only' }, { status: 426 })
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (ws.deserializeAttachment()) return // already greeted; devices only send heartbeats, answered above
    const hello = parseHello(message)
    if (!hello || !this.store.keyMatches(await hashKey(hello.key))) {
      ws.close(WRONG_KEY_CLOSE, 'wrong-key')
      return
    }
    ws.serializeAttachment({ device: hello.device } satisfies Greeted)
    ws.send(JSON.stringify({ type: 'ready' }))
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    // Finish the close handshake (1005/1006 can't be sent back).
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {
      // Already closed.
    }
  }

  private tellOthers(device: string) {
    const message = changedMessage(this.store.seq())
    for (const ws of this.ctx.getWebSockets()) {
      const greeted = ws.deserializeAttachment() as Greeted | null
      if (!greeted || greeted.device === device) continue
      try {
        ws.send(message)
      } catch {
        // Closing; it reconnects and pulls anyway.
      }
    }
  }

  // After a key reset every socket must say hello again with the new key.
  private closeLive() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(WRONG_KEY_CLOSE, 'key-reset')
      } catch {
        // Already closed.
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/sync/')) {
      const response = await env.SYNC.get(env.SYNC.idFromName(env.SYNC_SPACE || 'main')).fetch(request)
      // Wrong keys wait a second, to slow down guessing.
      if (response.status === 401) await new Promise((resolve) => setTimeout(resolve, 1000))
      return response
    }
    if (pathname.startsWith('/api/')) return Response.json({ error: 'not-found' }, { status: 404 })
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
