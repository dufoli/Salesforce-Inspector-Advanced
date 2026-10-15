/* eslint-env node */
// This script sets up a development environment of Salesforce Inspector.
// Release builds use a different method.
// This script must be run through "npm run" so the PATH includes NPM dependencies.
"use strict";
const fs = require("fs-extra");

let browser = process.argv[2];
if (browser != "firefox" && browser != "chrome") {
  throw new Error("Unknown browser: " + browser);
}

// Always copy the browser specific manifest, so a previous build for the other browser never leaks into this one.
fs.copySync(`addon/manifest-${browser}.json`, "addon/manifest.json");
