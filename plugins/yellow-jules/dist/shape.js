"use strict";
/**
 * Shape predicates for the files this plugin parses (journal, grants, the
 * controller file). Every parsed file is shape-validated field by field; these
 * are the shared building blocks, so the three parsers cannot drift.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlainObject = isPlainObject;
exports.isStringArray = isStringArray;
exports.isPositiveInt = isPositiveInt;
exports.isNonNegativeInt = isNonNegativeInt;
exports.isIsoTime = isIsoTime;
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((v) => typeof v === 'string');
}
function isPositiveInt(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
function isNonNegativeInt(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function isIsoTime(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
