const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../../apps/codex-plus-manager/src-tauri');
const base = JSON.parse(fs.readFileSync(path.join(dir, 'tauri.conf.json'), 'utf8'));
// Tauri --config uses JSON Merge Patch: arrays replace, not element-wise merge.
function merge(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = {...target};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = merge(out[key], value);
  }
  return out;
}
for (const name of ['tauri.chengliu.conf.json', 'tauri.chengliu.windows.conf.json', 'tauri.chengliu.macos.conf.json']) {
  test(`${name}: manually created main must not also auto-create`, () => {
    const patch = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const effective = merge(base, patch);
    assert.equal(effective.app.windows.length, 1);
    assert.equal(effective.app.windows[0].label, 'main');
    assert.equal(effective.app.windows[0].create, false, 'setup manually builds main; auto creation causes duplicate-label startup failure');
    assert.equal(effective.build.frontendDist, base.build.frontendDist);
    assert.equal(effective.identifier, 'top.chengliu.codexplusplus');
  });
}
