// "Balls in liquid seen from above": each bubble is pulled toward its home point
// by a damped spring, drifts gently around it, and is pushed apart from any
// bubble it overlaps. No physics engine; one step runs per 60th of a second.

export interface Body {
  id: string
  x: number // current center, px
  y: number
  vx: number
  vy: number
  hx: number // home point, px
  hy: number
  r: number
  phase: number // wobble offset, so bubbles don't wobble in sync
  held: boolean // being dragged: the pointer moves it, physics leaves it alone
  gliding: boolean // thrown: coasts on its own momentum, no spring, until it comes to rest
}

// Tuned by feel. A weak spring in thick "liquid": a bubble pushed away drifts
// back to its home slowly (halfway in ~1.6s, nearly there in ~5s) and never
// overshoots. (SPEC.md's K = 0.015, DAMP = 0.9 snapped back in 0.2s and bounced,
// which felt magnetic.)
const K = 0.001 // spring strength toward home
const DAMP = 0.88 // velocity kept per step; lower = thicker liquid
// How much of a push from another bubble carries on as momentum, so pushed
// bubbles glide a little instead of stopping dead.
const PUSH_MOMENTUM = 0.25
// Drift: the spring pulls toward a point that wanders slowly around home, up to
// WANDER px away. (A random nudge each step, as first specced, only jittered
// bubbles by about 1px, which read as noise rather than floating.)
const WANDER = 5
const GAP = 6 // px of breathing room between bubbles
// A thrown bubble coasts in thinner liquid than the drift: it loses this much of its
// speed per step (half in ~0.2s, so it coasts ~15× its last step), bounces softly off the
// edges, and stops below GLIDE_STOP.
const GLIDE_DAMP = 0.94
const GLIDE_STOP = 0.15 // px per step
const BOUNCE = 0.45 // speed kept bouncing off an edge
// Separation passes per step. One pass leaves crowded bubbles overlapping
// when the springs keep pulling them together; a few passes settle it.
const SEPARATION_PASSES = 3

// t is the time in ms; drift is false under prefers-reduced-motion.
export function step(bodies: Body[], width: number, height: number, t: number, drift: boolean): void {
  for (const b of bodies) {
    if (b.held) continue
    if (b.gliding) {
      glide(b, width, height)
      continue
    }
    const tx = drift ? b.hx + WANDER * Math.sin(t / 3100 + b.phase) : b.hx
    const ty = drift ? b.hy + WANDER * Math.cos(t / 3700 + b.phase * 1.7) : b.hy
    b.vx += (tx - b.x) * K
    b.vy += (ty - b.y) * K
    b.vx *= DAMP
    b.vy *= DAMP
    b.x += b.vx
    b.y += b.vy
  }
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) separate(bodies)
  for (const b of bodies) clampInside(b, width, height)
}

// One step of a thrown bubble. Once it's slow enough it stops, and where it stops is its new home.
function glide(b: Body, width: number, height: number): void {
  b.vx *= GLIDE_DAMP
  b.vy *= GLIDE_DAMP
  b.x += b.vx
  b.y += b.vy
  if (b.x < b.r || b.x > width - b.r) b.vx = -b.vx * BOUNCE
  if (b.y < b.r || b.y > height - b.r) b.vy = -b.vy * BOUNCE
  if (Math.hypot(b.vx, b.vy) < GLIDE_STOP) {
    b.gliding = false
    b.vx = 0
    b.vy = 0
    clampInside(b, width, height)
    b.hx = b.x
    b.hy = b.y
  }
}

// O(n²), fine below ~200 bubbles.
function separate(bodies: Body[]): void {
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]
      const c = bodies[j]
      let dx = c.x - a.x
      let dy = c.y - a.y
      let dist = Math.hypot(dx, dy)
      if (dist === 0) {
        // Exactly on top of each other: pick a random direction to split.
        const angle = Math.random() * Math.PI * 2
        dx = Math.cos(angle)
        dy = Math.sin(angle)
        dist = 1
      }
      const overlap = a.r + c.r + GAP - dist
      if (overlap <= 0) continue
      const nx = dx / dist
      const ny = dy / dist
      // A held bubble doesn't move, so the other one takes the whole push.
      const share = a.held || c.held ? overlap : overlap / 2
      const px = nx * share
      const py = ny * share
      if (!a.held) {
        a.x -= px
        a.y -= py
        a.vx -= px * PUSH_MOMENTUM
        a.vy -= py * PUSH_MOMENTUM
      }
      if (!c.held) {
        c.x += px
        c.y += py
        c.vx += px * PUSH_MOMENTUM
        c.vy += py * PUSH_MOMENTUM
      }
    }
  }
}

export function clampInside(b: Body, width: number, height: number): void {
  b.x = clamp(b.x, b.r, width - b.r)
  b.y = clamp(b.y, b.r, height - b.r)
}

export function clamp(v: number, min: number, max: number): number {
  // If the field is smaller than the bubble, center it rather than flip-flopping.
  if (min > max) return (min + max) / 2
  return Math.min(max, Math.max(min, v))
}

// The gentle squash: returns how much to stretch x (and squeeze y) at time t.
export function wobble(b: Body, t: number): number {
  return 0.03 * Math.sin(t / 600 + b.phase)
}
