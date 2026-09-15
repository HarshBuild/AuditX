/*
 * AuditX — multi-language PDF report generator (premium enterprise theme).
 * Renders the full inspection report as styled HTML (so Indic scripts render
 * correctly in the browser), rasterizes it with html2canvas and saves it as a
 * paginated A4 PDF via jsPDF.
 *
 * Layout: an executive cover page, then content pages carrying a thin native
 * header/footer (drawn with jsPDF primitives — identical on every page) and a
 * refined inside-canvas editorial layout: kickers, hairline rules, premium
 * cards, minimal tables, status chips and a compliance progress bar.
 *
 * NOTE: this module only styles the PDF. All data, calculations, extraction
 * results, verdicts, scores and rule logic are untouched.
 */

/* eslint-disable no-console */
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { translate } from '../i18n/report'
import { riskBand, riskTone } from './risk'
import { formatDateTime } from '../utils/format'
import { displayProductName, displaySentence, displayText } from './textnorm'
import type { ScanRow } from './types2'
import type { Finding, InspectionDoc } from './inspection'

/* ------------------------------------------------------------------ */
/* Premium palette                                                     */
/* ------------------------------------------------------------------ */

const NAVY = '#0B1F3A' // deep midnight navy — primary
const CHARCOAL = '#232B36' // rich charcoal — headings
const BODY = '#3A4454' // body text
const IVORY = '#F7F5F0' // soft off-white page background
const CARD = '#FFFFFF' // card surface
const BORDER = '#E5E8EE' // hairline border
const HAIRLINE = '#ECEEF3' // finer hairline
const SILVER = '#8B95A5' // muted secondary text
const BLUE = '#2E5BFF' // refined electric blue accent
const GREEN = '#1F8A5C'
const GREEN_BG = '#EAF4EF'
const AMBER = '#B97618'
const AMBER_BG = '#F8F0E1'
const RED = '#C0392B'
const RED_BG = '#FAECEA'
const SLATE = '#64748B'
const SLATE_BG = '#F1F3F6'

const FONT =
  "'Inter', -apple-system, 'Segoe UI', 'Helvetica Neue', Roboto, 'Noto Sans', Arial, sans-serif"

const t = (lang: string, key: Parameters<typeof translate>[1]) => translate(lang, key)

