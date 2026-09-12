/*
 * AuditX — brand icon generator (pure Node, zero dependencies).
 *
 * Draws the AuditX logomark (gradient tile + white check + "X" accent curve)
 * and rasterizes it to the PNG + ICO files consumed by the PWA manifest,
 * favicon and the Electron Windows build.
 *
 *   node scripts/make-icons.mjs
 *
 * Outputs:
 *   public/icons/favicon.png         64×64
 *   public/icons/icon-192.png        192×192 (any)
 *   public/icons/icon-512.png        512×512 (any)
 *   public/icons/icon-maskable-512   512×512 (maskable, full-bleed)
 *   public/icons/icon-180.png        180×180 (apple-touch)
 *   ../desktop/build/icon.ico        Windows icon (256 embedded)
 *   ../desktop/build/icon.png        512×512 desktop fallback
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

/* ---------------- minimal PNG/ICO encoders ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/** Encode an RGBA (Uint8Array, w*h*4) buffer as a PNG buffer. */
function encodePng(width, height, rgba) {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const dst = y * stride + 1 + x * 4
      raw[dst] = rgba[src]
      raw[dst + 1] = rgba[src + 1]
      raw[dst + 2] = rgba[src + 2]
      raw[dst + 3] = rgba[src + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Wrap a 256×256 PNG into a single-image .ico container. */
function encodeIco(pngBuf) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count
  const entry = Buffer.alloc(16)
  entry[0] = 0 // 256px (0 means 256)
  entry[1] = 0
  entry[2] = 0 // color count
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bpp
  entry.writeUInt32LE(pngBuf.length, 8)
  entry.writeUInt32LE(6 + 16, 12) // data offset
  return Buffer.concat([header, entry, pngBuf])
}

/* ---------------- drawing ---------------- */

const U = 24 // logical coordinate space, mirrors the SVG logomark

function lerp(a, b, t) {
  return a + (b - a) * t
}

/** Background gradient: brand-500 → brand-600 → brand-800, top → bottom. */
function bgColor(y /* unit y 0..24 */) {
  const t = y / U
  if (t < 0.5) {
    const k = t * 2
    return [lerp(0x3b, 0x25, k), lerp(0x82, 0x63, k), lerp(0xf6, 0xeb, k)]
  }
  const k = (t - 0.5) * 2
  return [lerp(0x25, 0x1e, k), lerp(0x63, 0x40, k), lerp(0xeb, 0xaf, k)]
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** Flatten a cubic bézier curve to sample points for stroke distance tests. */
function flattenCubic(p0, p1, p2, p3, steps) {
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    pts.push([
      mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
      mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return pts
}

const CHECK = [
  [5, 13],
  [10, 18],
  [19, 7],
]
const X_PTS = flattenCubic([14, 5.5], [16, 5], [18, 5], [18.5, 6.5], 12)
  .concat(flattenCubic([18.5, 6.5], [19, 8], [17.5, 9.5], [16, 10.5], 12))

function distToPolyline(px, py, pts, closed) {
  let min = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    min = Math.min(min, distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
  }
  if (closed) min = Math.min(min, distToSegment(px, py, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]))
  return min
}

function roundedRectCoverage(x, y, w, h, r) {
  const cx = Math.max(r, Math.min(w - r, x))
  const cy = Math.max(r, Math.min(h - r, y))
  const dx = x - cx
  const dy = y - cy
  const d = Math.hypot(dx, dy)
  const insideRect = x >= 0 && x <= w && y >= 0 && y <= h
  if (!insideRect) return 0
  const inCorner = (x < r || x > w - r) && (y < r || y > h - r)
  if (inCorner) return d <= r ? 1 : 0
  return 1
}

const WHITE = [255, 255, 255]
const ACCENT = [0xbf, 0xdb, 0xfe] // brand-200

/**
 * Render one icon.
 * @param opts {size, maskable, strokeScale}
 */
function renderIcon(size, maskable) {
  const SS = 3 // supersample factor per axis
  const px = new Float32Array(size * size * 4)
  const fullBleed = maskable
  // Art is inset so the maskable safe zone (center 80%) is respected.
  const artScale = maskable ? 0.8 : 1
  const cornerR = maskable ? 0 : 3.2 // unit radius on the tile corners

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS
          const fy = y + (sy + 0.5) / SS
          const ux = (((fx / size) - 0.5) / artScale + 0.5) * U
          const uy = (((fy / size) - 0.5) / artScale + 0.5) * U

          // Background tile.
          let cov
          if (fullBleed) {
            cov = 1
          } else {
            const r = Math.min(U / 2 - 0.5, cornerR)
            cov = roundedRectCoverage(ux, uy, U, U, r)
          }
          if (cov <= 0) continue

          let rgb = bgColor(uy)

          // White check mark.
          const dCheck = distToPolyline(ux, uy, CHECK, false)
          if (dCheck <= 2.9) rgb = WHITE
          else {
            // "X" accent curve in brand-200.
            const dX = distToPolyline(ux, uy, X_PTS, false)
            if (dX <= 2.1) rgb = ACCENT
          }

          acc[0] += rgb[0] * cov
          acc[1] += rgb[1] * cov
          acc[2] += rgb[2] * cov
          acc[3] += 255 * cov
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      px[i] = Math.round(acc[0] / n)
      px[i + 1] = Math.round(acc[1] / n)
      px[i + 2] = Math.round(acc[2] / n)
      px[i + 3] = Math.round(acc[3] / n)
    }
  }
  return encodePng(size, size, Buffer.from(px.buffer))
}

/* ---------------- emitting ---------------- */

const publicIcons = join(root, '..', 'public', 'icons')
const desktopBuild = join(root, '..', '..', 'desktop', 'build')
mkdirSync(publicIcons, { recursive: true })
mkdirSync(desktopBuild, { recursive: true })

const files = [
  [join(publicIcons, 'favicon.png'), renderIcon(64, false)],
  [join(publicIcons, 'icon-192.png'), renderIcon(192, false)],
  [join(publicIcons, 'icon-512.png'), renderIcon(512, false)],
  [join(publicIcons, 'icon-maskable-512.png'), renderIcon(512, true)],
  [join(publicIcons, 'icon-180.png'), renderIcon(180, false)],
  [join(desktopBuild, 'icon.png'), renderIcon(512, false)],
  [join(desktopBuild, 'icon.ico'), encodeIco(renderIcon(256, false))],
]

for (const [path, buf] of files) {
  writeFileSync(path, buf)
  console.log(`[icons] ${path.replace(root + '\\..\\', '')}  (${buf.length} bytes)`)
}
console.log('[icons] done')