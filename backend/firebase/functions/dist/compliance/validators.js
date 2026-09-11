"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMRP = validateMRP;
exports.detectUnit = detectUnit;
exports.validateQuantity = validateQuantity;
exports.validateUnitAgainstSoldBy = validateUnitAgainstSoldBy;
exports.validateDate = validateDate;
exports.validateContact = validateContact;
exports.validateFssai = validateFssai;
exports.validateVegNonVeg = validateVegNonVeg;
exports.validateAddressCompleteness = validateAddressCompleteness;
exports.validateCounted = validateCounted;
exports.validateSheets = validateSheets;
/**
 * Deterministic field validators.
 *
 * These validate raw extracted values for the compliance engine.
 * IMPORTANT: a valid-looking value is still NOT a legal fact — the engine
 * controls what each validator result means (PASS / WARNING / NOT_VERIFIABLE).
 */
const data_1 = require("./data");
const num = (raw) => (raw ?? '').trim() || null;
/** MRP must have: digits + currency/Rs/MRP + "incl. of all taxes". Multiple amounts = ambiguous. */
function validateMRP(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'MRP not detected (NOT_DETECTED).' };
    const hasSymbol = /[₹]|rs\.?|inr|\bmrp\b/i.test(v);
    const hasDigits = /\d/.test(v);
    const hasTaxPhrase = /incl\.?\s*of\s*all\s*taxes|inclusive\s*of\s*all\s*taxes/i.test(v);
    if (!hasDigits)
        return { ok: false, reason: `"${v}" contains no numeric amount.` };
    if (!hasSymbol)
        return { ok: false, reason: `"${v}" has no ₹/Rs/MRP symbol.` };
    if (!hasTaxPhrase)
        return { ok: false, reason: `"${v}" lacks the required "incl. of all taxes" wording (Rule 6(1)(e)).` };
    const amounts = v.match(/\d+(?:\.\d+)?/g);
    if (amounts && amounts.length > 1) {
        return { ok: false, reason: `Multiple amounts "${amounts.join(', ')}" — MRP is ambiguous; flag for verification rather than auto-selecting.`, normalized: v };
    }
    return { ok: true, reason: 'MRP declared with symbol and tax-inclusive wording.', normalized: v };
}
/** Detect a unit keyword and normalize it to its canonical symbol. */
function detectUnit(raw) {
    const v = num(raw);
    if (!v)
        return { kind: 'unknown' };
    const q = v.toLowerCase();
    const hit = (patterns, fallback) => {
        const m = q.match(new RegExp(`\\b(${patterns.join('|')})`, 'i'));
        return m ? { unit: m[1].toLowerCase(), kind: fallback } : null;
    };
    const order = [
        { patterns: ['tonne', 'ton'], kind: 'weight' },
        { patterns: ['kg'], kind: 'weight' },
        { patterns: ['mg'], kind: 'weight' },
        { patterns: ['gm', 'gram', 'grams', 'g'], kind: 'weight' },
        { patterns: ['millilitre', 'milliliter', 'ml'], kind: 'volume' },
        { patterns: ['centilitre', 'centiliter', 'cl'], kind: 'volume' },
        { patterns: ['litre', 'liter', 'ltr', 'l '], kind: 'volume' },
        { patterns: ['sq cm', 'sq m', 'sq ft', 'sq.'], kind: 'area' },
        { patterns: ['centimetre', 'centimeter', 'cm'], kind: 'length' },
        { patterns: ['metre', 'meter', ' m', 'm'], kind: 'length' },
        { patterns: ['pcs', 'pieces', 'piece', 'nos', 'numbers', 'number'], kind: 'number' },
        { patterns: ['sheets', 'sheet'], kind: 'number' },
        { patterns: ['rolls', 'roll'], kind: 'number' },
        { patterns: ['count'], kind: 'number' },
        { patterns: ['pairs', 'pair'], kind: 'number' },
        { patterns: ['dozen'], kind: 'number' },
    ];
    for (const o of order) {
        const r = hit(o.patterns, o.kind);
        if (r)
            return { kind: o.kind, unit: r.unit };
    }
    return { kind: 'unknown' };
}
/** Net quantity must carry a standard unit from the dictionary (Rules 11, 12, 13). */
function validateQuantity(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'Net quantity not detected (NOT_DETECTED).' };
    if (data_1.VAGUE_QUANTITY_WORDS.some((w) => v.toLowerCase().includes(w))) {
        return { ok: false, reason: `Vague expression "${v}" — Rules 11 & 12 prohibit "approximately/about/minimum" style net-quantity declarations.` };
    }
    const d = detectUnit(v);
    if (d.kind === 'unknown') {
        return { ok: false, reason: `"${v}" lacks a standard unit from the Fourth Schedule (g/kg/ml/L/cm/m/pcs…).`, normalized: v };
    }
    const amount = v.match(/\d+(?:\.\d+)?/)?.[0] ?? '';
    return { ok: true, reason: `Net quantity declared in a standard unit (${d.kind}).`, normalized: `${amount}${amount && d.unit ? ' ' : ''}${d.unit ?? ''}`.trim(), kind: d.kind };
}
/** A unit must be allowed for the commodity's sold-by type (Rule 13). */
function validateUnitAgainstSoldBy(unitKind, soldBy) {
    if (!soldBy || soldBy === 'unknown')
        return { ok: false, reason: 'Sold-by unit type could not be established — mark NOT_VERIFIABLE.', kind: unitKind };
    const allowed = soldBy === 'weight' ? data_1.WEIGHT_UNITS :
        soldBy === 'volume' ? data_1.VOLUME_UNITS :
            soldBy === 'length' ? data_1.LENGTH_UNITS :
                soldBy === 'number' ? data_1.NUMBER_UNITS : [];
    const symbolMap = data_1.UNIT_DICTIONARY.reduce((a, u) => { a[u.symbol] = u.kind; return a; }, {});
    // sold_by is one of the kinds; compare kinds directly.
    const ok = unitKind === soldBy;
    return ok
        ? { ok: true, reason: `Unit kind (${unitKind}) matches commodity sold-by basis (${soldBy}).` }
        : { ok: false, reason: `Unit kind "${unitKind}" does not match the commodity's sold-by basis "${soldBy}".`, kind: unitKind };
}
/** Manufacturing / best-before / use-by date formats (Rule 6(1)(d), 6(1)(g)). */
function validateDate(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'No date detected.' };
    // Shelf-life duration ("Best Before 12 Months") is an accepted declaration form.
    const isDuration = /\b\d+\s*(?:months?|years?|days?|weeks?)\b/i.test(v) &&
        /\b(?:best\s*before|use\s*by|expiry|exp\.?|valid)/i.test(v);
    if (isDuration) {
        return { ok: true, reason: 'Best-before / shelf-life duration declared (e.g. "12 months").' };
    }
    const okFormat = /\b\d{1,2}[\s\/\-.]\d{1,2}[\s\/\-.]\d{2,4}\b/.test(v) || // DD/MM/YYYY
        /\b\d{1,2}[\s\/\-.]\d{2,4}\b/.test(v) || // MM/YYYY
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*\d{1,2},?\s*\d{4}\b/i.test(v); // Jan 2025 / Jan 1, 2025
    if (!okFormat)
        return { ok: false, reason: `"${v}" is not a recognizable DD/MM/YYYY, Month-YYYY or shelf-life format.` };
    // Basic plausibility: month 1-12.
    const m = v.match(/(?:0?[1-9]|1[0-2])(?=[\s\/\-.]\d)/) || v.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i);
    if (!m)
        return { ok: false, reason: `"${v}" does not contain a valid month.` };
    return { ok: true, reason: 'Date format recognized and month plausible.' };
}
/** Consumer care: must be an actual phone, email or web contact (Rule 6(1)(f)). */
function validateContact(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'Consumer-care contact not detected (NOT_DETECTED).' };
    const digits = (v.match(/\d/g) ?? []).join('');
    const has10Digit = /^\d{10,}$/.test(digits.replace(/^\+?91/, ''));
    const hasTollFree = /1800[\s-]?\d{3}[\s-]?\d{3,4}/i.test(v);
    const hasGrouped = /(?:\d{2,4}[\s-]\d{2,4}[\s-]\d{3,4}|\d{3,5}[\s-/]\d{3,5})/.test(v);
    const hasContactWord = /tel\.?[: ]|phone|helpline|customer care|toll.?free/i.test(v);
    const hasEmail = /\S+@\S+\.\S+/.test(v) || /(?:^|[\s:(])email[: ]|e-mail/i.test(v);
    const hasWeb = /\b(?:www\.|https?:\/\/)\S+|\b[\w.-]+\.(?:com|in|co\.in|org)\b/i.test(v);
    if (has10Digit || hasTollFree || hasGrouped || hasEmail || hasWeb || hasContactWord) {
        return { ok: true, reason: 'Consumer-care contact includes a phone, email or web address.' };
    }
    return { ok: false, reason: `Contact text "${v}" found, but no valid phone number, email or web address is recognizable.` };
}
/** FSSAI licence (food items, FSS Act labelling): 14-digit number ± license format. */
function validateFssai(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'FSSAI licence number not detected on a food item (VERIFY — food labels must carry it).' };
    const digits = (v.match(/\d+/g) ?? []).join('');
    if (digits.length === 14)
        return { ok: true, reason: `FSSAI licence "${digits}" detected (14-digit format).`, normalized: digits };
    if (digits.length >= 10)
        return { ok: false, reason: `Detected "${v}" — ${digits.length} digits, expected 14. Flag for manual verification.`, normalized: digits };
    return { ok: false, reason: `Detected "${v}" — not a 14-digit FSSAI licence number.` };
}
/** Veg/non-veg green-dot indicator (FSS labelling). */
function validateVegNonVeg(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'Veg/Non-veg symbol (green/brown dot) not detected on a food item.' };
    const isVeg = /veg|vegetarian|pure veg/i.test(v);
    const isNonVeg = /non.?veg|non.?vegetarian/i.test(v);
    if (isVeg || isNonVeg)
        return { ok: true, reason: isVeg ? 'Veg mark indicated.' : 'Non-veg mark indicated.', normalized: v };
    return { ok: false, reason: `Detected "${v}" but could not classify as veg/non-veg indicator.` };
}
/** Complete postal address check (Rule 10): needs pincode, state/district hint, city. */
function validateAddressCompleteness(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'No address detected.' };
    const hasPin = /\b\d{6}\b/.test(v);
    const hasState = /\b(?:andhra pradesh|arunachal|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|orissa|punjab|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi|jammu|ladakh|puducherry|chandigarh|dadra|daman|diu|lakshadweep|andaman|nicobar)\b/i.test(v);
    const hasCityish = /\b(?:p\.o\.|po\b|post|district|tehsil|taluka|industrial area|road|street|nagar|phase|chowk|bazaar|bazar)\b/i.test(v);
    if (hasPin || (hasState && hasCityish))
        return { ok: true, reason: 'Address has a pincode and/or recognizable locality + state.', normalized: v };
    return { ok: false, reason: `Address "${v}" is present but incomplete — no pincode/state/locality detected. Verify against the physical label.` };
}
/** Detect "by number" declarations (Rule 17). */
function validateCounted(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'No counted quantity declared.' };
    const hasCount = /\b\d+\b/.test(v) && /\b(pcs|pieces|nos|numbers|count|sheets|rolls|pairs|dozen)\b/i.test(v);
    if (hasCount)
        return { ok: true, reason: 'Counted quantity declared in number units.', normalized: v };
    return { ok: false, reason: `"${v}" does not clearly declare a number of pieces/sheets/units.` };
}
/** Number of usable sheets (Rule 16 — toilet paper, tissues, foils). */
function validateSheets(raw) {
    const v = num(raw);
    if (!v)
        return { ok: false, reason: 'No sheet count / unrolled length declared.' };
    const hasSheets = /\b\d+\s*(?:sheets|leaves|ply)?\b/i.test(v);
    const hasLength = /\b\d+(\.\d+)?\s*(?:m|metre|meter|cm)\b/i.test(v);
    if (hasSheets || hasLength)
        return { ok: true, reason: 'Sheet count / unrolled length declared.', normalized: v };
    return { ok: false, reason: `"${v}" is not a clear sheet count or unrolled length.` };
}
