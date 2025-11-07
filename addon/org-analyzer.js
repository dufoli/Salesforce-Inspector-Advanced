/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {ScrollTable, TableModel, RecordTable} from "./record-table.js";
import {DescribeInfo} from "./data-load.js";
/* global initButton */

/*
progress bar + spinning + block button during run
be able to launch new run (run of rule start by deleting previous result from local db)
make priority high red and low yellow
list of rule to create:

class:
  bachable or queuable schedulable without jobs in last 365 days
  hardcoded id in code instead of label
  soql in loop
  dml in loop
  SOQL injection : missing escape on parameter
  apex class without explicit sharing
  apex trigger with logic, soql or dml instead of service class
  apex class not reference and not rest apex

flow: https://github.com/Flow-Scanner/lightning-flow-scanner-core
  flow with too much version
  get record in loop
  update record in loop
  create record in loop
  delete record in loop
  old api version
  soql in loop
  dml in loop

Interface:
  VF page or LC to migrate to LWC
  PRB or workflow to migrate to flow

user:
  too many system admin
  custom Profiles or Permission Sets that with no assignment
  Role Hierarchy with too many levels
  Role with no member
  Empty Public Groups that are used only in Sharing Rules
  user without login since long time or never logged in

Security:
  connecteed app admin pre auth with too many permission
  connecteed app admin pre auth without permission
  enable high assurance setting(s)

*/

class ApexAnalyzer {
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let apexLowCoverageRule = this.model.isRuleEnable("Apex Class with poor code coverage");
    let apexOldApiVersionRule = this.model.isRuleEnable("Apex Class with old API Version");
    let apexNeedRecompilationRule = this.model.isRuleEnable("Apex Class need recompilation");
    try {
      if (apexLowCoverageRule) {
        let logs = [];
        let queryCoverage = "SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId != NULL AND ApexClassOrTrigger.Name != NULL AND (NumLinesCovered > 0 OR NumLinesUncovered > 0) AND NumLinesCovered != NULL AND NumLinesUncovered != NULL ORDER BY ApexClassOrTrigger.Name";
        let result = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryCoverage), {}), result).catch(error => {
          console.error(error);
        });
        for (let coverage of result.rows) {
          if (coverage.NumLinesCovered * 100 / (coverage.NumLinesCovered + coverage.NumLinesUncovered) < 75){
            logs.push({reference: coverage.ApexClassOrTrigger.Name, name: "Apex Class with poor code coverage", description: "This Apex class has a code coverage below 75%. Consider improving the test coverage to meet Salesforce deployment requirements.", priority: 3});
          }
        }
        this.recordTable.addToTable(logs, {column: "priority"});
        this.model.resultTableModel.dataChange(this.recordTable);
        this.model.didUpdate();
      }
    } catch (error) {
      console.log(error);
    }

    try {
      if (apexOldApiVersionRule || apexNeedRecompilationRule) {
        let logs = [];
        let queryApexClass = "SELECT Name, ApiVersion, IsValid, Status, NamespacePrefix FROM ApexClass";
        let result = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryApexClass), {}), result).catch(error => {
          console.error(error);
        });
        for (let apexClass of result.rows) {
          if (apexOldApiVersionRule && apexClass.ApiVersion < 50){
            logs.push({reference: (apexClass.NamespacePrefix ? apexClass.NamespacePrefix + "." : "") + apexClass.Name, name: "Apex Class with old API Version", description: "This Apex class is using an old API version (" + apexClass.ApiVersion + "). Consider updating it to a more recent version to take advantage of new features and improvements.", priority: apexClass.ApiVersion < 30 ? 1 : (apexClass.ApiVersion < 40 ? 2 : 3)});
          }
          if (apexNeedRecompilationRule && !apexClass.IsValid){
            logs.push({reference: (apexClass.NamespacePrefix ? apexClass.NamespacePrefix + "." : "") + apexClass.Name, name: "Apex Class need recompilation", description: "This Apex class is invalid and needs recompilation. Please recompile the class to ensure it functions correctly.", priority: 1});
          }
        }
        this.recordTable.addToTable(logs, {column: "priority"});
        this.model.resultTableModel.dataChange(this.recordTable);
        this.model.didUpdate();
      }
    } catch (error) {
      console.log(error);
    }
  }
}
class SecurityAnalyzer {
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let nameToConnectedApp = new Map();
    let logs = [];
    let appNotUsedRule = this.model.isRuleEnable("Connected App OAuth Token not used recently");
    let appSelfAuthRule = this.model.isRuleEnable("Connected App allows self-authorization");
    let appUsedNotInstalledRule = this.model.isRuleEnable("Connected App is used but not installed");
    let orgWithoutIpRangeRule = this.model.isRuleEnable("No IP Range defined");

