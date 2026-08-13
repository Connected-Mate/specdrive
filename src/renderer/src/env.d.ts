/// <reference types="vite/client" />
import type { SpecDriveApi } from '@shared/types'

declare global {
  interface Window {
    specdrive: SpecDriveApi
  }
}

export {}
