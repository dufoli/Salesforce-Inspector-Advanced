/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */
import {DescribeInfo} from "./data-load.js";

function cleanInputValue(value) {
  return (value == undefined || value == null) ? "" : value;
}

class Model {

  constructor(sfHost, tab) {
    this.sfHost = sfHost;
    this.tab = tab;
    this.sfLink = "https://" + this.sfHost;
    this.userInfo = "...";
    if (localStorage.getItem(sfHost + "_isSandbox") != "true") {
      //change background color for production
      document.body.classList.add("prod");
    }

    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => { });
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
    }));
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

}

class OptionsTabSelector extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.sfHost = this.model.sfHost;
    let tab = props.model.tab || 1;
    this.state = {
      selectedTabId: tab
    };
    this.tabs = [
      {
        id: 1,
        tabTitle: "Tab1",
        title: "User Experience",
        content: [
          {option: ArrowButtonOption, props: {key: 1}},
          {option: Option, props: {type: "toggle", title: "Flow Scrollability", key: "scrollOnFlowBuilder"}},
          {option: Option, props: {type: "toggle", title: "Inspect page - Show table borders", key: "displayInspectTableBorders"}},
          {option: Option, props: {type: "toggle", title: "Always open links in a new tab", key: "openLinksInNewTab"}},
          {option: Option, props: {type: "toggle", title: "Open Permission Set / Permission Set Group summary from shortcuts", key: "enablePermSetSummary"}},
          {option: Option, props: {type: "toggle", title: "Search metadata from Shortcut tab", key: "metadataShortcutSearch"}},
          {option: Option, props: {type: "toggle", title: "Disable query input autofocus", key: "disableQueryInputAutoFocus"}},
          {option: Option, props: {type: "toggle", title: "Enable generation of favicon color automatically", key: "generateCustomFavicon", default: true}},
          {option: Option, props: {type: "toggle", title: "Enable custom favicon for Salesforce", key: "customFaviconSF", default: true}},
          {option: Option, props: {type: "option", title: "Custom favicon (org specific)", key: this.sfHost + "_customFavicon", values: ["blue", "green", "orange", "pink", "purple", "red", "yellow"]}},
          {option: CustomLinkOption, props: {title: "Custom links (org specific)", key: this.sfHost + "_orgLinks"}},
          {option: Option, props: {type: "number", title: "Number of flow version to keep", key: "clearOlderFlowsKeep", placeholder: "5 by default", default: 5}},
          {option: Option, props: {type: "number", title: "Height of popup menu", key: "popupHeight", placeholder: "600 by default", default: 600}},
          {option: Option, props: {type: "number", title: "Width of popup menu", key: "popupWidth", placeholder: "280 by default", default: 280}},
        ]
      },
      {
        id: 2,
        tabTitle: "Tab2",
        title: "API",
        content: [
          {option: APIVersionOption, props: {key: 1}},
          {option: APIKeyOption, props: {key: 2}},
          {option: RestHeaderOption, props: {key: 3}}
        ]
      },
      {
        id: 3,
        tabTitle: "Tab3",
        title: "Data Export",
        content: [
          {option: Option, props: {type: "text", title: "csv file separator", key: "csvSeparator", suggestions: [",", ";", "|"], default: ","}},
          {option: Option, props: {type: "toggle", title: "Display Query Execution Time", key: "displayQueryPerformance", default: true}},
          {option: Option, props: {type: "toggle", title: "Use SObject context on Data Export", key: "useSObjectContextOnDataImportLink", default: true}},
          {option: Option, props: {type: "toggle", title: "Skip technical comlumns", key: "skipTechnicalColumns", default: true}},
          {option: Option, props: {type: "toggle", title: "convert date to local timezone", key: "convertToLocalTime", default: true}},
          {option: Option, props: {type: "text", title: "Date format", key: "dateFormat", suggestions: ["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"]}},
          {option: Option, props: {type: "text", title: "Date time format", key: "datetimeFormat", suggestions: ["yyyy-MM-ddTHH:mm:ss.SSS+FFff", "dd/MM/yyyy HH:mm:ss.SSS+FFff"]}},
          {option: Option, props: {type: "option", title: "Decimal format", key: "decimalFormat", default: ".", values: [".", ","]}},
          {option: QueryTemplatesOption, props: {title: "Query Templates", key: "queryTemplates", placeholder: "SELECT..."}},
          {option: QueryTemplatesOption, props: {title: "Saved Query History", key: "insextSavedQueryHistory", node: "query", withName: true, defaultValue: "{\"useToolingApi\": false}", placeholder: "SELECT..."}}
        ]
      },
      {
        id: 4,
        tabTitle: "Tab4",
        title: "Data Import",
        content: [
          {option: Option, props: {type: "text", title: "Default batch size", key: "defaultBatchSize", placeholder: "200"}},
          {option: Option, props: {type: "text", title: "Default thread size", key: "defaultThreadSize", placeholder: "6"}}
        ]
      },
      {
        id: 5,
        tabTitle: "Tab5",
        title: "Apex and logs",
        content: [
          {option: enableLogsOption, props: {key: 1}},
          {option: QueryTemplatesOption, props: {title: "script Templates", key: "scriptTemplates", placeholder: "Database.executeBatch()..."}}
        ]
      }
    ];
    this.onTabSelect = this.onTabSelect.bind(this);
  }

  onTabSelect(e) {
    e.preventDefault();
    this.setState({selectedTabId: e.target.tabIndex});
  }

  render() {
    return h("div", {className: "slds-tabs_default"},
      h("ul", {className: "options-tab-container slds-tabs_default__nav", role: "tablist"},
        this.tabs.map((tab) => h(OptionsTab, {key: tab.id, title: tab.title, id: tab.id, selectedTabId: this.state.selectedTabId, onTabSelect: this.onTabSelect}))
      ),
      this.tabs.map((tab) => h(OptionsContainer, {key: tab.id, id: tab.id, content: tab.content, selectedTabId: this.state.selectedTabId, model: this.model}))
    );
  }
}

