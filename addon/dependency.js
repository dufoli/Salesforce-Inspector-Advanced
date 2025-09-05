/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */
import {DescribeInfo} from "./data-load.js";
import {ScrollTable, TableModel, RecordTable} from "./record-table.js";

class Model {
  constructor({sfHost, args}) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.userInfo = "...";
    this.spinnerCount = 0;
    this.error = null;
    this.tableModel = new TableModel(sfHost, this.didUpdate.bind(this));
    this.resultTableCallback = () => this.tableModel.dataChange(this.data);
    this.name = args.get("name");
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
    }));
    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.didUpdate();
    });
    this.data = new RecordTable();
    this.data.isTooling = true;
    this.data.describeInfo = this.describeInfo;
    this.data.sfHost = this.sfHost;
    //quick action and flexipage :
    let self = this;
    sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=SELECT+MetadataComponentId,MetadataComponentName,MetadataComponentType,RefMetadataComponentName+FROM+MetadataComponentDependency+WHERE+(RefMetadataComponentType+=+'FlowDefinition'+OR+RefMetadataComponentType+=+'Flow')", {method: "GET"}).then(res2 => {
      this.data.addToTable(res2.records.filter(rec => rec.RefMetadataComponentName === this.name));
      self.resultTableCallback();
    });

    //flow do not worked well with MetadataComponentDependency so we need to do parallel query to gt metadata
    sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=SELECT+Id+FROM+Flow+WHERE+Status+='Active'", {method: "GET"}).then(async resFlowId => {
      resFlowId.records.map(rec => rec.Id).map(flowId => sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=SELECT+Id,Definition.DeveloperName,Metadata+FROM+Flow+WHERE+Id+='" + flowId + "'", {method: "GET"}).then(resFlow => {
        resFlow.records.forEach(flow => {
          if (!flow.Metadata.subflows.some(f => f.flowName == this.name)) {
            return;
          }
          this.data.addToTable([{
            "attributes": {
              "type": "MetadataComponentDependency",
              "url": "/services/data/v61.0/tooling/sobjects/MetadataComponentDependency/000000000000000AAA"
            },
            "MetadataComponentId": flow.Id,
            "MetadataComponentName": flow.Definition.DeveloperName,
            "MetadataComponentType": "Flow",
            "RefMetadataComponentName": this.name
          }]);
        });
        self.resultTableCallback();
      }));
    });
    //TODO display results somewhere
  }
  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
    }
    if (this.testCallback) {
      this.testCallback();
    }
  }
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
  recalculateSize() {
    // Investigate if we can use the IntersectionObserver API here instead, once it is available.
    this.tableModel.viewportChange();
  }
}

let h = React.createElement;

class App extends React.Component {
  /*constructor(props) {
    super(props);
  }

  componentDidMount() {
    let {model} = this.props;
  }*/
  componentDidUpdate() {
    let {model} = this.props;
    model.recalculateSize();
  }
  render() {
    let {model} = this.props;
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 3);

    return h("div", {},
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
          )
        ),
      ),
      h("div", {className: "area", id: "result-area"},
        h("div", {className: "area-header"},
        ),
        h("textarea", {className: "result-text", readOnly: true, value: model.error || "", hidden: model.error == null}),
        h(ScrollTable, {model: model.tableModel, hidden: model.error != null})
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
