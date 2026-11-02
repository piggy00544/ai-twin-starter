import { readFile, writeFile, mkdtemp, mkdir, cp, symlink, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve, relative, delimiter, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCompatibility } from './compatibility.mjs';
import { runInSandbox, verifySandbox } from './ci-sandbox.mjs';
const exec = promisify(execFile);
const source = fileURLToPath(new URL('../', import.meta.url));
export async function planSdk(args) {
  if (args.length < 2 || args.length > 3 || args[0] !== '--sdk' || args.length === 3 && args[2] !== '--plan') throw Error('Usage: node scripts/ci-sdk.mjs --sdk EXACT_VERSION [--plan]');
  const metadata = JSON.parse(await readFile(join(source, 'package.json')));
  const sdk = validateCompatibility(metadata, args[1]);
  const dependencies = { ...metadata.dependencies, ...metadata.devDependencies };
  for (const name of Object.keys(dependencies)) if (name.startsWith('@deepseek-ai/dsh-')) dependencies[name] = sdk;
  for (const name of Object.keys(metadata.peerDependencies ?? {})) if (name.startsWith('@deepseek-ai/dsh-')) dependencies[name] = sdk;
  for (const name of ['dsh-storage', 'dsh-storage-domain', 'dsh-storage-json', 'dsh-client-connection']) dependencies['@deepseek-ai/' + name] = sdk;
  // Retain Finder's measured VM-fixture suite baseline; all other Node processes stay at 128 MB.
  const suiteHeapMb = metadata.name === '@oxmumu3/dsh-plugin-finder' ? 512 : 128;
  const minimumTests = metadata.name === '@oxmumu3/dsh-plugin-finder' ? 763 : 256;
  return { sdk, dependencies, suiteHeapMb, minimumTests, otherNodeHeapMb: 128, compatibilityOverride: false, hooks: false };
}
export function validateTap(text, minimumTests) {
  const counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)].map(([, key, value]) => [key, Number(value)]));
  if (!Number.isSafeInteger(minimumTests) || minimumTests < 1 || !Number.isSafeInteger(counts.tests) || counts.tests < minimumTests
    || counts.pass !== counts.tests || ['fail', 'skipped', 'cancelled', 'todo'].some(key => counts[key] !== 0)) throw Error('TAP suite incomplete, skipped, cancelled or failed');
  return counts;
}
async function main() {
  const plan = await planSdk(process.argv.slice(2));
  if (process.argv[4] === '--plan') { console.log(JSON.stringify(plan)); return; }
  process.umask(0o077);
  const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-ci-'));
  const home = join(root, 'home'), carrier = join(root, 'carrier'), stage = join(root, 'source');
  const output = process.env.DSH_CI_OUTPUT ? resolve(process.env.DSH_CI_OUTPUT) : join(root, 'results');
  const inside = relative(source, output);
  if (!inside || !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep)) throw Error('CI results must be outside the source tree');
  for (const directory of [home, carrier, output]) await mkdir(directory, { recursive: true });
  const env = { PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ''), HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), DSH_HOME: join(home, 'dsh'), DSH_AGENTS_HOME: join(home, 'agents'), TMPDIR: root, TMP: root, TEMP: root, LANG: 'en_US.UTF-8', TZ: 'UTC', CI: 'true', NPM_CONFIG_USERCONFIG: join(home, 'npmrc-user'), NPM_CONFIG_GLOBALCONFIG: join(home, 'npmrc-global'), NPM_CONFIG_CACHE: join(root, 'npm-cache'), NPM_CONFIG_IGNORE_SCRIPTS: 'true', DSH_TELEMETRY_DISABLED: '1', DSH_TEST_SDK_VERSION: plan.sdk, NODE_OPTIONS: '--max-old-space-size=128' };
  await writeFile(env.NPM_CONFIG_USERCONFIG, ''); await writeFile(env.NPM_CONFIG_GLOBALCONFIG, '');
  await writeFile(join(carrier, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: plan.dependencies }, null, 2) + '\n');
  const run = async (command, args, cwd, runtime, log, timeout, sandbox = false) => {
    try {
      const options = { cwd, env: runtime, timeout, maxBuffer: 4 * 1024 * 1024 };
      const result = sandbox ? await runInSandbox(command, args, options) : await exec(command, args, options);
      await writeFile(join(output, log), result.stdout + result.stderr); return result;
    } catch (error) {
      await writeFile(join(output, log), String(error.stdout ?? '') + String(error.stderr ?? ''));
      throw Error(`${log} failed (${error.code ?? error.signal ?? 'unknown'}); see the bounded CI artifact`);
    }
  };
  // Exact public dependencies only; no repository/user npm config or lifecycle hooks.
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--registry=https://registry.npmjs.org/'], carrier, env, 'dependency-install.log', 180000);
  for (const [name, version] of Object.entries(plan.dependencies)) if (name.startsWith('@deepseek-ai/dsh-')) {
    const actual = JSON.parse(await readFile(join(carrier, 'node_modules', name, 'package.json'))).version;
    if (actual !== version) throw Error('Resolved SDK drift: ' + name);
  }
  await cp(source, stage, { recursive: true, filter: filename => !['.git', 'node_modules', 'ci-results'].includes(relative(source, filename).split(/[\\/]/)[0]) });
  await symlink(join(carrier, 'node_modules'), join(stage, 'node_modules'), 'junction');
  const runtime = { ...env, NODE_OPTIONS: '--max-old-space-size=128 --import=' + pathToFileURL(join(stage, 'scripts/ci-network.mjs')).href };
  const osSandbox = await verifySandbox({ cwd: stage, env: runtime });
  await writeFile(join(output, 'network-proof.json'), JSON.stringify(osSandbox, null, 2) + '\n');
  const tests = (await readdir(join(stage, 'test'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => 'test/' + name);
  const suite = await run(process.execPath, ['--max-old-space-size=' + plan.suiteHeapMb, '--test', '--test-concurrency=1', ...tests], stage, runtime, 'suite.tap', 240000, true);
  const counts = validateTap(suite.stdout, plan.minimumTests);
  const contract = await run(process.execPath, ['--max-old-space-size=128', 'scripts/ci-host-contract.mjs'], stage, runtime, 'host-contract.log', 45000, true);
  const hostContract = JSON.parse(contract.stdout);
  if (!hostContract.actualCordis || !hostContract.actualHostConnectionDispatcher || !hostContract.disposeAndReenable || hostContract.network?.denied !== 0 || hostContract.realModelCalls !== 0 || hostContract.realMessagesSent !== 0) throw Error('Real SDK Host contract did not provide complete evidence');
  const summary = { sdk: plan.sdk, passed: true, exactSdkDependencies: true, testFiles: tests.length, osSandbox, hostContract, counts, minimumTests: plan.minimumTests, hooks: false, compatibilityOverride: false, syntheticHome: true, productionProfileUsed: false, realModelCalls: 0, realMessagesSent: 0, runtimeNonLoopbackAllowed: false, suiteMaxOldSpaceMb: plan.suiteHeapMb, otherNodeHeapMb: 128, suiteTimeoutMs: 240000, dependencyAcquisition: 'public npm registry, without hooks', output };
  await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n'); console.log(JSON.stringify(summary));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
