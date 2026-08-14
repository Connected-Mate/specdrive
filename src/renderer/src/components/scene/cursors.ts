// Flying agent cursors — Figma-style pointers with name pills drifting on
// elliptical paths, scattering away from the real pointer. Plain DOM, no deps.

const ARROW_PATH =
  'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L5.94 2.47a.5.5 0 0 0-.44.74Z'

export interface CursorDef {
  name: string
  color: string
}

interface CursorNode {
  root: HTMLDivElement
  blush: HTMLDivElement
  cx: number
  cy: number
  rx: number
  ry: number
  phase: number
  speed: number
  x: number
  y: number
  tx: number
  ty: number
}

const TWO_PI = Math.PI * 2

export class FlyingCursors {
  private host: HTMLElement
  private defs: CursorDef[]
  private nodes: CursorNode[] = []
  private raf = 0
  private running = false
  private disposed = false
  private t = 0
  private pointer = { x: -9999, y: -9999, active: false }
  private ro?: ResizeObserver
  private cleanup: (() => void)[] = []

  constructor(host: HTMLElement, defs: CursorDef[]) {
    this.host = host
    this.defs = defs
    this.build()
    this.bindEvents()
    this.layout()
  }

  private build(): void {
    for (const def of this.defs) {
      const blush = document.createElement('div')
      const SIZE = 260
      Object.assign(blush.style, {
        position: 'absolute',
        left: `${-SIZE / 2}px`,
        top: `${-SIZE / 2}px`,
        width: `${SIZE}px`,
        height: `${SIZE}px`,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${def.color} 0%, transparent 74%)`,
        opacity: '0.5',
        filter: 'blur(26px)',
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
        zIndex: '5'
      })
      root.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             style="display:block; filter:drop-shadow(0 2px 3px rgba(0,0,0,0.18))">
          <path d="${ARROW_PATH}" fill="${def.color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
        <span style="
          position:absolute; left:15px; top:16px; white-space:nowrap;
          padding:2px 7px; border-radius:9px; border-top-left-radius:2px;
          font-size:10px; font-weight:600; letter-spacing:-0.01em;
          line-height:1.35; color:#fff; background:${def.color};
          box-shadow:0 2px 6px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.22);
          font-family:'Portal Sans', -apple-system, sans-serif;
        ">${def.name}</span>
      `
      this.host.appendChild(root)
      this.nodes.push({
        root,
        blush,
        cx: 0.5,
        cy: 0.5,
        rx: 0.3,
        ry: 0.3,
        phase: 0,
        speed: 1,
        x: 0,
        y: 0,
        tx: 0,
        ty: 0
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

  private layout(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    const n = this.nodes.length
    this.nodes.forEach((node, i) => {
      node.cx = (0.28 + 0.44 * ((i + 0.5) / n)) * w
      node.cy = (0.3 + 0.36 * (i % 2)) * h
      node.rx = (0.15 + 0.06 * (i % 2)) * w
      node.ry = (0.18 + 0.06 * ((i + 1) % 2)) * h
      node.phase = (i / n) * TWO_PI
      node.speed = 0.45 + 0.16 * i
      // Start on the path, not at the origin.
      node.x = node.cx + Math.cos(node.phase) * node.rx
      node.y = node.cy + Math.sin(node.phase * 1.15) * node.ry
    })
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
    for (const node of this.nodes) {
      const a = this.t * node.speed + node.phase
      let bx = node.cx + Math.cos(a) * node.rx
      let by = node.cy + Math.sin(a * 1.15) * node.ry
      if (this.pointer.active) {
        const dx = bx - this.pointer.x
        const dy = by - this.pointer.y
        const dist = Math.hypot(dx, dy) || 1
        const push = Math.max(0, 1 - dist / 220) * 120
        bx += (dx / dist) * push
        by += (dy / dist) * push
      }
      node.tx = bx
      node.ty = by
      node.x += (node.tx - node.x) * 0.12
      node.y += (node.ty - node.y) * 0.12
      node.root.style.transform = `translate3d(${node.x.toFixed(1)}px, ${node.y.toFixed(1)}px, 0)`
      node.blush.style.transform = `translate3d(${node.x.toFixed(1)}px, ${node.y.toFixed(1)}px, 0)`
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    this.disposed = true
    this.stop()
    this.cleanup.forEach((fn) => fn())
    this.ro?.disconnect()
    this.nodes.forEach((n) => {
      n.root.parentNode?.removeChild(n.root)
      n.blush.parentNode?.removeChild(n.blush)
    })
    this.nodes = []
  }
}
