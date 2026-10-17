import { test } from "node:test";
import assert from "node:assert/strict";
import { hostnameMatches, isOriginAllowed, normalizeDomain, parseOrigin } from "./domains.js";

test("normalizeDomain strips scheme, port, path and case", () => {
  assert.equal(normalizeDomain("https://Docs.Example.com:8443/help"), "docs.example.com");
  assert.equal(normalizeDomain("  example.com.  "), "example.com");
  assert.equal(normalizeDomain("*.Example.com"), "*.example.com");
  assert.equal(normalizeDomain(null), "");
});

test("parseOrigin rejects missing, null and non-http origins", () => {
  assert.equal(parseOrigin(undefined), null);
  assert.equal(parseOrigin("null"), null);
  assert.equal(parseOrigin("file:///tmp/a.html"), null);
  assert.equal(parseOrigin("not a url"), null);
  assert.deepEqual(parseOrigin("https://Example.com"), { protocol: "https:", hostname: "example.com" });
});

test("exact hostnames match only themselves", () => {
  assert.equal(hostnameMatches("example.com", "example.com"), true);
  assert.equal(hostnameMatches("www.example.com", "example.com"), false);
  assert.equal(hostnameMatches("badexample.com", "example.com"), false);
});

test("wildcards match subdomains only, never the bare domain", () => {
  assert.equal(hostnameMatches("docs.example.com", "*.example.com"), true);
  assert.equal(hostnameMatches("a.b.example.com", "*.example.com"), true);
  assert.equal(hostnameMatches("example.com", "*.example.com"), false);
  assert.equal(hostnameMatches("evilexample.com", "*.example.com"), false);
  assert.equal(hostnameMatches("example.com.evil.io", "*.example.com"), false);
});

test("isOriginAllowed requires https except for localhost, and ignores ports", () => {
  const list = ["example.com", "*.example.org", "localhost"];
  assert.equal(isOriginAllowed("https://example.com", list), true);
  assert.equal(isOriginAllowed("https://example.com:8443", list), true);
  assert.equal(isOriginAllowed("http://example.com", list), false);
  assert.equal(isOriginAllowed("https://help.example.org", list), true);
  assert.equal(isOriginAllowed("http://localhost:3000", list), true);
  assert.equal(isOriginAllowed("http://localhost:3000", ["example.com"]), false);
  assert.equal(isOriginAllowed("https://other.com", list), false);
});

test("an empty or missing allow-list blocks everything", () => {
  assert.equal(isOriginAllowed("https://example.com", []), false);
  assert.equal(isOriginAllowed("https://example.com", null), false);
  assert.equal(isOriginAllowed(null, ["example.com"]), false);
});