class OptionsTab extends React.Component {

  getClass() {
    return "options-tab slds-text-align_center slds-tabs_default__item" + (this.props.selectedTabId === this.props.id ? " slds-is-active" : "");
  }

  render() {
    return h("li", {key: this.props.id, className: this.getClass(), title: this.props.title, tabIndex: this.props.id, role: "presentation", onClick: this.props.onTabSelect},
      h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: this.props.id, id: "tab-default-" + this.props.id + "__item"},
        this.props.title)
    );
  }
}

class OptionsContainer extends React.Component {

  constructor(props) {
    super(props);
    this.model = props.model;
  }

  getClass() {
    return (this.props.selectedTabId === this.props.id ? "slds-show" : " slds-hide");
  }

  render() {
    return h("div", {id: this.props.id, className: this.getClass(), role: "tabpanel"}, this.props.content.map((c) => h(c.option, {storageKey: c.props?.key, ...c.props, model: this.model})));
  }

}

class ArrowButtonOption extends React.Component {

  constructor(props) {
    super(props);
    this.onChangeArrowOrientation = this.onChangeArrowOrientation.bind(this);
    this.onChangeArrowPosition = this.onChangeArrowPosition.bind(this);
    this.state = {
      arrowButtonOrientation: localStorage.getItem("popupArrowOrientation") ? localStorage.getItem("popupArrowOrientation") : "vertical",
      arrowButtonPosition: localStorage.getItem("popupArrowPosition") ? localStorage.getItem("popupArrowPosition") : "15"
    };
    this.timeout;
  }

  onChangeArrowOrientation(e) {
    let orientation = e.target.value;
    this.setState({arrowButtonOrientation: orientation});
    localStorage.setItem("popupArrowOrientation", orientation);
    window.location.reload();
  }

