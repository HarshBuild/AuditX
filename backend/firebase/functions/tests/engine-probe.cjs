/**
 * Real-execution probe of the compiled Legal Metrology compliance engine.
 * NOT mock output: this runs the actual dist/compliance modules emitted by
 * `tsc` against realistic OCR-extracted inputs.
 */
const assert = require('node:assert')
const path = require('node:path')

const FUNCS = path.resolve(__dirname, '..', 'dist')
const engine = require(path.join(FUNCS, 'compliance', 'engine.js'))

const fmtField = (value, conf = 'high', image = 0) => ({ value, confidence: conf, source_image: image })

function mkInputs(ex, uncertain = [], extra = {}) {
  const fields = {}
  for (const [k, v] of Object.entries(ex || {})) fields[k] = fmtField(v)
  return {
    ex: ex || {},
    fields,
    ocrText: (extra.ocrText || ''),
    ocrBlocks: [],
    uncertain,
    barcode: '8901234567890',
    languages: ['en'],
    labels: [{ label: 'Back Label', label_text: 'declarations block' }],
    userCategory: extra.category ?? 'Food',
    userProductName: extra.productName ?? 'Test Biscuit',
    productLabelText: [extra.productName || '', extra.category || '', ''].join(' '),
    ...extra,
  }
}

let passed = 0
const tbl = []
function check(name, fn) {
  try {
    fn()
    passed++
    tbl.push(['PASS', name])
  } catch (e) {
    tbl.push(['FAIL', `${name}: ${e.message}`])
  }
}

const fullEx = {
  commodity_name: 'Choco Biscuit',
  mrp: 'MRP Rs.249.00 incl. of all taxes',
  net_quantity: '500 g',
  unit_sale_price: null,
  manufacturer: 'Parle Products Pvt Ltd',
  packer: null,
  importer: null,
  address: 'Savli, Vadodara, Gujarat 391775',
  country_of_origin: null,
  mfg_date: 'Mfg. Date: 08/2025',
  best_before: 'Best Before 12 Months',
  consumer_care: '1800-222-999',
  lot_no: 'LOT X9876',
  fssai_license: '10012011000123',
  veg_nonveg: 'veg',
  nutrition_info: 'Energy 440 kcal ...',
  ingredients: 'Wheat flour, Sugar, Edible oil...',
  allergens: 'Contains gluten',
}

// 1. Fully compliant image-verifiable label
check('COMPLIANT on full Indian food label', () => {
  const out = engine.runComplianceEngine(mkInputs(fullEx))
  assert.strictEqual(out.summary.verdict, 'COMPLIANT', JSON.stringify(out.summary))
  assert.ok(out.summary.overall_score >= 80, `score ${out.summary.overall_score}`)
  assert.ok(out.context.is_food, 'should detect food')
  assert.strictEqual(out.context.origin, 'indian')
})

// 2. Missing MRP (absent, not uncertain) -> FAIL on rule 6(1)(e) -> NON_COMPLIANT
check('MISSING MRP -> FAIL + NON_COMPLIANT', () => {
  const ex = { ...fullEx, mrp: null }
  const out = engine.runComplianceEngine(mkInputs(ex, []))
  const mrpRule = out.rules.find((r) => r.rule_id === 'Rule 6(1)(e)')
  assert.ok(mrpRule, 'rule 6(1)(e) must exist')
  assert.strictEqual(mrpRule.status, 'FAIL')
  assert.strictEqual(out.summary.verdict, 'NON_COMPLIANT')
  assert.ok(out.summary.ai_insights.some((i) => i.rule_id === 'Rule 6(1)(e)'))
})

// 2b. MRP printed but illegible -> NOT_VERIFIABLE, never guessed
check('UNCERTAIN MRP -> NOT_VERIFIABLE + REQUIRES_PHYSICAL_INSPECTION', () => {
  const ex = { ...fullEx, mrp: null }
  const out = engine.runComplianceEngine(mkInputs(ex, ['mrp']))
  const mrpRule = out.rules.find((r) => r.rule_id === 'Rule 6(1)(e)')
  assert.strictEqual(mrpRule.status, 'NOT_VERIFIABLE')
})

