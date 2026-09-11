import { useEffect, useState } from 'react'
import { Package, Plus, Pencil, Trash2, Search, Loader2 } from 'lucide-react'
import AnalyticsCard from '../dashboard/AnalyticsCard'
import Button from '../ui/Button'
import Input from '../ui/Input'
import ConfirmDialog from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { listProducts } from '../../lib/db'
import { upsertProduct, deleteProduct } from '../../lib/services'
import type { ProductRow } from '../../lib/types2'
import { timeAgo } from '../../utils/format'

const EMPTY: ProductRow = {
  id: '', barcode: '', name: '', brand: '', manufacturer: '', category: 'Food',
  net_quantity: '', mrp: '', consumer_care: '', country_of_origin: '', best_before_label: '',
  created_at: '', updated_at: '',
}

export default function ProductDatabasePage() {
  const { toast } = useToast()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [form, setForm] = useState<ProductRow>(EMPTY)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)

  async function reload(q?: string, p?: number) {
    setLoading(true)
    try {
      const res = await listProducts({ page: p ?? page, pageSize: 20, query: q ?? search })
      setProducts(res.data)
      setCount(res.count)
    } catch (e) {
      toast('error', 'Load failed', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
    void reload(v, 1)
  }

  const openNew = () => { setForm(EMPTY); setFormOpen(true) }
  const openEdit = (p: ProductRow) => { setForm(p); setFormOpen(true) }

  const handleSave = async () => {
    if (!form.barcode.trim() || !form.name.trim()) {
      toast('error', 'Validation', 'Barcode and name are required.')
      return
    }
    setSaving(true)
    try {
      await upsertProduct({
        barcode: form.barcode,
        name: form.name,
        brand: form.brand,
        manufacturer: form.manufacturer,
        category: form.category,
        net_quantity: form.net_quantity,
        mrp: form.mrp,
        consumer_care: form.consumer_care,
        country_of_origin: form.country_of_origin,
        best_before_label: form.best_before_label,
      })
      toast('success', 'Saved', form.id ? 'Product updated.' : 'Product created.')
      setFormOpen(false)
      await reload()
    } catch (e) {
      toast('error', 'Save failed', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteProduct(deleteTarget.id)
      toast('success', 'Deleted', 'Product removed.')
      setDeleteTarget(null)
      await reload()
    } catch (e) {
      toast('error', 'Delete failed', (e as Error).message)
    }
  }

  const totalPages = Math.max(1, Math.ceil(count / 20))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, barcode, manufacturer..."
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={openNew}>Add Product</Button>
      </div>

      <AnalyticsCard title="Product Database" subtitle={`${count} products registered`}>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-500" /></div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Package className="h-12 w-12 text-slate-300 dark:text-slate-600" />
            <p className="mt-4 text-sm font-medium text-slate-500">No products yet</p>
            <p className="mt-1 text-xs text-slate-400">Add products by barcode to build the database.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Barcode</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Name</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Manufacturer</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Category</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">MRP</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Updated</th>
                    <th className="px-3 py-2 font-semibold text-slate-600 dark:text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{p.barcode}</td>
                      <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{p.name}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{p.manufacturer || '—'}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{p.category}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{p.mrp || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{timeAgo(p.updated_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => setDeleteTarget(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => { setPage(page - 1); void reload(search, page - 1) }}>Previous</Button>
                <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => { setPage(page + 1); void reload(search, page + 1) }}>Next</Button>
              </div>
            )}
          </>
        )}
      </AnalyticsCard>

      {/* Create/Edit form dialog */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setFormOpen(false)}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-slate-100">{form.id ? 'Edit Product' : 'Add Product'}</h2>
            <div className="space-y-3">
              <Input label="Barcode *" name="barcode" placeholder="8901234567890" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} disabled={!!form.id} />
              <Input label="Product Name *" name="name" placeholder="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="Brand" name="brand" placeholder="Brand name" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              <Input label="Manufacturer" name="manufacturer" placeholder="Manufacturer name" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                  {['Food', 'Cosmetic', 'Household', 'Electronics', 'Stationery', 'Other'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <Input label="Net Quantity" name="net_quantity" placeholder="500 g" value={form.net_quantity} onChange={(e) => setForm({ ...form, net_quantity: e.target.value })} />
              <Input label="MRP" name="mrp" placeholder="₹ 120.00" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
              <Input label="Consumer Care" name="consumer_care" placeholder="Phone / Email / Address" value={form.consumer_care} onChange={(e) => setForm({ ...form, consumer_care: e.target.value })} />
              <Input label="Country of Origin" name="country_of_origin" placeholder="India" value={form.country_of_origin} onChange={(e) => setForm({ ...form, country_of_origin: e.target.value })} />
              <Input label="Best Before / Expiry" name="best_before_label" placeholder="12 months from mfg" value={form.best_before_label} onChange={(e) => setForm({ ...form, best_before_label: e.target.value })} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button loading={saving} onClick={() => void handleSave()}>Save</Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete product" message={`Remove "${deleteTarget?.name}" from the database?`} confirmLabel="Delete" onConfirm={() => void handleDelete()} />
    </div>
  )
}