function scoreColor(n: number): string {
  if (n >= 80) return GREEN
  if (n >= 50) return AMBER
  return RED
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

type CopyKey = Parameters<typeof translate>[1]

function riskKeyFor(band: string): CopyKey {
  const key = 'risk_' + band.toLowerCase()
  const valid: CopyKey[] = ['risk_low', 'risk_medium', 'risk_high', 'risk_critical']
  return valid.includes(key as CopyKey) ? (key as CopyKey) : 'risk_medium'
}

function toneColor(tone: string): string {
  if (tone === 'emerald') return GREEN
  if (tone === 'amber') return AMBER
  if (tone === 'rose') return RED
  return SLATE
}

function chip(status: string): string {
  const map: Record<string, [string, string]> = {
    PASS: [GREEN, GREEN_BG],
    FAIL: [RED, RED_BG],
    WARNING: [AMBER, AMBER_BG],
    NOT_DETECTED: [SLATE, SLATE_BG],
    NOT_VERIFIABLE: [SLATE, SLATE_BG],
    NOT_APPLICABLE: [SLATE, SLATE_BG],
    REQUIRES_PHYSICAL_INSPECTION: [SLATE, SLATE_BG],
  }
  const [fg, bg] = map[status] ?? [SLATE, SLATE_BG]
  return `<span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:7.5px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;background:${bg};color:${fg};white-space:nowrap;">${esc(status)}</span>`
}

/* ------------------------------------------------------------------ */
/* Shared editorial building blocks                                    */
/* ------------------------------------------------------------------ */

function section(kicker: string, title: string): string {
  return `
    <div style="margin-bottom:14px;">
      <div style="font-size:7.5px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:${BLUE};margin-bottom:5px;">${esc(kicker)}</div>
      <div style="display:flex;align-items:baseline;gap:12px;">
        <div style="font-size:15px;font-weight:800;letter-spacing:-.2px;color:${CHARCOAL};">${esc(title)}</div>
        <div style="flex:1;height:1px;background:${HAIRLINE};"></div>
      </div>
    </div>`
}

function card(inner: string): string {
  return `<div style="background:${CARD};border:1px solid ${BORDER};border-radius:10px;box-shadow:0 1px 2px rgba(11,31,58,.04);padding:16px 18px;">${inner}</div>`
}

function detailRow(label: string, value: string): string {
  return `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:8.5px 0;border-bottom:1px solid ${HAIRLINE};">
      <span style="font-size:9px;font-weight:600;letter-spacing:.4px;color:${SILVER};flex:0 0 38%;">${esc(label)}</span>
      <span style="font-size:9.5px;font-weight:600;color:${CHARCOAL};text-align:right;word-break:break-word;flex:1;">${value || esc(t('en', 'not_available'))}</span>
    </div>`
}

function table(headers: string[], rows: string): string {
  const ths = headers
    .map(
      (h) =>
        `<th style="text-align:left;font-size:7.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${SILVER};padding:0 0 8px;border-bottom:1px solid ${BORDER};">${esc(h)}</th>`,
    )
    .join('')
  return `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>${ths}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${headers.length}" style="padding:10px 0;font-size:9.5px;color:${SILVER};">${esc(t('en', 'no_rules'))}</td></tr>`}</tbody>
    </table>`
}

function td(content: string, opts: { width?: string; right?: boolean; color?: string; bold?: boolean; top?: boolean } = {}): string {
  const w = opts.width ? `width:${opts.width};` : ''
  const align = opts.right ? 'right' : 'left'
  const color = opts.color ?? CHARCOAL
  const weight = opts.bold ? '700' : '500'
  return `<td style="${w}text-align:${align};font-size:9.5px;font-weight:${weight};color:${color};padding:9px 0;border-bottom:1px solid ${HAIRLINE};vertical-align:top;word-break:break-word;">${content}</td>`
}

/* ------------------------------------------------------------------ */
/* Content pages                                                       */
/* ------------------------------------------------------------------ */

function buildReportHtml(scan: ScanRow, lang: string): string {
  const risk = scan.risk_score ?? 100 - scan.overall_score
  const band = riskBand(risk)
  const verdictMap: Record<string, string> = {
    COMPLIANT: t(lang, 'verdict_compliant'),
    PARTIALLY_COMPLIANT: t(lang, 'verdict_partial'),
    NON_COMPLIANT: t(lang, 'verdict_non_compliant'),
    REQUIRES_PHYSICAL_INSPECTION: t(lang, 'verdict_review'),
  }
  const verdictText = verdictMap[scan.verdict] ?? scan.verdict
  const verdictColor =
    scan.verdict === 'NON_COMPLIANT'
      ? RED
      : scan.verdict === 'PARTIALLY_COMPLIANT' || scan.verdict === 'REQUIRES_PHYSICAL_INSPECTION'
        ? AMBER
        : GREEN
  const riskToneName = riskTone(band)
  const bandText = `${esc(risk)}/100 · ${esc(t(lang, riskKeyFor(band)))}`

  const rulesRows = (scan.rules ?? [])
    .slice(0, 80)
    .map(
      (r) => `<tr>${td(`<span style="font-family:ui-monospace,'SF Mono',Consolas,monospace;font-size:8.5px;font-weight:600;color:${BLUE};">${esc(r.rule_id)}</span>`, { width: '9%' })}${td(esc(displayText(r.field)), { width: '18%', color: CHARCOAL, bold: true })}${td(chip(r.status), { width: '15%' })}${td(esc(displayText(r.extracted_text)), { width: '28%', color: BODY })}${td(esc(displaySentence(r.issue)), { width: '30%', color: BODY })}</tr>`,
    )
    .join('')

  const labelsRows = (scan.labels ?? [])
    .map(
      (lb) => `<tr>${td(esc(displayText(lb.label)), { width: '46%', color: CHARCOAL, bold: true })}${td(chip(lb.verdict), { width: '27%' })}${td(`<span style="font-weight:800;color:${scoreColor(lb.score)};">${esc(lb.score)}/100</span>`, { width: '27%', right: true })}</tr>`,
    )
    .join('')

  const suggestions = (scan.assistant?.suggestions ?? [])
    .map(
      (s) =>
        `<li style="margin:6px 0;font-size:9.5px;line-height:1.5;color:${BODY};">${esc(displaySentence(s))}</li>`,
    )
    .join('')

  const exRec = (scan.extractions ?? {}) as Record<string, string | null | undefined>
  const declarationLabels: { key: string; label: string }[] = [
    { key: 'commodity_name', label: 'Generic name' },
    { key: 'mrp', label: 'MRP (incl. taxes)' },
    { key: 'net_quantity', label: 'Net quantity' },
    { key: 'unit_sale_price', label: 'Unit sale price (USP)' },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'packer', label: 'Packer' },
    { key: 'importer', label: 'Importer' },
    { key: 'address', label: 'Address' },
    { key: 'country_of_origin', label: 'Country of origin' },
    { key: 'mfg_date', label: 'Manufacturing date' },
    { key: 'best_before', label: 'Best before / expiry' },
    { key: 'lot_no', label: 'Batch / lot no.' },
    { key: 'consumer_care', label: 'Consumer care' },
    { key: 'fssai_license', label: 'FSSAI licence no.' },
    { key: 'veg_nonveg', label: 'Veg / Non-veg' },
    { key: 'ingredients', label: 'Ingredients' },
    { key: 'allergens', label: 'Allergens' },
    { key: 'nutrition_info', label: 'Nutrition info' },
  ]
  const specLabels: { key: string; label: string }[] = [
    { key: 'model', label: 'Model / product code' },
    { key: 'serial_number', label: 'Serial number' },
    { key: 'material', label: 'Material' },
    { key: 'dimensions', label: 'Dimensions' },
    { key: 'capacity', label: 'Capacity' },
    { key: 'voltage', label: 'Voltage' },
    { key: 'power', label: 'Power' },
    { key: 'current', label: 'Current' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'website', label: 'Website' },
    { key: 'email', label: 'Email' },
    { key: 'certifications', label: 'Certifications / marks' },
    { key: 'warnings', label: 'Warnings' },
    { key: 'instructions', label: 'Instructions' },
  ]
  const declarationRows = scan.extractions
    ? declarationLabels
        .filter((d) => exRec[d.key])
        .map(
          (d) =>
            `<tr>${td(`<span style="font-weight:600;color:${SILVER};">${esc(d.label)}</span>`, { width: '42%' })}${td(esc(displayText(exRec[d.key])), { width: '58%', color: CHARCOAL, bold: true })}</tr>`,
        )
        .join('')
    : ''
  const specRows = specLabels
    .filter((d) => exRec[d.key])
    .map(
      (d) =>
        `<tr>${td(`<span style="font-weight:600;color:${SILVER};">${esc(d.label)}</span>`, { width: '42%' })}${td(esc(displayText(exRec[d.key])), { width: '58%', color: CHARCOAL, bold: true })}</tr>`,
    )
    .join('')

  const score = Math.max(0, Math.min(100, scan.overall_score))
  const scoreFill = scoreColor(scan.overall_score)

  return `
  <div style="box-sizing:border-box;width:794px;background:${IVORY};color:${BODY};font-family:${FONT};padding:52px 56px 92px;">

    <div style="margin-bottom:34px;">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px;">
        <span style="font-size:13px;font-weight:800;letter-spacing:-.2px;color:${NAVY};">Audit<span style="color:${BLUE};">X</span></span>
        <span style="font-size:8px;letter-spacing:1.6px;text-transform:uppercase;color:${SILVER};">Legal Metrology Inspection</span>
      </div>
      <div style="height:1px;background:${BORDER};"></div>
    </div>

    ${section('Executive Summary', esc(t(lang, 'report_title')))}

    <div style="display:flex;gap:14px;margin:4px 0 6px;">
      <div style="flex:1;background:${CARD};border:1px solid ${BORDER};border-radius:10px;box-shadow:0 1px 2px rgba(11,31,58,.04);padding:18px 18px 16px;">
        <div style="font-size:30px;font-weight:800;letter-spacing:-1px;color:${scoreFill};line-height:1;">${esc(scan.overall_score)}<span style="font-size:13px;font-weight:700;color:${SILVER};">/100</span></div>
        <div style="font-size:7.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${SILVER};margin-top:8px;">${esc(t(lang, 'overall_score'))}</div>
        <div style="height:5px;border-radius:999px;background:#ECEFF4;margin-top:12px;overflow:hidden;">
          <div style="height:5px;border-radius:999px;background:${scoreFill};width:${score}%;"></div>
        </div>
      </div>
      <div style="flex:1;background:${CARD};border:1px solid ${BORDER};border-radius:10px;box-shadow:0 1px 2px rgba(11,31,58,.04);padding:18px 18px 16px;">
        <div style="font-size:19px;font-weight:800;letter-spacing:-.3px;color:${verdictColor};line-height:1.15;">${esc(verdictText)}</div>
        <div style="font-size:7.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${SILVER};margin-top:9px;">${esc(t(lang, 'verdict'))}</div>
      </div>
      <div style="flex:1;background:${CARD};border:1px solid ${BORDER};border-radius:10px;box-shadow:0 1px 2px rgba(11,31,58,.04);padding:18px 18px 16px;">
        <div style="font-size:17px;font-weight:800;letter-spacing:-.3px;color:${toneColor(riskToneName)};line-height:1.15;">${bandText}</div>
        <div style="font-size:7.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${SILVER};margin-top:9px;">${esc(t(lang, 'risk_score') + ' / ' + t(lang, 'risk_band'))}</div>
      </div>
    </div>

    <div style="margin-top:34px;margin-bottom:12px;">${section('Product & Scan', esc(t(lang, 'compliance_details')))}</div>
    ${card(
      detailRow(t(lang, 'product'), scan.product_name?.trim() ? displayProductName(scan.product_name) : '') +
        detailRow(t(lang, 'brand'), displayText(scan.brand)) +
        detailRow(t(lang, 'manufacturer'), displayText(scan.manufacturer)) +
        detailRow(t(lang, 'category'), displayText(scan.category)) +
        detailRow(t(lang, 'barcode'), scan.barcode) +
        detailRow(t(lang, 'scanned_on'), formatDateTime(scan.created_at)) +
        detailRow(t(lang, 'status'), String(scan.status ?? '')),
    )}

    <div style="margin-top:34px;margin-bottom:12px;">
      ${section('Label Data', 'Extracted Declarations')}
    </div>
    ${card(declarationRows ? table(['Declaration', 'Value'], declarationRows) : `<div style="font-size:9.5px;color:${SILVER};">${esc(t(lang, 'not_available'))}</div>`)}
    ${specRows ? card(table(['Specification', 'Value'], specRows)) : ''}

    ${scan.labels && scan.labels.length > 0 ? `
      <div style="margin-top:34px;margin-bottom:12px;">${section('Label Verification', esc(t(lang, 'labels_detected')))}</div>
      ${card(table(['Detected label', 'Verdict', 'Score'], labelsRows))}
    ` : ''}

    <div style="margin-top:34px;margin-bottom:12px;">${section('Regulatory Review', esc(t(lang, 'rule_checks')))}</div>
    ${card(table(['Rule', 'Declaration', 'Status', 'Extracted', 'Findings'], rulesRows))}

    ${scan.assistant?.summary || (scan.assistant?.suggestions ?? []).length > 0 ? `
      <div style="margin-top:34px;margin-bottom:12px;">${section('AI Analysis', esc(t(lang, 'ai_assistant')))}</div>
      <div style="background:${CARD};border:1px solid ${BORDER};border-left:3px solid ${BLUE};border-radius:10px;box-shadow:0 1px 2px rgba(11,31,58,.04);padding:14px 18px;">
        <div style="font-size:10px;line-height:1.55;color:${BODY};">${esc(displaySentence(scan.assistant?.summary ?? ''))}</div>
        ${(scan.assistant?.suggestions ?? []).length > 0 ? `<div style="font-size:7.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${BLUE};margin-top:12px;">${esc(t(lang, 'suggest_next'))}</div><ul style="margin:4px 0 0 16px;padding:0;">${suggestions}</ul>` : ''}
      </div>` : ''}

    <div style="margin-top:18px;background:transparent;border:1px solid ${BORDER};border-radius:10px;padding:12px 16px;">
      <div style="font-size:7.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${SILVER};">${esc(t(lang, 'language_note'))}</div>
      <div style="font-size:9.5px;color:${BODY};margin-top:4px;line-height:1.5;">${esc(displayText(scan.language_note) || t(lang, 'not_available'))}</div>
    </div>

    <div style="margin-top:22px;font-size:8px;line-height:1.6;color:${SILVER};">
      ${esc(t(lang, 'inspector_note'))}
    </div>
  </div>`
}

/* ------------------------------------------------------------------ */
/* Cover page                                                          */
/* ------------------------------------------------------------------ */

function buildCoverHtml(scan: ScanRow, lang: string, generatedAt: string): string {
  const label = `#${scan.id.slice(0, 8)}`
  return `
  <div style="box-sizing:border-box;width:794px;height:1123px;background:${IVORY};color:${BODY};font-family:${FONT};padding:64px 68px;position:relative;overflow:hidden;">
    <div style="position:absolute;right:-70px;bottom:-70px;width:230px;height:230px;border-radius:50%;border:1px solid ${BORDER};"></div>
    <div style="position:absolute;right:76px;bottom:76px;width:10px;height:10px;border-radius:50%;background:${BLUE};"></div>
    <div style="position:absolute;right:-40px;bottom:-40px;width:140px;height:140px;border-radius:50%;border:1px solid ${BORDER};"></div>

    <div style="display:flex;align-items:baseline;justify-content:space-between;">
      <span style="font-size:15px;font-weight:800;letter-spacing:-.3px;color:${NAVY};">Audit<span style="color:${BLUE};">X</span></span>
      <span style="font-size:7.5px;letter-spacing:2px;text-transform:uppercase;color:${SILVER};">Legal Metrology Suite</span>
    </div>
    <div style="height:1px;background:${BORDER};margin-top:14px;"></div>

    <div style="margin-top:230px;">
      <div style="font-size:8px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:${BLUE};">Packaged Commodities · Inspection Report</div>
      <div style="font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1.1;color:${CHARCOAL};margin-top:18px;">${esc(t(lang, 'report_title'))}</div>
      <div style="font-size:12.5px;font-weight:400;color:${SILVER};margin-top:12px;">${esc(t(lang, 'report_subtitle'))}</div>
    </div>

    <div style="width:52px;height:3px;background:${BLUE};margin-top:34px;border-radius:999px;"></div>

    <div style="display:flex;gap:48px;margin-top:34px;">
      <div>
        <div style="font-size:7px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${SILVER};">Report ID</div>
        <div style="font-size:12px;font-weight:700;color:${CHARCOAL};margin-top:5px;">${esc(label)}</div>
      </div>
      <div>
        <div style="font-size:7px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${SILVER};">Generated</div>
        <div style="font-size:12px;font-weight:700;color:${CHARCOAL};margin-top:5px;">${esc(generatedAt)}</div>
      </div>
      <div>
        <div style="font-size:7px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${SILVER};">Language</div>
        <div style="font-size:12px;font-weight:700;color:${CHARCOAL};margin-top:5px;">${esc(lang.toUpperCase())}</div>
      </div>
    </div>

    <div style="position:absolute;left:68px;right:68px;bottom:46px;">
      <div style="height:1px;background:${BORDER};"></div>
      <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:7.5px;letter-spacing:1px;text-transform:uppercase;color:${SILVER};">
        <span>Generated by AuditX AI · Vision Extraction + Legal Metrology Rules</span>
        <span>Confidential — inspection aid, not a legal certificate</span>
      </div>
    </div>
  </div>`
}

