"use strict";
/**
 * The JSON schema a plan turn passes with --json-schema. agy returns the
 * plan in `structured_output`; isPlan checks the shape before it is stored.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_SCHEMA = void 0;
exports.isPlan = isPlan;
exports.PLAN_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'steps', 'risks'],
    properties: {
        summary: { type: 'string', minLength: 1, maxLength: 2000 },
        steps: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: { type: 'string', minLength: 1, maxLength: 1000 },
        },
        risks: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', minLength: 1, maxLength: 1000 },
        },
    },
};
/** Longest maxLength in the schema; counting stops just past it. */
const MAX_COUNTED = 2000;
/** Length in code points, as JSON Schema's maxLength counts, capped. */
function len(s) {
    let count = 0;
    for (const _ of s) {
        void _;
        if (++count > MAX_COUNTED)
            break;
    }
    return count;
}
function isStringArray(v, min, max) {
    return (Array.isArray(v) &&
        v.length >= min &&
        v.length <= max &&
        v.every((s) => typeof s === 'string' && s.length > 0 && len(s) <= 1000));
}
function isPlan(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const v = value;
    const keys = Object.keys(v);
    return (keys.every((k) => k === 'summary' || k === 'steps' || k === 'risks') &&
        typeof v['summary'] === 'string' &&
        v['summary'].length > 0 &&
        len(v['summary']) <= 2000 &&
        isStringArray(v['steps'], 1, 30) &&
        isStringArray(v['risks'], 0, 20));
}
