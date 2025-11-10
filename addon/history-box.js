/* global React */
import {sfConn, apiVersion} from "./inspector.js";
const h = React.createElement;

export class QueryHistory {
  constructor(storageKey, max, compare, sorter) {
    this.storageKey = storageKey;
    this.max = max;
    this.list = this._get();
    this.compare = compare;
    this.sorter = sorter;
  }

  _get() {
    let history;
    try {
      history = JSON.parse(localStorage[this.storageKey]);
    } catch (e) {
    // empty
    }
    if (!Array.isArray(history)) {
      history = [];
    }
    // A previous version stored just strings. Skip entries from that to avoid errors.
    history = history.filter(e => typeof e == "object");
    this.sort(this.storageKey, history);
    return history;
  }

  add(entry) {
    let history = this._get();
    let historyIndex = history.findIndex(e => this.compare(e, entry));
    if (historyIndex > -1) {
      history.splice(historyIndex, 1);
    }
    history.splice(0, 0, entry);
    if (history.length > this.max) {
      history.pop();
    }
    localStorage[this.storageKey] = JSON.stringify(history);
    this.sort(this.storageKey, history);
  }

  remove(entry) {
    let history = this._get();
    //old and new format
    let historyIndex = history.findIndex(e => this.compare(e, entry));
    if (historyIndex > -1) {
      history.splice(historyIndex, 1);
    }
    localStorage[this.storageKey] = JSON.stringify(history);
    this.sort(this.storageKey, history);
  }

  clear() {
    localStorage.removeItem(this.storageKey);
    this.list = [];
  }

