"use strict";
/**
 * Shared types for the Legal Metrology compliance engine.
 *
 * Source: The Legal Metrology (Packaged Commodities) Rules, 2011.
 * This is a deterministic engine — the LLM is never allowed to produce
 * statuses, verdicts or legal conclusions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOOD_CATEGORIES = exports.EXTRACTION_KEYS = void 0;
exports.EXTRACTION_KEYS = [
    'commodity_name', 'mrp', 'net_quantity', 'unit_sale_price', 'manufacturer', 'packer',
    'importer', 'address', 'country_of_origin', 'mfg_date', 'best_before', 'consumer_care',
    'lot_no', 'fssai_license', 'veg_nonveg', 'nutrition_info', 'ingredients', 'allergens',
];
/** Categories that are food/beverage (carry food-specific label obligations). */
exports.FOOD_CATEGORIES = ['Food', 'Beverage'];
