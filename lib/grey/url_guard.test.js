import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UrlGuardError,
  assertPublicBaseUrl,
  assertPublicUrl,
  checkUrl,
  guardedFetch,
  isBlockedHostname,
  isIpAddress,
  isPrivateAddress,
  localProvidersAllowed,
  resolvedAddressesArePublic,
} from "./url_guard.js";

const resolveTo = (...addresses) => async () => addresses.map((address) => ({ address }));
const rejectsCode = (promise, code) =>
  assert.rejects(promise, (err) => err instanceof UrlGuardError && err.code === code);

test("private IPv4 ranges", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("private IPv6 ranges, including embedded IPv4", () => {
  for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "2002:c0a8:0101::1", "2001:db8::1", "[::1]", "fe80::1%eth0", "::127.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  // Teredo and local-use NAT64 hide or route to arbitrary addresses.
  for (const ip of ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "64:ff9b:1::a00:1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress("not-an-ip"), true);
  assert.equal(isIpAddress("1:2:3:4:5:6:7:8"), true);
  assert.equal(isIpAddress("1:2:3:4:5:6:7:8:9"), false);
  assert.equal(isIpAddress("example.com"), false);
});

test("IPv4-mapped / translated IPv6 and carrier-grade NAT", () => {
  // Every spelling of an IPv4-mapped address takes the embedded IPv4's verdict.
  for (const ip of ["::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:7f00:1", "[::ffff:192.168.0.1]", "::ffff:100.64.0.1", "::ffff:0:10.0.0.1", "::ffff:0:a00:1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["::ffff:5db8:d822", "::ffff:0:8.8.8.8"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  // 100.64.0.0/10 boundaries.
  for (const ip of ["100.64.0.0", "100.100.100.200", "100.127.255.255"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["100.63.255.255", "100.128.0.0"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("connect-time decision: every resolved address must be public", () => {
  assert.equal(resolvedAddressesArePublic([{ address: "93.184.216.34", family: 4 }, { address: "2606:4700::1", family: 6 }]), true);
  assert.equal(resolvedAddressesArePublic(["8.8.8.8"]), true);
  assert.equal(resolvedAddressesArePublic([{ address: "8.8.8.8" }, { address: "::ffff:127.0.0.1" }]), false, "one private entry rejects the answer");
  assert.equal(resolvedAddressesArePublic([{ address: "100.64.1.1" }]), false);
  assert.equal(resolvedAddressesArePublic([{ address: "fd00::1" }]), false);
  assert.equal(resolvedAddressesArePublic([]), false);
  assert.equal(resolvedAddressesArePublic([{}]), false);
});

test("local providers are allowed only in development or by explicit opt-in", () => {
  assert.equal(localProvidersAllowed({ NODE_ENV: "development" }), true);
  assert.equal(localProvidersAllowed({ GREY_ALLOW_LOCAL_PROVIDERS: "1" }), true);
  assert.equal(localProvidersAllowed({ NODE_ENV: "production", GREY_ALLOW_LOCAL_PROVIDERS: "1" }), true);
  // Fails closed: production, test, unset NODE_ENV and other opt-in spellings are strict.
  for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "test" }, { GREY_ALLOW_LOCAL_PROVIDERS: "true" }, { GREY_ALLOW_LOCAL_PROVIDERS: "0" }, undefined]) {
    assert.equal(localProvidersAllowed(env), false, JSON.stringify(env));
  }
});

test("blocked hostnames", () => {
  for (const host of ["localhost", "api.localhost", "metadata.google.internal", "printer.local", "LOCALHOST.", "127.0.0.1", "[::1]", ""]) {
    assert.equal(isBlockedHostname(host), true, host);
  }
  assert.equal(isBlockedHostname("api.openai.com"), false);
  assert.equal(isBlockedHostname("8.8.8.8"), false);
});

test("URL shape checks", () => {
  assert.throws(() => checkUrl("not a url"), (e) => e.code === "invalid_url");
  assert.throws(() => checkUrl("ftp://example.com"), (e) => e.code === "unsupported_scheme");
  assert.throws(() => checkUrl("file:///etc/passwd"), (e) => e.code === "unsupported_scheme");
  assert.throws(() => checkUrl("http://example.com", { allowHttp: false }), (e) => e.code === "https_required");
  assert.throws(() => checkUrl("https://user:pw@example.com"), (e) => e.code === "credentials_in_url");
  // The WHATWG parser normalises decimal/hex IPv4 forms before the check.
  assert.throws(() => checkUrl("http://2130706433/"), (e) => e.code === "blocked_host");
  assert.throws(() => checkUrl("http://0x7f.1/"), (e) => e.code === "blocked_host");
  assert.equal(checkUrl("http://localhost:11434/v1", { allowLocal: true }).port, "11434");
  assert.equal(checkUrl("https://example.com/a").hostname, "example.com");
});

test("DNS results are checked", async () => {
  await rejectsCode(assertPublicUrl("https://rebind.example.com", { lookup: resolveTo("10.0.0.5") }), "private_address");
  await rejectsCode(assertPublicUrl("https://mixed.example.com", { lookup: resolveTo("8.8.8.8", "::1") }), "private_address");
  await rejectsCode(assertPublicUrl("https://nx.example.com", { lookup: async () => { throw new Error("ENOTFOUND"); } }), "dns_failed");
  await rejectsCode(assertPublicUrl("https://empty.example.com", { lookup: async () => [] }), "dns_failed");
  const ok = await assertPublicUrl("https://ok.example.com/path", { lookup: resolveTo("93.184.216.34") });
  assert.equal(ok.pathname, "/path");
  // Literal public IPs skip DNS.
  await assertPublicUrl("https://8.8.8.8", { lookup: async () => { throw new Error("should not resolve"); } });
});

test("base URLs: https + public by default, localhost only with allowLocal", async () => {
  await rejectsCode(assertPublicBaseUrl("http://api.example.com/v1", { lookup: resolveTo("8.8.8.8") }), "https_required");
  await rejectsCode(assertPublicBaseUrl("https://localhost:8000/v1"), "blocked_host");
  await rejectsCode(assertPublicBaseUrl("https://[::ffff:10.0.0.1]/v1"), "blocked_host");
  await rejectsCode(assertPublicBaseUrl("https://cgnat.example.com/v1", { lookup: resolveTo("100.64.0.9") }), "private_address");
  assert.equal(await assertPublicBaseUrl("http://localhost:11434/v1/", { allowLocal: true }), "http://localhost:11434/v1");
  assert.equal(await assertPublicBaseUrl("https://api.example.com/v1", { lookup: resolveTo("8.8.8.8") }), "https://api.example.com/v1");
});

test("guardedFetch re-checks each redirect hop", async () => {
  const lookup = async (host) => [{ address: host === "evil.example.com" ? "169.254.169.254" : "93.184.216.34" }];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.method, init.redirect]);
    if (url === "https://start.example.com/") return new Response(null, { status: 302, headers: { location: "https://next.example.com/doc" } });
    if (url === "https://next.example.com/doc") return new Response("ok", { status: 200 });
    if (url === "https://bad.example.com/") return new Response(null, { status: 301, headers: { location: "http://evil.example.com/latest" } });
    return new Response(null, { status: 302, headers: { location: url } });
  };
  const res = await guardedFetch("https://start.example.com/", { method: "GET" }, { fetch: fetchImpl, lookup });
  assert.equal(await res.text(), "ok");
  assert.deepEqual(calls[0], ["https://start.example.com/", "GET", "manual"]);
  await rejectsCode(guardedFetch("https://bad.example.com/", {}, { fetch: fetchImpl, lookup }), "private_address");
  await rejectsCode(guardedFetch("https://loop.example.com/", {}, { fetch: fetchImpl, lookup, maxRedirects: 2 }), "too_many_redirects");
});
