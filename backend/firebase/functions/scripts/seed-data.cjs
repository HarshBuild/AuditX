/**
 * seed-data.cjs — populate Firestore with realistic demo data for the
 * MetroCheck admin panel.  Makes every tab show live data immediately
 * without requiring any real scans.
 *
 * Run from backend/firebase/functions:
 *   node scripts/seed-data.cjs
 *
 * Idempotent: skips a collection if it already has >0 docs.
 */
const { readFileSync } = require('node:fs')
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createHash } = require('node:crypto')

const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  'C:\\Users\\Dell\\AppData\\Local\\Temp\\opencode\\scanner-56fcf-firebase-adminsdk.json'

let credential
try {
  credential = cert(JSON.parse(readFileSync(KEY, 'utf8')))
} catch {
  console.error(`[FAIL] Could not read service-account file:\n  ${KEY}`)
  process.exit(1)
}
initializeApp({ credential })

const db = getFirestore()
const ADMIN_UID = 'HjoVQQXg7vO5vIBI8uEQlYkOOkA3' // superadmin@metrocheck.in
const ADMIN_NAME = 'MetroCheck Super Admin'

function daysAgo(n) {
  return new Date(Date.now() - n * 86400_000).toISOString()
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/* ------------------------------------------------------------------ */
/* Compliance Rules (10-point LM Rules 2011)                           */
/* ------------------------------------------------------------------ */
const RULES = [
  { key: 'RULE5',  title: 'Standard package sizes (Second Schedule)', category: 'Packaging', severity: 'medium' },
  { key: 'RULE6',  title: 'Mandatory declarations on pre-packed commodities', category: 'Declarations', severity: 'high' },
  { key: 'RULE9',  title: 'Manner & legibility of declarations', category: 'Display', severity: 'medium' },
  { key: 'RULE10', title: 'Manufacturer / packer / importer name and address', category: 'Identity', severity: 'high' },
  { key: 'RULE11', title: 'Requisites of quantity declaration', category: 'Quantity', severity: 'medium' },
  { key: 'RULE12', title: 'Manner of declaring quantity', category: 'Quantity', severity: 'medium' },
  { key: 'RULE6a', title: 'MRP / retail sale price declaration', category: 'Price', severity: 'high' },
  { key: 'RULE6b', title: 'Net quantity in weight / volume / number', category: 'Quantity', severity: 'high' },
  { key: 'RULE6c', title: 'Date of manufacture / best-before / use-by', category: 'Dates', severity: 'high' },
  { key: 'RULE6d', title: 'Consumer care details (helpline / email / address)', category: 'Consumer Care', severity: 'medium' },
]

/* ------------------------------------------------------------------ */
/* Products (real Indian packaged commodities)                         */
/* ------------------------------------------------------------------ */
const PRODUCTS = [
  { barcode: '8901058003002', name: 'Maggi 2-Minute Masala Noodles', brand: 'Maggi', mfr: 'Nestlé India Ltd', category: 'Food', net_quantity: '70 g', mrp: '₹14.00', country: 'India' },
  { barcode: '8901262000907', name: 'Amul Butter', brand: 'Amul', mfr: 'Gujarat Cooperative Milk Marketing Federation', category: 'Food', net_quantity: '500 g', mrp: '₹270.00', country: 'India' },
  { barcode: '8901719101003', name: 'Parle-G Gluco Biscuits', brand: 'Parle', mfr: 'Parle Products Pvt. Ltd', category: 'Food', net_quantity: '120 g', mrp: '₹10.00', country: 'India' },
  { barcode: '8901119101203', name: 'Tata Salt Iodised', brand: 'Tata', mfr: 'Tata Chemicals Ltd', category: 'Food', net_quantity: '1 kg', mrp: '₹28.00', country: 'India' },
  { barcode: '8901030145015', name: 'Cadbury Bournvita', brand: 'Cadbury', mfr: 'Mondelez India Foods Pvt Ltd', category: 'Food', net_quantity: '500 g', mrp: '₹324.00', country: 'India' },
  { barcode: '8901491301508', name: 'Haldiram\'s Aloo Bhujia', brand: 'Haldiram\'s', mfr: 'Haldiram Snacks Pvt Ltd', category: 'Food', net_quantity: '200 g', mrp: '₹60.00', country: 'India' },
  { barcode: '8901208101019', name: 'Dabur Honey', brand: 'Dabur', mfr: 'Dabur India Ltd', category: 'Food', net_quantity: '500 g', mrp: '₹175.00', country: 'India' },
  { barcode: '8901315101100', name: 'Colgate MaxFresh Toothpaste', brand: 'Colgate', mfr: 'Colgate-Palmolive India Ltd', category: 'Cosmetic', net_quantity: '150 g', mrp: '₹135.00', country: 'India' },
  { barcode: '8901063001206', name: 'Britannia Good Day Cashew Cookies', brand: 'Britannia', mfr: 'Britannia Industries Ltd', category: 'Food', net_quantity: '250 g', mrp: '₹50.00', country: 'India' },
  { barcode: '8901126101108', name: 'Surf Excel Quick Wash', brand: 'Surf Excel', mfr: 'Hindustan Unilever Ltd', category: 'Household', net_quantity: '500 g', mrp: '₹92.00', country: 'India' },
]

/* ------------------------------------------------------------------ */
/* Scan templates (spread across last 14 days)                         */
/* ------------------------------------------------------------------ */
const SCAN_TEMPLATES = [
  { product: 'Maggi 2-Minute Masala Noodles', brand: 'Maggi', mfr: 'Nestlé India Ltd', cat: 'Food', barcode: '8901058003002', score: 88, verdict: 'COMPLIANT', status: 'analyzed', img: true, loc: 'Ahmedabad Central Mall', lat: 23.0225, lng: 72.5714, lang: 'en' },
  { product: 'Amul Butter', brand: 'Amul', mfr: 'Gujarat Cooperative Milk Marketing Federation', cat: 'Food', barcode: '8901262000907', score: 42, verdict: 'NON_COMPLIANT', status: 'flagged', img: true, loc: 'Surat City Market', lat: 21.1702, lng: 72.8311, lang: 'en' },
  { product: 'Parle-G Gluco Biscuits', brand: 'Parle', mfr: 'Parle Products Pvt. Ltd', cat: 'Food', barcode: '8901719101003', score: 95, verdict: 'COMPLIANT', status: 'analyzed', img: true, loc: 'Vadodara Retail Hub', lat: 22.3072, lng: 73.1812, lang: 'en' },
  { product: 'Tata Salt Iodised', brand: 'Tata', mfr: 'Tata Chemicals Ltd', cat: 'Food', barcode: '8901119101203', score: 68, verdict: 'PARTIALLY_COMPLIANT', status: 'manual_review', img: false, loc: 'Rajkot Supermarket', lat: 22.3039, lng: 70.8022, lang: 'en' },
  { product: 'Cadbury Bournvita', brand: 'Cadbury', mfr: 'Mondelez India Foods Pvt Ltd', cat: 'Food', barcode: '8901030145015', score: 35, verdict: 'NON_COMPLIANT', status: 'flagged', img: true, loc: 'Gandhinagar Sector 7', lat: 23.2156, lng: 72.6369, lang: 'en' },
  { product: 'Haldiram\'s Aloo Bhujia', brand: 'Haldiram\'s', mfr: 'Haldiram Snacks Pvt Ltd', cat: 'Food', barcode: '8901491301508', score: 76, verdict: 'PARTIALLY_COMPLIANT', status: 'analyzed', img: true, loc: 'Jamnagar Main Road', lat: 22.4707, lng: 70.0662, lang: 'en' },
  { product: 'Dabur Honey', brand: 'Dabur', mfr: 'Dabur India Ltd', cat: 'Food', barcode: '8901208101019', score: 91, verdict: 'COMPLIANT', status: 'resolved', img: true, loc: 'Bharuch Highway Store', lat: 21.6948, lng: 72.9801, lang: 'en' },
  { product: 'Colgate MaxFresh Toothpaste', brand: 'Colgate', mfr: 'Colgate-Palmolive India Ltd', cat: 'Cosmetic', barcode: '8901315101100', score: 52, verdict: 'PARTIALLY_COMPLIANT', status: 'pending_review', img: true, loc: 'Anand Station Road', lat: 22.5646, lng: 72.9522, lang: 'en' },
  { product: 'Britannia Good Day Cashew Cookies', brand: 'Britannia', mfr: 'Britannia Industries Ltd', cat: 'Food', barcode: '8901063001206', score: 84, verdict: 'COMPLIANT', status: 'analyzed', img: false, loc: 'Nadiad Civil Hospital Area', lat: 22.6916, lng: 72.8566, lang: 'en' },
  { product: 'Surf Excel Quick Wash', brand: 'Surf Excel', mfr: 'Hindustan Unilever Ltd', cat: 'Household', barcode: '8901126101108', score: 28, verdict: 'NON_COMPLIANT', status: 'flagged', img: true, loc: 'Mehsana Bus Stand Market', lat: 23.5882, lng: 72.3694, lang: 'en' },
  { product: 'Maggi 2-Minute Masala Noodles', brand: 'Maggi', mfr: 'Nestlé India Ltd', cat: 'Food', barcode: '8901058003002', score: 79, verdict: 'PARTIALLY_COMPLIANT', status: 'analyzed', img: true, loc: 'Porbandar Fish Market', lat: 21.6424, lng: 69.6095, lang: 'en' },
  { product: 'Amul Butter', brand: 'Amul', mfr: 'Gujarat Cooperative Milk Marketing Federation', cat: 'Food', barcode: '8901262000907', score: 93, verdict: 'COMPLIANT', status: 'resolved', img: true, loc: 'Junagadh Gir Road Shop', lat: 21.5222, lng: 70.4756, lang: 'en' },
]

function makeScanRules(product, score) {
  const fields = ['mrp', 'net_quantity', 'manufacturer', 'commodity_name', 'best_before', 'country_of_origin', 'consumer_care', 'lot_no', 'packer', 'importer']
  return fields.map((f, i) => {
    const statuses = ['PASS', 'PASS', 'PASS', 'FAIL', 'WARNING', 'NOT_DETECTED', 'NOT_VERIFIABLE']
    const s = score > 80 ? 'PASS' : score > 50 ? (i % 3 === 0 ? 'WARNING' : 'PASS') : (i % 3 === 0 ? 'FAIL' : i % 5 === 0 ? 'WARNING' : 'PASS')
    return { rule_id: `rule${i + 6}`, field: f, status: s, extracted_text: '', weight: 1 }
  })
}

/* ------------------------------------------------------------------ */
/* Main seed                                                           */
/* ------------------------------------------------------------------ */
async function seedCollection(name, docs) {
  const col = db.collection(name)
  const existing = await col.limit(1).get()
  if (!existing.empty) {
    console.log(`  [SKIP] ${name} already has data`)
    return 0
  }
  const batch = db.batch()
  let count = 0
  for (const [id, data] of docs) {
    const ref = id ? col.doc(id) : col.doc()
    batch.set(ref, data)
    count++
  }
  await batch.commit()
  console.log(`  [OK] ${name}: ${count} documents written`)
  return count
}

async function main() {
  console.log('=== Seed compliance rules ===')
  await seedCollection('complianceRules', RULES.map((r) => [
    r.key.toLowerCase(),
    {
      rule_key: r.key,
      title: r.title,
      description: `Legal Metrology (Packaged Commodities) Rules 2011 — ${r.title}.`,
      category: r.category,
      severity: r.severity,
      required: true,
      status: 'active',
      is_active: true,
      created_by: ADMIN_UID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]))

  console.log('=== Seed products ===')
  await seedCollection('products', PRODUCTS.map((p) => [
    p.barcode,
    {
      barcode: p.barcode,
      name: p.name,
      brand: p.brand,
      manufacturer: p.mfr,
      category: p.category,
      net_quantity: p.net_quantity,
      mrp: p.mrp,
      consumer_care: `customer.care@${p.brand.toLowerCase().replace(/[' ]/g, '')}.in`,
      country_of_origin: p.country,
      best_before_label: '12 months from date of manufacture',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]))

  console.log('=== Seed scans ===')
  const scanDocs = []
  for (let i = 0; i < SCAN_TEMPLATES.length; i++) {
    const t = SCAN_TEMPLATES[i]
    const created = daysAgo(i < 4 ? i : i < 8 ? i + 2 : i + 4)
    const scanId = `seed-scan-${String(i + 1).padStart(3, '0')}`
    const imgUrls = t.img
      ? [`https://picsum.photos/seed/scan${i + 1}/600/600`, `https://picsum.photos/seed/scan${i + 1}b/600/600`]
      : []
    scanDocs.push([
      scanId,
      {
        user_id: ADMIN_UID,
        user_name: ADMIN_NAME,
        product_name: t.product,
        brand: t.brand,
        manufacturer: t.mfr,
        category: t.cat,
        barcode: t.barcode,
        overall_score: t.score,
        verdict: t.verdict,
        summary: `${t.product} scored ${t.score}/100 — ${t.verdict.replace('_', ' ').toLowerCase()}.`,
        image_url: imgUrls[0] ?? '',
        image_urls: imgUrls,
        rules: makeScanRules(t.product, t.score),
        risk_score: Math.max(0, Math.min(100, 100 - t.score)),
        status: t.status,
        ocr_text: `Product: ${t.product}\nBrand: ${t.brand}\nMRP: ₹${Math.round(Math.random() * 300 + 10)}.00\nNet Qty: ${Math.round(Math.random() * 900 + 100)} g\nMfg: ${t.mfr}`,
        ai_insights: [],
        manual_result: null,
        notes: '',
        latitude: t.lat,
        longitude: t.lng,
        location_name: t.loc,
        language: t.lang,
        created_at: created,
        updated_at: created,
      },
    ])
  }
  await seedCollection('scans', scanDocs)

  console.log('=== Seed violations ===')
  const violations = [
    { scan: 'seed-scan-002', prod: 'Amul Butter', mfr: 'Gujarat Cooperative Milk Marketing Federation', cat: 'Food', type: 'Missing MRP', severity: 'high', status: 'Detected', desc: 'MRP declaration not found on primary display panel.' },
    { scan: 'seed-scan-005', prod: 'Cadbury Bournvita', mfr: 'Mondelez India Foods Pvt Ltd', cat: 'Food', type: 'Net quantity discrepancy', severity: 'critical', status: 'Reviewing', desc: 'Declared net quantity does not match measured weight on label.' },
    { scan: 'seed-scan-008', prod: 'Colgate MaxFresh Toothpaste', mfr: 'Colgate-Palmolive India Ltd', cat: 'Cosmetic', type: 'Missing best-before', severity: 'medium', status: 'Detected', desc: 'Best-before / use-by date not legible on packaging.' },
    { scan: 'seed-scan-010', prod: 'Surf Excel Quick Wash', mfr: 'Hindustan Unilever Ltd', cat: 'Household', type: 'Manufacturer address illegible', severity: 'high', status: 'Escalated', desc: 'Manufacturer name and address printed in font below minimum legibility.' },
    { scan: 'seed-scan-004', prod: 'Tata Salt Iodised', mfr: 'Tata Chemicals Ltd', cat: 'Food', type: 'Date declaration missing', severity: 'medium', status: 'Detected', desc: 'Manufacturing date not visible on the label.' },
    { scan: 'seed-scan-011', prod: 'Maggi 2-Minute Masala Noodles', mfr: 'Nestlé India Ltd', cat: 'Food', type: 'MRP format non-compliant', severity: 'low', status: 'Resolved', desc: 'MRP printed without "₹" symbol prefix as required.' },
  ]
  await seedCollection('violations', violations.map((v, i) => [
    `seed-viol-${String(i + 1).padStart(3, '0')}`,
    {
      scan_id: v.scan,
      product_name: v.prod,
      manufacturer: v.mfr,
      category: v.cat,
      type: v.type,
      severity: v.severity,
      status: v.status,
      description: v.desc,
      created_by: ADMIN_UID,
      resolved_by: v.status === 'Resolved' ? ADMIN_UID : null,
      resolved_at: v.status === 'Resolved' ? new Date().toISOString() : null,
      created_at: daysAgo(i < 3 ? i + 1 : i + 5),
      updated_at: new Date().toISOString(),
    },
  ]))

  console.log('=== Seed reports ===')
  const reports = [
    { title: 'Maggi noodles — non-standard pack size', prod: 'Maggi 2-Minute Masala Noodles', mfr: 'Nestlé India Ltd', cat: 'Food', severity: 'high', priority: 'High', status: 'Pending', desc: 'Pack size 70g not listed in Second Schedule standard sizes.' },
    { title: 'Bournvita label missing address', prod: 'Cadbury Bournvita', mfr: 'Mondelez India Foods Pvt Ltd', cat: 'Food', severity: 'critical', priority: 'Critical', status: 'Reviewing', desc: 'Manufacturer address completely absent from packaging.' },
    { title: 'Surf Excel font size below minimum', prod: 'Surf Excel Quick Wash', mfr: 'Hindustan Unilever Ltd', cat: 'Household', severity: 'medium', priority: 'Medium', status: 'Resolved', desc: 'Regulatory minimum font size 1mm not met.' },
    { title: 'Amul Butter wholesale label inquiry', prod: 'Amul Butter', mfr: 'Gujarat Cooperative Milk Marketing Federation', cat: 'Food', severity: 'low', priority: 'Low', status: 'Rejected', desc: 'Wholesale packaging may be exempt — rejected for insufficient evidence.' },
  ]
  await seedCollection('reports', reports.map((r, i) => [
    `seed-report-${String(i + 1).padStart(3, '0')}`,
    {
      user_id: ADMIN_UID,
      scan_id: `seed-scan-${String(i + 1).padStart(3, '0')}`,
      title: r.title,
      description: r.desc,
      product_name: r.prod,
      manufacturer: r.mfr,
      category: r.cat,
      severity: r.severity,
      priority: r.priority,
      status: r.status,
      assigned_to: null,
      assigned_at: null,
      resolved_by: r.status === 'Resolved' || r.status === 'Rejected' ? ADMIN_UID : null,
      resolved_at: r.status === 'Resolved' || r.status === 'Rejected' ? new Date().toISOString() : null,
      created_at: daysAgo(i + 1),
      updated_at: new Date().toISOString(),
    },
  ]))

  console.log('=== Seed activity logs ===')
  const logs = [
    { action: 'auth.login', actor: 'MetroCheck Super Admin', target: 'user', tid: ADMIN_UID, det: { method: 'email' } },
    { action: 'scan.created', actor: 'Inspector Patel', target: 'scan', tid: 'seed-scan-001', det: { product: 'Maggi Noodles' } },
    { action: 'violation.detected', actor: 'System', target: 'violation', tid: 'seed-viol-001', det: { type: 'Missing MRP' } },
    { action: 'scan.status_changed', actor: ADMIN_NAME, target: 'scan', tid: 'seed-scan-005', det: { status: 'flagged' } },
    { action: 'report.created', actor: 'Inspector Desai', target: 'report', tid: 'seed-report-002', det: { title: 'Bournvita label missing address' } },
    { action: 'scan.manual_review', actor: ADMIN_NAME, target: 'scan', tid: 'seed-scan-007', det: { score: 91 } },
    { action: 'compliance_rule.enabled', actor: ADMIN_NAME, target: 'complianceRule', tid: 'rule6', det: {} },
    { action: 'user.status.active', actor: ADMIN_NAME, target: 'user', tid: 'BSexKwxT9xOPrbpevPsCFlrYnXy2', det: { status: 'active' } },
  ]
  await seedCollection('activityLogs', logs.map((l, i) => [
    `seed-log-${String(i + 1).padStart(3, '0')}`,
    {
      user_id: null,
      actor_id: ADMIN_UID,
      actor_name: l.actor,
      action: l.action,
      target_type: l.target,
      target_id: l.tid,
      details: l.det,
      created_at: daysAgo(i < 3 ? i : i + 2),
    },
  ]))

  console.log('\n=== Seed complete. All collections have live data. ===')
}

main().then(() => process.exit(0)).catch((e) => { console.error('[FAIL]', e.message); process.exit(1) })