/* ------------------------------------------------------------------ */
/* PDF assembly                                                        */
/* ------------------------------------------------------------------ */

const HEADER_PT = 64
const FOOTER_PT = 40

export async function downloadInspectionPdf(scan: ScanRow, lang: string): Promise<string> {
  const generatedAt = formatDateTime(new Date().toISOString())
  const reportId = `#${scan.id.slice(0, 8)}`

  const mount = (html: string, w: number, h: number | undefined) => {
    const el = document.createElement('div')
    el.setAttribute('aria-hidden', 'true')
    el.style.position = 'fixed'
    el.style.left = '-10000px'
    el.style.top = '0'
    el.style.zIndex = '-1'
    el.style.width = `${w}px`
    if (h) el.style.height = `${h}px`
    el.innerHTML = html
    document.body.appendChild(el)
    return el
  }

  const render = async (el: HTMLElement, bg: string) =>
    html2canvas(el, { scale: 2, backgroundColor: bg, logging: false, windowWidth: el.offsetWidth })

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()

  /* ---- Cover page ---- */
  const coverEl = mount(buildCoverHtml(scan, lang, generatedAt), 794, 1123)
  const coverCanvas = await render(coverEl, IVORY)
  coverEl.remove()
  const coverScale = pdfW / coverCanvas.width
  pdf.addImage(coverCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pdfW, coverCanvas.height * coverScale)

  /* ---- Content pages ---- */
  const contentEl = mount(buildReportHtml(scan, lang), 794, undefined)
  const canvas = await render(contentEl, IVORY)
  contentEl.remove()

  const scale = pdfW / canvas.width
  const step = Math.floor((pdfH - HEADER_PT - FOOTER_PT) / scale)
  const pages: number[] = []
  let offset = 0
  while (offset < canvas.height) {
    pages.push(offset)
    offset += step
  }
  const totalPages = pages.length

  const header = () => {
    const x = 56
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.setTextColor(11, 31, 58)
    pdf.text('Audit', x, 40)
    const aw = pdf.getTextWidth('Audit')
    pdf.setTextColor(46, 91, 255)
    pdf.text('X', x + aw + 0.5, 40)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(139, 149, 165)
    pdf.text('\u00a0\u00a0\u00b7 Legal Metrology Inspection Report', x + pdf.getTextWidth('AuditX') + 4, 40)
    pdf.setTextColor(139, 149, 165)
    pdf.text(reportId, pdfW - 56, 40, { align: 'right' })
    pdf.setDrawColor(236, 238, 243)
    pdf.setLineWidth(0.6)
    pdf.line(56, 60, pdfW - 56, 60)
  }

  const footer = (pageIdx: number) => {
    pdf.setDrawColor(236, 238, 243)
    pdf.setLineWidth(0.6)
    pdf.line(56, pdfH - 34, pdfW - 56, pdfH - 34)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(139, 149, 165)
    pdf.text('AuditX | Legal Metrology Inspection Report', 56, pdfH - 20)
    pdf.text(generatedAt, pdfW / 2, pdfH - 20, { align: 'center' })
    pdf.text(`Page ${pageIdx + 1} of ${totalPages}`, pdfW - 56, pdfH - 20, { align: 'right' })
  }

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage()
    const h = Math.min(step, canvas.height - pages[i])
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = h
    slice.getContext('2d')?.drawImage(canvas, 0, pages[i], canvas.width, h, 0, 0, canvas.width, h)
    pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, HEADER_PT, pdfW, h * scale)
    header()
    footer(i)
  }

  const filename = `AuditX-Report-${(scan.product_name?.trim() ? displayProductName(scan.product_name) : 'scan').replace(/[^a-zA-Z0-9_-]+/g, '_')}-${lang.toUpperCase()}.pdf`
  pdf.save(filename)
  return filename
}

