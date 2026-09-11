"use strict";
/**
 * Reference data derived from The Legal Metrology (Packaged Commodities)
 * Rules, 2011 and its Schedules.
 *
 * NOTE: Values are compiled from the published rules. If any figure in the
 * uploaded PDF differs, update the arrays below — the engine reads ONLY this
 * file, never hardcodes values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRICE_LINKED_COMMODITIES = exports.ALLOWED_CATEGORIES = exports.UNIT_DICTIONARY = exports.MAX_PERMISSIBLE_ERRORS = exports.COUNT_COMMODITIES = exports.SHEET_COMMODITIES = exports.DIMENSION_COMMODITIES = exports.STANDARD_PACKAGE_SIZES = exports.NON_FOOD_CATEGORY_HINTS = exports.EXEMPTION_KEYWORDS = exports.AD_KEYWORDS = exports.IMPORT_KEYWORDS = exports.EXPORT_KEYWORDS = exports.WHOLESALE_KEYWORDS = exports.VAGUE_QUANTITY_WORDS = exports.NUMBER_UNITS = exports.AREA_UNITS = exports.LENGTH_UNITS = exports.VOLUME_UNITS = exports.WEIGHT_UNITS = exports.STANDARD_UNITS = void 0;
/* ------------------------------------------------------------------ */
/* Pattern / keyword dictionaries                                      */
/* ------------------------------------------------------------------ */
exports.STANDARD_UNITS = [
    'g', 'gm', 'gram', 'grams', 'kg', 'milligram', 'mg', 'tonne', 'ton',
    'ml', 'millilitre', 'l', 'litre', 'liter', 'cl', 'centilitre',
    'cm', 'centimetre', 'm', 'metre', 'km', 'sq cm', 'sq m', 'sq ft',
    'pcs', 'pieces', 'piece', 'nos', 'numbers', 'no', 'count', 'sheet', 'sheets',
    'roll', 'rolls', 'pair', 'pairs', 'dozen', 'bundle', 'packet', 'packets', 'unit', 'units',
];
exports.WEIGHT_UNITS = ['g', 'kg', 'mg', 'gram', 'grams', 'gm', 'tonne', 'ton', 'milligram'];
exports.VOLUME_UNITS = ['ml', 'millilitre', 'l', 'litre', 'liter', 'cl', 'centilitre'];
exports.LENGTH_UNITS = ['cm', 'centimetre', 'm', 'metre', 'km'];
exports.AREA_UNITS = ['sq cm', 'sq m', 'sq ft', 'sq meter'];
exports.NUMBER_UNITS = ['pcs', 'pieces', 'piece', 'nos', 'number', 'numbers', 'no', 'count', 'sheet', 'sheets', 'roll', 'rolls', 'pair', 'pairs', 'dozen', 'bundle', 'packet', 'packets', 'unit', 'units'];
/** Vague / approximate quantity expressions — prohibited for net quantity by Rules 11 & 12. */
exports.VAGUE_QUANTITY_WORDS = ['approximately', 'approx', 'about', 'minimum', 'not less than', 'upto', 'up to', 'more or less', 'min'];
exports.WHOLESALE_KEYWORDS = ['for wholesale', 'wholesale only', 'not for retail sale', 'for trade', 'bulk pack', 'institutional pack'];
exports.EXPORT_KEYWORDS = ['for export', 'export only', 'for export only', 'not for sale in india'];
exports.IMPORT_KEYWORDS = ['imported by', 'imported from', 'market. by', 'marketed by', 'country of origin', 'made in china', 'made in uae'];
exports.AD_KEYWORDS = ['advertisement', 'advertised', 'special offer', 'advert', 'insert', 'promotion'];
exports.EXEMPTION_KEYWORDS = [
    { exempt: 'not_for_retail_sale', keywords: ['not for retail sale', 'not intended for retail', 'for institutional use only'] },
    { exempt: 'export', keywords: ['for export only'] },
    { exempt: 'industrial_packaging', keywords: ['industrial packaging', 'for industrial use', 'bulk industrial'] },
    { exempt: 'containers_above_5kg_or_25l', keywords: ['25 kg', '50 kg', '25 litre', '25 l', '50 litre', '50 l'] },
];
/* ------------------------------------------------------------------ */
/* Commodiity/category hints → is_food                                 */
/* ------------------------------------------------------------------ */
exports.NON_FOOD_CATEGORY_HINTS = [
    'cosmetic', 'soap', 'shampoo', 'toothpaste', 'detergent', 'floor cleaner', 'notebook', 'stationery',
    'cement', 'paint', 'battery', 'bulb', 'cloth', 'saree', 'bedsheet', 'towel', 'wire', 'nail',
];
exports.STANDARD_PACKAGE_SIZES = [
    { commodity: 'atta / wheat flour', allowed: ['500 g', '1 kg', '2 kg', '5 kg', '10 kg'], unit_hint: 'weight' },
    { commodity: 'sugar', allowed: ['500 g', '1 kg', '2 kg', '5 kg'], unit_hint: 'weight' },
    { commodity: 'salt', allowed: ['500 g', '1 kg'], unit_hint: 'weight' },
    { commodity: 'rice', allowed: ['500 g', '1 kg', '2 kg', '5 kg'], unit_hint: 'weight' },
    { commodity: 'bread', allowed: ['200 g', '400 g'], unit_hint: 'weight' },
    { commodity: 'butter', allowed: ['100 g', '500 g'], unit_hint: 'weight' },
    { commodity: 'ghee', allowed: ['500 g', '1 kg'], unit_hint: 'weight' },
    { commodity: 'mustard oil', allowed: ['500 ml', '1 l', '2 l', '5 l'], unit_hint: 'volume' },
    { commodity: 'edible oil', allowed: ['500 ml', '1 l', '2 l', '5 l'], unit_hint: 'volume' },
    { commodity: 'milk', allowed: ['200 ml', '500 ml', '1 l'], unit_hint: 'volume' },
    { commodity: 'soft drink', allowed: ['250 ml', '300 ml', '750 ml', '1.25 l', '2 l'], unit_hint: 'volume' },
];
/* ------------------------------------------------------------------ */
/* Rule 14 — commodities sold by length / area / number                 */
/* (textiles etc.). Dimensions must be declared in standard units.      */
/* ------------------------------------------------------------------ */
exports.DIMENSION_COMMODITIES = [
    'saree', 'sarees', 'dhoti', 'dhotis', 'dupatta', 'dupattas', 'shawl', 'shawls',
    'bed sheet', 'bed sheets', 'bedsheet', 'bedsheets', 'pillow cover', 'pillow covers',
    'towel', 'towels', 'napkin', 'napkins', 'curtain', 'curtains', 'suit length', 'garment', 'garments',
];
/* ------------------------------------------------------------------ */
/* Rules 16 & 17 — sheet / count commodities                            */
/* ------------------------------------------------------------------ */
exports.SHEET_COMMODITIES = ['tissue', 'tissues', 'napkin', 'napkins', 'toilet paper', 'kitchen towel', 'kitchen towels', 'foil', 'aluminium foil', 'foil paper'];
exports.COUNT_COMMODITIES = ['bag', 'bags', 'box', 'boxes', 'cup', 'cups', 'bottle', 'bottles', 'container', 'containers', 'piece', 'pieces'];
/* ------------------------------------------------------------------ */
/* First Schedule — Maximum Permissible Errors (Rule 22).               */
/* Representative illustrative values (net-quantity MPE).               */
/* ------------------------------------------------------------------ */
exports.MAX_PERMISSIBLE_ERRORS = [
    { range: 'up to 50 g / 50 ml', unit: 'weight', error: '9%' },
    { range: 'above 50 g/ml to 100 g/ml', unit: 'weight', error: '4.5 g / 4.5 ml' },
    { range: 'above 100 to 200', unit: 'weight', error: '3%' },
    { range: 'above 200 to 300', unit: 'weight', error: '6 g / 6 ml' },
    { range: 'above 300 to 500', unit: 'weight', error: '2%' },
    { range: 'above 500 to 1000', unit: 'weight', error: '10 g / 10 ml' },
    { range: 'above 1000 to 10000', unit: 'weight', error: '1.5%' },
    { range: 'above 10 kg / 10 l to 50 kg / 50 l', unit: 'weight', error: '0.5%' },
];
/* ------------------------------------------------------------------ */
/* Fourth Schedule — units of measurement permitted for net quantity    */
/* ------------------------------------------------------------------ */
exports.UNIT_DICTIONARY = [
    { symbol: 'g', name: 'gram', kind: 'weight' },
    { symbol: 'gm', name: 'gram', kind: 'weight' },
    { symbol: 'kg', name: 'kilogram', kind: 'weight' },
    { symbol: 'mg', name: 'milligram', kind: 'weight' },
    { symbol: 'tonne', name: 'tonne', kind: 'weight' },
    { symbol: 'ml', name: 'millilitre', kind: 'volume' },
    { symbol: 'cl', name: 'centilitre', kind: 'volume' },
    { symbol: 'l', name: 'litre', kind: 'volume' },
    { symbol: 'cm', name: 'centimetre', kind: 'length' },
    { symbol: 'm', name: 'metre', kind: 'length' },
    { symbol: 'km', name: 'kilometre', kind: 'length' },
    { symbol: 'sq m', name: 'square metre', kind: 'area' },
    { symbol: 'sq cm', name: 'square centimetre', kind: 'area' },
    { symbol: 'pcs', name: 'pieces', kind: 'number' },
    { symbol: 'nos', name: 'numbers', kind: 'number' },
    { symbol: 'count', name: 'count', kind: 'number' },
    { symbol: 'sheet', name: 'sheets', kind: 'number' },
    { symbol: 'roll', name: 'rolls', kind: 'number' },
    { symbol: 'pair', name: 'pairs', kind: 'number' },
    { symbol: 'dozen', name: 'dozen', kind: 'number' },
];
/* ------------------------------------------------------------------ */
/* Category set (from the app)                                          */
/* ------------------------------------------------------------------ */
exports.ALLOWED_CATEGORIES = ['Food', 'Beverage', 'Cosmetic', 'Household', 'Electronics', 'Stationery', 'PersonalCare', 'Other'];
/** Commodities whose price is linked to dimension/weight (Rule 15 — "Fifth Schedule"-style). */
exports.PRICE_LINKED_COMMODITIES = [
    'cable', 'wire', 'pipe', 'hose', 'curtain', 'garment', 'fabric', 'suit length', 'foil', 'rope', 'yarn',
];
