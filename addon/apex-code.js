/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {PageHeader} from "./page-header.js";
/* global initButton */
import {tokenizeCode, Editor} from "./editor.js";
import {DescribeInfo} from "./data-load.js";
import {ApexAutocompleteModel} from "./apex-autocomplete.js";

const apexKeywordColor = new Map([
  "abstract", "class", "enum", "extends", "final", "global", "implements", "interface", "override", "private", "protected", "public",
  "static", "transient", "virtual", "void", "with", "without", "inherited", "sharing", "trigger", "on", "testmethod", "webservice",
  "istest", "testsetup", "auraenabled", "invocablemethod", "invocablevariable", "future", "remoteaction", "true", "false", "null", "this", "super"
].map(k => [k, "blue"]).concat([
  "if", "else", "for", "while", "do", "break", "continue", "return", "try", "catch", "finally", "throw", "new", "switch", "when",
  "insert", "update", "upsert", "delete", "undelete", "merge", "instanceof", "before", "after"
].map(k => [k, "violet"])));

const pollDelay = 2000;
const testSetsStorageKey = "insextApexTestSets";
const debugLogsStorageKey = "insextApexTestDebugLogs";
const finalTestStatuses = ["Completed", "Failed", "Aborted"];
const editorLineHeight = 18; // px, see .code-area.editing in apex-code.css

