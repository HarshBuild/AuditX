"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectContext = exports.RULES = void 0;
exports.runComplianceEngine = runComplianceEngine;
/**
 * Deterministic Legal Metrology compliance engine.
 *
 * Pipeline: scanner -> OCR/Groq (extraction.ts) -> structured data ->
 * context detection (context.ts) -> rule applicability (rules.ts) ->
 * per-rule evaluation -> verdict + evidence (result.ts).
 *
 * The LLM is never the decision-maker here.
 */
const context_1 = require("./context");
const rules_1 = require("./rules");
Object.defineProperty(exports, "RULES", { enumerable: true, get: function () { return rules_1.RULES; } });
const result_1 = require("./result");
__exportStar(require("./types"), exports);
var context_2 = require("./context");
Object.defineProperty(exports, "detectContext", { enumerable: true, get: function () { return context_2.detectContext; } });
function runComplianceEngine(d) {
    const context = (0, context_1.detectContext)(d);
    const rules = (0, rules_1.runAllRules)(context, d);
    const summary = (0, result_1.computeCompliance)(rules, d.uncertain.length);
    const assistant = (0, result_1.buildAssistant)(summary, exToRecord(d.ex), d.userProductName, d.languages);
    return { context, rules, summary, assistant };
}
function exToRecord(ex) {
    const out = {};
    for (const k of Object.keys(ex))
        out[k] = ex[k];
    return out;
}
