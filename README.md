<img src="https://github.com/dufoli/Salesforce-Inspector-Advanced/blob/master/addon/icon128.png?raw=true" align="right">

# Salesforce Inspector Advanced

![GitHub release](https://img.shields.io/github/v/release/dufoli/Salesforce-Inspector-Advanced?sort=semver)
[![Chrome Web Store Installs](https://img.shields.io/chrome-web-store/users/dbfimaflmomgldabcphgolbeoamjogji)](https://chromewebstore.google.com/detail/salesforce-inspector-adva/dbfimaflmomgldabcphgolbeoamjogji)
[![Chrome Web Store Rating](https://img.shields.io/chrome-web-store/rating/dbfimaflmomgldabcphgolbeoamjogji)](https://chromewebstore.google.com/detail/salesforce-inspector-adva/dbfimaflmomgldabcphgolbeoamjogji)
[![GitHub stars](https://img.shields.io/github/stars/dufoli/Salesforce-Inspector-Advanced?cacheSeconds=3600)](https://github.com/dufoli/Salesforce-Inspector-Advanced/stargazers/)
[![GitHub contributors](https://img.shields.io/github/contributors/dufoli/Salesforce-Inspector-Advanced.svg)](https://github.com/dufoli/Salesforce-Inspector-Advanced/graphs/contributors/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

Chrome and Firefox extension that adds a metadata layer on top of the standard Salesforce UI to improve the productivity and joy of Salesforce configuration, development, and integration work.

Salesforce Inspector Advanced is a fork of [Salesforce Inspector Reloaded](https://github.com/tprouvot/Salesforce-Inspector-reloaded), itself a fork of the original [Salesforce Inspector](https://github.com/sorenkrabbe/Chrome-Salesforce-inspector) by Søren Krabbe. It takes a different direction: replace the Developer Console for day-to-day work (real code editor, Apex runner, log profiler, SOSL), go further on data tools (export, import, inspect, transfer to sandbox) and add analysis tools for orgs and flows — while staying a manual, ad-hoc tool (see [Design Principles](#design-principles)).

## Demo

Click a preview to play the video.

| Data export, log viewer, org analyzer, streaming | Formula helper, metadata search |
|---|---|
| https://github.com/user-attachments/assets/30932339-339f-44e9-a7a1-0762e341d90f | https://github.com/user-attachments/assets/37de7826-3bd1-46fe-b87d-ab614c281ac0 |

- [Salesforce Inspector Advanced](#salesforce-inspector-advanced)
  - [Demo](#demo)
  - [Features](#features)
  - [Documentation](#documentation)
  - [Roadmap](#roadmap)
  - [Security and Privacy](#security-and-privacy)
  - [Use Salesforce Inspector with an External Client App](#use-salesforce-inspector-with-an-external-client-app)
  - [Installation](#installation)
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

## Features

Highlights compared to Salesforce Inspector Reloaded. The full history is in [CHANGES.md](./CHANGES.md).

**Data**

- **Data Export**: SOQL, SOSL and GraphQL with a real editor (syntax highlighting, autocomplete of objects, fields, relationships, subqueries, polymorphic `TYPEOF` and picklist/record type values), query formatting, column sort and advanced filters, inline edit, Bulk API for large volumes, history and saved queries with tags, CSV download and rich copy to Excel/Jira/Word.
- **Data Import**: Bulk API, hard delete, assignment rules, edit failed rows before retry, relationship columns skipped automatically.
- **Data Transfer** *(new)*: copy records **with their related records** to a sandbox without writing SOQL — pick the related objects in a tree, lookups between copied records are remapped, insert order computed from lookups, upsert on external ID. Also available from Data Export ("Send to Sandbox") and from a record page.
- **Inspect**: picklist value suggestions, roll-up summary and formula details, field usage analysis (percentage of records with a value per field).

**Development**

- **Apex Runner**: anonymous Apex, batch and queueable execution, log polling, autocomplete of classes, methods and inline SOQL, AI-generated Apex.
- **Log viewer & profiler**: flame chart (zoomable), profiler, Apex class view, resource view (SOQL, DML, callouts), search, run unit tests with code coverage.
- **Formula Helper**: write formulas with autocomplete, client-side error checks and formatting.
- **Streaming**: subscribe, monitor, publish and register Platform Events, PushTopics, Change Data Capture and Real-Time Event Monitoring events, with a timeline graph.
- **API Explorer**: templates (Bulk, Chatter, Reports, Platform Event channels), history, saved requests.

**Analysis & Metadata**

- **Org Analyzer**: detect bad practices and vulnerabilities (SOQL/DML in loops, hardcoded IDs, SOQL injection, sharing model, unused fields and classes, Workflow/Process Builder to migrate, inactive users, Connected App permissions, ...) with priorities and a link to the Setup page that fixes each issue.
- **Flow Analyzer**: performance, best practice, security and maintainability rules on a flow, from Flow Builder; plus "where is it used", version details and cleanup of old versions.
- **Metadata Retrieve**: search by type, name, folder, date or last modifier, "Recent changes" on source-tracked orgs, package.xml generation, translation download.
- **Dependency viewer**: hierarchy of metadata dependencies.

**Everyday**

- **Popup**: quick search on objects, users and shortcuts with filters, clone user, reset password, login as user in incognito, enable LWC debug, export a list view or a report.
- **AI assistant** *(opt-in)*: generate SOQL and Apex, describe flows, with Agentforce, OpenAI, Mistral or Anthropic.
- **Options**: custom favicon per org, custom links, editor behavior, date/number formats.

## Documentation

> [!NOTE]
> User guide for using the extension.

[![view - Documentation](https://img.shields.io/badge/view-Documentation-blue?style=for-the-badge)](https://dufoli.github.io/Salesforce-Inspector-Advanced/ "Go to extension documentation")

## Roadmap

> [!IMPORTANT]
> Roadmap is here: https://github.com/dufoli/Salesforce-Inspector-Advanced/milestones

Feedback from the community drives it: open an [issue](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues) for a bug or an idea.

## Security and Privacy

The Salesforce Inspector browser extension communicates directly between the user's web browser and the Salesforce servers. No data is persisted outside of Salesforce servers after the user leaves the Salesforce Inspector pages.
The Inspector communicates via the official Salesforce webservice APIs on behalf of the currently logged in user. This means the Inspector will be capable of accessing nothing but the data and features the user has been granted access to in Salesforce.

All Salesforce API calls from the Inspector re-use the access token/session used by the browser to access Salesforce. To acquire this access token the Salesforce Inspector requires permission to read browser cookie information for Salesforce domains.

**AI features are opt-in.** No data is sent to a third party unless you configure an AI provider (OpenAI, Mistral or Anthropic) in the options and use an AI feature: the content needed for that request (prompt, query, flow or class metadata) is then sent to the chosen provider with your own API key. Agentforce requests stay in your Salesforce org.

To validate the accuracy of this description, inspect the source code, monitor the network traffic in your browser or take my word.

## Use Salesforce Inspector with an External Client App

The extension authenticates with OAuth 2.0 (web server flow with PKCE). In orgs where "API Access Control" is enabled, you must create an External Client App: follow the steps (a wizard helps you) described in the [how-to documentation](https://dufoli.github.io/Salesforce-Inspector-Advanced/how-to/#use-sf-inspector-with-an-external-client-app).

## Installation

- [Chrome Web Store](https://chromewebstore.google.com/detail/salesforce-inspector-adva/dbfimaflmomgldabcphgolbeoamjogji)
- [Firefox Browser Add-ons](https://addons.mozilla.org/fr/firefox/addon/salesforce-inspector-advanced)
- Edge: install the extension from the Chrome Web Store.

To install from source, see [Development](#development).

## Troubleshooting

- If Salesforce Inspector is not available after installation, the most likely issue is that your browser is not up to date. See [instructions for Google Chrome](https://productforums.google.com/forum/#!topic/chrome/YK1-o4KoSjc).
- When you enable the My Domain feature in Salesforce, Salesforce Inspector may not work until you have restarted your browser (or until you have deleted the "sid" cookie for the old Salesforce domain by other means).
- Something else? Use the "Report a bug" button in the popup, or open an [issue](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues).

## Contributions

Contributions are welcome!

- Create a branch from `master` and open your PR against `master`. `master` is tagged when a new version is published on the web stores.
- Update [CHANGES.md](./CHANGES.md) with the improvement / bugfix you made.
- If you add or change a user-facing feature, document it in the [how-to page](./docs/how-to.md).
- Run `npm run eslint` before submitting (installing the ESLint extension in your editor helps).

## Development

1. Install Node.js with npm.
2. Clone the repository and run `npm install`.
3. Open `chrome://extensions/`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the **`addon`** subdirectory of this repository.

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

By Olivier Dufour, forked from [Thomas Prouvot](https://github.com/tprouvot/Salesforce-Inspector-reloaded) who forked from [Søren Krabbe and Jesper Kristensen](https://github.com/sorenkrabbe/Chrome-Salesforce-inspector).

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