  onChangeArrowPosition(e) {
    let position = e.target.value;
    this.setState({arrowButtonPosition: position});
    console.log("[SFInspector] New Arrow Position Value: ", position);
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      console.log("[SFInspector] Setting Arrow Position: ", position);
      localStorage.setItem("popupArrowPosition", position);
      window.location.reload();
    }, 1000);
  }

  render() {
    return h("div", {className: "slds-grid slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
      h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
        h("span", {}, "Popup arrow button orientation and position")
      ),
      h("div", {className: "slds-col slds-size_8-of-12 slds-form-element slds-grid slds-grid_align-end slds-grid_vertical-align-center slds-gutters_small"},
        h("label", {className: "slds-col slds-size_2-of-12 slds-text-align_right"}, "Orientation:"),
        h("select", {className: "slds-col slds-size_2-of-12 slds-combobox__form-element slds-input combobox-container", defaultValue: this.state.arrowButtonOrientation, name: "arrowPosition", id: "arrowPosition", onChange: this.onChangeArrowOrientation},
          h("option", {value: "horizontal"}, "Horizontal"),
          h("option", {value: "vertical"}, "Vertical")
        ),
        h("label", {className: "slds-m-left_medium slds-col slds-size_2-of-12 slds-text-align_right", htmlFor: "arrowPositionSlider"}, "Position (%):"),
        h("div", {className: "slds-form-element__control slider-container slds-col slds-size_4-of-12"},
          h("div", {className: "slds-slider"},
            h("input", {type: "range", id: "arrowPositionSlider", className: "slds-slider__range", value: cleanInputValue(this.state.arrowButtonPosition), min: "0", max: "100", step: "1", onChange: this.onChangeArrowPosition}),
            h("span", {className: "slds-slider__value", "aria-hidden": true}, this.state.arrowButtonPosition)
          )
        )
      )
    );
  }
}

class APIVersionOption extends React.Component {

  constructor(props) {
    super(props);
    this.onChangeApiVersion = this.onChangeApiVersion.bind(this);
    this.state = {apiVersion: localStorage.getItem("apiVersion") ? localStorage.getItem("apiVersion") : apiVersion};
  }

  onChangeApiVersion(e) {
    let apiVersion = e.target.value;
    this.setState({apiVersion});
    localStorage.setItem("apiVersion", apiVersion + ".0");
  }

  render() {
    return h("div", {className: "slds-grid slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
      h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
        h("span", {}, "API Version")
      ),
      h("div", {className: "slds-col slds-size_7-of-12 slds-form-element slds-grid slds-grid_align-end slds-grid_vertical-align-center slds-gutters_small"}),
      h("div", {className: "slds-col slds-size_1-of-12 slds-form-element slds-grid slds-grid_align-end slds-grid_vertical-align-center slds-gutters_small"},
        h("div", {className: "slds-form-element__control slds-col slds-size_2-of-12"},
          h("input", {type: "number", required: true, id: "apiVersionInput", className: "slds-input", value: cleanInputValue(this.state.apiVersion.split(".0")[0]), onChange: this.onChangeApiVersion}),
        )
      )
    );
  }
}

class RestHeaderOption extends React.Component {

  constructor(props) {
    super(props);
    this.onChangeRestHeader = this.onChangeRestHeader.bind(this);
    this.state = {restHeader: localStorage.getItem("createUpdateRestCalloutHeaders") ? localStorage.getItem("createUpdateRestCalloutHeaders") : ""};
  }

  onChangeRestHeader(e) {
    let restHeader = e.target.value;
    this.setState({restHeader});
    localStorage.setItem("createUpdateRestCalloutHeaders", restHeader);
  }

  render() {
    return h("div", {className: "slds-grid slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
      h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
        h("span", {}, "Rest Header")
      ),
      h("div", {className: "slds-col slds-size_2-of-12 slds-form-element slds-grid slds-grid_align-end slds-grid_vertical-align-center slds-gutters_small"},
        h("div", {className: "slds-form-element__control slds-col slds-size_6-of-12"},
          h("input", {type: "text", id: "restHeaderInput", className: "slds-input", placeholder: "Rest Header", value: cleanInputValue(this.state.restHeader), onChange: this.onChangeRestHeader}),
        )
      )
    );
  }
}

