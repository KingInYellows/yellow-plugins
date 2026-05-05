#!/usr/bin/env node
'use strict';

const semver = require('semver');

function validateSemverRange(schemaValue, data) {
  if (schemaValue !== true) {
    validateSemverRange.errors = null;
    return true;
  }

  if (semver.validRange(data, { loose: false }) !== null) {
    validateSemverRange.errors = null;
    return true;
  }

  validateSemverRange.errors = [
    {
      keyword: 'semverRange',
      message: `must be a valid npm semver range (got "${String(data)}")`,
      params: { value: data },
    },
  ];
  return false;
}

module.exports = function addCustomKeywords(ajv) {
  ajv.addKeyword({
    keyword: 'semverRange',
    type: 'string',
    schemaType: 'boolean',
    errors: true,
    validate: validateSemverRange,
  });
};
