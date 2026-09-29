import { en, type MessageKey } from './en'

const catalogues: Record<string, Record<MessageKey, string>> = { en }
let current: Record<MessageKey, string> = en

export function setLanguage(lang: string): void {
  current = catalogues[lang] ?? en
}

/** Translate `key`, substituting `{name}` placeholders. */
export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return current[key].replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  )
}

export type { MessageKey }