class Option extends React.Component {
  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
    this.onChangeToggle = this.onChangeToggle.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onSuggestionClick = this.onSuggestionClick.bind(this);
    this.onChange = this.onChange.bind(this);
    this.key = props.storageKey;
    this.type = props.type;
    this.label = props.label;
    this.placeholder = props.placeholder;
    let value = localStorage.getItem(this.key);
    if (props.default !== undefined && value === null) {
      if (props.default instanceof String) {
        value = props.default;
      } else {
        value = JSON.stringify(props.default);
      }
      localStorage.setItem(this.key, value);
    }
    this.state = {activeSuggestion: 0,
      filteredSuggestions: [],
      showSuggestions: false,
      [this.key]: this.type == "toggle" ? !!JSON.parse(value) : value};
    this.title = props.title;
  }
  onFocus() {
    let {suggestions} = this.props;
    this.setState({
      activeSuggestion: 0,
      filteredSuggestions: suggestions,
      showSuggestions: (suggestions != null)
    });
  }
  onBlur() {
    setTimeout(() => {
      //no need to refresh if already refresh by click on value
      if (!this.state || !this.state.showSuggestions) {
        return;
      }
      this.setState({
        activeSuggestion: 0,
        filteredSuggestions: [],
        showSuggestions: false
      });
    }, 100); // Set timeout for 500ms
  }
  onSuggestionClick(e) {
    this.setState({
      activeSuggestion: 0,
      filteredSuggestions: [],
      showSuggestions: false
    });
    this.setState({[this.key]: e.target.innerText});
    localStorage.setItem(this.key, e.target.innerText);
  }
  onKeyDown(e){
    const {activeSuggestion, filteredSuggestions} = this.state;
    switch (e.keyCode) {
      case 40:
        if (activeSuggestion - 1 === filteredSuggestions.length) {
          return;
        }
        this.setState({activeSuggestion: activeSuggestion + 1});
        break;
      case 38:
        if (activeSuggestion === 0) {
          return;
        }
        this.setState({activeSuggestion: activeSuggestion - 1});
        break;
      case 13:
        this.setState({
          activeSuggestion: 0,
          showSuggestions: false
        });
        this.setState({[this.key]: filteredSuggestions[activeSuggestion]});
        localStorage.setItem(this.key, filteredSuggestions[activeSuggestion]);
        e.preventDefault();
        break;
    }
  }
  onChangeToggle(e) {
    const enabled = e.target.checked;
    this.setState({[this.key]: enabled});
    localStorage.setItem(this.key, JSON.stringify(enabled));
  }

  onChange(e) {
    let {suggestions} = this.props;
    let inputValue = e.target.value;
    this.setState({[this.key]: inputValue});
    if (this.type == "option" && inputValue == this.props.values[0]) {
      localStorage.removeItem(this.key);
      return;
    }
    localStorage.setItem(this.key, inputValue);
    const filteredSuggestions = suggestions ? suggestions.filter(
      suggestion =>
        suggestion.toLowerCase().indexOf(inputValue.toLowerCase()) > -1
    ) : [];

    this.setState({
      activeSuggestion: 0,
      filteredSuggestions,
      showSuggestions: true
    });
  }

  render() {
    const id = this.key;
    let {activeSuggestion, filteredSuggestions, showSuggestions} = this.state;
    if (this.type == "toggle") {
      return h("div", {className: "slds-grid slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
        h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
          h("span", {}, this.title)
        ),
        h("div", {className: "slds-col slds-size_7-of-12 slds-form-element slds-grid slds-grid_align-end slds-grid_vertical-align-center slds-gutters_small"}),
        h("div", {dir: "rtl", className: "slds-form-element__control slds-col slds-size_1-of-12 slds-p-right_medium"},
          h("label", {className: "slds-checkbox_toggle slds-grid"},
            h("input", {type: "checkbox", required: true, id, "aria-describedby": id, className: "slds-input", checked: this.state[this.key], onChange: this.onChangeToggle}),
            h("span", {id, className: "slds-checkbox_faux_container center-label"},
              h("span", {className: "slds-checkbox_faux"}),
              h("span", {className: "slds-checkbox_on"}, "Enabled"),
              h("span", {className: "slds-checkbox_off"}, "Disabled"),
            )
          )
        )
      );
    } else if (this.type == "text" || this.type == "number") {
      return h("div", {className: "slds-grid slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
        h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
          h("span", {}, this.title)
        ),
        h("div", {className: "slds-col slds-size_2-of-12 slds-form-element slds-grid slds-grid_align-end slds-grid_vertical-align-center slds-gutters_small"},
          h("div", {className: "slds-form-element__control slds-col slds-size_6-of-12"},
            h("input", {type: this.type, id: "restHeaderInput", className: "slds-input", placeholder: this.placeholder, value: cleanInputValue(this.state[this.key]), onChange: this.onChange, onFocus: this.onFocus, onBlur: this.onBlur, onKeyDown: this.onKeyDown}),
            (showSuggestions && filteredSuggestions.length)
              ? h("ul", {className: "suggestions"},
                filteredSuggestions.map((suggestion, index) => {
                  let SuggestionClass;
                  if (index === activeSuggestion) {
                    SuggestionClass = "suggestion-active";
                  }
                  return h("li", {className: SuggestionClass, key: suggestion, onMouseDown: this.onSuggestionClick}, suggestion);
                })
              ) : ""
          )
        )
      );
    } else if (this.type == "option") {
      return h("div", {className: "slds-grid slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
        h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
          h("span", {}, this.title)
        ),
        h("div", {className: "slds-col slds-size_2-of-12 slds-form-element slds-grid slds-grid_align-end slds-grid_vertical-align-center slds-gutters_small"},
          h("div", {className: "slds-form-element__control slds-col slds-size_6-of-12"},
            h("select", {className: "slds-combobox__form-element slds-input combobox-container", name: "options", id: "options", value: cleanInputValue(this.state[this.key]), onChange: this.onChange},
              this.props.values ? this.props.values.map((o) => h("option", {key: o, value: o}, o)) : ""
            )
          )
        )
      );
    } else {
      console.error("Invalid render type: " + this.type);
      return h("div", {}, "Invalid option type: " + this.type);
    }
  }
}

