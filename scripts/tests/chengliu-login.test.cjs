const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const src = 'apps/codex-plus-manager/';

test('portal window has no native desktop capabilities', () => {
  const files = fs.readdirSync(path.join(root, src, 'src-tauri/capabilities')).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const capability = JSON.parse(read(src + 'src-tauri/capabilities/' + file));
    for (const label of [...(capability.windows || []), ...(capability.webviews || [])]) {
      assert.notEqual(label, '*');
      assert.notEqual(label, 'chengliu-portal');
    }
    assert.equal(capability.remote, undefined);
  }
  const command = read(src + 'src-tauri/src/commands.rs');
  const begin = command.indexOf('pub fn open_chengliu_portal(');
  const end = command.indexOf('pub fn open_external_url(', begin);
  const portal = command.slice(begin, end);
  assert.ok(portal.includes('https://api.chengliu-api.top/portal/'));
  assert.ok(portal.includes('tauri::WebviewUrl::External'));
  assert.ok(!portal.includes('eval('));
});

test('login screen ships a local logo, layout and honest credential guidance', () => {
  const screen = read(src + 'src/ChengliuLoginScreen.tsx');
  assert.ok(screen.includes('new URL("./assets/codex-plus-logo.png", import.meta.url)'));
  assert.ok(!screen.includes('/logo.svg'));
  assert.ok(screen.includes('import "./ChengliuLoginScreen.css"'));
  assert.ok(screen.includes('网页登录不会自动配置桌面 API 密钥'));
  const css = read(src + 'src/ChengliuLoginScreen.css');
  assert.ok(css.includes('.chengliu-login-panel'));
  const app = read(src + 'src/App.tsx');
  assert.ok(app.includes('>("open_chengliu_portal")'));
  assert.ok(app.includes('agentFocusOpen && route !== "chengliuLogin"'));
});
