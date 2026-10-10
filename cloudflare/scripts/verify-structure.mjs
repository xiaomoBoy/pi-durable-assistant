import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const pkg = JSON.parse(read('../package.json'));
const wrangler = JSON.parse(read('../wrangler.jsonc'));
const source = read('../src/index.js');
const html = read('../public/index.html');
const browser = read('../public/app.js');
const sample = read('../.dev.vars.example');
const originalUi = read('../public/style.css');
const edgeStyles = read('../public/edge.css');
const mascot = read('../public/mascot.js');
const readme = read('../README.md');

assert.equal(pkg.name, 'pi-durable-edge');
assert.equal(wrangler.name, pkg.name);
assert.equal(wrangler.main, 'src/index.js');
assert.equal(wrangler.durable_objects.bindings[0].class_name, 'Assistant');
assert.ok(wrangler.migrations.some((m) => m.new_sqlite_classes?.includes('Assistant')));
assert.equal(wrangler.assets.directory, './public');
assert.ok(source.includes("export class Assistant extends Agent"));
assert.ok(source.includes('this.lifecycle.use(this.harness)'));
assert.ok(source.includes('env.ACCESS_TOKEN'));
assert.ok(html.includes('id="selfcheck"'));
assert.ok(html.includes('class="app-layout"'));
assert.ok(html.includes('class="sidebar-left"'));
assert.ok(html.includes('class="chat-column"'));
assert.ok(html.includes('class="sidebar-right"'));
for (const id of new Set([...browser.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map((item) => item[1]))) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing UI element: ' + id);
}
assert.ok(originalUi.includes('.conversation-item') && originalUi.includes('.assistant-bubble'));
assert.ok(originalUi.includes('.mascot-svg') && originalUi.includes('.sidebar-right'));
assert.ok(edgeStyles.includes('.edge-dialog-backdrop'));
assert.ok(mascot.includes('ROBOT_SVG_CONTENT'));
assert.ok(html.includes('/style.css') && html.includes('/edge.css') && html.includes('/mascot.js'));
assert.ok(browser.includes("addEventListener('click'") && browser.includes('selfcheck'));
assert.ok(readme.includes('https://deploy.workers.cloudflare.com/?url=https://github.com/xiaomoBoy/pi-durable-assistant/tree/main/cloudflare'));
assert.ok(readme.includes('docs/DEPLOY.md'));
assert.match(sample, /^ACCESS_TOKEN=/m);
assert.ok(!sample.includes('DEMO_TOKEN'));
const tokenExample = sample.match(/^ACCESS_TOKEN=(.*)$/m)?.[1] ?? '';
assert.ok(tokenExample.length < 24, 'Do not ship a shared working access token in .dev.vars.example');
assert.ok(!('vars' in wrangler && 'ACCESS_TOKEN' in wrangler.vars), 'Access token must not be a plain Wrangler variable');
console.log('Pi Durable Edge manifest, bindings, install paths, and secrets: OK');
