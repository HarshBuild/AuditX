import { useState } from 'react'
import { Plus, Trash2, ClipboardCheck } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { useToast } from '../ui/Toast'
import { manualReview } from '../../lib/services'
import { severityValue } from '../../lib/ui'
import type { ScanRow, ViolationRow } from '../../lib/types2'

interface CorrectionRow {
  field: string
  value: string
}

interface ViolationAddRow {
  type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
}

export default function ManualReviewModal({
  open,
  scan,
  violations,
  onClose,
  onSaved,
}: {
  open: boolean
  scan: ScanRow
  violations: ViolationRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [score, setScore] = useState(scan.overall_score)
  const [notes, setNotes] = useState('')
  const [corrections, setCorrections] = useState<CorrectionRow[]>([])
  const [additions, setAdditions] = useState<ViolationAddRow[]>([])
  const [removals, setRemovals] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setScore(scan.overall_score)
    setNotes('')
    setCorrections([])
    setAdditions([])
    setRemovals([])
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      size="lg"
      title="Manual inspection"
      description={`Inspector review of "${scan.product_name}" — results are stored with the AI diff in the audit trail.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button
            icon={<ClipboardCheck className="h-4 w-4" />}
            loading={busy}
            onClick={() => {
              setBusy(true)
              void manualReview(scan.id, {
                score,
                corrections: Object.fromEntries(corrections.filter((c) => c.field && c.value).map((c) => [c.field, c.value])),
                violationsAdded: additions.filter((a) => a.type || a.description).map((a) => ({
                  type: a.type || 'rule_violation',
                  severity: a.severity,
                  description: a.description,
                })),
                violationsRemoved: removals,
                notes,
              })
                .then(() => {
                  toast('success', 'Review saved', 'Manual inspection result stored and owner notified.')
                  reset()
                  onSaved()
                })
                .catch((e: Error) => {
                  toast('error', 'Review failed', e.message)
                })
                .finally(() => setBusy(false))
            }}
          >
            Save review
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">AI score</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-700 dark:text-slate-300">{scan.overall_score}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Manual score (0–100)</p>
            <input
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-center text-lg font-extrabold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Corrections */}
        <section>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">OCR corrections (diff storage)</h4>
            <button
              onClick={() => setCorrections((c) => [...c, { field: '', value: '' }])}
              className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-500 dark:text-brand-400"
            >
              <Plus className="h-3.5 w-3.5" /> Add field
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {corrections.length === 0 && <p className="text-xs text-slate-400">Add corrected fields captured differently from the AI read (e.g. MRP, brand).</p>}
            {corrections.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={c.field}
                  onChange={(e) => setCorrections((arr) => arr.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
                  placeholder="Field"
                  className="w-2/5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
                />
                <input
                  value={c.value}
                  onChange={(e) => setCorrections((arr) => arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  placeholder="Corrected value"
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
                />
                <button onClick={() => setCorrections((arr) => arr.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-500" aria-label="Remove row">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Add violations */}
        <section>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add violations</h4>
            <button
              onClick={() => setAdditions((a) => [...a, { type: '', severity: 'medium', description: '' }])}
              className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-500 dark:text-brand-400"
            >
              <Plus className="h-3.5 w-3.5" /> Add violation
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {additions.length === 0 && <p className="text-xs text-slate-400">Flag non-compliances you found that the AI missed.</p>}
            {additions.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={a.type}
                  onChange={(e) => setAdditions((arr) => arr.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                  placeholder="Type (e.g. 6(1)(e))"
                  className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
                />
                <select
                  value={a.severity}
                  onChange={(e) => setAdditions((arr) => arr.map((x, j) => (j === i ? { ...x, severity: severityValue(e.target.value) } : x)))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs focus:outline-none dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <input
                  value={a.description}
                  onChange={(e) => setAdditions((arr) => arr.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  placeholder="Description"
                  className="min-w-40 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
                />
                <button onClick={() => setAdditions((arr) => arr.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-500" aria-label="Remove violation">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Remove existing */}
        {violations.length > 0 && (
          <section>
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Remove (reject) flagged violations</h4>
            <ul className="mt-2 space-y-1.5">
              {violations.map((v) => (
                <li key={v.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-navy-950/50">
                  <input
                    id={`rem-${v.id}`}
                    type="checkbox"
                    checked={removals.includes(v.id)}
                    onChange={(e) =>
                      setRemovals((r) => (e.target.checked ? [...r, v.id] : r.filter((x) => x !== v.id)))
                    }
                    className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor={`rem-${v.id}`} className="text-slate-600 dark:text-slate-300">
                    {v.type} — {v.description}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Inspector notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="What did you verify manually?"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/15 dark:bg-navy-950 dark:text-slate-100"
          />
        </section>
      </div>
    </Modal>
  )
}