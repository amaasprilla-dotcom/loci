// Live updates (SPEC-v4-sync.md, "Live updates"). A device keeps a WebSocket open
// while the app is showing. Browsers can't put the key in a WebSocket's headers,
// and it never goes in a URL, so the first message is a hello carrying it:
//
//   device → server   { "type": "hello", "key": "<key>", "device": "<device id>" }
//   server → device   { "type": "ready" }                 the key is right
//   server → device   { "type": "changed", "seq": <n> }   another device pushed: pull
//   device → server   ping, answered pong                  heartbeat
//
// A wrong key, or a key reset elsewhere, closes the socket with WRONG_KEY_CLOSE.

import { normalizeKey } from '../src/sync/rules.ts'

export { PING, PONG, WRONG_KEY_CLOSE } from '../src/sync/rules.ts'

export interface Hello {
  key: string
  device: string
}

export function parseHello(message: string | ArrayBuffer): Hello | null {
  if (typeof message !== 'string' || message.length > 1000) return null
  try {
    const data = JSON.parse(message)
    const key = typeof data?.key === 'string' ? normalizeKey(data.key) : null
    if (data?.type !== 'hello' || !key || typeof data.device !== 'string' || !/^[\w-]{1,64}$/.test(data.device)) return null
    return { key, device: data.device }
  } catch {
    return null
  }
}

// What to tell the devices other than the one that pushed.
export function changedMessage(seq: number): string {
  return JSON.stringify({ type: 'changed', seq })
}