    try {
      if (orgWithoutIpRangeRule) {
        let queryApp = "SELECT Id, Start, End FROM IPRange";
        let data = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryApp), {});
        if (!data.records || data.records.length == 0){
          logs.push({reference: "", name: "No IP Range defined", description: "No IP Ranges are defined in your Salesforce org. It is recommended to set up IP Ranges to restrict access and enhance security.", priority: 2});
        }
        this.recordTable.addToTable(logs, {column: "priority"});
        this.model.resultTableModel.dataChange(this.recordTable);
        this.model.didUpdate();
        logs = [];
      }
    } catch (error) {
      console.log(error);
    }

    if (!appNotUsedRule && !appSelfAuthRule && !appUsedNotInstalledRule){
      return;
    }
    try {
      let queryApp = "SELECT Name,CreatedBy.Name,CreatedDate,LastModifiedBy.Name,LastModifiedDate,OptionsAllowAdminApprovedUsersOnly FROM ConnectedApplication";
      let data = await sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryApp), {});
      for (let record of data.records) {
        nameToConnectedApp.set(record.Name, {AppName: record.Name, IsUsingAdminAuthorization: record.OptionsAllowAdminApprovedUsersOnly, installed: true, LastUsed: null, UseCount: 0});
      }
    } catch (error) {
      console.log(error);
    }
    let query = "SELECT AppName, CreatedDate, AppMenuItemId, AppMenuItem.IsUsingAdminAuthorization, User.Name, User.Profile.Name, LastUsedDate, UseCount FROM OAuthToken";
    try {
      let qeryLogin = "SELECT Application, max(LoginTime) lastLogin FROM LoginHistory group by Application ORDER BY Application";
      let data = await sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(qeryLogin), {});
      for (let record of data.records) {
        nameToConnectedApp.get(record.Application).LastUsed = new Date(record.lastLogin);
      }
    } catch (error) {
      console.log(error);
    }
    let result = {rows: []};
    await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query), {}), result)
      .catch(error => {
        console.log(error);
      });
    for (let i = 0; i < result.rows.length; i++) {
      let app = nameToConnectedApp.get(result.rows[i].AppName);
      if (app == null) {
        let row = result.rows[i];
        nameToConnectedApp.set(result.rows[i].AppName, {AppName: row.AppName, IsUsingAdminAuthorization: row.IsUsingAdminAuthorization, installed: row.AppMenuItemId != null, LastUsed: new Date(row.LastUsedDate), UseCount: row.UseCount});
      } else {
        if (app.UseCount == null){
          app.UseCount = 0;
        }
        app.UseCount += result.rows[i].UseCount;
        let lastUsed = result.rows[i].LastUsedDate ? new Date(result.rows[i].LastUsedDate) : null;
        if ((app.LastUsed == null && lastUsed != null) || (app.LastUsed != null && lastUsed != null && app.LastUsed < lastUsed)){
          app.LastUsed = lastUsed;
        }
        if (result.rows[i].AppMenuItemId != null){
          app.installed = true;
        }
      }
    }
    let now = new Date();

    for (const app of nameToConnectedApp.values()) {
      let diffDays = app.LastUsed ? Math.floor((now - app.lastUsed) / (1000 * 60 * 60 * 24)) : null;
      if (appNotUsedRule && (diffDays == null || diffDays > 90)){ //3 months
        logs.push({reference: app.AppName, name: "Connected App OAuth Token not used recently", description: "The OAuth token for this connected app has not been used in over 90 days. Consider reviewing the app's usage and revoking access if it's no longer needed.", priority: ((diffDays == null || diffDays > 180) ? 3 : 4)});
      }
      if (appSelfAuthRule && !app.IsUsingAdminAuthorization) {
        logs.push({reference: app.AppName, name: "Connected App allows self-authorization", description: "This connected app allows users to self-authorize. Consider restricting authorization to admin-approved users only to enhance security. (Click on [Manage Policies]>[Admin Users are pre-approved] > save + Select profiles/permission sets allowed", priority: 2});
      }
      if (appUsedNotInstalledRule && app.UseCount && !app.installed) {
        logs.push({reference: app.AppName, name: "Connected App is used but not installed", description: "This connected app has OAuth tokens in use but is not listed among installed connected apps. Investigate this discrepancy to ensure proper management of connected apps.", priority: 1});
      }
    }
    this.recordTable.addToTable(logs, {column: "priority"});
    this.model.resultTableModel.dataChange(this.recordTable);
    this.model.didUpdate();
  }
}
class EntityAnalyzer {
  //   object:
  //   too much validation rule by object
  //   too much trigger by object

