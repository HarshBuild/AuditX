/*
 * AuditX — multi-language PDF report generator.
 * Renders the full inspection report as styled HTML (so Indic scripts render
 * correctly in the browser), rasterizes it with html2canvas and saves it as a
 * paginated A4 PDF via jsPDF.
 */

/* eslint-disable no-console */
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { translate } from '../i18n/report'
import { riskBand, riskTone } from './risk'
import { formatDateTime } from '../utils/format'
import type { ScanRow } from './types2'

const t = (lang: string, key: Parameters<typeof translate>[1]) => translate(lang, key)

function scoreColor(n: number): string {
  if (n >= 80) return '#059669'
  if (n >= 50) return '#d97706'
  return '#e11d48'
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

function buildReportHtml(scan: ScanRow, lang: string, generatedAt: string): string {
  const risk = scan.risk_score ?? 100 - scan.overall_score
  const band = riskBand(risk)
  const verdictMap: Record<string, string> = {
    COMPLIANT: t(lang, 'verdict_compliant'),
    PARTIALLY_COMPLIANT: t(lang, 'verdict_partial'),
    NON_COMPLIANT: t(lang, 'verdict_non_compliant'),
  }
  const label = `#${scan.id.slice(0, 8)}`
  const row = (k: string, v: string) =>
    `<tr><td style="width:38%;padding:6px 10px;border:1px solid #e2e8f0;font-size:9.5px;color:#475569;background:#f8fafc;font-weight:600;">${k}</td><td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:10px;color:#0f172a;">${v || t(lang, 'not_available')}</td></tr>`

  const rulesRows = (scan.rules ?? [])
    .slice(0, 80)
    .map(
      (r) => `<tr>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-family:monospace;color:#4338ca;white-space:nowrap;">${esc(r.rule_id)}</td>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9.5px;color:#0f172a;">${esc(r.field)}</td>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;text-align:center;color:${r.status === 'PASS' ? '#059669' : r.status === 'FAIL' ? '#e11d48' : r.status === 'WARNING' ? '#d97706' : '#64748b'};font-weight:700;">${esc(r.status)}</td>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;color:#475569;max-width:220px;">${esc(r.extracted_text)}</td>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;color:#b91c1c;max-width:220px;">${esc(r.issue)}</td>
      </tr>`,
    )
    .join('')

  const labelsRows = (scan.labels ?? [])
    .map(
      (lb) => `<tr>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9.5px;color:#0f172a;font-weight:600;">${esc(lb.label)}</td>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9.5px;color:${scoreColor(lb.score)};font-weight:700;">${esc(lb.verdict)}</td>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9.5px;text-align:center;color:#0f172a;font-weight:700;">${esc(lb.score)}/100</td>
      </tr>`,
    )
    .join('')

  const suggestions = (scan.assistant?.suggestions ?? [])
    .map((s) => `<li style="margin:4px 0;font-size:10px;color:#0f172a;">${esc(s)}</li>`)
    .join('')

  const declarationLabels: { key: keyof NonNullable<ScanRow['extractions']>; label: string }[] = [
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
  ]
  const declarationRows = (scan.extractions
    ? declarationLabels.filter((d) => scan.extractions![d.key])
      .map(
        (d) => `<tr>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9.5px;color:#475569;background:#f8fafc;font-weight:700;">${esc(d.label)}</td>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9.5px;color:#0f172a;">${esc(scan.extractions![d.key])}</td>
        <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:8.5px;color:#475569;text-align:center;">${scan.extractions![d.key] && String(scan.extractions![d.key]).length > 10 ? 'HIGH' : 'MED'}</td>
      </tr>`,
      )
      .join('')
    : '')

  return `
  <div style="font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans',Arial,sans-serif;width:780px;background:#ffffff;color:#0f172a;">
    <div style="background:linear-gradient(90deg,#1d4ed8,#6366f1);color:#fff;padding:20px 26px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;opacity:.85;">${esc(label)}</div>
        <div style="font-size:19px;font-weight:800;margin-top:3px;">${esc(t(lang, 'report_title'))}</div>
        <div style="font-size:10px;opacity:.9;margin-top:2px;">${esc(t(lang, 'report_subtitle'))}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:900;line-height:1;">Audit<span style="color:#c7d2fe">X</span></div>
        <div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;opacity:.8;">Legal Metrology Suite</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;padding:10px 26px;border-bottom:1px solid #e2e8f0;font-size:9px;color:#64748b;">
      <span>${esc(t(lang, 'report_generated'))}: ${esc(generatedAt)}</span>
      <span>Language: ${esc(lang.toUpperCase())} · AuditX</span>
    </div>

    <div style="padding:18px 26px;">
      <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px;">${esc(t(lang, 'compliance_details'))}</div>
      <table style="width:100%;border-collapse:collapse;">
        ${row(t(lang, 'product'), scan.product_name)}
        ${row(t(lang, 'brand'), scan.brand)}
        ${row(t(lang, 'manufacturer'), scan.manufacturer)}
        ${row(t(lang, 'category'), scan.category)}
        ${row(t(lang, 'barcode'), scan.barcode)}
        ${row(t(lang, 'scanned_on'), formatDateTime(scan.created_at))}
        ${row(t(lang, 'status'), String(scan.status ?? ''))}
      </table>

      <div style="display:flex;gap:12px;margin:16px 0;">
        <div style="flex:1;border:2px solid ${scoreColor(scan.overall_score)};border-radius:14px;padding:14px;text-align:center;">
          <div style="font-size:30px;font-weight:800;color:${scoreColor(scan.overall_score)};">${esc(scan.overall_score)}/100</div>
          <div style="font-size:9px;color:#64748b;margin-top:2px;">${esc(t(lang, 'overall_score'))}</div>
        </div>
        <div style="flex:1;border:1px solid #e2e8f0;border-radius:14px;padding:14px;text-align:center;">
          <div style="font-size:26px;font-weight:800;color:${verdictMap[scan.verdict] === t(lang, 'verdict_non_compliant') ? '#e11d48' : verdictMap[scan.verdict] === t(lang, 'verdict_partial') ? '#d97706' : '#059669'};">${esc(verdictMap[scan.verdict] ?? scan.verdict)}</div>
          <div style="font-size:9px;color:#64748b;margin-top:2px;">${esc(t(lang, 'verdict'))}</div>
        </div>
        <div style="flex:1;border:1px solid #e2e8f0;border-radius:14px;padding:14px;text-align:center;">
          <div style="font-size:26px;font-weight:800;color:${riskTone(band) === 'rose' ? '#e11d48' : riskTone(band) === 'amber' ? '#d97706' : '#059669'};">${esc(risk)} · ${esc(t(lang, riskKeyFor(band)))}</div>
          <div style="font-size:9px;color:#64748b;margin-top:2px;">${esc(t(lang, 'risk_score') + ' / ' + t(lang, 'risk_band'))}</div>
        </div>
      </div>

      ${declarationRows ? `
        <div style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 8px;">${esc('Extracted Declarations')}</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">Declaration</td><td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">Value</td><td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;text-align:center;">Confidence</td></tr>
          ${declarationRows}
        </table>` : ''}

      ${scan.labels && scan.labels.length > 0 ? `
        <div style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 8px;">${esc(t(lang, 'labels_detected'))}</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">Label</td><td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">Verdict</td><td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;text-align:center;">Score</td></tr>
          ${labelsRows}
        </table>` : ''}

      <div style="font-size:12px;font-weight:800;color:#0f172a;margin:14px 0 8px;">${esc(t(lang, 'rule_checks'))}</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">${esc(t(lang, 'rule'))}</td>
          <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">${esc(t(lang, 'mandatory_declaration'))}</td>
          <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">${esc(t(lang, 'status'))}</td>
          <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">${esc(t(lang, 'extracted'))}</td>
          <td style="padding:5px 8px;border:1px solid #e2e8f0;font-size:9px;font-weight:700;background:#f8fafc;color:#475569;">${esc(t(lang, 'issue'))}</td>
        </tr>
        ${rulesRows || `<tr><td colspan="5" style="padding:8px;border:1px solid #e2e8f0;font-size:9.5px;color:#64748b;">${esc(t(lang, 'no_rules'))}</td></tr>`}
      </table>

      ${scan.assistant?.summary || (scan.assistant?.suggestions ?? []).length > 0 ? `
      <div style="margin-top:16px;border:1px solid #c7d2fe;background:#eef2ff;border-radius:14px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:800;color:#4338ca;">${esc(t(lang, 'ai_assistant'))}</div>
        <div style="font-size:10px;margin-top:6px;color:#1e1b4b;">${esc(scan.assistant?.summary ?? '')}</div>
        ${(scan.assistant?.suggestions ?? []).length > 0 ? `<div style="font-size:9.5px;font-weight:700;color:#312e81;margin-top:8px;">${esc(t(lang, 'suggest_next'))}</div><ul style="margin:4px 0 0 16px;padding:0;">${suggestions}</ul>` : ''}
      </div>` : ''}

      <div style="margin-top:12px;border:1px solid #fde68a;background:#fffbeb;border-radius:14px;padding:12px 16px;">
        <div style="font-size:9.5px;font-weight:700;color:#b45309;">${esc(t(lang, 'language_note'))}</div>
        <div style="font-size:9.5px;color:#78350f;margin-top:3px;">${esc(scan.language_note || t(lang, 'not_available'))}</div>
      </div>

      <div style="margin-top:16px;font-size:8.5px;color:#94a3b8;line-height:1.5;">
        ${esc(t(lang, 'inspector_note'))}
      </div>
      <div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;display:flex;justify-content:space-between;font-size:8px;color:#94a3b8;">
        <span>AuditX v3.0 · Legal Metrology Inspection Suite</span>
        <span>${esc(label)}</span>
      </div>
    </div>
  </div>`
}

export async function downloadInspectionPdf(scan: ScanRow, lang: string): Promise<string> {
  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.style.background = '#ffffff'
  container.style.zIndex = '-1'
  container.innerHTML = buildReportHtml(scan, lang, formatDateTime(new Date().toISOString()))
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 820,
    })
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()
    const scale = pdfW / canvas.width
    const pageHeightPx = Math.floor(pdfH / scale)
    let offset = 0
    let firstPage = true
    while (offset < canvas.height) {
      if (!firstPage) pdf.addPage()
      const h = Math.min(pageHeightPx, canvas.height - offset)
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = h
      slice.getContext('2d')?.drawImage(canvas, 0, offset, canvas.width, h, 0, 0, canvas.width, h)
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pdfW, h * scale)
      offset += h
      firstPage = false
    }
    const filename = `AuditX-Report-${(scan.product_name || 'scan').replace(/[^a-zA-Z0-9_-]+/g, '_')}-${lang.toUpperCase()}.pdf`
    pdf.save(filename)
    return filename
  } finally {
    container.remove()
  }
}