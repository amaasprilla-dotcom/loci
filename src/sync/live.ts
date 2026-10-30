// The live connection (SPEC-v4-sync.md, "Live updates"; the server side is
// worker/live.ts). While the app is showing, another device's push makes this one
// pull at once, instead of at the next round. If the socket drops, rounds still
// run on their usual triggers and the socket comes back with backoff.

import { PING, PONG, WRONG_KEY_CLOSE } from './rules'

const RETRY_MS = [2_000, 10_000, 30_000, 120_000]
const HEARTBEAT_MS = 45_000
const PONG_WAIT_MS = 10_000

export interface Live {
  connect(): void
  close(): void
}

export function createLive(options: { hello: () => { key: string; device: string } | null; changed: () => void }): Live {
  let socket: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let pongTimer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0

  function stopHeartbeat() {
    clearInterval(heartbeat)
    clearTimeout(pongTimer)
  }

  function connect() {
    if (socket || typeof document === 'undefined' || document.visibilityState !== 'visible') return
    const hello = options.hello()
    if (!hello) return
    clearTimeout(retryTimer)
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/sync/live`)
    socket = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', ...hello }))
      // No pong in time: the connection is dead without having said so. Closing
      // it ends up in onclose, which connects again.
      heartbeat = setInterval(() => {
        ws.send(PING)
        pongTimer = setTimeout(() => ws.close(), PONG_WAIT_MS)
      }, HEARTBEAT_MS)
    }
    ws.onmessage = (event) => {
      if (event.data === PONG) return clearTimeout(pongTimer)
      let data: { type?: string }
      try {
        data = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (data.type === 'ready') attempt = 0
      if (data.type === 'changed') options.changed()
    }
    ws.onclose = (event) => {
      if (socket !== ws) return // closed on purpose
      stopHeartbeat()
      socket = null
      // The key no longer works: the next round finds out and says so; a round
      // that succeeds (e.g. after joining again) connects again.
      if (event.code === WRONG_KEY_CLOSE) {
        options.changed()
        return
      }
      retryTimer = setTimeout(connect, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)])
    }
  }

  function close() {
    clearTimeout(retryTimer)
    stopHeartbeat()
    const ws = socket
    socket = null
    ws?.close(1000)
  }

  return { connect, close }
}
