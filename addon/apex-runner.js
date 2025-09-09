/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */
import {Enumerable, DescribeInfo} from "./data-load.js";
import {QueryHistory, HistoryBox} from "./history-box.js";
import {Editor} from "./editor.js";
import {ScrollTable, TableModel, RecordTable} from "./record-table.js";

class Model {
  constructor({sfHost, args}) {
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
      {name: "ApexClass.Name", title: "Apex class"},
      {name: "MethodName", title: "Method"},
      {name: "ApexTestRunResultId", hidden: true},
      {name: "Outcome", title: "Outcome"},
      {name: "Message", title: "Message"},
      {name: "StackTrace", title: "Stack trace"}
    ]});
    this.tableCoverageModel = new TableModel(sfHost, this.didUpdate.bind(this), {"columns": [
      {name: "ApexClassOrTrigger", hidden: true},
      {name: "ApexClassOrTrigger.Name", title: "ApexClass / Trigger"},
      {name: "NumLinesCovered", title: "Lines covered"},
      {name: "NumLinesUncovered", title: "Lines uncovered"}
    ]});
    this.resultsFilter = "";
    this.editor = null;
    this.historyOffset = -1;
    this.runningTestId = null;
    this.testStatus = "PENDING";
    this.historyStack = [];//text + timestamp
    this.initialScript = "";
    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.editorAutocompleteHandler({newDescribe: true});
      this.enableLogs();
      //TODO refresh list of field
      this.didUpdate();
    });

    this.sfLink = "https://" + sfHost;
    this.spinnerCount = 0;
    this.showHelp = false;
    this.userInfo = "...";
    this.userId = null;
    this.timeout = null;
    this.winInnerHeight = 0;
    this.autocompleteResults = {sobjectName: "", title: "\u00A0", results: []};
    this.autocompleteClick = null;
    this.isWorking = false;
    this.executeStatus = "Ready";
    this.executeError = null;
    this.logs = null;
    this.jobs = null;
    this.tests = null;
    this.coverages = null;
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
    this.autocompleteState = "";
    this.autocompleteProgress = {};
    this.apexClasses = new RecordTable();
    this.scriptName = "";
    this.suggestionTop = 0;
    this.suggestionLeft = 0;
    this.activeSuggestion = -1;
    this.autocompleteResultBox = null;
    this.displaySuggestion = true;
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

    this.propertyTypes = new Map();
    this.typeProperties = new Map();
    this.typeProperties.set("List", ["add(", "addAll(", "clear(", "clone(", "contains(", "deepClone(", "equals(", "get(", "getSObjectType(", "hashCode(", "indexOf(", "isEmpty(", "iterator(", "remove(", "set(", "size(", "sort(", "toString("]);
    this.typeProperties.set("Map", ["clear(", "clone(", "containsKey(", "deepClone(", "equals(", "get(", "getSObjectType(", "hashCode(", "isEmpty(", "keySet(", "put(", "putAll(", "putAll(", "remove(", "size(", "toString(", "values("]);
    this.typeProperties.set("Set", ["add(", "addAll(", "addAll(", "clear(", "clone(", "contains(", "containsAll(", "containsAll(", "equals(", "hashCode(", "isEmpty(", "remove(", "removeAll(", "removeAll(", "retainAll(", "retainAll(", "size("]);
    this.typeProperties.set("Database", ["convertLead(", "countQuery(", "countQueryWithBinds(", "delete(", "deleteAsync(", "deleteImmediate(", "emptyRecycleBin(", "executeBatch(", "getAsyncDeleteResult(", "getAsyncLocator(", "getAsyncSaveResult(", "getDeleted(", "getQueryLocator(", "getQueryLocatorWithBinds(", "getUpdated(", "insert(", "insertAsync(", "insertImmediate(", "merge(", "query(", "queryWithBinds(", "releaseSavepoint(", "rollback(", "setSavepoint(", "undelete(", "update(", "upsert(", "updateAsync(", "updateImmediate("]);

    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
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
    this.historyStack = [{
      value: this.initialScript,
      selectionStart: 0,
      selectionEnd: 0
    }];
    this.historyOffset = 0;
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
      this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
      this.editorAutocompleteHandler();
      this.selectedHistoryEntry = null;
    }
  }
  selectScript(val) {
    this.editor.value = val.value.trimStart();
    this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
    this.editor.focus();
  }
  addToHistory() {
    this.savedHistory.add({script: this.editor.value, name: this.scriptName});
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

  resultsSort(searchTerm) {
    function sortRank({value, title}) {
      let i = 0;
      if (value.toLowerCase() == searchTerm.toLowerCase()) {
        return i;
      }
      i++;
      if (title.toLowerCase() == searchTerm.toLowerCase()) {
        return i;
      }
      i++;
      if (value.toLowerCase().startsWith(searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      if (title.toLowerCase().startsWith(searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      if (value.toLowerCase().includes("__" + searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      if (value.toLowerCase().includes("_" + searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      if (title.toLowerCase().includes(" " + searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      return i;
    }
    return function(a, b) {
      return sortRank(a) - sortRank(b) || a.rank - b.rank || a.value.localeCompare(b.value);
    };
  }

  autocompleteClass(vm, ctrlSpace) {
    let script = vm.editor.value;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let searchTerm = selStart != selEnd
      ? script.substring(selStart, selEnd)
      : script.substring(0, selStart).match(/[a-zA-Z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;

    if (ctrlSpace) {
      this.selectSuggestion();
      return;
    }
    let contextPath;
    if (searchTerm && searchTerm.includes(".")) {
      [contextPath, searchTerm] = searchTerm.split(".", 2);

    }
    let keywords = [
      {value: "Blob", title: "Blob", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "double"},
      {value: "Boolean", title: "Boolean", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "boolean"},
      {value: "Date", title: "Date", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "date"},
      {value: "Datetime", title: "Datetime", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "datetime"},
      {value: "Decimal", title: "Decimal", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "double"},
      {value: "Double", title: "Double", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "double"},
      {value: "ID", title: "ID", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "id"},
      {value: "Integer", title: "Integer", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "int"},
      {value: "Long", title: "Long", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "long"},
      {value: "Object", title: "Object", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "reference"},
      {value: "String", title: "String", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "string"},
      {value: "Time", title: "Time", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "time"},

      {value: "List", title: "List", suffix: " ", rank: 1, autocompleteType: "class", dataType: ""},
      {value: "Map", title: "Map", suffix: " ", rank: 1, autocompleteType: "class", dataType: ""},
      {value: "Set", title: "Set", suffix: " ", rank: 1, autocompleteType: "class", dataType: ""},
      {value: "Enum", title: "Enum", suffix: " ", rank: 1, autocompleteType: "class", dataType: ""},

      {value: "while", title: "while", suffix: " {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "for", key: "foreach", title: "foreach", suffix: "(Object item:lists) {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "for", key: "fori", title: "fori", suffix: "(Integer i = 0; i<length; i++) {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "try", title: "try", suffix: " {} catch (Exception e) {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "if", title: "if", suffix: " {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "else", title: "else", suffix: " {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "Database.executeBatch(", title: "Database.executeBatch();", suffix: "new batchable(), 200);", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "System.enqueueJob(", title: "System.enqueueJob();", suffix: "new job());", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "System.debug(", title: "System.debug();", suffix: ");", rank: 2, autocompleteType: "snippet", dataType: ""}
    ];
    let {globalDescribe, globalStatus} = vm.describeInfo.describeGlobal(false);
    //isue duplicate namespace because need group by
    vm.autocompleteResults = {
      sobjectName: "ApexClass",
      title: "Class suggestions:",
      results: new Enumerable(vm.apexClasses.records) // custom class
        .flatMap(function* (c) {
          if (contextPath) {
            if (c.NamespacePrefix && c.NamespacePrefix.toLowerCase() == contextPath.toLowerCase()
            && c.Name.toLowerCase().includes(searchTerm.toLowerCase())) {
              yield {"value": c.NamespacePrefix + "." + c.Name, "title": c.NamespacePrefix + "." + c.Name, "suffix": " ", "rank": 4, "autocompleteType": "class"};
            }
          } else if (!c.NamespacePrefix && c.Name.toLowerCase().includes(searchTerm.toLowerCase())) {
            yield {"value": c.Name, "title": c.Name, "suffix": " ", "rank": 4, "autocompleteType": "class"};
          }
        })
        .concat(//customm class namespaces
          new Enumerable(vm.apexClasses.records)
            .map(c => c.NamespacePrefix)
            .filter(n => (n && n.toLowerCase().includes(searchTerm.toLowerCase())))
            .groupBy(n => n)
            .map(n => ({"value": n, "title": n, "suffix": " ", "rank": 5, "autocompleteType": "namespace"}))
        )
        .concat(//SOBJECT
          new Enumerable(globalStatus == "ready" ? globalDescribe.sobjects : [])
            .filter(sobjectDescribe => (sobjectDescribe.name.toLowerCase().includes(searchTerm.toLowerCase())))
            .map(sobjectDescribe => sobjectDescribe.name)
            .map(n => ({"value": n, "title": n, "suffix": " ", "rank": 6, "autocompleteType": "object"}))
        )
        .concat(
          new Enumerable(keywords) //keywords
            .filter(keyword => keyword.title.toLowerCase().includes(searchTerm.toLowerCase()))
        )
        .concat(
          new Enumerable(this.propertyTypes.keys())
            .filter(prop => contextPath && prop.toLowerCase().includes(contextPath.toLowerCase()))
            .map(k => this.propertyTypes.get(k))
            .filter(k => k)
            .flatMap(typ => this.typeProperties.get(typ))
            .filter(f => f && f.toLowerCase().startsWith(searchTerm.toLowerCase()))
            .map(n => ({"value": n, "title": n, "suffix": " ", "rank": 0, "autocompleteType": "variable"}))
        )
        .toArray()
        .sort(vm.resultsSort(searchTerm))
        .slice(0, 20) //only 20 first result
    };
  }

  //basic parser
  parseAnonApex(source) {
    if (!source) {
      return;
    }
    this.propertyTypes.clear();
    //TODO ugly hack for static class
    this.propertyTypes.set("Database", "Database");
    source.replaceAll(/\/\/.*\n/g, "\n").replaceAll(/\/\*(.|\r|\n)*\*\//g, "\n").split(";").forEach(statement => {
      let line = statement.trim() + ";";
      let forMatch = line.match(/^for\s*\(/);
      if (forMatch) {
        line = line.substring(forMatch[0].length);
      }
      let whileMatch = line.match(/^while\s*\(/);
      if (whileMatch) {
        line = line.substring(whileMatch[0].length);
      }
      line = line.trim();
      //[public | private | protected | global]
      if (line.startsWith("public ")){
        line = line.substring(7);
        line = line.trim();
      } else if (line.startsWith("private ")){
        line = line.substring(8);
        line = line.trim();
      } else if (line.startsWith("protected ")){
        line = line.substring(10);
        line = line.trim();
      } else if (line.startsWith("global ")){
        line = line.substring(7);
        line = line.trim();
      }
      //[final | override]
      if (line.startsWith("final ")){
        line = line.substring(6);
        line = line.trim();
      } else if (line.startsWith("override ")){
        line = line.substring(9);
        line = line.trim();
      }

      if (line.startsWith("static ")){
        line = line.substring(7);
        line = line.trim();
      }

      // type name
      let fieldRE = /^([a-zA-Z][a-zA-Z0-9_]+)\s+([a-zA-Z][a-zA-Z0-9_]+)(\s*[=(;{]?)/;
      let fieldMatch = fieldRE.exec(line);
      if (fieldMatch) {
        this.propertyTypes.set(fieldMatch[2], fieldMatch[1]);
      }
    });
    //TODO Set and remove primitive
    let {globalDescribe, globalStatus} = this.describeInfo.describeGlobal(false);
    let classes = new Set();
    for (let dataType of this.propertyTypes.values()) {
      //SObject field
      //TODO describeInfo.DidUpdate must do the same when ready so move it to external method
      if (globalStatus == "ready") {
        let sobj = globalDescribe.sobjects.find(sobjectDescribe => (sobjectDescribe.name == dataType));
        if (sobj) {
          let {sobjectStatus, sobjectDescribe} = this.describeInfo.describeSobject(false, dataType);
          if (sobjectStatus == "ready") {
            let fields = sobjectDescribe.fields.map(field => field.Name);
            fields.push("addError(");
            fields.push("clear(");
            fields.push("clone(");
            fields.push("get(");
            fields.push("getCloneSourceId(");
            fields.push("getErrors(");
            fields.push("getOptions(");
            fields.push("getPopulatedFieldsAsMap(");
            fields.push("getSObject(");
            fields.push("getSObjects(");
            fields.push("getSObjectType(");
            fields.push("getQuickActionName(");
            fields.push("hasErrors(");
            fields.push("isClone(");
            fields.push("isSet(");
            fields.push("put(");
            fields.push("putSObject(");
            fields.push("setOptions(");
            this.typeProperties.set(dataType, fields);
          }
          continue;
        }
      }
      //potential class
      if (this.apexClasses.records.some(cls => cls.Name == dataType)){
        classes.add(dataType);
      }
    }
    if (!classes || classes.size == 0) {
      return;
    }
    let queryApexClass = "SELECT Id, Name, NamespacePrefix, Body FROM ApexClass WHERE Name in (" + Array.from(classes).map(c => "'" + c + "'").join(",") + ")";
    let apexClassesSource = new RecordTable();
    this.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryApexClass), {}), this, apexClassesSource, (isFinished) => {
      if (!isFinished){
        return;
      }
      apexClassesSource.records.forEach(cls => {
        this.parseClass(cls.Body, cls.Name);
      });
    })
      .catch(error => {
        console.error(error);
      });
  }
  showSuggestion() {
    this.displaySuggestion = true;
    this.didUpdate();
  }
  hideSuggestion() {
    this.displaySuggestion = false;
    this.didUpdate();
  }
  nextSuggestion() {
    if (this.autocompleteResults.results.length == 0) {
      return false;
    }
    if (this.activeSuggestion < this.autocompleteResults.results.length - 1) {
      this.activeSuggestion++;
    } else {
      this.activeSuggestion = 0;
    }
    let scrolltop = (this.activeSuggestion * 22) - 100; //(half of total)
    this.autocompleteResultBox.scrollTop = scrolltop > 0 ? scrolltop : 0;
    this.didUpdate();
    return true;
  }
  previousSuggestion() {
    if (this.autocompleteResults.results.length == 0) {
      return false;
    }
    if (this.activeSuggestion > 0) {
      this.activeSuggestion--;
    } else {
      this.activeSuggestion = this.autocompleteResults.results.length - 1;
    }
    let scrolltop = (this.activeSuggestion * 22) - 100; //(half of total)
    this.autocompleteResultBox.scrollTop = scrolltop > 0 ? scrolltop : 0;
    this.didUpdate();
    return true;
  }
  selectSuggestion() {
    if (!this.autocompleteResults || !this.autocompleteResults.results || this.autocompleteResults.results.length == 0) {
      return;
    }
    //by default auto complete the first item
    let idx = this.activeSuggestion > -1 ? this.activeSuggestion : 0;
    let ar = this.autocompleteResults.results;
    let selStart = this.editor.selectionStart;
    let selEnd = this.editor.selectionEnd;
    let searchTerm = selStart != selEnd
      ? this.editor.value.substring(selStart, selEnd)
      : this.editor.value.substring(0, selStart).match(/[a-zA-Z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;

    this.editor.focus();
    this.applyEdit(ar[idx].value + ar[idx].suffix, selStart, selEnd, "end");
    this.activeSuggestion = -1;
    this.editorAutocompleteHandler();
  }
  parseClass(source, clsName){
    //todo build hierarchy of block List<Block> with startPosition, endPosition and context
    //for moment simple list
    if (!source) {
      return;
    }
    let cleanedSource = source.replaceAll(/\/\/.*\n/g, "\n").replaceAll(/\/\*(.|\r|\n)*?\*\//g, "");
    // type name
    //let fieldRE = /(public|global)\s+(static\s*)?([a-zA-Z][a-zA-Z0-9_<>]+)\s+([a-zA-Z][a-zA-Z0-9_]+)\s*(;|=|\(|\{)/g;
    let fieldRE = /(public|global)\s+(static\s*)?([a-zA-Z0-9_<>.]+)\s+([a-zA-Z][a-zA-Z0-9_]+)/g;
    //let methodRE = /(public|public static|global|global static)\s*([a-zA-Z][a-zA-Z0-9_<>]+)\s+([a-zA-Z][a-zA-Z0-9_]+)\s*(\([^\{]*\))\{/g;
    let fieldMatch = null;
    let fields = [];
    while ((fieldMatch = fieldRE.exec(cleanedSource)) !== null) {
      if (fieldMatch[3] == "class") {
        continue;
      }
      //if (fieldMatch[5] == "(") {
      //  fields.push(fieldMatch[4] + "(");
      //} else {
      fields.push(fieldMatch[4]);
      //}
    }
    //TODO inner class
    this.typeProperties.set(clsName, fields);
  }

  setSuggestionPosition(top, left){
    if (this.suggestionTop == top && this.suggestionLeft == left) {
      return;
    }
    this.suggestionTop = top;
    this.suggestionLeft = left;
    this.didUpdate();
  }
  /**
   * APEX script autocomplete handling.
   */
  editorAutocompleteHandler(e = {}) {
    let vm = this; // eslint-disable-line consistent-this
    let script = vm.editor.value;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let ctrlSpace = e.ctrlSpace;
    this.parseAnonApex(script);
    //TODO place suggestion over the text area with miroring text with span
    //advantage is that we can provide color highlight thanks to that.
    /*
    const rect = caretEle.getBoundingClientRect();
    suggestionsEle.style.top = `${rect.top + rect.height}px`;
    suggestionsEle.style.left = `${rect.left}px`;
    */
    // Skip the calculation when no change is made. This improves performance and prevents async operations (Ctrl+Space) from being canceled when they should not be.
    let newAutocompleteState = [script, selStart, selEnd].join("$");
    if (newAutocompleteState == vm.autocompleteState && !ctrlSpace && !e.newDescribe) {
      return;
    }
    vm.autocompleteState = newAutocompleteState;

    // Cancel any async operation since its results will no longer be relevant.
    if (vm.autocompleteProgress.abort) {
      vm.autocompleteProgress.abort();
    }

    vm.autocompleteClick = ({value, suffix}) => {
      vm.editor.focus();
      vm.applyEdit(value + suffix, selStart, selEnd, "end");
      vm.editorAutocompleteHandler();
    };

    // Find the token we want to autocomplete. This is the selected text, or the last word before the cursor.
    let searchTerm = selStart != selEnd
      ? script.substring(selStart, selEnd)
      : script.substring(0, selStart).match(/[a-zA-Z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;
    if (e.inputType == "insertLineBreak") {
      let lastLine = script.substring(0, selStart - 1);
      lastLine = lastLine.substring(lastLine.lastIndexOf("\n") + 1);
      let m = lastLine.match(/^\s+/);
      if (m) {
        vm.applyEdit(m[0], selStart, selEnd, "end");
      }
    }
    this.autocompleteClass(vm, ctrlSpace);
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
  //TODO migrate to editor Model common to apex runner and data export
  applyEdit(value, selectionStart, selectionEnd, mode = "preserve") {
    if (this.editor) {
      this.editor.setRangeText(value, selectionStart, selectionEnd, mode);
      this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
    }
  }
  undoEdit() {
    if (this.editor && this.historyOffset > 0) {
      this.historyOffset--;
      let previous = this.historyStack[this.historyOffset];
      this.editor.value = previous.value;
      this.editor.selectionStart = previous.selectionStart;
      this.editor.selectionEnd = previous.selectionEnd;
    }
  }
  redoEdit() {
    if (this.editor && this.historyOffset < this.historyStack.length - 1) {
      this.historyOffset++;
      let next = this.historyStack[this.historyOffset];
      this.editor.value = next.value;
      this.editor.selectionStart = next.selectionStart;
      this.editor.selectionEnd = next.selectionEnd;
    }
  }
  writeEditHistory(value, selectionStart, selectionEnd, force) {
    const HISTORY_LIMIT = 100;
    const HISTORY_TIME_GAP = 3000;
    //remove history after offset
    if (this.historyOffset != -1 && this.historyOffset < this.historyStack.length - 1) {
      this.historyStack = this.historyStack.slice(0, this.historyOffset + 1);
    }
    //remove first elements if limit reached
    if (this.historyStack.length > 0 && this.historyOffset > -1 && this.historyStack.length > HISTORY_LIMIT) {
      let cnt = this.historyStack.length - HISTORY_LIMIT;
      this.historyStack = this.historyStack.slice(cnt);
      this.historyOffset = Math.max(this.historyOffset - cnt, 0);
    }
    if (!force && this.historyOffset >= 0) {
      let last = this.historyStack[this.historyOffset];
      let lastWord = last.value.substring(0, last.selectionStart).match(/[a-z0-9]+$/i);
      let newLastWord = value.substring(0, selectionStart).match(/[a-z0-9]+$/i);
      if (last
          && Date.now() - last.timestamp < HISTORY_TIME_GAP
          && lastWord && newLastWord && newLastWord[0].startsWith(lastWord[0])) {
        this.historyStack[this.historyOffset] = {
          value, //overwrite last entry
          selectionStart,
          selectionEnd,
          timestamp: last.timestamp //keep previous timestamp to write every 3 seconds at least
        };
        return;
      }
    }
    this.historyOffset++;
    this.historyStack.push({
      value,
      selectionStart,
      selectionEnd,
      timestamp: Date.now()
    });
  }
  handleEditorChange(value, selectionStart, selectionEnd) {
    this.writeEditHistory(value, selectionStart, selectionEnd, false);
  }
  doExecute() {
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
        if (!result) {
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
          return;
        } else {
          vm.scriptHistory.add({script});
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

    if (confirm("Resume Polling of logs?")) {
      vm.enableLogs();
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
      querytests = `SELECT AsyncApexJobId, ApexClass.Name,  MethodName, ApexTestRunResultId, Outcome, Message, StackTrace FROM ApexTestResult WHERE AsyncApexJobId = '${this.runningTestId}'`;
      this.tests = null;
    }
    let coverages = new RecordTable();
    coverages.describeInfo = vm.describeInfo;
    coverages.sfHost = vm.sfHost;
    let querycoverages = "SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId != NULL AND ApexClassOrTrigger.Name != NULL AND (NumLinesCovered > 0 OR NumLinesUncovered > 0) AND NumLinesCovered != NULL AND NumLinesUncovered != NULL ORDER BY ApexClassOrTrigger.Name";
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
    let queryLogs = "SELECT Id, Application, Status, Operation, StartTime, LogLength, LogUser.Name FROM ApexLog ORDER BY StartTime DESC LIMIT 100";
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
    this.scriptHistory.list.forEach(q => historyMap.set(q.script, {value: q.script, label: q.script.substring(0, 300), favorite: false}));
    this.scriptTemplates.forEach(q => historyMap.set(q, {value: q, label: q, favorite: true}));
    this.savedHistory.list.forEach(q => {
      let delimiter = ":";
      let itm;
      if (q.name){
        itm = {value: q.script, label: q.name, favorite: true};
      } else if (q.script.includes(delimiter)){
        itm = {label: q.script.split(delimiter)[0], favorite: true};
        itm.value = q.script.substring(itm.label.length + 1);
      } else {
        itm = {value: q.script, label: q.script, favorite: true};
      }
      historyMap.set(itm.value, itm);
    });
    return Array.from(historyMap.values());
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
      let itm = this.scriptHistory.list.find(item => item.script == history.value);
      if (itm) {
        this.scriptHistory.remove(itm);
      }
      let newSaved = {script: history.value};
      this.savedHistory.add(newSaved);
    } else {
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
      let newHistory = {script: history.value};
      if (itm && itm.name) {
        newHistory.name = itm.name;
      }
      this.scriptHistory.add(newHistory);
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

    this.state = {
      selectedTabId: 1
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
  onExecute() {
    let {model} = this.props;
    model.doExecute();
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
      if (confirm("Are you sure you want to cancel running tests?")){
        sfConn.rest(`/services/data/v${apiVersion}/query/?q=SELECT+Id,+ExtendedStatus,+Status+FROM+ApexTestQueueItem+WHERE+Status+!=+'Completed'+AND+ParentJobId+=+'${model.runningTestId}'`, {}).then(result => {
          let composite = {"compositeRequest": result.records.map((r, i) => ({"method": "POST",
            "url": `/services/data/v${apiVersion}/sobjects/ApexTestQueueItem/${r.Id}`,
            "referenceId": `cancelTest${i}`,
            "body": {"Status": "Aborted"}
          }))};
          sfConn.rest(`/services/data/v${apiVersion}/composite`, {method: "POST", body: composite, headers: {"Content-Type": "application/json"}}).then(() => {
            model.runningTestId = null;
          });
        }).catch(error => {
          console.error(error);
        });
      }
      return;
    }
    if (confirm("Are you sure you want to run tests? This will run all tests in the org.")) {
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
      }).catch(error => {
        if (error.message && error.message.startsWith("ALREADY_IN_PROCESS")) {
          model.testStatus = error.message;
          let qry = "SELECT Id, JobType, Status FROM AsyncApexJob WHERE JobType = 'TestRequest' and status IN ('Processing', 'Holding', 'Preparing')";
          sfConn.rest(`/services/data/v${apiVersion}/query/?q=${encodeURIComponent(qry)}`, {}).then(result => {
            if (result && result.records && result.records.length > 0) {
              model.runningTestId = result;
              model.testStatus = "RUNNING";
            }
          });
        }
        console.error(error);
      });
      model.didUpdate();
    }
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
  componentDidMount() {
    let {model} = this.props;
    model.autocompleteResultBox = this.refs.autocompleteResultBox;
    let queryApexClass = "SELECT+Id,+Name,+NamespacePrefix+FROM+ApexClass";
    model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + queryApexClass, {}), model, model.apexClasses, (isFinished) => {
      if (!isFinished){
        return;
      }
    })
      .catch(error => {
        console.error(error);
      });
    //call to get all Sobject during load
    model.describeInfo.describeGlobal(false);

    addEventListener("keydown", e => {
      if ((e.ctrlKey && e.key == "Enter") || e.key == "F5") {
        e.preventDefault();
        model.doExecute();
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
//TODO reset error on execute
  render() {
    let {model} = this.props;
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 5);
    let suggestionHelper = "";
    if (model.displaySuggestion) {
      suggestionHelper = " Press Esc to hide suggestions";
    } else {
      suggestionHelper = " Press Ctrl+Space to display suggestions";
    }
    let historyList = model.getHistory();

    let keywordColor = new Map([["do", "violet"], ["public", "blue"], ["private", "blue"], ["global", "blue"], ["class", "blue"], ["static", "blue"],
      ["interface", "blue"], ["extends", "blue"], ["while", "violet"], ["for", "violet"], ["try", "violet"], ["catch", "violet"],
      ["finally", "violet"], ["extends", "violet"], ["throw", "violet"], ["new", "violet"], ["if", "violet"], ["else", "violet"]]);
    return h("div", {onClick: this.onClick},
      h("div", {id: "user-info"},
        h("a", {href: model.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {}, "Script Execute"),
        h("span", {}, " / " + model.userInfo),
        h("div", {className: "flex-right"},
          h("div", {id: "spinner", role: "status", className: "slds-spinner slds-spinner_small slds-spinner_inline", hidden: model.spinnerCount == 0},
            h("span", {className: "slds-assistive-text"}),
            h("div", {className: "slds-spinner__dot-a"}),
            h("div", {className: "slds-spinner__dot-b"}),
          ),
          h("a", {href: "options.html?" + hostArg, className: "top-btn", id: "options-btn", title: "Option", target: "_blank"},
            h("div", {className: "icon"})
          ),
          h("a", {href: "#", className: "top-btn", id: "help-btn", title: "Execute Help", onClick: this.onToggleHelp},
            h("div", {className: "icon"})
          ),
        ),
      ),
      h("div", {className: "area"},
        h("div", {className: "area-header"},
        ),
        h("div", {className: "query-controls"},
          h("h1", {}, "Execute Script"),
          h(HistoryBox, {didUpdate: model.didUpdate.bind(model), suggestions: historyList, onSelect: this.onSelectScript, onUpdate: this.onUpdateHistoryItem, onDelete: this.onDeleteHistoryItem}),
          h("div", {className: "button-group"},
            h("input", {placeholder: "Script Label", type: "save", value: model.scriptName, onInput: this.onSetscriptName}),
            h("button", {onClick: this.onAddToHistory, title: "Add script to saved history"}, "Save Script"),
            h("input", {placeholder: "Consumer Key", type: "default", value: model.clientId, onInput: this.onSetClientId}),
            h("button", {onClick: this.onSaveClientId, title: "Save Consumer Key"}, "Save"),
          ),
        ),
        h(Editor, {model, keywordColor, keywordCaseSensitive: true}),
        h("div", {className: "autocomplete-box" + (model.expandAutocomplete ? " expanded" : "")},
          h("div", {className: "autocomplete-header"},
            h("span", {}, model.autocompleteResults.title + suggestionHelper),
            h("div", {className: "flex-right"},
              h("button", {tabIndex: 1, onClick: this.onExecute, title: "Ctrl+Enter / F5", className: "highlighted"}, "Run Execute"),
              h("button", {tabIndex: 2, onClick: this.onCopyScript, title: "Copy script url", className: "copy-id"}, "Export Script")
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
        )
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
            h("input", {placeholder: "Filter Results", type: "search", value: model.resultsFilter, onInput: this.onResultsFilterInput}),
            h("span", {}, model.executeStatus),
            h("button", {className: "cancel-btn", disabled: !model.isWorking, onClick: this.onStopExecute}, "Stop polling logs"),
            h("button", {onClick: this.openEmptyLog}, "Open empty logs"),
            h("button", {onClick: this.deleteAllLog, className: "delete-btn"}, "Delete all logs"),
            h("button", {onClick: this.runTests, disabled: (model.testStatus == "STARTED")}, model.runningTestId ? "Stop Unit Tests" : "Run Unit Tests"),
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
      )
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
