import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const matrix = JSON.parse(read('compatibility.json'));
const root = new URL('../', import.meta.url);

test('CI derives the supported matrix and official latest gate from one manifest', () => {
  const workflow = read('.github/workflows/sdk-compatibility.yml');
  for (const trigger of ['workflow_call', 'workflow_dispatch', 'push', 'pull_request', 'schedule']) assert.match(workflow, new RegExp('^  ' + trigger + ':', 'm'));
  assert.match(workflow, /cron: '17 3,15 \* \* \*'/);
  assert.match(workflow, /node scripts\/compatibility\.mjs --latest/);
  assert.match(workflow, /node scripts\/compatibility\.mjs --matrix/);
  assert.match(workflow, /fromJson\(needs\.matrix\.outputs\.matrix\)/);
  assert.match(workflow, /max-parallel: 2/); assert.match(workflow, /timeout-minutes: 20/);
  assert.match(workflow, /node --max-old-space-size=128 scripts\/ci-sdk\.mjs/);
  const runner = read('scripts/ci-sdk.mjs');
  for (const [, limit] of runner.matchAll(/max-old-space-size=(\d+)/g)) assert.equal(Number(limit), 128);
  assert.match(runner, /'suite\.tap', 240000, true/);
  assert.match(runner, /'host-contract\.log', 45000, true/);
  assert.match(runner, /await verifySandbox/);
  const sandbox = read('scripts/ci-sandbox.mjs');
  assert.match(sandbox, /--no-new-privs/);
  assert.match(sandbox, /unshare/); assert.match(sandbox, /sandbox-exec/);
  assert.match(sandbox, /No supported OS network sandbox/);
  assert.doesNotMatch(workflow, /id-token: write|secrets: inherit|persist-credentials: true|pull_request_target/);
  assert.doesNotMatch(workflow, /0\.2\.\d+-rc\.\d+/);
});
test('existing Trusted preparation depends on the gate without expanding OIDC', () => {
  const workflow = read('.github/workflows/npm-release.yml');
  const preparation = pkg.name.endsWith('finder') ? 'prepare' : 'validate';
  assert.match(workflow, /uses: \.\/\.github\/workflows\/sdk-compatibility\.yml/);
  assert.match(workflow, new RegExp('^  ' + preparation + ':[\\s\\S]*?^    needs: compatibility', 'm'));
  assert.equal(workflow.match(/id-token: write/g)?.length, 1);
  assert.match(workflow, new RegExp('needs: ' + preparation));
  assert.match(workflow, /digest-mismatch: error/);
  assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|secrets: inherit/);
});
test('the SDK runner accepts only declared exact SDK arguments before any install', () => {
  const run = args => spawnSync(process.execPath, ['scripts/ci-sdk.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 10000 });
  for (const sdk of matrix) {
    const result = run(['--sdk', sdk, '--plan']); assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout); assert.equal(plan.sdk, sdk);
    assert.equal(plan.suiteHeapMb, pkg.name.endsWith('finder') ? 512 : 128);
    assert.equal(plan.otherNodeHeapMb, 128);
    for (const [name, version] of Object.entries(plan.dependencies)) if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, sdk, name);
  }
  for (const args of [[], ['--sdk', '0.2.1-rc.6'], ['--sdk', matrix[0], '--force'], ['--sdk', matrix[0], '--sdk', matrix[0]], ['--sdk', '>=0.2.0']]) {
    const result = run(args); assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /install/i);
  }
});
test('runtime preload denies external fetch, DNS, TCP, TLS and UDP before traffic', () => {
  const program = `import assert from 'node:assert/strict';import net from 'node:net';import tls from 'node:tls';import dns from 'node:dns';import dgram from 'node:dgram';await assert.rejects(fetch('https://example.invalid'), /CI_NETWORK_DENIED/);assert.throws(()=>net.connect(443,'example.invalid'),/CI_NETWORK_DENIED/);assert.throws(()=>tls.connect({host:'example.invalid',port:443}),/CI_NETWORK_DENIED/);assert.throws(()=>dns.lookup('example.invalid',()=>{}),/CI_NETWORK_DENIED/);const socket=dgram.createSocket('udp4');assert.throws(()=>socket.send('x',53,'example.invalid'),/CI_NETWORK_DENIED/);socket.close();assert.equal(globalThis.__dshCiNetwork.denied,5);`;
  const result = spawnSync(process.execPath, ['--import', new URL('../scripts/ci-network.mjs', import.meta.url).href, '--input-type=module', '-e', program], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test('TAP acceptance requires substantive execution without failures, skips or cancellation', async () => {
  const { validateTap } = await import('../scripts/ci-sdk.mjs');
  const good = '# tests 10\n# pass 10\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.equal(validateTap(good, 10).pass, 10);
  for (const invalid of ['', good.replace('# pass 10', '# pass 0'), good.replace('# skipped 0', '# skipped 10'), good.replace('# cancelled 0', '# cancelled 1'), good.replace('# fail 0', '# fail 1')]) assert.throws(() => validateTap(invalid, 10), /TAP/);
  assert.throws(() => validateTap(good, 11), /TAP/);
});