/* ------------------------------------------------------------------ */
/* MISA-style inspection report (new pipeline doc)                     */
/* ------------------------------------------------------------------ */

const statusColor: Record<InspectionDoc['status'], { text: string; bg: string; label: string }> = {
  compliant: { text: GREEN, bg: GREEN_BG, label: 'Compliant' },
  needs_review: { text: AMBER, bg: AMBER_BG, label: 'Needs review' },
  violation: { text: RED, bg: RED_BG, label: 'Violation' },
  critical: { text: RED, bg: RED_BG, label: 'Critical' },
}

const findingColor = (s: Finding['status']) =>
  s === 'compliant' ? { text: GREEN, bg: GREEN_BG } : s === 'na' ? { text: SLATE, bg: SLATE_BG } : s === 'needs_review' ? { text: AMBER, bg: AMBER_BG } : { text: RED, bg: RED_BG }

const DETAIL_ROWS: Array<[string, string]> = [
  ['commodity_name', 'Product name'],
  ['brand', 'Brand'],
  ['manufacturer', 'Manufacturer / packer / importer'],
  ['net_quantity', 'Net quantity'],
  ['mrp', 'MRP'],
  ['batch_no', 'Batch / lot number'],
  ['mfg_date', 'Manufacturing date'],
  ['expiry_date', 'Expiry / best-before'],
  ['ingredients_text', 'Ingredients'],
  ['allergen_info', 'Allergen information'],
  ['required_declarations', 'Required declarations'],
  ['warnings', 'Warnings'],
  ['certification_details', 'Certification / standards'],
  ['country_of_origin', 'Country of origin'],
  ['storage_conditions', 'Storage conditions'],
  ['customer_care_details', 'Customer care'],
  ['contact_info', 'Contact'],
  ['imported_manufacturer_detail', 'Importer detail'],
]

