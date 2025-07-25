<img src="https://github.com/dufoli/Salesforce-Inspector-Advanced/blob/master/addon/icon128.png?raw=true" align="right">

# Salesforce inspector advanced

![GitHub release](https://img.shields.io/github/v/release/dufoli/Salesforce-Inspector-reloaded?sort=semver)
[![Chrome Web Store Installs](https://img.shields.io/chrome-web-store/users/dbfimaflmomgldabcphgolbeoamjogji)](https://chromewebstore.google.com/detail/salesforce-inspector-adva/dbfimaflmomgldabcphgolbeoamjogji)
[![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/dbfimaflmomgldabcphgolbeoamjogji)](https://chromewebstore.google.com/detail/salesforce-inspector-adva/dbfimaflmomgldabcphgolbeoamjogji)
[![GitHub stars](https://img.shields.io/github/stars/dufoli/Salesforce-Inspector-reloaded?cacheSeconds=3600)](https://github.com/dufoli/Salesforce-Inspector-Advanced/stargazers/)
[![GitHub contributors](https://img.shields.io/github/contributors/dufoli/Salesforce-Inspector-reloaded.svg)](https://github.com/dufoli/Salesforce-Inspector-Advanced/graphs/contributors/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Chrome and Firefox extension to add a metadata layout on top of the standard Salesforce UI to improve the productivity and joy of Salesforce configuration, development, and integration work.

We all know and love Salesforce Inspector: As the great Søren Krabbe did not have the time to maintain it anymore. Thomas Prouvot decided to take over and fork the original project but I do not share the same vision of him.

My goal are :

- to have fun 😉 because open source is fun 🎉!
- to achieve functionnal goals:
  - kill dev console needs with SOSL, apex runner, debugger, profiler, static ressource support
  - streaming API monitoring
  - better suggestions in data export, import and inspect
  - switch to a real editor instead of textarea : (color text, suggestion over text,...)
  - flow improvment: cleanup old flow versions, debug custom lwc reactive, better naviguation, detect DML before callout in transaction, detect DML, SOQL in loop,... 
  - monitor external package version are up to date
- to achieve some technical goals:
  - Avoid dom and have only react components
  - switch to up to date version of dependencies
  - have CI/CD build with unit test/integration test in build
  - switch to typescript

So I decided to fork on a new project in a more collaborative way.

The goal of this project is to focus on improving key features for administrator: export, import and inspect.
Then add new features to make life easier and avoid API call.
In order to rich this goal, I have take a closer look to the full backlog of original project and from collegues, friends who work on salesforce but I need feedback from community.

- [Salesforce inspector advanced](#salesforce-inspector-advanced)
  - [Roadmap](#roadmap)
  - [Documentation](#documentation)
  - [New features compared to SF Inspector Reloaded](#new-features-compared-to-sf-inspector-reloaded)
  - [Security and Privacy](#security-and-privacy)
  - [Use Salesforce Inspector with a Connected App](#use-salesforce-inspector-with-a-connected-app)
  - [Installation](#installation)
    - [Browser Stores](#browser-stores)
    - [Local Installation](#local-installation)
  - [Troubleshooting](#troubleshooting)
  - [Contributions](#contributions)
  - [Development](#development)
    - [Chrome](#chrome)
    - [Firefox](#firefox)
    - [Unit tests](#unit-tests)
    - [Linting](#linting)
  - [Design Principles](#design-principles)
  - [About](#about)
  - [License](#license)

## Roadmap

> [!IMPORTANT]
> Roadmap is here : https://github.com/dufoli/Salesforce-Inspector-Advanced/milestones

## Documentation

> [!NOTE]
> User guide for using the extension.

[![view - Documentation](https://img.shields.io/badge/view-Documentation-blue?style=for-the-badge)](https://dufoli.github.io/Salesforce-Inspector-Advanced/ "Go to extension documentation")

## New features compared to SF Inspector Reloaded

- Export SOQL: suggest in subquery, field valud with IN/LIKE, format query, respect order of column, Download CSV file
- Export SOSL
- Inspect: suggest value for picklist
- Import: assignment rules
- Apex Runner: execute batch, enqueue job or just anonymous code, poll log, auto suggest className, 
- Log: profiler, search with autoscroll, download
- Streaming : Manage and monitor plateform event

## Security and Privacy

The Salesforce Inspector browser extension/plugin communicates directly between the user's web browser and the Salesforce servers. No data is sent to other parties and no data is persisted outside of Salesforce servers after the user leaves the Salesforce Inspector pages.
The Inspector communicates via the official Salesforce webservice APIs on behalf of the currently logged in user. This means the Inspector will be capable of accessing nothing but the data and features the user has been granted access to in Salesforce.

All Salesforce API calls from the Inspector re-uses the access token/session used by the browser to access Salesforce. To acquire this access token the Salesforce Inspector requires permission to read browser cookie information for Salesforce domains.

To validate the accuracy of this description, inspect the source code, monitor the network traffic in your browser or take my word.

## Use Salesforce Inspector with a Connected App

Follow steps described in [how-to documentation](https://dufoli.github.io/Salesforce-Inspector-Advanced/how-to/#use-sf-inspector-with-a-connected-app). Note: you must complete these steps to use the extension in orgs where "API Access Control" is enabled.

## Installation

### Browser Stores

- [Chrome Web Store](https://chromewebstore.google.com/detail/salesforce-inspector-adva/dbfimaflmomgldabcphgolbeoamjogji)
- [Firefox Browser Add-ons](https://addons.mozilla.org/fr/firefox/addon/salesforce-inspector-advanced)
- Edge Add-ons : used chrome extension from edge store

### Local Installation

1. Download or clone the repo.
2. Checkout the master branch.
3. Open `chrome://extensions/`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the **`addon`** subdirectory of this repository.

## Troubleshooting

- If Salesforce Inspector is not available after installation, the most likely issue is that your browser is not up to date. See [instructions for Google Chrome](https://productforums.google.com/forum/#!topic/chrome/YK1-o4KoSjc).
- When you enable the My Domain feature in Salesforce, Salesforce Inspector may not work until you have restarted your browser (or until you have deleted the "sid" cookie for the old Salesforce domain by other means).

## Contributions

Contributions are welcome!

To submit a PR, please create a branch from master branch.
This branch will be taged when the new version is published on web store.

Make sure to update CHANGES.md file by describing the improvement / bugfix you realised.

In order to make sure everyone who reads documentation is aware of your improvement, you can update the 'how-to' page to document / expose this new functionality.

Linting : to assure indentation, formatting and best practices coherence, please install ESLint extension.

## Development

1. Install Node.js with npm
2. `npm install`

### Chrome

1. `npm run chrome-dev-build`
2. Open `chrome://extensions/`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select the `addon` subdirectory of this repository.

### Firefox

1. `npm run firefox-dev-build`
2. In Firefox, open `about:debugging`.
3. Click `Load Temporary Add-on…`.
4. Select the file `addon/manifest.json`.

### Unit tests

1. Set up an org (e.g. a Developer Edition) and apply the following customizations:
   1. Everything described in metadata in `test/`. Push to org with `sf deploy metadata -d test/ -o [your-test-org-alias]` or legacy `sfdx force:source:deploy -p test/ -u [your-test-org-alias]`.
   2. Make sure your user language is set to English.
   3. Ensure _Allow users to relate a contact to multiple accounts_ is enabled (Setup → Account Settings).
   4. Ensure the org has no _namespace prefix_ (Setup → Package Manager).
   5. Assign Permission Set `SfInspector` to your user.
2. Navigate to one of the extension pages and replace the file name with `test-framework.html`, for example `chrome-extension://example/test-framework.html?host=example.my.salesforce.com`.
3. Wait until "Salesforce Inspector unit test finished successfully" is shown.
4. If the test fails, open your browser's developer tools console to see error messages.

### Linting

1. `npm run eslint`

## Design Principles

(we don't live up to all of them. pull requests welcome)

- Stay completely inactive until the user explicitly interacts with it. The tool has the potential to break Salesforce functionality when used, since we rely on monkey patching and internal APIs. We must ensure that you cannot break Salesforce just by having the tool installed or enabled. For example, we won't fix the setup search placeholder bug.
- For manual ad-hoc tasks only. The tool is designed to help administrators and developers interact with Salesforce in the browser. It is after all a browser add-on. Enabling automation is a non-goal.
- User experience is important. Features should be intuitive and discoverable, but efficiency is more important than discoverability. More advanced features should be hidden, and primary features should be central. Performance is key.
- Automatically provide as much contextual information as possible, without overwhelming the user. Information that is presented automatically when needed is a lot more useful than information you need to explicitly request. For example, provide autocomplete for every input.
- Provide easy access to the raw Salesforce API. Enhance the interaction in a way that does not break the core use case, if our enhancements fails. For example, ensure we can display the result of a data export even if we cannot parse the SOQL query.
- It is fine to implement features that are already available in the core Salesforce UI, if we can make it easier, smarter or faster.
- Ensure that it works for as many users as possible. (for system administrators, for standard users, with person accounts, with multi currency, with large data volumes, with professional edition, on a slow network etc.)
- Be conservative about the number and complexity of Salesforce API requests we make, but don't sacrifice the other principles to do so.
- Focus on system administrators, developers and integrators.

## About

By Olivier Dufour forked from [Thomas Prouvot](https://github.com/tprouvot/Salesforce-Inspector-reloaded) who forked from [Søren Krabbe and Jesper Kristensen](https://github.com/sorenkrabbe/Chrome-Salesforce-inspector)

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
    <td align="center"><a href="https://github.com/dufoli"><img src="https://avatars0.githubusercontent.com/u/202057?v=4&s=100" width="100px;" alt=""/><br /><sub><b>Olivier Dufour</b></sub></a><br /><a href="https://github.com/dufoli/Salesforce-Inspector-Advanced/commits?author=dufoli" title="Code"><img src="https://i.stack.imgur.com/tskMh.png" alt="github"></a> <a href="https://www.linkedin.com/in/dufourolivier" title="Linkedin"><img src="https://i.stack.imgur.com/gVE0j.png" alt="linkedin"></a></td>
    </td>
    <td align="center"><a href="https://github.com/dufgui"><img src="https://avatars.githubusercontent.com/u/237211?v=4&s=100" width="100px;" alt=""/><br /><sub><b>Guillaume Dufour</b></sub></a><br /><a href="https://github.com/dufoli/Salesforce-Inspector-Advanced/commits?author=dufgui" title="Code"><img src="https://i.stack.imgur.com/tskMh.png" alt="github"></a> <a href="https://www.linkedin.com/in/gudufour" title="Linkedin"><img src="https://i.stack.imgur.com/gVE0j.png" alt="linkedin"></a></td>
    </td>
  </tr>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
## License

[MIT](./LICENSE)
