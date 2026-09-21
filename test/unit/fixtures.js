/* eslint-env node */
// Playwright fixture that loads the unpacked extension (addon/) in a persistent Chromium
// context, following Playwright's own recipe for testing browser extensions. Specs get a
// "context" already running the extension and an "extensionId" to build chrome-extension:// URLs.
"use strict";
const path = require("path");
const base = require("@playwright/test");

const addonPath = path.resolve(__dirname, "..", "..", "addon");

const test = base.test.extend({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern here
  context: async ({}, use) => {
    const context = await base.chromium.launchPersistentContext("", {
      // headless:true alone launches the extension-less "chrome-headless-shell" binary.
      // channel:"chromium" forces the full Chromium build, which supports extensions
      // when combined with the new headless mode below.
      channel: "chromium",
      headless: process.env.HEADLESS === "false" ? false : true,
      args: [
        "--headless=new",
        `--disable-extensions-except=${addonPath}`,
        `--load-extension=${addonPath}`
      ]
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({context}, use) => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", {timeout: 30000});
    }
    await use(new URL(serviceWorker.url()).host);
  }
});

module.exports = {test, expect: base.expect};
