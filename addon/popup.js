/* global React ReactDOM */
import {sfConn, apiVersion, sessionError} from "./inspector.js";
import {getAllFieldSetupLinks} from "./setup-links.js";
import {setupLinks} from "./links.js";

let h = React.createElement;

let currentBrowser;
if (typeof browser === "undefined") {
  currentBrowser = chrome;
} else {
  currentBrowser = browser;
}

{
  parent.postMessage({
    insextInitRequest: true,
    iFrameLocalStorage: {
      popupArrowOrientation: localStorage.getItem("popupArrowOrientation"),
      popupArrowPosition: JSON.parse(localStorage.getItem("popupArrowPosition")),
      scrollOnFlowBuilder: JSON.parse(localStorage.getItem("scrollOnFlowBuilder"))
    }
  }, "*");
  let parentSelf = parent;
  addEventListener("message", function initResponseHandler(e) {
    if (e.source == parent) {
      if (e.data.insextInitResponse) {
        init(e.data);
        initLinks(e.data);
        let fav = generateFavIcon(e.data);
        parentSelf.postMessage({
          updateIcon: true,
          iFrameLocalStorage: {
            customFavicon: fav,
            customFaviconSF: localStorage.getItem("customFaviconSF")
          }
        }, "*");
      } else if (e.data.updateLocalStorage) {
        localStorage.setItem(e.data.key, e.data.value);
      }
    }
  });
}

function closePopup() {
  parent.postMessage({insextClosePopup: true}, "*");
}

function showApiName(e) {
  parent.postMessage({insextShowApiName: true, btnLabel: e.target.innerText}, "*");
  if (e.target.innerText.startsWith("Show")){
    e.target.innerText = e.target.innerText.replace("Show", "Hide");
  } else {
    e.target.innerText = e.target.innerText.replace("Hide", "Show");
  }
}
function generateFavIcon({sfHost}) {
  let fav = localStorage.getItem(sfHost + "_customFavicon");
  let genCustomIcon = localStorage.getItem("generateCustomFavicon");
  if (!fav && genCustomIcon != "false") {
    let org = sfHost.split(".", 2)[0];
    const letters = "0123456789ABCDEF";
    fav = "#";
    if (org.indexOf("--") >= 0) {
      fav += "8";//sandbox is not red-ish
      for (let i = 1; i < 6; i++) {
        fav += letters[6 + Math.floor(Math.random() * 10)];
      }
    } else {
      fav += "F";//prod is red-ish
      for (let i = 1; i < 6; i++) {
        fav += letters[6 + Math.floor(Math.random() * 10)];
      }
    }
    localStorage.setItem(sfHost + "_customFavicon", fav);
  }
  return fav;
}
function init({sfHost, inDevConsole, inLightning, inInspector}) {
  let addonVersion = chrome.runtime.getManifest().version;

  sfConn.getSession(sfHost).then(() => {
    ReactDOM.render(h(App, {
      sfHost,
      inDevConsole,
      inLightning,
      inInspector,
      addonVersion
    }), document.getElementById("root"));

  });
}

function initLinks({sfHost}){
  //add custom links to setupLink
  if (localStorage.getItem(sfHost + "_orgLinks")){
    let links = JSON.parse(localStorage.getItem(sfHost + "_orgLinks"));
    links.forEach(link => {
      setupLinks.push(link);
    });
  }
}

function toCompositeRequest(queries) {
  let compositeRequest = [];
  for (const q in queries) {
    compositeRequest.push({
      "method": "GET",
      "url": "/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queries[q]),
      "referenceId": q
    });
  }
  return {
    compositeRequest
  };
}

