import { useCallback, useEffect, useRef, useState } from 'react'
import { Aperture, Camera, CameraOff, Check, ImagePlus, Loader2, RotateCcw, X, Zap } from 'lucide-react'

/**
 * Real device camera capture via getUserMedia, with a
 * live preview → capture → review → retake / use-photo flow.
 *
 * - prefers the rear camera (falls back to any camera, then the front camera)
 * - produces a real JPEG File handed to the parent through onCapture
 * - shows a review step ("Retake" / "Use photo") so the user confirms the shot
 * - handles permission-denied / no-camera / busy / insecure-context failures
 *   with clear guidance and a fallback to the gallery
 */
export interface CameraCaptureResult {
  file: File
  dataUrl: string
}

function errorMessage(err: unknown, secure: boolean): string {
  const e = err as DOMException | undefined
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
    return 'Camera permission was denied. Allow camera access for this site in your browser settings, then press Try again.'
  }
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
    return 'No camera was detected on this device. Use the Gallery button or the device camera button instead.'
  }
  if (e?.name === 'NotReadableError') {
    return 'The camera is already in use by another app. Close that app and press Try again.'
  }
  if (!secure) {
    return 'Camera needs a secure connection (HTTPS). Open this app over HTTPS or use the Gallery / device camera instead.'
  }
  return 'Could not start the camera. Try again, or use the Gallery / device camera button instead.'
}

export default function CameraCapture({
  open,
  onCapture,
  onClose,
}: {
  open: boolean
  onCapture: (r: CameraCaptureResult) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<'starting' | 'live' | 'error'>('starting')
  const [shot, setShot] = useState<CameraCaptureResult | null>(null)
  const [error, setError] = useState<string>('')
  const [torchOn, setTorchOn] = useState(false)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  /* Attach the acquired stream to the <video> element. The element only
     mounts once state flips to 'live', so this must happen in an effect —
     attaching it inside start() runs while the element is still unmounted. */
  const attachStream = useCallback(() => {
    const video = videoRef.current
    if (state !== 'live' || !streamRef.current || !video) return
    if (video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current
      void video.play().catch(() => {
        /* not-yet-visible or unmuted playback can reject — harmless */
      })
    }
  }, [state])

  useEffect(() => {
    attachStream()
  }, [attachStream])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error')
      setError(
        window.isSecureContext === false
          ? 'Camera needs a secure connection (HTTPS). Open this app over HTTPS or use the Gallery / device camera instead.'
          : 'This browser does not support the device camera. Use the Gallery button or the device camera button instead.',
      )
      return
    }
    const secure = window.isSecureContext !== false
    setState('starting')
    setError('')
    const attempts: MediaTrackConstraints[] = [
      { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { width: { ideal: 1920 }, height: { ideal: 1080 } },
      { facingMode: 'user' },
    ]
    let lastErr: unknown = null
    try {
      for (const video of attempts) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false })
          streamRef.current = stream
          setState('live')
          return
        } catch (e) {
          lastErr = e
          const name = (e as DOMException)?.name
          if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotReadableError') {
            setState('error')
            setError(errorMessage(e, secure))
            return
          }
        }
      }
      throw lastErr
    } catch (e) {
      setState('error')
      setError(errorMessage(e, secure))
    }
  }, [])

  useEffect(() => {
    if (!open) {
      stopStream()
      setState('starting')
      setShot(null)
      setError('')
      setTorchOn(false)
      return
    }
    setShot(null)
    void start()
    return () => stopStream()
  }, [open, start, stopStream])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || typeof (track as unknown as { applyConstraints?: unknown }).applyConstraints !== 'function') return
    try {
      await (track as MediaStreamTrack).applyConstraints({ advanced: [{ torch: !torchOn }] } as unknown as MediaTrackConstraints)
      setTorchOn(!torchOn)
    } catch {
      /* torch unsupported — ignore */
    }
  }

  const capture = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) return
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1400 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      const blob = dataUrlToBlob(dataUrl)
      const file = new File([blob], `label-${Date.now()}.jpg`, { type: 'image/jpeg' })
      // Release the camera while the shot is reviewed (battery + privacy).
      stopStream()
      setTorchOn(false)
      setShot({ file, dataUrl })
    } catch {
      setError('Could not capture the frame. Point the camera at the label and try again.')
    }
  }

  const usePhoto = () => {
    if (!shot) return
    onCapture(shot)
    setShot(null)
    // Camera is already stopped after the capture — start a fresh preview so
    // the next photo (front / back / side) is one tap away.
    void start()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/90 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-950 shadow-2xl sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Camera className="h-4 w-4 text-brand-400" /> {shot ? 'Review captured photo' : 'Capture label photo'}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative min-h-0 flex-1 bg-black">
          {state === 'starting' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-brand-400" />
              <p className="text-sm text-slate-400">Starting camera…</p>
            </div>
          )}
          {shot ? (
            <img src={shot.dataUrl} alt="Captured product label" className="h-full w-full object-contain" />
          ) : state === 'live' ? (
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          ) : null}
          {state === 'error' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <CameraOff className="h-9 w-9 text-slate-500" />
              <p className="text-sm leading-relaxed text-slate-300">{error}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void start()}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                >
                  Use gallery
                </button>
              </div>
            </div>
          )}
          {/* camera guides — hidden once a shot is being reviewed */}
          {!shot && state === 'live' && <div className="pointer-events-none absolute inset-4 rounded-xl border-2 border-dashed border-white/25" />}
        </div>

        {shot ? (
          <div className="flex items-center justify-center gap-3 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-4">
            <button
              type="button"
              onClick={() => {
                setShot(null)
                void start()
              }}
              className="flex items-center gap-2 rounded-lg border border-slate-600 px-5 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
            >
              <RotateCcw className="h-4 w-4" /> Retake
            </button>
            <button
              type="button"
              onClick={usePhoto}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              <Check className="h-4 w-4" /> Use photo
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
            <button
              type="button"
              onClick={toggleTorch}
              disabled={state !== 'live'}
              aria-label="Toggle flash"
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
            >
              <Zap className={`h-4 w-4 ${torchOn ? 'text-brand-400' : ''}`} /> Flash
            </button>
            <button
              type="button"
              onClick={capture}
              disabled={state !== 'live'}
              aria-label="Capture photo"
              className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-brand-600 text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Aperture className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
            >
              <ImagePlus className="h-4 w-4" /> Gallery
            </button>
          </div>
        )}
        <p className="border-t border-slate-800 px-4 py-2 text-center text-[11px] text-slate-500">
          Point the camera at the mandatory-declarations block and keep it steady.
        </p>
      </div>
    </div>
  )
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/data:(.*?);/)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}