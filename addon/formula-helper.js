/* global React ReactDOM */
import {sfConn} from "./inspector.js";
/* global initButton */
import {DescribeInfo, copyToClipboard} from "./data-load.js";
import {Editor} from "./editor.js";
import {tokenize, analyzeFormula} from "./formula-parser.js";
import {formatFormula} from "./formula-formatter.js";
import {FORMULA_FUNCTIONS, FORMULA_OPERATORS, FORMULA_LITERALS} from "./formula-functions.js";

const SPINNER_GIF = "data:image/gif;base64,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";

const DEFAULT_FORMULA = "IF(ISBLANK(Name), \"N/A\", UPPER(Name))";

// Keys that must never trigger a suggestion search/display on their own — see editorAutocompleteHandler.
const SUGGESTION_INERT_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape"]);

// Given the "(arg1, arg2, ...)" tail inserted after a function name, finds the span of the
// first argument placeholder so it can be selected for immediate overtype (e.g. inserting
// AND( selects "logical1" first). Returns a zero-length range right after "(" for 0-arg
// functions like TODAY().
function functionPlaceholderRange(suffix) {
  if (!suffix || suffix[0] != "(") {
    return null;
  }
  let depth = 0;
  let end = 1;
  while (end < suffix.length) {
    let ch = suffix[end];
    if (ch == "(") {
      depth++;
    } else if (ch == ")") {
      if (depth == 0) {
        break;
      }
      depth--;
    } else if (ch == "," && depth == 0) {
      break;
    }
    end++;
  }
  return {start: 1, end};
}

// Generated from FORMULA_FUNCTIONS: highlight any known function name the same way, regardless
// of category. Individual operators (+, &, etc.) are not colorable through this mechanism —
// editor.js only special-cases brackets/quotes and this keyword map, known v1 limitation.
const FORMULA_KEYWORD_COLOR = new Map([
  ...FORMULA_FUNCTIONS.map(f => [f.name.toLowerCase(), "teal"]),
  ["true", "blue"],
  ["false", "blue"],
  ["null", "blue"],
]);