function soqlString(value) {
  return "'" + value.replace(/([\\'])/g, "\\$1") + "'";
}

function codeTypeFromId(id) {
  return id && id.startsWith("01q") ? "ApexTrigger" : "ApexClass";
}

// Compares a 15 and an 18 characters Id of the same record
function sameId(a, b) {
  return a.substring(0, 15) == b.substring(0, 15);
}

/**
 * Parses the response of the Developer Console test class list (ApexTestQueueServlet, GET_TESTS_DEV_CONSOLE),
 * a JSON prefixed by "while(1);". Classes of the org have the "[My Namespace]" namespace.
 * @returns {Array<{Id: string, label: string, managed: boolean}>}
 */
export function parseTestClassesResponse(text) {
  let result = JSON.parse(text.replace(/^\s*while\(1\);/, ""));
  if (!result.success || !Array.isArray(result.testClasses)) {
    throw new Error("Unexpected test class list response");
  }
  return result.testClasses.map(c => ({Id: c.id, label: c.name, managed: c.ns != "[My Namespace]"}));
}

/**
 * Adds or replaces the test set of this name, test sets are sorted by name.
 * @returns {Array<{name: string, classes: string[]}>}
 */
export function upsertTestSet(sets, name, classes) {
  return sets.filter(g => g.name != name).concat([{name, classes}]).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Finds the test classes of a test set by name (case insensitive), its classes are stored by name
 * so a test set works in all the orgs, e.g. production and its sandboxes.
 */
export function resolveTestSet(set, options) {
  let tests = [];
  let missing = [];
  for (let name of set.classes) {
    let test = options.find(c => c.label.toLowerCase() == name.toLowerCase());
    if (test) {
      tests.push(test);
    } else {
      missing.push(name);
    }
  }
  return {tests, missing};
}

/**
 * Merges the Coverage field of several ApexCodeCoverage(Aggregate) records:
 * a line is covered if any record covers it, uncovered if no record covers it.
 */
// Groups the failed test methods by class, in the format of the "tests" parameter of runTestsAsynchronous
export function failedTestsToRun(results) {
  let byClass = new Map();
  for (let r of results) {
    if (r.Outcome == "Pass" || !r.ApexClassId) {
      continue;
    }
    if (!byClass.has(r.ApexClassId)) {
      byClass.set(r.ApexClassId, []);
    }
    byClass.get(r.ApexClassId).push(r.MethodName);
  }
  return Array.from(byClass, ([classId, testMethods]) => ({classId, testMethods}));
}

export function mergeCoverage(coverages) {
  let covered = new Set();
  let uncovered = new Set();
  for (let coverage of coverages) {
    if (!coverage) {
      continue;
    }
    (coverage.coveredLines || []).forEach(l => covered.add(l));
    (coverage.uncoveredLines || []).forEach(l => uncovered.add(l));
  }
  covered.forEach(l => uncovered.delete(l));
  return {covered, uncovered};
}

/**
 * Splits colored segments (see tokenizeCode) into lines, a segment spanning several lines
 * (multi-line comment) is cut into one segment per line.
 */
export function splitTokensByLine(segments) {
  let lines = [[]];
  for (let segment of segments) {
    let parts = segment.value.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        lines.push([]);
      }
      if (part) {
        lines[lines.length - 1].push({value: part, color: segment.color});
      }
    });
  }
  return lines;
}

/**
 * Change to make on the trace flags of the user so that its activity is logged from now until a date:
 * null when an active trace flag already lasts until then, otherwise the developer log trace flag to update
 * (Salesforce allows one trace flag per log type and user) or to insert (no id).
 */
export function traceFlagChange(traceFlags, now, until) {
  let started = f => !f.StartDate || new Date(f.StartDate) <= now;
  if (traceFlags.some(f => started(f) && new Date(f.ExpirationDate) >= until)) {
    return null;
  }
  let flag = traceFlags.find(f => f.LogType == "DEVELOPER_LOG");
  let body = {StartDate: now.toISOString(), ExpirationDate: until.toISOString()};
  return flag ? {id: flag.Id, body} : {id: null, body: Object.assign({LogType: "DEVELOPER_LOG"}, body)};
}

/**
 * Parses an Apex stack trace into frames, e.g. "Class.MyService.doIt: line 3, column 1"
 * gives {kind: "Class", path: "MyService.doIt", line: 3}. Lines which are not frames have no kind.
 */
export function parseStackTrace(stackTrace) {
  if (!stackTrace) {
    return [];
  }
  return stackTrace.split("\n").map(text => {
    let match = /^(Class|Trigger)\.([\w.]+): line (\d+)/.exec(text.trim());
    if (!match) {
      return {text};
    }
    return {text, kind: match[1], path: match[2], line: Number(match[3])};
  });
}

/**
 * Errors of a ContainerAsyncRequest (Tooling API save of Apex code): compile errors with their line,
 * or the error message of the request. Empty when the code was saved.
 * @returns {Array<{line: number|null, column: number|null, problem: string}>}
 */
export function saveErrors(request) {
  if (request.State == "Completed") {
    return [];
  }
  let failures = (request.DeployDetails && request.DeployDetails.componentFailures) || [];
  if (failures.length) {
    return failures.map(f => ({line: f.lineNumber || null, column: f.columnNumber || null, problem: f.problem}));
  }
  return [{line: null, column: null, problem: request.ErrorMsg || "Save " + request.State}];
}

function codeKind(code) {
  return code.type == "ApexTrigger" ? "trigger" : "class";
}

export class Model extends ApexAutocompleteModel {
  constructor({sfHost, args}) {
    super();
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.spinnerCount = 0;
    this.error = null;
    this.allCode = []; // ApexClass and ApexTrigger, for the pickers: {Id, label, type}
    this.code = null; // {Id, Name, label, type, lines}
    this.coverageMode = "org";
    this.coverage = null; // {covered, uncovered, message}
    this.suggestedTests = [];
    this.selectedTests = [];
    this.testClasses = null; // {Id, label, managed}
    this.includeManagedTests = false;
    this.testSets = this.readTestSets(); // {name, classes: [class names]}
    this.selectedTestSet = "";
    this.testSetMessage = null;
    this.lastRunTestIds = [];
    this.testRun = null; // {jobId, status, total, done, results}
    this.targetLine = null;
    this.failedTestsOnly = false;
    this.debugLogs = localStorage.getItem(debugLogsStorageKey) == "true";
    this.pollTimer = null;
    this.editing = false;
    this.saving = false;
    this.compileErrors = [];
    // Editor component of the edit mode, see ApexAutocompleteModel for the autocomplete
    this.editorMirror = null;
    this.winInnerHeight = 0;
    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      if (this.editor) {
        this.editorAutocompleteHandler({newDescribe: true});
      }
      this.didUpdate();
    });

    this.spinFor(this.loadAllCode());
    this.spinFor(this.loadTestClasses());
    let id = args.get("id");
    let name = args.get("name");
    if (id || name) {
      this.spinFor(this.openCode({id, name, type: args.get("type") || codeTypeFromId(id)}));
    }
  }

  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
    }
  }

  spinFor(promise) {
    this.spinnerCount++;
    promise
      .catch(err => {
        console.error("spinFor", err);
        this.error = err.message || "An error occurred";
      })
      .then(() => {
        this.spinnerCount--;
        this.didUpdate();
      })
      .catch(err => console.log("error handling failed", err));
  }

  async queryAll(soql, tooling = false) {
    let records = [];
    let url = "/services/data/v" + apiVersion + (tooling ? "/tooling" : "") + "/query/?q=" + encodeURIComponent(soql);
    while (url) {
      let result = await sfConn.rest(url);
      records.push(...result.records);
      url = result.done ? null : result.nextRecordsUrl;
    }
    return records;
  }

  async loadAllCode() {
    let [classes, triggers, lockedNamespaces] = await Promise.all([
      this.queryAll("SELECT Id, Name, NamespacePrefix FROM ApexClass ORDER BY Name"),
      this.queryAll("SELECT Id, Name, NamespacePrefix FROM ApexTrigger ORDER BY Name"),
      this.loadLockedNamespaces()
    ]);
    this.apexClasses.addToTable(classes); // suggested by the autocomplete
    let visible = r => !r.NamespacePrefix || !lockedNamespaces.has(r.NamespacePrefix);
    let toEntry = type => r => ({Id: r.Id, label: (r.NamespacePrefix ? r.NamespacePrefix + "." : "") + r.Name, type});
    this.allCode = classes.filter(visible).map(toEntry("ApexClass")).concat(triggers.filter(visible).map(toEntry("ApexTrigger")));
  }

  // Namespaces of the installed managed packages, whose code Salesforce hides (unlocked packages keep it visible)
  async loadLockedNamespaces() {
    try {
      let packages = await this.queryAll("SELECT SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.Package2ContainerOptions FROM InstalledSubscriberPackage", true);
      return new Set(packages
        .filter(p => p.SubscriberPackage && p.SubscriberPackage.NamespacePrefix && !(p.SubscriberPackageVersion && p.SubscriberPackageVersion.Package2ContainerOptions == "Unlocked"))
        .map(p => p.SubscriberPackage.NamespacePrefix));
    } catch (err) {
      console.error("Failed to load installed packages", err);
      return new Set();
    }
  }

  // Test classes as listed by the Developer Console (@isTest classes only), null when this undocumented call failed
  async loadTestClasses() {
    try {
      let response = await fetch("https://" + this.sfHost + "/_ui/common/apex/test/ApexTestQueueServlet", {
        method: "POST",
        credentials: "include",
        headers: {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest"},
        body: "action=GET_TESTS_DEV_CONSOLE"
      });
      this.testClasses = parseTestClassesResponse(await response.text());
    } catch (error) {
      console.warn("Test classes not available from the Developer Console API, all classes are listed instead", error);
      this.testClasses = null;
    }
  }

  readTestSets() {
    try {
      let sets = JSON.parse(localStorage.getItem(testSetsStorageKey) || "[]");
      return Array.isArray(sets) ? sets : [];
    } catch (error) {
      console.warn("Invalid saved test sets", error);
      return [];
    }
  }

  saveTestSet(name) {
    this.testSets = upsertTestSet(this.testSets, name, this.selectedTests.map(t => t.label));
    localStorage.setItem(testSetsStorageKey, JSON.stringify(this.testSets));
    this.selectedTestSet = name;
    this.testSetMessage = null;
  }

  // Replaces the tests to run by the test classes of the test set which exist in this org
  loadTestSet(name) {
    let set = this.testSets.find(g => g.name == name);
    this.selectedTestSet = name;
    this.testSetMessage = null;
    if (!set) {
      return;
    }
    let options = this.testClasses || this.allCode.filter(c => c.type == "ApexClass");
    let {tests, missing} = resolveTestSet(set, options);
    this.selectedTests = tests;
    if (missing.length) {
      this.testSetMessage = "Not found in this org: " + missing.join(", ");
    }
  }

  deleteTestSet(name) {
    this.testSets = this.testSets.filter(g => g.name != name);
    localStorage.setItem(testSetsStorageKey, JSON.stringify(this.testSets));
    this.selectedTestSet = "";
    this.testSetMessage = null;
  }

  testClassOptions() {
    let options = this.testClasses
      ? this.testClasses.filter(c => this.includeManagedTests || !c.managed)
      : this.allCode.filter(c => c.type == "ApexClass");
    return options.filter(c => !this.selectedTests.some(s => sameId(s.Id, c.Id)));
  }

  async openCode({id, name, type}) {
    let where;
    if (id) {
      if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
        throw new Error("Invalid Id: " + id);
      }
      where = "Id = " + soqlString(id);
    } else {
      where = "Name = " + soqlString(name);
    }
    let records = await this.queryAll("SELECT Id, Name, NamespacePrefix, Body, LastModifiedDate FROM " + type + " WHERE " + where);
    if (records.length == 0) {
      throw new Error(type + " not found: " + (id || name));
    }
    let record = records[0];
    this.stopPolling();
    this.error = null;
    this.code = this.toCode(record, type);
    this.cancelEdit();
    this.coverageMode = "org";
    this.coverage = null;
    this.suggestedTests = [];
    this.selectedTests = [];
    this.selectedTestSet = "";
    this.testSetMessage = null;
    this.lastRunTestIds = [];
    this.testRun = null;
    this.targetLine = null;
    let args = new URLSearchParams();
    args.set("host", this.sfHost);
    args.set("id", record.Id);
    history.replaceState(null, "", "?" + args);
    document.title = this.code.label + " - Apex Code";
    this.didUpdate();
    if (this.code.hidden) {
      // Salesforce records no code coverage for installed managed package code
      return;
    }
    await Promise.all([this.loadCoverage(), this.loadSuggestedTests()]);
  }

  toCode(record, type) {
    return {
      Id: record.Id,
      Name: record.Name,
      label: (record.NamespacePrefix ? record.NamespacePrefix + "." : "") + record.Name,
      type,
      hidden: record.Body == "(hidden)",
      body: record.Body || "",
      lastModifiedDate: record.LastModifiedDate,
      lines: splitTokensByLine(tokenizeCode(record.Body || "", {keywordColor: apexKeywordColor}))
    };
  }

  startEdit() {
    this.editing = true;
    this.compileErrors = [];
    // sObjects for the autocomplete, loaded once
    this.describeInfo.describeGlobal(false);
  }

  cancelEdit() {
    this.editing = false;
    this.editor = null;
    this.editorMirror = null;
    this.autocompleteState = "";
    this.compileErrors = [];
  }

  isDirty() {
    return this.editing && this.editor != null && this.editor.value != this.code.body;
  }

  // Editor component interface
  setEditor(editor) {
    this.editor = editor;
    editor.value = this.code.body;
    this.editHistory.attach(editor);
  }
  recalculateSize() {
    // the size of the page content does not depend on the viewport
  }

  // Saves the edited code like the Developer Console, Salesforce refuses it in production orgs
  async saveCode() {
    let code = this.code;
    let editor = this.editor;
    let body = editor.value;
    this.saving = true;
    editor.readOnly = true;
    this.compileErrors = [];
    this.didUpdate();
    try {
      let [current] = await this.queryAll("SELECT LastModifiedDate, LastModifiedBy.Name FROM " + code.type + " WHERE Id = " + soqlString(code.Id));
      if (current && current.LastModifiedDate != code.lastModifiedDate
        && !confirm("This " + codeKind(code) + " was modified by " + (current.LastModifiedBy ? current.LastModifiedBy.Name : "someone") + " since you opened it. Overwrite these changes?")) {
        return;
      }
      let errors = await this.deployCode(code, body);
      if (this.code != code) {
        return; // another class was opened
      }
      if (errors.length) {
        this.compileErrors = errors;
        return;
      }
      let [record] = await this.queryAll("SELECT Id, Name, NamespacePrefix, Body, LastModifiedDate FROM " + code.type + " WHERE Id = " + soqlString(code.Id));
      if (this.code != code) {
        return;
      }
      // keep the tests to run, but the coverage of the previous code no longer applies
      this.code = this.toCode(record, code.type);
      this.cancelEdit();
      this.targetLine = null;
      this.lastRunTestIds = [];
      this.coverageMode = "org";
      this.coverage = null;
      this.didUpdate();
      await this.loadCoverage();
    } finally {
      this.saving = false;
      editor.readOnly = false;
    }
  }

  // Compiles and saves the body with the Tooling API, returns the errors (see saveErrors)
  async deployCode(code, body) {
    let tooling = "/services/data/v" + apiVersion + "/tooling/sobjects/";
    // the name is unique and limited to 32 characters
    let container = await sfConn.rest(tooling + "MetadataContainer/", {method: "POST", body: {Name: "SFIA" + Date.now()}});
    try {
      await sfConn.rest(tooling + (code.type == "ApexTrigger" ? "ApexTriggerMember" : "ApexClassMember") + "/", {method: "POST",
        body: {MetadataContainerId: container.id, ContentEntityId: code.Id, Body: body}});
      let request = await sfConn.rest(tooling + "ContainerAsyncRequest/", {method: "POST", body: {MetadataContainerId: container.id, IsCheckOnly: false}});
      let result;
      do {
        await new Promise(resolve => setTimeout(resolve, 1000));
        result = await sfConn.rest(tooling + "ContainerAsyncRequest/" + request.id);
      } while (result.State == "Queued");
      return saveErrors(result);
    } finally {
      sfConn.rest(tooling + "MetadataContainer/" + container.id, {method: "DELETE"}).catch(err => console.warn("Failed to delete the metadata container", err));
    }
  }

  // Selects a line in the edit mode textarea
  goToEditorLine(line) {
    let textarea = this.editor;
    if (!textarea) {
      return;
    }
    let lines = textarea.value.split("\n");
    let start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
    textarea.focus();
    textarea.setSelectionRange(start, start + (lines[line - 1] || "").length);
    textarea.scrollTop = Math.max(0, ((line - 1) * editorLineHeight) - (textarea.clientHeight / 2));
  }

  async loadCoverage() {
    let code = this.code;
    let coverage;
    if (this.coverageMode == "org") {
      let records = await this.queryAll("SELECT Coverage FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId = " + soqlString(code.Id), true);
      coverage = mergeCoverage(records.map(r => r.Coverage));
      if (records.length == 0) {
        coverage.message = "No code coverage for this " + (code.type == "ApexTrigger" ? "trigger" : "class") + " yet: run tests which execute it.";
      }
    } else {
      let records = this.lastRunTestIds.length == 0 ? [] : await this.queryAll("SELECT Coverage FROM ApexCodeCoverage WHERE ApexClassOrTriggerId = " + soqlString(code.Id)
        + " AND ApexTestClassId IN (" + this.lastRunTestIds.map(soqlString).join(", ") + ")", true);
      coverage = mergeCoverage(records.map(r => r.Coverage));
      if (records.length == 0) {
        coverage.message = "No coverage stored for the last run: its tests do not execute this code, or the org stores only aggregated code coverage (Apex Test Execution options).";
      }
    }
    if (this.code == code) {
      this.coverage = coverage;
    }
  }

  async loadSuggestedTests() {
    let code = this.code;
    let records = await this.queryAll("SELECT ApexTestClassId, ApexTestClass.Name FROM ApexCodeCoverage WHERE ApexClassOrTriggerId = " + soqlString(code.Id), true);
    let tests = new Map();
    records.filter(r => r.ApexTestClassId).forEach(r => tests.set(r.ApexTestClassId, {Id: r.ApexTestClassId, label: r.ApexTestClass ? r.ApexTestClass.Name : r.ApexTestClassId}));
    if (this.code == code) {
      this.suggestedTests = Array.from(tests.values()).sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  setCoverageMode(mode) {
    this.coverageMode = mode;
    this.coverage = null;
    this.didUpdate();
    this.spinFor(this.loadCoverage());
  }

  addTest(test) {
    if (!this.selectedTests.some(t => sameId(t.Id, test.Id))) {
      this.selectedTests.push(test);
    }
  }

  removeTest(testId) {
    this.selectedTests = this.selectedTests.filter(t => t.Id != testId);
  }

  runTests() {
    let testIds = this.selectedTests.map(t => t.Id);
    return this.startTestRun({classids: testIds.join(",")}, testIds);
  }

  // Runs again only the failed test methods of the last run
  rerunFailedTests() {
    let tests = failedTestsToRun(this.testRun.results);
    return this.startTestRun({tests}, tests.map(t => t.classId));
  }

  setDebugLogs(debugLogs) {
    this.debugLogs = debugLogs;
    localStorage.setItem(debugLogsStorageKey, debugLogs);
  }

  // Sets a trace flag on the current user, with the debug level and the duration of the options, so the test run is logged
  async enableDebugLogs() {
    let {userId} = await sfConn.getUserInfo();
    let minutes = Number(localStorage.getItem("debugLogTimeMinutes")) || 15;
    let now = new Date();
    let until = new Date(now.getTime() + (minutes * 60 * 1000));
    let traceFlags = await this.queryAll("SELECT Id, LogType, StartDate, ExpirationDate FROM TraceFlag WHERE TracedEntityId = " + soqlString(userId)
      + " AND LogType IN ('DEVELOPER_LOG', 'USER_DEBUG')", true);
    let change = traceFlagChange(traceFlags, now, until);
    if (!change) {
      return;
    }
    let url = "/services/data/v" + apiVersion + "/tooling/sobjects/TraceFlag/";
    if (change.id) {
      await sfConn.rest(url + change.id, {method: "PATCH", body: change.body});
      return;
    }
    let debugLevel = localStorage.getItem(this.sfHost + "_debugLogDebugLevel") || "SFDC_DevConsole";
    let debugLevels = await this.queryAll("SELECT Id FROM DebugLevel WHERE DeveloperName = " + soqlString(debugLevel), true);
    if (debugLevels.length == 0) {
      throw new Error("Debug level \"" + debugLevel + "\" not found, change it in the options (Debug Log Debug Level).");
    }
    await sfConn.rest(url, {method: "POST", body: Object.assign({TracedEntityId: userId, DebugLevelId: debugLevels[0].Id}, change.body)});
  }

  async startTestRun(body, testIds) {
    if (this.debugLogs) {
      await this.enableDebugLogs();
    }
    let jobId;
    try {
      jobId = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/runTestsAsynchronous/", {method: "POST", body});
    } catch (error) {
      if (error.message && error.message.startsWith("ALREADY_IN_PROCESS")) {
        throw new Error("A test run is already in progress in this org, wait for it to finish (see the Tests tab of Apex Runner).");
      }
      throw error;
    }
    this.testRun = {jobId, testIds, status: "Queued", total: 0, done: 0, results: []};
    this.didUpdate();
    this.pollTestRun(this.testRun);
  }

  pollTestRun(testRun) {
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.spinFor(this.checkTestRun(testRun));
    }, pollDelay);
  }

  async checkTestRun(testRun) {
    let items = await this.queryAll("SELECT Status FROM ApexTestQueueItem WHERE ParentJobId = " + soqlString(testRun.jobId));
    if (this.testRun != testRun) {
      return; // another class was opened
    }
    testRun.total = items.length;
    testRun.done = items.filter(i => finalTestStatuses.includes(i.Status)).length;
    if (items.length == 0 || testRun.done < testRun.total) {
      testRun.status = "Running";
      this.pollTestRun(testRun);
      return;
    }
    testRun.results = await this.queryAll("SELECT ApexClassId, ApexClass.Name, MethodName, Outcome, Message, StackTrace, RunTime, ApexLogId FROM ApexTestResult WHERE AsyncApexJobId = "
      + soqlString(testRun.jobId) + " ORDER BY ApexClass.Name, MethodName");
    testRun.status = "Completed";
    if (this.testRun == testRun) {
      this.lastRunTestIds = testRun.testIds;
      this.coverageMode = "lastRun";
      this.coverage = null;
      this.didUpdate();
      await this.loadCoverage();
    }
  }

  stopPolling() {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // Scrolls to a stack trace frame when it points to the open code, otherwise opens the class or trigger it points to
  openFrame(frame) {
    let code = this.code;
    let path = frame.path.toLowerCase();
    let isOpenCode = code && (frame.kind == "Trigger" ? code.type == "ApexTrigger" && path == code.label.toLowerCase()
      : code.type == "ApexClass" && (path.startsWith(code.label.toLowerCase() + ".") || path == code.label.toLowerCase()));
    if (isOpenCode) {
      this.goToLine(frame.line);
      return;
    }
    let target = frame.kind == "Trigger" ? this.allCode.find(c => c.type == "ApexTrigger" && c.label.toLowerCase() == path)
      : this.allCode.filter(c => c.type == "ApexClass" && (path.startsWith(c.label.toLowerCase() + ".") || path == c.label.toLowerCase()))
        .sort((a, b) => b.label.length - a.label.length)[0];
    if (target) {
      let args = new URLSearchParams();
      args.set("host", this.sfHost);
      args.set("id", target.Id);
      window.open("apex-code.html?" + args, "_blank");
    }
  }

  goToLine(line) {
    if (this.editing) {
      this.goToEditorLine(line);
      return;
    }
    this.targetLine = line;
    this.didUpdate(() => {
      let element = document.getElementById("code-line-" + line);
      if (element) {
        element.scrollIntoView({block: "center"});
      }
    });
  }

  logLink(logId) {
    let args = new URLSearchParams();
    args.set("host", this.sfHost);
    args.set("recordId", logId);
    return "log.html?" + args;
  }

  setupLink() {
    let code = this.code;
    return this.sfLink + "/lightning/setup/" + (code.type == "ApexTrigger" ? "ApexTriggers" : "ApexClasses") + "/page?address=%2F" + code.Id;
  }
}