class APIKeyOption extends React.Component {

  constructor(props) {
    super(props);
    this.sfHost = props.model.sfHost;
    this.onChangeApiKey = this.onChangeApiKey.bind(this);
    this.state = {apiKey: localStorage.getItem(this.sfHost + "_clientId") ? localStorage.getItem(this.sfHost + "_clientId") : ""};
  }

  onChangeApiKey(e) {
    let apiKey = e.target.value;
    this.setState({apiKey});
    localStorage.setItem(this.sfHost + "_clientId", apiKey);
  }

  render() {
    return h("div", {className: "slds-grid slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
      h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
        h("span", {}, "API Consumer Key")
      ),
      h("div", {className: "slds-col slds-size_2-of-12 slds-form-element slds-grid slds-grid_align-end slds-grid_vertical-align-center slds-gutters_small"},
        h("div", {className: "slds-form-element__control slds-col slds-size_6-of-12"},
          h("input", {type: "text", id: "apiKeyInput", className: "slds-input", placeholder: "Consumer Key", value: cleanInputValue(this.state.apiKey), onChange: this.onChangeApiKey}),
        )
      )
    );
  }
}

class enableLogsOption extends React.Component {

  constructor(props) {
    super(props);
    this.sfHost = props.model.sfHost;
    this.onChangeDebugLogTime = this.onChangeDebugLogTime.bind(this);
    this.onChangeDebugLevel = this.onChangeDebugLevel.bind(this);
    this.state = {
      debugLogDebugLevel: localStorage.getItem(this.sfHost + "_debugLogDebugLevel") ? localStorage.getItem(this.sfHost + "_debugLogDebugLevel") : "SFDC_DevConsole",
      debugLogTimeMinutes: localStorage.getItem("debugLogTimeMinutes") ? localStorage.getItem("debugLogTimeMinutes") : "15",
    };
  }

  onChangeDebugLevel(e) {
    let debugLogDebugLevel = e.target.value;
    this.setState({debugLogDebugLevel});
    localStorage.setItem(this.sfHost + "_debugLogDebugLevel", debugLogDebugLevel);
  }

  onChangeDebugLogTime(e) {
    let debugLogTimeMinutes = e.target.value;
    this.setState({debugLogTimeMinutes});
    localStorage.setItem("debugLogTimeMinutes", debugLogTimeMinutes);
  }

  render() {
    return h("div", {className: "slds-grid slds-grid_vertical"},
      h("div", {className: "slds-col slds-grid slds-wrap slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
        h("div", {className: "slds-col slds-size_3-of-12 text-align-middle"},
          h("span", {}, "Debug Level (DeveloperName)")
        ),
        h("div", {className: "slds-col slds-size_6-of-12 slds-form-element"}),
        h("div", {className: "slds-col slds-size_3-of-12 slds-form-element"},
          h("input", {type: "text", id: "debugLogDebugLevel", className: "slds-input slds-text-align_right slds-m-right_small", placeholder: "SFDC_DevConsole", value: cleanInputValue(this.state.debugLogDebugLevel), onChange: this.onChangeDebugLevel})
        ),
      ),
      h("div", {className: "slds-col slds-grid slds-wrap slds-border_bottom slds-p-horizontal_small slds-p-vertical_xx-small"},
        h("div", {className: "slds-col slds-size_3-of-12 text-align-middle"},
          h("span", {}, "Debug Log Time (Minutes)")
        ),
        h("div", {className: "slds-col slds-size_6-of-12 slds-form-element"}),
        h("div", {className: "slds-col slds-size_3-of-12 slds-form-element"},
          h("input", {type: "number", id: "debugLogTimeMinutes", className: "slds-input slds-text-align_right slds-m-right_small", value: cleanInputValue(this.state.debugLogTimeMinutes), onChange: this.onChangeDebugLogTime})
        ),
      )
    );
  }
}

class CustomLinkOption extends React.Component {

