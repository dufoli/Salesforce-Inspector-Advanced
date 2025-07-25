/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */
import {csvParse} from "./csv-parse.js";
import {DescribeInfo, copyToClipboard, ScrollTable, TableModel} from "./data-load.js";

class Model {

  constructor(sfHost, args) {
    this.sfHost = sfHost;
    this.importData = undefined;
    this.consecutiveFailures = 0;

    this.allApis = [
      {value: "Enterprise", label: "Enterprise (default)"},
      {value: "Tooling", label: "Tooling"},
      {value: "Metadata", label: "Metadata"}
    ];
    this.allActions = [
      {value: "create", label: "Insert", supportedApis: ["Enterprise", "Tooling"]},
      {value: "update", label: "Update", supportedApis: ["Enterprise", "Tooling"]},
      {value: "upsert", label: "Upsert", supportedApis: ["Enterprise", "Tooling"]},
      {value: "delete", label: "Delete", supportedApis: ["Enterprise", "Tooling"]},
      {value: "undelete", label: "Undelete", supportedApis: ["Enterprise", "Tooling"]},
      {value: "upsertMetadata", label: "Upsert Metadata", supportedApis: ["Metadata"]},
      {value: "deleteMetadata", label: "Delete Metadata", supportedApis: ["Metadata"]}
    ];

    this.sfLink = "https://" + this.sfHost;
    this.spinnerCount = 0;
    this.showHelp = false;
    this.userInfo = "...";
    this.dataError = "";
    this.apiType = "Enterprise";
    this.dataFormat = "excel";
    this.importActionSelected = false;
    this.updateAvailableActions();
    this.importType = "Account";
    this.externalId = "Id";
    this.batchSize = localStorage.getItem("defaultBatchSize") ? localStorage.getItem("defaultBatchSize") : "200";
    this.batchConcurrency = localStorage.getItem("defaultThreadSize") ? localStorage.getItem("defaultThreadSize") : "6";
    this.confirmPopup = null;
    this.activeBatches = 0;
    this.isProcessingQueue = false;
    this.assignmentRule = false;
    this.importState = null;
    this.showStatus = {
      Queued: true,
      Processing: true,
      Succeeded: true,
      Failed: true
    };
    if (args.has("sobject")) {
      this.importType = args.get("sobject");
    }
    if (localStorage.getItem(sfHost + "_isSandbox") != "true") {
      //change background color for production
      document.body.classList.add("prod");
    }
    this.importTableResult = null;
    this.updateResult(null);

    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => { this.refreshColumn(); });
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
    }));

    let apiTypeParam = args.get("apitype");
    this.apiType = this.importType.endsWith("__mdt") ? "Metadata" : apiTypeParam ? apiTypeParam : "Enterprise";

    if (args.has("data")) {
      let data = atob(args.get("data"));
      this.dataFormat = "csv";
      this.setData(data);
      this.updateAvailableActions();
      this.importAction = this.importType.endsWith("__mdt") ? "deleteMetadata" : "delete";
      this.importActionName = this.importType.endsWith("__mdt") ? "Delete Metadata" : "Delete";
      this.skipAllUnknownFields();
    }
    if (args.has("action")){
      this.importAction = args.get("action");
    }
    this.tableModel = new TableModel(sfHost, this.didUpdate.bind(this));
    this.resultTableCallback = (d) => this.tableModel.dataChange(d);
  }

  // set available actions based on api type, and set the first one as the default
  updateAvailableActions() {
    this.availableActions = this.allActions.filter(action => action.supportedApis.includes(this.apiType));
    this.importAction = this.availableActions[0].value;
    this.importActionName = this.availableActions[0].label;
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

  message() {
    return "Paste " + this.dataFormat.toUpperCase() + " data here";
  }
  guessFormat(text) {
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        let json = JSON.parse(text); // Validate JSON
        this.dataFormat = "json";
        return json;
      } catch (e) {
        this.dataError = e;
      }
    }
    // check only first line for performance
    let header = text;
    if (text.indexOf("\n") > -1) {
      header = text.substring(0, text.indexOf("\n"));
    }
    let tabCount = header.length - header.replace(/\t/g, "").length;
    let commaCount = header.length - header.replace(/,/g, "").length;
    if (commaCount < tabCount) {
      this.dataFormat = "excel";
      return text;
    } else {
      this.dataFormat = "csv";
      return text;
    }
  }
  setData(text) {
    if (this.isWorking()) {
      return;
    }
    let json = this.guessFormat(text.trim());
    if (this.dataFormat == "json") {
      text = this.getDataFromJson(json);
    }
    let csvSeparator = ",";
    if (localStorage.getItem("csvSeparator")) {
      csvSeparator = localStorage.getItem("csvSeparator");
    }
    let separator = this.dataFormat == "excel" ? "\t" : csvSeparator;
    let data;
    try {
      data = csvParse(text, separator);
    } catch (e) {
      this.dataError = "Error: " + e.message;
      this.updateResult(null);
      return;
    }

    if (data[0] && data[0][0] && data[0][0].trimStart().startsWith("salesforce-inspector-import-options")) {
      let importOptions = new URLSearchParams(data.shift()[0].trim());
      if (importOptions.get("useToolingApi") == "1") this.apiType = "Tooling";
      if (importOptions.get("useToolingApi") == "0") this.apiType = "Enterprise";
      // Keep the above two checks, in order to support old import options
      if (this.allApis.some(api => api.value == importOptions.get("apiType"))) this.apiType = importOptions.get("apiType");
      if (importOptions.get("action") == "create") this.importAction = "create";
      if (importOptions.get("action") == "update") this.importAction = "update";
      if (importOptions.get("action") == "upsert") this.importAction = "upsert";
      if (importOptions.get("action") == "delete") this.importAction = "delete";
      if (importOptions.get("object")) this.importType = importOptions.get("object");
      if (importOptions.get("externalId") && this.importAction == "upsert") this.externalId = importOptions.get("externalId");
      if (importOptions.get("batchSize")) this.batchSize = importOptions.get("batchSize");
      if (importOptions.get("threads")) this.batchConcurrency = importOptions.get("threads");
    }

    if (data.length < 2) {
      this.dataError = "Error: No records to import";
      this.updateResult(null);
      return;
    }
    this.dataError = "";
    let header = data.shift().map((c, index) => this.makeColumn(c, index));
    this.updateResult(null); // Two updates, the first clears state from the scrolltable
    this.updateResult({header, data});

    //automatically select the SObject if possible
    let sobj = this.getSObject(data, header);
    if (sobj) {
      //We avoid overwriting the Tooling option in case it was already set
      this.apiType = sobj.endsWith("__mdt") ? "Metadata" : this.apiType === "Tooling" ? "Tooling" : "Enterprise";
      this.updateAvailableActions();
      this.importType = sobj;
    }
    //automatically select update if header contains id
    if (this.hasIdColumn(header) && !this.importActionSelected && this.apiType != "Metadata") {
      this.importAction = "update";
      this.importActionName = "Update";
    }
    this.refreshColumn();
    this.updateResult(this.importData.importTable);
  }

  getDataFromJson(json) {
    let csv;
    let fields = ["_"].concat(Object.keys(json[0]));
    fields = fields.filter(field => field != "attributes");

    let separator = ",";
    if (localStorage.getItem("csvSeparator")) {
      separator = localStorage.getItem("csvSeparator");
    }

    let sobject = json[0]["attributes"]["type"];
    if (sobject) {
      csv = json.map((row) => fields.map((fieldName) => {
        let value = fieldName == "_" ? sobject : row[fieldName];
        if (typeof value == "number" && isNaN(value)) {
          return undefined; // Skip NaN values
        }
        if (typeof value == "boolean" || (value && typeof value !== "object")) {
          return fieldName == "_" ? `"[${sobject}]"` : JSON.stringify(value);
        }
        //null undefined NaN
        return undefined;
      }).join(separator));
      fields = fields.map(str => `"${str}"`);
      csv.unshift(fields.join(separator));
      csv = csv.join("\r\n");
    }
    return csv;
  }

  copyOptions() {
    let importOptions = new URLSearchParams();
    importOptions.set("salesforce-inspector-import-options", "");
    importOptions.set("apiType", this.apiType);
    importOptions.set("action", this.importAction);
    importOptions.set("object", this.importType);
    if (this.importAction == "upsert") importOptions.set("externalId", this.externalId);
    importOptions.set("batchSize", this.batchSize);
    importOptions.set("threads", this.batchConcurrency);
    copyToClipboard(importOptions.toString());
  }

  skipAllUnknownFields() {
    for (let column of this.importData.importTable.header) {
      if (column.columnUnknownField() || column.columnError()) {
        column.columnSkip();
      }
    }
    this.didUpdate();
  }

  // Used only for requried fields that will prevent us from building a valid API request or definitely cause an error if missing.
  getRequiredMissingFields() {
    let missingFields = [];

    if (!this.importIdColumnValid()) {
      missingFields.push(this.idFieldName());
    }

    if (this.apiType == "Metadata" && this.importAction == "upsertMetadata" && !this.columns().some(c => c.columnValue == "MasterLabel")) {
      missingFields.push("MasterLabel");
    }
    return missingFields;
  }

  invalidInput() {
    // We should try to allow imports to succeed even if our validation logic does not exactly match the one in Salesforce.
    // We only hard-fail on errors that prevent us from building the API request.
    // When possible, we submit the request with errors and let Salesforce give a descriptive message in the response.
    return !this.importData.importTable || !this.importData.importTable.header.every(col => col.columnIgnore() || col.columnValid()) || this.getRequiredMissingFields().length > 0;
  }

  isWorking() {
    return this.activeBatches != 0 || this.isProcessingQueue;
  }

  columns() {
    return this.importData.importTable ? this.importData.importTable.header : [];
  }

  sobjectList() {
    let {globalDescribe} = this.describeInfo.describeGlobal(this.apiType == "Tooling");
    if (!globalDescribe) {
      return [];
    }

    if (this.apiType == "Metadata") {
      return globalDescribe.sobjects
        .filter(sobjectDescribe => sobjectDescribe.name.endsWith("__mdt"))
        .map(sobjectDescribe => sobjectDescribe.name);
    } else {
      return globalDescribe.sobjects
        .filter(sobjectDescribe => sobjectDescribe.createable || sobjectDescribe.deletable || sobjectDescribe.updateable)
        .map(sobjectDescribe => sobjectDescribe.name);
    }
  }

  idLookupList() {
    let sobjectName = this.importType;
    let sobjectDescribe = this.describeInfo.describeSobject(this.apiType == "Tooling", sobjectName).sobjectDescribe;

    if (!sobjectDescribe) {
      return [];
    }
    return sobjectDescribe.fields.filter(field => field.idLookup).map(field => field.name);
  }

  columnList() {
    let self = this;
    return Array.from(function* () {
      let importAction = self.importAction;

      if (importAction == "delete" || importAction == "undelete") {
        yield "Id";
      } else if (importAction == "deleteMetadata") {
        yield "DeveloperName";
      } else {
        let sobjectName = self.importType;
        let sobjectDescribe = self.describeInfo.describeSobject(self.apiType == "Tooling", sobjectName).sobjectDescribe;
        if (sobjectDescribe) {
          let idFieldName = self.idFieldName();
          for (let field of sobjectDescribe.fields) {
            if (field.createable || field.updateable) {
              yield field.name;
              for (let referenceSobjectName of field.referenceTo) {
                let referenceSobjectDescribe = self.describeInfo.describeSobject(self.apiType == "Tooling", referenceSobjectName).sobjectDescribe;
                if (referenceSobjectDescribe) {
                  for (let referenceField of referenceSobjectDescribe.fields) {
                    if (referenceField.idLookup) {
                      yield field.relationshipName + ":" + referenceSobjectDescribe.name + ":" + referenceField.name;
                    }
                  }
                }
              }
            } else if (field.idLookup && field.name.toLowerCase() == idFieldName.toLowerCase()) {
              yield field.name;
            } else if (importAction == "upsertMetadata") {
              if (["DeveloperName", "MasterLabel"].includes(field.name) || field.custom) {
                yield field.name;
              }
            }
          }
        }
      }
      yield "__Status";
      yield "__Id";
      yield "__Action";
      yield "__Errors";
    }());
  }

  importIdColumnValid() {
    return this.importAction == "create" || this.inputIdColumnIndex() > -1;
  }

  importTypeError() {
    let importType = this.importType;
    if (!this.sobjectList().some(s => s.toLowerCase() == importType.toLowerCase())) {
      return "Error: Unknown object";
    }
    return "";
  }

  externalIdError() {
    let externalId = this.externalId;
    if (!this.idLookupList().some(s => s.toLowerCase() == externalId.toLowerCase())) {
      return "Error: Unknown field or not an external ID";
    }
    return "";
  }

  idFieldName() {
    if (this.importAction == "create") {
      return "";
    } else if (this.importAction == "upsert") {
      return this.externalId;
    } else if (this.apiType == "Metadata") {
      return "DeveloperName";
    } else {
      return "Id";
    }
  }

  inputIdColumnIndex() {
    let importTable = this.importData.importTable;
    if (!importTable) {
      return -1;
    }
    let idFieldName = this.idFieldName();
    return importTable.header.findIndex(c => c.columnValue.toLowerCase() == idFieldName.toLowerCase());
  }

  batchSizeError() {
    if (!(+this.batchSize > 0)) { // This also handles NaN
      return "Error: Must be a positive number";
    }
    return "";
  }

  batchConcurrencyError() {
    if (!(+this.batchConcurrency > 0)) { // This also handles NaN
      return "Error: Must be a positive number";
    }
    if (+this.batchConcurrency > 6) {
      return "Note: More than 6 threads will not help since Salesforce does not support HTTP2";
    }
    return "";
  }

  canCopy() {
    return this.importData.taggedRows != null;
  }

  canSkipAllUnknownFields() {
    if (this.importData.importTable && this.importData.importTable.header) {
      for (let column of this.importData.importTable.header) {
        if (!column.columnIgnore() && column.columnUnknownField()) {
          return true;
        }
      }
    }
    return false;
  }

  copyResult(separator) {
    let header = this.importData.importTable.header.map(c => c.columnValue);
    let data = this.importData.taggedRows.filter(row => this.showStatus[row.status]).map(row => row.cells);
    copyToClipboard(csvSerialize([header, ...data], separator));
  }

  importCounts() {
    return this.importData.counts;
  }

  // Must be called whenever any of its inputs changes.
  updateImportTableResult() {
    if (this.importData.taggedRows == null) {
      this.importTableResult = null;
      if (this.resultTableCallback) {
        this.resultTableCallback(this.importTableResult);
      }
      return;
    }
    let header = this.importData.importTable.header.map(c => c.columnValue);
    let data = this.importData.taggedRows.map(row => row.cells);
    this.importTableResult = {
      table: [header, ...data],
      isTooling: this.apiType == "Tooling",
      describeInfo: this.describeInfo,
      sfHost: this.sfHost,
      rowVisibilities: [true, ...this.importData.taggedRows.map(row => this.showStatus[row.status])],
      colVisibilities: header.map(() => true)
    };
    if (this.resultTableCallback) {
      this.resultTableCallback(this.importTableResult);
    }
  }

  confirmPopupYes() {
    this.confirmPopup = null;

    let {header, data} = this.importData.importTable;

    let statusColumnIndex = header.findIndex(c => c.columnValue.toLowerCase() == "__status");
    if (statusColumnIndex == -1) {
      statusColumnIndex = header.length;
      header.push(this.makeColumn("__Status"));
      for (let row of data) {
        row.push("");
      }
    }
    let resultIdColumnIndex = header.findIndex(c => c.columnValue.toLowerCase() == "__id");
    if (resultIdColumnIndex == -1) {
      resultIdColumnIndex = header.length;
      header.push(this.makeColumn("__Id"));
      for (let row of data) {
        row.push("");
      }
    }
    let actionColumnIndex = header.findIndex(c => c.columnValue.toLowerCase() == "__action");
    if (actionColumnIndex == -1) {
      actionColumnIndex = header.length;
      header.push(this.makeColumn("__Action"));
      for (let row of data) {
        row.push("");
      }
    }
    let errorColumnIndex = header.findIndex(c => c.columnValue.toLowerCase() == "__errors");
    if (errorColumnIndex == -1) {
      errorColumnIndex = header.length;
      header.push(this.makeColumn("__Errors"));
      for (let row of data) {
        row.push("");
      }
    }
    for (let row of data) {
      if (["queued", "processing", ""].includes(row[statusColumnIndex].toLowerCase())) {
        row[statusColumnIndex] = "Queued";
      }
    }
    this.updateResult(this.importData.importTable);
    this.importState = {
      statusColumnIndex,
      resultIdColumnIndex,
      actionColumnIndex,
      errorColumnIndex,
      importAction: this.importAction,
      sobjectType: this.importType,
      idFieldName: this.idFieldName(),
      inputIdColumnIndex: this.inputIdColumnIndex()
    };

    this.consecutiveFailures = 0;
    this.isProcessingQueue = true;
    this.executeBatch();
  }

  confirmPopupNo() {
    this.confirmPopup = null;
  }

  showDescribeUrl() {
    let args = new URLSearchParams();
    args.set("host", this.sfHost);
    args.set("objectType", this.importType);
    if (this.apiType == "Tooling") {
      args.set("useToolingApi", "1");
    }
    return "inspect.html?" + args;
  }

  doImport() {
    let importedRecords = this.importData.counts.Queued + this.importData.counts.Processing;
    let skippedRecords = this.importAction != "undelete" ? this.importData.counts.Succeeded + this.importData.counts.Failed : 0;
    let actionVerb = this.getActionVerb(this.importAction);
    this.confirmPopup = {
      text: importedRecords + " records will be " + actionVerb + "."
        + (skippedRecords > 0 ? " " + skippedRecords + " records will be skipped because they have __Status Succeeded or Failed." : "")
    };
  }

  getActionVerb(importAction){
    switch (importAction) {
      case "create":
        return "created";
      case "update":
        return "updated";
      case "upsert":
        return "upserted";
      case "delete":
        return "deleted";
      case "undelete":
        return "undeleted";
      default:
        return "imported";
    }
  }

  retryFailed() {
    if (!this.importData.importTable) {
      return;
    }
    let statusColumnIndex = this.importData.importTable.header.findIndex(c => c.columnValue.toLowerCase() == "__status");
    if (statusColumnIndex < 0) {
      return;
    }
    for (let row of this.importData.taggedRows) {
      if (row.status == "Failed") {
        row.cells[statusColumnIndex] = "Queued";
      }
    }
    this.updateResult(this.importData.importTable);
    this.executeBatch();
  }

  updateResult(importTable) {
    let counts = {Queued: 0, Processing: 0, Succeeded: 0, Failed: 0};
    if (!importTable) {
      this.importData = {
        importTable: null,
        counts,
        taggedRows: null
      };
      this.updateImportTableResult();
      return;
    }
    let statusColumnIndex = importTable.header.findIndex(c => c.columnValue.toLowerCase() == "__status");
    let taggedRows = [];
    for (let cells of importTable.data) {
      let status = statusColumnIndex < 0 ? "Queued"
        : cells[statusColumnIndex].toLowerCase() == "queued" ? "Queued"
        : cells[statusColumnIndex].toLowerCase() == "" ? "Queued"
        : cells[statusColumnIndex].toLowerCase() == "processing" && !this.isWorking() ? "Queued"
        : cells[statusColumnIndex].toLowerCase() == "processing" ? "Processing"
        : cells[statusColumnIndex].toLowerCase() == "succeeded" ? "Succeeded"
        : "Failed";
      counts[status]++;
      taggedRows.push({status, cells});
    }
    // Note: caller will call this.executeBatch() if needed
    this.importData = {importTable, counts, taggedRows};
    this.updateImportTableResult();
  }

  getSObject(data, header) {
    if (data[0][0].startsWith("[") && data[0][0].endsWith("]")) {
      let obj = data[0][0].substr(1, data[0][0].length - 2);
      return obj;
    }
    let idIndex = header.findIndex(column => column.columnValue.toLowerCase() === "id");
    if (idIndex != -1) {
      let firstId = data[0][idIndex];
      let keyPrefix = firstId?.substring(0, 3);
      let {globalDescribe} = this.describeInfo.describeGlobal(this.apiType == "Tooling");
      if (!globalDescribe || !keyPrefix) {
        return "";
      }

      let firstSobject = globalDescribe.sobjects
        .filter(sobjectDescribe => sobjectDescribe.keyPrefix == keyPrefix)
        .map(sobjectDescribe => sobjectDescribe.name).shift();
      return firstSobject ? firstSobject : "";
    }
    return "";
  }

  hasIdColumn(header) {
    let hasId = header.find(column => column.columnValue.toLowerCase() === "id");
    return hasId ? true : false;
  }

  guessColumn(col) {
    if (!col) {
      return col;
    }
    let columnName = col.split(".");
    if (columnName.length == 2) {
      let externalIdColumn = this.columnList().find(s => s.toLowerCase().startsWith(columnName[0].toLowerCase()) && s.toLowerCase().endsWith(columnName[1].toLowerCase()));
      if (externalIdColumn) {
        return externalIdColumn;
      }
    }
    return col.trim();
  }

  refreshColumn() {
    if (!this.importData.importTable) {
      return;
    }
    if (!this.importData.importTable.header) {
      return;
    }
    this.importData.importTable.header = this.importData.importTable.header.map(c => {
      if (!c) {
        return c;
      }
      c.setColumnValue(this.guessColumn(c.columnOriginalValue));
      return c;
    });

  }
  makeColumn(column, index) {
    let self = this;
    let xmlName = /^[a-zA-Z_][a-zA-Z0-9_]*$/; // A (subset of a) valid XML name
    let columnVm = {
      columnIndex: index,
      columnValue: column.trim(),
      columnOriginalValue: column,
      columnIgnore() { return columnVm.columnValue.startsWith("_"); },
      columnSkip() {
        columnVm.columnValue = "_" + columnVm.columnValue;
      },
      setColumnValue(colval) {
        columnVm.columnValue = colval;
      },
      getColumnType(){
        let sobjectName = self.importType;
        let sobjectDescribe = self.describeInfo.describeSobject(self.apiType == "Tooling", sobjectName).sobjectDescribe;
        if (sobjectDescribe) {
          let field = sobjectDescribe.fields.find(field => field.name.toLowerCase() === columnVm.columnValue.toLowerCase());
          if (field) {
            return field.type;
          }
        }
        return null;
      },
      isDate() {
        let fieldType = columnVm.getColumnType();
        return (fieldType == "date" || fieldType == "datetime");
      },
      columnValid() {
        let columnName = columnVm.columnValue.split(":");
        // Ensure there are 1 or 3 elements, so we know if we should treat it as a normal field or an external ID
        if (columnName.length != 1 && columnName.length != 3) {
          return false;
        }
        // Ensure that createElement will not throw, see https://dom.spec.whatwg.org/#dom-document-createelement
        if (!xmlName.test(columnName[0])) {
          return false;
        }
        // Ensure that createElement will not throw, see https://dom.spec.whatwg.org/#dom-document-createelement
        if (columnName.length == 3 && !xmlName.test(columnName[2])) {
          return false;
        }
        return true;
      },
      columnError() {
        if (columnVm.columnIgnore()) {
          return "";
        }
        if (!columnVm.columnValid()) {
          return "Error: Invalid field name";
        }
        let value = columnVm.columnValue;
        if (!self.columnList().some(s => s.toLowerCase() == value.toLowerCase())) {
          return "Error: Unknown field";
        }
        return "";
      },
      columnUnknownField() {
        return columnVm.columnError() === "Error: Unknown field";

      }
    };
    return columnVm;
  }
  calculateDateFormat(format) {
    let remaining = format;
    let regexStr = "";
    let formatCtx = {};
    let index = 1;
    while (remaining) {
      if (remaining.match(/^yyyy/i)) {
        remaining = remaining.substring(4);
        regexStr += "([0-9]{4})";
        formatCtx.yearIdx = index;
        index++;
      } else if (remaining.match(/^mm/i)) {
        remaining = remaining.substring(2);
        regexStr += "([0-9]{2})";
        formatCtx.monthIdx = index;
        index++;
      } else if (remaining.match(/^dd/i)) {
        remaining = remaining.substring(2);
        regexStr += "([0-9]{2})";
        formatCtx.dayIdx = index;
        index++;
      } else {
        regexStr += remaining[0];
        remaining = remaining.substring(1);
      }
    }
    formatCtx.convertRegEx = new RegExp(regexStr, "");
    return formatCtx;
  }
  convertDate(rowValue, format) {
    let convertMatch = format.convertRegEx.exec(rowValue);
    return `${convertMatch[format.yearIdx]}-${convertMatch[format.monthIdx]}-${convertMatch[format.dayIdx]}`;
  }
  calculateDatetimeFormat(format) {
    let remaining = format;
    let regexStr = "";
    let formatCtx = {};
    let index = 1;
    while (remaining) {
      if (remaining.match(/^yyyy/i)) {
        remaining = remaining.substring(4);
        regexStr += "([0-9]{4})";
        formatCtx.yearIdx = index;
        index++;
      } else if (remaining.match(/^MM/)) {
        remaining = remaining.substring(2);
        regexStr += "([0-9]{2})";
        formatCtx.monthIdx = index;
        index++;
      } else if (remaining.match(/^dd/i)) {
        remaining = remaining.substring(2);
        regexStr += "([0-9]{2})";
        formatCtx.dayIdx = index;
        index++;
      } else if (remaining.match(/^HH/)) {
        remaining = remaining.substring(2);
        regexStr += "([0-9]{2})";
        formatCtx.hourIdx = index;
        index++;
      } else if (remaining.match(/^mm/)) {
        remaining = remaining.substring(2);
        regexStr += "([0-9]{2})";
        formatCtx.minuteIdx = index;
        index++;
      } else if (remaining.match(/^ss/)) {
        remaining = remaining.substring(2);
        regexStr += "([0-9]{2})";
        formatCtx.secondIdx = index;
        index++;
      } else if (remaining.match(/^SSS/)) {
        remaining = remaining.substring(3);
        regexStr += "([0-9]{3})";
        formatCtx.milliIdx = index;
        index++;
      } else {
        regexStr += remaining[0];
        remaining = remaining.substring(1);
      }
    }
    formatCtx.convertRegEx = new RegExp(regexStr, "");
    return formatCtx;
  }
  convertDatetime(rowValue, format) {
    //TODO timezone yyyy-MM-ddTHH:mm:ss.SSS+FF:ff
    let convertMatch = format.convertRegEx.exec(rowValue);
    if (format.milliIdx){
      return `${convertMatch[format.yearIdx]}-${convertMatch[format.monthIdx]}-${convertMatch[format.dayIdx]}T${convertMatch[format.hourIdx]}:${convertMatch[format.minuteIdx]}:${convertMatch[format.secondIdx]}.${convertMatch[format.milliIdx]}Z`;
    } else {
      return `${convertMatch[format.yearIdx]}-${convertMatch[format.monthIdx]}-${convertMatch[format.dayIdx]}T${convertMatch[format.hourIdx]}:${convertMatch[format.minuteIdx]}:${convertMatch[format.secondIdx]}Z`;
    }
  }
  // Called once whenever any value is changed such that a new batch might be started (this.isProcessingQueue, this.batchSize, this.batchConcurrency, this.activeBatches or this.importData/updateResult)
  executeBatch() {
    if (!this.isProcessingQueue) {
      return;
    }

    let batchSize = +this.batchSize;
    if (!(batchSize > 0)) { // This also handles NaN
      return;
    }

    let batchConcurrency = +this.batchConcurrency;
    if (!(batchConcurrency > 0)) { // This also handles NaN
      return;
    }

    if (batchConcurrency <= this.activeBatches) {
      return;
    }

    let {statusColumnIndex, resultIdColumnIndex, actionColumnIndex, errorColumnIndex, importAction, sobjectType, idFieldName, inputIdColumnIndex} = this.importState;
    let data = this.importData.importTable.data;
    let header = this.importData.importTable.header.map(c => c.columnValue);

    let dateFormat = localStorage.getItem("dateFormat") || "yyyy-MM-dd";
    let datetimeFormat = localStorage.getItem("datetimeFormat") || "yyyy-MM-ddTHH:mm:ss.SSSZ";
    let decimalFormat = localStorage.getItem("decimalFormat") || ".";
    let dateFormatRegex = this.calculateDateFormat(dateFormat);
    let datetimeFormatRegex = this.calculateDatetimeFormat(datetimeFormat);
    let batchRows = [];
    let importArgs = {};
    if (importAction == "upsert") {
      importArgs.externalIDFieldName = idFieldName;
    }
    if (importAction == "delete" || importAction == "undelete") {
      importArgs.ID = [];
    } else if (importAction == "deleteMetadata") {
      importArgs["met:type"] = "CustomMetadata";
      importArgs["met:fullNames"] = [];
    } else if (importAction == "upsertMetadata") {
      importArgs["met:metadata"] = [];
    } else {
      importArgs.sObjects = [];
    }

    for (let row of data) {
      if (batchRows.length == batchSize) {
        break;
      }
      if (row[statusColumnIndex] != "Queued") {
        continue;
      }
      batchRows.push(row);
      row[statusColumnIndex] = "Processing";
      if (importAction == "delete" || importAction == "undelete") {
        importArgs.ID.push(row[inputIdColumnIndex]);
      } else if (importAction == "deleteMetadata") {
        importArgs["met:fullNames"].push(`${sobjectType}.${row[inputIdColumnIndex]}`);
      } else if (importAction == "upsertMetadata") {

        let fieldTypes = {};
        let selectedObjectFields = this.describeInfo.describeSobject(false, sobjectType).sobjectDescribe?.fields || [];
        selectedObjectFields.forEach(field => {
          fieldTypes[field.name] = (field.soapType == "tns:ID" ? "xsd:string" : field.soapType);
        });

        let sobject = {};
        sobject["$xsi:type"] = "met:CustomMetadata";
        sobject["met:values"] = [];

        for (let c = 0; c < row.length; c++) {
          let fieldName = header[c];
          let fieldValue = row[c];
          if ((fieldTypes[fieldName] == "Date" || fieldTypes[fieldName] == "xsd:date")
            && dateFormat != "yyyy-MM-dd") {
            fieldValue = this.convertDate(fieldValue, dateFormatRegex);
          } else if ((fieldTypes[fieldName] == "DateTime" || fieldTypes[fieldName] == "xsd:dateTime")
            && datetimeFormat != "yyyy-MM-ddTHH:mm:ss.SSS+/-HH:mm"
            && datetimeFormat != "yyyy-MM-ddTHH:mm:ss.SSSZ") {
            fieldValue = this.convertDatetime(fieldValue, datetimeFormatRegex);
          } else if (fieldValue && (fieldTypes[fieldName] == "Double" || fieldTypes[fieldName] == "xsd:double") && decimalFormat != "."){
            fieldValue = fieldValue.replace(decimalFormat, ".");
          }
          if (fieldName.startsWith("_")) {
            continue;
          }

          if (fieldName == "DeveloperName") {
            sobject["met:fullName"] = `${sobjectType}.${fieldValue}`;
          } else if (fieldName == "MasterLabel") {
            sobject["met:label"] = fieldValue;
          } else {
            if (stringIsEmpty(fieldValue)) {
              fieldValue = null;
            }

            let field = {
              "met:field": fieldName,
              "met:value": {
                "_": fieldValue
              }
            };

            if (fieldTypes[fieldName]) {
              field["met:value"]["$xsi:type"] = fieldTypes[fieldName];
            }

            sobject["met:values"].push(field);
          }
        }

        importArgs["met:metadata"].push(sobject);
      } else {
        let sobject = {};
        sobject["$xsi:type"] = sobjectType;
        sobject.fieldsToNull = [];

        let fieldTypes = {};
        let selectedObjectFields = this.describeInfo.describeSobject(this.apiType == "Tooling", sobjectType).sobjectDescribe?.fields || [];
        selectedObjectFields.forEach(field => {
          fieldTypes[field.name] = field.type;
        });

        for (let c = 0; c < row.length; c++) {
          if (header[c][0] != "_") {
            let columnName = header[c].split(":");
            if (row[c].trim() == "") {
              if (c != inputIdColumnIndex) {
                let field;
                let [fieldName] = columnName;
                if (columnName.length == 1) { // Our validation ensures there are always one or three elements in the array
                  field = fieldName;
                } else {
                  field = /__r$/.test(fieldName) ? fieldName.replace(/__r$/, "__c") : fieldName + "Id";
                }
                sobject.fieldsToNull.push(field);
              }
            } else if (columnName.length == 1) { // Our validation ensures there are always one or three elements in the array
              let [fieldName] = columnName;
              if ((fieldTypes[fieldName] == "date" || fieldTypes[fieldName] == "xsd:date")
                  && dateFormat != "yyyy-MM-dd") {
                sobject[fieldName] = this.convertDate(row[c], dateFormatRegex);
              } else if ((fieldTypes[fieldName] == "datetime" || fieldTypes[fieldName] == "xsd:dateTime")
                  && datetimeFormat != "yyyy-MM-ddTHH:mm:ss.SSS+/-HH:mm"
                  && datetimeFormat != "yyyy-MM-ddTHH:mm:ss.SSSZ") {
                sobject[fieldName] = this.convertDatetime(row[c], datetimeFormatRegex);
              } else if (row[c] && (fieldTypes[fieldName] == "double" || fieldTypes[fieldName] == "currency") && decimalFormat != "."){
                sobject[fieldName] = row[c].replace(decimalFormat, ".");
              } else {
                sobject[fieldName] = row[c];
              }
            } else {
              let [fieldName, typeName, subFieldName] = columnName;
              sobject[fieldName] = {
                "$xsi:type": typeName,
                [subFieldName]: row[c]
              };
            }
          }
        }
        importArgs.sObjects.push(sobject);
      }
    }
    if (batchRows.length == 0) {
      if (this.activeBatches == 0) {
        this.isProcessingQueue = false;
      }
      return;
    }
    this.activeBatches++;
    this.updateResult(this.importData.importTable);

    // When receiving invalid input, Salesforce will respond with HTTP status 500.
    // Chrome misinterprets that as the server being overloaded,
    // and will block the connection if it receives too many such errors too quickly.
    // See http://dev.chromium.org/throttling
    // To avoid that, we delay each batch a little at the beginning,
    // and we stop processing when we receive too many consecutive batch level errors.
    // Note: When a batch finishes successfully, it will start a timeout parallel to any existing timeouts,
    // so we will reach full batchConcurrency faster that timeoutDelay*batchConcurrency,
    // unless batches are slower than timeoutDelay.
    setTimeout(this.executeBatch.bind(this), 2500);

    let wsdl = sfConn.wsdl(apiVersion, this.apiType);
    let soapheaders = {};
    if (this.importType === "Case" || this.importType === "Lead" || this.importType === "Account") {
      soapheaders.headers = {"AssignmentRuleHeader": {"useDefaultRule": this.assignmentRule}};
    }
    this.spinFor(sfConn.soap(wsdl, importAction, importArgs, soapheaders).then(res => {

      let results = sfConn.asArray(res);
      for (let i = 0; i < results.length; i++) {
        let result = results[i];
        let row = batchRows[i];
        if (result.success == "true") {
          row[statusColumnIndex] = "Succeeded";
          row[actionColumnIndex]
            = importAction == "create" ? "Inserted"
            : importAction == "update" ? "Updated"
            : importAction == "upsert" || importAction == "upsertMetadata" ? (result.created == "true" ? "Inserted" : "Updated")
            : importAction == "delete" || importAction == "deleteMetadata" ? "Deleted"
            : importAction == "undelete" ? "Undeleted"
            : "Unknown";
        } else {
          row[statusColumnIndex] = "Failed";
          row[actionColumnIndex] = "";
        }
        row[resultIdColumnIndex] = result.id || "";
        row[errorColumnIndex] = sfConn.asArray(result.errors).map(errorNode =>
          errorNode.statusCode
          + ": " + errorNode.message
          + " [" + sfConn.asArray(errorNode.fields).join(", ") + "]"
        ).join(", ");
      }
      this.consecutiveFailures = 0;
    }, err => {
      if (err.name != "SalesforceSoapError") {
        throw err; // Not an HTTP error response
      }
      let errorText = err.message;
      for (let row of batchRows) {
        row[statusColumnIndex] = "Failed";
        row[resultIdColumnIndex] = "";
        row[actionColumnIndex] = "";
        row[errorColumnIndex] = errorText;
      }
      this.consecutiveFailures++;
      // If a whole batch has failed (as opposed to individual records failing),
      // too many times in a row, we stop the import.
      // This is useful when an error will affect all batches, for example a field name being misspelled.
      // This also helps prevent throtteling in Chrome.
      // A batch failing might not affect all batches, so we wait for a few consecutive errors before we stop.
      // For example, a whole batch will fail if one of the field values is of an incorrect type or format.
      if (this.consecutiveFailures >= 3) {
        this.isProcessingQueue = false;
      }
    }).then(() => {
      this.activeBatches--;
      this.updateResult(this.importData.importTable);
      this.executeBatch();
    }).catch(error => {
      console.error("Unexpected exception", error);
      this.isProcessingQueue = false;
    }));
  }

}