let h = React.createElement;

class CodePicker extends React.Component {
  constructor(props) {
    super(props);
    this.state = {value: ""};
    this.onChange = this.onChange.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
  }
  pick(value) {
    let {options, onPick} = this.props;
    let code = options.find(c => c.label.toLowerCase() == value.trim().toLowerCase());
    if (code) {
      onPick(code);
      this.setState({value: ""});
      return true;
    }
    return false;
  }
  onChange(e) {
    let {value} = e.target;
    // a datalist option selected with the mouse fires an input event with the full value
    if (!this.pick(value)) {
      this.setState({value});
    }
  }
  onKeyDown(e) {
    if (e.key == "Enter") {
      this.pick(this.state.value);
    }
  }
  render() {
    let {options, id, placeholder} = this.props;
    return h("span", {},
      h("input", {type: "search", className: "code-picker", list: id, placeholder, value: this.state.value, onChange: this.onChange, onKeyDown: this.onKeyDown}),
      h("datalist", {id}, options.map(c => h("option", {key: c.Id, value: c.label})))
    );
  }
}

class CodeViewer extends React.Component {
  shouldComponentUpdate(nextProps) {
    return nextProps.code != this.props.code || nextProps.coverage != this.props.coverage || nextProps.targetLine != this.props.targetLine;
  }
  render() {
    let {code, coverage, targetLine} = this.props;
    return h("div", {className: "code-viewer"},
      code.lines.map((tokens, i) => {
        let line = i + 1;
        let className = "code-line";
        if (coverage && coverage.covered.has(line)) {
          className += " line-covered";
        } else if (coverage && coverage.uncovered.has(line)) {
          className += " line-uncovered";
        }
        if (line == targetLine) {
          className += " line-target";
        }
        return h("div", {key: line, id: "code-line-" + line, className},
          h("span", {className: "line-number"}, line),
          h("span", {className: "line-text"}, tokens.map((t, ti) => h("span", {key: ti, style: {color: t.color}}, t.value)))
        );
      })
    );
  }
}