class App extends React.PureComponent {
  constructor(props) {
    super(props);
    let {sfHost} = this.props;
    let hostArg = new URLSearchParams();
    hostArg.set("host", sfHost);
    this.state = {
      isInSetup: false,
      contextUrl: null,
      apiVersionInput: apiVersion,
      isFieldsPresent: false,
      exportHref: "data-export.html?" + hostArg,
      importHref: "data-import.html?" + hostArg,
      apexRunnerHref: "apex-runner.html?" + hostArg,
      streamingHref: "streaming.html?" + hostArg,
      limitsHref: "limits.html?" + hostArg,
      latestNotesViewed: localStorage.getItem("latestReleaseNotesVersionViewed") === this.props.addonVersion,
      buttonTooltip: ""
    };
    this.onContextUrlMessage = this.onContextUrlMessage.bind(this);
    this.onShortcutKey = this.onShortcutKey.bind(this);
    this.onChangeApi = this.onChangeApi.bind(this);
    this.onContextRecordChange = this.onContextRecordChange.bind(this);
    this.updateReleaseNotesViewed = this.updateReleaseNotesViewed.bind(this);
    this.onCloseBanner = this.onCloseBanner.bind(this);
    this.clearOlderFlows = this.clearOlderFlows.bind(this);
  }
  async onContextRecordChange(e) {
    let {sfHost} = this.props;
    let limitsArg = new URLSearchParams();
    let exportArg = new URLSearchParams();
    let importArg = new URLSearchParams();
    exportArg.set("host", sfHost);
    importArg.set("host", sfHost);
    limitsArg.set("host", sfHost);
    if (e.contextSobject && localStorage.getItem("useSObjectContextOnDataImportLink") !== "false") {
      let query = "SELECT Id FROM " + e.contextSobject;
      if (e.contextRecordId && (e.contextRecordId.length == 15 || e.contextRecordId.length == 18)) {
        query += " WHERE Id = '" + e.contextRecordId.replace(/([\\'])/g, "\\$1") + "'";
      }
      if (e.contextSobject == "Report") {
        let report = await sfConn.rest("/services/data/v" + apiVersion + "/analytics/reports/" + e.contextRecordId.replace(/([\\'])/g, "\\$1") + "/describe", {});
        let sobjectName = report.reportTypeMetadata.apiCustomReportTypeDetail.objects.filter(o => o.joinType.toUpperCase() == "ROOT").at(0)?.entityApiName;
        let select = report.reportMetadata.detailColumns.filter(c => c.startsWith(sobjectName + ".")).map(c => c.substring(sobjectName.length + 1)).concat(
          report.reportMetadata.groupingsDown.filter(g => !report.reportMetadata.detailColumns.includes(g.name) && g.name.startsWith(sobjectName + ".")).map(g => g.name.substring(sobjectName.length + 1))
        ).join(", ");
        for (let i = 0; i < report.reportTypeMetadata.apiCustomReportTypeDetail.objects.length; i++) {
          let obj = report.reportTypeMetadata.apiCustomReportTypeDetail.objects[i];
          if (obj.joinType.toUpperCase() == "ROOT") {
            continue;
          }
          let qry = `SELECT Id, QualifiedApiName, RelationshipName, DurableId, EntityDefinitionId, Metadata FROM FieldDefinition WHERE EntityDefinitionId = '${obj.crtObjectName}' and DurableId = '${obj.crtObjectName}.${obj.foreignKeyField}'`;
          let fields = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(qry), {});
          let rel = fields.records[0];
          select += ", (SELECT " + report.reportMetadata.detailColumns.filter(c => c.startsWith(obj.entityApiName + ".")).map(c => c.substring(obj.entityApiName.length + 1)).concat(
            report.reportMetadata.groupingsDown.filter(g => !report.reportMetadata.detailColumns.includes(g.name) && g.name.startsWith(obj.entityApiName + ".")).map(g => g.name.substring(obj.entityApiName.length + 1))).join(", ");
          select += " FROM " + rel.Metadata.relationshipName + (rel.RelationshipName.endsWith("__r") ? "__r" : "");
        }
        select += ")".repeat(report.reportTypeMetadata.apiCustomReportTypeDetail.objects.length - 1);

        // let aggregates = report.reportMetadata.aggregates.map(agg => {
        //   switch (agg) {
        //     case "RowCount":
        //       return "Count(Id)";
        //     // case "Sum":
        //     //   return "SUM(" + agg.column + ")";
        //     // case "Average":
        //     //   return "AVG(" + agg.column + ")";
        //     // case "Maximum":
        //     //   return "MAX(" + agg.column + ")";
        //     // case "Minimum":
        //     //   return "MIN(" + agg.column + ")";
        //     // case "Unique":
        //     //   return "COUNT_DISTINCT(" + agg.column + ")";
        //     // case "Median":
        //     //   return "";//NOT SUPPORTED
        //     // case "Noop":
        //     //   return "";
        //     default:
        //       //TODO agg can be a field id for custom field
        //       if (agg.startsWith("a!")) {
        //         return "AVG(" + agg.substring(2) + ")";
        //       } else if (agg.startsWith("s!")) {
        //         return "SUM(" + agg.substring(2) + ")";
        //       } else if (agg.startsWith("m!")) {
        //         return "MIN(" + agg.substring(2) + ")";
        //       } else if (agg.startsWith("x!")) {
        //         return "MAX(" + agg.substring(2) + ")";
        //       } else if (agg.startsWith("u!")) {
        //         return "COUNT_DISTINCT(" + agg.substring(2) + ")";
        //       }
        //       return "";
        //   }
        // }).filter(agg => agg != "");
        //.concat(aggregates)
        query = "//BETA \nSELECT " + select;
        query += " FROM " + sobjectName;
        let filters = report.reportMetadata.reportFilters.map(f => {
          let q = !isNaN(f.value) && !isNaN(parseFloat(f.value)) ? "" : "'";
          switch (f.operator) {
            case "notEqual":
              return f.column + " != " + q + f.value + q;
            case "equals":
              return f.column + " = " + q + f.value + q;
            case "lessThan":
              return f.column + " < " + f.value;
            case "greaterThan":
              return f.column + " > " + f.value;
            case "lessOrEqual":
              return f.column + " <= " + f.value;
            case "greaterOrEqual":
              return f.column + " >= " + f.value;
            case "contains":
              return f.column + " like '%" + f.value + "%'";
            case "notContain":
              return f.column + "not like '%" + f.value + "%'";
            case "startsWith":
              return f.column + "like '" + f.value + "%'";
            case "includes":
              return f.column + "INCLUDES ('" + f.value + "')";
            case "excludes":
              return f.column + "EXCLUDES ('" + f.value + "')";
            case "within":
              return "DISTANCE(" + f.column + ", GEOLOCATION(37.775,-122.418), 'mi') < " + f.value;
            default:
              return "";
          }
        });
        if (filters?.length) {
          if (!report.reportMetadata.reportBooleanFilter) {
            query += " WHERE (" + filters.join(" AND ") + ")";
          } else {
            query += " WHERE (" + report.reportMetadata.reportBooleanFilter.replace(/[0-9]+/g, m => {
              let i = parseInt(m);
              return filters[i];
            }) + ")";
          }
        }
        if (report.reportMetadata.standardDateFilter) {
          let stdfltr = report.reportMetadata.standardDateFilter;
          if (stdfltr.startDate != null || stdfltr.endDate != null) {
            if (!filters?.length) {
              query += " WHERE ";
            } else {
              query += " AND ";
            }
            if (stdfltr.startDate != null) {
              query += stdfltr.column + " > " + stdfltr.startDate;
            }
            if (stdfltr.endDate != null) {
              if (stdfltr.startDate != null) {
                query += " AND ";
              }
              query += stdfltr.column + " < " + stdfltr.endDate;
            }
          }
        }
        query = query.replace(/__c\./g, "__r.");
        /*
        let groupBy = [];
        let sortBy = [];
        if (report.reportMetadata.groupingsAcross) {
          groupBy = report.reportMetadata.groupingsAcross;
        }
        if (report.reportMetadata.groupingsDown) {
          groupBy.push(...(report.reportMetadata.groupingsDown));
        }
        sortBy = groupBy.flatMap(g => g.sortOrder ? [g.name + " " + g.sortOrder] : []);
        groupBy = groupBy.flatMap(g => {
          switch (g.dateGranularity) {
            case "Month":
              return ["CALENDAR_YEAR(" + g.name + ")", "CALENDAR_MONTH(" + g.name + ")"];
            case "Day":
              return "DAY_ONLY(" + g.name + ")";
            case "Week":
              return ["CALENDAR_YEAR(" + g.name + ")", "WEEK_IN_YEAR(" + g.name + ")"];
            case "Quarter":
              return ["CALENDAR_YEAR(" + g.name + ")", "CALENDAR_QUARTER(" + g.name + ")"];
            case "Year":
              return "CALENDAR_YEAR(" + g.name + ")";
            case "FiscalQuarter":
              return ["FISCAL_YEAR(" + g.name + ")", "FISCAL_QUARTER(" + g.name + ")"];
            case "FiscalYear":
              return "FISCAL_YEAR(" + g.name + ")";
            case "MonthInYear":
              return "CALENDAR_MONTH(" + g.name + ")";
            case "DayInMonth":
              return "DAY_IN_MONTH(" + g.name + ")";
            case "FiscalPeriod":
              return "FISCAL_QUARTER(" + g.name + ")";
            case "FiscalWeek":
              return "WEEK_IN_YEAR(" + g.name + ")";
            default:
              return g.name;
          }
        });
        if (groupBy?.length) {
          query += " GROUP BY " + groupBy.join(", ");
        }
        if (sortBy?.length) {
          query += " ORDER BY " + sortBy.join(", ");
        }
          */
      }
      exportArg.set("query", query);
      importArg.set("sobject", e.contextSobject);
    }
    this.setState({
      exportHref: "data-export.html?" + exportArg,
      importHref: "data-import.html?" + importArg,
      apexRunnerHref: "apex-runner.html?" + limitsArg,
      streamingHref: "streaming.html?" + limitsArg,
      limitsHref: "limits.html?" + limitsArg
    });
  }
  onMouseMove(event) {
    parent.postMessage({mouseX: event.clientX, mouseY: event.clientY}, "*");
  }
  endResizeMove(evt) {
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.endResizeMove);
    if (!evt.skipMessage) {
      parent.postMessage({trackMouseMove: false}, "*");
    }
  }
  onContextUrlMessage(e) {
    if (e.source == parent && e.data.insextUpdateRecordId) {
      let {locationHref} = e.data;
      this.setState({
        isInSetup: locationHref.includes("/lightning/setup/"),
        contextUrl: locationHref
      });
    } else if (e.data.clearOlderFlows) {
      this.clearOlderFlows(JSON.parse(e.data.clearOlderFlows));
      return;
    } else if (e.data.showFlowVersionDetails) {
      this.showFlowVersionDetails(JSON.parse(e.data.showFlowVersionDetails));
      return;
    } else if (e.data.whereFlowIsUsed) {
      this.whereFlowIsUsed(JSON.parse(e.data.whereFlowIsUsed));
    } else if (e.data.trackMouseMove != undefined) {
      if (e.data.trackMouseMove) {
        window.addEventListener("mousemove", this.onMouseMove);
        window.addEventListener("mouseup", this.endResizeMove);
      } else {
        this.endResizeMove({skipMessage: true});
      }
    } else if (e.data.showInvalidTokenBanner) {
      //TODO use model to store if displayed or not.
      const containerToShow = document.getElementById("invalidTokenBanner");
      if (containerToShow) { containerToShow.classList.remove("hide"); }
      const containerToMask = document.getElementById("mainTabs");
      if (containerToMask) { containerToMask.classList.add("mask"); }
      return;
    }
    this.setState({
      isFieldsPresent: e.data.isFieldsPresent
    });
  }

  async showFlowVersionDetails({contextUrl}) {
    let flowId = this.getFlowId(contextUrl);
    if (!flowId) {
      return;
    }
    sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=SELECT+DefinitionId+FROM+Flow+WHERE+Id='" + flowId.replace(/([\\'])/g, "\\$1") + "'", {method: "GET"}).then(res => {
      res.records.forEach(recentItem => {
        let flowDefinitionId = recentItem.DefinitionId;
        window.open("https://" + this.props.sfHost + "/lightning/setup/Flows/page?address=%2F" + flowDefinitionId, "_blank");
      });
    });
  }
  async whereFlowIsUsed({contextUrl}) {
    let flowId = this.getFlowId(contextUrl);
    const browser = navigator.userAgent.includes("Chrome") ? "chrome" : "moz";
    sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=SELECT+Definition.DeveloperName+FROM+Flow+WHERE+Id='" + flowId + "'", {method: "GET"}).then(res => {
      res.records.forEach(async recentItem => {
        let flowName = recentItem.Definition.DeveloperName;
        window.open(browser + "-extension://" + chrome.i18n.getMessage("@@extension_id") + `/dependency.html?name=${flowName}&host=${this.props.sfHost}`, "_blank");
      });
    });
  }

  async clearOlderFlows({contextUrl}) {
    let keep = parseInt(localStorage.getItem("clearOlderFlowsKeep") || "5");
    let {sfHost} = this.props;
    if (!contextUrl || !keep) {
      return;
    }
    try {
      let recordId = this.getFlowId(contextUrl);
      if (!recordId) {
        return;
      }
      const flowSelect = "SELECT FlowDefinitionViewId, FlowDefinitionView.VersionNumber FROM FlowVersionView where DurableId = '" + recordId.replace(/([\\'])/g, "\\$1") + "'";
      const flowResults = await sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + flowSelect);
      let flowDefinitionViewId;
      let keepLatestVersionNumber;
      flowResults.records.forEach(rec => {
        flowDefinitionViewId = rec.FlowDefinitionViewId;
        keepLatestVersionNumber = rec.FlowDefinitionView.VersionNumber - keep;
      });
      if (!flowDefinitionViewId || !keepLatestVersionNumber) {
        return;
      }
      const flowToDeleteQuery = "SELECT Id, DurableId FROM FlowVersionView where FlowDefinitionViewId = '" + flowDefinitionViewId + "' and VersionNumber  <= " + keepLatestVersionNumber;
      const flowToDeleteResults = await sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + flowToDeleteQuery);
      let flowToDelete = "\"Id\"";
      if (flowToDeleteResults.records.length === 0) {
        console.log("No old versions to delete");
        return;
      }
      flowToDeleteResults.records.forEach(rec => {
        flowToDelete += "\r\n\"" + rec.DurableId + "\"";
      });
      let encodedData = window.btoa(flowToDelete);

      let args = new URLSearchParams();
      args.set("host", sfHost);
      args.set("data", encodedData);
      args.set("sobject", "Flow");
      args.set("apitype", "Tooling");

      window.open("data-import.html?" + args, "_blank");
    } catch (err) {
      console.error("Unable to clean old flow", err);
      return;
    }
  }

  getFlowId(contextUrl) {
    let url = new URL(contextUrl);
    let searchParams = new URLSearchParams(url.search.substring(1));
    return searchParams.get("flowId");
  }

  updateReleaseNotesViewed(version) {
    localStorage.setItem("latestReleaseNotesVersionViewed", version);
    this.setState({
      latestNotesViewed: true
    });
  }
  onShortcutKey(e) {
    const refs = this.refs;
    const actionMap = {
      "Escape": ["closePopup", ""],
      "m": ["all", "clickShowDetailsBtn"],
      "a": ["all", "clickAllDataBtn"],
      "f": ["all", "clickShowFieldAPINameBtn"],
      "n": ["all", "clickNewBtn"],
      "e": ["click", "dataExportBtn"],
      "i": ["click", "dataImportBtn"],
      "l": ["click", "limitsBtn"],
      "d": ["click", "metaRetrieveBtn"],
      "x": ["click", "apiExploreBtn"],
      "h": ["click", "homeBtn"],
      "p": ["click", "optionsBtn"],
      "o": ["tab", "objectTab"],
      "u": ["tab", "userTab"],
      "s": ["tab", "shortcutTab"],
      "t": ["click", "streamingBtn"],
      "r": ["tab", "orgTab"],
      "g": ["click", "apexRunnerBtn"]
    };//zyqgjkwvbc

    if (!actionMap[e.key]) {
      return;
    }
    e.preventDefault();
    const [action, target] = actionMap[e.key];
    switch (action) {
      case "closePopup":
        closePopup();
        return;
      case "all":
        refs.showAllDataBox.refs?.showAllDataBoxSObject?.[target]();
        break;
      case "click":
        if (refs[target]) {
          refs[target].target = getLinkTarget(e);
          refs[target].click();
        }
        break;
      case "tab":
        refs.showAllDataBox.refs[target].click();
        break;
    }
  }
  onChangeApi(e) {
    localStorage.setItem("apiVersion", e.target.value + ".0");
    this.setState({apiVersionInput: e.target.value});
  }
  componentDidMount() {
    let {sfHost} = this.props;
    addEventListener("message", this.onContextUrlMessage);
    addEventListener("keydown", this.onShortcutKey);
    parent.postMessage({insextLoaded: true}, "*");
    this.setOrgInfo(sfHost);
  }
  componentWillUnmount() {
    removeEventListener("message", this.onContextUrlMessage);
    removeEventListener("keydown", this.onShortcutKey);
  }
  setOrgInfo(sfHost) {
    let orgInfo = JSON.parse(sessionStorage.getItem(sfHost + "_orgInfo"));
    if (orgInfo == null) {
      sfConn.rest("/services/data/v" + apiVersion + "/query/?q=SELECT+Id,InstanceName,OrganizationType,TimeZoneSidKey+FROM+Organization").then(res => {
        orgInfo = res.records[0];
        sessionStorage.setItem(sfHost + "_orgInfo", JSON.stringify(orgInfo));
      });
    }
  }
  getBannerUrlAction(sessionError, sfHost, clientId, browser) {
    let url;
    let title;
    let text;
    text = "Access Token Expired";
    title = "Generate New Token";
    url = `https://${sfHost}/services/oauth2/authorize?response_type=token&client_id=${clientId}&redirect_uri=${browser}-extension://${chrome.i18n.getMessage("@@extension_id")}/data-export.html`;
    return {title, url, text};
  }
  setButtonTooltip(tooltip) {
    this.setState({buttonTooltip: tooltip});
  }
  onCloseBanner() {
    const containerToShow = document.getElementById("invalidTokenBanner");
    if (containerToShow) { containerToShow.classList.add("hide"); }
    const containerToMask = document.getElementById("mainTabs");
    if (containerToMask) { containerToMask.classList.remove("mask"); }
  }
  render() {
    let {
      sfHost,
      inDevConsole,
      inLightning,
      inInspector,
      addonVersion
    } = this.props;
    let {isInSetup, contextUrl, apiVersionInput, exportHref, importHref, apexRunnerHref, streamingHref, limitsHref, isFieldsPresent, latestNotesViewed, buttonTooltip} = this.state;
    let hostArg = new URLSearchParams();
    hostArg.set("host", sfHost);
    let linkInNewTab = JSON.parse(localStorage.getItem("openLinksInNewTab"));
    let linkTarget = inDevConsole || linkInNewTab ? "_blank" : "_top";
    const browser = navigator.userAgent.includes("Chrome") ? "chrome" : "moz";
    const DEFAULT_CLIENT_ID = "3MVG9HoFrxrSzmIzsEn1Y0w8shcr6uZL9YRkAcJtN.02pSvyKYiR3gIunrDTp1ku8uVGCuXUGUZxCJQkTP5rg"; //Consumer Key of  default connected app
    const clientId = localStorage.getItem(sfHost + "_clientId") ? localStorage.getItem(sfHost + "_clientId") : DEFAULT_CLIENT_ID;
    const bannerUrlAction = this.getBannerUrlAction(sessionError, sfHost, clientId, browser);
    return (
      h("div", {},
        h("div", {className: "slds-page-header slds-theme_shade popup-header"},
          h("div", {className: "slds-page-header__row"},
            h("div", {className: "slds-page-header__col-title"},
              h("div", {className: "slds-media"},
                h("div", {className: "slds-media__figure popup-media__figure"},
                  h("span", {className: "popup-icon_container", title: "Salesforce Inspector Advanced"},
                    h("svg", {className: "slds-icon popup-header__icon", viewBox: "0 0 24 24"},
                      h("path", {
                        d: `
                        M11 9c-.5 0-1-.5-1-1s.5-1 1-1 1 .5 1 1-.5 1-1 1z
                        m1 5.8c0 .2-.1.3-.3.3h-1.4c-.2 0-.3-.1-.3-.3v-4.6c0-.2.1-.3.3-.3h1.4c.2.0.3.1.3.3z
                        M11 3.8c-4 0-7.2 3.2-7.2 7.2s3.2 7.2 7.2 7.2s7.2-3.2 7.2-7.2s-3.2-7.2-7.2-7.2z
                        m0 12.5c-2.9 0-5.3-2.4-5.3-5.3s2.4-5.3 5.3-5.3s5.3 2.4 5.3 5.3-2.4 5.3-5.3 5.3z
                        M 17.6 15.9c-.2-.2-.3-.2-.5 0l-1.4 1.4c-.2.2-.2.3 0 .5l4 4c.2.2.3.2.5 0l1.4-1.4c.2-.2.2-.3 0-.5z
                        `,
                        fill: "#061c3f"
                      })
                    )
                  )
                ),
                h("div", {className: "slds-media__body"},
                  h("div", {className: "popup-header__name-title"},
                    h("h1", {},
                      h("span", {className: "popup-header__title popup-title slds-truncate", title: "Salesforce Inspector Advanced"}, "Salesforce Inspector Advanced")
                    )
                  )
                )
              )
            )
          )
        ),

        !latestNotesViewed && h(AlertBanner, {type: "base",
          bannerText: `Current Version: ${addonVersion}`,
          iconName: "notification",
          iconTitle: "Notification",
          assistiveTest: "Version Update Notification",
          onClose: () => this.updateReleaseNotesViewed(addonVersion),
          link: {
            text: "See What's New",
            props: {
              href: "https://dufoli.github.io/Salesforce-Inspector-Advanced/release-note/#version-" + addonVersion.replace(".", ""),
              target: "_blank",
              onClick: () => this.updateReleaseNotesViewed(addonVersion)
            }
          }
        }),
        h("div", {id: "invalidTokenBanner", className: "hide"},
          h("button", {className: "slds-button slds-button_icon slds-button_icon-small", title: "Close", onClick: this.onCloseBanner},
            h("svg", {className: "slds-button__icon", viewBox: "0 0 52 52"},
              h("use", {xlinkHref: "symbols.svg#close"})
            ),
            h("span", {className: "slds-assistive-text"}, "Close"),
          ),
          h(AlertBanner, {type: "warning",
            bannerText: "Login back to Salesforce if",
            iconName: "warning",
            iconTitle: "Warning",
            assistiveTest: "Login back to Salesforce if",
            onClose: null,
            link: {
              text: sfHost,
              props: {
                href: `https://${sfHost}`,
                target: "_blank"
              }
            }
          }),
          h(AlertBanner, {type: "warning",
            bannerText: bannerUrlAction.text,
            iconName: "warning",
            iconTitle: "Warning",
            assistiveTest: bannerUrlAction.text,
            onClose: null,
            link: {
              text: bannerUrlAction.title,
              props: {
                href: bannerUrlAction.url,
                target: "_blank"
              }
            }
          }),
          h(AlertBanner, {type: "warning",
            bannerText: "If it fail, navigate to Setup | Connected Apps OAuth Usage, and click \"Install\" on the Salesforce Inspector Advanced app.",
            iconName: "warning",
            iconTitle: "Warning",
            assistiveTest: "If not yet done, install connected App.",
            onClose: null,
            link: {
              text: "Install connected App",
              props: {
                href: `https://${sfHost}/lightning/setup/ConnectedAppsUsage/home`,
                target: "_blank"
              }
            }
          })
        ),
        h("div", {className: "main", id: "mainTabs"},
          h(AllDataBox, {ref: "showAllDataBox", sfHost, showDetailsSupported: !inLightning && !inInspector, linkTarget, contextUrl, onContextRecordChange: this.onContextRecordChange, isFieldsPresent}),
          h("div", {className: "slds-p-vertical_x-small slds-p-horizontal_x-small slds-border_bottom"},
            h("a",
              {
                ref: "dataExportBtn",
                href: exportHref,
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large",
                title: "Data Export",
                onMouseEnter: () => { this.setButtonTooltip("Data Export - Shortcut [e]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); }
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#download", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Data Export"),
            ),
            h("a",
              {
                ref: "dataImportBtn",
                href: importHref,
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large",
                title: "Data Import",
                onMouseEnter: () => { this.setButtonTooltip("Data Import - Shortcut [i]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); }
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#upload", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Data Import"),
            ),
            h("a",
              {
                ref: "apexRunnerBtn",
                href: apexRunnerHref,
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large",
                title: "Run Apex Code",
                onMouseEnter: () => { this.setButtonTooltip("Run Apex Code - Shortcut [g]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); }
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#apex", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Run Apex Code"),
            ),
            h("a",
              {
                ref: "streamingBtn",
                href: streamingHref,
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large",
                title: "Manage Streaming",
                onMouseEnter: () => { this.setButtonTooltip("Manage Streaming - Shortcut [t]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); }
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#broadcast", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Manage Streaming"),
            ),
            h("a",
              {
                ref: "limitsBtn",
                href: limitsHref,
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large",
                title: "Limits",
                onMouseEnter: () => { this.setButtonTooltip("Limits - Shortcut [l]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); }
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#metrics", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Limits"),
            ),
            h("a",
              {
                ref: "a",
                href: "metadata-retrieve.html?" + hostArg,
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large",
                title: "Download Metadata",
                onMouseEnter: () => { this.setButtonTooltip("Download Metadata - Shortcut [d]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); }
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#package", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Download Metadata"),
            ),
            h("a",
              {
                ref: "apiExploreBtn",
                href: "explore-api.html?" + hostArg,
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large",
                title: "Explore API",
                onMouseEnter: () => { this.setButtonTooltip("Explore API - Shortcut [x]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); }
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#description", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Explore API"),
            ),
            // Workaround for in Lightning the link to Setup always opens a new tab, and the link back cannot open a new tab.
            inLightning && isInSetup && h("a",
              {
                ref: "homeBtn",
                href: `https://${sfHost}/lightning/page/home`,
                title: "Salesforce Home",
                onMouseEnter: () => { this.setButtonTooltip("Salesforce Home - Shortcut [h]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); },
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large"
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#home", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Salesforce Home")),
            inLightning && !isInSetup && h("a",
              {
                ref: "homeBtn",
                href: `https://${sfHost}/lightning/setup/SetupOneHome/home?setupApp=all`,
                title: "Setup Home",
                onMouseEnter: () => { this.setButtonTooltip("Setup Home - Shortcut [h]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); },
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large"
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#fallback", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Setup Home")
            ),
            h("a",
              {
                ref: "optionsBtn",
                href: "options.html?" + hostArg,
                title: "Options",
                onMouseEnter: () => { this.setButtonTooltip("Options - Shortcut [p]"); },
                onMouseLeave: () => { this.setButtonTooltip(""); },
                target: linkTarget,
                className: "slds-button slds-button_icon slds-button_icon-border-filled slds-button_icon-large"
              },
              h("svg", {className: "slds-button__icon_large"}, h("use", {xlinkHref: "symbols.svg#settings", style: {fill: "#706E6B"}})),
              h("span", {className: "slds-assistive-text"}, "Options"),
            ),
          ),
          h("span", {role: "tooltip"}, h("strong", {}, buttonTooltip)),
        ),
        h("div", {className: "slds-grid slds-theme_shade slds-p-around_x-small slds-border_top"},
          h("div", {className: "slds-col slds-size_5-of-12 footer-small-text slds-m-top_xx-small"},
            h("a", {href: "https://dufoli.github.io/Salesforce-Inspector-Advanced/release-note/#version-" + addonVersion.replace(".", ""), title: "Release note", target: linkTarget}, "v" + addonVersion),
            h("span", {}, " / "),
            h("input", {
              className: "api-input",
              type: "number",
              title: "Update api version",
              onChange: this.onChangeApi,
              value: apiVersionInput.split(".0")[0]
            })
          ),
          h("div", {className: "slds-col slds-size_4-of-12 slds-text-align_left"},
            h("span", {className: "footer-small-text"}, (navigator.userAgentData && navigator.userAgentData.platform.toLowerCase().indexOf("mac") > -1) ? "[ctrl+option+i]" : "[ctrl+alt+i]" + " to open")
          ),
          h("div", {className: "slds-col slds-size_2-of-12 slds-text-align_right slds-icon_container slds-m-right_small", title: "Documentation"},
            h("a", {href: "https://dufoli.github.io/Salesforce-Inspector-Advanced/", target: linkTarget},
              h("svg", {className: "slds-button slds-icon_x-small slds-icon-text-default slds-m-top_xxx-small", viewBox: "0 0 52 52"},
                h("use", {xlinkHref: "symbols.svg#info_alt", style: {fill: "#9c9c9c"}})
              )
            )
          ),
          h("div", {id: "optionsBtn", className: "slds-col slds-size_1-of-12 slds-text-align_right slds-icon_container slds-m-right_small", title: "Options"},
            h("a", {ref: "optionsBtn", href: "options.html?" + hostArg, target: linkTarget},
              h("svg", {className: "slds-button slds-icon_x-small slds-icon-text-default slds-m-top_xxx-small", viewBox: "0 0 52 52"},
                h("use", {xlinkHref: "symbols.svg#settings", style: {fill: "#9c9c9c"}})
              )
            )
          ),
        )
      )
    );
  }
}

class AllDataBox extends React.PureComponent {

  constructor(props) {
    super(props);
    this.SearchAspectTypes = Object.freeze({sobject: "sobject", users: "users", shortcuts: "shortcuts", org: "org"}); //Enum. Supported aspects

    this.state = {
      activeSearchAspect: this.SearchAspectTypes.sobject,
      sobjectsList: null,
      sobjectsLoading: true,
      usersBoxLoading: false,
      contextRecordId: null,
      contextUserId: null,
      contextOrgId: null,
      contextPath: null,
      contextFilterName: null,
      contextSobject: null
    };
    this.onAspectClick = this.onAspectClick.bind(this);
    this.parseContextUrl = this.ensureKnownBrowserContext.bind(this);
  }

  componentDidMount() {
    this.ensureKnownBrowserContext();
    this.loadSobjects();
  }

  componentDidUpdate(prevProps, prevState) {
    let {activeSearchAspect} = this.state;
    if (prevProps.contextUrl !== this.props.contextUrl) {
      this.ensureKnownBrowserContext();
    }
    if (prevState.activeSearchAspect !== activeSearchAspect) {
      switch (activeSearchAspect) {
        case this.SearchAspectTypes.sobject:
          this.ensureKnownBrowserContext();
          break;
        case this.SearchAspectTypes.users:
          this.ensureKnownUserContext();
          break;
        case this.SearchAspectTypes.shortcuts:
          this.ensureKnownBrowserContext();
          break;
        case this.SearchAspectTypes.org:
          this.ensureKnownBrowserContext();
          break;
      }
    }
  }

  ensureKnownBrowserContext() {
    let {contextUrl, onContextRecordChange} = this.props;
    if (contextUrl) {
      let recordId = getRecordId(contextUrl);
      let path = getSfPathFromUrl(contextUrl);
      let filterName = path.endsWith("/list") ? getSfFilterNameFromUrl(contextUrl) : "";
      let sobject = getSobject(contextUrl);
      let context = {
        contextRecordId: recordId,
        contextPath: path,
        contextSobject: sobject,
        contextFilterName: filterName
      };
      this.setState(context);
      onContextRecordChange(context);
    }
  }

  setIsLoading(aspect, value) {
    switch (aspect) {
      case "usersBox": this.setState({usersBoxLoading: value});
        break;
    }
  }

  isLoading() {
    let {usersBoxLoading, sobjectsLoading} = this.state;
    return sobjectsLoading || usersBoxLoading;
  }

  async ensureKnownUserContext() {
    let {contextUserId, contextOrgId} = this.state;

    if (!contextUserId || !contextOrgId) {
      try {
        const userInfo = await sfConn.rest("/services/oauth2/userinfo");
        let contextUserId = userInfo.user_id;
        let contextOrgId = userInfo.organization_id;
        this.setState({contextUserId, contextOrgId});
      } catch (err) {
        console.error("Unable to query user context", err);
      }
    }
  }

  onAspectClick(e) {
    this.setState({
      activeSearchAspect: e.currentTarget.dataset.aspect
    });
  }

  loadSobjects() {
    let entityMap = new Map();

    function addEntity(sobj, api) {
      let {name, label, keyPrefix, durableId, isCustomSetting, recordTypesSupported, isEverCreatable, newUrl, createable, customSetting} = sobj;
      label = label || ""; // Avoid null exceptions if the object does not have a label (some don't). All objects have a name. Not needed for keyPrefix since we only do equality comparisons on those.
      let entity = entityMap.get(name);
      if (entity) {
        if (!entity.label) { // Doesn't seem to be needed, but if we have to do it for keyPrefix, we can just as well do it for label.
          entity.label = label;
        }
        if (!entity.keyPrefix) { // For some objects the keyPrefix is only available in some of the APIs.
          entity.keyPrefix = keyPrefix;
        }
        if (!entity.durableId) {
          entity.durableId = durableId;
        }
        if (entity.isEverCreatable == undefined) {
          entity.isEverCreatable = isEverCreatable || createable;
        }
        if (!entity.newUrl) {
          entity.newUrl = newUrl;
        }
        if (entity.recordTypesSupported == undefined) {
          entity.recordTypesSupported = recordTypesSupported;
        }
        if (entity.isCustomSetting == undefined) {
          entity.isCustomSetting = isCustomSetting || customSetting;
        }
      } else {
        entity = {
          availableApis: [],
          name,
          label,
          keyPrefix,
          durableId,
          isCustomSetting,
          availableKeyPrefix: null,
          recordTypesSupported,
          isEverCreatable,
          newUrl
        };
        entityMap.set(name, entity);
      }
      if (api) {
        entity.availableApis.push(api);
        if (keyPrefix) {
          entity.availableKeyPrefix = keyPrefix;
        }
      }
    }

    function getObjects(url, api) {
      return sfConn.rest(url).then(describe => {
        for (let sobject of describe.sobjects) {
          addEntity(sobject, api);
        }
      }).catch(err => {
        console.error("list " + api + " sobjects", err);
      });
    }

    function getEntityDefinitions(){
      return sfConn.rest("/services/data/v" + apiVersion + "/tooling/query?q=" + encodeURIComponent("SELECT COUNT() FROM EntityDefinition"))
        .then(res => {
          let entityNb = res.totalSize;
          for (let bucket = 0; bucket < Math.ceil(entityNb / 2000); bucket++) {
            let offset = bucket > 0 ? " OFFSET " + (bucket * 2000) : "";
            let query = "SELECT QualifiedApiName, Label, KeyPrefix, DurableId, IsCustomSetting, RecordTypesSupported, NewUrl, IsEverCreatable FROM EntityDefinition ORDER BY QualifiedApiName ASC LIMIT 2000" + offset;
            sfConn.rest("/services/data/v" + apiVersion + "/tooling/query?q=" + encodeURIComponent(query))
              .then(respEntity => {
                for (let record of respEntity.records) {
                  addEntity({
                    name: record.QualifiedApiName,
                    label: record.Label,
                    keyPrefix: record.KeyPrefix,
                    durableId: record.DurableId,
                    isCustomSetting: record.IsCustomSetting,
                    recordTypesSupported: record.RecordTypesSupported,
                    newUrl: record.NewUrl,
                    isEverCreatable: record.IsEverCreatable
                  }, null);
                }
              }).catch(err => {
                console.error("list entity definitions: ", err);
              });
          }
        }).catch(err => {
          console.error("count entity definitions: ", err);
        });
    }

    Promise.all([
      // Get objects the user can access from the regular API
      getObjects("/services/data/v" + apiVersion + "/sobjects/", "regularApi"),
      // Get objects the user can access from the tooling API
      getObjects("/services/data/v" + apiVersion + "/tooling/sobjects/", "toolingApi"),
      // Get all objects, even the ones the user cannot access from any API
      // These records are less interesting than the ones the user has access to, but still interesting since we can get information about them using the tooling API
      // If there are too many records, we get "EXCEEDED_ID_LIMIT: EntityDefinition does not support queryMore(), use LIMIT to restrict the results to a single batch"
      // Even if documentation mention that LIMIT and OFFSET are not supported, we use it to split the EntityDefinition queries into 2000 buckets
      getEntityDefinitions(),
    ])
      .then(() => {
        // TODO progressively display data as each of the three responses becomes available
        this.setState({
          sobjectsLoading: false,
          sobjectsList: Array.from(entityMap.values())
        });
        this.refs.showAllDataBoxSObject.refs.allDataSearch.getMatchesDelayed("");
      })
      .catch(e => {
        console.error(e);
        this.setState({sobjectsLoading: false});
      });
  }

  render() {
    let {activeSearchAspect, sobjectsLoading, contextRecordId, contextSobject, contextUserId, contextOrgId, contextPath, sobjectsList, contextFilterName} = this.state;
    let {sfHost, showDetailsSupported, linkTarget, onContextRecordChange, isFieldsPresent} = this.props;

    return (
      h("div", {className: "slds-p-top_small slds-p-horizontal_x-small slds-p-bottom_x-small slds-border_bottom" + (this.isLoading() ? " loading " : "")},
        h("ul", {className: "small-tabs"},
          h("li", {ref: "objectTab", onClick: this.onAspectClick, "data-aspect": this.SearchAspectTypes.sobject, className: (activeSearchAspect == this.SearchAspectTypes.sobject) ? "active" : ""}, h("span", {}, h("u", {}, "O"), "bjects")),
          h("li", {ref: "userTab", onClick: this.onAspectClick, "data-aspect": this.SearchAspectTypes.users, className: (activeSearchAspect == this.SearchAspectTypes.users) ? "active" : ""}, h("span", {}, h("u", {}, "U"), "sers")),
          h("li", {ref: "shortcutTab", onClick: this.onAspectClick, "data-aspect": this.SearchAspectTypes.shortcuts, className: (activeSearchAspect == this.SearchAspectTypes.shortcuts) ? "active" : ""}, h("span", {}, h("u", {}, "S"), "hortcuts")),
          h("li", {ref: "orgTab", onClick: this.onAspectClick, "data-aspect": this.SearchAspectTypes.org, className: (activeSearchAspect == this.SearchAspectTypes.org) ? "active" : ""}, h("span", {}, "O", h("u", {}, "r"), "g"))
        ),
        (activeSearchAspect == this.SearchAspectTypes.sobject)
          ? h(AllDataBoxSObject, {ref: "showAllDataBoxSObject", sfHost, showDetailsSupported, sobjectsList, sobjectsLoading, contextRecordId, contextSobject, linkTarget, onContextRecordChange, isFieldsPresent, contextFilterName})
          : (activeSearchAspect == this.SearchAspectTypes.users)
            ? h(AllDataBoxUsers, {ref: "showAllDataBoxUsers", sfHost, linkTarget, contextUserId, contextOrgId, contextPath, setIsLoading: (value) => { this.setIsLoading("usersBox", value); }}, "Users")
            : (activeSearchAspect == this.SearchAspectTypes.shortcuts)
              ? h(AllDataBoxShortcut, {ref: "showAllDataBoxShortcuts", sfHost, linkTarget, contextUserId, contextOrgId, contextPath, setIsLoading: (value) => { this.setIsLoading("shortcutsBox", value); }}, "Users")
              : (activeSearchAspect == this.SearchAspectTypes.org)
                ? h(AllDataBoxOrg, {ref: "showAllDataBoxOrg", sfHost, linkTarget, contextUserId, contextOrgId, contextPath, setIsLoading: (value) => { this.setIsLoading("orgBox", value); }}, "Users")
                : "AllData aspect " + activeSearchAspect + " not implemented"
      )
    );
  }
}

class AllDataBoxUsers extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      selectedUser: null,
      selectedUserId: null,
    };
    this.getMatches = this.getMatches.bind(this);
    this.onDataSelect = this.onDataSelect.bind(this);
  }

  componentDidMount() {
    let {contextUserId} = this.props;
    this.onDataSelect({Id: contextUserId});
    this.refs.allDataSearch.refs.showAllDataInp.focus();
  }

  componentDidUpdate(prevProps) {
    if (prevProps.contextUserId !== this.props.contextUserId) {
      this.onDataSelect({Id: this.props.contextUserId});
    }
  }

  async getMatches(userQuery) {
    let {setIsLoading} = this.props;
    if (!userQuery) {
      return [];
    }

    //TODO: Better search query. SOSL?
    const fullQuerySelect = "select Id, Name, Email, Username, UserRole.Name, Alias, LocaleSidKey, LanguageLocaleKey, IsActive, ProfileId, Profile.Name";
    const minimalQuerySelect = "select Id, Name, Email, Username, UserRole.Name, Alias, LocaleSidKey, LanguageLocaleKey, IsActive";
    const queryFrom = "from User where (username like '%" + userQuery.replace(/([%_\\'])/g, "\\$1") + "%' or name like '%" + userQuery.replace(/([%_\\'])/g, "\\$1") + "%') order by IsActive DESC, LastLoginDate limit 100";
    const compositeQuery = toCompositeRequest({fullData: fullQuerySelect + " " + queryFrom, minimalData: minimalQuerySelect + " " + queryFrom});

    try {
      setIsLoading(true);
      const userSearchResult = await sfConn.rest("/services/data/v" + apiVersion + "/composite", {method: "POST", body: compositeQuery});
      let users = userSearchResult.compositeResponse.find((elm) => elm.httpStatusCode == 200).body.records;
      return users;
    } catch (err) {
      console.error("Unable to query user details with: " + JSON.stringify(compositeQuery) + ".", err);
      return [];
    } finally {
      setIsLoading(false);
    }

  }

  async onDataSelect(userRecord) {
    if (userRecord && userRecord.Id) {
      await this.setState({selectedUserId: userRecord.Id, selectedUser: null});
      await this.querySelectedUserDetails();
    }
  }

  async querySelectedUserDetails() {
    let {selectedUserId} = this.state;
    let {setIsLoading} = this.props;

    if (!selectedUserId) {
      return;
    }
    //Optimistically attempt broad query (fullQuery) and fall back to minimalQuery to ensure some data is returned in most cases (e.g. profile cannot be queried by community users)
    const fullQuerySelect = "SELECT Id, Name, Email, Username, UserRole.Name, Alias, LocaleSidKey, LanguageLocaleKey, IsActive, FederationIdentifier, ProfileId, Profile.Name, ContactId, IsPortalEnabled, UserPreferencesUserDebugModePref";
    //TODO implement a try catch to remove non existing fields ProfileId or IsPortalEnabled (experience is not enabled)
    const mediumQuerySelect = "SELECT Id, Name, Email, Username, UserRole.Name, Alias, LocaleSidKey, LanguageLocaleKey, IsActive, FederationIdentifier, ProfileId, Profile.Name, ContactId, UserPreferencesUserDebugModePref";
    const minimalQuerySelect = "SELECT Id, Name, Email, Username, UserRole.Name, Alias, LocaleSidKey, LanguageLocaleKey, IsActive, FederationIdentifier, ContactId, UserPreferencesUserDebugModePref";
    const queryFrom = "FROM User WHERE Id='" + selectedUserId + "' LIMIT 1";
    const compositeQuery = toCompositeRequest({fullData: fullQuerySelect + " " + queryFrom, mediumData: mediumQuerySelect + " " + queryFrom, minimalData: minimalQuerySelect + " " + queryFrom});

    try {
      setIsLoading(true);
      //const userResult = await sfConn.rest("/services/data/v" + apiVersion + "/sobjects/User/" + selectedUserId); //Does not return profile details. Query call is therefore prefered
      const userResult = await sfConn.rest("/services/data/v" + apiVersion + "/composite", {method: "POST", body: compositeQuery});
      let userDetail = userResult.compositeResponse.find((elm) => elm.httpStatusCode == 200).body.records[0];
      //query NetworkMember only if it is a portal user (display "Login to Experience" button)
      if (userDetail.IsPortalEnabled){
        await sfConn.rest("/services/data/v" + apiVersion + "/query/?q=SELECT+NetworkId+FROM+NetworkMember+WHERE+MemberId='" + userDetail.Id + "'").then(res => {
          if (res.records && res.records.length > 0){
            userDetail.NetworkId = res.records[0].NetworkId;
          }
        });
      }
      await this.setState({selectedUser: userDetail});
    } catch (err) {
      console.error("Unable to query user details with: " + JSON.stringify(compositeQuery) + ".", err);
    } finally {
      setIsLoading(false);
    }
  }

  resultRender(matches, userQuery) {
    return matches.map(value => ({
      key: value.Id,
      value,
      element: [
        h("div", {className: "autocomplete-item-main", key: "main"},
          h(MarkSubstring, {
            text: value.Name + " (" + value.Alias + ")",
            start: value.Name.toLowerCase().indexOf(userQuery.toLowerCase()),
            length: userQuery.length
          })),
        h("div", {className: "autocomplete-item-sub small", key: "sub"},
          h("div", {}, (value.Profile) ? value.Profile.Name : ""),
          h(MarkSubstring, {
            text: (!value.IsActive) ? "⚠ " + value.Username : value.Username,
            start: value.Username.toLowerCase().indexOf(userQuery.toLowerCase()),
            length: userQuery.length
          }))
      ]
    }));
  }

  render() {
    let {selectedUser} = this.state;
    let {sfHost, linkTarget, contextOrgId, contextUserId, contextPath} = this.props;

    return (
      h("div", {ref: "usersBox", className: "users-box"},
        h(AllDataSearch, {ref: "allDataSearch", getMatches: this.getMatches, onDataSelect: this.onDataSelect, inputSearchDelay: 400, placeholderText: "Username, email, alias or name of user", resultRender: this.resultRender}),
        h("div", {className: "all-data-box-inner" + (!selectedUser ? " empty" : "")},
          selectedUser
            ? h(UserDetails, {user: selectedUser, sfHost, contextOrgId, currentUserId: contextUserId, linkTarget, contextPath})
            : h("div", {className: "center"}, "No user details available")
        ))
    );
  }
}

class AllDataBoxSObject extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      selectedValue: null,
      recordIdDetails: null
    };
    this.onDataSelect = this.onDataSelect.bind(this);
    this.getMatches = this.getMatches.bind(this);
  }

  componentDidMount() {
    let {contextRecordId, contextSobject} = this.props;
    this.updateSelection(contextRecordId, contextSobject);
  }

  componentDidUpdate(prevProps) {
    let {contextRecordId, sobjectsLoading, contextSobject} = this.props;
    if (prevProps.contextRecordId !== contextRecordId) {
      this.updateSelection(contextRecordId, contextSobject);
    }
    if (prevProps.sobjectsLoading !== sobjectsLoading && !sobjectsLoading) {
      this.updateSelection(contextRecordId, contextSobject);
    }
  }

  async updateSelection(query, contextSobject) {
    let match;
    if (query === "list"){
      match = this.getBestMatch(contextSobject);
    } else {
      match = this.getBestMatch(query);
    }

    await this.setState({selectedValue: match});
    this.loadRecordIdDetails();
  }

  loadRecordIdDetails() {
    let {selectedValue} = this.state;
    //If a recordId is selected and the object supports regularApi
    if (selectedValue && selectedValue.recordId && selectedValue.sobject && selectedValue.sobject.availableApis && selectedValue.sobject.availableApis.includes("regularApi")) {
      let fields = ["Id", "LastModifiedBy.Alias", "CreatedBy.Alias", "CreatedDate", "LastModifiedDate", "Name"];
      if (selectedValue.sobject.recordTypesSupported){
        fields.push("RecordType.DeveloperName", "RecordType.Id");
      }
      this.restCallForRecordDetails(fields, selectedValue);
    } else {
      this.setState({recordIdDetails: null});
    }
  }

  getRecordNameField(recordIdDetails) {
    if (recordIdDetails == null) {
      return null;
    }
    if ("name" in recordIdDetails) {
      return "name";
    }

    if (recordIdDetails.attributes && recordIdDetails.attributes.type) {
      for (let name of [recordIdDetails.attributes.type + "Number", "Subject", "Title"]) {
        if (recordIdDetails[name]) {
          return name;
        }
      }
    }

    for (let field in recordIdDetails) {
      if (field.endsWith("Name")) {
        return field;
      }
    }
    return null;
  }

  restCallForRecordDetails(fields, selectedValue){
    let query = "SELECT " + fields.join() + " FROM " + selectedValue.sobject.name + " where id='" + selectedValue.recordId + "'";
    sfConn.rest("/services/data/v" + apiVersion + "/query?q=" + encodeURIComponent(query), {logErrors: false}).then(res => {
      for (let record of res.records) {
        let lastModifiedDate = new Date(record.LastModifiedDate);
        let createdDate = new Date(record.CreatedDate);
        let nameField = this.getRecordNameField(record);
        this.setState({
          recordIdDetails: {
            "recordTypeId": (record.RecordType) ? record.RecordType.Id : "",
            "recordName": (record.Name) ? record.Name : (record[nameField] ? record[nameField] : ""),
            "recordTypeName": (record.RecordType) ? record.RecordType.DeveloperName : "",
            "createdBy": record.CreatedBy.Alias,
            "lastModifiedBy": record.LastModifiedBy.Alias,
            "created": createdDate.toLocaleDateString() + " " + createdDate.toLocaleTimeString(),
            "lastModified": lastModifiedDate.toLocaleDateString() + " " + lastModifiedDate.toLocaleTimeString(),
          }
        });
      }
    }).catch(e => {
      //some fields (Name, RecordTypeId) are not available for particular objects, in this case remove it from the fields list
      if (e.message.includes("No such column ")){
        this.restCallForRecordDetails(["FIELDS(STANDARD)", "LastModifiedBy.Alias", "CreatedBy.Alias"], selectedValue);
      } else if (e.message.includes("Didn't understand relationship 'RecordType'")){
        this.restCallForRecordDetails(fields.filter(field => !field.startsWith("RecordType.")), selectedValue);
      } else {
        throw e;
      }
    });
  }

  getBestMatch(query) {
    let {sobjectsList} = this.props;
    // Find the best match based on the record id or object name from the page URL.
    if (!query) {
      return null;
    }
    if (!sobjectsList) {
      return null;
    }
    let sobject = sobjectsList.find(sobject => sobject.name.toLowerCase() == query.toLowerCase());
    let queryKeyPrefix = query.substring(0, 3);
    if (!sobject) {
      sobject = sobjectsList.find(sobject => sobject.availableKeyPrefix == queryKeyPrefix);
    }
    if (!sobject) {
      sobject = sobjectsList.find(sobject => sobject.keyPrefix == queryKeyPrefix);
    }
    if (!sobject) {
      return null;
    }
    let recordId = null;
    if (sobject.keyPrefix == queryKeyPrefix && query.match(/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/)) {
      recordId = query;
    }
    return {recordId, sobject};
  }

  getMatches(query) {
    let {sobjectsList, contextRecordId} = this.props;

    if (!sobjectsList) {
      return [];
    }
    let queryKeyPrefix = query.substring(0, 3);
    let res = sobjectsList
      .filter(sobject => sobject.name.toLowerCase().includes(query.toLowerCase()) || sobject.label.toLowerCase().includes(query.toLowerCase()) || sobject.keyPrefix == queryKeyPrefix)
      .map(sobject => ({
        recordId: null,
        sobject,
        // TO-DO: merge with the sortRank function in data-export
        relevance:
          (sobject.keyPrefix == queryKeyPrefix ? 2
          : sobject.name.toLowerCase() == query.toLowerCase() ? 3
          : sobject.label.toLowerCase() == query.toLowerCase() ? 4
          : sobject.name.toLowerCase().startsWith(query.toLowerCase()) ? 5
          : sobject.label.toLowerCase().startsWith(query.toLowerCase()) ? 6
          : sobject.name.toLowerCase().includes("__" + query.toLowerCase()) ? 7
          : sobject.name.toLowerCase().includes("_" + query.toLowerCase()) ? 8
          : sobject.label.toLowerCase().includes(" " + query.toLowerCase()) ? 9
          : 10) + (sobject.availableApis.length == 0 ? 20 : 0)
      }));
    query = query || contextRecordId || "";
    queryKeyPrefix = query.substring(0, 3);
    if (query.match(/^([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/)) {
      let objectsForId = sobjectsList.filter(sobject => sobject.keyPrefix == queryKeyPrefix);
      for (let sobject of objectsForId) {
        res.unshift({recordId: query, sobject, relevance: 1});
      }
    }
    res.sort((a, b) => a.relevance - b.relevance || a.sobject.name.localeCompare(b.sobject.name));
    return res;
  }

  onDataSelect(value) {
    let {onContextRecordChange} = this.props;
    this.setState({selectedValue: value}, () => {
      this.loadRecordIdDetails();
      if (value) {
        onContextRecordChange({contextSobject: value.sobject.name, contextRecordId: value.recordId});
      }
    });
  }

  clickShowDetailsBtn() {
    if (this.refs.allDataSelection) {
      this.refs.allDataSelection.clickShowDetailsBtn();
    }
  }

  clickAllDataBtn() {
    if (this.refs.allDataSelection) {
      this.refs.allDataSelection.clickAllDataBtn();
    }
  }

  clickShowFieldAPINameBtn() {
    if (this.refs.allDataSelection) {
      this.refs.allDataSelection.clickShowFieldAPINameBtn();
    }
  }
  clickNewBtn() {
    if (this.refs.allDataSelection) {
      this.refs.allDataSelection.clickNewBtn();
    }
  }

  resultRender(matches, userQuery) {
    return matches.map(value => ({
      key: value.recordId + "#" + value.sobject.name,
      value,
      element: [
        h("div", {className: "autocomplete-item-main", key: "main"},
          value.recordId || h(MarkSubstring, {
            text: value.sobject.name,
            start: value.sobject.name.toLowerCase().indexOf(userQuery.toLowerCase()),
            length: userQuery.length
          }),
          value.sobject.availableApis.length == 0 ? " (Not readable)" : ""
        ),
        h("div", {className: "autocomplete-item-sub", key: "sub"},
          h(MarkSubstring, {
            text: value.sobject.keyPrefix || "---",
            start: value.sobject.keyPrefix == userQuery.substring(0, 3) ? 0 : -1,
            length: 3
          }),
          " • ",
          h(MarkSubstring, {
            text: value.sobject.label,
            start: value.sobject.label.toLowerCase().indexOf(userQuery.toLowerCase()),
            length: userQuery.length
          })
        )
      ]
    }));
  }

  render() {
    let {sfHost, showDetailsSupported, sobjectsList, linkTarget, contextRecordId, isFieldsPresent, contextSobject, contextFilterName} = this.props;
    let {selectedValue, recordIdDetails} = this.state;
    return (
      h("div", {},
        h(AllDataSearch, {ref: "allDataSearch", sfHost, onDataSelect: this.onDataSelect, sobjectsList, getMatches: this.getMatches, inputSearchDelay: 0, placeholderText: "Record id, id prefix or object name", title: "Click to show recent items", resultRender: this.resultRender}),
        selectedValue
          ? h(AllDataSelection, {ref: "allDataSelection", sfHost, showDetailsSupported, selectedValue, linkTarget, recordIdDetails, contextRecordId, isFieldsPresent, contextFilterName, contextSobject})
          : h("div", {className: "all-data-box-inner empty"}, "No record to display")
      )
    );
  }
}

class AllDataBoxShortcut extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      selectedUser: null,
      selectedUserId: null,
    };
    this.getMatches = this.getMatches.bind(this);
    this.onDataSelect = this.onDataSelect.bind(this);
  }

  componentDidMount() {
    this.refs.allDataSearch.refs.showAllDataInp.focus();
  }

  async getMatches(shortcutSearch) {
    let {setIsLoading} = this.props;
    if (!shortcutSearch) {
      return [];
    }
    try {
      setIsLoading(true);

      //search for shortcuts
      let result = setupLinks.filter(item => item.label.toLowerCase().includes(shortcutSearch.toLowerCase()));
      result.forEach(element => {
        element.detail = element.section;
        element.name = element.link;
        element.Id = element.name;
      });

      let metadataShortcutSearch = localStorage.getItem("metadataShortcutSearch");
      if (metadataShortcutSearch == null) {
        metadataShortcutSearch = true;
        //enable metadata search by default
        localStorage.setItem("metadataShortcutSearch", metadataShortcutSearch);
      }

      //search for metadata if user did not disabled it
      if (metadataShortcutSearch == "true"){
        const flowSelect = "SELECT LatestVersionId, ApiName, Label, ProcessType FROM FlowDefinitionView WHERE Label LIKE '%" + shortcutSearch.replace(/([%_\\'])/g, "\\$1") + "%' LIMIT 30";
        const profileSelect = "SELECT Id, Name, UserLicense.Name FROM Profile WHERE Name LIKE '%" + shortcutSearch.replace(/([%_\\'])/g, "\\$1") + "%' LIMIT 30";
        const permSetSelect = "SELECT Id, Name, Label, Type, LicenseId, License.Name, PermissionSetGroupId FROM PermissionSet WHERE Label LIKE '%" + shortcutSearch.replace(/([%_\\'])/g, "\\$1") + "%' LIMIT 30";
        const networkSelect = "SELECT Id, Name, Status, UrlPathPrefix FROM Network WHERE Name LIKE '%" + shortcutSearch.replace(/([%_\\'])/g, "\\$1") + "%' LIMIT 30";
        const apexSelect = "SELECT Id, Name, NamespacePrefix, Status FROM ApexClass WHERE Name LIKE '%" + shortcutSearch.replace(/([%_\\'])/g, "\\$1") + "%' LIMIT 30";
        const compositeQuery = toCompositeRequest({flowSelect, profileSelect, permSetSelect, networkSelect, apexSelect});

        const searchResult = await sfConn.rest("/services/data/v" + apiVersion + "/composite", {method: "POST", body: compositeQuery});
        let results = searchResult.compositeResponse.filter((elm) => elm.httpStatusCode == 200 && elm.body.records.length > 0);

        let enablePermSetSummary = localStorage.getItem("enablePermSetSummary") === "true";

        results.forEach(element => {
          element.body.records.forEach(rec => {
            if (rec.attributes.type === "FlowDefinitionView"){
              rec.link = "/builder_platform_interaction/flowBuilder.app?flowId=" + rec.LatestVersionId;
              rec.label = rec.Label;
              rec.name = rec.ApiName;
              rec.detail = rec.attributes.type + " • " + rec.ProcessType;
            } else if (rec.attributes.type === "Profile"){
              rec.link = "/lightning/setup/EnhancedProfiles/page?address=%2F" + rec.Id;
              rec.label = rec.Name;
              rec.name = rec.Id;
              rec.detail = rec.attributes.type + " • " + rec.UserLicense.Name;
            } else if (rec.attributes.type === "PermissionSet"){
              rec.label = rec.Label;
              rec.name = rec.Name;
              rec.detail = rec.attributes.type + " • " + rec.Type;
              rec.detail += rec.License?.Name != null ? " • " + rec.License?.Name : "";

              let psetOrGroupId;
              let type;
              if (rec.Type === "Group"){
                psetOrGroupId = rec.PermissionSetGroupId;
                type = "PermSetGroups";
              } else {
                psetOrGroupId = rec.Id;
                type = "PermSets";
              }
              let endLink = enablePermSetSummary ? psetOrGroupId + "/summary" : "page?address=%2F" + psetOrGroupId;
              rec.link = "/lightning/setup/" + type + "/" + endLink;
            } else if (rec.attributes.type === "Network"){
              rec.link = `/sfsites/picasso/core/config/commeditor.jsp?servlet/networks/switch?networkId=${rec.Id}`;
              rec.label = rec.Name;
              let url = rec.UrlPathPrefix ?? "/";
              rec.name = rec.Id + (url.startsWith("/") ? url : url);
              rec.detail = rec.attributes.type + " (" + rec.Status + ")";
            } else if (rec.attributes.type === "ApexClass"){ // ApiVersion, Status
              rec.link = "/lightning/setup/ApexClasses/page?address=%2F" + rec.Id;
              rec.label = rec.Name;
              rec.name = rec.NamespacePrefix ? rec.NamespacePrefix + "__" + rec.Name : rec.Name;
              rec.detail = rec.attributes.type + " • (" + rec.Status + ")";
            }
            result.push(rec);
          });
        });
      }
      return result ? result : [];
    } catch (err) {
      console.error("Unable to find shortcut", err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }

  async onDataSelect(shortcut) {
    let {sfHost} = this.props;
    let link = shortcut.isExternal ? shortcut.link : "https://" + sfHost + shortcut.link;
    window.open(link);
  }

  resultRender(matches, shortcutQuery) {
    return matches.map(value => ({
      key: value.Id,
      value,
      element: [
        h("div", {className: "autocomplete-item-main", key: "main"},
          h(MarkSubstring, {
            text: value.label,
            start: value.label.toLowerCase().indexOf(shortcutQuery.toLowerCase()),
            length: shortcutQuery.length
          })),
        h("div", {className: "autocomplete-item-sub small", key: "sub"},
          h("div", {}, value.detail),
          h(MarkSubstring, {
            text: value.name,
            start: value.name.toLowerCase().indexOf(shortcutQuery.toLowerCase()),
            length: shortcutQuery.length
          }))
      ]
    }));
  }

  render() {
    let {selectedUser} = this.state;
    let {sfHost, linkTarget, contextOrgId, contextUserId, contextPath} = this.props;

    return (
      h("div", {ref: "shortcutsBox", className: "users-box"},
        h(AllDataSearch, {ref: "allDataSearch", getMatches: this.getMatches, onDataSelect: this.onDataSelect, inputSearchDelay: 200, placeholderText: "Quick find links, shortcuts", resultRender: this.resultRender}),
        h("div", {className: "all-data-box-inner" + (!selectedUser ? " empty" : "")},
          selectedUser
            ? h(UserDetails, {user: selectedUser, sfHost, contextOrgId, currentUserId: contextUserId, linkTarget, contextPath})
            : h("div", {className: "center"}, "No shortcut found")
        ))
    );
  }
}

/** ORG Tab Component */
class AllDataBoxOrg extends React.PureComponent {

  constructor(props) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    let {sfHost} = this.props;
    let orgInfo = JSON.parse(sessionStorage.getItem(sfHost + "_orgInfo"));
    this.setInstanceStatus(orgInfo.InstanceName, sfHost);
  }

  contextOrgId(){
    return this.props.contextOrgId;
  }

  getNextMajorRelease(maintenances){
    if (maintenances){
      let event = maintenances.find(event => event.name.endsWith("Major Release"));
      return event.name.replace(" Major Release", "") + " on " + new Date(event.plannedStartTime).toDateString();
    }
    return null;
  }

  getApiVersion(instanceStatus){
    if (instanceStatus){
      let apiVersion = (instanceStatus.releaseNumber.substring(0, 3) / 2) - 64;
      return apiVersion;
    }
    return null;
  }

  setInstanceStatus(instanceName, sfHost){
    let instanceStatusLocal = JSON.parse(sessionStorage.getItem(sfHost + "_instanceStatus"));
    if (instanceStatusLocal == null){
      fetch(`https://api.status.salesforce.com/v1/instances/${instanceName}/status`).then(response => {
        response.json().then(result => {
          //manually filter to get only the future releases (based on today's date) and sort maintenance since list in not ordered by default
          result.Maintenances = result.Maintenances.filter(dt => dt.plannedEndTime >= new Date().toISOString()).sort((a, b) => (a.plannedStartTime > b.plannedStartTime) ? 1 : ((b.plannedStartTime > a.plannedStartTime) ? -1 : 0));
          this.setState({instanceStatus: result});
          sessionStorage.setItem(sfHost + "_instanceStatus", JSON.stringify(result));
        });
      }).catch((e) => {
        console.error(e);
      });
    } else {
      this.setState({instanceStatus: instanceStatusLocal});
    }
  }

  render() {
    let {linkTarget, sfHost} = this.props;
    let orgInfo = JSON.parse(sessionStorage.getItem(sfHost + "_orgInfo"));
    return (
      h("div", {ref: "orgBox", className: "users-box"},
        h("div", {className: "all-data-box-inner"},
          h("div", {className: "all-data-box-data"},
            h("table", {},
              h("tbody", {},
                h("tr", {},
                  h("th", {}, h("a", {href: "https://" + sfHost + "/lightning/setup/CompanyProfileInfo/home", title: "Company Information", target: linkTarget}, "Org Id:")),
                  h("td", {}, orgInfo.Id.substring(0, 15))
                ),
                h("tr", {},
                  h("th", {}, h("a", {href: "https://status.salesforce.com/instances/" + orgInfo.InstanceName, title: "Instance status", target: linkTarget}, "Instance:")),
                  h("td", {}, orgInfo.InstanceName)
                ),
                h("tr", {},
                  h("th", {}, "Type:"),
                  h("td", {}, orgInfo.OrganizationType)
                ),
                h("tr", {},
                  h("th", {}, "Status:"),
                  h("td", {}, this.state.instanceStatus?.status)
                ),
                h("tr", {},
                  h("th", {}, "Release:"),
                  h("td", {}, this.state.instanceStatus?.releaseVersion ? (this.state.instanceStatus.releaseVersion + " / " + this.state.instanceStatus?.releaseNumber) : "")
                ),
                h("tr", {},
                  h("th", {}, "Location:"),
                  h("td", {}, this.state.instanceStatus?.location)
                ),
                h("tr", {},
                  h("th", {}, "API version:"),
                  h("td", {}, this.getApiVersion(this.state.instanceStatus))
                ),
                h("tr", {},
                  h("th", {}, h("a", {href: "https://status.salesforce.com/instances/" + orgInfo.InstanceName + "/maintenances", title: "Maintenance List", target: linkTarget}, "Maintenance:")),
                  h("td", {}, this.getNextMajorRelease(this.state.instanceStatus?.Maintenances))
                ),
              )))))
    );
  }
}

class UserDetails extends React.PureComponent {
  constructor(props) {
    super(props);
    this.sfHost = props.sfHost;
    this.enableDebugLog = this.enableDebugLog.bind(this);
    this.clickLoginIncognito = this.clickLoginIncognito.bind(this);
    this.clickResetPassword = this.clickResetPassword.bind(this);
    this.toggleDebugAura = this.toggleDebugAura.bind(this);
  }
  async toggleDebugAura() {
    let {user} = this.props;
    try {
      await sfConn.rest("/services/data/v" + apiVersion + "/sobjects/User/" + user.Id, {method: "PATCH", body: {UserPreferencesUserDebugModePref: !user.UserPreferencesUserDebugModePref}});
      currentBrowser.runtime.sendMessage({message: "refresh"});
    } catch (e) {
      console.log("Failed to enable debug mode for Lightning component.", e);
    }
  }
  async enableDebugLog() {

    let {user} = this.props;
    const DTnow = new Date(Date.now());

    //Enable debug level and expiration time (minutes) as default parameters.
    let debugLogDebugLevel = localStorage.getItem(this.sfHost + "_debugLogDebugLevel");
    if (debugLogDebugLevel == null) {
      localStorage.setItem(this.sfHost + "_debugLogDebugLevel", "SFDC_DevConsole");
    }

    let debugLogTimeMinutes = localStorage.getItem("debugLogTimeMinutes");
    if (debugLogTimeMinutes == null) {
      localStorage.setItem("debugLogTimeMinutes", 15);
    }
    let debugTimeInMs = this.getDebugTimeInMs(debugLogTimeMinutes);

    let traceFlags = await this.getTraceFlags(user.Id, DTnow, debugLogDebugLevel, debugTimeInMs);
    /*If an old trace flag is found on the user and with this debug level
     *Update the trace flag extending the experiation date.
     */
    if (traceFlags.size > 0){
      this.extendTraceFlag(traceFlags.records[0].Id, DTnow, debugTimeInMs);
    //Else create new trace flag
    } else {
      let debugLog = await this.getDebugLog(debugLogDebugLevel);

      if (debugLog && debugLog.size > 0){
        this.insertTraceFlag(user.Id, debugLog.records[0].Id, DTnow, debugTimeInMs);
      } else {
        throw new Error('Debug Level with developerName = "' + debugLogDebugLevel + '" not found');
      }
    }
    //Disable button after executing.
    const element = document.querySelector("#enableDebugLog");
    element.setAttribute("disabled", true);
    element.text = "Logs Enabled";
  }

  getTraceFlags(userId, DTnow, debugLogDebugLevel, debugTimeInMs){
    try {
      const expirationDate = new Date(DTnow.getTime() + debugTimeInMs);
      let query = "query/?q=+SELECT+Id,ExpirationDate+FROM+TraceFlag+"
                  + "WHERE+TracedEntityid='" + userId + "'+"
                  + "AND+DebugLevel.DeveloperName='" + debugLogDebugLevel + "'+"
                  + "AND+StartDate<" + DTnow.toISOString() + "+"
                  + "AND+ExpirationDate<" + expirationDate.toISOString();
      return sfConn.rest("/services/data/v" + apiVersion + "/tooling/" + query, {method: "GET"});
    } catch (e){
      console.error(e);
      return null;
    }
  }

  getDebugLog(debugLogDebugLevel){
    try {
      let query = "query/?q=+SELECT+Id+FROM+DebugLevel+"
                    + "WHERE+DeveloperName='" + debugLogDebugLevel + "'";
      return sfConn.rest("/services/data/v" + apiVersion + "/tooling/" + query, {method: "GET"});
    } catch (e){
      console.error(e);
      return null;
    }
  }

  insertTraceFlag(userId, debugLogId, DTnow, debugTimeInMs){
    try {
      let newTraceFlag
          = {
            TracedEntityId: userId,
            DebugLevelId: debugLogId,
            LogType: "USER_DEBUG",
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

  getDebugTimeInMs(debugLogTimeMinutes){
    return debugLogTimeMinutes * 60 * 1000;
  }

  doSupportLoginAs(user) {
    let {currentUserId} = this.props;
    //Optimistically show login unless it's logged in user's userid or user is inactive.
    //No API to determine if user is allowed to login as given user. See https://salesforce.stackexchange.com/questions/224342/query-can-i-login-as-for-users
    if (!user || user.Id == currentUserId || !user.IsActive) {
      return false;
    }
    return true;
  }

  canLoginAsPortal(user){
    return user.IsActive && user.NetworkId;
  }

  getLoginAsLink(userId) {
    let {sfHost, contextOrgId, contextPath} = this.props;
    const retUrl = contextPath || "/";
    const targetUrl = contextPath || "/";
    return "https://" + sfHost + "/servlet/servlet.su" + "?oid=" + encodeURIComponent(contextOrgId) + "&suorgadminid=" + encodeURIComponent(userId) + "&retURL=" + encodeURIComponent(retUrl) + "&targetURL=" + encodeURIComponent(targetUrl);
  }

  getLoginAsPortalLink(user){
    let {sfHost, contextOrgId, contextPath} = this.props;
    const retUrl = contextPath || "/";
    return "https://" + sfHost + "/servlet/servlet.su" + "?oid=" + encodeURIComponent(contextOrgId) + "&retURL=" + encodeURIComponent(retUrl) + "&sunetworkid=" + encodeURIComponent(user.NetworkId) + "&sunetworkuserid=" + encodeURIComponent(user.Id);
  }

  getUserDetailLink(userId) {
    let {sfHost} = this.props;
    return "https://" + sfHost + "/lightning/setup/ManageUsers/page?address=%2F" + userId + "%3Fnoredirect%3D1";
  }

  getUserPsetLink(userId) {
    let {sfHost} = this.props;
    return "https://" + sfHost + "/lightning/setup/PermSets/page?address=%2Fudd%2FPermissionSet%2FassignPermissionSet.apexp%3FuserId%3D" + userId;
  }

  getUserPsetGroupLink(userId) {
    let {sfHost} = this.props;
    return "https://" + sfHost + "/lightning/setup/PermSetGroups/page?address=%2Fudd%2FPermissionSetGroup%2FassignPermissionSet.apexp%3FuserId%3D" + userId + "%26isPermsetGroup%3D1";
  }

  getProfileLink(profileId) {
    let {sfHost} = this.props;
    return "https://" + sfHost + "/lightning/setup/EnhancedProfiles/page?address=%2F" + profileId;
  }

  getShowAllDataLink(userId) {
    let {sfHost} = this.props;
    let args = new URLSearchParams();
    args.set("host", sfHost);
    args.set("objectType", "User");
    args.set("recordId", userId);
    return "inspect.html?" + args;
  }
  clickLoginIncognito() {
    let {sfHost, user} = this.props;
    const url = "https://" + sfHost + "/secur/frontdoor.jsp?sid=" + sfConn.sessionId + "&retURL=" + encodeURIComponent(this.getLoginAsLink(user.Id));
    currentBrowser.runtime.sendMessage({message: "incognito", url});
  }
  clickResetPassword() {
    if (confirm("Reset password for this user?") == true) {
      sfConn.rest("/services/data/v" + apiVersion + "/sobjects/User/" + this.props.user.Id + "/password", {method: "DELETE"}).catch(err => {
        console.error(err);
      });
    }
  }

  render() {
    let {user, linkTarget} = this.props;
    let debugAuraLabel = user.UserPreferencesUserDebugModePref ? "Disable" : "Enable";
    return (
      h("div", {className: "all-data-box-inner"},
        h("div", {className: "all-data-box-data slds-m-bottom_xx-small"},
          h("table", {className: (user.IsActive) ? "" : "inactive"},
            h("tbody", {},
              h("tr", {},
                h("th", {}, "Name:"),
                h("td", {},
                  (user.IsActive) ? "" : h("span", {title: "User is inactive"}, "⚠ "),
                  user.Name + " (" + user.Alias + ")"
                )
              ),
              h("tr", {},
                h("th", {}, "Username:"),
                h("td", {className: "oneliner"}, user.Username)
              ),
              h("tr", {},
                h("th", {}, "Id:"),
                h("td", {className: "oneliner"},
                  h("a", {href: this.getShowAllDataLink(user.Id), target: linkTarget, title: "Show all data"}, user.Id))
              ),
              h("tr", {},
                h("th", {}, "E-mail:"),
                h("td", {className: "oneliner"}, user.Email)
              ),
              h("tr", {},
                h("th", {}, "Profile:"),
                h("td", {className: "oneliner"},
                  (user.Profile)
                    ? h("a", {href: this.getProfileLink(user.ProfileId), target: linkTarget}, user.Profile.Name)
                    : h("em", {className: "inactive"}, "unknown")
                )
              ),
              h("tr", {},
                h("th", {}, "Role:"),
                h("td", {className: "oneliner"}, (user.UserRole) ? user.UserRole.Name : "")
              ),
              h("tr", {},
                h("th", {}, "Language:"),
                h("td", {},
                  h("div", {className: "flag flag-" + sfLocaleKeyToCountryCode(user.LanguageLocaleKey), title: "Language: " + user.LanguageLocaleKey}),
                  " | ",
                  h("div", {className: "flag flag-" + sfLocaleKeyToCountryCode(user.LocaleSidKey), title: "Locale: " + user.LocaleSidKey})
                )
              )
            )
          )),
        h("div", {ref: "userButtons", className: "user-buttons center small-font"},
          h("a", {href: this.getUserDetailLink(user.Id), target: linkTarget, className: "slds-button slds-button_neutral"}, "Details"), //identity
          h("a", {href: this.getUserPsetLink(user.Id), target: linkTarget, className: "slds-button slds-button_neutral", title: "Show / assign user's permission sets"}, "PSet"), //block_visitor or key or privately_shared or reset_password or unlock or user_role
          h("a", {href: this.getUserPsetGroupLink(user.Id), target: linkTarget, className: "slds-button slds-button_neutral", title: "Show / assign user's permission set groups"}, "PSetG"), //buyer_group_qualifier or groups
          h("a", {href: "#", id: "enableDebugLog", disabled: false, onClick: this.enableDebugLog, className: "slds-button slds-button_neutral", title: "Enable user debug log"}, "Enable Logs"), //bug
          h("a", {href: "#", id: "toggleDebugAura", disabled: false, onClick: this.toggleDebugAura, className: "slds-button slds-button_neutral", title: debugAuraLabel + " Aura (LC) debug Mode"}, debugAuraLabel + " LC debug mode")//bug
        ),
        h("div", {ref: "userButtons", className: "user-buttons center small-font top-space"},
          this.doSupportLoginAs(user) ? h("a", {href: this.getLoginAsLink(user.Id), target: linkTarget, className: "slds-button slds-button_neutral"}, "Try login as") : null, //integration or meet_focus_presenter or trailblazer_ext
          this.canLoginAsPortal(user) ? h("a", {href: this.getLoginAsPortalLink(user), target: linkTarget, className: "slds-button slds-button_neutral"}, "Login to Experience") : null, //internal_share or people
          this.doSupportLoginAs(user) ? h("a", {onClick: this.clickLoginIncognito, target: linkTarget, className: "slds-button slds-button_neutral"}, "Login as Incognito") : null, // meet_focus_equal or new_window
          user?.IsActive ? h("a", {onClick: this.clickResetPassword, target: linkTarget, className: "slds-button slds-button_neutral"}, "Reset Password") : null,
        )
      )
    );
  }
}


class ShowDetailsButton extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      detailsLoading: false,
      detailsShown: false,
    };
    this.onDetailsClick = this.onDetailsClick.bind(this);
  }
  canShowDetails() {
    let {showDetailsSupported, selectedValue, contextRecordId} = this.props;
    return showDetailsSupported && contextRecordId && selectedValue.sobject.keyPrefix == contextRecordId.substring(0, 3) && selectedValue.sobject.availableApis.length > 0;
  }
  onDetailsClick() {
    let {sfHost, selectedValue} = this.props;
    let {detailsShown} = this.state;
    if (detailsShown || !this.canShowDetails()) {
      return;
    }
    let tooling = !selectedValue.sobject.availableApis.includes("regularApi");
    let url = "/services/data/v" + apiVersion + "/" + (tooling ? "tooling/" : "") + "sobjects/" + selectedValue.sobject.name + "/describe/";
    this.setState({detailsShown: true, detailsLoading: true});
    Promise.all([
      sfConn.rest(url),
      getAllFieldSetupLinks(sfHost, selectedValue.sobject.name)
    ]).then(([res, insextAllFieldSetupLinks]) => {
      this.setState({detailsShown: true, detailsLoading: false});
      parent.postMessage({insextShowStdPageDetails: true, insextData: res, insextAllFieldSetupLinks}, "*");
      closePopup();
    }).catch(error => {
      this.setState({detailsShown: false, detailsLoading: false});
      console.error(error);
      alert(error);
    });
  }
  render() {
    let {detailsLoading, detailsShown} = this.state;
    return (
      h("div", {},
        h("a",
          {
            id: "showStdPageDetailsBtn",
            className: "button" + (detailsLoading ? " loading" : "" + " page-button slds-button slds-button_neutral slds-m-bottom_xx-small"),
            disabled: detailsShown,
            onClick: this.onDetailsClick,
            style: {display: !this.canShowDetails() ? "none" : ""}
          },
          h("span", {}, "Show field ", h("u", {}, "m"), "etadata")
        )
      )
    );
  }
}


class AllDataSelection extends React.PureComponent {
  constructor(props) {
    super(props);
    this.exportListView = this.exportListView.bind(this);
  }
  clickShowDetailsBtn() {
    this.refs.showDetailsBtn.onDetailsClick();
  }
  clickAllDataBtn() {
    this.refs.showAllDataBtn.click();
  }
  clickShowFieldAPINameBtn(){
    if (this.refs.showFieldApiNameBtn){
      this.refs.showFieldApiNameBtn.click();
    }
  }
  clickNewBtn(){
    if (this.refs.showNewBtn){
      this.refs.showNewBtn.click();
    }
  }
  exportListView(){
    let separator = ",";
    if (localStorage.getItem("csvSeparator")) {
      separator = localStorage.getItem("csvSeparator");
    }
    let filterName = this.props.contextFilterName;
    if (this.props.contextFilterName == "__Recent") {
      filterName = "RecentlyViewed" + this.props.contextSobject + "s";
    }
    let query = `/query/?q=+SELECT+Id+FROM+ListView+WHERE+DeveloperName='${filterName}'`;
    return sfConn.rest("/services/data/v" + apiVersion + query, {method: "GET"}).then(lv => {
      sfConn.rest("/services/data/v" + apiVersion + "/sobjects/" + this.props.contextSobject + "/listviews/" + lv.records[0].Id + "/results", {method: "GET"}).then(res => {
        let header = res.columns.map(col => col.fieldNameOrPath);
        let csv = header.map(h => `"${h}"`).join(separator) + "\r\n";
        csv += res.records.map(record => record.columns.map(c => `"${c?.value == null ? "" : "" + c?.value}"`).join(separator)).join("\r\n");
        let downloadLink = document.createElement("a");
        const date = new Date();
        const timestamp = date.toISOString().replace(/[^0-9]/g, "");
        downloadLink.download = `export${timestamp}.csv`;
        let BOM = "\uFEFF";
        let bb = new Blob([BOM, csv], {type: "text/csv;charset=utf-8"});
        downloadLink.href = window.URL.createObjectURL(bb);
        downloadLink.click();
      });
    });
  }
  getAllDataUrl(toolingApi) {
    let {sfHost, selectedValue} = this.props;
    if (selectedValue) {
      let args = new URLSearchParams();
      args.set("host", sfHost);
      args.set("objectType", selectedValue.sobject.name);
      if (toolingApi) {
        args.set("useToolingApi", "1");
      }
      if (selectedValue.recordId) {
        args.set("recordId", selectedValue.recordId);
      }
      return "inspect.html?" + args;
    } else {
      return undefined;
    }
  }
  getDeployStatusUrl() {
    let {sfHost, selectedValue} = this.props;
    let args = new URLSearchParams();
    args.set("host", sfHost);
    args.set("checkDeployStatus", selectedValue.recordId);
    return "explore-api.html?" + args;
  }
  /**
   * Optimistically generate lightning setup uri for the provided object api name.
   */
  getObjectSetupLink(sobjectName, durableId, isCustomSetting) {
    if (sobjectName.endsWith("__mdt")) {
      return this.getCustomMetadataLink(durableId);
    } else if (sobjectName.endsWith("__e")) {
      return "https://" + this.props.sfHost + "/lightning/setup/EventObjects/page?address=%2F" + durableId + "%3Fsetupid%3DEventObjects";
    } else if (isCustomSetting) {
      return "https://" + this.props.sfHost + "/lightning/setup/CustomSettings/page?address=%2F" + durableId + "?setupid=CustomSettings";
    } else if (sobjectName.endsWith("__c") || sobjectName.endsWith("__kav")) {
      return "https://" + this.props.sfHost + "/lightning/setup/ObjectManager/" + durableId + "/Details/view";
    } else {
      return "https://" + this.props.sfHost + "/lightning/setup/ObjectManager/" + sobjectName + "/Details/view";
    }
  }
  getCustomMetadataLink(durableId) {
    return "https://" + this.props.sfHost + "/lightning/setup/CustomMetadata/page?address=%2F" + durableId + "%3Fsetupid%3DCustomMetadata";
  }
  getObjectFieldsSetupLink(sobjectName, durableId, isCustomSetting) {
    if (sobjectName.endsWith("__mdt")) {
      return this.getCustomMetadataLink(durableId);
    } else if (isCustomSetting) {
      return "https://" + this.props.sfHost + "/lightning/setup/CustomSettings/page?address=%2F" + durableId + "?setupid=CustomSettings";
    } else if (sobjectName.endsWith("__c") || sobjectName.endsWith("__kav")) {
      return "https://" + this.props.sfHost + "/lightning/setup/ObjectManager/" + durableId + "/FieldsAndRelationships/view";
    } else {
      return "https://" + this.props.sfHost + "/lightning/setup/ObjectManager/" + sobjectName + "/FieldsAndRelationships/view";
    }
  }
  getObjectListLink(sobjectName, keyPrefix, isCustomSetting) {
    if (sobjectName.endsWith("__mdt")) {
      return "https://" + this.props.sfHost + "/lightning/setup/CustomMetadata/page?address=%2F" + keyPrefix;
    } else if (isCustomSetting) {
      return "https://" + this.props.sfHost + "/lightning/setup/CustomSettings/page?address=%2Fsetup%2Fui%2FlistCustomSettingsData.apexp?id=" + keyPrefix;

    } else {
      return "https://" + this.props.sfHost + "/lightning/o/" + sobjectName + "/list";
    }
  }
  getRecordTypesLink(sfHost, sobjectName, durableId) {
    if (sobjectName.endsWith("__c") || sobjectName.endsWith("__kav")) {
      return "https://" + sfHost + "/lightning/setup/ObjectManager/" + durableId + "/RecordTypes/view";
    } else {
      return "https://" + sfHost + "/lightning/setup/ObjectManager/" + sobjectName + "/RecordTypes/view";
    }
  }
  getObjectDocLink(sobject, api){
    if (api === "toolingApi"){
      return "https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_" + sobject.name.toLowerCase() + ".htm";
    }
    return "https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_" + sobject.name.toLowerCase() + ".htm";
  }
  getNewObjectUrl(sfHost, newUrl){
    return "https://" + sfHost + newUrl;
  }
  render() {
    let {sfHost, showDetailsSupported, contextRecordId, selectedValue, linkTarget, recordIdDetails, isFieldsPresent, contextFilterName} = this.props;
    // Show buttons for the available APIs.
    let buttons = selectedValue.sobject.availableApis ? Array.from(selectedValue.sobject.availableApis) : [];
    buttons.sort();
    if (buttons.length == 0 && !selectedValue.isRecent) {
      // If none of the APIs are available, show a button for the regular API, which will partly fail, but still show some useful metadata from the tooling API.
      buttons.push("noApi");
    }
    return (
      h("div", {className: "all-data-box-inner"},
        h("div", {className: "all-data-box-data slds-m-bottom_xx-small"},
          h("table", {},
            h("tbody", {},
              h("tr", {},
                h("th", {}, "Name:"),
                h("td", {},
                  h("a", {href: this.getObjectSetupLink(selectedValue.sobject.name, selectedValue.sobject.durableId, selectedValue.sobject.isCustomSetting), target: linkTarget}, selectedValue.sobject.name)
                )
              ),
              h("tr", {className: (selectedValue.sobject.name.endsWith("__e") ? "hide" : "")},
                h("th", {}, "Links:"),
                h("td", {},
                  h("a", {href: this.getObjectFieldsSetupLink(selectedValue.sobject.name, selectedValue.sobject.durableId, selectedValue.sobject.isCustomSetting), target: linkTarget}, "Fields"),
                  h("span", {}, " / "),
                  h("a", {href: this.getRecordTypesLink(sfHost, selectedValue.sobject.name, selectedValue.sobject.durableId), target: linkTarget}, "Record Types"),
                  h("span", {}, " / "),
                  h("a", {href: this.getObjectListLink(selectedValue.sobject.name, selectedValue.sobject.keyPrefix, selectedValue.sobject.isCustomSetting), target: linkTarget}, "Object List")
                ),
              ),
              h("tr", {},
                h("th", {}, "Label:"),
                h("td", {}, selectedValue.sobject.label)
              ),
              h("tr", {},
                h("th", {}, "Id:"),
                h("td", {},
                  h("span", {}, selectedValue.sobject.keyPrefix),
                  h("span", {}, (selectedValue.recordId) ? " / " + selectedValue.recordId : ""),
                )
              ),
              selectedValue.sobject.name.indexOf("__") == -1 && selectedValue.sobject.availableApis
                ? h("tr", {},
                  h("th", {}, "Doc:"),
                  h("td", {},
                    h("a", {href: this.getObjectDocLink(selectedValue.sobject, selectedValue.sobject.availableApis[1]), target: linkTarget}, "Standard"),
                    selectedValue.sobject.availableApis.length > 1
                      ? h("a", {href: this.getObjectDocLink(selectedValue.sobject, selectedValue.sobject.availableApis[0]), target: linkTarget, className: "left-space"}, "Tooling")
                      : null
                  ),
                ) : null
            )),

          h(AllDataRecordDetails, {sfHost, selectedValue, recordIdDetails, className: "top-space", linkTarget}),
        ),
        h(ShowDetailsButton, {ref: "showDetailsBtn", sfHost, showDetailsSupported, selectedValue, contextRecordId}),
        selectedValue.recordId && selectedValue.recordId.startsWith("0Af")
          ? h("a", {href: this.getDeployStatusUrl(), target: linkTarget, className: "button page-button slds-button slds-button_neutral slds-m-top_xx-small slds-m-bottom_xx-small"}, "Check Deploy Status") : null,
        buttons.map((button, index) => h("div", {key: button + "Div"}, h("a",
          {
            key: button,
            // If buttons for both APIs are shown, the keyboard shortcut should open the first button.
            ref: index == 0 ? "showAllDataBtn" : null,
            href: this.getAllDataUrl(button == "toolingApi"),
            target: linkTarget,
            className: "slds-m-top_xx-small page-button slds-button slds-button_neutral slds-m-top_xx-small"
          },
          index == 0 ? h("span", {}, "Show ", h("u", {}, "a"), "ll data") : "Show all data",
          button == "regularApi" ? ""
          : button == "toolingApi" ? " (Tooling API)"
          : " (Not readable)"
        ))),
        isFieldsPresent ? h("a", {ref: "showFieldApiNameBtn", onClick: showApiName, target: linkTarget, className: "slds-m-top_xx-small page-button slds-button slds-button_neutral"}, h("span", {}, "Show ", h("u", {}, "f"), "ields API names")) : null,
        selectedValue.sobject.isEverCreatable ? h("a", {ref: "showNewBtn", href: this.getNewObjectUrl(sfHost, selectedValue.sobject.newUrl), target: linkTarget, className: "slds-m-top_xx-small page-button slds-button slds-button_neutral"}, h("span", {}, h("u", {}, "N"), "ew " + selectedValue.sobject.label)) : null,
        contextFilterName ? h("a", {ref: "exportListViewBtn", onClick: this.exportListView, target: linkTarget, className: "slds-m-top_xx-small page-button slds-button slds-button_neutral"}, h("span", {}, "Export ", h("u", {}, "L"), "ist View")) : null,
      )
    );
  }
}

class AllDataRecordDetails extends React.PureComponent {

  getRecordLink(sfHost, recordId) {
    return "https://" + sfHost + "/" + recordId;
  }
  getRecordTypeLink(sfHost, sobjectName, recordtypeId) {
    return "https://" + sfHost + "/lightning/setup/ObjectManager/" + sobjectName + "/RecordTypes/" + recordtypeId + "/view";
  }

  render() {
    let {sfHost, recordIdDetails, className, selectedValue, linkTarget} = this.props;
    if (recordIdDetails) {
      return (
        h("table", {className},
          h("tbody", {},
            recordIdDetails.recordName ? h("tr", {},
              h("th", {}, "Name:"),
              h("td", {},
                h("a", {href: this.getRecordLink(sfHost, selectedValue.recordId), target: linkTarget}, recordIdDetails.recordName)
              )
            ) : null,
            recordIdDetails.recordTypeName ? h("tr", {},
              h("th", {}, "RecType:"),
              h("td", {},
                h("a", {href: this.getRecordTypeLink(sfHost, selectedValue.sobject.name, recordIdDetails.recordTypeId), target: linkTarget}, recordIdDetails.recordTypeName)
              )
            ) : null,
            h("tr", {},
              h("th", {}, "Created:"),
              h("td", {}, recordIdDetails.created + " (" + recordIdDetails.createdBy + ")")
            ),
            h("tr", {},
              h("th", {}, "Edited:"),
              h("td", {}, recordIdDetails.lastModified + " (" + recordIdDetails.lastModifiedBy + ")")
            )
          )));
    } else {
      return null;
    }
  }
}


// props: {style: "base"|"warning"|"error"|"offline", icon: utility SVG name (without utility prefix),
// bannerText: header, link: {text, props}, assistiveText: icon description, onClose: function}
class AlertBanner extends React.PureComponent {
  // From SLDS Alert Banner spec https://www.lightningdesignsystem.com/components/alert/

  render() {
    let {type, iconName, iconTitle, bannerText, link, assistiveText, onClose} = this.props;
    const theme = ["warning", "error", "offline"].includes(type) ? type : "info";
    const themeClass = `slds-theme_${theme}`;
    return (
      h("div", {className: `slds-notify slds-notify_alert ${themeClass}`, role: "alert"},
        h("span", {className: "slds-assistive-text"}, assistiveText | "Notification"),
        h("span", {className: "slds-icon_container slds-m-right_small", title: iconTitle},
          h("svg", {className: "slds-icon slds-icon_neither-small-nor-x-small slds-icon-text-default", viewBox: "0 0 52 52"},
            h("use", {xlinkHref: `symbols.svg#${iconName}`})
          ),
        ),
        h("h2", {}, bannerText,
          h("p", {}, ""),
          link && h("a", link.props, link.text)
        ),
        onClose && h("div", {className: "slds-notify__close"},
          h("button", {className: "slds-button slds-button_icon slds-button_icon-small slds-button_icon-inverse", title: "Close", onClick: onClose},
            h("svg", {className: "slds-button__icon", viewBox: "0 0 52 52"},
              h("use", {xlinkHref: "symbols.svg#close"})
            ),
            h("span", {className: "slds-assistive-text"}, "Close"),
          )
        )
      )
    );
  }
}
class AllDataSearch extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      queryString: "",
      matchingResults: [],
      recentItems: [],
      queryDelayTimer: null
    };
    this.onAllDataInput = this.onAllDataInput.bind(this);
    this.onAllDataFocus = this.onAllDataFocus.bind(this);
    this.onAllDataBlur = this.onAllDataBlur.bind(this);
    this.onAllDataKeyDown = this.onAllDataKeyDown.bind(this);
    this.onAllDataArrowClick = this.onAllDataArrowClick.bind(this);
    this.updateAllDataInput = this.updateAllDataInput.bind(this);
  }
  componentDidMount() {
    let {queryString} = this.state;
    this.getMatchesDelayed(queryString);
  }
  onAllDataInput(e) {
    let val = e.target.value;
    this.refs.autoComplete.handleInput();
    this.getMatchesDelayed(val);
    this.setState({queryString: val});
  }
  onAllDataFocus() {
    this.refs.autoComplete.handleFocus();
  }
  onAllDataBlur() {
    this.refs.autoComplete.handleBlur();
  }
  onAllDataKeyDown(e) {
    this.refs.autoComplete.handleKeyDown(e);
    e.stopPropagation(); // Stop our keyboard shortcut handler
  }
  updateAllDataInput(value) {
    this.props.onDataSelect(value);
    this.setState({queryString: ""});
    this.getMatchesDelayed("");
  }
  onAllDataArrowClick() {
    this.refs.showAllDataInp.focus();
  }
  getMatchesDelayed(userQuery) {
    let {queryDelayTimer} = this.state;
    let {inputSearchDelay} = this.props;

    if (queryDelayTimer) {
      clearTimeout(queryDelayTimer);
    }
    queryDelayTimer = setTimeout(async () => {
      let {getMatches} = this.props;
      const matchingResults = await getMatches(userQuery);
      await this.setState({matchingResults});
    }, inputSearchDelay);

    this.setState({queryDelayTimer});
  }
  render() {
    let {queryString, matchingResults, recentItems} = this.state;
    let {placeholderText, resultRender, sfHost} = this.props;
    return (
      h("div", {className: "input-with-dropdown"},
        h("input", {
          className: "all-data-input",
          ref: "showAllDataInp",
          placeholder: placeholderText,
          onInput: this.onAllDataInput,
          onFocus: this.onAllDataFocus,
          onBlur: this.onAllDataBlur,
          onKeyDown: this.onAllDataKeyDown,
          value: queryString
        }),
        h(Autocomplete, {
          ref: "autoComplete",
          updateInput: this.updateAllDataInput,
          matchingResults: resultRender(matchingResults, queryString),
          recentItems: resultRender(recentItems, queryString),
          queryString,
          sfHost
        }),
        h("svg", {viewBox: "0 0 24 24", onClick: this.onAllDataArrowClick},
          h("path", {d: "M3.8 6.5h16.4c.4 0 .8.6.4 1l-8 9.8c-.3.3-.9.3-1.2 0l-8-9.8c-.4-.4-.1-1 .4-1z"})
        )
      )
    );
  }
}

function MarkSubstring({text, start, length}) {
  if (start == -1) {
    return h("span", {}, text);
  }
  return h("span", {},
    text.substr(0, start),
    h("mark", {}, text.substr(start, length)),
    text.substr(start + length)
  );
}

class Autocomplete extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      showResults: false,
      selectedIndex: 0, // Index of the selected autocomplete item.
      scrollToSelectedIndex: 0, // Changed whenever selectedIndex is updated (even if updated to a value it already had). Used to scroll to the selected item.
      scrollTopIndex: 0, // Index of the first autocomplete item that is visible according to the current scroll position.
      itemHeight: 1, // The height of each autocomplete item. All items should have the same height. Measured on first render. 1 means not measured.
      resultsMouseIsDown: false // Hide the autocomplete popup when the input field looses focus, except when clicking one of the autocomplete items.
    };
    this.onResultsMouseDown = this.onResultsMouseDown.bind(this);
    this.onResultsMouseUp = this.onResultsMouseUp.bind(this);
    this.onResultClick = this.onResultClick.bind(this);
    this.onResultMouseEnter = this.onResultMouseEnter.bind(this);
    this.onScroll = this.onScroll.bind(this);
  }
  handleInput() {
    this.setState({showResults: true, selectedIndex: 0, scrollToSelectedIndex: this.state.scrollToSelectedIndex + 1});
  }
  handleFocus() {
    let {recentItems} = this.props;
    sfConn.rest("/services/data/v" + apiVersion + "/query/?q=SELECT+Id,Name,Type+FROM+RecentlyViewed+LIMIT+50").then(res => {
      res.records.forEach(recentItem => {
        recentItems.push({key: recentItem.Id,
          value: {recordId: recentItem.Id, isRecent: true, sobject: {keyPrefix: recentItem.Id.slice(0, 3), label: recentItem.Type, name: recentItem.Name}},
          element: [
            h("div", {className: "autocomplete-item-main", key: "main"},
              recentItem.Name,
            ),
            h("div", {className: "autocomplete-item-sub", key: "sub"},
              h(MarkSubstring, {
                text: recentItem.Type,
                start: -1,
                length: 0
              }),
              " • ",
              h(MarkSubstring, {
                text: recentItem.Id,
                start: -1,
                length: 0
              })
            )
          ]});
      });
      this.setState({recentItems, showResults: true, selectedIndex: 0, scrollToSelectedIndex: this.state.scrollToSelectedIndex + 1});
    });
  }
  handleBlur() {
    this.setState({showResults: false});
  }
  handleKeyDown(e) {
    let {matchingResults} = this.props;
    let {selectedIndex, showResults, scrollToSelectedIndex} = this.state;
    if (e.key == "Enter") {
      if (!showResults) {
        this.setState({showResults: true, selectedIndex: 0, scrollToSelectedIndex: scrollToSelectedIndex + 1});
        return;
      }
      if (selectedIndex < matchingResults.length) {
        e.preventDefault();
        let {value} = matchingResults[selectedIndex];
        this.props.updateInput(value);
        this.setState({showResults: false, selectedIndex: 0});
      }
      return;
    }
    if (e.key == "Escape") {
      e.preventDefault();
      this.setState({showResults: false, selectedIndex: 0});
      return;
    }
    let selectionMove = 0;
    if (e.key == "ArrowDown") {
      selectionMove = 1;
    }
    if (e.key == "ArrowUp") {
      selectionMove = -1;
    }
    if (selectionMove != 0) {
      e.preventDefault();
      if (!showResults) {
        this.setState({showResults: true, selectedIndex: 0, scrollToSelectedIndex: scrollToSelectedIndex + 1});
        return;
      }
      let index = selectedIndex + selectionMove;
      let length = matchingResults.length;
      if (index < 0) {
        index = length - 1;
      }
      if (index > length - 1) {
        index = 0;
      }
      this.setState({selectedIndex: index, scrollToSelectedIndex: scrollToSelectedIndex + 1});
    }
  }
  onResultsMouseDown() {
    this.setState({resultsMouseIsDown: true});
  }
  onResultsMouseUp() {
    this.setState({resultsMouseIsDown: false});
  }
  onResultClick(e, value) {
    let {sfHost} = this.props;
    if (value.isRecent){
      window.open("https://" + sfHost + "/" + value.recordId, getLinkTarget(e));
    } else {
      this.props.updateInput(value);
      this.setState({showResults: false, selectedIndex: 0});
    }
  }
  onResultMouseEnter(index) {
    this.setState({selectedIndex: index, scrollToSelectedIndex: this.state.scrollToSelectedIndex + 1});
  }
  onScroll() {
    let scrollTopIndex = Math.floor(this.refs.scrollBox.scrollTop / this.state.itemHeight);
    if (scrollTopIndex != this.state.scrollTopIndex) {
      this.setState({scrollTopIndex});
    }
  }
  componentDidUpdate(prevProps, prevState) {
    if (this.state.itemHeight == 1) {
      let anItem = this.refs.scrollBox.querySelector(".autocomplete-item");
      if (anItem) {
        let itemHeight = anItem.offsetHeight;
        if (itemHeight > 0) {
          this.setState({itemHeight});
        }
      }
      return;
    }
    let sel = this.refs.selectedItem;
    let marginTop = 5;
    if (this.state.scrollToSelectedIndex != prevState.scrollToSelectedIndex && sel && sel.offsetParent) {
      if (sel.offsetTop + marginTop < sel.offsetParent.scrollTop) {
        sel.offsetParent.scrollTop = sel.offsetTop + marginTop;
      } else if (sel.offsetTop + marginTop + sel.offsetHeight > sel.offsetParent.scrollTop + sel.offsetParent.offsetHeight) {
        sel.offsetParent.scrollTop = sel.offsetTop + marginTop + sel.offsetHeight - sel.offsetParent.offsetHeight;
      }
    }
  }
  render() {
    let {matchingResults, recentItems} = this.props;
    let {
      showResults,
      selectedIndex,
      scrollTopIndex,
      itemHeight,
      resultsMouseIsDown
    } = this.state;
    // For better performance only render the visible autocomplete items + at least one invisible item above and below (if they exist)
    const RENDERED_ITEMS_COUNT = 11;
    let firstIndex = 0;
    let autocompleteResults = recentItems.length > 0 ? recentItems : matchingResults;
    let lastIndex = autocompleteResults.length - 1;
    let firstRenderedIndex = Math.max(0, scrollTopIndex - 2);
    let lastRenderedIndex = Math.min(lastIndex, firstRenderedIndex + RENDERED_ITEMS_COUNT);
    let topSpace = (firstRenderedIndex - firstIndex) * itemHeight;
    let bottomSpace = (lastIndex - lastRenderedIndex) * itemHeight;
    let topSelected = (selectedIndex - firstIndex) * itemHeight;

    return (
      h("div", {className: "autocomplete-container", style: {display: (showResults && (autocompleteResults.length > 0)) || resultsMouseIsDown ? "" : "none"}, onMouseDown: this.onResultsMouseDown, onMouseUp: this.onResultsMouseUp},
        h("div", {className: "autocomplete", onScroll: this.onScroll, ref: "scrollBox"},
          h("div", {ref: "selectedItem", style: {position: "absolute", top: topSelected + "px", height: itemHeight + "px"}}),
          h("div", {style: {height: topSpace + "px"}}),
          autocompleteResults.slice(firstRenderedIndex, lastRenderedIndex + 1)
            .map(({key, value, element}, index) =>
              h("a", {
                key,
                className: "autocomplete-item " + (selectedIndex == index + firstRenderedIndex ? "selected" : ""),
                onClick: (e) => this.onResultClick(e, value),
                onMouseEnter: () => this.onResultMouseEnter(index + firstRenderedIndex)
              }, element)
            ),
          h("div", {style: {height: bottomSpace + "px"}})
        )
      )
    );
  }
}

function getRecordId(href) {
  let url = new URL(href);
  // Find record ID from URL
  // Salesforce and Console (+ Hyperforce China Lightning & Classic)
  if (url.hostname.endsWith(".salesforce.com") || url.hostname.endsWith(".salesforce.mil") || url.hostname.endsWith(".sfcrmapps.cn") || url.hostname.endsWith(".sfcrmproducts.cn")) {
    let match = url.pathname.match(/\/([a-zA-Z0-9]{3}|[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})(?:\/|$)/);
    if (match) {
      let res = match[1];
      if (res.includes("0000") || res.length == 3) {
        return match[1];
      }
    }
  }

  // Lightning Experience
  const lightningHostnames = [
    ".lightning.force.com",
    ".lightning.force.mil",
    ".lightning.crmforce.mil",
    ".lightning.force.com.mcas.ms"
  ];
  if (lightningHostnames.some(hostname => url.hostname.endsWith(hostname))) {
    let match;
    if (url.pathname == "/one/one.app") {
      match = url.hash.match(/\/sObject\/([a-zA-Z0-9]+)(?:\/|$)/);
    } else {
      match = url.pathname.match(/\/lightning\/[r|o]\/[a-zA-Z0-9_]+\/([a-zA-Z0-9]+)/);
    }
    if (match) {
      return match[1];
    }
  }
  // Visualforce
  let searchParams = new URLSearchParams(url.search.substring(1));
  {
    let idParam = searchParams.get("id");
    if (idParam) {
      return idParam;
    }
  }
  // Visualforce page that does not follow standard Visualforce naming
  for (let [, p] of searchParams) {
    if (p.match(/^([a-zA-Z0-9]{3}|[a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})$/) && p.includes("0000")) {
      return p;
    }
  }
  return null;
}

function getSobject(href) {
  let url = new URL(href);
  if (url.pathname) {
    let match = url.pathname.match(/\/lightning\/[r|o]\/([a-zA-Z0-9_]+)\/[a-zA-Z0-9]+/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function getSfPathFromUrl(href) {
  let url = new URL(href);
  if (url.protocol.endsWith("-extension:")) {
    return "/";
  }
  return url.pathname;
}
function getSfFilterNameFromUrl(href) {
  let url = new URL(href);
  if (url.protocol.endsWith("-extension:")) {
    return "";
  }
  return url.searchParams.get("filterName");
}

function sfLocaleKeyToCountryCode(localeKey) {
  //Converts a Salesforce locale key to a lower case country code (https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) or "".
  if (!localeKey) { return ""; }
  const splitted = localeKey.split("_");
  return splitted[(splitted.length > 1 && !localeKey.includes("_LATN_")) ? 1 : 0].toLowerCase();
}

function getLinkTarget(e) {
  if (JSON.parse(localStorage.getItem("openLinksInNewTab")) || (e?.ctrlKey || e?.metaKey)) {
    return "_blank";
  } else {
    return "_top";
  }
}

window.getRecordId = getRecordId; // for unit tests
