/* global React */
const h = React.createElement;

// Helper function to extract main object from FROM clause
function extractMainObject(query) {
  if (!query) return null;
  const fromMatch = query.match(/\bFROM\s+(\w+)/i);
  if (fromMatch && fromMatch[1]) {
    return fromMatch[1];
  }
  return null;
}

// Helper function to generate color from tag hash
function getTagColor(tag) {
  if (!tag) return "#808080";
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate a color with good contrast (avoid too dark or too light)
  const hue = Math.abs(hash % 360);
  const saturation = 50 + (Math.abs(hash) % 30); // 50-80%
  const lightness = 45 + (Math.abs(hash) % 15); // 45-60%
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

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
    // Ensure tags array exists and auto-add main object as tag for all queries
    history.forEach(entry => {
      if (!entry.tags || !Array.isArray(entry.tags)) {
        entry.tags = [];
      }
      // Auto-add main object as tag if not present
      const mainObject = extractMainObject(entry.query);
      if (mainObject && !entry.tags.includes(mainObject)) {
        entry.tags.push(mainObject);
      }
    });
    this.sort(this.storageKey, history);
    return history;
  }
  update(position, entry) {
    let history = this._get();
    history[position] = entry;
    localStorage[this.storageKey] = JSON.stringify(history);
    this.sort(this.storageKey, history);
  }

  add(entry) {
    let history = this._get();
    let historyIndex = history.findIndex(e => this.compare(e, entry));
    if (historyIndex > -1) {
      history.splice(historyIndex, 1);
    }
    // Ensure tags array exists
    if (!entry.tags || !Array.isArray(entry.tags)) {
      entry.tags = [];
    }
    // Auto-add main object as tag if not present for all queries
    const mainObject = extractMainObject(entry.query);
    if (mainObject && !entry.tags.includes(mainObject)) {
      entry.tags.push(mainObject);
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
    this.onDeleteTag = this.onDeleteTag.bind(this);
    this.onAddTag = this.onAddTag.bind(this);
    this.onTagInputKeyDown = this.onTagInputKeyDown.bind(this);
    this.onRenameStart = this.onRenameStart.bind(this);
    this.onRenameChange = this.onRenameChange.bind(this);
    this.onRenameQueryChange = this.onRenameQueryChange.bind(this);
    this.onRenameKeyDown = this.onRenameKeyDown.bind(this);
    this.onRenameBlur = this.onRenameBlur.bind(this);
    this.onToggleExpand = this.onToggleExpand.bind(this);
    this.matchesSearchTerms = this.matchesSearchTerms.bind(this);
    this.state = {
      activeSuggestion: 0,
      filteredSuggestions: [],
      showSuggestions: false,
      seachTerms: "",
      expandedQueries: new Set(),
      renamingIndex: null,
      renameValue: "",
      renameQueryValue: "",
      tagInputs: {}
    };
  }
  matchesSearchTerms(suggestion, searchTerms) {
    if (!searchTerms || !searchTerms.trim()) {
      return true;
    }
    // Split search terms by spaces and filter out empty strings
    const terms = searchTerms.toLowerCase().split(/\s+/).filter(term => term.length > 0);
    if (terms.length === 0) {
      return true;
    }
    // Get all searchable text from the suggestion
    const labelText = (suggestion.label || "").toLowerCase();
    const queryText = (suggestion.value || suggestion.query || "").toLowerCase();
    const tagTexts = (suggestion.tags || []).map(tag => tag.toLowerCase());
    // Check if ALL terms are found individually in any of the searchable fields
    // Each term must be found in at least one field (label, query, or tags)
    //do not match on query if name is present
    return terms.every(term =>
      labelText.indexOf(term) > -1
      || (!suggestion.name && queryText.indexOf(term) > -1)
      || tagTexts.some(tag => tag.indexOf(term) > -1)
    );
  }
  onFocus() {
    let {didUpdate, suggestions} = this.props;
    let {seachTerms} = this.state;

    let filteredSuggestions = this.sortSuggestion(suggestions);
    if (seachTerms) {
      filteredSuggestions = suggestions.filter(suggestion => this.matchesSearchTerms(suggestion, seachTerms));
    }
    this.setState({
      activeSuggestion: 0,
      filteredSuggestions,
      showSuggestions: true
    });
    didUpdate();
  }
  onBlur(e) {
    const dropdownContainer = e.currentTarget.parentElement.parentElement.parentElement;
    // Don't close if focus is moving to an element within the dropdown (buttons, inputs, etc.)
    if (dropdownContainer.contains(e.relatedTarget)) {
      return;
    }
    // Don't close if we're currently renaming
    if (this.state && this.state.renamingIndex !== null) {
      return;
    }
    let {didUpdate} = this.props;
    setTimeout(() => {
      //no need to refresh if already refresh by click on value
      if (!this.state || !this.state.showSuggestions) {
        return;
      }
      // Don't close if we're currently renaming
      if (this.state.renamingIndex !== null) {
        return;
      }
      this.setState({
        activeSuggestion: 0,
        filteredSuggestions: [],
        showSuggestions: false,
        seachTerms: ""
      });
      didUpdate();
    }, 100);
  }
  onChange(e) {
    let {didUpdate, suggestions} = this.props;
    const userInput = e.target.value;

    const filteredSuggestions = this.sortSuggestion(suggestions).filter(
      suggestion => this.matchesSearchTerms(suggestion, userInput)
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
    if (e.target.tagName == "BUTTON" || e.target.tagName == "USE" || e.target.tagName == "INPUT") {
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
      // First, sort by favorite status
      if (a.favorite !== b.favorite) {
        return a.favorite ? -1 : 1;
      }
      // If both are favorites, sort by name if both have names
      if (a.favorite && b.favorite) {
        const aName = a.name || a.label || "";
        const bName = b.name || b.label || "";
        // If both have names, sort alphabetically
        if (aName && bName) {
          return aName.localeCompare(bName);
        }
        // If only one has a name, prioritize the one with a name
        if (aName && !bName) {
          return -1;
        }
        if (!aName && bName) {
          return 1;
        }
      }
      return 0;
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
  onDeleteTag(e, index, tagIndex) {
    e.preventDefault();
    e.stopPropagation();
    let {didUpdate, onUpdate} = this.props;
    let {filteredSuggestions} = this.state;
    let suggestion = filteredSuggestions[index];
    if (suggestion.tags && suggestion.tags.length > tagIndex) {
      suggestion.tags.splice(tagIndex, 1);
      if (onUpdate) {
        onUpdate(suggestion);
      }
      this.setState({
        filteredSuggestions: [...filteredSuggestions]
      });
      didUpdate();
    }
  }
  onAddTag(e, index) {
    e.preventDefault();
    e.stopPropagation();
    let {didUpdate, onUpdate} = this.props;
    let {filteredSuggestions, tagInputs} = this.state;
    let suggestion = filteredSuggestions[index];
    const tagInput = tagInputs[index] || "";
    const tag = tagInput.trim();
    if (tag) {
      // Initialize tags array if it doesn't exist
      if (!suggestion.tags) {
        suggestion.tags = [];
      }
      // Add tag if it doesn't already exist
      if (!suggestion.tags.includes(tag)) {
        suggestion.tags.push(tag);
        tagInputs[index] = "";
        if (onUpdate) {
          onUpdate(suggestion);
        }
        this.setState({
          filteredSuggestions: [...filteredSuggestions],
          tagInputs: {...tagInputs}
        });
        didUpdate();
      } else {
        // Tag already exists, just clear the input
        tagInputs[index] = "";
        this.setState({
          tagInputs: {...tagInputs}
        });
      }
    }
  }
  onTagInputKeyDown(e, index) {
    if (e.keyCode === 13) {
      e.preventDefault();
      this.onAddTag(e, index);
    } else if (e.keyCode === 27) {
      let {tagInputs} = this.state;
      tagInputs[index] = "";
      this.setState({tagInputs: {...tagInputs}});
    }
  }
  onRenameStart(e, index) {
    e.preventDefault();
    e.stopPropagation();
    let {filteredSuggestions} = this.state;
    let suggestion = filteredSuggestions[index];
    this.setState({
      renamingIndex: index,
      renameValue: suggestion.name || suggestion.label || "",
      renameQueryValue: suggestion.value || suggestion.query || ""
    });
  }
  onRenameChange(e) {
    this.setState({
      renameValue: e.target.value
    });
  }
  onRenameQueryChange(e) {
    this.setState({
      renameQueryValue: e.target.value
    });
  }
  onRenameKeyDown(e, index) {
    if (e.keyCode === 13) {
      e.preventDefault();
      this.onRenameBlur(e, index);
    } else if (e.keyCode === 27) {
      let {didUpdate} = this.props;
      this.setState({
        renamingIndex: null,
        renameValue: "",
        renameQueryValue: "",
        showSuggestions: false,
        activeSuggestion: 0,
        filteredSuggestions: [],
        seachTerms: ""
      });
      didUpdate();
    }
  }
  onRenameBlur(e, index) {
    // Don't save if focus is moving to another element in the dropdown
    const dropdownContainer = e.currentTarget.closest(".slds-dropdown");
    if (dropdownContainer && dropdownContainer.contains(e.relatedTarget)) {
      return;
    }
    let {didUpdate, onUpdate} = this.props;
    let {filteredSuggestions, renameValue, renameQueryValue} = this.state;
    let suggestion = filteredSuggestions[index];
    const newName = renameValue.trim();
    const newQuery = renameQueryValue.trim();
    let hasChanges = false;

    // Update name if changed
    const currentName = (suggestion.name || suggestion.label || "").trim();
    if (newName !== currentName) {
      if (newName) {
        suggestion.name = newName;
        suggestion.label = newName;
      } else {
        // Clear name if empty
        delete suggestion.name;
        suggestion.label = suggestion.value || suggestion.query || "";
      }
      hasChanges = true;
    }

    // Update query if changed (preserve original if newQuery is empty or unchanged)
    const currentQuery = (suggestion.value || suggestion.query || "").trim();
    const finalQuery = newQuery || currentQuery; // Use newQuery if provided, otherwise preserve current
    if (newQuery && newQuery !== currentQuery) {
      suggestion.value = newQuery;
      suggestion.query = newQuery;
      hasChanges = true;
    } else {
      // Ensure query is preserved even if only name changed
      suggestion.value = finalQuery;
      suggestion.query = finalQuery;
    }

    if (hasChanges) {
      if (onUpdate) {
        onUpdate(suggestion);
      }
    }
    this.setState({
      renamingIndex: null,
      renameValue: "",
      renameQueryValue: "",
      showSuggestions: false,
      activeSuggestion: 0,
      filteredSuggestions: [],
      seachTerms: ""
    });
    didUpdate();
  }
  onToggleExpand(e, index) {
    e.preventDefault();
    e.stopPropagation();
    let {expandedQueries} = this.state;
    if (expandedQueries.has(index)) {
      expandedQueries.delete(index);
    } else {
      expandedQueries.add(index);
    }
    this.setState({
      expandedQueries: new Set(expandedQueries)
    });
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
    let {activeSuggestion, filteredSuggestions, showSuggestions, expandedQueries, renamingIndex, renameValue, renameQueryValue, tagInputs} = this.state;
    return h("div", {className: "slds-form-element slds-nowrap"},
      h("div", {className: "slds-form-element__control slds-wrap"},
        h("div", {className: "slds-combobox_container"},
          h("div", {className: "slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click slds-is-open"},
            h("div", {className: "slds-combobox__form-element slds-input-has-icon slds-input-has-icon_right", role: "none"},
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
                    let SuggestionClass = "slds-listbox-item";
                    if (index === activeSuggestion) {
                      SuggestionClass += " history-suggestion-active";
                    }
                    const isExpanded = expandedQueries.has(index);
                    const isRenaming = renamingIndex === index;
                    const hasName = suggestion.name || (suggestion.label && suggestion.label !== suggestion.value);
                    const queryValue = suggestion.value || suggestion.query || "";
                    const displayName = suggestion.name || suggestion.label || queryValue.substring(0, 50);
                    const tags = suggestion.tags || [];

                    return h("li", {role: "presentation", className: SuggestionClass, key: "historySuggestion" + index, onMouseDown: (e) => this.onSuggestionClick(e, index)},
                      h("div", {id: "option" + index, className: "slds-media slds-listbox__option slds-listbox__option_plain slds-media_small", role: "option", "aria-selected": (index === activeSuggestion ? "true" : "false")},
                        h("span", {className: "slds-media__body slds-align-middle", style: {width: "100%"}},
                          // Title/Name section
                          h("div", {className: "slds-grid slds-grid_align-spread slds-m-bottom_xx-small"},
                            h("div", {className: "slds-col", style: {flex: "1", minWidth: 0}},
                              isRenaming ? h("div", {style: {display: "flex", flexDirection: "column", gap: "4px"}},
                                h("input", {
                                  type: "text",
                                  className: "slds-input slds-input_small",
                                  placeholder: "Name",
                                  value: renameValue,
                                  onChange: (e) => this.onRenameChange(e),
                                  onKeyDown: (e) => this.onRenameKeyDown(e, index),
                                  onBlur: (e) => this.onRenameBlur(e, index),
                                  onClick: (e) => e.stopPropagation(),
                                  onMouseDown: (e) => e.stopPropagation(),
                                  style: {width: "100%"},
                                  autoFocus: true
                                }),
                                h("textarea", {
                                  className: "slds-textarea slds-input_small",
                                  placeholder: "Query",
                                  value: renameQueryValue,
                                  onChange: (e) => this.onRenameQueryChange(e),
                                  onKeyDown: (e) => this.onRenameKeyDown(e, index),
                                  onBlur: (e) => this.onRenameBlur(e, index),
                                  onClick: (e) => e.stopPropagation(),
                                  onMouseDown: (e) => e.stopPropagation(),
                                  style: {
                                    width: "100%",
                                    minHeight: "60px",
                                    fontFamily: "monospace",
                                    fontSize: "0.75rem",
                                    resize: "vertical"
                                  },
                                  rows: 3
                                })
                              )
                              : h("span", {
                                className: "slds-truncate",
                                title: displayName,
                                style: {fontWeight: hasName ? "bold" : "normal"}
                              }, displayName)
                            ),
                            h("div", {className: "slds-no-flex"},
                              h("div", {className: "slds-button-group", style: {display: "flex", gap: "2px"}},
                                hasName && this.props.onUpdate ? h("button", {
                                  className: "slds-button slds-button_icon slds-button_icon-x-small",
                                  title: "Rename",
                                  onMouseDown: (e) => this.onRenameStart(e, index),
                                  onClick: (e) => e.stopPropagation()
                                },
                                h("svg", {className: "slds-button__icon slds-button__icon_small", "aria-hidden": "true"},
                                  h("use", {xlinkHref: "symbols.svg#edit"})
                                )
                                ) : null,
                                queryValue ? h("button", {
                                  className: "slds-button slds-button_icon slds-button_icon-x-small",
                                  title: isExpanded ? "Collapse query" : "Expand query",
                                  onMouseDown: (e) => this.onToggleExpand(e, index),
                                  onClick: (e) => e.stopPropagation()
                                },
                                h("svg", {className: "slds-button__icon slds-button__icon_small", "aria-hidden": "true"},
                                  h("use", {xlinkHref: isExpanded ? "symbols.svg#chevronup" : "symbols.svg#chevrondown"})
                                )
                                ) : null,
                                this.props.onDelete ? h("button", {
                                  className: "slds-button slds-button_icon slds-button_icon-x-small",
                                  title: "Delete",
                                  onMouseDown: (e) => this.onDeleteItem(e, index),
                                  onClick: (e) => e.stopPropagation()
                                },
                                h("svg", {className: "slds-button__icon slds-button__icon_small", "aria-hidden": "true"},
                                  h("use", {xlinkHref: "symbols.svg#delete"})
                                )
                                ) : null
                              )
                            )
                          ),
                          // Expanded query display
                          isExpanded && queryValue ? h("div", {
                            className: "slds-m-top_xx-small slds-p-around_xx-small",
                            style: {
                              backgroundColor: "#f3f2f2",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontFamily: "monospace",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              maxHeight: "200px",
                              overflow: "auto"
                            },
                            onClick: (e) => e.stopPropagation(),
                            onMouseDown: (e) => e.stopPropagation()
                          }, queryValue) : null,
                          // Tags section
                          tags.length > 0 || this.props.onUpdate ? h("div", {
                            className: "slds-m-top_xx-small",
                            style: {display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center"}
                          },
                          tags.map((tag, tagIndex) => {
                            const tagColor = getTagColor(tag);
                            return h("span", {
                              key: "tag-" + index + "-" + tagIndex,
                              className: "slds-badge",
                              style: {
                                backgroundColor: tagColor,
                                color: "#fff",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "2px 6px",
                                fontSize: "0.75rem"
                              },
                              onClick: (e) => e.stopPropagation(),
                              onMouseDown: (e) => e.stopPropagation()
                            },
                            h("span", {}, tag),
                            this.props.onUpdate ? h("button", {
                              className: "slds-button slds-button_icon slds-button_icon-x-small",
                              title: "Remove tag",
                              style: {color: "#fff", padding: "0", marginLeft: "2px"},
                              onMouseDown: (e) => this.onDeleteTag(e, index, tagIndex),
                              onClick: (e) => e.stopPropagation()
                            },
                            h("svg", {className: "slds-button__icon slds-button__icon_x-small", "aria-hidden": "true", style: {width: "0.5rem", height: "0.5rem"}},
                              h("use", {xlinkHref: "symbols.svg#close"})
                            )
                            ) : null
                            );
                          }),
                          this.props.onUpdate ? h("span", {
                            style: {display: "inline-flex", alignItems: "center", gap: "2px"},
                            onClick: (e) => e.stopPropagation(),
                            onMouseDown: (e) => e.stopPropagation()
                          },
                          h("input", {
                            type: "text",
                            className: "slds-input slds-input_small",
                            placeholder: "Add tag...",
                            value: tagInputs[index] || "",
                            onChange: (e) => {
                              let newTagInputs = {...tagInputs};
                              newTagInputs[index] = e.target.value;
                              this.setState({tagInputs: newTagInputs});
                            },
                            onKeyDown: (e) => this.onTagInputKeyDown(e, index),
                            onClick: (e) => e.stopPropagation(),
                            onMouseDown: (e) => e.stopPropagation(),
                            style: {width: "80px", height: "20px", fontSize: "0.75rem", padding: "2px 4px"}
                          })
                          ) : null
                          ) : null
                        )
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
