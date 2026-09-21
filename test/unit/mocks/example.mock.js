/* eslint-env node */
// Example mock sequence for test/unit/example.spec.js: addon/limits.js makes exactly one
// REST call on load (GET .../limits), served here from a fixture file rather than inline,
// to demonstrate the bodyFile option (see test/unit/mock-route.js).
"use strict";

module.exports = {
  baseDir: __dirname,
  responses: [
    {
      status: 200,
      bodyFile: "../fixtures/example-limits.json"
    }
  ],
  // Every page also loads the floating Inspector button, which makes a few of its own
  // incidental calls (see test/unit/mock-route.js) - not relevant to this example, so any
  // such call gets this empty response instead of failing the test.
  fallback: {status: 200, body: {}}
};
