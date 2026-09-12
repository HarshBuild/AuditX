import { useCallback, useEffect, useRef, useState } from 'react'
import { Aperture, Camera, CameraOff, ImagePlus, Loader2, X, Zap } from 'lucide-react'

/**
 * Real device camera capture via getUserMedia.
 * - opens the rear camera with a live preview
 * - captures a frame → produces a real File (JPEG) handed to the parent
 * - handles permission-denied / no-camera / insecure-context failures with
 *   clear guidance and a fallback to the photo gallery
 */
export interface CameraCaptureResult {
  file: File
  dataUrl: string
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
      setError('Camera is unavailable in this browser context (needs HTTPS or file://). Use "Gallery" or the device camera button instead.')
      return
    }
    setState('starting')
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      setState('live')
    } catch (e) {
      const err = e as DOMException
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        setError('Camera permission was denied. Allow camera access for this site in your browser and try again.')
      } else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
        setError('No camera was found on this device.')
      } else if (err?.name === 'NotReadableError') {
        setError('The camera is already in use by another app. Close it and retry.')
      } else {
        setError('Could not start the camera. Try the gallery or the device camera button instead.')
      }
      setState('error')
    }
  }, [])

  useEffect(() => {
    if (!open) {
      stopStream()
      setState('starting')
      setError('')
      setTorchOn(false)
      return
    }
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
      onCapture({ file, dataUrl })
    } catch {
      setError('Could not capture the frame. Point the camera at the label and try again.')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Camera className="h-4 w-4 text-brand-400" /> Capture label photo
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
          {state === 'live' && (
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          )}
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
          {/* camera guides */}
          <div className="pointer-events-none absolute inset-4 rounded-xl border-2 border-dashed border-white/25" />
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3">
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