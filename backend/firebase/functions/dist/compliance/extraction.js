"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_LANGS = void 0;
exports.buildExtractionPrompt = buildExtractionPrompt;
exports.extractJson = extractJson;
exports.norm = norm;
exports.normField = normField;
exports.sanitizeExtractions = sanitizeExtractions;
exports.parseRaw = parseRaw;
exports.isFoodCategory = isFoodCategory;
/**
 * LLM interface — the ONLY place the model is allowed to act.
 * It transcribes and extracts verbatim label data. It NEVER decides
 * compliance; the engine (engine.ts) does that deterministically.
 *
 * If a value is not visible/legible the model MUST return null + mark the
 * key "uncertain" instead of guessing.
 */
const data_1 = require("./data");
const types_1 = require("./types");
exports.SUPPORTED_LANGS = {
    en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', mr: 'Marathi',
    gu: 'Gujarati', pa: 'Punjabi', kn: 'Kannada', ml: 'Malayalam',
};
function buildExtractionPrompt(lang) {
    const langName = exports.SUPPORTED_LANGS[lang] ?? 'English';
    return `You are a precise label transcription engine for Indian packaged commodities.
You receive multiple photographs of THE SAME product package. EACH photograph is labeled with its position (front, back, side, other).

YOUR JOB: Read the text on the label and extract specific fields. You are a transcription machine, NOT a compliance judge.

=== CRITICAL RULES ===
1. ONLY extract text ACTUALLY VISIBLE AND LEGIBLE on the labels.
2. NEVER reconstruct, guess, infer, or hallucinate ANY value. If you are unsure, return null.
3. Use the EXACT VERBATIM text as printed — preserve digits, units, symbols, abbreviations.
4. If a field is completely absent from ALL photos -> value: null, confidence: "low".
5. If a field IS printed but blurry/cut off/illegible -> value: null, add key to "uncertain", confidence: "low".
6. The label language is ${langName}. Read text in this language AND in English (many labels are bilingual).
7. "category" must be one of: ${data_1.ALLOWED_CATEGORIES.join(', ')}.

=== FIELD-SPECIFIC EXTRACTION RULES ===

MRP (Maximum Retail Price):
- Common printed patterns: "MRP Rs.249", "MRP ₹249.00", "M.R.P.: Rs 249/-", "Maximum Retail Price Rs.249 incl. of all taxes", "MRP Rs 249 (inclusive of all taxes)"
- Include the FULL printed line (price + "incl. of all taxes" if present).
- If ONLY one price is visible, extract it. If MULTIPLE prices are visible (e.g., MRP + "offer price"), put the CLEAR retail MRP as value and note the others in uncertain.
- NEVER return a value like "MRP" or "Rs" alone — always include the numeric amount.

Net Quantity / Net Weight:
- Common patterns: "Net Qty: 500 g", "Net Wt. 250g", "Net Weight: 1 kg", "Net Contents: 100 ml", "6 x 200ml"
- Include the numeric value AND the unit exactly as printed.
- For multipacks, include the full expression: "6 x 200 ml" (not just "1200 ml").

Manufacturer / Packer / Importer:
- Common patterns: "Manufactured by: ITC Limited", "Packed by: XYZ Foods Pvt. Ltd.", "Marketed by: ABC Corp"
- Include the FULL company name as printed (preserve uppercase, "Pvt. Ltd.", "Limited", etc.).
- The address is a SEPARATE field — do not merge it with the company name.

Address:
- Common patterns: "Regd. Office: 123 Industrial Area, Delhi - 110001", "Factory: Plot 5, MIDC, Pune 411018"
- Include the COMPLETE address including PIN code.
- The address often follows the manufacturer/packer name on the next line.

Country of Origin:
- Common patterns: "Country of Origin: India", "Made in India", "Product of India"
- Extract the country name ONLY.

Dates (Manufacturing / Best Before / Expiry):
- Common patterns: "Mfg.Dt:08/2025", "Mfg. Date: 08/2025", "PKD: AUG 2025", "Mfg Month & Year: 08/2025", "Best Before: 12 months from manufacture", "Expiry: 01/2026"
- For mfg_date: extract the date string EXACTLY as printed.
- For best_before: extract the full line (duration or date).
- If both mfg_date and best_before are on the same line, put the manufacturing date in mfg_date and the best-before in best_before.

Consumer Care:
- Common patterns: "Consumer Care: 1800-123-4567", "Customer Care: care@company.com", "Helpline: 1800 102 3040"
- Include the FULL contact information (phone, email, web address).

Lot / Batch Number:
- Common patterns: "Lot No: AB123", "Batch: 2025-08-01A", "B.No: 12345"
- Include the exact code as printed.

FSSAI License (food items only):
- Must be EXACTLY 14 digits starting with 1 or 2. Example: 10019011002543
- If you see a 14-digit number that does NOT start with 1 or 2, it is NOT an FSSAI license.
- Do NOT confuse batch codes, timestamps, or other numbers with FSSAI license.

Veg / Non-Veg (food items only):
- Green dot/brown dot symbol. Return "veg" or "nonveg" or null.

Nutrition Info / Ingredients / Allergens (food items only):
- Extract the FULL verbatim text from the nutrition table / ingredient list / allergen declaration.
- These are often multi-line. Include ALL lines.

=== OUTPUT FORMAT ===
Respond ONLY with valid JSON. No markdown, no code fences, no commentary before or after.

{
  "product_name": "exact product name as printed or null",
  "brand": "brand name as printed or null",
  "category": "one of: ${data_1.ALLOWED_CATEGORIES.join(', ')}",
  "ocr": {"text": "all visible text combined from all photos", "languages": ["en"]},
  "ocr_blocks": [
    {"position": "front", "text": "text from photo 0", "languages": ["en"]},
    {"position": "back", "text": "text from photo 1", "languages": ["en"]}
  ],
  "labels": [{"label":"label name","label_text":"brief description"}],
  "extractions": {
    "commodity_name": {"value":"exact text or null","confidence":"high|medium|low","source_image":0},
    "mrp": {"value":"full MRP line with amount or null","confidence":"high|medium|low","source_image":0},
    "net_quantity": {"value":"exact qty with unit or null","confidence":"high|medium|low","source_image":0},
    "unit_sale_price": {"value":"exact USP or null","confidence":"high|medium|low","source_image":null},
    "manufacturer": {"value":"company name only or null","confidence":"high|medium|low","source_image":null},
    "packer": {"value":"company name only or null","confidence":"high|medium|low","source_image":null},
    "importer": {"value":"company name only or null","confidence":"high|medium|low","source_image":null},
    "address": {"value":"full address with PIN or null","confidence":"high|medium|low","source_image":null},
    "country_of_origin": {"value":"country name only or null","confidence":"high|medium|low","source_image":null},
    "mfg_date": {"value":"exact date string or null","confidence":"high|medium|low","source_image":null},
    "best_before": {"value":"exact best-before line or null","confidence":"high|medium|low","source_image":null},
    "consumer_care": {"value":"full contact info or null","confidence":"high|medium|low","source_image":null},
    "lot_no": {"value":"exact batch/lot code or null","confidence":"high|medium|low","source_image":null},
    "fssai_license": {"value":"14-digit FSSAI number or null","confidence":"high|medium|low","source_image":null},
    "veg_nonveg": {"value":"veg|nonveg or null","confidence":"high|medium|low","source_image":null},
    "nutrition_info": {"value":"verbatim nutrition table or null","confidence":"high|medium|low","source_image":null},
    "ingredients": {"value":"verbatim ingredient list or null","confidence":"high|medium|low","source_image":null},
    "allergens": {"value":"verbatim allergen text or null","confidence":"high|medium|low","source_image":null}
  },
  "uncertain": ["field keys where text was printed but illegible"],
  "language_note": "short note about label languages"
}`;
}
/* ------------------------------------------------------------------ */
/* JSON parsing + normalization helpers                                 */
/* ------------------------------------------------------------------ */
function extractJson(text) {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
        return JSON.parse(cleaned);
    }
    catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : null;
    }
}
function norm(value) {
    if (value === null || value === undefined)
        return null;
    const s = String(value).trim();
    if (s === '' || /^(null|n\/a|none|not detected|n\/d|unknown|-{1,})$/.test(s.toLowerCase()))
        return null;
    return s;
}
/** Normalize an extraction field — accepts {value,confidence,source_image} or plain string/null. */
function normField(raw) {
    if (raw === null || raw === undefined)
        return { value: null, confidence: 'low', source_image: null };
    if (typeof raw === 'string')
        return { value: norm(raw), confidence: 'medium', source_image: null };
    if (typeof raw === 'object') {
        const o = raw;
        return {
            value: norm(o.value),
            confidence: o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low' ? o.confidence : 'medium',
            source_image: typeof o.source_image === 'number' ? o.source_image : null,
        };
    }
    return { value: norm(raw), confidence: 'medium', source_image: null };
}
/** Extract extractions from raw Groq JSON — handles both old and new formats. */
function sanitizeExtractions(value) {
    const fields = {};
    const ex = {
        commodity_name: null, mrp: null, net_quantity: null, unit_sale_price: null,
        manufacturer: null, packer: null, importer: null, address: null,
        country_of_origin: null, mfg_date: null, best_before: null, consumer_care: null,
        lot_no: null, fssai_license: null, veg_nonveg: null, nutrition_info: null,
        ingredients: null, allergens: null,
    };
    if (value && typeof value === 'object') {
        const src = value;
        for (const key of types_1.EXTRACTION_KEYS) {
            fields[key] = normField(src[key]);
            ex[key] = fields[key].value;
        }
    }
    else {
        for (const key of types_1.EXTRACTION_KEYS)
            fields[key] = { value: null, confidence: 'low', source_image: null };
    }
    return { fields, ex };
}
function parseRaw(raw, user) {
    const { fields, ex } = sanitizeExtractions(raw.extractions);
    const rawOcr = raw.ocr && typeof raw.ocr === 'object' ? raw.ocr : null;
    const ocrText = norm(rawOcr?.text) ?? '';
    const ocrLangs = Array.isArray(rawOcr?.languages)
        ? rawOcr.languages.map((l) => String(l).trim()).filter(Boolean)
        : [];
    const ocrBlocks = Array.isArray(raw.ocr_blocks)
        ? raw.ocr_blocks
            .filter((b) => Boolean(b) && typeof b === 'object')
            .map((b) => ({
            position: String(b.position ?? 'unknown'),
            text: String(b.text ?? ''),
            languages: Array.isArray(b.languages) ? b.languages.map((l) => String(l).trim()).filter(Boolean) : [],
        }))
        : [];
    const uncertain = Array.isArray(raw.uncertain) ? raw.uncertain.map((l) => String(l).trim()).filter(Boolean) : [];
    const labels = Array.isArray(raw.labels)
        ? raw.labels
            .filter((l) => Boolean(l) && typeof l === 'object')
            .map((l) => ({ label: norm(l.label) ?? 'Label', label_text: norm(l.label_text) ?? '' }))
        : [];
    const categoryRaw = norm(raw.category) ?? user.category;
    const category = categoryRaw && data_1.ALLOWED_CATEGORIES.includes(categoryRaw) ? categoryRaw : 'Other';
    return {
        fields, ex,
        ocrText, ocrLangs, ocrBlocks, uncertain, labels,
        category,
        barcode: norm(user.barcode ?? raw.barcode),
        productName: norm(raw.product_name) ?? user.product_name ?? null,
        brand: norm(raw.brand),
        languageNote: norm(raw.language_note) ?? '',
    };
}
function isFoodCategory(cat) {
    return types_1.FOOD_CATEGORIES.includes(cat);
}
