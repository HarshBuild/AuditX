import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { markAllNotificationsRead, markNotificationRead } from '../lib/services'
import type { NotificationRow } from '../lib/types2'
import type { AppNotification, NotificationType } from '../types'
import { timeAgo } from '../utils/format'

function typeOf(t: string): NotificationType {
  if (t === 'record') return 'record'
  if (t === 'report' || t === 'scan' || t === 'review') return 'report'
  if (t === 'account' || t === 'admin' || t === 'system') return 'system'
  return 'action'
}

function toAppNotification(n: NotificationRow): AppNotification {
  return {
    id: n.id,
    type: typeOf(n.type),
    title: n.title,
    message: n.body,
    time: timeAgo(n.created_at),
    unread: !n.read,
  }
}

function toRow(r: Record<string, unknown>): NotificationRow {
  const { data: _drop, ...cols } = r
  void _drop
  const extras = (r.data ?? {}) as Record<string, unknown>
  return { ...extras, ...cols } as unknown as NotificationRow
}

/**
 * Realtime notifications for the signed-in user (Supabase Realtime on the
 * notifications table, filtered to the caller's own inbox).
 */
export function useNotifications({ enabled = true }: { enabled?: boolean } = {}) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setItems([])
      setUnread(0)
      return
    }
    let stopped = false
    let channel: ReturnType<typeof supabase.channel> | null = null
    void (async () => {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth.user?.id
      if (stopped || !uid) {
        if (!stopped) {
          setItems([])
          setUnread(0)
        }
        return
      }
      const load = async () => {
        const { data } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(30)
        if (stopped) return
        const mine = ((data ?? []) as Record<string, unknown>[]).map(toRow)
        setItems(mine.map(toAppNotification))
        setUnread(mine.filter((n) => !n.read).length)
      }
      await load()
      if (stopped) return
      channel = supabase
        .channel(`notifications-${uid}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
          () => {
            void load()
          },
        )
        .subscribe()
    })()
    return () => {
      stopped = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [enabled])

  const markOne = useCallback((id: string) => {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, unread: false } : n)))
    setUnread((u) => Math.max(0, u - 1))
    void markNotificationRead(id).catch((e) => console.error('markNotificationRead failed', e))
  }, [])

  const markAll = useCallback(() => {
    setItems((list) => list.map((n) => ({ ...n, unread: false })))
    setUnread(0)
    void markAllNotificationsRead().catch((e) => console.error('markAllNotificationsRead failed', e))
  }, [])

  return { items, unread, markOne, markAll }
}