  constructor(props) {
    super(props);
    this.key = props.storageKey;
    this.model = props.model;
    this.title = props.title;
    let val = localStorage.getItem(this.key);
    if (val) {
      this.links = JSON.parse(val);
    } else {
      this.links = [];
    }
    this.addLink = this.addLink.bind(this);
    this.deleteLink = this.deleteLink.bind(this);
    this.onChangeLinkName = this.onChangeLinkName.bind(this);
    this.onChangeLinkUrl = this.onChangeLinkUrl.bind(this);
    this.state = {linkName: "", linkUrl: "", links: this.links};
  }
  deleteLink(i) {
    this.links.splice(i, 1);
    this.setState({links: this.links});
    localStorage.setItem(this.key, JSON.stringify(this.links));
    this.model.didUpdate();
  }
  addLink() {
    this.links.push({"label": this.state.linkName, "link": this.state.linkUrl, "section": "Custom", "prod": false});
    this.setState({linkName: "", linkUrl: "", links: this.links});
    localStorage.setItem(this.key, JSON.stringify(this.links));
    this.model.didUpdate();
  }

  onChangeLinkName(e) {
    this.setState({linkName: e.target.value});
  }

  onChangeLinkUrl(e) {
    this.setState({linkUrl: e.target.value});
  }

  render() {
    return h("div", {},
      h("div", {className: "slds-grid slds-p-horizontal_small slds-p-vertical_xx-small"},
        h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
          h("span", {}, this.title)
        )
      ),
      h("div", {className: "slds-grid slds-p-horizontal_small slds-p-vertical_xx-small"},
        h("div", {className: "slds-form-element__control slds-col slds-size_5-of-12"},
          h("input", {type: "text", id: "linkName", className: "slds-input", value: cleanInputValue(this.state.linkName), placeholder: "Name", onChange: this.onChangeLinkName}),
        ),
        h("div", {className: "slds-form-element__control slds-col slds-size_5-of-12"},
          h("input", {type: "text", id: "linkUrl", className: "slds-input", value: cleanInputValue(this.state.linkUrl), placeholder: "https://...", onChange: this.onChangeLinkUrl}),
        ),
        h("div", {className: "slds-form-element__control slds-col slds-col slds-size_2-of-12 text-align-middle"},
          h("button", {onClick: this.addLink, title: "Add", className: "slds-button slds-button_brand"}, "Add"),
        )
      ), this.state.links.map((l, i) =>
        h("div", {key: "link" + i, className: "slds-grid slds-p-horizontal_small slds-p-vertical_xx-small"},
          h("div", {className: "slds-col slds-size_5-of-12 text-align-middle"},
            h("span", {}, l.label)
          ),
          h("div", {className: "slds-col slds-size_5-of-12 text-align-middle"},
            h("span", {}, l.link)
          ),
          h("div", {className: "slds-col slds-size_2-of-12 text-align-middle"},
            h("button", {onClick: () => this.deleteLink(i), title: "Delete", className: "slds-button slds-button_destructive"}, "Delete")
          )
        )
      ),
      h("div", {className: "slds-border_bottom"})
    );
  }
}

class QueryTemplatesOption extends React.Component {