  // fields:
  //   custom field with no reference (flow, apex, layout) and no data
  //   custom field with no data
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let objWithoutDescRule = this.model.isRuleEnable("Custom SObject without description");
    let fieldWithoutDescRule = this.model.isRuleEnable("Custom Field without description");
    let objWithManyFieldsDescRule = this.model.isRuleEnable("Entity with too many fields");
    if (!objWithoutDescRule && !fieldWithoutDescRule && !objWithManyFieldsDescRule){
      return;
    }

    let query = "SELECT QualifiedApiName FROM EntityDefinition WHERE PublisherId != 'System' and Description = null ORDER BY QualifiedApiName";
    let result = {rows: []};
    await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {}), result)
      .catch(error => {
        console.log(error);
      });
    let tableFields = new Map();
    let logs = [];
    if (objWithoutDescRule) {
      for (let i = 0; i < result.rows.length; i++) {
        let entity = result.rows[i];
        logs.push({reference: entity.QualifiedApiName, name: "Custom SObject without description", description: "Add description from SETUP > Object Manager > (select entity) > Edit", priority: 5});//5 low
      }
      this.recordTable.addToTable(logs, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }
    let {globalDescribe} = this.model.describeInfo.describeGlobal(false);
    //const validationRuleSelect = "SELECT Id, Active, EntityDefinitionId, EntityDefinition.DeveloperName, ErrorMessage, ValidationName FROM ValidationRule WHERE ErrorMessage LIKE '%" + shortcutSearch.replace(/([%_\\'])/g, "\\$1") + "%' LIMIT 30";
    query = "SELECT Id, QualifiedApiName, EntityDefinition.QualifiedApiName, Description FROM FieldDefinition WHERE PublisherId!= 'System' AND EntityDefinition.QualifiedApiName in ([RANGE])";
    let objectList = globalDescribe.sobjects.filter(s => (s.associateEntityType == null));
    for (let index = 0; index < objectList.length; index += 50) {
      let entityNames = objectList.slice(index, index + 50).map(e => "'" + e.name + "'");
      let fieldsFesult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query.replace("[RANGE]", entityNames.join(", "))), {}), fieldsFesult)
        .catch(error => {
          console.log(error);
        });
      let logs2 = [];
      for (let j = 0; j < fieldsFesult.rows.length; j++){
        let field = fieldsFesult.rows[j];
        //&& field.QualifiedApiName.endsWith("__c")
        if (!field.Description && fieldWithoutDescRule){
          logs2.push({reference: field.EntityDefinition.QualifiedApiName + "." + field.QualifiedApiName, name: "Custom Field without description", description: "Add description from SETUP > Object Manager > (select entity) > Fields & Relationships > (select field) > Edit", priority: 5});//5 low
        }
        let cnt = tableFields.get(field.EntityDefinition.QualifiedApiName);
        if (!cnt){
          cnt = 0;
        }
        cnt++;
        tableFields.set(field.EntityDefinition.QualifiedApiName, cnt);
      }
      this.recordTable.addToTable(logs2, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }
    let logs3 = [];
    if (objWithManyFieldsDescRule){
      for (let [key, value] of tableFields) {
        if (value > 100){
          logs3.push({reference: key, name: "Entity with too many fields", description: "Consider reducing the number of fields on this entity. Salesforce recommends no more than " + (value > 200 ? "200" : "100") + " fields per object to ensure optimal performance.", priority: (value > 200 ? 3 : 4)});
        }
      }
    }
    this.recordTable.addToTable(logs3, {column: "priority"});
    this.model.resultTableModel.dataChange(this.recordTable);
    this.model.didUpdate();
  }
}
class Model {
  constructor(sfHost) {
    this.reactCallback = null;
    this.spinnerCount = 0;
    this.sfLink = "https://" + sfHost;
    this.userInfo = "...";
    this.progress = 0;
    this.winInnerHeight = 0;

    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.didUpdate();
    });
    this.describeInfo.describeGlobal(false);
    // Processed data and UI state
    this.resultTableModel = new TableModel(sfHost, this.didUpdate.bind(this), {});
    this.resultError = null;
    this.analyzeStatus = "Ready";
    this.recordTable = new RecordTable(st => { this.analyzeStatus = st; });
    this.recordTable.describeInfo = this.describeInfo;
    this.recordTable.sfHost = sfHost;
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
      this.userId = res.userId;
    }));
    this.rules = [
      {name: "Custom SObject without description", selected: true},
      {name: "Custom Field without description", selected: true},
      {name: "Entity with too many fields", selected: true},
      {name: "Connected App OAuth Token not used recently", selected: true},
      {name: "Connected App allows self-authorization", selected: true},
      {name: "Connected App is used but not installed", selected: true},
      {name: "No IP Range defined", selected: true},
      {name: "Apex Class with poor code coverage", selected: true},
      {name: "Apex Class with old API Version", selected: true},
      {name: "Apex Class need recompilation", selected: true},
    ];
  }
  isRuleEnable(ruleName) {
    return this.rules.some(rule => rule.name == ruleName && rule.selected);
  }
  getSeparator() {
    let separator = ",";
    if (localStorage.getItem("csvSeparator")) {
      separator = localStorage.getItem("csvSeparator");
    }
    return separator;
  }
  downloadCsv() {
    let separator = this.getSeparator();
    let downloadLink = document.createElement("a");
    const date = new Date();
    const timestamp = date.toISOString().replace(/[^0-9]/g, "");
    downloadLink.download = `orgAnalyze${timestamp}.csv`;
    let BOM = "\uFEFF";
    let bb = new Blob([BOM, this.recordTable.csvSerialize(separator)], {type: "text/csv;charset=utf-8"});
    downloadLink.href = window.URL.createObjectURL(bb);
    downloadLink.click();
  }
  /**
   * Notify React that we changed something, so it will rerender the view.
   * Should only be called once at the end of an event or asynchronous operation, since each call can take some time.
   * All event listeners (functions starting with "on") should call this function if they update the model.
   * Asynchronous operations should use the spinFor function, which will call this function after calling its callback.
   * Other functions should not call this function, since they are called by a function that does.
   * @param cb A function to be called once React has processed the update.
   */
  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
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

  title() {
    if (this.analyzeStatus == "Ready") {
      return "Org Analyzer";
    }
    return "(Loading) Running Org Analyzer";
  }

  async batchHandler(batch, options) {
    let self = this;
    return batch.catch(err => {
      if (err.name == "AbortError") {
        return {records: [], done: true, totalSize: -1};
      }
      throw err;
    }).then(data => {
      options.rows = options.rows.concat(data.records);
      if (!data.done) {
        let pr = this.batchHandler(sfConn.rest(data.nextRecordsUrl, {}), options);
        return pr;
      }
      return null;
    }, err => {
      if (err.name != "SalesforceRestError") {
        throw err; // not a SalesforceRestError
      }
      console.log(err);
      return null;
    });
  }
  async startAnalyze(){
    //this.logs = [];
    let analyser = new EntityAnalyzer(this, this.recordTable);
    await analyser.analyse();
    analyser = new SecurityAnalyzer(this, this.recordTable);
    await analyser.analyse();
    analyser = new ApexAnalyzer(this, this.recordTable);
    await analyser.analyse();
    this.analyzeStatus = "Ready";
    // self.recordTable.records = self.logs;
    // if (self.recordTable.table.length == 0 && self.logs.length > 0){
    //   self.recordTable.table.push(self.recordTable.header);
    //   self.recordTable.rowVisibilities.push(true);
    // }
    // for (let record of self.logs) {
    //   let row = new Array(self.recordTable.header.length);
    //   row[0] = record;
    //   self.recordTable.table.push(row);
    //   self.recordTable.rowVisibilities.push(self.recordTable.isVisible(row));
    //   self.recordTable.discoverColumns(record, "", row);
    // }
    //self.recordTable.totalSize = self.logs.length;
    this.didUpdate();
  }
}

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onStartClick = this.onStartClick.bind(this);
    this.onStopAnalyze = this.onStopAnalyze.bind(this);
    this.onSelectPriorityFilter = this.onSelectPriorityFilter.bind(this);
    this.onSelectAllChange = this.onSelectAllChange.bind(this);
    this.onDownloadCsv = this.onDownloadCsv.bind(this);
  }
  onStartClick() {
    let {model} = this.props;
    model.startAnalyze();
  }
  onStopAnalyze() {
    let {model} = this.props;
    model.stopAnalyze();
  }
  onSelectPriorityFilter(event) {
    let {model} = this.props;
    model.priorityFilter = event.target.value;
    if (model.priorityFilter == null) {
      model.recordTable.updateVisibility(null);
    } else {
      model.recordTable.updateVisibility({indexes: [4], value: model.priorityFilter});
    }
    model.resultTableModel.dataChange(model.recordTable);
  }
  onSelectAllChange(e) {
    let {model} = this.props;
    let checked = e.target.checked;
    for (let rule of model.rules) {
      rule.selected = checked;
    }
    if (model.selectAll && model.rules) {
      model.selectAll.indeterminate = (model.rules.some(rule => rule.selected) && model.rules.some(rule => !rule.selected));
    }
    model.didUpdate();
  }
  onDownloadCsv() {
    let {model} = this.props;
    model.downloadCsv();
    model.didUpdate();
  }
  componentDidMount() {
    let {model} = this.props;
    function resize() {
      model.winInnerHeight = innerHeight;
      model.didUpdate(); // Will call recalculateSize
    }
    addEventListener("resize", resize);
    resize();
  }
  render() {
    let {model} = this.props;
    //TODO UX
    // progress bar
    // checkbox for each rule => rules list
    document.title = model.title();
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 5);
    let selectAllChecked = model.rules && model.rules.every(rule => rule.selected);

    return (
      h("div", {},
        h("div", {id: "user-info", className: "object-bar"},
          h("a", {href: model.sfLink, className: "sf-link"},
            h("svg", {viewBox: "0 0 24 24"},
              h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
            ),
            " Salesforce Home"
          ),
          h("h1", {}, "Org Analyzer"),
          h("span", {}, " / " + model.userInfo),
          h("div", {className: "flex-right"},
            h("div", {id: "spinner", role: "status", className: "slds-spinner slds-spinner_small slds-spinner_inline", hidden: model.spinnerCount == 0},
              h("span", {className: "slds-assistive-text"}),
              h("div", {className: "slds-spinner__dot-a"}),
              h("div", {className: "slds-spinner__dot-b"}),
            ),
            h("a", {href: "options.html?" + hostArg, className: "top-btn", id: "options-btn", title: "Option", target: "_blank"},
              h("div", {className: "icon"})
            )
          ),
        ),
        h("div", {className: "area"},
          h("h1", {}, "Rules"),
          h("div", {},
            h("span", {}, "Select the rules you want to run: "),
            h("label", {},
              h("input", {type: "checkbox", ref: "selectref", checked: selectAllChecked, onChange: this.onSelectAllChange}),
              "Select all"
            ),
            h("br", {}),
            h("div", {className: "slds-grid slds-wrap"},
              model.rules.map((rule, i) => h(RuleSelector, {key: "rule" + i, model, rule}))
            )
          ),
          h("div", {className: "autocomplete-header"},
            h("div", {className: "flex-right"},
              h("button", {className: "highlighted", onClick: this.onStartClick, hidden: (model.analyzeStatus != "Ready")}, "Analyze org"),
            ),
          ),
        ),
        h("div", {className: "area", id: "result-area"},
          h("div", {className: "result-bar"},
            h("h1", {}, "Results"),
            h("button", {disabled: (model.recordTable == null || model.recordTable.countOfVisibleRecords == null), onClick: this.onDownloadCsv, title: "Download csv file"},
              h("svg", {className: "download-icon"},
                h("use", {xlinkHref: "symbols.svg#download"})
              )
            ),
            h("select", {value: model.priorityFilter, onChange: this.onSelectPriorityFilter, className: "priority-filter"},
              h("option", {value: null, defaultValue: true}, "All priorities"),
              h("option", {key: "1", value: 1}, "1"),
              h("option", {key: "2", value: 2}, "2"),
              h("option", {key: "3", value: 3}, "3"),
              h("option", {key: "4", value: 4}, "4"),
              h("option", {key: "5", value: 5}, "5"),
            ),
            h("span", {className: "result-status flex-right"},
              h("span", {}, model.analyzeStatus),
              h("button", {className: "cancel-btn", hidden: (model.analyzeStatus == "Ready"), onClick: this.onStopAnalyze}, "Stop"),
            ),
          ),
          h("textarea", {className: "result-text", readOnly: true, value: model.resultError || "", hidden: model.resultError == null}),
          h(ScrollTable, {model: model.resultTableModel, hidden: (model.resultError != null)})
        )
      )
    );
  }
}
class RuleSelector extends React.Component {
  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
  }
  onChange(e) {
    let {rule, model} = this.props;
    rule.selected = e.target.checked;
    if (model.selectAll && model.rules) {
      model.selectAll.indeterminate = (model.rules.some(r => r.selected) && model.rules.some(r => !r.selected));
    }
    model.didUpdate();
  }
  render() {
    let {rule} = this.props;
    return h("div", {className: "slds-col slds-size_3-of-12"}, h("label", {title: rule.name},
      h("input", {type: "checkbox", checked: rule.selected, onChange: this.onChange}),
      rule.name
    ));
  }
}

{

  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {

    let root = document.getElementById("root");
    let model = new Model(sfHost);
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

  });

}
