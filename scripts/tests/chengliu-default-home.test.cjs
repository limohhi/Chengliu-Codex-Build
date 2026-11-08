const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let root = __dirname;
while (root !== path.dirname(root) && !fs.existsSync(path.join(root, 'apps/codex-plus-manager/src-tauri/src/lib.rs'))) root = path.dirname(root);
if (!fs.existsSync(path.join(root, 'apps/codex-plus-manager/src-tauri/src/lib.rs'))) throw new Error('Could not locate repository root');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('home always exposes a direct Chengliu platform entry', () => {
  const app = read('apps/codex-plus-manager/src/App.tsx');
  const start = app.indexOf('function HomeScreen(');
  const end = app.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const home = app.slice(start, end);
  assert.match(home, /title=\{t\("平台"\)\s*\}/);
  assert.ok(home.includes('title={t("澄流平台")}'));
  assert.ok(home.includes('onNavigate("chengliuLogin")'));
});

test('legacy FastAiApi system default migrates to Chengliu default and is removed', () => {
  const settings = read('crates/codex-plus-core/src/settings.rs');
  assert.ok(settings.includes('profile.name.eq_ignore_ascii_case("FastAiApi")'));
  assert.ok(settings.includes('profile.base_url.contains("fastaiapi.cloud")'));
  assert.ok(settings.includes('profile.upstream_base_url.contains("fastaiapi.cloud")'));
  assert.ok(settings.includes('settings.active_relay_id = default_active_relay_id();'));
  assert.ok(settings.includes('!legacy_fastai_ids.contains(&profile.id) && promoted_source_id.as_deref() != Some(profile.id.as_str())'));
  assert.ok(settings.includes('name: "澄流平台".to_string()'));
});
