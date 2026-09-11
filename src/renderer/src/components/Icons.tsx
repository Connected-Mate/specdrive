import React from 'react'

export const PlaneIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M3.5 11.2 20.6 3.9c.6-.25 1.2.33.97.94l-6.6 17.3c-.25.65-1.18.62-1.4-.04l-2.34-7.1a.75.75 0 0 0-.47-.47l-7.2-2.4c-.66-.22-.7-1.14-.06-1.4Z" fill="#fff" />
  </svg>
)

/** Four-pointed guiding star — the SpecDrive mark */
export const StarIcon = (): React.JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2c.9 5.2 3.4 8.1 10 10-6.6 1.9-9.1 4.8-10 10-.9-5.2-3.4-8.1-10-10 6.6-1.9 9.1-4.8 10-10Z"
      fill="#fff"
    />
  </svg>
)

export const SidebarIcon = (): React.JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
    <rect x="1.5" y="2.5" width="15" height="13" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 3v12" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

/** The same glyph, mirrored — the guide rail on the right of the pane. */
export const RailIcon = (): React.JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
    <rect x="1.5" y="2.5" width="15" height="13" rx="3.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M11 3v12" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

export const TickIcon = ({ size = 12 }: { size?: number }): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="tick">
    <path
      d="M3 8.5 6.5 12 13 4.5"
      pathLength={1}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
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

export const GearIcon = (): React.JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
    <path
      d="M10.34 3.94c.09-.54.56-.94 1.11-.94h1.1c.55 0 1.02.4 1.11.94l.15.9c.07.42.38.76.78.93.4.16.85.14 1.2-.11l.74-.53c.45-.32 1.06-.27 1.45.12l.77.78c.39.39.44 1 .12 1.45l-.53.74c-.25.35-.27.8-.1 1.2.16.4.5.71.93.78l.9.15c.54.09.94.56.94 1.11v1.1c0 .55-.4 1.02-.94 1.11l-.9.15c-.42.07-.76.38-.93.78-.16.4-.14.85.1 1.2l.53.74c.32.45.27 1.06-.12 1.45l-.77.77c-.39.39-1 .44-1.45.12l-.74-.53c-.35-.25-.8-.27-1.2-.1-.4.16-.71.5-.78.93l-.15.9c-.09.54-.56.94-1.11.94h-1.1c-.55 0-1.02-.4-1.11-.94l-.15-.9c-.07-.42-.38-.76-.78-.93-.4-.16-.85-.14-1.2.11l-.74.53c-.45.32-1.06.27-1.45-.12l-.77-.78a1.13 1.13 0 0 1-.12-1.45l.53-.74c.25-.35.27-.8.1-1.2-.16-.4-.5-.71-.93-.78l-.9-.15A1.13 1.13 0 0 1 3 12.55v-1.1c0-.55.4-1.02.94-1.11l.9-.15c.42-.07.76-.38.93-.78.16-.4.14-.85-.1-1.2l-.53-.74a1.13 1.13 0 0 1 .12-1.45l.77-.77c.39-.39 1-.44 1.45-.12l.74.53c.35.25.8.27 1.2.1.4-.16.71-.5.78-.93l.15-.9Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
  </svg>
)

export const FolderIcon = ({ size = 13 }: { size?: number }): React.JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
    <path
      d="M1.9 4.6a1.6 1.6 0 0 1 1.6-1.6h2.7c.5 0 1 .24 1.3.65l.6.8h6.4a1.6 1.6 0 0 1 1.6 1.6v7.35a1.6 1.6 0 0 1-1.6 1.6H3.5a1.6 1.6 0 0 1-1.6-1.6V4.6Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)

export const PencilIcon = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path
      d="M11.1 2.4a1.6 1.6 0 0 1 2.26 2.26l-7.3 7.3-3 .74.74-3 7.3-7.3Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
)

export const PlusIcon = (): React.JSX.Element => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
)

/** Two saved team members — the Agents (crew) module. */
export const CrewIcon = (): React.JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
    <circle cx="9" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M3.6 19.2c.6-3.3 2.9-5 5.4-5s4.8 1.7 5.4 5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M15.2 5.3a3.1 3.1 0 0 1 0 5.9M17.6 19.2c-.45-2.5-1.85-4.1-3.7-4.8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
)

export const FolderPlusIcon = (): React.JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
    <path
      d="M1.9 4.6a1.6 1.6 0 0 1 1.6-1.6h2.7c.5 0 1 .24 1.3.65l.6.8h6.4a1.6 1.6 0 0 1 1.6 1.6v7.35a1.6 1.6 0 0 1-1.6 1.6H3.5a1.6 1.6 0 0 1-1.6-1.6V4.6Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M9 7.6v4.2M6.9 9.7h4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