class TestSets extends React.Component {
  constructor(props) {
    super(props);
    this.state = {name: ""};
    this.onSave = this.onSave.bind(this);
  }
  onSave() {
    let {model} = this.props;
    let name = this.state.name.trim();
    if (model.testSets.some(g => g.name == name) && !confirm("Replace the test set \"" + name + "\"?")) {
      return;
    }
    model.saveTestSet(name);
    this.setState({name: ""});
    model.didUpdate();
  }
  render() {
    let {model} = this.props;
    return h("div", {className: "test-sets"},
      model.testSets.length ? h("div", {className: "test-set-row"},
        h("select", {value: model.selectedTestSet, title: "Replace the tests to run by a saved test set", onChange: e => { model.loadTestSet(e.target.value); model.didUpdate(); }},
          h("option", {value: "", disabled: true}, "Load a test set..."),
          model.testSets.map(g => h("option", {key: g.name, value: g.name}, g.name + " (" + g.classes.length + ")"))
        ),
        model.selectedTestSet ? h("button", {title: "Delete this test set",
          className: "delete-btn",
          onClick: () => {
            if (confirm("Delete the test set \"" + model.selectedTestSet + "\"?")) {
              model.deleteTestSet(model.selectedTestSet);
              model.didUpdate();
            }
          }}, "Delete") : null
      ) : null,
      model.testSetMessage ? h("div", {className: "coverage-message"}, model.testSetMessage) : null,
      h("div", {className: "test-set-row"},
        h("input", {type: "text",
          placeholder: "Test set name, e.g. Billing",
          value: this.state.name,
          onChange: e => this.setState({name: e.target.value}),
          onKeyDown: e => { if (e.key == "Enter" && this.state.name.trim() && model.selectedTests.length) { this.onSave(); } }}),
        h("button", {disabled: !this.state.name.trim() || model.selectedTests.length == 0, title: "Save the tests to run as a test set", onClick: this.onSave}, "Save set")
      )
    );
  }
}