function buildMisaReportHtml(d: InspectionDoc, generatedAt: string): string {
  const card = (title: string, body: string) => `
    <div style="margin-top:18px">
      <div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:${SILVER};font-weight:600">${esc(title)}</div>
      <div style="font-size:11px;color:${BODY};margin-top:6px;line-height:1.6">${body}</div>
    </div>`

  const details = DETAIL_ROWS.map(([key, label]) => ({ key: key as keyof InspectionDoc['ocr_fields'], label, value: d.ocr_fields?.[key] ?? '' })).filter((r) => r.value)
  const fieldsHtml =
    details.length === 0
      ? `<div style="margin-top:18px;font-size:11px;color:${SILVER}">No label fields could be read confidently.</div>`
      : details
          .map((r) => {
            const conf = d.field_confidence?.[r.key] || 'low'
            const col = conf === 'high' ? GREEN : conf === 'medium' ? AMBER : SILVER
            const ev = d.field_evidence?.[r.key]
            return `
          <div style="padding:9px 0;border-bottom:1px solid ${HAIRLINE};display:flex;justify-content:space-between;gap:12px">
            <div style="flex:1">
              <div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;color:${SILVER};font-weight:600">${esc(r.label)}</div>
              <div style="font-size:12px;color:${CHARCOAL};font-weight:600;margin-top:3px">${esc(r.value)}</div>
              ${ev?.text && ev.text !== r.value ? `<div style="font-size:9px;color:${SILVER};margin-top:2px">source: photo ${ev.image} — ${esc(ev.text)}</div>` : ''}
            </div>
            <div style="align-self:center;font-size:9px;color:${col};font-weight:700;text-transform:capitalize">${esc(conf)}</div>
          </div>`
          })
          .join('')

  const findingsHtml =
    (d.compliance_findings ?? [])
      .map((f) => {
        const c = findingColor(f.status)
        return `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid ${HAIRLINE}">
          <div style="flex:1;font-size:11px;color:${BODY}">
            <strong style="color:${CHARCOAL}">${esc(f.label)}</strong>
            ${f.detected_value ? `<div style="font-size:10px;color:${SLATE};margin-top:2px">${esc(f.detected_value)}</div>` : ''}
            ${f.explanation && f.explanation !== f.detected_value ? `<div style="font-size:10px;color:${SLATE};margin-top:2px">${esc(f.explanation)}</div>` : ''}
          </div>
          <span style="align-self:center;padding:3px 8px;border-radius:999px;font-size:9px;font-weight:700;color:${c.text};background:${c.bg};text-transform:capitalize">${esc(f.status === 'critical_failed' ? 'critical' : f.status)}</span>
        </div>`
      })
      .join('')

  const changesHtml = (d.changes ?? [])
    .map(
      (c) => `
      <div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid ${HAIRLINE};font-size:11px">
        <strong style="color:${CHARCOAL};min-width:140px">${esc(c.label)}</strong>
        <span style="color:${SLATE}">${esc(c.previous || '—')}</span>
        <span style="color:${SILVER}">→</span>
        <span style="color:${BODY}">${esc(c.current || 'removed')}</span>
      </div>`,
    )
    .join('')

  const conflictsHtml = (d.conflicts ?? [])
    .map(
      (c) =>
        `<div style="padding:8px 0;border-bottom:1px solid ${HAIRLINE};font-size:11px;color:${BODY}"><strong style="color:${CHARCOAL}">${esc(c.label)}:</strong> ${c.values.map((v) => `photo ${v.image}: ${esc(v.value)}`).join('  ·  ')}</div>`,
    )
    .join('')

  const attentionHtml = (d.compliance_findings ?? [])
    .filter((f) => f.status !== 'compliant' && f.status !== 'na')
    .map(
      (f) =>
        `<div style="padding:7px 0;font-size:11px;color:${BODY}"><strong style="color:${CHARCOAL}">${esc(f.label)}:</strong> ${esc(f.explanation || f.status)}${f.hint ? `<span style="display:block;font-size:10px;color:${SILVER}">Hint: ${esc(f.hint)}</span>` : ''}</div>`,
    )
    .join('')

  const pageBreak = (title: string) => `
    <div style="page-break-before:always;margin-top:24px;padding-top:14px;border-top:2px solid ${BLUE}">
      <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${BLUE};font-weight:800">${esc(title)}</div>
    </div>`

  const score = d.compliance_score ?? d.overall_score ?? 0
  const st = statusColor[d.status]
  const bps = (d.briefing?.key_points ?? [])
    .map((k) => `<li style="margin:5px 0">${esc(k)}</li>`)
    .join('')
  const recs = (d.briefing?.recommendations ?? []).map((r) => `<li style="margin:5px 0">${esc(r)}</li>`).join('')
  const photos = (d.photo_paths ?? [])
    .map(() => `<span style="display:inline-block;font-size:9px;color:${SLATE};margin-right:10px">Photo</span>`)
    .join('')

  return `
  <div style="font-family:${FONT};background:${IVORY};color:${BODY};padding:6px 40px 40px">
    <!-- Cover -->
    <div style="background:${NAVY};border-radius:14px;color:#fff;padding:28px 26px;position:relative;overflow:hidden">
      <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#93A7C7;font-weight:700">Legal Metrology · Label Inspection Report</div>
      <div style="font-size:20px;font-weight:800;margin-top:12px;line-height:1.25">${esc(d.product_name || 'Product label inspection')}</div>
      <div style="font-size:11px;color:#C6D3EA;margin-top:8px">
        ${esc(formatDateTime(d.analyzed_at ?? d.created_at))} · engine ${esc(d.ocr_provider || 'unknown')} · ${esc(d.ocr_language || 'en')}
      </div>
      <div style="display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:8px 14px;border-radius:999px;background:${st.bg};color:${st.text};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px">
        ${esc(st.label)}
      </div>
      <div style="position:absolute;right:26px;top:26px;text-align:center;background:rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px">
        <div style="font-size:26px;font-weight:800;color:${st.bg === RED_BG ? '#F5A3A3' : '#fff'}">${esc(score)}</div>
        <div style="font-size:9px;letter-spacing:1px;color:#93A7C7">/ 100</div>
      </div>
    </div>

    <div style="margin-top:18px;background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:20px 22px">
      <div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:${SILVER};font-weight:600">Summary</div>
      <div style="font-size:11.5px;color:${BODY};margin-top:8px;line-height:1.7">${esc(d.summary || 'The report is ready.')}</div>
      ${attentionHtml ? card('Attention needed', attentionHtml) : ''}
      ${d.briefing ? card('Assistant briefing', bps ? `<ul style="margin:0;padding-left:16px">${bps}</ul>` : `<div>${esc(d.briefing.summary || d.summary || '')}</div>`) : ''}
      ${d.briefing?.recommendations?.length ? card('Recommendations', `<ul style="margin:0;padding-left:16px">${recs}</ul>`) : ''}
    </div>

    ${pageBreak('Product information')}
    <div style="background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:14px 22px">
      ${fieldsHtml || '<div style="font-size:11px;color:Silver">No fields extracted.</div>'}
    </div>

    ${pageBreak('Compliance breakdown')}
    <div style="background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:14px 22px">
      ${findingsHtml || '<div style="font-size:11px;color:Silver">No checks recorded.</div>'}
    </div>

    ${pageBreak('Change detection')}
    <div style="background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:14px 22px">
      <div style="font-size:11px;color:${BODY}">
        ${d.match_confidence ? `Matched the previous scan (${esc(d.match_confidence.replace('_', ' '))}).` : 'No previous scan of this product found — this is the baseline reading.'}
        ${d.changes_verified ? ` Review was marked as verified by the inspector.` : ''}
      </div>
      ${changesHtml ? `<div style="margin-top:8px">${changesHtml}</div>` : '<div style="margin-top:8px;font-size:11px;color:Sliver">No label declarations changed.</div>'}
    </div>

    ${(d.conflicts ?? []).length ? pageBreak('Conflicting readings') + `<div style="background:${AMBER_BG};border:1px solid #EAD9B8;border-radius:12px;padding:14px 22px">${conflictsHtml}</div>` : ''}

    ${pageBreak('Evidence')}
    <div style="background:${CARD};border:1px solid ${BORDER};border-radius:12px;padding:14px 22px">
      <div style="font-size:11px;color:${SILVER}">${(d.photo_paths ?? []).length ? `Original photos used for this inspection (${(d.photo_paths ?? []).length}). ${photos}` : 'No photos recorded.'}</div>
      ${d.ocr_text ? `<div style="margin-top:10px;font-size:9px;font-weight:700;letter-spacing:1px;color:${SILVER}">RAW OCR TEXT</div><pre style="white-space:pre-wrap;font-size:10px;font-family:'Noto Sans Mono',monospace;color:${BODY};background:${SLATE_BG};border-radius:8px;padding:12px;margin:6px 0 0">${esc(d.ocr_text)}</pre>` : ''}
    </div>

    <div style="margin-top:22px;padding-top:14px;border-top:1px solid ${BORDER};font-size:9px;color:${SILVER};line-height:1.6">
      Generated by AuditX · ${esc(formatDateTime(generatedAt))} · Report for scan ${esc(String(d.id).slice(0, 8))}<br/>
      This report is derived from text visible in the photographs and is not a legal certification.
      ${d.briefing?.assistant_status === 'demo' ? ' The OCR provider ran in demo mode: values echo the details typed at capture time.' : ''}
    </div>
  </div>`
}