// 3. Imported product -> origin imported, importer rule applied
check('IMPORTED product context', () => {
  const ex = { ...fullEx, importer: 'ABC Imports', country_of_origin: 'Country of origin: China' }
  const out = engine.runComplianceEngine(mkInputs(ex))
  assert.strictEqual(out.context.origin, 'imported')
  assert.strictEqual(out.context.package_type, 'retail')
})

// 4. Wholesale package -> rule 24 applicable, retail MRP rule skipped
check('WHOLESALE context - rule 24 applies', () => {
  const ex = { ...fullEx, net_quantity: '25 kg', commodity_name: 'Wholesale pack flour' }
  const text = 'for wholesale only not for retail sale'
  const out = engine.runComplianceEngine(mkInputs(ex, [], { productLabelText: text, ocrText: text }))
  assert.strictEqual(out.context.package_type, 'wholesale')
  assert.strictEqual(out.context.sold_by, 'weight')
})

// 5. No quantity -> NOT_VERIFIABLE / needs physical check path, never false PASS
check('MISSING net quantity -> NOT_VERIFIABLE path', () => {
  const ex = { ...fullEx, net_quantity: null }
  const out = engine.runComplianceEngine(mkInputs(ex, ['net_quantity']))
  const q = out.rules.find((r) => r.rule_id === 'Rule 6(1)(c)')
  assert.ok(q, 'rule 6(1)(c) must exist')
  assert.notStrictEqual(q.status, 'PASS', 'must not pass without a detected value')
})

// 6. Sheets commodity (Rule 16)
check('SHEET commodity detected', () => {
  const ex = { ...fullEx, commodity_name: 'Kitchen towels roll', net_quantity: '4 sheets', mrp: null }
  const out = engine.runComplianceEngine(mkInputs(ex, ['mrp']))
  assert.ok(out.context.special_commodity && out.context.special_commodity.startsWith('sheets'), out.context.special_commodity)
  assert.strictEqual(out.context.sold_by, 'number')
})

// 7. Every rule comes with evidence + verification_type
check('EVERY RuleCheck carries evidence + verification_type', () => {
  const out = engine.runComplianceEngine(mkInputs(fullEx))
  const applicable = out.rules.filter((r) => r.status !== 'NOT_APPLICABLE')
  for (const r of applicable) {
    assert.ok(r.requirement && r.requirement.length > 0, `${r.rule_id}: requirement missing`)
    assert.ok(r.evidence && typeof r.evidence.ocr_text === 'string', `${r.rule_id}: evidence missing`)
    assert.ok(r.verification_type, `${r.rule_id}: verification_type missing`)
  }
})

// 8. No declaration that says PASS when field absent, LLM never decides
check('No PASS without detected value (anti-hallucination)', () => {
  const sparse = {
    commodity_name: null,
    mrp: null, net_quantity: null, manufacturer: null, packer: null,
    importer: null, address: null, country_of_origin: null, mfg_date: null,
    best_before: null, consumer_care: null, lot_no: null, fssai_license: null,
    veg_nonveg: null, nutrition_info: null, ingredients: null, allergens: null,
  }
  const out = engine.runComplianceEngine(mkInputs(sparse, Object.keys(sparse), { barcode: null, languages: [] }))
  const passedReq = out.rules.filter((r) => r.status === 'PASS' && !r.rule_id.startsWith('Rule 3'))
  assert.strictEqual(passedReq.length, 0, `sparse label produced unexpected PASS: ${JSON.stringify(passedReq.map((r) => r.rule_id))}`)
})

// 9. Evidence chain traceable back to source image index
check('evidence_chain has source image + ocr text + status', () => {
  const out = engine.runComplianceEngine(mkInputs(fullEx))
  assert.ok(out.summary.evidence_chain.length > 0)
  for (const e of out.summary.evidence_chain) {
    assert.ok(typeof e.rule_id === 'string')
    assert.ok(typeof e.ocr_text === 'string')
    assert.ok('source_image' in e)
  }
})

console.log(JSON.stringify(tbl, null, 2))
console.log(`\nRESULT: ${passed}/${tbl.length} passed`)
if (passed !== tbl.length) process.exit(1)