function csvSerialize(table, separator) {
  return table.map(row => row.map(text => "\"" + ("" + (text == null ? "" : text)).split("\"").join("\"\"") + "\"").join(separator)).join("\r\n");
}

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onApiTypeChange = this.onApiTypeChange.bind(this);
    this.onImportActionChange = this.onImportActionChange.bind(this);
    this.onImportTypeChange = this.onImportTypeChange.bind(this);
    this.onDataFormatChange = this.onDataFormatChange.bind(this);
    this.onDataPaste = this.onDataPaste.bind(this);
    this.onExternalIdChange = this.onExternalIdChange.bind(this);
    this.onBatchSizeChange = this.onBatchSizeChange.bind(this);
    this.onAssignmentRuleChange = this.onAssignmentRuleChange.bind(this);
    this.onBatchConcurrencyChange = this.onBatchConcurrencyChange.bind(this);
    this.onToggleHelpClick = this.onToggleHelpClick.bind(this);
    this.onDoImportClick = this.onDoImportClick.bind(this);
    this.onToggleProcessingClick = this.onToggleProcessingClick.bind(this);
    this.onRetryFailedClick = this.onRetryFailedClick.bind(this);
    this.onCopyAsExcelClick = this.onCopyAsExcelClick.bind(this);
    this.onCopyAsCsvClick = this.onCopyAsCsvClick.bind(this);
    this.onCopyOptionsClick = this.onCopyOptionsClick.bind(this);
    this.onSkipAllUnknownFieldsClick = this.onSkipAllUnknownFieldsClick.bind(this);
    this.onConfirmPopupYesClick = this.onConfirmPopupYesClick.bind(this);
    this.onConfirmPopupNoClick = this.onConfirmPopupNoClick.bind(this);
    this.unloadListener = null;
    this.onClick = this.onClick.bind(this);
  }
  onClick(){
    let {model} = this.props;
    if (model && model.tableModel) {
      model.tableModel.onClick();
    }
  }
  onApiTypeChange(e) {
    let {model} = this.props;
    model.apiType = e.target.value;
    model.updateAvailableActions();
    model.importAction = model.availableActions[0].value;
    model.importActionName = model.allActions.find(action => action.value == model.importAction).label;
    model.updateImportTableResult();
    model.didUpdate();
  }
  onImportActionChange(e) {
    let {model} = this.props;
    model.importAction = e.target.value;
    model.importActionName = e.target.options[e.target.selectedIndex].text;
    model.importActionSelected = true;
    if (model.importAction === "undelete"){
      this.onImportUndelete(model);
    }
    model.didUpdate();
  }
  onImportTypeChange(e) {
    let {model} = this.props;
    model.importType = e.target.value;
    model.refreshColumn();
    model.didUpdate();
  }
  onDataFormatChange(e) {
    let {model} = this.props;
    model.dataFormat = e.target.value;
    model.didUpdate();
  }
  onDataPaste(e) {
    let {model} = this.props;
    let text = e.clipboardData.getData("text/plain");
    model.setData(text);
    model.didUpdate();
  }
  onExternalIdChange(e) {
    let {model} = this.props;
    model.externalId = e.target.value;
    model.didUpdate();
  }
  onBatchSizeChange(e) {
    let {model} = this.props;
    model.batchSize = e.target.value;
    model.executeBatch();
    model.didUpdate();
  }
  onAssignmentRuleChange(e) {
    let {model} = this.props;
    model.assignmentRule = e.target.checked;
    model.didUpdate();
  }
  onBatchConcurrencyChange(e) {
    let {model} = this.props;
    model.batchConcurrency = e.target.value;
    model.executeBatch();
    model.didUpdate();
  }
  onToggleHelpClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.showHelp = !model.showHelp;
    model.didUpdate(() => {
      model.tableModel.viewportChange();
    });
  }
  onDoImportClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.doImport();
    model.didUpdate();
  }
  onToggleProcessingClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.isProcessingQueue = !model.isProcessingQueue;
    model.executeBatch();
    model.didUpdate();
  }
  onRetryFailedClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.retryFailed();
    model.didUpdate();
  }
  onCopyAsExcelClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.copyResult("\t");
  }
  onCopyAsCsvClick(e) {
    e.preventDefault();
    let {model} = this.props;
    let separator = ",";
    if (localStorage.getItem("csvSeparator")) {
      separator = localStorage.getItem("csvSeparator");
    }
    model.copyResult(separator);
  }
  onCopyOptionsClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.copyOptions();
  }
  onSkipAllUnknownFieldsClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.skipAllUnknownFields();
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
  onImportUndelete(model){
    //reinit import table to remove __Status column to be able to undelete rows after deleting it
    if (model.importData.importTable.header.find(c => c.columnValue == "__Status")) {
      //get indexes to remove
      const indices = model.importData.importTable.header.map((element, index) => element.columnValue.startsWith("__") ? index : undefined).filter(index => index !== undefined);
      //remove indexes from header and data
      model.importData.importTable.header = model.importData.importTable.header.filter((element, index) => !indices.includes(index));
      model.importData.importTable.data = model.importData.importTable.data.map(innerArray => innerArray.filter((element, index) => !indices.includes(index)));

      model.importCounts().Queued = model.importData.importTable.data.length;
      model.updateImportTableResult();
    }
  }
  componentDidMount() {
    let {model} = this.props;

    addEventListener("resize", () => { model.tableModel.viewportChange(); });

    model.updateImportTableResult();
  }
  componentDidUpdate() {
    let {model} = this.props;

    // We completely remove the listener when not needed (as opposed to just not setting returnValue in the listener),
    // because having the listener disables BFCache in Firefox (even if the listener does nothing).
    // Chrome does not have a BFCache.
    if (model.isWorking()) {
      if (!this.unloadListener) {
        this.unloadListener = e => {
          // Ask the user for confirmation before leaving
          e.returnValue = "The import will be stopped";
        };
        addEventListener("beforeunload", this.unloadListener);
      }
    } else if (this.unloadListener) {
      removeEventListener("beforeunload", this.unloadListener);
    }
  }
  render() {
    let {model} = this.props;
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 4);
    return h("div", {onClick: this.onClick},
      h("div", {id: "user-info"},
        h("a", {href: model.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {}, "Data Import"),
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
          h("a", {href: "#", className: "top-btn", id: "help-btn", title: "Import Help", onClick: this.onToggleHelpClick},
            h("div", {className: "icon"})
          ),
        ),
      ),
      h("div", {className: "conf-section"},
        h("div", {className: "conf-subsection"},
          h("div", {className: "area configure-import"},
            h("div", {className: "area-header"},
              h("h1", {}, "Configure Import")
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input", title: "With the tooling API you can import more metadata, but you cannot import regular data. With the metadata API you can import custom metadata types."},
                h("span", {className: "conf-label"}, "API Type"),
                h("span", {className: "conf-value"},
                  h("select", {value: model.apiType, onChange: this.onApiTypeChange, disabled: model.isWorking()},
                    ...model.allApis.map((api, index) => h("option", {key: index, value: api.value}, api.label))
                  )
                )
              )
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input"},
                h("span", {className: "conf-label"}, "Action"),
                h("span", {className: "conf-value"},
                  h("select", {value: model.importAction, onChange: this.onImportActionChange, disabled: model.isWorking()},
                    ...model.availableActions.map((action, index) => h("option", {key: index, value: action.value}, action.label))
                  )
                )
              )
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input"},
                h("span", {className: "conf-label"}, "Object"),
                h("span", {className: "conf-value"},
                  h("input", {type: "search", value: model.importType, onChange: this.onImportTypeChange, className: model.importTypeError() ? "object-list confError" : "object-list", disabled: model.isWorking(), list: "sobjectlist"}),
                  h("div", {className: "conf-error", hidden: !model.importTypeError()}, model.importTypeError())
                )
              ),
              h("a", {className: "button field-info", href: model.showDescribeUrl(), target: "_blank", title: "Show field info for the selected object"},
                h("div", {className: "button-icon"}),
              )
            ),
            h("div", {className: "conf-line radio-buttons"},
              h("span", {className: "conf-label"}, "Format"),
              h("label", {}, h("input", {type: "radio", name: "data-input-format", value: "excel", checked: model.dataFormat == "excel", onChange: this.onDataFormatChange, disabled: model.isWorking()}), " ", h("span", {}, "Excel")),
              " ",
              h("label", {}, h("input", {type: "radio", name: "data-input-format", value: "csv", checked: model.dataFormat == "csv", onChange: this.onDataFormatChange, disabled: model.isWorking()}), " ", h("span", {}, "CSV")),
              " ",
              h("label", {}, h("input", {type: "radio", name: "data-input-format", value: "json", checked: model.dataFormat == "json", onChange: this.onDataFormatChange, disabled: model.isWorking()}), " ", h("span", {}, "JSON"))
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input"},
                h("span", {className: "conf-label"}, "Data"),
                h("span", {className: "conf-value"},
                  h("textarea", {id: "data", value: model.message(), onPaste: this.onDataPaste, className: model.dataError ? "confError" : "", disabled: model.isWorking(), readOnly: true, rows: 1}),
                  h("div", {className: "conf-error", hidden: !model.dataError}, model.dataError)
                )
              )
            ),
            h("div", {className: "conf-line", hidden: model.importAction != "upsert"},
              h("label", {className: "conf-input", title: "Used in upserts to determine if an existing record should be updated or a new record should be created"},
                h("span", {className: "conf-label"}, "External ID:"),
                h("span", {className: "conf-value"},
                  h("input", {type: "text", value: model.externalId, onChange: this.onExternalIdChange, className: model.externalIdError() ? "confError" : "", disabled: model.isWorking(), list: "idlookuplist"}),
                  h("div", {className: "conf-error", hidden: !model.externalIdError()}, model.externalIdError())
                )
              )
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input", title: "The number of records per batch. A higher value is faster but increases the risk of errors due to governor limits."},
                h("span", {className: "conf-label"}, "Batch size"),
                h("span", {className: "conf-value"},
                  h("input", {type: "number", value: model.batchSize, onChange: this.onBatchSizeChange, className: (model.batchSizeError() ? "confError" : "") + " batch-size"}),
                  h("div", {className: "conf-error", hidden: !model.batchSizeError()}, model.batchSizeError())
                )
              )
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input", title: "The number of batches to execute concurrently. A higher number is faster but increases the risk of errors due to lock congestion."},
                h("span", {className: "conf-label"}, "Threads"),
                h("span", {className: "conf-value"},
                  h("input", {type: "number", value: model.batchConcurrency, onChange: this.onBatchConcurrencyChange, className: (model.batchConcurrencyError() ? "confError" : "") + " batch-size"}),
                  h("span", {hidden: !model.isWorking()}, model.activeBatches),
                  h("div", {className: "conf-error", hidden: !model.batchConcurrencyError()}, model.batchConcurrencyError())
                )
              )
            ),
            h("div", {className: "conf-line", hidden: (model.importType != "Case" && model.importType != "Lead" && model.importType != "Account")},
              h("label", {className: "conf-input", title: "Uses the default (active) assignment rule for a Case or Lead. If true for an Account, all territory assignment rules are applied. If false for an Account, no territory assignment rules are applied."},
                h("span", {className: "conf-label"}, "Assignment rule"),
                h("span", {className: "conf-value"},
                  h("input", {type: "checkbox", checked: model.assignmentRule, onChange: this.onAssignmentRuleChange})
                )
              )
            ),
            h("datalist", {id: "sobjectlist"}, model.sobjectList().map(data => h("option", {key: data, value: data}))),
            h("datalist", {id: "idlookuplist"}, model.idLookupList().map(data => h("option", {key: data, value: data}))),
            h("datalist", {id: "columnlist"}, model.columnList().map(data => h("option", {key: data, value: data})))
          ),
        ),
        h("div", {className: "conf-subsection columns-mapping"},
          h("div", {className: "area"},
            h("div", {className: "area-header"},
              h("h1", {}, "Field Mapping")
            ),
            /* h("div", {className: "columns-label"}, "Field mapping"), */
            model.getRequiredMissingFields().map((field, index) => h("div", {key: index, className: "conf-error confError"}, `Error: The field mapping has no '${field}' column`)),
            h("div", {className: "conf-value"}, model.columns().map((column, index) => h(ColumnMapper, {key: index, model, column})))
          )
        )
      ),
      h("div", {className: "area import-actions"},
        h("div", {className: "conf-line"},
          h("div", {className: "flex-wrapper"},
            h("button", {onClick: this.onDoImportClick, disabled: model.invalidInput() || model.isWorking() || model.importCounts().Queued == 0, className: "highlighted"}, "Run " + model.importActionName),
            h("button", {disabled: !model.isWorking(), onClick: this.onToggleProcessingClick, className: model.isWorking() && !model.isProcessingQueue ? "" : "cancel-btn"}, model.isWorking() && !model.isProcessingQueue ? "Resume Queued" : "Cancel Queued"),
            h("button", {disabled: !model.importCounts().Failed > 0, onClick: this.onRetryFailedClick}, "Retry Failed"),
            h("div", {className: "button-group"},
              h("button", {disabled: !model.canCopy(), onClick: this.onCopyAsExcelClick, title: "Copy import result to clipboard for pasting into Excel or similar"}, "Copy (Excel format)"),
              h("button", {disabled: !model.canCopy(), onClick: this.onCopyAsCsvClick, title: "Copy import result to clipboard for saving as a CSV file"}, "Copy (CSV)"),
            ),
          ),
          h("div", {className: "status-group"},
            h("div", {},
              h(StatusBox, {model, name: "Queued"}),
              h(StatusBox, {model, name: "Processing"})
            ),
            h("div", {},
              h(StatusBox, {model, name: "Succeeded"}),
              h(StatusBox, {model, name: "Failed"})
            ),
          ),
          h("div", {className: "flex-right"},
            h("button", {onClick: this.onCopyOptionsClick, title: "Save these import options by pasting them into Excel in the top left cell, just above the header row"}, "Copy Options"),
            h("button", {onClick: this.onSkipAllUnknownFieldsClick, disabled: !model.canSkipAllUnknownFields() || model.isWorking() || model.importCounts().Queued == 0}, "Skip all unknown fields")
          ),
        ),
        h("div", {hidden: !model.showHelp, className: "help-text"},
          h("h3", {}, "Import Help"),
          h("p", {}, "Use for quick one-off data imports."),
          h("ul", {},
            h("li", {}, "Enter your CSV or Excel data in the box above.",
              h("ul", {},
                h("li", {}, "The input must contain a header row with field API names."),
                h("li", {}, "To use an external ID for a lookup field, the header row should contain the lookup relation name, the target sobject name and the external ID name separated by colons, e.g. \"MyLookupField__r:MyObject__c:MyExternalIdField__c\"."),
                h("li", {}, "Empty cells insert null values."),
                h("li", {}, "Number, date, time and checkbox values must conform to the relevant ", h("a", {href: "http://www.w3.org/TR/xmlschema-2/#built-in-primitive-datatypes", target: "_blank"}, "XSD datatypes"), "."),
                h("li", {}, "Columns starting with an underscore are ignored."),
                h("li", {}, "You can resume a previous import by including the \"__Status\" column in your input."),
                h("li", {}, "You can supply the other import options by clicking \"Copy options\" and pasting the options into Excel in the top left cell, just above the header row.")
              )
            ),
            h("li", {}, "Select your input format"),
            h("li", {}, "Select an action (insert, update, upsert or delete)"),
            h("li", {}, "Enter the API name of the object to import"),
            h("li", {}, "Press the Run button")
          ),
          h("p", {}, "Bulk API is not supported. Large data volumes may freeze or crash your browser.")
        ),
      ),
      h("div", {className: "area result-area"},
        h(ScrollTable, {model: model.tableModel}),
        model.confirmPopup ? h("div", {},
          h("div", {id: "confirm-background"},
            h("div", {id: "confirm-dialog"},
              h("h1", {}, "Import"),
              h("p", {}, "You are about to modify your data in Salesforce. This action cannot be undone."),
              h("p", {}, model.confirmPopup.text),
              h("div", {className: "dialog-buttons"},
                h("button", {onClick: this.onConfirmPopupYesClick}, model.importActionName),
                h("button", {onClick: this.onConfirmPopupNoClick, className: "cancel-btn"}, "Cancel")
              )
            )
          )
        ) : null
      )
    );
  }
}