export async function downloadInspectionReport(d: InspectionDoc, lang = 'en'): Promise<string> {
  void lang
  const generatedAt = new Date().toISOString()
  const html = buildMisaReportHtml(d, generatedAt)

  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.style.position = 'fixed'
  el.style.left = '-10000px'
  el.style.top = '0'
  el.style.zIndex = '-1'
  el.style.width = '794px'
  el.style.background = IVORY
  el.innerHTML = html
  document.body.appendChild(el)

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()

  const canvas = await html2canvas(el, { scale: 2, backgroundColor: IVORY, logging: false, windowWidth: el.offsetWidth })
  el.remove()

  const scale = pdfW / canvas.width
  const step = Math.floor((pdfH - HEADER_PT - FOOTER_PT) / scale)
  const pages: number[] = []
  let offset = 0
  while (offset < canvas.height) {
    pages.push(offset)
    offset += step
  }

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage()
    const h = Math.min(step, canvas.height - pages[i])
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = h
    slice.getContext('2d')?.drawImage(canvas, 0, pages[i], canvas.width, h, 0, 0, canvas.width, h)
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pdfW, h * scale)
  }

  const name = (d.product_name?.trim() ? displayProductName(d.product_name) : 'scan').replace(/[^a-zA-Z0-9_-]+/g, '_')
  const filename = `AuditX-Inspection-${name}.pdf`
  pdf.save(filename)
  return filename
}