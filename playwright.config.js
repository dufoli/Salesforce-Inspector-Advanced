/* eslint-env node */
"use strict";
const {defineConfig} = require("@playwright/test");

// Mocked, network-independent extension tests (test/unit/). The real-org suite
// (addon/test-framework.js) is driven separately by scripts/run-unit-tests.js.
module.exports = defineConfig({
  testDir: "./test/unit",
  timeout: 30000,
  retries: 0,
  reporter: [["list"], ["html", {outputFolder: "playwright-report", open: "never"}]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  }
});