class ColumnMapper extends React.Component {
  constructor(props) {
    super(props);
    this.onColumnValueChange = this.onColumnValueChange.bind(this);
    this.onColumnSkipClick = this.onColumnSkipClick.bind(this);
  }
  onColumnValueChange(e) {
    let {model, column} = this.props;
    column.setColumnValue(e.target.value);
    model.didUpdate();
  }
  onColumnSkipClick(e) {
    let {model, column} = this.props;
    e.preventDefault();
    column.columnSkip();
    model.didUpdate();
  }
  render() {
    let {model, column} = this.props;
    return h("div", {className: "conf-line"},
      h("label", {htmlFor: "col-" + column.columnIndex, className: "column-label"}, column.columnOriginalValue),
      h("div", {className: "flex-wrapper"},
        h("input", {type: "search", list: "columnlist", value: column.columnValue, onChange: this.onColumnValueChange, className: column.columnError() ? "confError" : "", disabled: model.isWorking(), id: "col-" + column.columnIndex}),
        h("div", {className: "conf-error", hidden: !column.columnError()}, h("span", {}, column.columnError()), " ", h("button", {onClick: this.onColumnSkipClick, hidden: model.isWorking(), title: "Don't import this column"}, "Skip"))
      )
    );
  }
}

class StatusBox extends React.Component {
  constructor(props) {
    super(props);
    this.onShowStatusChange = this.onShowStatusChange.bind(this);
  }
  onShowStatusChange(e) {
    let {model, name} = this.props;
    model.showStatus[name] = e.target.checked;
    model.updateImportTableResult();
    model.didUpdate();
  }
  render() {
    let {model, name} = this.props;
    return h("label", {className: model.importCounts()[name] == 0 ? "statusGroupEmpty" : ""}, h("input", {type: "checkbox", checked: model.showStatus[name], onChange: this.onShowStatusChange}), " " + model.importCounts()[name] + " " + name);
  }
}

{

  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {

    let root = document.getElementById("root");
    let model = new Model(sfHost, args);
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

    if (parent && parent.isUnitTest) { // for unit tests
      parent.insextTestLoaded({model});
    }

  });

}


function stringIsEmpty(str) {
  return str == null || str == undefined || str.trim() == "";
}
