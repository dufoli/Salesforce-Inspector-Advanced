/* eslint-env node */
// Runs the in-browser unit test suite (addon/test-framework.js) headlessly against a real
// Salesforce org, for use in CI. It loads the unpacked extension into headless Chromium via
// Playwright and fails the process if the suite reports an error.
//
// Mocked, network-independent tests are separate: see test/unit/ (run via "npm run test:mocked",
// a real @playwright/test suite), not this script.
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
const failureDir = path.resolve(__dirname, "..", "test-results");

async function saveFailureArtifacts(page, consoleLog) {
  fs.mkdirSync(failureDir, {recursive: true});
  fs.writeFileSync(path.join(failureDir, "console.log"), consoleLog.join("\n"));
  await page.screenshot({path: path.join(failureDir, "failure.png"), fullPage: true}).catch(() => {});
}

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
    // headless:true alone launches the extension-less "chrome-headless-shell" binary.
    // channel:"chromium" forces the full Chromium build, which supports extensions
    // when combined with the new headless mode below.
    channel: "chromium",
    headless,
    args: [
      "--headless=new",
      `--disable-extensions-except=${addonPath}`,
      `--load-extension=${addonPath}`
    ]
  });

  const consoleLog = [];
  let page;
  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", {timeout: 30000});
    }
    const extensionId = new URL(serviceWorker.url()).host;

    page = await context.newPage();
    page.on("console", msg => {
      const line = `[browser] ${msg.text()}`;
      consoleLog.push(line);
      console.log(line);
    });
    page.on("pageerror", err => {
      consoleLog.push(`[browser error] ${err}`);
      console.error("[browser error]", err);
    });

    // Seed the access token so sfConn.getSession() (addon/inspector.js) finds an existing
    // "<sfHost>_access__token" entry in localStorage and skips the interactive OAuth/cookie flow.
    // test-framework.js navigates its result iframe to a data: URL once done, where
    // localStorage throws - addInitScript runs on every navigation, so guard it.
    await page.addInitScript(({host, token}) => {
      try {
        localStorage.setItem(`${host}_access__token`, token);
      } catch {
        // Not a real page (e.g. a data: URL) - nothing to seed.
      }
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
  } catch (err) {
    if (page) {
      await saveFailureArtifacts(page, consoleLog);
    }
    throw err;
  } finally {
    await context.close();
    fs.rmSync(userDataDir, {recursive: true, force: true});
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
