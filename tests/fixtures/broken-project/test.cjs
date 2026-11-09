const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('source is valid JavaScript', () => {
  const source = fs.readFileSync('src.js', 'utf8');
  assert.doesNotThrow(() => new Function(source));
});
