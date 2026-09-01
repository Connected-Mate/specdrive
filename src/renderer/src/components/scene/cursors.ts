// Flying agent cursors — Figma-style pointers with name pills drifting on
// elliptical paths, scattering away from the real pointer. Plain DOM, no deps.
//
// Two layouts: 'hero' (the big empty-board scene) and 'header' (the slim
// permanent band on every project screen). In the header the cursors are real
// agents, and the one that just did something darts beside the project name
// carrying a chip with what it did.

const ARROW_PATH =
  'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L5.94 2.47a.5.5 0 0 0-.44.74Z'

export interface CursorDef {
  /** Stable identity used to spotlight this cursor; falls back to the name */
  key?: string
  name: string
  color: string
  /** Seen recently but not live right now — drawn faded */
  muted?: boolean
}

export type SceneVariant = 'hero' | 'header'

interface CursorNode {
  def: CursorDef
  root: HTMLDivElement
  blush: HTMLDivElement
  pill: HTMLSpanElement
  label: HTMLSpanElement
  cx: number
  cy: number
  rx: number
  ry: number
  phase: number
  speed: number
  x: number
  y: number
  /** Where this cursor darts to when it is the one that just acted */
  spotX: number
  spotY: number
  spotUntil: number
  /** Cursor lives left of the name → its pill hangs to the left, clear of it */
  flipped: boolean
  /** 0 → 1, eased, drives the little pop while spotlighted */
  pop: number
  labelTimer?: ReturnType<typeof setTimeout>
}

const TWO_PI = Math.PI * 2

/** How long a cursor stays beside the name after a real action. */
const SPOT_MS = 3600

/** Header slots, in fractions of the band — tuned to ring the name and stay
 *  clear of it whatever the project title length. */
