import React from 'react'

export const PlaneIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M3.5 11.2 20.6 3.9c.6-.25 1.2.33.97.94l-6.6 17.3c-.25.65-1.18.62-1.4-.04l-2.34-7.1a.75.75 0 0 0-.47-.47l-7.2-2.4c-.66-.22-.7-1.14-.06-1.4Z" fill="#fff" />
  </svg>
)

export const TickIcon = ({ size = 12 }: { size?: number }): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="tick">
    <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const CopyIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <rect x="5.5" y="5.5" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10.5 3.5v-1a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1" stroke="currentColor" strokeWidth="1.5" transform="translate(0 1)" />
  </svg>
)

export const BackIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
