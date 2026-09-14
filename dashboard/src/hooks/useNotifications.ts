import { useCallback, useEffect, useState } from 'react'
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'
import { COLLECTIONS } from '../lib/db'
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

/**
 * Realtime (Firestore) notifications for the signed-in user. Supabase realtime
 * equivalent: `onSnapshot` on the notifications collection.
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
    const uid = auth.currentUser?.uid
    if (!uid) {
      setItems([])
      setUnread(0)
      return
    }
    const ref = query(collection(db, COLLECTIONS.NOTIFICATIONS), where('user_id', '==', uid), limit(30))
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        const mine = snap.docs
          .filter((d) => d.data().user_id === uid)
          .map((d) => ({ id: d.id, ...d.data() }) as unknown as NotificationRow)
          .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
        setItems(mine.map(toAppNotification))
        setUnread(mine.filter((n) => !n.read).length)
      },
      () => {
        /* transient listener errors are surfaced through the query loads */
      },
    )
    return () => unsubscribe()
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