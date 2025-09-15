/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {ScrollTable, TableModel, RecordTable} from "./record-table.js";
import {DescribeInfo} from "./data-load.js";
/* global initButton */

/*
list of rule to apply by category (dataset source which is common) in order to avoid duplicate call (check box on category check all rule from dataset.
run button
progress bar
when finished display result and store it in chrome db
be able to launch new run (run of rule start by deleting previous result from local db)
result must be a table with : Description, how to fix, identifier, link?, risk/priority
global dashboard with result total gauge + total by criticity

list of rule to create:


class:
  class with poor code coverage < 75%
  class with recompilation needed
  old api version
  hardcoded id in code instead of label
  soql in loop
  dml in loop
  apex class without explicit sharing
  apex trigger with logic, soql or dml instead of service class
  apex class not reference and not rest apex

flow:
  flow with too much version
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

table with list of issue : name, link, criticity, how to fix
view chain of batchable/queuable and schedule view
on each element: mark as solved move it lower and do not count on score
*/
class EntityAnalyzer {
  //   object:
  //   - entity with no description
  //   too much validation rule by object
  //   too much trigger by object
  //   - too much field by object

  // fields:
  //   custom field with no reference (flow, apex, layout) and no data
  //   custom field with no data
  //   - field with no description
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    //TODO same on data model export
    let query = "SELECT QualifiedApiName FROM EntityDefinition WHERE PublisherId != 'System' and Description = null ORDER BY QualifiedApiName";
    let result = {rows: []};
    await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {}), result)
      .catch(error => {
        console.log(error);
      });
    let tableFields = new Map();
    let logs = [];
    for (let i = 0; i < result.rows.length; i++) {
      let entity = result.rows[i];
      logs.push({reference: entity.QualifiedApiName, name: "Custom SObject without description", Description: "Add Description from SETUP > Object Manager > (select entity) > Edit", priority: 5});//5 low
    }
    this.recordTable.addToTable(logs);
    this.model.resultTableModel.dataChange(this.recordTable);
    this.model.didUpdate();
    let {globalDescribe, globalStatus} = this.model.describeInfo.describeGlobal(false);
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
        if (!field.Description){
          logs2.push({reference: field.EntityDefinition.QualifiedApiName + "." + field.QualifiedApiName, name: "Custom Field without description", Description: "Add Description from SETUP > Object Manager > (select entity) > Fields & Relationships > (select field) > Edit", priority: 5});//5 low
        }
        let cnt = tableFields.get(field.EntityDefinition.QualifiedApiName);
        if (!cnt){
          cnt = 0;
        }
        cnt++;
        tableFields.set(field.EntityDefinition.QualifiedApiName, cnt);
      }
      this.recordTable.addToTable(logs2);
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }
    let logs3 = [];
    for (let [key, value] of tableFields) {
      if (value > 100){
        logs3.push({reference: key, name: "Entity with too many fields", Description: "Consider reducing the number of fields on this entity. Salesforce recommends no more than 100 fields per object to ensure optimal performance.", priority: (value > 200 ? 4 : 3)});
      }
    }
    this.recordTable.addToTable(logs3);
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
    this.progress = "ready";
    this.winInnerHeight = 0;

    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.didUpdate();
    });
    this.describeInfo.describeGlobal(false);
    // Processed data and UI state
    this.resultTableModel = new TableModel(sfHost, this.didUpdate.bind(this), {});
    this.resultError = null;
    this.recordTable = new RecordTable();
    this.recordTable.describeInfo = this.describeInfo;
    this.recordTable.sfHost = sfHost;
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
      this.userId = res.userId;
    }));
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
    if (this.progress == "working") {
      return "(Loading) Running Org Analyzer";
    }
    return "Org Analyzer";
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
  startAnalyze(){
    //this.logs = [];
    let self = this;
    let analyser = new EntityAnalyzer(this, this.recordTable);
    analyser.analyse().then(() => {
      self.progress = "ready";
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
      self.didUpdate();
    });
  }
}

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onStartClick = this.onStartClick.bind(this);
  }
  onStartClick() {
    let {model} = this.props;
    model.startAnalyze();
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
    document.title = model.title();
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 5);
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
          h("div", {className: ""}), //TODO rules list
          h("div", {className: "autocomplete-header"},
            h("div", {className: "flex-right"},
              h("button", {onClick: this.onStartClick, disabled: (model.progress == "working")}, "Analyze the org"),
            ),
          ),
        ),
        h("div", {className: "area", id: "result-area"},
          h("h1", {}, "Results"),
          h("textarea", {className: "result-text", readOnly: true, value: model.resultError || "", hidden: model.resultError == null}),
          h(ScrollTable, {model: model.resultTableModel, hidden: (model.resultError != null)})
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
    let model = new Model(sfHost);
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

  });

}
