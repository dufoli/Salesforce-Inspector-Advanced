/* eslint-env node */
// Runs the in-browser unit test suite (addon/test-framework.js) headlessly, for use in CI.
// It loads the unpacked extension into headless Chromium via Playwright, points it at a
// Salesforce org, and fails the process if the suite reports an error.
//
// Required env vars:
//   SF_HOST          My Domain hostname of the org to test against, e.g. "my-org.my.salesforce.com"
//   SF_ACCESS_TOKEN  A valid Salesforce access token (bearer) for that org
// Optional env vars:
//   SF_TESTS         Comma-separated list of test suites to run (see availableTests in test-framework.js).
//                     Defaults to running all suites.
//   HEADLESS         Set to "false" to run with a visible browser window, for local debugging.
"use strict";
const path = require("path");
const fs = require("fs");
const os = require("os");
const {chromium} = require("playwright");

const addonPath = path.resolve(__dirname, "..", "addon");
const manifestPath = path.join(addonPath, "manifest.json");
const resultTimeoutMs = 10 * 60 * 1000;

async function main() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error("addon/manifest.json not found. Run \"npm run chrome-dev-build\" first.");
  }

  const sfHost = process.env.SF_HOST;
  const accessToken = process.env.SF_ACCESS_TOKEN;
  if (!sfHost || !accessToken) {
    throw new Error("SF_HOST and SF_ACCESS_TOKEN environment variables are required.");
  }
  const tests = process.env.SF_TESTS;
  const headless = process.env.HEADLESS !== "false";

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfi-ext-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      "--headless=new",
      `--disable-extensions-except=${addonPath}`,
      `--load-extension=${addonPath}`
    ]
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", {timeout: 30000});
    }
    const extensionId = new URL(serviceWorker.url()).host;

    const page = await context.newPage();
    page.on("console", msg => console.log(`[browser] ${msg.text()}`));
    page.on("pageerror", err => console.error("[browser error]", err));

    // Seed the access token so sfConn.getSession() (addon/inspector.js) finds an existing
    // "<sfHost>_access__token" entry in localStorage and skips the interactive OAuth/cookie flow.
    await page.addInitScript(({host, token}) => {
      localStorage.setItem(`${host}_access__token`, token);
    }, {host: sfHost, token: accessToken});

    const params = new URLSearchParams({host: sfHost});
    if (tests) {
      params.set("tests", tests);
    }
    await page.goto(`chrome-extension://${extensionId}/test-framework.html?${params}`);

    await page.waitForFunction(
      () => window.result && window.result.textContent.length > 0,
      null,
      {timeout: resultTimeoutMs}
    );

    const {text, background} = await page.evaluate(() => ({
      text: window.result.textContent,
      background: window.result.style.background
    }));

    console.log(text);
    if (!background.includes("green")) {
      throw new Error("Unit tests failed: " + text);
    }
  } finally {
    await context.close();
    fs.rmSync(userDataDir, {recursive: true, force: true});
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