class Model {
  constructor(sfHost, initialFormula) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.reactCallback = null;
    this.spinnerCount = 0;
    this.errorMessages = [];
    this.winInnerHeight = 0;

    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.autocompleteState = "";
      this.editorAutocompleteHandler({newDescribe: true});
      this.didUpdate();
    });
    this.selectedObject = "";

    this.editor = null;
    this.editorMirror = null;
    this.initialScript = initialFormula || "";
    this.historyStack = [];
    this.historyOffset = -1;

    this.autocompleteState = "";
    this.autocompleteResults = {title: " ", results: []};
    this.autocompleteClick = null;
    this.activeSuggestion = -1;
    this.displaySuggestion = true;
    this.autocompleteResultBox = null;
    this.suggestionTop = 0;
    this.suggestionLeft = 0;

    this.problems = [];
    this.copyStatus = "";
  }

  title() {
    return "Formula Helper";
  }

  /**
   * Notify React that we changed something, so it will rerender the view.
   */
  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
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

  setObject(name) {
    this.selectedObject = name;
    this.autocompleteState = "";
    if (name) {
      this.describeInfo.describeSobject(false, name);
    }
    this.didUpdate();
  }

  objectOptions() {
    let {globalStatus, globalDescribe} = this.describeInfo.describeGlobal(false);
    if (globalStatus != "ready") {
      return [];
    }
    return globalDescribe.sobjects.filter(s => s.queryable);
  }

  // --- Editor-consumer interface (pattern copied from apex-runner.js, isolated here) ---

  setEditor(editor) {
    this.editor = editor;
    editor.value = this.initialScript;
    this.historyStack = [{value: this.initialScript, selectionStart: 0, selectionEnd: 0}];
    this.historyOffset = 0;
    this.initialScript = null;
    this.recomputeProblems(editor.value);
  }

  recalculateSize() {
    // No viewport-dependent content on this page.
  }

  applyEdit(value, selectionStart, selectionEnd, mode = "preserve") {
    if (this.editor) {
      this.editor.setRangeText(value, selectionStart, selectionEnd, mode);
      this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
      this.recomputeProblems(this.editor.value);
    }
  }

  undoEdit() {
    if (this.editor && this.historyOffset > 0) {
      this.historyOffset--;
      let previous = this.historyStack[this.historyOffset];
      this.editor.value = previous.value;
      this.editor.selectionStart = previous.selectionStart;
      this.editor.selectionEnd = previous.selectionEnd;
      this.recomputeProblems(this.editor.value);
    }
  }

  redoEdit() {
    if (this.editor && this.historyOffset < this.historyStack.length - 1) {
      this.historyOffset++;
      let next = this.historyStack[this.historyOffset];
      this.editor.value = next.value;
      this.editor.selectionStart = next.selectionStart;
      this.editor.selectionEnd = next.selectionEnd;
      this.recomputeProblems(this.editor.value);
    }
  }

  writeEditHistory(value, selectionStart, selectionEnd, force) {
    const HISTORY_LIMIT = 100;
    const HISTORY_TIME_GAP = 3000;
    if (this.historyOffset != -1 && this.historyOffset < this.historyStack.length - 1) {
      this.historyStack = this.historyStack.slice(0, this.historyOffset + 1);
    }
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
        this.historyStack[this.historyOffset] = {value, selectionStart, selectionEnd, timestamp: last.timestamp};
        return;
      }
    }
    this.historyOffset++;
    this.historyStack.push({value, selectionStart, selectionEnd, timestamp: Date.now()});
  }

  handleEditorChange(value, selectionStart, selectionEnd) {
    this.writeEditHistory(value, selectionStart, selectionEnd, false);
    this.recomputeProblems(value);
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
    let scrolltop = (this.activeSuggestion * 22) - 100;
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
    let scrolltop = (this.activeSuggestion * 22) - 100;
    this.autocompleteResultBox.scrollTop = scrolltop > 0 ? scrolltop : 0;
    this.didUpdate();
    return true;
  }

  setSuggestionPosition(top, left) {
    if (this.suggestionTop == top && this.suggestionLeft == left) {
      return;
    }
    this.suggestionTop = top;
    this.suggestionLeft = left;
    this.didUpdate();
  }

  selectSuggestion() {
    if (!this.autocompleteResults || !this.autocompleteResults.results || this.autocompleteResults.results.length == 0) {
      return;
    }
    let idx = this.activeSuggestion > -1 ? this.activeSuggestion : 0;
    let ar = this.autocompleteResults.results;
    let selStart = this.editor.selectionStart;
    let selEnd = this.editor.selectionEnd;
    let searchTerm = selStart != selEnd
      ? this.editor.value.substring(selStart, selEnd)
      : this.editor.value.substring(0, selStart).match(/[A-Za-z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;
    this.editor.focus();
    this.insertSuggestion(ar[idx], selStart, selEnd);
  }

  // Inserts a suggestion's value+suffix at [selStart, selEnd]. For functions, the suffix carries
  // the full "(arg1, arg2, ...)" signature with fake parameter names (see formula-functions.js);
  // the first placeholder is selected afterwards so typing immediately overtypes it, instead of
  // just placing the caret at the end like a plain field/operator insertion.
  insertSuggestion(r, selStart, selEnd) {
    this.applyEdit(r.value + (r.suffix || ""), selStart, selEnd, "end");
    this.activeSuggestion = -1;
    if (r.autocompleteType == "function") {
      let placeholder = functionPlaceholderRange(r.suffix);
      if (placeholder) {
        let base = selStart + r.value.length;
        this.editor.setSelectionRange(base + placeholder.start, base + placeholder.end);
        this.hideSuggestion();
        return;
      }
    }
    this.editorAutocompleteHandler();
  }

  // --- Problems (real-time client-side checks) ---

  recomputeProblems(value) {
    this.problems = analyzeFormula(tokenize(value));
  }

  selectProblem(problem) {
    if (!this.editor) {
      return;
    }
    this.editor.focus();
    this.editor.setSelectionRange(problem.start, problem.end);
    this.didUpdate();
  }

  // --- Autocomplete ---

  resolveObjectForPath(pathParts, cb) {
    if (!this.selectedObject) {
      cb(null);
      return;
    }
    let vm = this; // eslint-disable-line consistent-this
    function walk(objectName, remainingParts) {
      if (remainingParts.length == 0) {
        cb(objectName);
        return;
      }
      let relName = remainingParts[0];
      let {sobjectStatus, sobjectDescribe} = vm.describeInfo.describeSobject(false, objectName, () => {
        vm.autocompleteState = "";
        vm.editorAutocompleteHandler({newDescribe: true});
        vm.didUpdate();
      });
      if (sobjectStatus != "ready" || !sobjectDescribe) {
        cb(null);
        return;
      }
      let field = sobjectDescribe.fields.find(f => f.relationshipName && f.relationshipName.toLowerCase() == relName.toLowerCase());
      if (!field || !field.referenceTo || field.referenceTo.length == 0) {
        cb(null);
        return;
      }
      // Polymorphic lookups (e.g. Owner) resolve to the first referenceTo entry, typically User.
      walk(field.referenceTo[0], remainingParts.slice(1));
    }
    walk(this.selectedObject, pathParts);
  }

  buildFieldSuggestions(objectName, term) {
    if (!objectName) {
      return [];
    }
    let {sobjectStatus, sobjectDescribe} = this.describeInfo.describeSobject(false, objectName);
    if (sobjectStatus != "ready" || !sobjectDescribe) {
      return [];
    }
    let t = term.toLowerCase();
    return sobjectDescribe.fields
      .filter(f => f.name.toLowerCase().includes(t) || (f.label && f.label.toLowerCase().includes(t)))
      .map(f => ({value: f.name, title: f.label + " (" + f.name + ")", suffix: "", autocompleteType: "fieldName", dataType: (f.type || "").toLowerCase(), rank: 0}));
  }

  buildFunctionSuggestions(term) {
    let t = term.toLowerCase();
    return FORMULA_FUNCTIONS
      .filter(f => f.name.toLowerCase().includes(t))
      .map(f => ({value: f.name, title: f.signature + " — " + f.description, suffix: f.signature.slice(f.name.length), autocompleteType: "function", dataType: "", rank: 1}));
  }

  buildLiteralSuggestions(term) {
    let t = term.toLowerCase();
    return FORMULA_LITERALS
      .filter(l => l.toLowerCase().includes(t))
      .map(l => ({value: l, title: l, suffix: "", autocompleteType: "literal", dataType: "", rank: 2}));
  }

  buildOperatorSuggestions() {
    // Operators aren't alphanumeric so they can never match the (alnum-only) search term;
    // only offer them as a static low-rank fallback when the caret isn't mid-word.
    return FORMULA_OPERATORS.map(op => ({value: op, title: op, suffix: " ", autocompleteType: "operator", dataType: "", rank: 3}));
  }

  compareSuggestions(term) {
    let t = term.toLowerCase();
    function score(r) {
      let v = r.value.toLowerCase();
      if (v == t) {
        return 0;
      }
      if (v.startsWith(t)) {
        return 1;
      }
      return 2;
    }
    return (a, b) => (score(a) - score(b)) || (a.rank - b.rank) || a.value.localeCompare(b.value);
  }

  editorAutocompleteHandler(e = {}) {
    let vm = this; // eslint-disable-line consistent-this
    if (!vm.editor) {
      return;
    }
    // Arrow keys and Escape must never (re)trigger a search or pop the suggestion box open on
    // their own: arrows either navigate the already-open list (handled directly by editor.js's
    // keydown handler via next/previousSuggestion) or just move the caret through the text, and
    // Escape's job is only to hide the box (model.hideSuggestion()) — same split as data-export.js.
    if (SUGGESTION_INERT_KEYS.has(e.key)) {
      return;
    }
    let script = vm.editor.value;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let newState = [script, selStart, selEnd].join("$");
    if (newState == vm.autocompleteState && !e.newDescribe) {
      return;
    }
    vm.autocompleteState = newState;

    let searchTerm = selStart != selEnd
      ? script.substring(selStart, selEnd)
      : script.substring(0, selStart).match(/[A-Za-z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;

    vm.autocompleteClick = r => {
      vm.editor.focus();
      vm.insertSuggestion(r, selStart, selEnd);
    };

    let pathParts = searchTerm.split(".");
    let term = pathParts.pop();

    vm.resolveObjectForPath(pathParts, targetObject => {
      let isTopLevel = pathParts.length == 0;
      let results = [
        ...vm.buildFieldSuggestions(targetObject, term),
        ...(isTopLevel ? vm.buildFunctionSuggestions(term) : []),
        ...(isTopLevel ? vm.buildLiteralSuggestions(term) : []),
        ...(isTopLevel ? vm.buildOperatorSuggestions() : []),
      ];
      vm.autocompleteResults = {
        title: vm.selectedObject ? "Suggestions for " + vm.selectedObject + ":" : "Select an object above for field suggestions",
        results: results.sort(vm.compareSuggestions(term))
      };
      vm.didUpdate();
    });
  }

  // --- Format & copy ---

  formatCurrentFormula() {
    if (!this.editor || this.problems.some(p => p.blocking)) {
      return;
    }
    let formatted = formatFormula(this.editor.value);
    if (formatted === this.editor.value) {
      return;
    }
    this.editor.focus();
    this.editor.setRangeText(formatted, 0, this.editor.value.length, "end");
    this.writeEditHistory(this.editor.value, this.editor.selectionStart, this.editor.selectionEnd, true);
    this.recomputeProblems(this.editor.value);
    this.didUpdate();
  }

  copyResult() {
    copyToClipboard(this.editor ? this.editor.value : "");
    this.copyStatus = "Copied!";
    this.didUpdate();
    setTimeout(() => {
      this.copyStatus = "";
      this.didUpdate();
    }, 1500);
  }
}

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onClickSuggestion = this.onClickSuggestion.bind(this);
  }
  componentDidMount() {
    let {vm} = this.props;
    vm.autocompleteResultBox = this.refs.autocompleteResultBox;
  }
  onClickSuggestion(e, r) {
    e.preventDefault();
    let {vm} = this.props;
    vm.autocompleteClick(r);
    vm.didUpdate();
  }
  render() {
    let {vm} = this.props;
    document.title = vm.title();
    return h("div", {},
      h("div", {className: "object-bar"},
        h("img", {id: "spinner", src: SPINNER_GIF, hidden: vm.spinnerCount == 0}),
        h("a", {href: vm.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {}, "Formula Helper")
      ),
      h("div", {className: "body"},
        vm.errorMessages.map((msg, i) => h("div", {className: "error-message", key: i}, msg)),
        h("div", {className: "formula-toolbar"},
          h("label", {htmlFor: "formula-object"}, "Object"),
          h("input", {id: "formula-object", list: "formula-object-list", value: vm.selectedObject, placeholder: "e.g. Account", onChange: e => vm.setObject(e.target.value)}),
          h("datalist", {id: "formula-object-list"}, vm.objectOptions().map(o => h("option", {value: o.name, key: o.name}))),
          h("button", {onClick: () => vm.formatCurrentFormula(), disabled: vm.problems.some(p => p.blocking), title: "Pretty-print the formula"}, "Format"),
          h("button", {onClick: () => vm.copyResult()}, vm.copyStatus || "Copy result")
        ),
        h(Editor, {model: vm, keywordColor: FORMULA_KEYWORD_COLOR, keywordCaseSensitive: false, stringDelimiter: "\"", enableComments: false}),
        h("div", {className: "autocomplete-box"},
          h("div", {ref: "autocompleteResultBox", className: "autocomplete-results autocomplete-results-over", hidden: !vm.displaySuggestion || vm.autocompleteResults.results.length == 0, style: {top: vm.suggestionTop + "px", left: vm.suggestionLeft + "px"}},
            vm.autocompleteResults.results.map((r, ri) =>
              h("div", {tabIndex: 0, title: r.title, className: "autocomplete-result " + r.autocompleteType + " " + r.dataType + (ri == vm.activeSuggestion ? " active" : ""), key: r.autocompleteType + r.value, onMouseDown: e => this.onClickSuggestion(e, r)},
                h("div", {className: "autocomplete-icon"}), r.value)
            )
          )
        ),
        h("div", {className: "problems-panel"},
          h("div", {className: "problems-header"}, vm.problems.length ? vm.problems.length + " problem(s)" : "No problems detected"),
          h("ul", {}, vm.problems.map((p, i) =>
            h("li", {key: i, className: "problem-" + p.severity, onClick: () => vm.selectProblem(p)},
              "Line " + p.line + ":" + p.col + " — " + p.message)
          ))
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
    let vm = new Model(sfHost, args.get("formula") || DEFAULT_FORMULA);
    vm.reactCallback = cb => {
      ReactDOM.render(h(App, {vm}), root, cb);
    };
    ReactDOM.render(h(App, {vm}), root);
  });

  {
    let isDragging = false;
    document.body.onmousedown = () => {
      isDragging = false;
    };
    document.body.onmousemove = e => {
      if (e.movementX || e.movementY) {
        isDragging = true;
      }
    };
    document.body.onclick = e => {
      if (!e.target.closest("a") && !isDragging) {
        let el = e.target.closest(".quick-select");
        if (el) {
          getSelection().selectAllChildren(el);
        }
      }
    };
  }
}