  sort(storageKey, history) {
    //sort only saved query not history
    if (storageKey.startsWith("insextSaved")) {
      history.sort(this.sorter);
    }
    this.list = history;
  }
}
export class HistoryBox extends React.Component {
  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
    this.onSuggestionClick = this.onSuggestionClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.state = {
      activeSuggestion: 0,
      filteredSuggestions: [],
      showSuggestions: false,
      seachTerms: ""
    };
  }
  onFocus() {
    let {didUpdate, suggestions} = this.props;
    let {seachTerms} = this.state;

    let filteredSuggestions = this.sortSuggestion(suggestions);
    if (seachTerms) {
      filteredSuggestions = suggestions.filter(
        suggestion =>
          suggestion.label.toLowerCase().indexOf(seachTerms.toLowerCase()) > -1
      );
    }
    this.setState({
      activeSuggestion: 0,
      filteredSuggestions,
      showSuggestions: true
    });
    didUpdate();
  }
  onBlur(e) {
    if (e.currentTarget.parentElement.parentElement.parentElement.contains(e.relatedTarget) && e.relatedTarget.tagName !== "BUTTON") {
      return;
    }
    let {didUpdate} = this.props;
    setTimeout(() => {
      //no need to refresh if already refresh by click on value
      if (!this.state || !this.state.showSuggestions) {
        return;
      }
      this.setState({
        activeSuggestion: 0,
        filteredSuggestions: [],
        showSuggestions: false,
        seachTerms: ""
      });
      didUpdate();
    }, 100); // Set timeout for 500ms
  }
  onChange(e) {
    let {didUpdate, suggestions} = this.props;
    const userInput = e.target.value;

    const filteredSuggestions = this.sortSuggestion(suggestions).filter(
      suggestion =>
        suggestion.label.toLowerCase().indexOf(userInput.toLowerCase()) > -1
    );

    this.setState({
      activeSuggestion: 0,
      filteredSuggestions,
      showSuggestions: true,
      seachTerms: userInput
    });
    didUpdate();
  }
  onSuggestionClick(e, activeSuggestion) {
    if (e.target.tagName == "BUTTON" || e.target.tagName == "USE") {
      return;
    }
    let {onSelect} = this.props;
    let {filteredSuggestions} = this.state;
    this.setState({
      activeSuggestion: 0,
      filteredSuggestions: [],
      showSuggestions: false,
      seachTerms: ""
    });

    onSelect(filteredSuggestions[activeSuggestion]);
  }
  //TODO store on value json stringify du json plutot que seulement value et utilisé ca pour le retrouver 
  onKeyDown(e){
    const {activeSuggestion, filteredSuggestions} = this.state;
    let {onSelect} = this.props;
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
          showSuggestions: false,
          seachTerms: ""
        });
        onSelect(filteredSuggestions[activeSuggestion]);
        e.preventDefault();
        break;
    }
  }
  sortSuggestion(suggestions){
    return suggestions.sort((a, b) => {
      if (a.favorite === b.favorite) {
        return 0;
      }
      return a.favorite ? -1 : 1;
    });

  }
  onDeleteItem(e, index) {
    e.preventDefault();
    e.stopPropagation();
    let {didUpdate, onDelete} = this.props;
    let {filteredSuggestions} = this.state;
    let suggestion = filteredSuggestions[index];
    filteredSuggestions.splice(index, 1);
    this.setState({
      filteredSuggestions
    });
    onDelete(suggestion);
    didUpdate();
  }
  toggleFav(e, index) {
    e.preventDefault();
    e.stopPropagation();
    let {didUpdate, onUpdate} = this.props;
    let {filteredSuggestions} = this.state;
    filteredSuggestions[index].favorite = !filteredSuggestions[index].favorite;
    onUpdate(filteredSuggestions[index]);
    this.setState({
      filteredSuggestions: this.sortSuggestion(filteredSuggestions)
    });
    didUpdate();
  }
  render() {
    let {activeSuggestion, filteredSuggestions, showSuggestions} = this.state;
    return h("div", {className: "slds-form-element slds-nowrap"},
      h("div", {className: "slds-form-element__control slds-wrap"},
        h("div", {className: "slds-combobox_container"},
          h("div", {className: "slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click slds-is-open"},
            h("div", {className: "slds-combobox__form-element slds-input-has-icon slds-input-has-icon_right", role: "none"}, // slds-button slds-button_first slds-nowrap
              h("input", {type: "text", className: "slds-input slds-combobox__input" + (showSuggestions ? " slds-has-focus" : ""), "aria-autocomplete": "list", "aria-controls": "listbox-id-2", "aria-expanded": (showSuggestions ? "true" : "false"), "aria-haspopup": "listbox", autoComplete: "off", role: "combobox", placeholder: showSuggestions ? "Search..." : this.props.title, value: this.state.seachTerms, onChange: this.onChange, onFocus: this.onFocus, onBlur: this.onBlur, onKeyDown: this.onKeyDown}),
              h("span", {className: "slds-icon_container slds-icon-utility-search slds-input__icon slds-input__icon_right"},
                h("svg", {className: "slds-icon slds-icon_x-small slds-icon-text-default", "aria-hidden": "true"},
                  h("use", {xlinkHref: "symbols.svg#search"})
                )
              )
            ),
            (showSuggestions && filteredSuggestions.length)
              ? h("div", {id: "listbox-id-2", className: "slds-dropdown slds-dropdown_length-5 slds-dropdown_fluid", role: "listbox", "aria-label": "{{Placeholder for Dropdown Items}}", tabIndex: "0", "aria-busy": "false"},
                h("ul", {className: "slds-listbox slds-listbox_vertical", role: "presentation"},
                  filteredSuggestions.map((suggestion, index) => {
                    let SuggestionClass = "slds-listbox-item"; //slds-media
                    if (index === activeSuggestion) {
                      SuggestionClass += " history-suggestion-active";
                    }
                    return h("li", {role: "presentation", className: SuggestionClass, key: "historySuggestion" + index, onMouseDown: (e) => this.onSuggestionClick(e, index)},
                      h("div", {id: "option" + index, className: "slds-media slds-listbox__option slds-listbox__option_plain slds-media_small", role: "option", "aria-selected": (index === activeSuggestion ? "true" : "false")}, // slds-listbox__option slds-listbox__option_plain slds-media_small slds-combobox__form-element
                        // h("span", {className: "slds-media__figure slds-listbox__option-icon slds-align-middle", title: suggestion.favorite ? "Remove from favorite" : "Add to favorite"},
                        //   h("span", {className: "slds-icon_container slds-current-color slds-icon-utility-check slds-current-color", onMouseDown: (e) => this.toggleFav(e, index)},
                        //     h("svg", {className: "slds-icon slds-icon_x-small slds-icon-text-default" + (suggestion.favorite ? " " : " favorite-inverse"), "aria-hidden": "true"},
                        //       h("use", {xlinkHref: "symbols.svg#favorite"})
                        //     )
                        //   )
                        // ),
                        h("span", {className: "slds-media__body slds-align-middle"},
                          h("span", {className: "slds-truncate", title: suggestion.label},
                            suggestion.label
                          )
                        ),
                        this.props.onDelete ? h("button", {className: "slds-button slds-button_icon slds-input__icon", title: "Delete", onMouseDown: (e) => this.onDeleteItem(e, index)},
                          h("svg", {className: "slds-button__icon", "aria-hidden": "true"},
                            h("use", {xlinkHref: "symbols.svg#delete"})
                          )
                        ) : null
                      )
                    );
                  })
                )
              ) : ""
          )
        )
      )
    );
  }
}
