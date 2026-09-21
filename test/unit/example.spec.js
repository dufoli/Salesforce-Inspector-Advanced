/* eslint-env node */
// Proves the mocking mechanism end-to-end: loads a real extension page (limits.html) with
// its Salesforce network call intercepted (test/unit/mock-route.js) and asserts on the
// actually rendered DOM, with no real org and no changes to addon/inspector.js.
"use strict";
const {test, expect} = require("./fixtures.js");
const {createMockRouteHandler} = require("./mock-route.js");
const mock = require("./mocks/example.mock.js");

const sfHost = "mock.my.salesforce.com";

test("limits page renders mocked org limits", async ({page, context, extensionId}) => {
  const mockHandler = createMockRouteHandler(mock.responses, {baseDir: mock.baseDir, fallback: mock.fallback});
  await context.route("**/services/**", mockHandler.handle);

  // Seed the access token so sfConn.getSession() (addon/inspector.js) skips the interactive
  // OAuth/cookie flow, and the org-info cache so it skips its own untracked background
  // "SELECT IsSandbox, InstanceName" call, which would otherwise race the mock queue above.
  await page.addInitScript(host => {
    localStorage.setItem(`${host}_access__token`, "mock-access-token");
    localStorage.setItem(`${host}_isSandbox`, "false");
    localStorage.setItem(`${host}_orgInstance`, "MOCK");
  }, sfHost);

  await page.goto(`chrome-extension://${extensionId}/limits.html?host=${sfHost}`);

  await expect(page.getByText("Daily Api Requests")).toBeVisible();
  await expect(page.getByText("60 of 100 consumed")).toBeVisible();
  await expect(page.getByText("(40 left)")).toBeVisible();

  expect(mockHandler.errors).toEqual([]);
});
