/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */
import {Enumerable, DescribeInfo, copyToClipboard, s} from "./data-load.js";
import {csvParse} from "./csv-parse.js";
import {QueryHistory, HistoryBox} from "./history-box.js";
import {Editor} from "./editor.js";
import {ScrollTable, TableModel, RecordTable} from "./record-table.js";

class Model {
  constructor({sfHost, args}) {
    this.sfHost = sfHost;
    this.tableModel = new TableModel(sfHost, this.didUpdate.bind(this));
    this.resultTableCallback = (d) => this.tableModel.dataChange(d);
    this.editor = null;
    this.historyOffset = -1;
    this.historyStack = [];//text + timestamp
    this.initialQuery = "";
    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.editorAutocompleteHandler({newDescribe: true});
      this.didUpdate();
    });
    this.sfLink = "https://" + sfHost;
    this.spinnerCount = 0;
    this.showHelp = false;
    this.showVariable = false;
    this.variableData = [];
    this.variableDataError = "";
    this.batchSize = 1;
    this.userInfo = "...";
    this.queryAll = false;
    this.queryTooling = false;
    this.autocompleteResults = {sobjectName: "", title: "\u00A0", results: []};
    this.autocompleteClick = null;
    this.isWorking = false;
    this.exportStatus = "Ready";
    this.exportError = null;
    this.exportedData = null;
    function compare(a, b) {
      return ((a.query == b.query && (!b.name || a.name == b.name)) || a.query == b.name + ":" + b.query) && a.useToolingApi == b.useToolingApi;
    }
    function sort(a, b) {
      return ((a.name ? a.name + a.query : a.query) > (b.name ? b.name + b.query : b.query)) ? 1 : (((b.name ? b.name + b.query : b.query) > (a.name ? a.name + a.query : a.query)) ? -1 : 0);
    }
    this.queryHistory = new QueryHistory("insextQueryHistory", 100, compare, sort);
    this.selectedHistoryEntry = null;
    this.savedHistory = new QueryHistory("insextSavedQueryHistory", 50, compare, sort);
    this.selectedSavedEntry = null;
    this.expandAutocomplete = false;
    this.expandSavedOptions = false;
    this.resultsFilter = "";
    this.displayPerformance = localStorage.getItem("displayQueryPerformance") !== "false"; // default to true
    this.performancePoints = [];
    this.startTime = null;
    this.lastStartTime = null;
    this.totalTime = 0;
    this.autocompleteState = "";
    this.autocompleteProgress = {};
    this.exportProgress = {};
    this.queryName = "";
    this.suggestionTop = 0;
    this.suggestionLeft = 0;
    this.columnIndex = {fields: []};
    this.activeSuggestion = -1;
    this.autocompleteResultBox = null;
    this.displaySuggestion = true;
    this.clientId = localStorage.getItem(sfHost + "_clientId") ? localStorage.getItem(sfHost + "_clientId") : "";
    let queryTemplatesRawValue = localStorage.getItem("queryTemplates");
    if (queryTemplatesRawValue) {
      try {
        this.queryTemplates = JSON.parse(queryTemplatesRawValue);
      } catch (err) {
        //try old format which do not support comments
        this.queryTemplates = queryTemplatesRawValue.split("//");
      }
    } else {
      this.queryTemplates = [
        "SELECT Id FROM ",
        "SELECT Id FROM WHERE",
        "SELECT Id FROM WHERE IN",
        "SELECT Id FROM WHERE LIKE",
        "SELECT Id FROM WHERE ORDER BY",
        "FIND {} IN Name Fields RETURNING Account(Name)",
        "{ uiapi { query { Account { edges { node { Name { value } } } } } } }"
      ];
    }

    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
    }));

    if (args.has("query")) {
      this.initialQuery = args.get("query");
      this.queryTooling = args.has("useToolingApi");
    } else if (this.queryHistory.list[0]) {
      this.initialQuery = this.queryHistory.list[0].query;
      this.queryTooling = this.queryHistory.list[0].useToolingApi;
    } else {
      this.initialQuery = "SELECT Id FROM Account LIMIT 200";
      this.queryTooling = false;
    }

    if (args.has("error")) {
      this.exportError = args.get("error") + " " + args.get("error_description");
    }
  }

  updatedExportedData() {
    this.resultTableCallback(this.exportedData);
  }
  setResultsFilter(value) {
    this.resultsFilter = value;
    if (this.exportedData == null) {
      return;
    }
    // Recalculate visibility
    this.exportedData.updateVisibility(value);
    this.updatedExportedData();
  }
  setQueryName(value) {
    this.queryName = value;
  }
  setEditor(editor) {
    this.editor = editor;
    editor.value = this.initialQuery;
    this.historyStack = [{
      value: this.initialQuery,
      selectionStart: 0,
      selectionEnd: 0
    }];
    this.historyOffset = 0;
    this.initialQuery = null;
  }
  toggleHelp() {
    this.showHelp = !this.showHelp;
  }
  toggleVariable() {
    this.showVariable = !this.showVariable;
  }
  setVariableData(text) {
    try {
      //only get first column for cell
      this.variableData = csvParse(text, "\t").map(c => c[0]);
    } catch (e) {
      this.variableDataError = "Error: " + e.message;
      return;
    }
  }
  batchSizeError() {
    if (!(+this.batchSize > 0)) { // This also handles NaN
      return "Error: Must be a positive number";
    }
    return "";
  }
  toggleExpand() {
    this.expandAutocomplete = !this.expandAutocomplete;
  }
  toggleSavedOptions() {
    this.expandSavedOptions = !this.expandSavedOptions;
  }
  showDescribeUrl() {
    let args = new URLSearchParams();
    args.set("host", this.sfHost);
    args.set("objectType", this.autocompleteResults.sobjectName);
    if (this.queryTooling) {
      args.set("useToolingApi", "1");
    }
    return "inspect.html?" + args;
  }
  selectHistoryEntry() {
    if (this.selectedHistoryEntry != null) {
      this.editor.value = this.selectedHistoryEntry.query;
      this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
      this.queryTooling = this.selectedHistoryEntry.useToolingApi;
      this.editorAutocompleteHandler();
      this.selectedHistoryEntry = null;
    }
  }
  selectQuery(val) {
    this.editor.value = val.value.trimStart();
    this.queryTooling = val.useToolingApi;
    this.queryName = val.name ?? "";
    this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
    this.editor.focus();
    let indexPos = this.editor.value.toLowerCase().indexOf("from ");
    if (indexPos !== -1) {
      this.editor.setRangeText("", indexPos + 5, indexPos + 5, "end");
    }
  }
  initPerf() {
    if (!this.displayPerformance) {
      return;
    }
    this.performancePoints = [];
    this.startTime = performance.now();
    this.lastStartTime = this.startTime;
  }
  markPerf() {
    if (!this.displayPerformance) {
      return;
    }
    const now = performance.now();
    const perfPoint = now - this.lastStartTime;
    this.lastStartTime = now;
    this.performancePoints.push(perfPoint);
    this.totalTime = now - this.startTime;
  }
  perfStatus() {
    if (!this.displayPerformance || !this.startTime || this.performancePoints.length === 0) {
      return null;
    }
    const batches = this.performancePoints.length;
    let batchStats = "";
    let batchCount = "";
    if (batches > 1) {
      const avgTime = this.performancePoints.reduce((a, b) => a + b, 0) / batches;
      const maxTime = Math.max(...this.performancePoints);
      const minTime = Math.min(...this.performancePoints);
      const avg = `Avg ${avgTime.toFixed(1)}ms`;
      const max = `Max ${maxTime.toFixed(1)}ms`;
      const min = `Min ${minTime.toFixed(1)}ms`;
      batchStats = `Batch Performance: ${avg}, ${min}, ${max}`;
      batchCount = `${batches} Batches / `;
    }
    return {text: `${batchCount}${this.totalTime.toFixed(1)}ms`, batchStats};
  }
  clearHistory() {
    this.queryHistory.clear();
  }
  selectSavedEntry() {
    if (this.selectedSavedEntry != null) {
      //old format
      let delimitermatch = this.selectedSavedEntry.query.match(/:\s*(select|find)[\S\s]*$/i);
      if (delimitermatch) {
        this.queryName = this.selectedSavedEntry.query.substring(0, delimitermatch.index);
        this.editor.value = this.selectedSavedEntry.query.substring(delimitermatch.index + 1);
        this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
      } else {
        this.editor.value = this.selectedSavedEntry.query;
        this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
        if (this.selectedSavedEntry.name) {
          this.queryName = this.selectedSavedEntry.name;
        } else {
          this.queryName = "";
        }
      }
      this.queryTooling = this.selectedSavedEntry.useToolingApi;
      this.editorAutocompleteHandler();
      this.selectedSavedEntry = null;
    }
  }
  clearSavedHistory() {
    this.savedHistory.clear();
  }
  addToHistory() {
    this.savedHistory.add({query: this.editor.value, name: this.queryName, useToolingApi: this.queryTooling});
  }
  removeFromHistory() {
    this.savedHistory.remove({query: this.editor.value, name: this.queryName, useToolingApi: this.queryTooling});
  }
  autocompleteReload() {
    this.describeInfo.reloadAll();
  }
  canCopy() {
    return this.exportedData != null;
  }
  canDelete() {
    //In order to allow deletion, we should have at least 1 element and the Id field should have been included in the query
    return this.exportedData
          && (this.exportedData.countOfVisibleRecords === null /* no filtering has been done yet*/ || this.exportedData.countOfVisibleRecords > 0)
          && this.exportedData.records.length < 20001 && !this.exportStatus.includes("Exporting") && this.exportedData?.table?.at(0)?.find(header => header.toLowerCase() === "id");
  }
  copyAsExcel() {
    copyToClipboard(this.exportedData.csvSerialize("\t"));
  }
  copyAsCsv() {
    let separator = getSeparator();
    copyToClipboard(this.exportedData.csvSerialize(separator));
  }
  downloadCsv() {
    let separator = getSeparator();
    let downloadLink = document.createElement("a");
    const date = new Date();
    const timestamp = date.toISOString().replace(/[^0-9]/g, "");
    downloadLink.download = `export${timestamp}.csv`;
    let BOM = "\uFEFF";
    let bb = new Blob([BOM, this.exportedData.csvSerialize(separator)], {type: "text/csv;charset=utf-8"});
    downloadLink.href = window.URL.createObjectURL(bb);
    downloadLink.click();
  }
  copyAsJson() {
    copyToClipboard(JSON.stringify(this.exportedData.records, null, "  "));
  }
  deleteRecords(e) {
    let data = this.exportedData.csvIdSerialize(getSeparator());
    let encodedData = window.btoa(data);

    let args = new URLSearchParams();
    args.set("host", this.sfHost);
    args.set("data", encodedData);
    if (this.queryTooling) args.set("apitype", "Tooling");

    window.open("data-import.html?" + args, getLinkTarget(e));
  }
  getQueryMethod() {
    if (this.isSearchMode()) {
      return "search";
    } else if (this.isGraphMode()) {
      return "graphql";
    } else if (this.queryTooling) {
      return "tooling/query";
    } else if (this.queryAll) {
      return "queryAll";
    } else {
      return "query";
    }
  }
  isGraphMode() {
    //if query start with "f" like "find" instead of "select"
    return this.editor != null && this.editor.value != null ? this.editor.value.trim().toLowerCase().startsWith("{") : false;
  }
  isSearchMode() {
    //if query start with "f" like "find" instead of "select"
    return this.editor != null && this.editor.value != null ? this.editor.value.trim().toLowerCase().startsWith("f") : false;
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

  showSuggestion() {
    this.displaySuggestion = true;
    this.editorAutocompleteHandler({newDescribe: true});
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
    let selStart = this.editor.selectionStart;
    let selEnd = this.editor.selectionEnd;
    let searchTerm = selStart != selEnd
      ? this.editor.value.substring(selStart, selEnd)
      : this.editor.value.substring(0, selStart).match(/[a-zA-Z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;
    let ar = this.autocompleteResults.results;
    if (this.autocompleteResults.isField && this.activeSuggestion == -1) {
      ar = ar
        .filter(r => r.autocompleteType == "fieldName")
        .map((r, i, l) => this.autocompleteResults.contextPath + r.value + (i != l.length - 1 ? r.suffix : ""));
      if (ar.length > 0) {
        this.editor.focus();
        this.applyEdit(ar.join(""), selStart, selEnd, "end");
      }
      return;
    }
    if (this.autocompleteResults.isFieldValue && this.activeSuggestion == -1) {
      this.suggestFieldValues();
      return;
    }

    //by default auto complete the first item
    let idx = this.activeSuggestion > -1 ? this.activeSuggestion : 0;

    this.editor.focus();
    this.applyEdit((this.autocompleteResults.contextPath ? this.autocompleteResults.contextPath : "") + ar[idx].value + ar[idx].suffix, selStart, selEnd, "end");
    this.activeSuggestion = -1;
    this.editorAutocompleteHandler();
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
   * SOSL query autocomplete handling.
   * Put caret at the end of a word or select some text to autocomplete it.
   * Searches for both label and API name.
   * Autocompletes sobject names after the "from" keyword.
   * Autocompletes field names, if the "from" keyword exists followed by a valid object name.
   * Supports relationship fields.
   * Autocompletes field values (picklist values, date constants, boolean values).
   * Autocompletes any textual field value by performing a Salesforce API query when Ctrl+Space is pressed.
   * Inserts all autocomplete field suggestions when Ctrl+Space is pressed.
   * Supports subqueries in where clauses, but not in select clauses.
   */
  searchAutocompleteHandler(e = {}) {
    //TODO MOVE TO tokenizer / lexer implem and so on for SOQL
    /*
    * search object after IN
    * keyword and format :
    * FIND {SearchQuery}
    * [ IN [ALL FIELDS|NAME FIELDS|EMAIL FIELDS|PHONE FIELDS|SIDEBAR FIELDS] ]
    * [ RETURNING objectType([[field] [ toLabel(fields)] [convertCurrency(Amount)] [FORMAT()], ]
    *     WHERE ...
    *     ORDER BY fieldOrderByList
    *     LIMIT number_of_rows_to_return
    *     OFFSET number_of_rows_to_skip)],...
    * [ WITH  DIVISION = 'myDiv' ]
    * [ WITH DATA CATEGORY field [AT|ABOVE|BELOW|ABOVE_OR_BELOW] AND... ]
    * [ WITH HIGHLIGHT]
    * [ WITH SNIPPET[(target_length=n)] ]
    * [ WITH NETWORK [IN ('XX',...)|= 'XX'] ]
    * [ WITH PricebookId = 'XX']
    * [ WITH METADATA ='LABELS' ]
    * [ LIMIT n ]
    *
    */
    let vm = this; // eslint-disable-line consistent-this
    let query = vm.editor.value;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let ctrlSpace = e.ctrlSpace;
    let beforeSel = query.substring(0, selStart);
    let searchTerm = selStart != selEnd
      ? query.substring(selStart, selEnd)
      : beforeSel.match(/[a-zA-Z0-9_]*$/)[0];
    selStart = selEnd - searchTerm.length;
    vm.autocompleteClick = ({value, suffix, link}) => {
      if (link){
        window.open(link, "_blank");
      } else {
        vm.editor.focus();
        vm.applyEdit(value + suffix, selStart, selEnd, "end");
        vm.editorAutocompleteHandler();
      }
    };

    //kind of tokenizer/lexer by advancing step by step
    //STEP 1 FIND
    beforeSel = beforeSel.trim();
    if (!beforeSel || !beforeSel.toUpperCase().startsWith("FIND")) {
      vm.autocompleteResults = {
        sobjectName: "",
        title: "Suggestions:",
        results: [{value: "FIND", title: "FIND", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""}]
      };
      return;
    }
    beforeSel = beforeSel.substring(4);
    beforeSel = beforeSel.trim();
    //STEP 2 {[\(|\)|OR|AND|NOT|\s|XXXX]}
    if (!beforeSel || !beforeSel.trim().startsWith("{")) {
      vm.autocompleteResults = {
        sobjectName: "",
        title: "Suggestions:",
        results: [{value: "{", title: "{", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""}]
      };
      return;
    }
    beforeSel = beforeSel.substring(1);
    beforeSel = beforeSel.trim();
    //skip escaped }
    while (beforeSel.indexOf("\\}") > -1 && beforeSel.indexOf("}") > beforeSel.indexOf("\\}")) {
      beforeSel = beforeSel.substring(beforeSel.indexOf("\\}") + 2);
      beforeSel = beforeSel.trim();
    }
    if (!beforeSel || beforeSel.indexOf("}") == -1) {
      vm.autocompleteResults = {
        sobjectName: "",
        title: "keyword or boolean suggestions:",
        results: [{value: "AND", title: "AND", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
          {value: "OR", title: "OR", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
          {value: "NOT", title: "NOT", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""}]
      };
      return;
    }
    beforeSel = beforeSel.substring(beforeSel.indexOf("}") + 1);
    beforeSel = beforeSel.trim();
    let keywords = [{value: "IN", title: "IN", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "RETURNING", title: "RETURNING", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "WITH DIVISION", title: "WITH DIVISION", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "WITH DATA CATEGORY", title: "WITH DATA CATEGORY", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "WITH HIGHLIGHT", title: "WITH HIGHLIGHT", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "WITH SNIPPET", title: "WITH SNIPPET", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "WITH NETWORK", title: "WITH NETWORK", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "WITH PricebookId", title: "WITH PricebookId", suffix: " = ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "WITH METADATA", title: "WITH METADATA", suffix: " = ", rank: 1, autocompleteType: "keyword", dataType: ""},
      {value: "LIMIT", title: "LIMIT", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""}];

    //STEP 3 check if IN [ALL FIELDS|NAME FIELDS|EMAIL FIELDS|PHONE FIELDS|SIDEBAR FIELDS
    if (beforeSel.toUpperCase().startsWith("IN")) {
      beforeSel = beforeSel.substring(2);
      beforeSel = beforeSel.trim();
      if (!beforeSel.toUpperCase().startsWith("ALL FIELDS")
      && !beforeSel.toUpperCase().startsWith("NAME FIELDS")
      && !beforeSel.toUpperCase().startsWith("EMAIL FIELDS")
      && !beforeSel.toUpperCase().startsWith("PHONE FIELDS")
      && !beforeSel.toUpperCase().startsWith("SIDEBAR FIELDS")) {
        vm.autocompleteResults = {
          sobjectName: "",
          title: "IN suggestions:",
          results: [{value: "ALL FIELDS", title: "ALL FIELDS", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
            {value: "NAME FIELDS", title: "NAME FIELDS", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
            {value: "EMAIL FIELDS", title: "EMAIL FIELDS", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
            {value: "PHONE FIELDS", title: "PHONE FIELDS", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
            {value: "SIDEBAR FIELDS", title: "SIDEBAR FIELDS", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""}]
        };
        return;
      }
      beforeSel = beforeSel.substring(beforeSel.toUpperCase().indexOf("FIELDS") + 6);
      beforeSel = beforeSel.trim();
    }
    //STEP 4  RETURNING objectType([[field] [ toLabel(fields)] [convertCurrency(Amount)] [FORMAT()], ] ORDER BY fieldOrderByList LIMIT number_of_rows_to_return OFFSET number_of_rows_to_skip)],...
    if (beforeSel.toUpperCase().startsWith("RETURNING")) {
      beforeSel = beforeSel.substring(9);
      beforeSel = beforeSel.trim();
      let matchObjName = beforeSel.match(/^([a-zA-Z0-9_-]+)/i);
      while (matchObjName && matchObjName.length > 1 && matchObjName[1].toUpperCase() != "WITH" && matchObjName[1].toUpperCase() != "LIMIT") { //object name
        let sobjectName = matchObjName[1];
        beforeSel = beforeSel.substring(sobjectName.length);
        beforeSel = beforeSel.trim();
        if (beforeSel.startsWith("(")) { //field
          if (beforeSel.indexOf(")") == -1) {
            let isAfterWhere = false;
            let whereKeywordMatch = /\s+where\s+([a-z0-9_]*)/i.exec(beforeSel);
            if (whereKeywordMatch) {
              isAfterWhere = true;
            }
            this.autocompleteField(vm, ctrlSpace, sobjectName, isAfterWhere);
            return;
          }
          beforeSel = beforeSel.substring(beforeSel.indexOf(")") + 1);
          beforeSel = beforeSel.trim();
        }
        if (beforeSel.startsWith(",")) { // next object
          beforeSel = beforeSel.substring(1);
          beforeSel = beforeSel.trim();
        }
        if (beforeSel == "") {
          this.autocompleteObject(vm, ctrlSpace);
          return;
        }
        matchObjName = beforeSel.match(/^([a-z0-9_-]+)/i);
      }
      if (beforeSel == "") {
        this.autocompleteObject(vm, ctrlSpace);
        return;
      }
    }
    if (beforeSel.toUpperCase().startsWith("WITH")) {
      vm.autocompleteResults = {
        sobjectName: "",
        title: "Suggestions:",
        results: new Enumerable(keywords)
          .filter(keyword => keyword.value.toLowerCase().includes(searchTerm.toLowerCase()))
          .toArray()
      };
      return;
    }
    //default all remaining keywords
    vm.autocompleteResults = {
      sobjectName: "",
      title: "Suggestions:",
      results: new Enumerable(keywords)
        .filter(keyword => keyword.value.toLowerCase().includes(searchTerm.toLowerCase()))
        .toArray()
    };
    return;
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
  autocompleteObject(vm, ctrlSpace) {
    let {globalStatus, globalDescribe} = vm.describeInfo.describeGlobal(vm.queryTooling);
    let query = vm.editor.value;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let searchTerm = selStart != selEnd
      ? query.substring(selStart, selEnd)
      : query.substring(0, selStart).match(/[a-zA-Z0-9_]*$/)[0];
    selStart = selEnd - searchTerm.length;

    if (!globalDescribe) {
      switch (globalStatus) {
        case "loading":
          vm.autocompleteResults = {
            sobjectName: "",
            title: "Loading metadata...",
            results: []
          };
          return;
        case "loadfailed":
          vm.autocompleteResults = {
            sobjectName: "",
            title: "Loading metadata failed.",
            results: [{value: "Retry", title: "Retry"}]
          };
          vm.autocompleteClick = vm.autocompleteReload.bind(vm);
          return;
        default:
          vm.autocompleteResults = {
            sobjectName: "",
            title: "Unexpected error: " + globalStatus,
            results: []
          };
          return;
      }
    }
    if (ctrlSpace) {
      let ar = new Enumerable(globalDescribe.sobjects)
        .filter(sobjectDescribe => sobjectDescribe.queryable && (sobjectDescribe.name.toLowerCase().includes(searchTerm.toLowerCase()) || sobjectDescribe.label.toLowerCase().includes(searchTerm.toLowerCase())))
        .map(sobjectDescribe => sobjectDescribe.name)
        .toArray();
      if (ar.length > 0) {
        vm.editor.focus();
        vm.applyEdit(ar.join(", "), selStart, selEnd, "end");
      }
      vm.editorAutocompleteHandler();
      return;
    }
    vm.autocompleteResults = {
      sobjectName: "",
      title: "Objects suggestions:",
      results: new Enumerable(globalDescribe.sobjects)
        .filter(sobjectDescribe => sobjectDescribe.queryable && (sobjectDescribe.name.toLowerCase().includes(searchTerm.toLowerCase()) || sobjectDescribe.label.toLowerCase().includes(searchTerm.toLowerCase())))
        .map(sobjectDescribe => ({value: sobjectDescribe.name, title: sobjectDescribe.label, suffix: " ", rank: 1, autocompleteType: "object", dataType: ""}))
        .toArray()
        .sort(this.resultsSort(searchTerm))
    };
  }

  suggestFieldValues(){
    //previous object suggestion
    let sobjectName = this.autocompleteResults.sobjectName;
    let useToolingApi = this.queryTooling;
    let selStart = this.editor.selectionStart;
    let selEnd = this.editor.selectionEnd;
    let query = this.editor.value;
    let searchTerm = selStart != selEnd
      ? query.substring(selStart, selEnd)
      : query.substring(0, selStart).match(/[a-zA-Z0-9_]*$/)[0];
    selStart = selEnd - searchTerm.length;
    let contextValueFields = this.autocompleteResults.contextValueFields;
    let fieldNames = contextValueFields.map(contextValueField => contextValueField.sobjectDescribe.name + "." + contextValueField.field.name).join(", ");
    if (contextValueFields.length > 1) {
      this.autocompleteResults = {
        sobjectName,
        title: "Multiple possible fields: " + fieldNames,
        results: []
      };
      return;
    }
    let contextValueField = contextValueFields[0];
    let queryMethod = useToolingApi ? "tooling/query" : this.queryAll ? "queryAll" : "query";
    let acQuery = "select " + contextValueField.field.name + " from " + contextValueField.sobjectDescribe.name + " where " + contextValueField.field.name + " like '%" + searchTerm.replace(/([%_\\'])/g, "\\$1") + "%' group by " + contextValueField.field.name + " limit 100";
    this.spinFor(sfConn.rest("/services/data/v" + apiVersion + "/" + queryMethod + "/?q=" + encodeURIComponent(acQuery), {progressHandler: this.autocompleteProgress})
      .catch(err => {
        if (err.name != "AbortError") {
          this.autocompleteResults = {
            sobjectName,
            title: "Error: " + err.message,
            results: []
          };
        }
        return null;
      })
      .then(data => {
        this.autocompleteProgress = {};
        if (!data) {
          return;
        }
        this.autocompleteResults = {
          sobjectName,
          title: fieldNames + " values suggestions:",
          results: new Enumerable(data.records)
            .map(record => record[contextValueField.field.name])
            .filter(value => value)
            .map(value => ({value: "'" + value + "'", title: value, suffix: " ", rank: 1, autocompleteType: "fieldValue"}))
            .toArray()
            .sort(this.resultsSort(searchTerm))
        };
      }));
    this.autocompleteResults = {
      sobjectName,
      title: "Loading " + fieldNames + " values...",
      results: []
    };
  }
  autocompleteField(vm, ctrlSpace, sobjectName, isAfterWhere) {
    let useToolingApi = vm.queryTooling;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let query = vm.editor.value;
    let searchTerm = selStart != selEnd
      ? query.substring(selStart, selEnd)
      : query.substring(0, selStart).match(/[a-zA-Z0-9_]*$/)[0];
    selStart = selEnd - searchTerm.length;

    /*
        * The context of a field is used to support queries on relationship fields.
        *
        * For example: If the cursor is at the end of the query "select Id from Contact where Account.Owner.Usern"
        * then the the searchTerm we want to autocomplete is "Usern", the contextPath is "Account.Owner." and the sobjectName is "Contact"
        *
        * When autocompleting field values in the query "select Id from Contact where Account.Type = 'Cus"
        * then the searchTerm we want to autocomplete is "Cus", the fieldName is "Type", the contextPath is "Account." and the sobjectName is "Contact"
        */

    let contextEnd = selStart;
    //after limit no proposition of field or field value
    if (query.substring(0, selStart).match(/(\s+limit)\s+[0-9]*\s*$/i)) {
      vm.autocompleteResults = {
        sobjectName,
        title: "LIMIT suggestions:",
        results: [{value: "1", title: "1", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""},
          {value: "10", title: "10", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""},
          {value: "100", title: "100", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""}
        ]
      };
      return; // don't autocomplete after LIMIT
    }
    // If we are on the right hand side of a comparison operator, autocomplete field values
    //opérator are = < > <= >= != includes() excludes() in like
    // \s*[<>=!]+\s*('?[^'\s]*)$
    let isFieldValue = query.substring(0, selStart).match(/(\s*[<>=!]+|(?:\s+not)?\s+(includes|excludes|in)\s*\(|\s+like)\s*\(?(?:[^,]*,\s*)*('?[^\s)]*'?)$/i);
    let fieldName = null;
    if (isFieldValue) {
      let fieldEnd = selStart - isFieldValue[0].length;
      fieldName = query.substring(0, fieldEnd).match(/[a-zA-Z0-9_]*$/)[0];
      contextEnd = fieldEnd - fieldName.length;
      selStart -= isFieldValue[3].length;
    }
    let isTypeOfWhen = !isAfterWhere && query.substring(0, selStart).match(/\s+TYPEOF\s+([a-z0-9_]*)\s+(?:WHEN\s+[a-z0-9_-]*\s+THEN\s+[a-z0-9_.]*\s+)*WHEN\s+\S*$/i);
    let isTypeOfThen = !isAfterWhere && query.substring(0, selStart).match(/\s+TYPEOF\s+(?:[a-z0-9_]*)\s+(?:WHEN\s+[a-z0-9_-]*\s+THEN\s+[a-z0-9_.]*\s+)*WHEN\s+(\S*)\s+THEN\s+\S*$/i);
    let isTypeOfEnd = !isAfterWhere && query.substring(0, selStart).match(/\s+TYPEOF\s+(?:[a-z0-9_]*)\s+(?:WHEN\s+[a-z0-9_-]*\s+THEN\s+[a-z0-9_.]*\s+)*WHEN\s+(\S*)\s+THEN\s+\S*\s+$/i);
    let isAfterOrderBy = query.substring(0, selStart).match(/[\n\s()]+ORDER\s+BY\s*/i);
    let isAfterGroupBy = query.substring(0, selStart).match(/[\n\s()]+GROUP\s+BY\s*/i);

    /*
    contextSobjectDescribes is a set of describe results for the relevant context sobjects.
    Example: "select Subject, Who.Name from Task"
    The context sobjects for "Subject" is {"Task"}.
    The context sobjects for "Who" is {"Task"}.
    The context sobjects for "Name" is {"Contact", "Lead"}.
    */
    let contextPath = query.substring(0, contextEnd).match(/[a-zA-Z0-9_.]*$/)[0];
    if (isTypeOfThen) {
      sobjectName = isTypeOfThen[1];
    }
    let {sobjectStatus, sobjectDescribe} = vm.describeInfo.describeSobject(useToolingApi, sobjectName);
    if (!sobjectDescribe) {
      switch (sobjectStatus) {
        case "loading":
          vm.autocompleteResults = {
            sobjectName,
            title: "Loading " + sobjectName + " metadata...",
            results: []
          };
          return;
        case "loadfailed":
          vm.autocompleteResults = {
            sobjectName,
            title: "Loading " + sobjectName + " metadata failed.",
            results: [{value: "Retry", title: "Retry"}]
          };
          vm.autocompleteClick = vm.autocompleteReload.bind(vm);
          return;
        case "notfound":
          vm.autocompleteResults = {
            sobjectName,
            title: "Unknown object: " + sobjectName,
            results: []
          };
          return;
        default:
          vm.autocompleteResults = {
            sobjectName,
            title: "Unexpected error for object: " + sobjectName + ": " + sobjectStatus,
            results: []
          };
          return;
      }
    }
    let contextSobjectDescribes = new Enumerable([sobjectDescribe]);
    let sobjectStatuses = new Map(); // Keys are error statuses, values are an object name with that status. Only one object name in the value, since we only show one error message.
    let lastIsPolymorph = false;
    if (contextPath) {
      let contextFields = contextPath.split(".");
      contextFields.pop(); // always empty
      for (let referenceFieldName of contextFields) {
        let newContextSobjectDescribes = new Set();
        let refTos = contextSobjectDescribes
          .flatMap(contextSobjectDescribe => contextSobjectDescribe.fields)
          .filter(field => field.relationshipName && field.relationshipName.toLowerCase() == referenceFieldName.toLowerCase())
          .flatMap(field => field.referenceTo).toArray();
        if (refTos.length > 10) {
          vm.autocompleteResults = {
            sobjectName,
            contextPath,
            title: "Field suggestions:",
            results: [{value: "Id", title: "Id", suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 2, autocompleteType: "fieldName", dataType: "id"},
              {value: "Type", title: "Type", suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 2, autocompleteType: "fieldName", dataType: "string"},
              {value: "Name", title: "Name", suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 2, autocompleteType: "fieldName", dataType: "string"},
              {value: "CreatedBy.", title: "CreatedBy", suffix: "", rank: 2, autocompleteType: "relationshipName", dataType: ""},
              {value: "LastModifiedBy.", title: "LastModifiedBy", suffix: "", rank: 2, autocompleteType: "relationshipName", dataType: ""},
              {value: "LastModifiedById", title: "LastModifiedById", suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 2, autocompleteType: "fieldName", dataType: "reference"},
              {value: "CreatedById", title: "CreatedById", suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 2, autocompleteType: "fieldName", dataType: "reference"},
              {value: "CreatedDate", title: "CreatedDate", suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 2, autocompleteType: "fieldName", dataType: "datetime"},
              {value: "LastModifiedDate", title: "LastModifiedDate", suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 2, autocompleteType: "fieldName", dataType: "datetime"}
            ]
          };
          return;
        }
        lastIsPolymorph = (refTos.length > 1);
        for (let referencedSobjectName of refTos) {
          let {sobjectStatus, sobjectDescribe} = vm.describeInfo.describeSobject(useToolingApi, referencedSobjectName);
          if (sobjectDescribe) {
            newContextSobjectDescribes.add(sobjectDescribe);
          } else {
            sobjectStatuses.set(sobjectStatus, referencedSobjectName);
          }
        }
        contextSobjectDescribes = new Enumerable(newContextSobjectDescribes);
      }
    }

    if (!contextSobjectDescribes.some()) {
      if (sobjectStatuses.has("loading")) {
        vm.autocompleteResults = {
          sobjectName,
          title: "Loading " + sobjectStatuses.get("loading") + " metadata...",
          results: []
        };
        return;
      }
      if (sobjectStatuses.has("loadfailed")) {
        vm.autocompleteResults = {
          sobjectName,
          title: "Loading " + sobjectStatuses.get("loadfailed") + " metadata failed.",
          results: [{value: "Retry", title: "Retry"}]
        };
        vm.autocompleteClick = vm.autocompleteReload.bind(vm);
        return;
      }
      if (sobjectStatuses.has("notfound")) {
        vm.autocompleteResults = {
          sobjectName,
          title: "Unknown object: " + sobjectStatuses.get("notfound"),
          results: []
        };
        return;
      }
      if (sobjectStatuses.size > 0) {
        vm.autocompleteResults = {
          sobjectName,
          title: "Unexpected error: " + sobjectStatus,
          results: []
        };
        return;
      }
      vm.autocompleteResults = {
        sobjectName,
        title: "Unknown field: " + sobjectName + "." + contextPath,
        results: []
      };
      return;
    }
    let isAfterHaving = query.substring(0, selStart).match(/[\n\s()]+(HAVING)[\n\s()]+[a-zA-Z0-9.-_()]+[\n\s()]+\S*$/i);
    let isOperator = isAfterWhere && (isAfterHaving || (!isAfterOrderBy && !isAfterGroupBy && query.substring(0, selStart).match(/[\n\s()]+(AND|WHERE|OR)[\n\s()]+[a-zA-Z0-9.-_()]+[\n\s()]+\S*$/i)));
    let isBooleanOperator = isAfterWhere && !isAfterOrderBy && !isAfterGroupBy && !isFieldValue && !isOperator && query.substring(0, selStart).match(/(\s*[<>=!]+|(?:\s+not)?\s+(includes|excludes|in)\s*\(|\s+like)\s*\(?(?:[^,]*,)*('?[^'\s]*'?)\s+$/i);

    if (isFieldValue) {
      //check if fieldname is polymorphique field
      if (fieldName.toLowerCase() == "type"
        && contextPath != null
        && (contextPath.toLowerCase().endsWith("who.")
        || contextPath.toLowerCase().endsWith("what.")
        || contextPath.toLowerCase().endsWith("owner.")
        || contextPath.toLowerCase().endsWith("LinkedEntity."))) {
        this.autocompleteObject(vm, ctrlSpace);
        return;
      }
      // Autocomplete field values
      let contextValueFields = contextSobjectDescribes
        .flatMap(sobjectDescribe => sobjectDescribe.fields
          .filter(field => field.name.toLowerCase() == fieldName.toLowerCase())
          .map(field => ({sobjectDescribe, field}))
        )
        .toArray();
      if (contextValueFields.length == 0) {
        vm.autocompleteResults = {
          sobjectName,
          title: "Unknown field: " + sobjectDescribe.name + "." + contextPath + fieldName,
          results: []
        };
        return;
      }
      let fieldNames = contextValueFields.map(contextValueField => contextValueField.sobjectDescribe.name + "." + contextValueField.field.name).join(", ");
      if (ctrlSpace) {
        // Since this performs a Salesforce API call, we ask the user to opt in by pressing Ctrl+Space
        vm.suggestFieldValues();
        return;
      }
      let ar = new Enumerable(contextValueFields).flatMap(function* ({field}) {
        yield* field.picklistValues.map(pickVal => ({value: "'" + pickVal.value + "'", title: pickVal.label, suffix: " ", rank: 1, autocompleteType: "picklistValue", dataType: ""}));
        if (field.type == "boolean") {
          yield {value: "true", title: "true", suffix: " ", rank: 1};
          yield {value: "false", title: "false", suffix: " ", rank: 1};
        }
        if (field.type == "date" || field.type == "datetime") {
          let pad = (n, d) => ("000" + n).slice(-d);
          let d = new Date();
          if (field.type == "date") {
            yield {value: pad(d.getFullYear(), 4) + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2), title: "Today", suffix: " ", rank: 1};
          }
          if (field.type == "datetime") {
            yield {
              value: pad(d.getFullYear(), 4) + "-" + pad(d.getMonth() + 1, 2) + "-" + pad(d.getDate(), 2) + "T"
                + pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) + ":" + pad(d.getSeconds(), 2) + "." + pad(d.getMilliseconds(), 3)
                + (d.getTimezoneOffset() <= 0 ? "+" : "-") + pad(Math.floor(Math.abs(d.getTimezoneOffset()) / 60), 2)
                + ":" + pad(Math.abs(d.getTimezoneOffset()) % 60, 2),
              title: "Now",
              suffix: " ",
              rank: 1
            };
          }
          // from https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_dateformats.htm Winter 24
          yield {value: "YESTERDAY", title: "Starts 12:00:00 the day before and continues for 24 hours.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "TODAY", title: "Starts 12:00:00 of the current day and continues for 24 hours.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "TOMORROW", title: "Starts 12:00:00 after the current day and continues for 24 hours.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_WEEK", title: "Starts 12:00:00 on the first day of the week before the most recent first day of the week and continues for seven full days. First day of the week is determined by your locale.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "THIS_WEEK", title: "Starts 12:00:00 on the most recent first day of the week before the current day and continues for seven full days. First day of the week is determined by your locale.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_WEEK", title: "Starts 12:00:00 on the most recent first day of the week after the current day and continues for seven full days. First day of the week is determined by your locale.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_MONTH", title: "Starts 12:00:00 on the first day of the month before the current day and continues for all the days of that month.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "THIS_MONTH", title: "Starts 12:00:00 on the first day of the month that the current day is in and continues for all the days of that month.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_MONTH", title: "Starts 12:00:00 on the first day of the month after the month that the current day is in and continues for all the days of that month.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_90_DAYS", title: "Starts 12:00:00 of the current day and continues for the last 90 days.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_90_DAYS", title: "Starts 12:00:00 of the current day and continues for the next 90 days.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_N_DAYS:n", title: "For the number n provided, starts 12:00:00 of the current day and continues for the last n days.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_N_DAYS:n", title: "For the number n provided, starts 12:00:00 of the current day and continues for the next n days.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_N_WEEKS:n", title: "For the number n provided, starts 12:00:00 of the first day of the next week and continues for the next n weeks.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "N_DAYS_AGO:n", title: "Starts at 12:00:00 AM on the day n days before the current day and continues for 24 hours. (The range doesn’t include today.)", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_N_WEEKS:n", title: "For the number n provided, starts 12:00:00 of the last day of the previous week and continues for the last n weeks.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "N_WEEKS_AGO:n", title: "Starts at 12:00:00 AM on the first day of the month that started n months before the start of the current month and continues for all the days of that month.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_N_MONTHS:n", title: "For the number n provided, starts 12:00:00 of the first day of the next month and continues for the next n months.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_N_MONTHS:n", title: "For the number n provided, starts 12:00:00 of the last day of the previous month and continues for the last n months.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "N_MONTHS_AGO:n", title: "For the number n provided, starts 12:00:00 of the last day of the previous month and continues for the last n months.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "THIS_QUARTER", title: "Starts 12:00:00 of the current quarter and continues to the end of the current quarter.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_QUARTER", title: "Starts 12:00:00 of the previous quarter and continues to the end of that quarter.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_QUARTER", title: "Starts 12:00:00 of the next quarter and continues to the end of that quarter.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_N_QUARTERS:n", title: "Starts 12:00:00 of the next quarter and continues to the end of the nth quarter.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_N_QUARTERS:n", title: "Starts 12:00:00 of the previous quarter and continues to the end of the previous nth quarter.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "N_QUARTERS_AGO:n", title: "Starts at 12:00:00 AM on the first day of the calendar quarter n quarters before the current calendar quarter and continues to the end of that quarter.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "THIS_YEAR", title: "Starts 12:00:00 on January 1 of the current year and continues through the end of December 31 of the current year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_YEAR", title: "Starts 12:00:00 on January 1 of the previous year and continues through the end of December 31 of that year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_YEAR", title: "Starts 12:00:00 on January 1 of the following year and continues through the end of December 31 of that year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_N_YEARS:n", title: "Starts 12:00:00 on January 1 of the following year and continues through the end of December 31 of the nth year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_N_YEARS:n", title: "Starts 12:00:00 on January 1 of the previous year and continues through the end of December 31 of the previous nth year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "N_YEARS_AGO:n", title: "Starts at 12:00:00 AM on January 1 of the calendar year n years before the current calendar year and continues through the end of December 31 of that year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "THIS_FISCAL_QUARTER", title: "Starts 12:00:00 on the first day of the current fiscal quarter and continues through the end of the last day of the fiscal quarter. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_FISCAL_QUARTER", title: "Starts 12:00:00 on the first day of the last fiscal quarter and continues through the end of the last day of that fiscal quarter. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_FISCAL_QUARTER", title: "Starts 12:00:00 on the first day of the next fiscal quarter and continues through the end of the last day of that fiscal quarter. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_N_FISCAL_QUARTERS:n", title: "Starts 12:00:00 on the first day of the next fiscal quarter and continues through the end of the last day of the nth fiscal quarter. The fiscal year is defined in the company profile under Setup atCompany Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_N_FISCAL_QUARTERS:n", title: "Starts 12:00:00 on the first day of the last fiscal quarter and continues through the end of the last day of the previous nth fiscal quarter. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "N_FISCAL_QUARTERS_AGO:n", title: "Starts at 12:00:00 AM on the first day of the fiscal quarter n fiscal quarters before the current fiscal quarter and continues through the end of the last day of that fiscal quarter.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "THIS_FISCAL_YEAR", title: "Starts 12:00:00 on the first day of the current fiscal year and continues through the end of the last day of the fiscal year. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_FISCAL_YEAR", title: "Starts 12:00:00 on the first day of the last fiscal year and continues through the end of the last day of that fiscal year. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_FISCAL_YEAR", title: "Starts 12:00:00 on the first day of the next fiscal year and continues through the end of the last day of that fiscal year. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "NEXT_N_FISCAL_YEARS:n", title: "Starts 12:00:00 on the first day of the next fiscal year and continues through the end of the last day of the nth fiscal year. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "LAST_N_FISCAL_YEARS:n", title: "Starts 12:00:00 on the first day of the last fiscal year and continues through the end of the last day of the previous nth fiscal year. The fiscal year is defined in the company profile under Setup at Company Profile | Fiscal Year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
          yield {value: "N_FISCAL_YEARS_AGO:n", title: "Starts at 12:00:00 AM on the first day of the fiscal year n fiscal years ago and continues through the end of the last day of that fiscal year.", suffix: " ", rank: 1, autocompleteType: "variable", dataType: ""};
        }
        if (field.nillable) {
          yield {value: "null", title: "null", suffix: " ", rank: 1, autocompleteType: "null", dataType: ""};
        }
      })
        .filter(res => res.value.toLowerCase().includes(searchTerm.toLowerCase()) || res.title.toLowerCase().includes(searchTerm.toLowerCase()))
        .toArray()
        .sort(this.resultsSort(searchTerm));
      vm.autocompleteResults = {
        sobjectName,
        isFieldValue,
        contextValueFields,
        title: fieldNames + (ar.length == 0 ? " values (Press Ctrl+Space to load suggestions):" : " values:"),
        results: ar
      };
      return;
    }
    if (isTypeOfWhen) {
      let fieldName = isTypeOfWhen[1];
      vm.autocompleteResults = {
        sobjectName,
        isField: false,
        contextPath,
        title: "typeof suggestions:",
        results: contextSobjectDescribes
          .flatMap(sobjectDescribe => sobjectDescribe.fields)
          .filter(field => field.type != "address" && field.relationshipName && field.relationshipName.toLowerCase() == fieldName.toLowerCase())
          .flatMap(function* (field) {
            for (let refto of field.referenceTo) {
              yield {value: refto, title: refto, suffix: " THEN  END", rank: 1, autocompleteType: "object", dataType: ""};
            }
          })
          .toArray()
          .sort(this.resultsSort(searchTerm))
      };
      return;
    }

    let operators = [];
    if (isOperator) {
      operators.push({value: "IN", title: "IN", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "INCLUDES(", title: "INCLUDES", suffix: ")", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "EXCLUDES(", title: "EXCLUDES", suffix: ")", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "LIKE", title: "LIKE", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "=", title: "=", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "<", title: "<", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: ">", title: ">", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "<=", title: "<=", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: ">=", title: ">=", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "!=", title: "!=", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "NOT", title: "NOT", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""});

    } else if (isBooleanOperator) {
      operators.push({value: "AND", title: "AND", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "OR", title: "OR", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "GROUP", title: "GROUP BY", suffix: " BY", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "ORDER", title: "ORDER BY", suffix: " BY", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "LIMIT", title: "LIMIT", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "HAVING", title: "HAVING", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""});
    } else if (isAfterOrderBy) {
      operators.push({value: "ASC", title: "ASC", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "DESC", title: "DESC", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "HAVING", title: "HAVING", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "LIMIT", title: "LIMIT", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""});
    } else if (isAfterGroupBy) {
      operators.push({value: "HAVING", title: "HAVING", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "LIMIT", title: "LIMIT", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "ORDER", title: "ORDER BY", suffix: " BY", rank: 1, autocompleteType: "keyword", dataType: ""},
        {value: "ROLLUP", title: "ROLLUP", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""});
    } else if (isTypeOfEnd) {
      operators.push({value: "WHEN", title: "WHEN", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""});
      operators.push({value: "END", title: "END", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""});
    }
    if (lastIsPolymorph) {
      operators.push({value: "type", title: "type", suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 1, autocompleteType: "fieldName", dataType: "string"});
    }
    let prepend = new Enumerable(operators)
      .filter(fn => fn.value.toLowerCase().startsWith(searchTerm.toLowerCase()));
      // Autocomplete field names and functions
    if (ctrlSpace) {
      let ar = contextSobjectDescribes
        .flatMap(sobjectDescribe => sobjectDescribe.fields)
        .filter(field => field.name.toLowerCase().includes(searchTerm.toLowerCase()) || field.label.toLowerCase().includes(searchTerm.toLowerCase()))
        .map(field => contextPath + field.name)
        .toArray();
      if (ar.length > 0) {
        vm.editor.focus();
        vm.applyEdit(ar.join(", ") + (isAfterWhere ? " " : ""), selStart - contextPath.length, selEnd, "end");
      }
      vm.editorAutocompleteHandler();
      return;
    }
    vm.autocompleteResults = {
      sobjectName,
      isField: true,
      contextPath,
      title: contextSobjectDescribes.map(sobjectDescribe => sobjectDescribe.name).toArray().join(", ") + " fields suggestions:",
      results: contextSobjectDescribes
        .flatMap(sobjectDescribe => sobjectDescribe.fields)
        .filter(field => field.type != "address")
        .flatMap(function* (field) {
          yield {value: field.name, title: field.label, suffix: (isAfterWhere || isAfterGroupBy || isAfterOrderBy) ? " " : ", ", rank: 2, autocompleteType: "fieldName", dataType: field.type};
          if (field.relationshipName) {
            yield {value: field.relationshipName + ".", title: field.label, suffix: "", rank: 2, autocompleteType: "relationshipName", dataType: ""};
            if (field.referenceTo != null && field.referenceTo.length > 1) {
              yield {value: "TYPEOF " + field.relationshipName, title: "TYPEOF " + field.label, suffix: " WHEN ", rank: 3, autocompleteType: "variable", dataType: ""};
            }
          }
        })
        .filter(field => field.value.toLowerCase().includes(searchTerm.toLowerCase()) || field.title.toLowerCase().includes(searchTerm.toLowerCase()))
        .concat(prepend)
        .concat(
          new Enumerable(["FIELDS(ALL)", "FIELDS(STANDARD)", "FIELDS(CUSTOM)", "AVG", "COUNT", "COUNT_DISTINCT", "MIN", "MAX", "SUM", "CALENDAR_MONTH", "CALENDAR_QUARTER", "CALENDAR_YEAR", "DAY_IN_MONTH", "DAY_IN_WEEK", "DAY_IN_YEAR", "DAY_ONLY", "FISCAL_MONTH", "FISCAL_QUARTER", "FISCAL_YEAR", "HOUR_IN_DAY", "WEEK_IN_MONTH", "WEEK_IN_YEAR", "convertTimezone", "toLabel", "convertCurrency", "FORMAT", "GROUPING"])
            .filter(fn => fn.toLowerCase().startsWith(searchTerm.toLowerCase()))
            .map(fn => {
              if (fn.includes(")")) { //Exception to easily support functions with hardcoded parameter options
                return {value: fn, title: fn, suffix: "", rank: 3, autocompleteType: "variable", dataType: ""};
              } else {
                return {value: fn, title: fn + "()", suffix: "(", rank: 3, autocompleteType: "variable", dataType: ""};
              }
            })
        )
        .toArray()
        .sort(this.resultsSort(searchTerm))
    };
  }

  autocompleteRelation(ctx, suggestRelation) {
    let useToolingApi = ctx.vm.queryTooling;
    let selStart = ctx.vm.editor.selectionStart;
    let selEnd = ctx.vm.editor.selectionEnd;
    let query = ctx.vm.editor.value;
    let searchTerm = selStart != selEnd
      ? query.substring(selStart, selEnd)
      : query.substring(0, selStart).match(/[a-zA-Z0-9_]*$/)[0];
    selStart = selEnd - searchTerm.length;

    let {sobjectStatus, sobjectDescribe} = ctx.vm.describeInfo.describeSobject(useToolingApi, ctx.parentSObjectName);
    if (!sobjectDescribe) {
      switch (sobjectStatus) {
        case "loading":
          ctx.vm.autocompleteResults = {
            sobjectName: ctx.parentSObjectName,
            title: "Loading " + ctx.parentSObjectName + " metadata...",
            results: []
          };
          return;
        case "loadfailed":
          ctx.vm.autocompleteResults = {
            sobjectName: ctx.parentSObjectName,
            title: "Loading " + ctx.parentSObjectName + " metadata failed.",
            results: [{value: "Retry", title: "Retry"}]
          };
          ctx.vm.autocompleteClick = ctx.vm.autocompleteReload.bind(ctx.vm);
          return;
        case "notfound":
          ctx.vm.autocompleteResults = {
            sobjectName: ctx.parentSObjectName,
            title: "Unknown object: " + ctx.parentSObjectName,
            results: []
          };
          return;
        default:
          ctx.vm.autocompleteResults = {
            sobjectName: ctx.parentSObjectName,
            title: "Unexpected error for object: " + ctx.parentSObjectName + ": " + sobjectStatus,
            results: []
          };
          return;
      }
    }
    let contextSobjectDescribes = new Enumerable([sobjectDescribe]);
    let ar = contextSobjectDescribes
      .flatMap(sobjectDescribe => sobjectDescribe.childRelationships)
      .filter(relation => relation.relationshipName && (!ctx.fromObject || relation.relationshipName.toLowerCase().startsWith(ctx.fromObject.toLowerCase())))
      .map(rel => ({value: rel.relationshipName, title: rel.relationshipName + "(" + rel.childSObject + "." + rel.field + ")", suffix: " ", rank: 1, autocompleteType: "object", dataType: rel.childSObject}))
      .toArray()
      .sort(this.resultsSort(searchTerm));
    if (ctx.ctrlSpace) {
      if (ar.length > 0) {
        let rel = ar[0];
        ctx.sobjectName = rel.dataType;
      }
      this.selectSuggestion();
      return;
    }
    if (suggestRelation) {
      ctx.vm.autocompleteResults = {
        sobjectName: ctx.parentSObjectName,
        title: "Relations suggestions:",
        results: ar
      };
    } else {
      ctx.sobjectName = ar
        .filter(relation => relation.value && (ctx.fromObject && relation.value.toLowerCase() == ctx.fromObject.toLowerCase()))
        .map(rel => rel.dataType).shift();
    }
    return;
  }

  /**
   * SOQL query autocomplete handling.
   * Put caret at the end of a word or select some text to autocomplete it.
   * Searches for both label and API name.
   * Autocompletes sobject names after the "from" keyword.
   * Autocompletes field names, if the "from" keyword exists followed by a valid object name.
   * Supports relationship fields.
   * Autocompletes field values (picklist values, date constants, boolean values).
   * Autocompletes any textual field value by performing a Salesforce API query when Ctrl+Space is pressed.
   * Inserts all autocomplete field suggestions when Ctrl+Space is pressed.
   * Supports subqueries in where clauses, but not in select clauses.
   */
  editorAutocompleteHandler(e = {}) {
    let vm = this; // eslint-disable-line consistent-this
    let useToolingApi = vm.queryTooling;
    let query = vm.editor.value;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let ctrlSpace = e.ctrlSpace;
    if (e.inputType == "insertLineBreak") {
      let lastLine = query.substring(0, selStart - 1);//remove inserted break
      lastLine = lastLine.substring(lastLine.lastIndexOf("\n") + 1);
      let m = lastLine.match(/^\s+/);
      if (m) {
        vm.applyEdit(m[0], selStart, selEnd, "end");
      }
    }
    if (this.isSearchMode()) {
      this.searchAutocompleteHandler(e);
      return;
    }

    // Skip the calculation when no change is made. This improves performance and prevents async operations (Ctrl+Space) from being canceled when they should not be.
    let newAutocompleteState = [useToolingApi, query, selStart, selEnd].join("$");
    if (newAutocompleteState == vm.autocompleteState && !ctrlSpace && !e.newDescribe) {
      return;
    }
    vm.autocompleteState = newAutocompleteState;

    // Cancel any async operation since its results will no longer be relevant.
    if (vm.autocompleteProgress.abort) {
      vm.autocompleteProgress.abort();
    }

    vm.autocompleteClick = ({value, suffix, link}) => {
      if (link){
        window.open(link, "_blank");
      } else {
        vm.editor.focus();
        //handle when selected field is the last one before "FROM" keyword, or if an existing comma is present after selection
        let indexFrom = query.toLowerCase().indexOf("from");
        if (suffix.trim() == "," && (query.substring(selEnd + 1, indexFrom).trim().length == 0 || query.substring(selEnd).trim().startsWith(",") || query.substring(selEnd).trim().toLowerCase().startsWith("from"))) {
          suffix = "";
        }
        vm.applyEdit(value + suffix, selStart, selEnd, "end");
        //add query suffix if needed
        if (value.startsWith("FIELDS") && !query.toLowerCase().includes("limit")) {
          vm.editor.value += " LIMIT 200";
        }
        vm.editorAutocompleteHandler();
      }
    };

    // Find the token we want to autocomplete. This is the selected text, or the last word before the cursor.
    let searchTerm = selStart != selEnd
      ? query.substring(selStart, selEnd)
      : query.substring(0, selStart).match(/[a-zA-Z0-9_]*$/)[0];
    selStart = selEnd - searchTerm.length;

    let sobjectName, isAfterFrom;
    // Find out what sobject we are querying, by using the word after the "from" keyword.
    let fromRegEx = /(^|\s)from\s+([a-z0-9_]*)/gi;
    let fromKeywordMatch;
    let fromIdx = 0;
    //skip subquery by checking that we have same number of open and close parenthesis before
    while ((fromKeywordMatch = fromRegEx.exec(query)) !== null) {
      fromIdx = fromKeywordMatch.index + fromKeywordMatch[0].length;
      let beforeFrom = query.substring(0, fromKeywordMatch.index);
      let openParenthesisSplit = beforeFrom.split("(");
      if (sobjectName //in sub query after from
        && isAfterFrom
        && selStart > beforeFrom.toLowerCase().lastIndexOf("select") // after start of subquery
        && selStart <= fromKeywordMatch.index + query.substring(fromKeywordMatch.index).indexOf(")")) {
        sobjectName = fromKeywordMatch[2];
        isAfterFrom = selStart > fromKeywordMatch.index + 1;
        break;
      }
      if (!beforeFrom
        || (openParenthesisSplit.length == beforeFrom.split(")").length) // same number of open and close parenthesis = no more in subquery
        || !openParenthesisSplit[openParenthesisSplit.length - 1].trim().toLowerCase().startsWith("select")) { // not a subquery
        sobjectName = fromKeywordMatch[2];
        isAfterFrom = selStart > fromKeywordMatch.index + 1;
      }
    }
    // If we are just after the last "from" keyword, autocomplete the sobject name
    fromRegEx = /(^|\s)from\s*$/gi;
    let fromKeywordMatch2 = fromRegEx.exec(query.substring(0, selStart));
    if (fromKeywordMatch2) {
      let beforeFrom = query.substring(0, fromKeywordMatch2.index);
      let openParenthesisSplit = beforeFrom.split("(");
      //not in subquery before main from
      if (!beforeFrom //nothing before
        || (beforeFrom.split("(").length == beforeFrom.split(")").length) //not in subquery before main from
        || !openParenthesisSplit[openParenthesisSplit.length - 1].trim().toLowerCase().startsWith("select")
        || isAfterFrom) { // after main from => Id IN (SELECT Id...)
        this.autocompleteObject(vm, false);
        return;
      }
    }
    if (!sobjectName) {
      if (query.substring(0, selStart).toLowerCase().indexOf("select") < 0) {
        vm.autocompleteResults = {
          sobjectName: "",
          title: "",
          results: [{value: "SELECT", title: "SELECT", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""}]
        };
        return;
      } else if (selStart <= query.toLowerCase().indexOf("from") || query.substring(0, selStart).match(/select\s+[a-zA-Z0-9_]+\s/gi)) {
        vm.autocompleteResults = {
          sobjectName: "",
          title: "",
          results: [{value: "FROM", title: "FROM", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""}]
        };
        return;
      } else {
        vm.autocompleteResults = {
          sobjectName: "",
          title: "",
          results: [{value: "Id", title: "Id", suffix: " ", rank: 1, autocompleteType: "fieldName", dataType: ""}]
        };
        return;
      }
    }
    let ctx = {vm, ctrlSpace, query, selStart, sobjectName, isAfterFrom, fromIdx};
    if (isAfterFrom || !this.parseSubQuery(ctx)) {
      if (ctx.isAfterFrom && query.substring(ctx.fromIdx, selStart).trim() == "") {
        vm.autocompleteResults = {
          sobjectName: "",
          title: "",
          results: [{value: "WHERE", title: "WHERE", suffix: " ", rank: 1, autocompleteType: "keyword", dataType: ""},
            {value: "GROUP", title: "GROUP BY", suffix: " BY", rank: 1, autocompleteType: "keyword", dataType: ""},
            {value: "ORDER", title: "ORDER BY", suffix: " BY", rank: 1, autocompleteType: "keyword", dataType: ""},
            {value: "LIMIT", title: "LIMIT", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""},
            {value: "HAVING", title: "HAVING", suffix: "", rank: 1, autocompleteType: "keyword", dataType: ""}]
        };
        return;
      }
      this.autocompleteField(vm, ctrlSpace, ctx.sobjectName, ctx.isAfterFrom);
    }
  }
  parseSubQuery(ctx) {
    // If we are in a subquery, try to detect that.
    let subQueryRegExp = /\((\s*select.*?)(\sfrom\s+)([a-z0-9_]*)(\s*.*)\)/gi;
    let subQuery = ctx.query;
    let fromKeywordMatch;
    while ((fromKeywordMatch = subQueryRegExp.exec(subQuery)) !== null) {
      ctx.fromIdx = fromKeywordMatch.index + fromKeywordMatch[1].length + fromKeywordMatch[2].length + fromKeywordMatch[3].length;
      if (fromKeywordMatch
        && fromKeywordMatch.index < ctx.selStart
        && fromKeywordMatch.index + fromKeywordMatch[0].length > ctx.selStart) {
        ctx.parentSObjectName = ctx.sobjectName;
        ctx.fromObject = fromKeywordMatch[3];
        ctx.isAfterFrom = false;
        if (ctx.fromObject === undefined){
          ctx.fromObject = "";
        }

        if (fromKeywordMatch.index + fromKeywordMatch[1].length + 1 >= ctx.selStart){
          //in select : grab relation link for ctx
          this.autocompleteRelation(ctx, false);
          subQueryRegExp = /\((\s*select.*\sfrom\s+)([a-z0-9_]*)(\s*.*)\)/gmi;
          subQuery = ctx.query.substring(0, fromKeywordMatch.index) + "(" + fromKeywordMatch[1];
          if (!ctx.sobjectName){
            ctx.sobjectName = ctx.parentSObjectName;
          }
        } else if (fromKeywordMatch.index + fromKeywordMatch[1].length + fromKeywordMatch[2].length > ctx.selStart){
          return true;
        } else if (fromKeywordMatch.index + fromKeywordMatch[1].length + fromKeywordMatch[2].length + fromKeywordMatch[3].length >= ctx.selStart){
          this.autocompleteRelation(ctx, true);
          return true;
        } else { // after from
          this.autocompleteRelation(ctx, false);
          if (!ctx.sobjectName){
            ctx.sobjectName = ctx.parentSObjectName;
            this.autocompleteRelation(ctx, true);
            return true;
          }
          ctx.isAfterFrom = true;
          return false;
        }
      }
    }
    return false;
  }
  nextWord(sentence, ctx) {
    let regex = /^\s*([a-z0-9_.]+|'[^']+'|,|\(|\)|[<>!]=?|=)/i;
    if (!sentence) {
      ctx.value = "";
      ctx.pos++;
      return;
    }
    let match = regex.exec(sentence.substring(ctx.pos));
    if (match) {
      ctx.value = match[1];
      ctx.pos += match.index + match[0].length;
      return;
    }
    ctx.value = "";
    ctx.pos++;
    return;
  }

  extractColumnFromQuery(query, ctx) {
    if (!ctx) {
      ctx = {value: "", pos: 0};
    }
    this.nextWord(query, ctx);
    let result = {fields: [], objectName: ""};
    if (!ctx.value) {
      return result;
    }
    if (ctx.value.toLowerCase() != "select") {
      return result;
    }
    this.nextWord(query, ctx);
    let expressionIndex = 0;
    let fieldIndex = 0;
    //parse field and subquery
    while (ctx.value && ctx.value.toLowerCase() != "from") {
      let field = {name: ctx.value, position: fieldIndex};
      fieldIndex++;
      if (ctx.value == "(") {
        let subqry = this.extractColumnFromQuery(query, ctx);
        subqry.name = subqry.objectName;
        subqry.position = field.position;
        field = subqry;
        //skip end parenthesis
        this.nextWord(query, ctx);
      } else { //regular field
        this.nextWord(query, ctx);
        if (ctx.value == "(") { //function
          while (ctx.value && ctx.value != ")") {
            this.nextWord(query, ctx);
          }
          if (ctx.value != ",") { //alias
            field.name = ctx.value;
            this.nextWord(query, ctx);
          } else {
            field.name = "expr" + expressionIndex;
            expressionIndex++;
          }
        }
      }
      if (ctx.value == ",") {
        this.nextWord(query, ctx);
      }
      result.fields.push(field);
    }
    if (ctx.value.toLowerCase() == "from") {
      this.nextWord(query, ctx);
      result.objectName = ctx.value;
    }
    this.nextWord(query, ctx);
    let deep = 0;
    while (ctx.value) {
      if (ctx.value == "(") {
        deep++;
      }
      if (ctx.value == ")") {
        if (deep == 0) {
          return result;
        }
        deep--;
      }
      this.nextWord(query, ctx);
    }
    return result;
  }

  formatQuery(query) {
    let ctx = {value: "", pos: 0};
    let formatedQuery = "";
    this.nextWord(query, ctx);
    let fieldCount = 0;
    let indent = 0;
    while (ctx.value) {
      switch (ctx.value.toLowerCase()){
        case "select":
          fieldCount = 0;
          formatedQuery += "SELECT ";
          indent++;
          break;
        case "(":
          fieldCount = 0;
          formatedQuery += "\n" + "  ".repeat(indent) + "(" + "\n" + "  ".repeat(indent + 1);
          indent++;
          break;
        case ")":
          fieldCount = 0;
          indent--;
          formatedQuery += "\n" + "  ".repeat(indent) + ")";
          break;
        case ",":
          fieldCount++;
          if (fieldCount >= 4) {
            formatedQuery += ",\n" + "  ".repeat(indent);
            fieldCount = 0;
          } else {
            formatedQuery += ",";
          }
          break;
        case "from":
          indent--;
          //TO force space after from where ...
          fieldCount = 1;
          formatedQuery += "\n" + "  ".repeat(indent) + ctx.value.toUpperCase();
          break;
        case "and":
        case "or":
        case "where":
        case "limit":
        case "order":
        case "group":
        case "find":
        case "returning":
        case "offset":
        case "with":
          formatedQuery += "\n" + "  ".repeat(indent) + ctx.value.toUpperCase();
          break;
        default:
          formatedQuery += (fieldCount ? " " : "") + ctx.value;
          break;
      }
      this.nextWord(query, ctx);
    }
    return formatedQuery;
  }
  cleanupQuery(query, vm) {
    let remaining = query;
    let commentRegEx = /(\/\/|\/\*|'|,\s*,|,\s*FROM\s+)/gi;
    let commentMatch;
    let finalQuery = "";
    let endIndex;
    let newQuery = "";
    //skip subquery by checking that we have same number of open and close parenthesis before
    while ((commentMatch = commentRegEx.exec(remaining)) !== null) {
      switch (commentMatch[1]) {
        case "//":{
          finalQuery += remaining.substring(0, commentMatch.index);
          newQuery += remaining.substring(0, commentMatch.index + 2);
          remaining = remaining.substring(commentMatch.index + 2);
          endIndex = remaining.indexOf("\n");
          if (endIndex > 0) {
            newQuery += remaining.substring(0, endIndex + 1);
            remaining = remaining.substring(endIndex + 1);
          } else {
            newQuery += remaining;
            remaining = "";
          }
          break;
        }
        case "/*":{
          finalQuery += remaining.substring(0, commentMatch.index);
          newQuery += remaining.substring(0, commentMatch.index + 2);
          remaining = remaining.substring(commentMatch.index + 2);
          endIndex = remaining.indexOf("*/");
          if (endIndex > 0) {
            newQuery += remaining.substring(0, endIndex + 2);
            remaining = remaining.substring(endIndex + 2);
          } else {
            newQuery += remaining;
            remaining = "";
          }
          break;
        }
        case "'": {
          finalQuery += remaining.substring(0, commentMatch.index + 1);
          newQuery += remaining.substring(0, commentMatch.index + 1);
          remaining = remaining.substring(commentMatch.index + 1);
          let match = remaining.match(/[^\\]'/);
          if (match) {
            endIndex = match.index + 1;
          } else {
            endIndex = -1;
          }
          if (endIndex > 0) {
            finalQuery += remaining.substring(0, endIndex + 1);
            newQuery += remaining.substring(0, endIndex + 1);
            remaining = remaining.substring(endIndex + 1);
          } else {
            newQuery += remaining;
            remaining = "";
          }
          break;
        }
        default: {
          //comma before from
          if (commentMatch[1] && commentMatch[1].includes("FROM")) {
            finalQuery += remaining.substring(0, commentMatch.index) + commentMatch[1].substring(1);
            newQuery += remaining.substring(0, commentMatch.index) + commentMatch[1].substring(1);
            remaining = remaining.substring(commentMatch.index + commentMatch[1].length);
          } else { //double comma
            finalQuery += remaining.substring(0, commentMatch.index) + commentMatch[1].substring(1);
            newQuery += remaining.substring(0, commentMatch.index) + commentMatch[1].substring(1);
            remaining = remaining.substring(commentMatch.index + commentMatch[1].length);
          }
          break;
        }
      }
      //reset regex index
      commentRegEx = /(\/\/|\/\*|'|,\s*,|,\s*FROM\s+)/gi;
    }
    finalQuery += remaining;
    newQuery += remaining;
    if (query != newQuery) {
      vm.editor.value = newQuery;
    }
    return finalQuery;
  }
  sliceArrayIntoGroups(arr, size) {
    let step = 0;
    let sliceArr = [];
    let len = arr.length;
    while (step < len) {
      sliceArr.push(arr.slice(step, step += size));
    }
    return sliceArr;
  }
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
  doExport() {
    let vm = this; // eslint-disable-line consistent-this
    let exportedData = new RecordTable(st => { vm.exportStatus = st; }, vm);
    exportedData.isTooling = vm.queryTooling;
    exportedData.describeInfo = vm.describeInfo;
    exportedData.sfHost = vm.sfHost;
    vm.initPerf();
    let query = this.cleanupQuery(vm.editor.value, vm);
    vm.columnIndex = this.extractColumnFromQuery(query);
    function onError(error) {
      console.error(error);
      if (error && error.name == "Unauthorized") {
        let rootEl = document.getElementById("insext");
        let popupEl = document.getElementsByClassName("insext-popup-iframe")[0];
        popupEl.contentWindow.postMessage({
          showInvalidTokenBanner: true
        }, "*");
        rootEl.classList.add("insext-active");
      }
      vm.isWorking = false;
      vm.exportStatus = "Error";
      vm.exportError = "UNEXPECTED EXCEPTION:" + error;
      vm.exportedData = null;
      vm.markPerf();
      vm.updatedExportedData();
    }
    function batchHandler(batch) {
      return batch.catch(err => {
        if (err.name == "AbortError") {
          return {records: [], done: true, totalSize: -1};
        }
        throw err;
      }).then(async data => {
        let total;
        let recs;
        if (vm.isSearchMode()) {
          await exportedData.addToTable(data.searchRecords);
          recs = exportedData.records.length;
          total = exportedData.totalSize;
        } else if (vm.isGraphMode()) {
          let records = [];
          for (const sobjectType in data.data.uiapi.query) {
            data.data.uiapi.query[sobjectType].edges.forEach(e => {
              let result = {};
              result.attributes = {type: sobjectType};
              for (const prop in e.node) {
                if (typeof e.node[prop] === "object") {
                  result[prop] = e.node[prop].value;
                }
                result[prop] = e.node[prop];
              }
              records.push(result);
            });
          }
          await exportedData.addToTable(records);
          recs = exportedData.records.length;
          total = exportedData.totalSize;
        } else {
          await exportedData.addToTable(data.records);
          recs = exportedData.records.length;
          total = exportedData.totalSize;
          if (data.totalSize != -1) {
            exportedData.totalSize = data.totalSize;
            total = data.totalSize;
          }
        }
        if (!vm.isSearchMode() && !vm.isGraphMode() && !data.done) {
          let pr = batchHandler(sfConn.rest(data.nextRecordsUrl, {progressHandler: vm.exportProgress}));
          vm.isWorking = true;
          vm.exportStatus = `Exporting... Completed ${recs} of ${total} record${s(total)}.`;
          vm.exportError = null;
          vm.exportedData = exportedData;
          vm.markPerf();
          vm.updatedExportedData();
          vm.didUpdate();
          return pr;
        }
        //save query with comments
        vm.queryHistory.add({query: vm.editor.value, useToolingApi: exportedData.isTooling});
        if (recs == 0) {
          vm.isWorking = false;
          vm.exportStatus = "No data exported." + (total > 0 ? ` ${total} record${s(total)}.` : "");
          vm.exportError = null;
          vm.exportedData = exportedData;
          vm.markPerf();
          vm.updatedExportedData();
          return null;
        }
        vm.isWorking = false;
        vm.exportStatus = `Exported ${recs}${recs !== total ? (" of " + total) : ""} record${s(recs)}`;
        vm.exportError = null;
        vm.exportedData = exportedData;
        vm.markPerf();
        vm.updatedExportedData();
        return null;
      }, err => {
        if (err.name != "SalesforceRestError") {
          throw err; // not a SalesforceRestError
        }
        let recs = exportedData.records.length;
        let total = exportedData.totalSize;
        if (total != -1) {
          // We already got some data. Show it, and indicate that not all data was exported
          vm.isWorking = false;
          vm.exportStatus = `Exported ${recs} of ${total} record${s(total)}. Stopped by error.`;
          vm.exportError = null;
          vm.exportedData = exportedData;
          vm.updatedExportedData();
          vm.markPerf();
          return null;
        }
        vm.isWorking = false;
        vm.exportStatus = "Error";
        vm.exportError = err.message;
        vm.exportedData = null;
        vm.updatedExportedData();
        return null;
      });
    }
    if (vm.variableData && vm.variableData.length > 0) {
      vm.spinFor(Promise.all(vm.sliceArrayIntoGroups(vm.variableData, vm.batchSize).map(range => {
        let subquery = query.replace("$1", range.join(","));
        return batchHandler(vm.callRest(subquery))
          .catch(onError);
      }
      )));
    } else {
      vm.spinFor(batchHandler(vm.callRest(query))
        .catch(onError));
    }

    vm.setResultsFilter("");
    vm.isWorking = true;
    vm.exportStatus = "Exporting...";
    vm.exportError = null;
    vm.exportedData = exportedData;
    vm.updatedExportedData();
  }
  stopExport() {
    this.exportProgress.abort();
  }
  callRest(query){
    let queryMethod = this.getQueryMethod();
    if (this.isGraphMode()){
      return sfConn.rest("/services/data/v" + apiVersion + "/" + queryMethod, {method: "POST", body: {"query": "query Objects " + query}}, {progressHandler: this.exportProgress});
    } else {
      return sfConn.rest("/services/data/v" + apiVersion + "/" + queryMethod + "/?q=" + encodeURIComponent(query), {progressHandler: this.exportProgress});
    }
  }
  doQueryPlan(){
    let vm = this; // eslint-disable-line consistent-this
    let exportedData = new RecordTable(st => { vm.exportStatus = st; }, vm);
    vm.spinFor(sfConn.rest("/services/data/v" + apiVersion + "/query/?explain=" + encodeURIComponent(vm.editor.value)).then(async res => {
      await exportedData.addToTable(res.plans);
      vm.exportStatus = "";
      vm.performancePoints = [];
      vm.exportedData = exportedData;
      vm.updatedExportedData();
      vm.didUpdate();
    }, (err) => {
      console.error(err);
      vm.isWorking = false;
      vm.exportStatus = "Error";
      vm.exportError = "UNEXPECTED EXCEPTION:" + err;
      vm.exportedData = null;
      vm.didUpdate();
    }));
    vm.autocompleteResults = {
      sobjectName: "",
      title: "Query Plan Tool:",
      results: [{value: "Developer Console Query Plan Tool FAQ", title: "Developer Console Query Plan Tool FAQ", rank: 1, autocompleteType: "fieldName", dataType: "", link: "https://help.salesforce.com/s/articleView?id=000386864&type=1"},
        {value: "Get Feedback on Query Performance", title: "Get Feedback on Query Performance", suffix: " ", rank: 1, autocompleteType: "fieldName", dataType: "", link: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query_explain.htm"},
      ]
    };
  }
  recalculateSize() {
    // Investigate if we can use the IntersectionObserver API here instead, once it is available.
    this.tableModel.viewportChange();
  }
  //TODO query: this.editor.value, name: this.queryName, useToolingApi: this.queryTooling
  getHistory() {
    let historyMap = new Map();
    this.queryHistory.list.forEach(q => historyMap.set(q.query, {value: q.query, label: q.query.substring(0, 300), favorite: false, useToolingApi: q.useToolingApi}));
    this.queryTemplates.forEach(q => historyMap.set(q, {value: q, label: q, favorite: true, useToolingApi: false}));
    this.savedHistory.list.forEach(q => {
      let delimiter = ":";
      let itm;
      if (q.name){
        itm = {value: q.query, label: q.name, name: q.name, favorite: true, useToolingApi: q.useToolingApi};
      } else if (q.query.includes(delimiter)){
        itm = {label: q.query.split(delimiter)[0], favorite: true, useToolingApi: q.useToolingApi};
        itm.name = itm.label;
        itm.value = q.query.substring(itm.label.length + 1);
      } else {
        itm = {value: q.query, label: q.query, favorite: true, useToolingApi: q.useToolingApi};
      }
      historyMap.set(itm.value, itm);
    });
    return Array.from(historyMap.values());
  }
  deleteHistoryItem(history) {
    let itm = this.savedHistory.list.find(item => (item.useToolingApi == history.useToolingApi && ((item.query == history.value && item.name && item.name == history.label) || (item.query == history.label + ":" + history.value) || (item.query == history.value && item.query == history.label))));
    if (itm) {
      this.savedHistory.remove(itm);
      return;
    }
    const templateIndex = this.queryTemplates.indexOf(history.value);
    if (templateIndex > -1) {
      this.queryTemplates.splice(templateIndex, 1);
      localStorage.setItem("queryTemplates", JSON.stringify(this.queryTemplates));
      return;
    }
    itm = this.queryHistory.list.find((item => (item.query == history.value) && (item.useToolingApi == history.useToolingApi)));
    if (itm) {
      this.queryHistory.remove(itm);
      return;
    }
  }
  updateHistoryItem(history) {
    if (history.favorite) {
      let itm = this.queryHistory.list.find(item => (item.query == history.value) && (item.useToolingApi == history.useToolingApi));
      if (itm) {
        this.queryHistory.remove(itm);
      }
      let newSaved = {query: history.value, useToolingApi: history.useToolingApi ?? false};
      this.savedHistory.add(newSaved);
    } else {
      let itm = this.savedHistory.list.find(item => (item.useToolingApi == history.useToolingApi && ((item.query == history.value && item.name && item.name == history.label) || (item.query == history.label + ":" + history.value) || (item.query == history.value && item.query == history.label))));
      if (itm) {
        this.savedHistory.remove(itm);
      } else {
        let templateIndex = this.queryTemplates.indexOf(history.value);
        if (templateIndex > -1) {
          this.queryTemplates.splice(templateIndex, 1);
          localStorage.setItem("queryTemplates", JSON.stringify(this.queryTemplates));
        }
      }
      let newHistory = {query: history.value, useToolingApi: history.useToolingApi};
      if (itm && itm.name) {
        newHistory.name = itm.name;
      }
      this.queryHistory.add(newHistory);
    }
  }
}

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onQueryAllChange = this.onQueryAllChange.bind(this);
    this.onQueryToolingChange = this.onQueryToolingChange.bind(this);
    this.onSelectQuery = this.onSelectQuery.bind(this);
    this.onClearHistory = this.onClearHistory.bind(this);
    this.onClearSavedHistory = this.onClearSavedHistory.bind(this);
    this.onAddToHistory = this.onAddToHistory.bind(this);
    this.onToggleHelp = this.onToggleHelp.bind(this);
    this.onToggleExpand = this.onToggleExpand.bind(this);
    this.onToggleSavedOptions = this.onToggleSavedOptions.bind(this);
    this.onExport = this.onExport.bind(this);
    this.onFormatQuery = this.onFormatQuery.bind(this);
    this.onCopyQuery = this.onCopyQuery.bind(this);
    this.onQueryPlan = this.onQueryPlan.bind(this);
    this.onCopyAsExcel = this.onCopyAsExcel.bind(this);
    this.onCopyAsCsv = this.onCopyAsCsv.bind(this);
    this.onDownloadCsv = this.onDownloadCsv.bind(this);
    this.onCopyAsJson = this.onCopyAsJson.bind(this);
    this.onDeleteRecords = this.onDeleteRecords.bind(this);
    this.onResultsFilterInput = this.onResultsFilterInput.bind(this);
    this.onSetQueryName = this.onSetQueryName.bind(this);
    this.onStopExport = this.onStopExport.bind(this);
    this.onClick = this.onClick.bind(this);
    this.onSaveAll = this.onSaveAll.bind(this);
    this.onToggleVariable = this.onToggleVariable.bind(this);
    this.onDataPaste = this.onDataPaste.bind(this);
    this.onBatchSizeChange = this.onBatchSizeChange.bind(this);
    this.onUpdateHistoryItem = this.onUpdateHistoryItem.bind(this);
    this.onDeleteHistoryItem = this.onDeleteHistoryItem.bind(this);
  }
  onSaveAll() {
    let {model} = this.props;
    if (model && model.tableModel) {
      model.tableModel.doSaveAll();
    }
  }
  onClick(){
    let {model} = this.props;
    if (model && model.tableModel) {
      model.tableModel.onClick();
    }
  }
  onQueryAllChange(e) {
    let {model} = this.props;
    model.queryAll = e.target.checked;
    model.didUpdate();
  }
  onQueryToolingChange(e) {
    let {model} = this.props;
    model.queryTooling = e.target.checked;
    model.editorAutocompleteHandler();
    model.didUpdate();
  }
  onSelectQuery(input) {
    let {model} = this.props;
    model.selectQuery(input);
    model.didUpdate();
  }
  onClearHistory(e) {
    e.preventDefault();
    let r = confirm("Are you sure you want to clear the query history?");
    if (r == true) {
      let {model} = this.props;
      model.clearHistory();
      model.didUpdate();
    }
  }
  onClearSavedHistory(e) {
    e.preventDefault();
    let r = confirm("Are you sure you want to remove all saved queries?");
    let {model} = this.props;
    if (r == true) {
      model.clearSavedHistory();
    }
    model.toggleSavedOptions();
    model.didUpdate();
  }
  onAddToHistory(e) {
    e.preventDefault();
    let {model} = this.props;
    model.addToHistory();
    model.didUpdate();
  }
  onToggleHelp(e) {
    e.preventDefault();
    let {model} = this.props;
    model.toggleHelp();
    model.didUpdate();
  }
  onToggleExpand(e) {
    e.preventDefault();
    let {model} = this.props;
    model.toggleExpand();
    model.didUpdate();
  }
  onToggleSavedOptions(e) {
    e.preventDefault();
    let {model} = this.props;
    model.toggleSavedOptions();
    model.didUpdate();
  }
  onExport() {
    let {model} = this.props;
    model.doExport();
    model.didUpdate();
  }
  onCopyQuery() {
    let {model} = this.props;
    let url = new URL(window.location.href);
    let searchParams = url.searchParams;
    searchParams.set("query", model.editor.value);
    url.search = searchParams.toString();
    navigator.clipboard.writeText(url.toString());
    navigator.clipboard.writeText(url.toString());
    model.didUpdate();
  }
  onFormatQuery() {
    let {model} = this.props;
    model.editor.value = model.formatQuery(model.editor.value);
    model.didUpdate();
  }
  onQueryPlan(){
    let {model} = this.props;
    model.doQueryPlan();
    model.didUpdate();
  }
  onCopyAsExcel() {
    let {model} = this.props;
    model.copyAsExcel();
    model.didUpdate();
  }
  onCopyAsCsv() {
    let {model} = this.props;
    model.copyAsCsv();
    model.didUpdate();
  }
  onDownloadCsv() {
    let {model} = this.props;
    model.downloadCsv();
    model.didUpdate();
  }
  onCopyAsJson() {
    let {model} = this.props;
    model.copyAsJson();
    model.didUpdate();
  }
  onDeleteRecords(e) {
    let {model} = this.props;
    model.deleteRecords(e);
    model.didUpdate();
  }
  onResultsFilterInput(e) {
    let {model} = this.props;
    model.setResultsFilter(e.target.value);
    model.didUpdate();
  }
  onSetQueryName(e) {
    let {model} = this.props;
    model.setQueryName(e.target.value);
    model.didUpdate();
  }
  onStopExport() {
    let {model} = this.props;
    model.stopExport();
    model.didUpdate();
  }
  onToggleVariable() {
    let {model} = this.props;
    model.toggleVariable();
    model.didUpdate();
  }
  onDataPaste(e) {
    let {model} = this.props;
    let text = e.clipboardData.getData("text/plain");
    model.setVariableData(text);
    model.didUpdate();
  }
  onBatchSizeChange(e){
    let {model} = this.props;
    model.batchSize = new Number(e.target.value);
    model.didUpdate();
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

    addEventListener("keydown", e => {
      if ((e.ctrlKey && e.key == "Enter") || e.key == "F5") {
        e.preventDefault();
        model.doExport();
        model.didUpdate();
      }
    });

  }
  componentDidUpdate() {
    let {model} = this.props;
    model.recalculateSize();
  }
  render() {
    let {model} = this.props;
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 3);

    let suggestionHelper = "";

    if (model.displaySuggestion) {
      if (model.autocompleteResults.isField && model.activeSuggestion == -1) {
        suggestionHelper = " Press Ctrl+Space to insert all fields | Esc to hide suggestions";
      } else if (model.autocompleteResults.isFieldValue && model.activeSuggestion == -1) {
        suggestionHelper = " Press Ctrl+Space to display values used | Esc to hide suggestions";
      } else {
        suggestionHelper = " Press Esc to hide suggestions";
      }
    } else {
      suggestionHelper = " Press Ctrl+Space to display suggestions";
    }
    let historyList = model.getHistory();
    let keywordColor = new Map([["select", "blue"], ["from", "blue"], ["where", "blue"], ["group", "blue"], ["by", "blue"], ["excludes", "blue"], ["includes", "blue"],
      ["order", "blue"], ["limit", "blue"], ["and", "blue"], ["or", "blue"], ["not", "blue"], ["like", "blue"], ["in", "blue"],
      ["offset", "blue"], ["typeof", "blue"], ["when", "blue"], ["then", "blue"], ["else", "blue"], ["end", "blue"], ["using", "blue"],
      ["scope", "blue"], ["with", "blue"], ["data", "blue"], ["category", "blue"], ["rollup", "blue"], ["cube", "blue"], ["having", "blue"]]);
    let keywordColorSosl = new Map([["find", "blue"], ["in", "blue"], ["all", "blue"], ["fields", "blue"], ["name", "blue"],
      ["email", "blue"], ["phone", "blue"], ["sidebar", "blue"], ["returning", "blue"], ["where", "blue"], ["order", "blue"],
      ["by", "blue"], ["limit", "blue"], ["offset", "blue"], ["with", "blue"], ["division", "blue"], ["data", "blue"],
      ["category", "blue"], ["at", "blue"], ["above", "blue"], ["below", "blue"], ["abov_or_below", "blue"], ["and", "blue"],
      ["or", "blue"], ["not", "blue"], ["like", "blue"], ["highlight", "blue"], ["snippet", "blue"], ["network", "blue"],
      ["metadata", "blue"], ["having", "blue"]]);
    const perf = model.perfStatus();
    return h("div", {onClick: this.onClick},
      h("div", {id: "user-info"},
        h("a", {href: model.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {}, "Data Export"),
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
          h("a", {href: "#", className: "top-btn", id: "help-btn", title: "Export Help", onClick: this.onToggleHelp},
            h("div", {className: "icon"})
          ),
        ),
      ),
      h("div", {className: "area"},
        h("div", {className: "area-header"},
        ),
        h("div", {className: "query-controls"},
          h("h1", {}, "Export Query"),
          h(HistoryBox, {title: "History", didUpdate: model.didUpdate.bind(model), suggestions: historyList.filter(h => !h.favorite), onSelect: this.onSelectQuery, onUpdate: this.onUpdateHistoryItem, onDelete: this.onDeleteHistoryItem}),
          h(HistoryBox, {title: "Favorite", didUpdate: model.didUpdate.bind(model), suggestions: historyList.filter(h => h.favorite), onSelect: this.onSelectQuery, onUpdate: this.onUpdateHistoryItem, onDelete: this.onDeleteHistoryItem}),
          h("div", {className: "button-group"},
            h("input", {placeholder: "Query Label", type: "save", value: model.queryName, onInput: this.onSetQueryName}),
            h("button", {onClick: this.onAddToHistory, title: "Add query to saved history"}, "Save Query")
          ),
          h("div", {className: "query-options"},
            h("label", {},
              h("input", {type: "checkbox", checked: model.queryAll, onChange: this.onQueryAllChange, disabled: model.queryTooling}),
              " ",
              h("span", {}, "Add deleted records?")
            ),
            h("label", {title: "With the tooling API you can query more metadata, but you cannot query regular data"},
              h("input", {type: "checkbox", checked: model.queryTooling, onChange: this.onQueryToolingChange, disabled: model.queryAll}),
              " ",
              h("span", {}, "Tooling API?")
            ),
          ),
        ),
        h(Editor, {model, keywordColor: model.isSearchMode() ? keywordColorSosl : keywordColor, keywordCaseSensitive: false}),
        h("div", {className: "autocomplete-box" + (model.expandAutocomplete ? " expanded" : "")},
          h("div", {className: "autocomplete-header"},
            h("span", {}, model.autocompleteResults.title + suggestionHelper),
            h("div", {className: "flex-right"},
              h("button", {tabIndex: 1, disabled: model.isWorking, onClick: this.onExport, title: "Ctrl+Enter / F5", className: "highlighted"}, "Run Export"),
              h("button", {tabIndex: 2, onClick: this.onFormatQuery, title: "Format query"}, "Format Query"),
              h("button", {tabIndex: 3, onClick: this.onCopyQuery, title: "Copy query url", className: "copy-id"}, "Export Query"),
              h("button", {tabIndex: 4, onClick: this.onQueryPlan, title: "Run Query Plan"}, "Query Plan"),
              h("a", {tabIndex: 5, className: "button", hidden: !model.autocompleteResults.sobjectName, href: model.showDescribeUrl(), target: "_blank", title: "Show field info for the " + model.autocompleteResults.sobjectName + " object"}, model.autocompleteResults.sobjectName + " Field Info"),
              h("button", {className: "variable-btn " + (model.showVariable ? "toggle expand" : "toggle contract"), id: "variable-btn", title: "Use list parametter in query", onClick: this.onToggleVariable},
                h("div", {className: "icon"}),
                h("div", {className: "button-toggle-icon"})
              )
            ),
          ),
          h("div", {ref: "autocompleteResultBox", className: "autocomplete-results autocomplete-results-over", hidden: !model.displaySuggestion, style: {top: model.suggestionTop + "px", left: model.suggestionLeft + "px"}},
            model.autocompleteResults.results.map((r, ri) =>
              h("div", {className: "autocomplete-result" + (ri == model.activeSuggestion ? " active" : ""), key: r.value}, h("a", {tabIndex: 0, title: r.title, onMouseDown: e => { e.preventDefault(); model.autocompleteClick(r); model.didUpdate(); }, href: "#", className: r.autocompleteType + " " + r.dataType}, h("div", {className: "autocomplete-icon"}), r.value), " ")
            )
          ),
        ),
        h("div", {hidden: !model.showHelp, className: "help-text"},
          h("h3", {}, "Export Help"),
          h("p", {}, "Use for quick one-off data exports. Enter a ", h("a", {href: "http://www.salesforce.com/us/developer/docs/soql_sosl/", target: "_blank"}, "SOQL or SOSL query"), " in the box above and press Export."),
          h("p", {}, "Press Ctrl+Space to insert all field name autosuggestions or to load suggestions for field values."),
          h("p", {}, "Press Ctrl+Enter or F5 to execute the export."),
          h("p", {}, "Supports the full SOQL/SOSL language and graphql. The columns in the CSV output depend on the returned data. Using subqueries may cause the output to grow rapidly. Bulk API is not supported. Large data volumes may freeze or crash your browser.")
        ),
        h("div", {hidden: !model.showVariable, className: "variable-block"},
          h("h3", {}, "Batch Parameters"),
          h("p", {}, "Paste parameter data of SOQL then use it with $1 in SOQL query. [...WHERE Id IN ($1)]"),
          h("span", {className: "conf-label"}, "Batch size"),
          h("input", {type: "number", value: model.batchSize, onChange: this.onBatchSizeChange, className: (model.batchSizeError() ? "confError" : "") + " batch-size"}),
          h("textarea", {id: "data", value: "Paste 1 variable by line here.\nDo not forget quote \"'\" around text field.", onPaste: this.onDataPaste, className: model.dataError ? "confError" : "", readOnly: true, rows: 1}),
          h("div", {className: "conf-error", hidden: !model.variableDataError}, model.variableDataError),
          model.variableData.length > 0 ? model.variableData.slice(0, 4).concat(["..."]).map(c => h("div", {}, c)) : ""
        ),
      ),
      h("div", {className: "area", id: "result-area"},
        h("div", {className: "result-bar"},
          h("h1", {}, "Export Result"),
          h("div", {className: "button-group"},
            h("button", {disabled: !model.canCopy(), onClick: this.onCopyAsExcel, title: "Copy exported data to clipboard for pasting into Excel or similar"}, "Copy (Excel format)"),
            h("button", {disabled: !model.canCopy(), onClick: this.onCopyAsCsv, title: "Copy exported data to clipboard for saving as a CSV file"}, "Copy (CSV)"),
            h("button", {disabled: !model.canCopy(), onClick: this.onCopyAsJson, title: "Copy raw API output to clipboard"}, "Copy (JSON)"),
            h("button", {disabled: !model.canCopy(), onClick: this.onDownloadCsv, title: "Download csv file"},
              h("svg", {className: "download-icon"},
                h("use", {xlinkHref: "symbols.svg#download"})
              )
            ),
            h("button", {disabled: !model.canDelete(), onClick: this.onDeleteRecords, title: "Open the 'Data Import' page with preloaded records to delete (< 20k records). 'Id' field needs to be queried", className: "delete-btn"}, "Delete Records"),
            model.tableModel.editedRows.values().some(r => r.values().some(cell => (cell.dataEditValue != null))) ? h("button", {onClick: this.onSaveAll, title: "Save all edited records", className: "highlighted"}, "Save all") : null
          ),
          h("input", {placeholder: "Filter Results", type: "search", value: model.resultsFilter, onInput: this.onResultsFilterInput}),
          h("span", {className: "result-status flex-right"},
            h("span", {}, model.exportStatus),
            perf && h("span", {className: "result-info", title: perf.batchStats}, perf.text),
            h("button", {className: "cancel-btn", disabled: !model.isWorking, onClick: this.onStopExport}, "Stop"),
          ),
        ),
        h("textarea", {className: "result-text", readOnly: true, value: model.exportError || "", hidden: model.exportError == null}),
        h(ScrollTable, {model: model.tableModel, hidden: model.exportError != null})
      )
    );
  }
}

{

  let args = new URLSearchParams(location.search);
  let sfHost = args.get("host");
  let hash = new URLSearchParams(location.hash); //User-agent OAuth flow
  if (!sfHost && hash) {
    sfHost = decodeURIComponent(hash.get("instance_url")).replace(/^https?:\/\//i, "");
  }
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
