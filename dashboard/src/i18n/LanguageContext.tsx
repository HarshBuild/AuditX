import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, type DictKey } from './en'
import { hi } from './hi'

export type Lang = 'en' | 'hi'

const STORAGE_KEY = 'auditx-lang'

const DICTS: Record<Lang, Record<DictKey, string>> = { en, hi }

function readInitial(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'hi' || v === 'en') return v
  } catch {
    /* ignore */
  }
  return 'en'
}

interface LanguageValue {
  lang: Lang
  setLang: (l: Lang) => void
  /** Translate a key; falls back to English when missing. Supports {var} interpolation. */
  t: (key: DictKey, vars?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitial)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      document.documentElement.lang = lang === 'hi' ? 'hi' : 'en'
    } catch {
      /* ignore */
    }
  }, [lang])

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>): string => {
      const dict = DICTS[lang] ?? en
      let s: string = dict[key] ?? en[key] ?? key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
