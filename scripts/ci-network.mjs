// Process-level denial for the Node runtime and every Node child via NODE_OPTIONS.
// Dependency acquisition happens separately, without product code or credentials.
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
const proof = { denied: 0, nonLoopbackAllowed: false };
const local = host => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host).toLowerCase());
const deny = host => { proof.denied++; throw Error('CI_NETWORK_DENIED: ' + host); };
const check = host => { if (!local(host)) deny(host); };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  check(url.hostname); return originalFetch(input, options);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') { if (!first.path) check(first.host ?? 'localhost'); }
  else if (typeof first !== 'string') check(typeof args[1] === 'string' ? args[1] : 'localhost');
  return connect.apply(this, args);
};
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  check(typeof args[0] === 'object' ? args[0].host ?? args[0].servername ?? 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost');
  return tlsConnect.apply(this, args);
};
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
  if (typeof dns[name] === 'function') { const original = dns[name]; dns[name] = function (host, ...args) { check(host); return original.call(this, host, ...args); }; }
  if (typeof dns.promises[name] === 'function') { const original = dns.promises[name]; dns.promises[name] = async function (host, ...args) { check(host); return original.call(this, host, ...args); }; }
}
const udpConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function (port, host = 'localhost', ...args) { check(host); this.__dshCiLocalPeer = true; return udpConnect.call(this, port, host, ...args); };
const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (...args) {
  const host = typeof args[4] === 'string' ? args[4] : typeof args[2] === 'string' ? args[2] : args[1]?.address;
  if (host !== undefined) check(host); else if (!this.__dshCiLocalPeer) deny('unknown datagram peer');
  return send.apply(this, args);
};
syncBuiltinESMExports();
globalThis.__dshCiNetwork = proof;
