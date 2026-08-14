import React, { useEffect } from 'react'
import { CursorScene } from './CursorScene'

// Hidden treat: double-click the stamped logo and the crew takes over the
// window for a moment — dusk sky, the robot, cursors saluting.

const EGG_CHIPS = [
  'Hello, human ✦',
  'Specs before code, always',
  'Built at dusk',
  'The crew salutes you',
  'Idea → board → build',
  'You found us',
  'Nothing ships unwalked',
  'See you on the board'
]

export function EasterEgg({ onClose }: { onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(onClose, 8000)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="egg-overlay" onClick={onClose} role="presentation">
      <img className="egg-robot" src="images/robot-dusk.png" alt="" />
      <CursorScene word="You found the crew" chips={EGG_CHIPS} />
      <span className="egg-hint">click anywhere to get back to work</span>
    </div>
  )
}
