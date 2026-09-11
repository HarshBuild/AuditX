import { useCallback, useEffect, useState } from 'react'

interface QueryResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  refresh: () => void
}

type QueryFn<T> = () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export function useFirebaseQuery<T>(fn: QueryFn<T>, deps: unknown[] = []): QueryResult<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void (async () => {
      const res = await fn()
      if (!active) return
      setData(res.data ?? [])
      setError(res.error ? res.error.message : null)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [...deps, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  return { data, loading, error, refresh }
}