const HEADER_SLOTS: { x: number; y: number }[] = [
  { x: 0.2, y: 0.3 },
  { x: 0.79, y: 0.62 },
  { x: 0.09, y: 0.71 },
  { x: 0.68, y: 0.19 },
  { x: 0.9, y: 0.36 }
]

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export class FlyingCursors {
  private host: HTMLElement
  private defs: CursorDef[]
  private variant: SceneVariant
  private nodes: CursorNode[] = []
  private raf = 0
  private running = false
  private disposed = false
  private t = 0
  private pointer = { x: -9999, y: -9999, active: false }
  private ro?: ResizeObserver
  private cleanup: (() => void)[] = []

  constructor(host: HTMLElement, defs: CursorDef[], variant: SceneVariant = 'hero') {
    this.host = host
    this.defs = defs
    this.variant = variant
    this.build()
    this.bindEvents()
    this.layout()
  }

  private build(): void {
    const header = this.variant === 'header'
    for (const def of this.defs) {
      const blush = document.createElement('div')
      const SIZE = header ? 150 : 260
      Object.assign(blush.style, {
        position: 'absolute',
        left: `${-SIZE / 2}px`,
        top: `${-SIZE / 2}px`,
        width: `${SIZE}px`,
        height: `${SIZE}px`,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${def.color} 0%, transparent 74%)`,
        opacity: def.muted ? '0.2' : header ? '0.4' : '0.5',
        filter: `blur(${header ? 20 : 26}px)`,
        pointerEvents: 'none',
        willChange: 'transform',
        mixBlendMode: 'soft-light',
        zIndex: '2'
      })
      this.host.appendChild(blush)

      const root = document.createElement('div')
      Object.assign(root.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        pointerEvents: 'none',
        willChange: 'transform',
        opacity: def.muted ? '0.5' : '1',
        zIndex: '5'
      })
      root.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             style="display:block; filter:drop-shadow(0 2px 3px rgba(0,0,0,0.18))">
          <path d="${ARROW_PATH}" fill="${def.color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
      `
      const pill = document.createElement('span')
      pill.textContent = def.name
      Object.assign(pill.style, {
        position: 'absolute',
        left: '15px',
        top: '16px',
        whiteSpace: 'nowrap',
        padding: '2px 7px',
        borderRadius: '9px',
        borderTopLeftRadius: '2px',
        fontSize: '10px',
        fontWeight: '600',
        letterSpacing: '-0.01em',
        lineHeight: '1.35',
        color: '#fff',
        background: def.color,
        boxShadow: '0 2px 6px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.22)',
        fontFamily: "'Portal Sans', -apple-system, sans-serif"
      })
      root.appendChild(pill)

      const label = document.createElement('span')
      Object.assign(label.style, {
        position: 'absolute',
        left: '15px',
        top: '34px',
        maxWidth: '260px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        display: 'block',
        padding: '3px 8px',
        borderRadius: '9px',
        borderTopLeftRadius: '2px',
        border: '1px solid rgba(0,0,0,0.06)',
        background: 'rgba(255,255,255,0.94)',
        color: '#3e3e3e',
        fontSize: '10px',
        fontWeight: '500',
        letterSpacing: '-0.01em',
        lineHeight: '1.4',
        fontFamily: "'Portal Sans', -apple-system, sans-serif",
        boxShadow: '0 2px 8px rgba(12,38,77,0.10)',
        opacity: '0',
        transform: 'translateY(-4px)',
        transition: 'opacity 0.28s ease, transform 0.28s ease',
        pointerEvents: 'none'
      })
      root.appendChild(label)
      this.host.appendChild(root)

      this.nodes.push({
        def,
        root,
        blush,
        pill,
        label,
        cx: 0.5,
        cy: 0.5,
        rx: 0.3,
        ry: 0.3,
        phase: 0,
        speed: 1,
        x: 0,
        y: 0,
        spotX: 0,
        spotY: 0,
        spotUntil: 0,
        flipped: false,
        pop: 0
      })
    }
  }

  private bindEvents(): void {
    const onMove = (e: PointerEvent): void => {
      const r = this.host.getBoundingClientRect()
      this.pointer.x = e.clientX - r.left
      this.pointer.y = e.clientY - r.top
      this.pointer.active = true
    }
    const onLeave = (): void => {
      this.pointer.active = false
    }
    this.host.addEventListener('pointermove', onMove)
    this.host.addEventListener('pointerleave', onLeave)
    this.cleanup.push(() => {
      this.host.removeEventListener('pointermove', onMove)
      this.host.removeEventListener('pointerleave', onLeave)
    })
    this.ro = new ResizeObserver(() => this.layout())
    this.ro.observe(this.host)
  }

  /** Half-width of the rendered project name, so cursors dart *beside* it. */
  private wordHalfWidth(): number {
    const stack = this.host.querySelector('.frosted-stack') as HTMLElement | null
    return stack ? stack.offsetWidth / 2 : 0
  }

  private layout(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    const n = this.nodes.length
    const header = this.variant === 'header'
    const halfWord = this.wordHalfWidth()

    this.nodes.forEach((node, i) => {
      if (header) {
        const slot = HEADER_SLOTS[i % HEADER_SLOTS.length]
        // A pill can extend ~130px sideways from the cursor point (either way
        // once flipped) and the orbit adds up to rx — keep all of it inside.
        const edge = 150
        node.cx = clamp(slot.x * w, Math.min(edge, w * 0.2), Math.max(edge + 20, w - edge))
        node.cy = clamp(slot.y * h, 14, Math.max(20, h - 30))
        node.rx = Math.min(w * 0.03, 26)
        node.ry = h * 0.1
        node.phase = (i / Math.max(n, 1)) * TWO_PI
        node.speed = 0.3 + 0.09 * i
      } else {
        node.cx = (0.28 + 0.44 * ((i + 0.5) / n)) * w
        node.cy = (0.3 + 0.36 * (i % 2)) * h
        node.rx = (0.15 + 0.06 * (i % 2)) * w
        node.ry = (0.18 + 0.06 * ((i + 1) % 2)) * h
        node.phase = (i / n) * TWO_PI
        node.speed = 0.45 + 0.16 * i
      }

      // Dart target: just outside the word, on the side this cursor lives.
      const dir = node.cx >= w / 2 ? 1 : -1
      const gap = clamp(halfWord + (header ? 34 : 52), w * 0.1, w * 0.42)
      const spotEdge = header ? Math.min(150, w * 0.2) : 18
      node.spotX = clamp(w / 2 + dir * gap, spotEdge, Math.max(spotEdge + 12, w - spotEdge))
      node.spotY = clamp(h / 2 + (node.cy - h / 2) * 0.3, 12, Math.max(20, h - 26))

      // Cursors left of the name hang their pills leftwards, so nothing ever
      // lands on top of the title when they dart in.
      const flip = dir < 0
      if (flip !== node.flipped) {
        node.flipped = flip
        for (const el of [node.pill, node.label]) {
          el.style.left = flip ? 'auto' : '15px'
          el.style.right = flip ? '9px' : 'auto'
          el.style.borderTopLeftRadius = flip ? '9px' : '2px'
          el.style.borderTopRightRadius = flip ? '2px' : '9px'
        }
      }

      // Start on the path, not at the origin.
      node.x = node.cx + Math.cos(node.phase) * node.rx
      node.y = node.cy + Math.sin(node.phase * 1.15) * node.ry
    })
  }

  /** The cursor that just did something real: dart beside the name, say what. */
  spotlight(key: string, text: string): void {
    if (this.disposed) return
    const node = this.nodes.find((x) => (x.def.key ?? x.def.name) === key)
    if (!node) return
    node.label.textContent = text
    const room = node.flipped ? node.spotX - 24 : this.host.clientWidth - node.spotX - 34
    node.label.style.maxWidth = `${Math.max(120, room)}px`
    node.label.style.opacity = '1'
    node.label.style.transform = 'translateY(0)'
    node.spotUntil = performance.now() + SPOT_MS
    if (node.labelTimer) clearTimeout(node.labelTimer)
    node.labelTimer = setTimeout(() => {
      node.label.style.opacity = '0'
      node.label.style.transform = 'translateY(-4px)'
    }, SPOT_MS)
  }

  /** prefers-reduced-motion: place every cursor once, then never move again. */
  renderStatic(): void {
    this.layout()
    for (const node of this.nodes) this.paint(node, 1)
  }

  private paint(node: CursorNode, scale: number): void {
    const x = node.x.toFixed(1)
    const y = node.y.toFixed(1)
    node.root.style.transform =
      scale === 1 ? `translate3d(${x}px, ${y}px, 0)` : `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    node.blush.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  start(): void {
    if (this.running || this.disposed) return
    this.running = true
    this.raf = requestAnimationFrame(this.loop)
  }

  stop(): void {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private loop = (): void => {
    if (!this.running) return
    this.t += 0.006
    const now = performance.now()
    const header = this.variant === 'header'
    for (const node of this.nodes) {
      const spotting = node.spotUntil > now
      let bx: number
      let by: number
      if (spotting) {
        bx = node.spotX
        by = node.spotY
      } else {
        const a = this.t * node.speed + node.phase
        bx = node.cx + Math.cos(a) * node.rx
        by = node.cy + Math.sin(a * 1.15) * node.ry
        if (this.pointer.active) {
          const dx = bx - this.pointer.x
          const dy = by - this.pointer.y
          const dist = Math.hypot(dx, dy) || 1
          const push = Math.max(0, 1 - dist / (header ? 160 : 220)) * (header ? 70 : 120)
          bx += (dx / dist) * push
          by += (dy / dist) * push
        }
      }
      const k = spotting ? 0.16 : 0.12
      node.x += (bx - node.x) * k
      node.y += (by - node.y) * k
      node.pop += ((spotting ? 1 : 0) - node.pop) * 0.1
      this.paint(node, 1 + 0.09 * node.pop)
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    this.disposed = true
    this.stop()
    this.cleanup.forEach((fn) => fn())
    this.ro?.disconnect()
    this.nodes.forEach((n) => {
      if (n.labelTimer) clearTimeout(n.labelTimer)
      n.root.parentNode?.removeChild(n.root)
      n.blush.parentNode?.removeChild(n.blush)
    })
    this.nodes = []
  }
}
