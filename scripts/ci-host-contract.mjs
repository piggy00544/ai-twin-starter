import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import { Storage } from '@deepseek-ai/dsh-storage';
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json';
import * as plugin from '../index.js';
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const finder = metadata.name.endsWith('finder');
const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-host-contract-')));
const ctx = new Context();
// No browser/account auth is created: the official service's same-process owner
// peer exercises its real dispatcher. All state lives in this synthetic directory.
const connection = new HostConnectionService(ctx, [], { isAuthenticated: () => false, authenticateApi: () => undefined });
const dispatcher = connection.createSharedFetchHandler('/api');
const request = (path, options) => new Request('http://127.0.0.1' + path, options);
const dispatch = (path, peer = connection.browserPeer, options) => dispatcher.fetch(request(path, options), peer);
let backend, facility, tools;
try {
  assert.equal(globalThis.__dshCiNetwork?.nonLoopbackAllowed, false, 'Network denial preload is required');
  if (finder) {
    const storage = new Storage(ctx); backend = new JsonStorageBackend(directory);
    storage.backend.register('ci-json', backend); facility = new DomainFacility(ctx, { backend: 'ci-json' });
    ctx.provide('storageDomain', facility);
  } else {
    // Only prompt presentation is synthetic; registration/lookup/disposal use
    // the official ToolRuntime and Cordis service, without dispatching a tool.
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 });
    const { ToolRuntime } = await import('@deepseek-ai/dsh-tools'); tools = new ToolRuntime(ctx);
    ctx.provide('workspaceRegistry', { list: () => [] });
    ctx.provide('sessionController', { create: () => assert.fail('No Session creation in compatibility CI') });
  }
  const path = finder ? '/api/plugin_finder/bootstrap' : '/api/agent_twin/status';
  for (let mount = 0; mount < 2; mount++) {
    const fiber = ctx.plugin(plugin, finder ? {} : { stateDirectory: directory }); await fiber;
    if (!finder) {
      const children = [...ctx.registry.entries()].flatMap(([, runtime]) => [...runtime.fibers]).filter(child => child.parent.fiber.uid === fiber.uid);
      assert.equal(children.length, 1); await children[0]; assert.equal(children[0].state, 2);
    }
    const response = await dispatch(path); assert.equal(response.status, 200, await response.clone().text());
    const state = await response.json();
    if (finder) {
      assert.equal(state.hostVersion, process.env.DSH_TEST_SDK_VERSION);
      assert.equal(state.telemetry.enabled, false); assert.equal(state.workflow ?? null, null);
      const domain = facility.get('plugin_finder'); assert.ok(domain);
      await domain.table('feedback').put('entries', { id: 'entries', rows: [] });
      assert.equal((await domain.table('feedback').get('entries')).id, 'entries');
    } else {
      assert.equal(state.service.enabled, false); assert.equal(state.project, null); assert.ok(tools.get('agent_twin'));
    }
    assert.equal((await dispatch(path, { principal: { kind: 'synthetic-non-owner' } })).status, 403);
    assert.equal((await dispatch(path, connection.browserPeer, { method: 'DELETE' })).status, 404);
    await fiber.dispose(); assert.equal((await dispatch(path)).status, 404);
    if (!finder) assert.equal(tools.get('agent_twin'), undefined);
  }
  assert.equal(globalThis.__dshCiNetwork.denied, 0);
  console.log(JSON.stringify({ package: metadata.name, sdk: process.env.DSH_TEST_SDK_VERSION, actualCordis: true, actualHostConnectionDispatcher: true, actualJsonDomainPersistence: finder, actualToolRuntime: !finder, disposeAndReenable: true, ownerRoute: 200, otherPrincipal: 403, unsupportedMethod: 404, removedRoute: 404, realModelCalls: 0, realMessagesSent: 0, network: globalThis.__dshCiNetwork }));
} finally { await ctx.fiber.dispose(); await facility?.closeAll(); await backend?.close(); await rm(directory, { recursive: true, force: true }); }
