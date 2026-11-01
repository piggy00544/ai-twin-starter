import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCompatibility } from '../scripts/compatibility.mjs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const matrix = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8'));

test('every validated official SDK has matching exact Host and SDK declarations', () => {
  for (const version of matrix) assert.equal(validateCompatibility(pkg, version), version);
  for (const version of ['0.2.1-rc.4', '0.2.1-rc.5']) assert.ok(matrix.includes(version));
});
test('a new official SDK fails until it has been tested and added explicitly', () => {
  assert.throws(() => validateCompatibility(pkg, '0.2.1-rc.6'), /absent from the tested matrix/);
  assert.throws(() => validateCompatibility(pkg, '0.2.2-alpha.2'), /absent from the tested matrix/);
});
test('broad or drifting Host compatibility cannot silently admit an untested SDK', () => {
  const changed = structuredClone(pkg); changed.engines.dsh = '>=0.2.0';
  assert.throws(() => validateCompatibility(changed, matrix.at(-1)), /exactly match/);
});
test('missing or drifting SDK peers fail the gate', () => {
  for (const name of Object.keys(pkg.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-'))) {
    const changed = structuredClone(pkg); delete changed.peerDependencies[name];
    assert.throws(() => validateCompatibility(changed, matrix.at(-1)), /exactly match/);
  }
});
test('duplicate or non-exact matrix values are refused', () => {
  for (const invalid of [[...matrix, matrix[0]], ['>=0.2.0'], []])
    assert.throws(() => validateCompatibility(pkg, matrix.at(-1), invalid), /Invalid SDK matrix/);
});