class TestPanel extends React.Component {
  render() {
    let {model} = this.props;
    let {testRun} = model;
    let running = testRun && testRun.status != "Completed";
    let suggestions = model.suggestedTests.filter(t => !model.selectedTests.some(s => sameId(s.Id, t.Id)));
    return h("div", {className: "test-panel"},
      h("h3", {}, "Tests to run"),
      h(TestSets, {model}),
      h("div", {className: "test-chips"},
        model.selectedTests.map(t => h("span", {key: t.Id, className: "test-chip"}, t.label,
          h("button", {className: "chip-remove", title: "Remove", onClick: () => { model.removeTest(t.Id); model.didUpdate(); }}, "×")
        ))
      ),
      h(CodePicker, {options: model.testClassOptions(), id: "test-classes", placeholder: "Add a test class", onPick: c => { model.addTest(c); model.didUpdate(); }}),
      model.testClasses ? h("label", {className: "include-managed", title: "List the test classes of managed packages too"},
        h("input", {type: "checkbox", checked: model.includeManagedTests, onChange: e => { model.includeManagedTests = e.target.checked; model.didUpdate(); }}),
        " Include managed packages"
      ) : null,
      suggestions.length ? h("div", {className: "test-suggestions"},
        h("span", {}, "Tests covering it: "),
        suggestions.map(t => h("a", {key: t.Id, href: "#", title: "Add to tests to run", onClick: e => { e.preventDefault(); model.addTest(t); model.didUpdate(); }}, t.label))
      ) : null,
      h("div", {className: "test-actions"},
        h("button", {className: "highlighted", disabled: model.selectedTests.length == 0 || running, onClick: () => model.spinFor(model.runTests())}, "Run Tests"),
        !running && testRun && testRun.results.some(r => r.Outcome != "Pass")
          ? h("button", {title: "Run again only the failed test methods", onClick: () => model.spinFor(model.rerunFailedTests())}, "Rerun Failed Tests") : null,
        testRun ? h("span", {className: "test-status"}, running ? testRun.status + (testRun.total ? " " + testRun.done + "/" + testRun.total : "") + "..." : "Completed") : null
      ),
      h("label", {className: "debug-logs", title: "Before running tests, enable the debug logs of the current user (trace flag with the debug level and the duration of the options) to open the log of each test class"},
        h("input", {type: "checkbox", checked: model.debugLogs, onChange: e => { model.setDebugLogs(e.target.checked); model.didUpdate(); }}),
        " Debug logs"
      ),
      testRun && testRun.results.length ? h("div", {className: "test-results"},
        h("h3", {}, "Results (" + testRun.results.filter(r => r.Outcome == "Pass").length + "/" + testRun.results.length + " passed)"),
        h("label", {className: "failed-only"},
          h("input", {type: "checkbox", checked: model.failedTestsOnly, onChange: e => { model.failedTestsOnly = e.target.checked; model.didUpdate(); }}),
          " Failed tests only"
        ),
        testRun.results.filter(r => !model.failedTestsOnly || r.Outcome != "Pass").map((r, i) => h("div", {key: i, className: "test-result " + (r.Outcome == "Pass" ? "pass" : "fail")},
          h("div", {className: "test-name"}, (r.Outcome == "Pass" ? "✔ " : "✘ ") + (r.ApexClass ? r.ApexClass.Name : "") + "." + r.MethodName,
            r.RunTime != null ? h("span", {className: "test-time"}, " " + r.RunTime + " ms") : null,
            r.ApexLogId ? h("a", {href: model.logLink(r.ApexLogId), target: "_blank", className: "test-log", title: "Open the debug log of this test class"}, "Log") : null),
          r.Message ? h("div", {className: "test-message"}, r.Message) : null,
          parseStackTrace(r.StackTrace).map((frame, fi) => frame.kind
            ? h("a", {key: fi, href: "#", className: "stack-frame", title: "Go to line", onClick: e => { e.preventDefault(); model.openFrame(frame); }}, frame.text)
            : h("div", {key: fi, className: "stack-frame"}, frame.text))
        ))
      ) : null
    );
  }
}

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onBeforeUnload = this.onBeforeUnload.bind(this);
  }
  componentDidMount() {
    addEventListener("beforeunload", this.onBeforeUnload);
  }
  componentWillUnmount() {
    this.props.model.stopPolling();
    removeEventListener("beforeunload", this.onBeforeUnload);
  }
  onBeforeUnload(e) {
    if (this.props.model.isDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  }
  render() {
    let {model} = this.props;
    let {code, coverage} = model;
    let total = coverage ? coverage.covered.size + coverage.uncovered.size : 0;
    let percent = total ? Math.floor(coverage.covered.size * 100 / total) : null;
    return h("div", {className: "apex-code-page"},
      h(PageHeader, {sfHost: model.sfHost, title: "Apex Code", spinning: model.spinnerCount != 0, options: true}),
      h("div", {className: "area code-header"},
        h(CodePicker, {options: model.allCode,
          id: "all-code",
          placeholder: "Open an Apex class or trigger",
          onPick: c => {
            if (!model.isDirty() || confirm("Discard your changes to " + code.label + "?")) {
              model.spinFor(model.openCode({id: c.Id, type: c.type}));
            }
          }}),
        code ? h("h2", {}, code.label + (code.type == "ApexTrigger" ? ".trigger" : ".cls") + (model.isDirty() ? " *" : "")) : null,
        code ? h("a", {href: model.setupLink(), target: "_blank", title: "View in Setup"}, "Setup") : null,
        code && !code.hidden && !model.editing ? h("button", {title: "Edit the code, then save it like the Developer Console (not allowed in production orgs)", onClick: () => { model.startEdit(); model.didUpdate(); }}, "Edit") : null,
        model.editing ? h("button", {className: "highlighted", disabled: model.saving, title: "Compile and save (Ctrl+S). While editing, Ctrl+Space shows or picks a suggestion, Esc hides them", onClick: () => model.spinFor(model.saveCode())}, model.saving ? "Saving..." : "Save") : null,
        model.editing ? h("button", {disabled: model.saving,
          onClick: () => {
            if (!model.isDirty() || confirm("Discard your changes?")) {
              model.cancelEdit();
              model.didUpdate();
            }
          }}, "Cancel") : null,
        code && !code.hidden && !model.editing ? h("span", {className: "coverage-mode"},
          h("label", {}, h("input", {type: "radio", name: "coverageMode", checked: model.coverageMode == "org", onChange: () => model.setCoverageMode("org")}), " Org coverage"),
          h("label", {title: model.lastRunTestIds.length ? "Lines executed by the tests of the last run" : "Run tests first"},
            h("input", {type: "radio", name: "coverageMode", checked: model.coverageMode == "lastRun", disabled: model.lastRunTestIds.length == 0, onChange: () => model.setCoverageMode("lastRun")}), " Last run")
        ) : null,
        percent != null && !model.editing ? h("span", {className: "coverage-percent" + (percent < 75 ? " low" : "")}, percent + "% (" + coverage.covered.size + "/" + total + " lines)") : null
      ),
      model.error ? h("div", {className: "area error-message"}, model.error) : null,
      code && code.hidden ? h("div", {className: "area coverage-message"}, "This " + (code.type == "ApexTrigger" ? "trigger" : "class") + " belongs to an installed managed package: Salesforce hides its source code and records no code coverage for it.")
      : code ? h("div", {className: "code-body"},
        model.editing ? h("div", {className: "area code-area editing"},
          model.compileErrors.length ? h("div", {className: "compile-errors"},
            model.compileErrors.map((e, i) => e.line
              ? h("a", {key: i, href: "#", className: "compile-error", title: "Go to line", onClick: ev => { ev.preventDefault(); model.goToEditorLine(e.line); }},
                "Line " + e.line + (e.column ? ", column " + e.column : "") + ": " + e.problem)
              : h("div", {key: i, className: "compile-error"}, e.problem))
          ) : null,
          h("div", {className: "code-editor",
            onKeyDown: e => {
              // the key events of the Editor textarea bubble up here
              if ((e.ctrlKey || e.metaKey) && e.key == "s") {
                e.preventDefault();
                if (!model.saving) {
                  model.spinFor(model.saveCode());
                }
              }
            }},
          h(Editor, {model, keywordColor: apexKeywordColor, keywordCaseSensitive: false, maxHighlightSegments: Infinity})),
          h("div", {ref: el => { model.autocompleteResultBox = el; },
            className: "autocomplete-results autocomplete-results-over",
            hidden: !model.displaySuggestion || model.autocompleteResults.results.length == 0,
            style: {top: model.suggestionTop + "px", left: model.suggestionLeft + "px"}},
          model.autocompleteResults.results.map((r, ri) =>
            h("div", {className: "autocomplete-result" + (ri == model.activeSuggestion ? " active" : ""), key: r.key ? r.key : r.value},
              h("a", {tabIndex: 0, title: r.title, href: "#", className: r.autocompleteType + " " + r.dataType, onMouseDown: e => { e.preventDefault(); model.autocompleteClick(r); model.didUpdate(); }},
                h("div", {className: "autocomplete-icon"}), r.title))
          ))
        ) : h("div", {className: "area code-area"},
          coverage && coverage.message ? h("div", {className: "coverage-message"}, coverage.message) : null,
          h(CodeViewer, {code, coverage, targetLine: model.targetLine})
        ),
        h("div", {className: "area test-area"}, h(TestPanel, {model}))
      ) : h("div", {className: "area"}, "Pick an Apex class or trigger to see its code and its code coverage.")
    );
  }
}

{
  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {
    let root = document.getElementById("root");
    let model = new Model({sfHost, args});
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);
    if (parent && parent.isUnitTest) { // for unit tests
      parent.insextTestLoaded({Model, model, sfConn, traceFlagChange, failedTestsToRun, saveErrors, mergeCoverage, splitTokensByLine, parseStackTrace, parseTestClassesResponse, upsertTestSet, resolveTestSet, tokenizeCode});
    }
  });
}