  constructor(props) {
    super(props);
    this.key = props.storageKey;
    this.model = props.model;
    this.title = props.title;
    this.withName = props.withName;
    this.node = props.node;
    this.defaultValue = props.defaultValue;
    this.placeholder = props.placeholder;
    let val = localStorage.getItem(this.key);
    if (val) {
      try {
        this.queryTemplates = JSON.parse(val);
      } catch (err) {
        //try old format which do not support comments
        this.queryTemplates = val.split("//");
      }
    } else {
      this.queryTemplates = [];
    }
    this.addQueryTemplate = this.addQueryTemplate.bind(this);
    this.deleteQueryTemplate = this.deleteQueryTemplate.bind(this);
    this.onChangeQuery = this.onChangeQuery.bind(this);
    this.onChangeName = this.onChangeName.bind(this);
    this.state = {query: "", queryTemplates: this.queryTemplates};
    if (this.withName) {
      this.state.name = "";
    }
  }
  deleteQueryTemplate(i) {
    this.queryTemplates.splice(i, 1);
    this.setState({queryTemplates: this.queryTemplates});
    localStorage.setItem(this.key, JSON.stringify(this.queryTemplates));
    this.model.didUpdate();
  }
  addQueryTemplate() {
    if (this.node) {
      let elt = {};
      if (this.defaultValue) {
        elt = JSON.parse(this.defaultValue);
      }
      if (this.withName) {
        elt.name = this.state.name;
      }
      elt[this.node] = this.state.query;
      this.queryTemplates.push(elt);
    } else {
      this.queryTemplates.push(this.state.query);
    }

    this.setState({query: "", name: "", queryTemplates: this.queryTemplates});
    localStorage.setItem(this.key, JSON.stringify(this.queryTemplates));
    this.model.didUpdate();
  }

  onChangeQuery(e) {
    this.setState({query: e.target.value});
  }
  onChangeName(e) {
    this.setState({name: e.target.value});
  }

  render() {
    return h("div", {},
      h("div", {className: "slds-grid slds-p-horizontal_small slds-p-vertical_xx-small"},
        h("div", {className: "slds-col slds-size_4-of-12 text-align-middle"},
          h("span", {}, this.title)
        )
      ),
      h("div", {className: "slds-grid slds-p-horizontal_small slds-p-vertical_xx-small"},
        this.withName ? h("div", {className: "slds-form-element__control slds-col slds-size_3-of-12"},
          h("input", {id: "templateQueryName", className: "slds-input", value: this.state.name, placeholder: "Name", onChange: this.onChangeName}),
        ) : "",
        h("div", {className: "slds-form-element__control " + this.withName ? "slds-col slds-size_7-of-12" : "slds-col slds-size_10-of-12"},
          h("textarea", {id: "templateQuery", className: "slds-input", value: this.state.query, placeholder: this.placeholder, onChange: this.onChangeQuery}),
        ),
        h("div", {className: "slds-form-element__control slds-col slds-col slds-size_2-of-12 text-align-middle"},
          h("button", {onClick: this.addQueryTemplate, title: "Add", className: "slds-button slds-button_brand"}, "Add"),
        )
      ), this.state.queryTemplates.map((l, i) =>
        h("div", {key: "link" + i, className: "slds-grid slds-p-horizontal_small slds-p-vertical_xx-small"},
          h("div", {className: "slds-col slds-size_10-of-12 text-align-middle"},
            h("span", {}, ((this.withName && l.name) ? l.name + ":" : "") + (this.node ? l[this.node] : l))
          ),
          h("div", {className: "slds-col slds-size_2-of-12 text-align-middle"},
            h("button", {onClick: () => this.deleteQueryTemplate(i), title: "Delete", className: "slds-button slds-button_destructive"}, "Delete")
          )
        )
      ),
      h("div", {className: "slds-border_bottom"})
    );
  }
}


let h = React.createElement;

class App extends React.Component {

  constructor(props) {
    super(props);
    this.foo = undefined;
  }

  render() {
    let {model} = this.props;
    return h("div", {},
      h("div", {id: "user-info", className: "slds-border_bottom"},
        h("a", {href: model.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {className: "slds-text-title_bold"}, "Options"),
        h("span", {}, " / " + model.userInfo),
        h("div", {className: "flex-right"})),
      h("div", {className: "main-container slds-card slds-m-around_small"},
        h(OptionsTabSelector, {model}))
    );
  }
}

{

  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  let tab = args.get("tab") ? parseInt(args.get("tab")) : 1;
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {

    let root = document.getElementById("root");
    let model = new Model(sfHost, tab);
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

    if (parent && parent.isUnitTest) { // for unit tests
      parent.insextTestLoaded({model});
    }

  });

}
