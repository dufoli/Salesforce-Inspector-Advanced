/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {PageHeader} from "./page-header.js";
/* global initButton */
import {Enumerable, DescribeInfo} from "./data-load.js";
import {QueryHistory, HistoryBox} from "./history-box.js";
import {Editor} from "./editor.js";
import {ApexAutocompleteModel} from "./apex-autocomplete.js";
import {ScrollTable, TableModel, RecordTable} from "./record-table.js";
import {AIAssistant} from "./ai-assistant.js";

class Model extends ApexAutocompleteModel {
  constructor({sfHost, args}) {
    super();
    this.sfHost = sfHost;
    this.tableModel = new TableModel(sfHost, this.didUpdate.bind(this), {"columns": [
      {name: "StartTime", title: "Start time"},
      {name: "LogLength", title: "Length"},
      {name: "LogUser.Name", title: "User"},
      {name: "LogLength", title: "Length"},
      {name: "LogLength", title: "Length"},
      {name: "LogUser", hidden: true},
    ]});
    this.tableJobModel = new TableModel(sfHost, this.didUpdate.bind(this), {"columns": [
      {name: "JobType", title: "Job type"},
      {name: "ApexClass", hidden: true},
      {name: "ApexClass.Name", title: "Apex class"},
      {name: "CreatedBy", hidden: true},
      {name: "CreatedBy.Name", title: "Created by"},
      {name: "CompletedDate", title: "Completed at"},
      {name: "CreatedDate", title: "Created at"},
      {name: "ExtendedStatus", title: "Detail status"},
      {name: "TotalJobItems", title: "Total"},
      {name: "JobItemsProcessed", title: "Processed"},
      {name: "NumberOfErrors", title: "Errors"},
    ]});
    this.tableTestModel = new TableModel(sfHost, this.didUpdate.bind(this), {"columns": [
      {name: "AsyncApexJobId", title: "Job id"},
      {name: "ApexClass", hidden: true},
      {name: "ApexClassId", title: "Apex class Id"},
      {name: "ApexClass.Name", title: "Apex class"},
      {name: "MethodName", title: "Method"},
      {name: "ApexTestRunResultId", hidden: true},
      {name: "Outcome", title: "Outcome"},
      {name: "Message", title: "Message"},
      {name: "StackTrace", title: "Stack trace"}
    ]});
    this.tableCoverageModel = new TableModel(sfHost, this.didUpdate.bind(this), {"columns": [
      {name: "ApexClassOrTrigger", hidden: true},
      {name: "ApexClassOrTriggerId", title: "Id"},
      {name: "ApexClassOrTrigger.Name", title: "ApexClass / Trigger"},
      {name: "NumLinesCovered", title: "Lines covered"},
      {name: "NumLinesUncovered", title: "Lines uncovered"}
    ]});
    this.resultsFilter = "";
    this.showLoopParameter = false;
    this.loopCount = 1;
    this.loopDelay = 0;
    this.loopContinueOnError = false;
    this.openLogOnExecute = true;
    this.runningTestId = null;
    this.testStatus = "PENDING";
    this.initialScript = "";
    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.editorAutocompleteHandler({newDescribe: true});
      this.enableLogs();
      //TODO refresh list of field
      this.didUpdate();
    });

    this.spinnerCount = 0;
    this.showHelp = false;
    this.userId = null;
    this.timeout = null;
    this.winInnerHeight = 0;
    this.isWorking = false;
    this.executeStatus = "Ready";
    this.executeError = null;
    this.confirmPopup = null;
    this.logs = null;
    this.jobs = null;
    this.tests = null;
    this.coverages = null;
    this.aiAssistant = new AIAssistant();
    this.aiGenerating = false;
    this.aiError = null;
    function compare(a, b) {
      return ((a.script == b.script && (!b.name || a.name == b.name)) || a.script == b.name + ":" + b.script);
    }
    function sort(a, b) {
      return ((a.name ? a.name + a.script : a.script) > (b.name ? b.name + b.script : b.script)) ? 1 : (((b.name ? b.name + b.script : b.script) > (a.name ? a.name + a.script : a.script)) ? -1 : 0);
    }
    this.scriptHistory = new QueryHistory("insextScriptHistory", 100, compare, sort);
    this.selectedHistoryEntry = null;
    this.savedHistory = new QueryHistory("insextSavedScriptHistory", 50, compare, sort);
    this.selectedSavedEntry = null;
    this.expandAutocomplete = false;
    this.expandSavedOptions = false;
    this.scriptName = "";
    this.clientId = localStorage.getItem(sfHost + "_clientId") ? localStorage.getItem(sfHost + "_clientId") : "";
    let scriptTemplatesRawValue = localStorage.getItem("scriptTemplates");
    if (scriptTemplatesRawValue) {
      try {
        this.scriptTemplates = JSON.parse(scriptTemplatesRawValue);
      } catch (err) {
        //try old format which do not support comments
        this.scriptTemplates = scriptTemplatesRawValue.split("//");
      }
    } else {
      this.scriptTemplates = [
        "Id batchId= Database.executeBatch(new BatchExample(), 200);",
        "ID jobID = System.enqueueJob(new AsyncExecutionExample());"
      ];
      localStorage.setItem("scriptTemplates", JSON.stringify(this.scriptTemplates));
    }


    this.spinFor(sfConn.getUserInfo().then(res => {
      this.userId = res.userId;
    }));

    if (args.has("script")) {
      this.initialScript = args.get("script");
    } else if (this.scriptHistory.list[0]) {
      this.initialScript = this.scriptHistory.list[0].script;
    } else {
      this.initialScript = "";
    }

  }
  updatedLogs() {
    if (this.logs != null) {
      let c = this.logs.columnIdx.get("LogLength");
      //skip header line
      for (let i = 1; i < this.logs.table.length; i++) {
        const row = this.logs.table[i];
        if (row[c]){
          row[c] = makeReadableSize(row[c]);
        }
      }
    }
    this.tableModel.dataChange(this.logs);
  }
  updatedJobs() {
    this.tableJobModel.dataChange(this.jobs);
  }
  updatedTests() {
    this.tableTestModel.dataChange(this.tests);
  }
  updatedCoverages() {
    if (this.coverages != null){
      let c;
      if (this.coverages.columnIdx.has("Coverage")) {
        c = this.coverages.columnIdx.get("Coverage");
      } else {
        c = this.coverages.header.length;
        this.coverages.columnIdx.set("Coverage", c);
        this.coverages.header[c] = "Coverage";
        this.coverages.colVisibilities.push(true);
        this.coverages.bgColors = new Map();
      }
      //skip header line
      for (let i = 1; i < this.coverages.table.length; i++) {
        const row = this.coverages.table[i];
        let NumLinesCovered = row[this.coverages.columnIdx.get("NumLinesCovered")];
        let NumLinesUncovered = row[this.coverages.columnIdx.get("NumLinesUncovered")];
        let pct = Math.floor((NumLinesCovered * 100) / (NumLinesCovered + NumLinesUncovered));
        if (pct < 75) {
          this.coverages.bgColors.set(`${i}-${c}`, "Salmon");
        }
        row[c] = pct + "%";
      }
    }
    this.tableCoverageModel.dataChange(this.coverages);
  }
  setscriptName(value) {
    this.scriptName = value;
  }
  setClientId(value) {
    this.clientId = value;
  }
  setEditor(editor) {
    this.editor = editor;
    editor.value = this.initialScript;
    this.editHistory.attach(editor);
    this.initialScript = null;
  }
  toggleHelp() {
    this.showHelp = !this.showHelp;
  }
  toggleSavedOptions() {
    this.expandSavedOptions = !this.expandSavedOptions;
  }
  selectHistoryEntry() {
    if (this.selectedHistoryEntry != null) {
      this.editor.value = this.selectedHistoryEntry.script;
      this.editHistory.record();
      this.editorAutocompleteHandler();
      this.selectedHistoryEntry = null;
    }
  }
  selectScript(val) {
    this.editor.value = val.value.trimStart();
    this.editHistory.record();
    this.editor.focus();
  }
  addToHistory() {
    this.savedHistory.add({script: this.editor.value, name: this.scriptName, tags: []});
  }
  saveClientId() {
    localStorage.setItem(this.sfHost + "_clientId", this.clientId);
  }
  removeFromHistory() {
    this.savedHistory.remove({script: this.editor.value, name: this.scriptName});
  }
  autocompleteReload() {
    this.describeInfo.reloadAll();
  }
  /**
   * Notify React that we changed something, so it will rerender the view.
   * Should only be called once at the end of an event or asynchronous operation, since each call can take some time.
   * All event listeners (functions starting with "on") should call this function if they update the model.
   * Asynchronous operations should use the spinFor function, which will call this function after the asynchronous operation completes.
   * Other functions should not call this function, since they are called by a function that does.
   * @param cb A function to be called once React has processed the update.
   */
  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
    }
    if (this.testCallback) {
      this.testCallback();
    }
  }
  /**
   * Show the spinner while waiting for a promise.
   * didUpdate() must be called after calling spinFor.
   * didUpdate() is called when the promise is resolved or rejected, so the caller doesn't have to call it, when it updates the model just before resolving the promise, for better performance.
   * @param promise The promise to wait for.
   */
  spinFor(promise) {
    this.spinnerCount++;
    promise
      .catch(err => {
        console.error("spinFor", err);
      })
      .then(() => {
        this.spinnerCount--;
        this.didUpdate();
      })
      .catch(err => console.log("error handling failed", err));
  }

  batchHandler(batch, vm, logs, onData) {
    return batch.catch(err => {
      if (err.name == "AbortError") {
        return {records: [], done: true, totalSize: -1};
      }
      throw err;
    }).then(data => {
      logs.addToTable(data.records);
      if (data.totalSize != -1) {
        logs.totalSize = data.totalSize;
      }
      if (!data.done) {
        let pr = vm.batchHandler(sfConn.rest(data.nextRecordsUrl, {}), vm, logs, onData);
        vm.executeError = null;
        onData(false);
        vm.didUpdate();
        return pr;
      }
      if (logs.records.length == 0) {
        vm.executeError = null;
        onData(true);
        return null;
      }
      vm.executeError = null;
      onData(true);
      return null;
    }, err => {
      if (err.name != "SalesforceRestError") {
        throw err; // not a SalesforceRestError
      }
      if (logs.totalSize != -1) {
        // We already got some data. Show it, and indicate that not all data was executed
        vm.executeError = null;
        onData(true);
        return null;
      }
      vm.executeStatus = "Error";
      vm.executeError = err.message;
      onData(true);
      return null;
    });
  }
  doExecute(loopIndex) {
    let vm = this; // eslint-disable-line consistent-this
    //if polling have been stoped resume it.
    if (!vm.isWorking) {
      this.enableLogs();
    }
    vm.executeError = null;
    let script = vm.editor.value;
    vm.spinFor(sfConn.rest("/services/data/v" + apiVersion + "/tooling/executeAnonymous/?anonymousBody=" + encodeURIComponent(script), {})
      .catch(error => {
        console.error(error);
        vm.executeStatus = "Error";
        vm.executeError = "UNEXPECTED EXCEPTION:" + error;
        vm.logs = null;
        vm.updatedLogs();
      })
      .then(result => {
        vm.autocompleteProgress = {};
        loopIndex--;
        if (!result) {
          if (loopIndex > 0 && vm.loopContinueOnError) {
            if (vm.loopDelay == 0) {
              vm.doExecute(loopIndex);
            } else {
              setTimeout(() => {
                vm.doExecute(loopIndex);
              }, vm.loopDelay);
            }
          }
          return;
        }
        if (result.success != true) {
          let error = "";
          if (!result.compiled) {
            error += result.line != -1 ? " (line :" + result.line + ", column :" + result.column + ") " : "";
            if (result.compileProblem != null) {
              error += result.compileProblem + "\n";
            }
          } else {
            vm.scriptHistory.add({script});
            if (result.exceptionMessage != null) {
              error += "UNEXPECTED EXCEPTION:" + result.exceptionMessage;
            }
            if (result.exceptionStackTrace != null) {
              error += result.exceptionStackTrace;
            }
          }
          console.error(error);
          vm.executeStatus = "Error";
          vm.executeError = error;
          vm.logs = null;
          vm.updatedLogs();
        } else if (loopIndex == this.loopCount - 1) {
          //open only the first log
          if (this.openLogOnExecute) {
            let logQuery = `SELECT Id FROM ApexLog WHERE Operation='/services/data/v${apiVersion}/tooling/executeAnonymous/' AND LogUserId='${this.userId}' ORDER BY StartTime DESC LIMIT 1`;
            vm.spinFor(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(logQuery), {})
              .then(logResult => {
                if (logResult && logResult.records && logResult.records.length > 0) {
                  let logId = logResult.records[0].Id;
                  let queryLogArgs = new URLSearchParams();
                  queryLogArgs.set("host", vm.sfHost);
                  queryLogArgs.set("recordId", logId);
                  // Open the log in a new tab
                  window.open(`log.html?${queryLogArgs}`, "_blank");
                }
              })
            );
          }
          vm.scriptHistory.add({script});
        }
        if (loopIndex > 0 && (result.success == true || (vm.loopContinueOnError && result.compiled == true))) {
          if (vm.loopDelay == 0) {
            vm.doExecute(loopIndex);
          } else {
            setTimeout(() => {
              vm.doExecute(loopIndex);
            }, vm.loopDelay);
          }
        }
      }));
  }
  stopExecute() {
    this.disableLogs();
  }
  disableLogs() {
    clearTimeout(this.timeout);
    this.executeStatus = "Stop polling";
    this.isWorking = false;
  }
  getTraceFlags(DTnow, debugTimeInMs){
    try {
      const expirationDate = new Date(DTnow.getTime() + debugTimeInMs);
      let query = `query/?q=+SELECT+Id,ExpirationDate+FROM+TraceFlag+WHERE+TracedEntityid='${this.userId}'+`
                  + `AND+DebugLevel.DeveloperName='SFDC_DevConsole'+AND+StartDate<${DTnow.toISOString()}+AND+ExpirationDate<${expirationDate.toISOString()}`;
      return sfConn.rest("/services/data/v" + apiVersion + "/tooling/" + query, {method: "GET"});
    } catch (e){
      console.error(e);
      return null;
    }
  }
  insertTraceFlag(debugLogId, DTnow, debugTimeInMs){
    try {
      let newTraceFlag
          = {
            TracedEntityId: this.userId,
            DebugLevelId: debugLogId,
            LogType: "DEVELOPER_LOG",
            StartDate: DTnow,
            ExpirationDate: (DTnow.getTime() + debugTimeInMs),

          };
      return sfConn.rest("/services/data/v" + apiVersion + "/tooling/sobjects/traceflag", {method: "POST", body: newTraceFlag});
    } catch (e){
      console.error(e);
      return null;
    }
  }

  extendTraceFlag(traceFlagId, DTnow, debugTimeInMs){
    try {
      let traceFlagToUpdate = {StartDate: DTnow, ExpirationDate: (DTnow.getTime() + debugTimeInMs)};
      return sfConn.rest("/services/data/v" + apiVersion + "/tooling/sobjects/traceflag/" + traceFlagId, {method: "PATCH", body: traceFlagToUpdate});
    } catch (e){
      console.error(e);
      return null;
    }
  }
  getDebugLog(){
    try {
      let query = "query/?q=+SELECT+Id+FROM+DebugLevel+WHERE+DeveloperName='SFDC_DevConsole'";
      return sfConn.rest("/services/data/v" + apiVersion + "/tooling/" + query, {method: "GET"});
    } catch (e){
      console.error(e);
      return null;
    }
  }
  resumePolling() {
    let vm = this; // eslint-disable-line consistent-this
    this.executeStatus = "Polling finished";
    this.isWorking = false;
    this.confirmPopup = {
      text: "Resume Polling of logs?",
      onYes: () => vm.enableLogs()
    };
    this.didUpdate();
  }
  confirmPopupYes() {
    let onYes = this.confirmPopup && this.confirmPopup.onYes;
    this.confirmPopup = null;
    if (onYes) {
      onYes();
    }
  }
  confirmPopupNo() {
    let onNo = this.confirmPopup && this.confirmPopup.onNo;
    this.confirmPopup = null;
    if (onNo) {
      onNo();
    }
  }
  async enableLogs() {
    const DTnow = new Date(Date.now());
    let debugLogTimeMinutes = localStorage.getItem("debugLogTimeMinutes");
    if (debugLogTimeMinutes == null) {
      localStorage.setItem("debugLogTimeMinutes", 15);
    }
    const debugTimeInMs = debugLogTimeMinutes * 60 * 1000;

    let traceFlags = await this.getTraceFlags(DTnow, debugTimeInMs);
    /*If an old trace flag is found on the user and with this debug level
     *Update the trace flag extending the experiation date.
     */
    if (traceFlags.size > 0){
      this.extendTraceFlag(traceFlags.records[0].Id, DTnow, debugTimeInMs);
    //Else create new trace flag
    } else {
      let debugLog = await this.getDebugLog();

      if (debugLog && debugLog.size > 0){
        this.insertTraceFlag(debugLog.records[0].Id, DTnow, debugTimeInMs);
      } else {
        throw new Error('Debug Level with developerName = "SFDC_DevConsole" not found');
      }
    }
    let vm = this; // eslint-disable-line consistent-this
    vm.isWorking = true;
    vm.executeStatus = "Polling logs";
    //after 15 min auto disable logs
    this.timeout = setTimeout(() => {
      vm.resumePolling();
    }, debugTimeInMs);

    //start to poll logs
    vm.pollLogs(vm);
  }

  async pollLogs(vm) {
    await this.queryLogsAndJobs(vm);
    await this.queryTestResults(vm);
    let pollId = 1;
    let handshake = await sfConn.rest("/cometd/" + apiVersion, {
      method: "POST",
      body: [
        {
          "version": "1.0",
          "minimumVersion": "0.9",
          "channel": "/meta/handshake",
          "supportedConnectionTypes": ["long-polling", "callback-polling"],
          "advice": {"timeout": 60000, "interval": 0},
          "id": pollId.toString()
        }],
      bodyType: "json",
      headers: {}
    });
    pollId++;
    if (Array.isArray(handshake)) {
      handshake = handshake[0];
    }
    if (handshake == null || !handshake.successful) {
      console.log("handshake failed");
      return;
    }

    let subResponse = await sfConn.rest("/cometd/" + apiVersion, {
      method: "POST",
      body: [
        {
          "channel": "/meta/subscribe",
          "subscription": "/systemTopic/Logging",
          "id": (pollId++).toString(),
          "clientId": handshake.clientId
        }, {
          "channel": "/meta/subscribe",
          "subscription": "/systemTopic/TestResult",
          "id": (pollId++).toString(),
          "clientId": handshake.clientId
        }],
      bodyType: "json",
      headers: {}
    });

    if (subResponse == null || !Array.isArray(subResponse) || !subResponse[0].successful) {
      console.log("subscription failed");
      return;
    }
    // other topic of dev console : /systemTopic/ApexExecutionOverlayResult /systemTopic/TestResult /systemTopic/ContainerDeployStateChange
    let advice = null;
    while (vm.isWorking) {
      let response = await sfConn.rest("/cometd/" + apiVersion, {
        method: "POST",
        body: [
          {
            "channel": "/meta/connect",
            "connectionType": "long-polling",
            "advice": advice || {"timeout": 0},
            "id": pollId.toString(),
            "clientId": handshake.clientId
          }],
        bodyType: "json",
        headers: {}
      });
      pollId++;
      if (response == null || !Array.isArray(response)) {
        vm.executeStatus = "Error";
        vm.executeError = "Polling failed with empty response.";
        vm.isWorking = false;
        console.log("polling failed");
        return;
      }
      /**
     [
    {
        "clientId": "32o1j87opqgok6ekw51i9pev3sje",
        "advice": {
            "interval": 2000,
            "multiple-clients": true,
            "reconnect": "retry",
            "timeout": 110000
        },
        "channel": "/meta/connect",
        "id": "8",
        "successful": true
    }
]
     */
      let rspFailed = response.find(rsp => rsp == null || (rsp.data == null && !rsp.successful));
      if (rspFailed) {
        vm.executeStatus = "Error";
        vm.executeError = rspFailed.error;
        vm.isWorking = false;
        console.log("polling failed:" + rspFailed.error);
        return;
      }
      let arsp = response.find(rsp => rsp != null && rsp.successful);
      if (arsp) {
        advice = arsp.advice;
      }
      if (response.find(rsp => rsp != null && rsp.data != null && rsp.channel == "/systemTopic/Logging")) {
        await this.queryLogsAndJobs(vm);
      }
      if (response.find(rsp => rsp != null && rsp.data != null && rsp.channel == "/systemTopic/TestResult")) {
        await this.queryTestResults(vm);
      }
    }
  }
  async queryTestResults(vm) {
    let tests;
    let querytests;
    if (this.runningTestId) {
      tests = new RecordTable();
      tests.describeInfo = vm.describeInfo;
      tests.sfHost = vm.sfHost;
      querytests = `SELECT AsyncApexJobId, ApexClassId, ApexClass.Name, MethodName, ApexTestRunResultId, Outcome, Message, StackTrace FROM ApexTestResult WHERE AsyncApexJobId = '${this.runningTestId}'`;
      this.tests = null;
    }
    let coverages = new RecordTable();
    coverages.describeInfo = vm.describeInfo;
    coverages.sfHost = vm.sfHost;
    let querycoverages = "SELECT ApexClassOrTriggerId, ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId != NULL AND ApexClassOrTrigger.Name != NULL AND (NumLinesCovered > 0 OR NumLinesUncovered > 0) AND NumLinesCovered != NULL AND NumLinesUncovered != NULL ORDER BY ApexClassOrTrigger.Name";
    this.coverages = null;
    vm.updatedCoverages();
    if (this.runningTestId) {
      vm.updatedTests();
      await vm.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(querytests), {}), vm, tests, () => {
        vm.tests = tests;
        vm.updatedTests();
      }).catch(error => {
        console.error(error);
        vm.isWorking = false;
        vm.executeStatus = "Error";
        vm.executeError = "UNEXPECTED EXCEPTION:" + error;
        vm.tests = null;
      });
    }
    await vm.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(querycoverages), {}), vm, coverages, () => {
      vm.coverages = coverages;
      vm.updatedCoverages();
    }).catch(error => {
      console.error(error);
      vm.isWorking = false;
      vm.executeStatus = "Error";
      vm.executeError = "UNEXPECTED EXCEPTION:" + error;
      vm.coverages = null;
    });
  }
  async queryLogsAndJobs(vm) {
    let logs = new RecordTable();
    logs.describeInfo = vm.describeInfo;
    logs.sfHost = vm.sfHost;
    let jobs = new RecordTable();
    jobs.describeInfo = vm.describeInfo;
    jobs.sfHost = vm.sfHost;
    let queryLogs = "SELECT Id, Application, Status, Operation, StartTime, LogLength, DurationMilliseconds, LogUser.Name FROM ApexLog ORDER BY StartTime DESC LIMIT 100";
    let queryJobs = "SELECT Id, JobType, ApexClass.Name, CompletedDate, CreatedBy.Name, CreatedDate, ExtendedStatus, TotalJobItems , JobItemsProcessed, NumberOfErrors, Status FROM AsyncApexJob WHERE JobType in ('BatchApex', 'Queueable') ORDER BY CreatedDate desc LIMIT 100";
    //logs.resetTable();
    this.logs = null;
    vm.updatedLogs();
    this.jobs = null;
    vm.updatedJobs();
    await vm.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryLogs), {}), vm, logs, () => {
      vm.logs = logs;
      vm.updatedLogs();
    })
      .catch(error => {
        console.error(error);
        vm.isWorking = false;
        vm.executeStatus = "Error";
        vm.executeError = "UNEXPECTED EXCEPTION:" + error;
        vm.logs = null;
      });
    await vm.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryJobs), {}), vm, jobs, () => {
      vm.jobs = jobs;
      vm.updatedJobs();
    })
      .catch(error => {
        console.error(error);
        vm.isWorking = false;
        vm.executeStatus = "Error";
        vm.executeError = "UNEXPECTED EXCEPTION:" + error;
        vm.logs = null;
      });
  }
  setResultsFilter(value) {
    this.resultsFilter = value;
    if (this.jobs) {
      this.jobs.updateVisibility(value);
      this.updatedJobs();
    }
    if (this.logs) {
      this.logs.updateVisibility(value);
      this.updatedLogs();
    }
    if (this.tests) {
      this.tests.updateVisibility(value);
      this.updatedTests();
    }
    if (this.coverages) {
      this.coverages.updateVisibility(value);
      this.updatedCoverages();
    }
  }
  recalculateSize() {
    // Investigate if we can use the IntersectionObserver API here instead, once it is available.
    this.tableModel.viewportChange();
    this.tableJobModel.viewportChange();
    if (this.testStatus != "PENDING") {
      this.tableTestModel.viewportChange();
      this.tableCoverageModel.viewportChange();
    }
  }
  getHistory() {
    let historyMap = new Map();
    this.scriptHistory.list.forEach(q => {
      const script = q.script ?? q.value;
      historyMap.set(script, {value: script, label: script.substring(0, 300), favorite: false, tags: q.tags || []});
    });
    this.scriptTemplates.forEach(q => historyMap.set(q, {value: q, label: q, favorite: true}));
    this.savedHistory.list.forEach(q => {
      let delimiter = ":";
      let itm;
      if (q.name){
        itm = {value: q.script, label: q.name, name: q.name, favorite: true, tags: q.tags || []};
      } else if (q.script.includes(delimiter)){
        itm = {label: q.script.split(delimiter)[0], favorite: true, tags: q.tags || []};
        itm.name = itm.label;
        itm.value = q.script.substring(itm.label.length + 1);
      } else {
        itm = {value: q.script, label: q.script, favorite: true, tags: q.tags || []};
      }
      historyMap.set(itm.value, itm);
    });
    return Array.from(historyMap.values());
  }
  toggleLoopParameter(){
    this.showLoopParameter = !this.showLoopParameter;
  }
  setLoopCount(count){
    this.loopCount = count;
  }
  setLoopDelay(delay){
    this.loopDelay = delay;
  }
  setLoopContinueOnError(continueOnError){
    this.loopContinueOnError = continueOnError;
  }

  deleteHistoryItem(history) {
    let itm = this.savedHistory.list.find(item => ((item.script == history.value && item.name && item.name == history.label) || (item.script == history.label + ":" + history.value) || (item.script == history.value && item.script == history.label)));
    if (itm) {
      this.savedHistory.remove(itm);
      return;
    }
    const templateIndex = this.scriptTemplates.indexOf(history.value);
    if (templateIndex > -1) {
      this.scriptTemplates.splice(templateIndex, 1);
      localStorage.setItem("scriptTemplates", JSON.stringify(this.scriptTemplates));
      return;
    }
    itm = this.scriptHistory.list.find(item => item.script == history.value);
    if (itm) {
      this.scriptHistory.remove(itm);
      return;
    }
  }
  updateHistoryItem(history) {
    if (history.favorite) {
      // For saved scripts (favorites), find and update in savedHistory
      // Match by script value (name might be changing, so don't match by name)
      let itm = this.savedHistory.list.find(item =>
        item.script == history.value
      );
      if (itm) {
        // Use tags from history if provided, otherwise preserve existing tags
        const tagsToUse = Array.isArray(history.tags) ? history.tags : (itm.tags || []);
        // Remove old entry
        this.savedHistory.remove(itm);
        // Add updated entry with new name and tags
        let newSaved = {script: history.value, name: history.name, tags: tagsToUse};
        this.savedHistory.add(newSaved);
      }
    } else {
      // For regular history items, check if they're in savedHistory first
      let itm = this.savedHistory.list.find(item => (item.script == history.value && item.name && item.name == history.label) || (item.script == history.label + ":" + history.value) || (item.script == history.value && item.script == history.label));
      if (itm) {
        this.savedHistory.remove(itm);
      } else {
        let templateIndex = this.scriptTemplates.indexOf(history.value);
        if (templateIndex > -1) {
          this.scriptTemplates.splice(templateIndex, 1);
          localStorage.setItem("scriptTemplates", JSON.stringify(this.scriptTemplates));
        }
      }
      // Find existing history item to preserve tags
      let existingHistory = this.scriptHistory.list.find(item => item.script == history.value);
      let newHistory = {script: history.value};
      if (itm && itm.name) {
        newHistory.name = itm.name;
      }
      // Preserve tags from history object or existing history item
      if (Array.isArray(history.tags) && history.tags.length > 0) {
        newHistory.tags = history.tags;
      } else if (existingHistory && existingHistory.tags) {
        newHistory.tags = existingHistory.tags;
      }
      this.scriptHistory.add(newHistory);
    }
  }

  /**
   * Returns Apex class / SObject suggestions for the "@" mention autocomplete in the AI prompt box.
   */
  getMentionSuggestions(searchTerm) {
    let {globalDescribe, globalStatus} = this.describeInfo.describeGlobal(false);
    return new Enumerable(this.apexClasses.records)
      .filter(c => !c.NamespacePrefix && c.Name.toLowerCase().includes(searchTerm.toLowerCase()))
      .map(c => ({value: c.Name, title: c.Name, rank: 4, autocompleteType: "class"}))
      .concat(
        new Enumerable(globalStatus == "ready" ? globalDescribe.sobjects : [])
          .filter(o => o.name.toLowerCase().includes(searchTerm.toLowerCase()))
          .map(o => ({value: o.name, title: o.label && o.label != o.name ? `${o.name} (${o.label})` : o.name, rank: 6, autocompleteType: "object"}))
      )
      .toArray()
      .sort(this.resultsSort(searchTerm))
      .slice(0, 20);
  }

  /**
   * Fetches the source body of the Apex classes referenced with "@" in the AI prompt, to give the AI real context.
   */
  async getApexClassBodies(classNames) {
    if (!classNames || classNames.length === 0) {
      return [];
    }
    try {
      let query = "SELECT Id, Name, NamespacePrefix, Body FROM ApexClass WHERE Name in (" + classNames.map(c => "'" + c.replace(/'/g, "\\'") + "'").join(",") + ")";
      let result = await sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query), {});
      return (result.records || []).map(r => ({name: r.Name, body: r.Body}));
    } catch (error) {
      console.warn("Error fetching Apex class bodies for AI context:", error);
      return [];
    }
  }

  /**
   * Fetches field describe info for the SObjects referenced with "@" in the AI prompt, to give the AI real context.
   */
  async getObjectFieldsForContext(objectNames) {
    const objectsWithFields = [];
    for (const objectName of objectNames) {
      try {
        let describe = await this.describeInfo.describeSobjectPromise(false, objectName);
        objectsWithFields.push({
          name: objectName,
          label: describe.label || objectName,
          fields: describe.fields.slice(0, 100).map(f => ({name: f.name, label: f.label, type: f.type}))
        });
      } catch (error) {
        console.warn(`Error getting fields for ${objectName}:`, error);
      }
    }
    return objectsWithFields;
  }

  async generateApexWithAI(description, mentions = []) {
    if (!description || description.trim() === "") {
      this.aiError = "Please enter a description of the desired Apex script.";
      this.didUpdate();
      return;
    }

    const selectedProvider = localStorage.getItem("aiProvider_selected") || "";
    const apiKey = selectedProvider === "agentforce" ? null : localStorage.getItem(`aiProvider_${selectedProvider}_apiKey`);
    const promptTemplateName = selectedProvider === "agentforce" ? localStorage.getItem("aiProvider_agentforce_apexPromptTemplateName") : null;

    if (!selectedProvider) {
      this.aiError = "No AI provider configured. Please configure one in the options.";
      this.didUpdate();
      return;
    } else if (selectedProvider === "agentforce") {
      if (!promptTemplateName || promptTemplateName.trim() === "") {
        this.aiError = "Prompt template name not configured for AgentForce. Please configure it in the options.";
        this.didUpdate();
        return;
      }
    } else if (!apiKey || apiKey.trim() === "") {
      this.aiError = `API key not configured for ${this.aiAssistant.providers[selectedProvider]?.name || selectedProvider}. Please configure it in the options.`;
      this.didUpdate();
      return;
    }

    this.aiGenerating = true;
    this.aiError = null;
    this.didUpdate();

    try {
      let {globalDescribe, globalStatus} = this.describeInfo.describeGlobal(false);
      let mentionedClassNames = mentions.filter(name => this.apexClasses.records.some(c => !c.NamespacePrefix && c.Name == name));
      let mentionedObjectNames = mentions.filter(name => globalStatus == "ready" && globalDescribe.sobjects.some(o => o.name == name));

      const [mentionedClasses, mentionedObjects] = await Promise.all([
        this.getApexClassBodies(mentionedClassNames),
        this.getObjectFieldsForContext(mentionedObjectNames)
      ]);

      const context = {
        mentionedClasses,
        mentionedObjects,
        currentScript: this.editor ? this.editor.value : null,
        promptTemplateName
      };

      const apexCode = await this.aiAssistant.generateApex(description, selectedProvider, apiKey, context);

      if (this.editor) {
        this.editor.value = apexCode;
        this.editHistory.record();
        this.editorAutocompleteHandler();
      }

      this.aiError = null;
    } catch (error) {
      console.error("Error generating Apex script:", error);
      this.aiError = error.message || "Error generating Apex script.";
    } finally {
      this.aiGenerating = false;
      this.didUpdate();
    }
  }
}

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onSelectScript = this.onSelectScript.bind(this);
    this.onAddToHistory = this.onAddToHistory.bind(this);
    this.onSaveClientId = this.onSaveClientId.bind(this);
    this.onToggleHelp = this.onToggleHelp.bind(this);
    this.onToggleSavedOptions = this.onToggleSavedOptions.bind(this);
    this.onExecute = this.onExecute.bind(this);
    this.onCopyScript = this.onCopyScript.bind(this);
    this.onSetscriptName = this.onSetscriptName.bind(this);
    this.onSetClientId = this.onSetClientId.bind(this);
    this.onStopExecute = this.onStopExecute.bind(this);
    this.onClick = this.onClick.bind(this);
    this.openEmptyLog = this.openEmptyLog.bind(this);
    this.onTabSelect = this.onTabSelect.bind(this);
    this.runTests = this.runTests.bind(this);
    this.deleteAllLog = this.deleteAllLog.bind(this);
    this.onResultsFilterInput = this.onResultsFilterInput.bind(this);
    this.onUpdateHistoryItem = this.onUpdateHistoryItem.bind(this);
    this.onDeleteHistoryItem = this.onDeleteHistoryItem.bind(this);
    this.onToggleOpenLogOnExecute = this.onToggleOpenLogOnExecute.bind(this);
    this.onToggleLoopParameter = this.onToggleLoopParameter.bind(this);
    this.onLoopCountChange = this.onLoopCountChange.bind(this);
    this.onLoopDelayChange = this.onLoopDelayChange.bind(this);
    this.onLoopContinueOnErrorChange = this.onLoopContinueOnErrorChange.bind(this);
    this.onConfirmPopupYesClick = this.onConfirmPopupYesClick.bind(this);
    this.onConfirmPopupNoClick = this.onConfirmPopupNoClick.bind(this);
    this.onGenerateWithAI = this.onGenerateWithAI.bind(this);
    this.onAIDescriptionChange = this.onAIDescriptionChange.bind(this);
    this.onAIDescriptionKeyDown = this.onAIDescriptionKeyDown.bind(this);
    this.onCloseAIModal = this.onCloseAIModal.bind(this);
    this.onSelectMention = this.onSelectMention.bind(this);
    this.onAITextareaRef = this.onAITextareaRef.bind(this);
    this.handleAIGenerate = this.handleAIGenerate.bind(this);
    this.aiTextareaRef = null;
    this.state = {
      selectedTabId: 1,
      showAIModal: false,
      aiDescription: "",
      showMentionSuggestions: false,
      mentionSuggestions: [],
      mentionActiveIndex: 0,
      mentionStart: -1,
      mentionQuery: ""
    };
  }
  onTabSelect(e) {
    e.preventDefault();
    this.setState({selectedTabId: e.target.tabIndex});
  }
  onClick(){
    let {model} = this.props;
    if (model && model.tableModel) {
      model.tableModel.onClick();
    }
    if (model && model.tableJobModel) {
      model.tableJobModel.onClick();
    }
    if (model && model.testStatus != "PENDING" && model.tableTestModel) {
      model.tableTestModel.onClick();
    }
    if (model && model.testStatus != "PENDING" && model.tableCoverageModel) {
      model.tableCoverageModel.onClick();
    }
  }
  onSelectScript(input) {
    let {model} = this.props;
    model.selectScript(input);
    model.didUpdate();
  }
  onAddToHistory(e) {
    e.preventDefault();
    let {model} = this.props;
    model.addToHistory();
    model.didUpdate();
  }
  onSaveClientId(e) {
    e.preventDefault();
    let {model} = this.props;
    model.saveClientId();
    model.didUpdate();
  }
  onToggleHelp(e) {
    e.preventDefault();
    let {model} = this.props;
    model.toggleHelp();
    model.didUpdate();
  }
  onToggleSavedOptions(e) {
    e.preventDefault();
    let {model} = this.props;
    model.toggleSavedOptions();
    model.didUpdate();
  }
  onToggleLoopParameter() {
    let {model} = this.props;
    model.toggleLoopParameter();
    model.didUpdate();
  }
  onLoopCountChange(e) {
    let {model} = this.props;
    model.setLoopCount(e.target.value);
    model.didUpdate();
  }
  onLoopDelayChange(e) {
    let {model} = this.props;
    model.setLoopDelay(e.target.value);
    model.didUpdate();
  }
  onLoopContinueOnErrorChange(e) {
    let {model} = this.props;
    model.setLoopContinueOnError(e.target.checked);
    model.didUpdate();
  }
  onExecute() {
    let {model} = this.props;
    model.doExecute(model.loopCount);
    model.didUpdate();
  }
  onCopyScript() {
    let {model} = this.props;
    let url = new URL(window.location.href);
    let searchParams = url.searchParams;
    searchParams.set("script", model.editor.value);
    url.search = searchParams.toString();
    navigator.clipboard.writeText(url.toString());
    navigator.clipboard.writeText(url.toString());
    model.didUpdate();
  }
  onSetscriptName(e) {
    let {model} = this.props;
    model.setscriptName(e.target.value);
    model.didUpdate();
  }
  onSetClientId(e) {
    let {model} = this.props;
    model.setClientId(e.target.value);
    model.didUpdate();
  }
  onStopExecute() {
    let {model} = this.props;
    model.stopExecute();
    model.didUpdate();
  }
  deleteAllLog(e){
    let {model} = this.props;
    sfConn.rest(`/services/data/v${apiVersion}/query/?q=SELECT+Id+FROM+Apexlog`, {}).then(result => {
      let separator = getSeparator();
      let data = `"_"${separator}"Id"\r\n`;
      data += result.records.map(r => `"[Apexlog]"${separator}"${r.Id}"`).join("\r\n");
      let encodedData = window.btoa(data);
      let args = new URLSearchParams();
      args.set("host", model.sfHost);
      args.set("data", encodedData);
      window.open("data-import.html?" + args, getLinkTarget(e));
    }).catch(error => {
      console.error(error);
    });
  }
  runTests() {
    let {model} = this.props;
    if (model.runningTestId) {
      model.confirmPopup = {
        text: "Are you sure you want to cancel running tests?",
        onYes: () => {
          sfConn.rest(`/services/data/v${apiVersion}/query/?q=SELECT+Id,+ExtendedStatus,+Status+FROM+ApexTestQueueItem+WHERE+Status+!=+'Completed'+AND+ParentJobId+=+'${model.runningTestId}'`, {}).then(result => {
            let composite = {"compositeRequest": result.records.map((r, i) => ({"method": "POST",
              "url": `/services/data/v${apiVersion}/sobjects/ApexTestQueueItem/${r.Id}`,
              "referenceId": `cancelTest${i}`,
              "body": {"Status": "Aborted"}
            }))};
            sfConn.rest(`/services/data/v${apiVersion}/composite`, {method: "POST", body: composite, headers: {"Content-Type": "application/json"}}).then(() => {
              model.runningTestId = null;
              model.didUpdate();
            });
          }).catch(error => {
            console.error(error);
          });
        }
      };
      model.didUpdate();
      return;
    }
    model.confirmPopup = {
      text: "Are you sure you want to run tests? This will run all tests in the org.",
      onYes: () => {
        model.testStatus = "STARTED";
        let jsonBody = {
          //"classNames": "comma-separated list of class names",
          //"classids": "comma-separated list of class IDs",
          //"suiteNames": "comma-separated list of test suite names",
          //"suiteids": "comma-separated list of test suite IDs",
          //"maxFailedTests": -1,
          "testLevel": "RunLocalTests", //RunSpecifiedTests, RunAllTestsInOrg
          //"skipCodeCoverage": "boolean value"
        };
        sfConn.rest("/services/data/v" + apiVersion + "/tooling/runTestsAsynchronous/", {method: "POST", body: jsonBody}).then(result => {
          model.runningTestId = result;
          model.testStatus = "RUNNING";
          model.didUpdate();
        }).catch(error => {
          if (error.message && error.message.startsWith("ALREADY_IN_PROCESS")) {
            model.testStatus = error.message;
            let qry = "SELECT Id, JobType, Status FROM AsyncApexJob WHERE JobType = 'TestRequest' and status IN ('Processing', 'Holding', 'Preparing')";
            sfConn.rest(`/services/data/v${apiVersion}/query/?q=${encodeURIComponent(qry)}`, {}).then(result => {
              if (result && result.records && result.records.length > 0) {
                model.runningTestId = result;
                model.testStatus = "RUNNING";
                model.didUpdate();
              }
            });
          }
          console.error(error);
          model.didUpdate();
        });
        model.didUpdate();
      }
    };
    model.didUpdate();
  }
  onConfirmPopupYesClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.confirmPopupYes();
    model.didUpdate();
  }
  onConfirmPopupNoClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.confirmPopupNo();
    model.didUpdate();
  }
  onResultsFilterInput(e) {
    let {model} = this.props;
    model.setResultsFilter(e.target.value);
    model.didUpdate();
  }
  openEmptyLog() {
    let queryEmptyLogArgs = new URLSearchParams();
    let {model} = this.props;
    queryEmptyLogArgs.set("host", model.sfHost);
    window.open("log.html?" + queryEmptyLogArgs, "_blank", "noreferrer");
  }
  onUpdateHistoryItem(suggestion) {
    let {model} = this.props;
    model.updateHistoryItem(suggestion);
  }
  onDeleteHistoryItem(suggestion) {
    let {model} = this.props;
    model.deleteHistoryItem(suggestion);
  }
  onToggleOpenLogOnExecute(e) {
    let {model} = this.props;
    model.openLogOnExecute = e.target.checked;
    model.didUpdate();
  }
  onGenerateWithAI() {
    let {model} = this.props;
    model.aiError = null;
    this.setState({showAIModal: true, aiDescription: "", showMentionSuggestions: false, mentionSuggestions: []});
  }
  onAITextareaRef(el) {
    this.aiTextareaRef = el;
  }
  onAIDescriptionChange(e) {
    let {model} = this.props;
    let value = e.target.value;
    let cursor = e.target.selectionStart;
    let mentionMatch = value.substring(0, cursor).match(/@([a-zA-Z0-9_]*)$/);
    if (mentionMatch) {
      let searchTerm = mentionMatch[1];
      this.setState({
        aiDescription: value,
        mentionStart: cursor - mentionMatch[0].length,
        mentionQuery: searchTerm,
        mentionSuggestions: model.getMentionSuggestions(searchTerm),
        showMentionSuggestions: true,
        mentionActiveIndex: 0
      });
    } else {
      this.setState({aiDescription: value, showMentionSuggestions: false, mentionSuggestions: []});
    }
  }
  onSelectMention(item) {
    let {mentionStart, mentionQuery, aiDescription} = this.state;
    let before = aiDescription.substring(0, mentionStart);
    let after = aiDescription.substring(mentionStart + 1 + mentionQuery.length);
    let inserted = "@" + item.value + " ";
    let newValue = before + inserted + after;
    let newCursor = before.length + inserted.length;
    this.setState({aiDescription: newValue, showMentionSuggestions: false, mentionSuggestions: [], mentionQuery: ""});
    if (this.aiTextareaRef) {
      this.aiTextareaRef.focus();
      // setSelectionRange must run after React applies the new value to the textarea.
      setTimeout(() => {
        if (this.aiTextareaRef) {
          this.aiTextareaRef.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
    }
  }
  onAIDescriptionKeyDown(e) {
    if (this.state.showMentionSuggestions && this.state.mentionSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.setState({mentionActiveIndex: (this.state.mentionActiveIndex + 1) % this.state.mentionSuggestions.length});
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.setState({mentionActiveIndex: (this.state.mentionActiveIndex - 1 + this.state.mentionSuggestions.length) % this.state.mentionSuggestions.length});
        return;
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.onSelectMention(this.state.mentionSuggestions[this.state.mentionActiveIndex]);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.setState({showMentionSuggestions: false, mentionSuggestions: []});
        return;
      }
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.handleAIGenerate();
    } else if (e.key === "Escape") {
      this.onCloseAIModal();
    }
  }
  onCloseAIModal() {
    this.setState({showAIModal: false, aiDescription: "", showMentionSuggestions: false, mentionSuggestions: []});
    let {model} = this.props;
    model.aiError = null;
    model.didUpdate();
  }
  async handleAIGenerate() {
    let {model} = this.props;
    if (!this.state.aiDescription || this.state.aiDescription.trim() === "") {
      return;
    }
    let mentions = Array.from(new Set(Array.from(this.state.aiDescription.matchAll(/@([a-zA-Z0-9_]+)/g)).map(m => m[1])));
    await model.generateApexWithAI(this.state.aiDescription, mentions);
    if (!model.aiError) {
      this.setState({showAIModal: false, aiDescription: ""});
    }
  }
  componentDidMount() {
    let {model} = this.props;
    model.autocompleteResultBox = this.refs.autocompleteResultBox;
    model.loadApexClasses().catch(error => console.error(error));
    //call to get all Sobject during load
    model.describeInfo.describeGlobal(false);

    addEventListener("keydown", e => {
      if ((e.ctrlKey && e.key == "Enter") || e.key == "F5") {
        e.preventDefault();
        model.doExecute(model.loopCount);
        model.didUpdate();
      }
    });

    function resize() {
      model.winInnerHeight = innerHeight;
      model.didUpdate(); // Will call recalculateSize
    }
    addEventListener("resize", resize);
    resize();
  }
  componentDidUpdate() {
    let {model} = this.props;
    model.recalculateSize();
  }
  componentWillUnmount() {
    let {model} = this.props;
    model.disableLogs();
  }
  render() {
    let {model} = this.props;
    let suggestionHelper = "";
    if (model.displaySuggestion) {
      suggestionHelper = " Press Esc to hide suggestions";
    } else {
      suggestionHelper = " Press Ctrl+Space to display suggestions";
    }
    let historyList = model.getHistory();

    let keywordColor = new Map([["do", "violet"], ["public", "blue"], ["private", "blue"], ["global", "blue"], ["class", "blue"], ["static", "blue"],
      ["interface", "blue"], ["extends", "blue"], ["while", "violet"], ["for", "violet"], ["try", "violet"], ["catch", "violet"], ["true", "blue"], ["false", "blue"],
      ["finally", "violet"], ["extends", "violet"], ["throw", "violet"], ["new", "violet"], ["if", "violet"], ["else", "violet"]]);
    return h("div", {onClick: this.onClick},
      h(PageHeader, {sfHost: model.sfHost, title: "Script Execute", spinning: model.spinnerCount != 0, options: 5, help: {title: "Execute Help", onClick: this.onToggleHelp}}),
      h("div", {className: "area"},
        h("div", {className: "area-header"},
        ),
        h("div", {className: "query-controls"},
          h("h1", {}, "Execute Script"),
          h(HistoryBox, {title: "History", didUpdate: model.didUpdate.bind(model), suggestions: historyList.filter(h => !h.favorite), onSelect: this.onSelectScript, onUpdate: this.onUpdateHistoryItem, onDelete: this.onDeleteHistoryItem}),
          h(HistoryBox, {title: "Favorite", didUpdate: model.didUpdate.bind(model), suggestions: historyList.filter(h => h.favorite), onSelect: this.onSelectScript, onUpdate: this.onUpdateHistoryItem, onDelete: this.onDeleteHistoryItem}),
          h("div", {className: "button-group"},
            h("input", {placeholder: "Script Label", type: "save", className: "text-control save-control", value: model.scriptName, onInput: this.onSetscriptName}),
            h("button", {onClick: this.onAddToHistory, title: "Add script to saved history"}, "Save Script"),
            h("input", {placeholder: "Consumer Key", type: "default", className: "text-control", value: model.clientId, onInput: this.onSetClientId}),
            h("button", {onClick: this.onSaveClientId, title: "Save Consumer Key"}, "Save"),
          ),
        ),
        h(Editor, {model, keywordColor, keywordCaseSensitive: true}),
        h("div", {className: "autocomplete-box" + (model.expandAutocomplete ? " expanded" : "")},
          h("div", {className: "autocomplete-header"},
            h("span", {}, model.autocompleteResults.title + suggestionHelper),
            h("div", {className: "flex-right"},
              h("label", {className: "slds-checkbox__label slds-p-right_small"},
                h("input", {type: "checkbox", className: "slds-checkbox", checked: model.openLogOnExecute, onChange: this.onToggleOpenLogOnExecute}),
                " Open Log ",
              ),
              h("button", {tabIndex: 1, onClick: this.onExecute, title: "Ctrl+Enter / F5", className: "highlighted"}, "Run Execute"),
              h("button", {tabIndex: 2, onClick: this.onCopyScript, title: "Copy script url", className: "copy-id"}, "Export Script"),
              h("button", {tabIndex: 3, onClick: this.onGenerateWithAI, title: "Generate Apex Script with AI", className: "ai-generate-btn"}, "🤖 Generate with AI"),
              h("button", {className: "variable-btn " + (model.showLoopParameter ? "toggle expand" : "toggle contract"), id: "variable-btn", title: "Loop parameter", onClick: this.onToggleLoopParameter},
                h("div", {className: "icon"}),
                h("div", {className: "button-toggle-icon"})
              )
            ),
          ),
          h("div", {ref: "autocompleteResultBox", className: "autocomplete-results autocomplete-results-over", hidden: !model.displaySuggestion, style: {top: model.suggestionTop + "px", left: model.suggestionLeft + "px"}},
            model.autocompleteResults.results.map((r, ri) =>
              h("div", {className: "autocomplete-result" + (ri == model.activeSuggestion ? " active" : ""), key: r.key ? r.key : r.value}, h("a", {tabIndex: 0, title: r.title, onMouseDown: e => { e.preventDefault(); model.autocompleteClick(r); model.didUpdate(); }, href: "#", className: r.autocompleteType + " " + r.dataType}, h("div", {className: "autocomplete-icon"}), r.title), " ")
            )
          ),
        ),
        h("div", {hidden: !model.showHelp, className: "help-text"},
          h("h3", {}, "Execute Help"),
          h("p", {}, "Use for running apex script. Enter a ", h("a", {href: "https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dev_guide.htm", target: "_blank"}, "APEX script"), " in the box above and press Execute."),
          h("p", {}, "Press Ctrl+Space to insert autosuggestions."),
          h("p", {}, "Press Ctrl+Enter or F5 to execute the execute.")
        ),
        h("div", {hidden: !model.showLoopParameter, className: "variable-block"},
          h("h3", {className: "slds-p-vertical_xx-small slds-text-title_bold"}, "Script Parameters"),
          //loop count, delay between batches, continue with next loop on error
          h("div", {className: "slds-p-vertical_xx-small"},
            h("span", {className: "conf-label"}, "Loop count"),
            h("input", {type: "number", min: 1, max: 100000, value: model.loopCount, onChange: this.onLoopCountChange, className: "loop-count"})
          ),
          h("div", {className: "slds-p-vertical_xx-small"},
            h("span", {className: "conf-label"}, "Loop delay (ms)"),
            h("input", {type: "number", min: 0, max: 60000, value: model.loopDelay, onChange: this.onLoopDelayChange, className: "loop-delay"})
          ),
          h("div", {className: "slds-p-vertical_xx-small"},
            h("label", {className: "slds-checkbox_toggle slds-grid"},
              h("span", {className: "slds-form-element__label slds-m-bottom_none"}, "Continue on error"),
              h("input", {type: "checkbox", className: "slds-input slds-checkbox", checked: model.loopContinueOnError, onChange: this.onLoopContinueOnErrorChange}),
              h("span", {className: "slds-checkbox_faux_container center-label"},
                h("span", {className: "slds-checkbox_faux"}),
                h("span", {className: "slds-checkbox_on"}, "Continue"),
                h("span", {className: "slds-checkbox_off"}, "Stop"),
              )
            ),
          )
        ),
      ),
      h("div", {className: "area", id: "result-area"},
        h("div", {className: "result-bar"},
          h("div", {className: "slds-tabs_default flex-area", style: {height: "inherit"}},
            h("ul", {className: "options-tab-container slds-tabs_default__nav", role: "tablist"},
              h("li", {className: "options-tab slds-text-align_center slds-tabs_default__item" + (this.state.selectedTabId === 1 ? " slds-is-active" : ""), title: "Logs", tabIndex: 1, role: "presentation", onClick: this.onTabSelect},
                h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: 1, id: "tab-default-1__item"}, "Logs")
              ),
              h("li", {className: "options-tab slds-text-align_center slds-tabs_default__item" + (this.state.selectedTabId === 2 ? " slds-is-active" : ""), title: "Jobs", tabIndex: 2, role: "presentation", onClick: this.onTabSelect},
                h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: 2, id: "tab-default-2__item"}, "Jobs")
              ),
              h("li", {className: "options-tab slds-text-align_center slds-tabs_default__item" + (this.state.selectedTabId === 3 ? " slds-is-active" : ""), title: "Test", tabIndex: 3, role: "presentation", onClick: this.onTabSelect},
                h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: 3, id: "tab-default-3__item"}, "Tests")
              ),
              h("li", {className: "options-tab slds-text-align_center slds-tabs_default__item" + (this.state.selectedTabId === 4 ? " slds-is-active" : ""), title: "Code Converage", tabIndex: 4, role: "presentation", onClick: this.onTabSelect},
                h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: 4, id: "tab-default-4__item"}, "Coverage")
              )
            ),
          ),
          h("span", {className: "result-status flex-right"},
            h("input", {placeholder: "Filter Results", type: "search", className: "text-control search-control", value: model.resultsFilter, onInput: this.onResultsFilterInput}),
            h("span", {}, model.executeStatus),
            h("button", {className: "cancel-btn", disabled: !model.isWorking, onClick: this.onStopExecute}, "Stop polling logs"),
            h("button", {onClick: this.openEmptyLog}, "Open empty logs"),
            h("button", {onClick: this.deleteAllLog, className: "delete-btn"}, "Delete all logs"),
            h("button", {onClick: this.runTests, disabled: (model.testStatus == "STARTED")}, model.runningTestId ? "Stop Unit Tests" : "Run All Unit Tests"),
            h("a", {href: "apex-code.html?" + new URLSearchParams({host: model.sfHost}), target: "_blank", className: "button", title: "View the code and the code coverage of an Apex class or trigger, and run its tests"}, "Open Apex Code"),
          ),
        ),
        h("textarea", {className: "result-text", readOnly: true, value: model.executeError || "", hidden: model.executeError == null}),
        h("div", {className: "scrolltable-wrapper", hidden: (model.executeError != null || this.state.selectedTabId != 1)},
          h(ScrollTable, {model: model.tableModel})
        ),
        h("div", {className: "scrolltable-wrapper", hidden: (model.executeError != null || this.state.selectedTabId != 2)},
          h(ScrollTable, {model: model.tableJobModel})
        ),
        model.testStatus != "PENDING" && model.testStatus != "STARTED" && model.testStatus != "RUNNING" ? model.testStatus : "",
        h("div", {className: "scrolltable-wrapper", hidden: (model.executeError != null || this.state.selectedTabId != 3)},
          h(ScrollTable, {model: model.tableTestModel})
        ),
        h("div", {className: "scrolltable-wrapper", hidden: (model.executeError != null || this.state.selectedTabId != 4)},
          h(ScrollTable, {model: model.tableCoverageModel})
        )
      ),
      model.confirmPopup ? h("div", {},
        h("div", {id: "confirm-background"},
          h("div", {id: "confirm-dialog"},
            h("p", {}, model.confirmPopup.text),
            h("div", {className: "dialog-buttons"},
              h("button", {onClick: this.onConfirmPopupYesClick}, "OK"),
              h("button", {onClick: this.onConfirmPopupNoClick, className: "cancel-btn"}, "Cancel")
            )
          )
        )
      ) : null,
      this.state.showAIModal ? h("div", {className: "ai-modal-overlay", onClick: this.onCloseAIModal},
        h("div", {className: "ai-modal area", onClick: e => e.stopPropagation()},
          h("div", {className: "ai-modal-header"},
            h("h2", {}, "Generate Apex Script with AI"),
            h("button", {className: "ai-modal-close", onClick: this.onCloseAIModal, title: "Close"}, "×")
          ),
          h("div", {className: "ai-modal-body"},
            h("p", {className: "ai-modal-description"},
              "Describe in natural language the Apex script you want. Type ", h("code", {}, "@"), " to reference an Apex class or a Salesforce object as context. For example: ",
              h("em", {}, "\"Update the Status field to Active on all @Account records with no @MyBatchClass running\"")
            ),
            h("div", {className: "ai-mention-wrapper"},
              h("textarea", {
                ref: this.onAITextareaRef,
                className: "ai-modal-input slds-textarea",
                placeholder: "Ex: Query all @Account with @MyApexClass logic applied and debug the result",
                value: this.state.aiDescription,
                onChange: this.onAIDescriptionChange,
                onKeyDown: this.onAIDescriptionKeyDown,
                rows: 6,
                autoFocus: true
              }),
              this.state.showMentionSuggestions && this.state.mentionSuggestions.length > 0 ? h("div", {className: "ai-mention-results"},
                this.state.mentionSuggestions.map((r, ri) =>
                  h("div", {className: "autocomplete-result" + (ri == this.state.mentionActiveIndex ? " active" : ""), key: r.value},
                    h("a", {
                      tabIndex: 0,
                      title: r.title,
                      onMouseDown: e => { e.preventDefault(); this.onSelectMention(r); },
                      href: "#",
                      className: r.autocompleteType
                    }, h("div", {className: "autocomplete-icon"}), r.title)
                  )
                )
              ) : null
            ),
            model.aiError ? h("div", {className: "ai-modal-error conf-error"}, model.aiError) : null,
            h("div", {className: "ai-modal-footer"},
              h("button", {
                className: "ai-modal-cancel cancel-btn",
                onClick: this.onCloseAIModal
              }, "Cancel"),
              h("button", {
                className: "highlighted",
                disabled: !this.state.aiDescription.trim() || model.aiGenerating,
                onClick: () => this.handleAIGenerate()
              }, model.aiGenerating ? "Generating..." : "Generate")
            ),
            h("p", {className: "ai-modal-hint"}, "Tip: Press Ctrl+Enter to generate quickly")
          )
        )
      ) : null
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
      parent.insextTestLoaded({model, sfConn});
    }

  });

}
function getLinkTarget(e) {
  if (localStorage.getItem("openLinksInNewTab") == "true" || (e?.ctrlKey || e?.metaKey)) {
    return "_blank";
  } else {
    return "_top";
  }
}

function getSeparator() {
  let separator = ",";
  if (localStorage.getItem("csvSeparator")) {
    separator = localStorage.getItem("csvSeparator");
  }
  return separator;
}
function makeReadableSize(size) {
  let isize = parseInt(size);
  if (isNaN(isize)){
    return size + " kb";
  } else if (isize > 1048576) {
    return (isize / 1048576).toFixed(2) + " Mb";
  } else if (isize > 1024) {
    return (isize / 1024).toFixed(2) + " kb";
  }
  return isize + " b";
}
