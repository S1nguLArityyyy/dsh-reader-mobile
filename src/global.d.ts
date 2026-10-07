import type { DshApi } from './api/types'

declare global {
  interface Window {
    api: DshApi
  }
}

export {}
