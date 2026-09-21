/* eslint-env node */
// Turns an ordered list of canned responses into a Playwright route handler.
// All Salesforce calls in the extension go through sfConn (addon/inspector.js),
// which uses plain XMLHttpRequest - so intercepting at the network layer with
// Playwright's context.route() lets tests run without a real org, with zero
// changes to the extension code.
"use strict";
const fs = require("fs");
const path = require("path");

// responses: ordered array of {status?, headers?, contentType?, body?, bodyFile?}.
// Each intercepted request consumes the next entry, in call order. bodyFile is
// resolved relative to baseDir (pass the mock definition file's __dirname).
//
// Every extension page also injects the floating Inspector button (addon/button.js's
// initButton), which loads its own popup.html iframe and independently preloads the
// object list (global + tooling describe, entity definition count, org info) - so most
// pages make a few extra, incidental network calls beyond the ones the page itself needs.
// Pass `fallback` to serve those (and any other call past the end of the queue) without
// failing the test; omit it to fail loudly on any unaccounted-for call instead.
function createMockRouteHandler(responses, {baseDir = process.cwd(), fallback} = {}) {
  const queue = responses.slice();
  const errors = [];
  const extraCalls = [];

  function resolveBody(entry) {
    let body = entry.bodyFile ? fs.readFileSync(path.resolve(baseDir, entry.bodyFile)) : entry.body;
    if (body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body)) {
      body = JSON.stringify(body);
    }
    return body;
  }

  async function handle(route) {
    const request = route.request();
    const next = queue.shift();
    if (!next) {
      if (fallback) {
        extraCalls.push(`${request.method()} ${request.url()}`);
        await route.fulfill({
          status: fallback.status ?? 200,
          headers: fallback.headers,
          contentType: fallback.contentType ?? "application/json",
          body: resolveBody(fallback)
        });
        return;
      }
      const message = `No mock response left for ${request.method()} ${request.url()}`;
      console.error(`[mock] ${message}`);
      errors.push(message);
      await route.fulfill({status: 599, contentType: "text/plain", body: message});
      return;
    }
    await route.fulfill({
      status: next.status ?? 200,
      headers: next.headers,
      contentType: next.contentType ?? "application/json",
      body: resolveBody(next)
    });
  }

  return {handle, errors, extraCalls, remaining: () => queue.length};
}

module.exports = {createMockRouteHandler};
