/**
 * AuditX — Electron preload bridge.
 *
 * Exposes a minimal, read-only platform marker so the renderer-side
 * platform.ts can reliably detect the Windows desktop shell even if the
 * user-agent string is stripped.
 */

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('auditxDesktop', {
  isDesktop: true,
})