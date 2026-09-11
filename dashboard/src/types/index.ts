import type { LucideIcon } from 'lucide-react'

export interface StatDefinition {
  id: string
  title: string
  value: number | string
  change?: string
  trend?: 'up' | 'down'
  icon: LucideIcon
  accent: 'brand' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan'
  hint?: string
}

export type NotificationType = 'record' | 'report' | 'action' | 'system'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  time: string
  unread: boolean
}