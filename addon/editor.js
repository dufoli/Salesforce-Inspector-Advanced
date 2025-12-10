/* global React */
let h = React.createElement;

export class Editor extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.keywordColor = props.keywordColor;
    this.keywordCaseSensitive = props.keywordCaseSensitive;
    this.handlekeyDown = this.handlekeyDown.bind(this);
    this.handleChange = this.handleChange.bind(this);
    this.editorAutocompleteEvent = this.editorAutocompleteEvent.bind(this);
    this.onScroll = this.onScroll.bind(this);
    this.processText = this.processText.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.numberOfLines = 1;
    this.state = {scrolltop: 0, lineHeight: 0};
  }

  componentDidMount() {
    let {model} = this.props;
    let editorInput = this.refs.editor;
    let editorMirror = this.refs.editorMirror;
    model.editorMirror = editorMirror;
    model.setEditor(editorInput);
    const textareaStyles = window.getComputedStyle(editorInput);
    [
      "border",
      "boxSizing",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "letterSpacing",
      "lineHeight",
      "padding",
      "textDecoration",
      "textIndent",
      "textTransform",
      "whiteSpace",
      "wordSpacing",
      "wordWrap",
    ].forEach((property) => {
      editorMirror.style[property] = textareaStyles[property];
    });
    this.setState({lineHeight: textareaStyles.lineHeight});
    editorMirror.style.borderColor = "transparent";

    //const parseValue = (v) => v.endsWith("px") ? parseInt(v.slice(0, -2), 10) : 0;
    //const borderWidth = parseValue(textareaStyles.borderWidth);

    //Set the cursor focus on script text area use the same than query
    if (localStorage.getItem("disableQueryInputAutoFocus") !== "true"){
      editorInput.focus();
    }
    let recalculateHeight = model.recalculateSize.bind(model);
    const ro = new ResizeObserver(() => {
      editorInput.getBoundingClientRect().height;
      editorMirror.style.height = `${editorInput.getBoundingClientRect().height}px`;
      editorMirror.style.width = `${editorInput.getBoundingClientRect().width}px`;
      recalculateHeight();
    });
    ro.observe(editorInput);

    /*
    if (!window.webkitURL) {
      // Firefox
      // Firefox does not fire a resize event. The next best thing is to listen to when the browser changes the style.height attribute.
      new MutationObserver(recalculateHeight).observe(editorInput, {attributes: true});
    } else {
      // Chrome
      // Chrome does not fire a resize event and does not allow us to get notified when the browser changes the style.height attribute.
      // Instead we listen to a few events which are often fired at the same time.
      // This is not required in Firefox, and Mozilla reviewers don't like it for performance reasons, so we only do this in Chrome via browser detection.
      editorInput.addEventListener("mousemove", recalculateHeight);
      addEventListener("mouseup", recalculateHeight);
    }
    */
    function resize() {
      model.winInnerHeight = innerHeight;
      model.didUpdate(); // Will call recalculateSize
    }
    addEventListener("resize", resize);
    resize();
  }

  onScroll() {
    let {model} = this.props;
    if (model.editorMirror && model.editor) {
      model.editorMirror.scrollTop = model.editor.scrollTop;
    }
    this.setState({scrolltop: model.editor.scrollTop});
  }
  editorAutocompleteEvent(e) {
    let {model} = this.props;
    if (e.type == "select" && !model.displaySuggestion) {
      return;
    }
    model.editorAutocompleteHandler(e);
    model.didUpdate();
  }
  handleChange(e) {
    let {model} = this.props;
    model.handleEditorChange(e.currentTarget.value, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
  }
  handlekeyDown(e) {
    // We do not want to perform Salesforce API calls for autocomplete on every keystroke, so we only perform these when the user pressed Ctrl+Space
    // Chrome on Linux does not fire keypress when the Ctrl key is down, so we listen for keydown. Might be https://code.google.com/p/chromium/issues/detail?id=13891#c50
    let {model} = this.props;
    const {value, selectionStart, selectionEnd} = e.currentTarget;
    const tabChar = "  ";//default is 2 spaces
    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      model.undoEdit();
      return;
    }
    if (e.ctrlKey && e.key === "y") {
      e.preventDefault();
      model.redoEdit();
      return;
    }
    switch (e.key) {
      case " ":
        if (e.ctrlKey) {
          e.preventDefault();
          if (model.displaySuggestion) {
            model.selectSuggestion();
          } else {
            model.showSuggestion();
          }
        }
        break;
      case "ArrowRight":
      case "ArrowLeft":
        //naviguation reset active suggestion
        if (model.displaySuggestion && model.activeSuggestion != -1) {
          model.activeSuggestion = -1;
        }
        return;
      case "ArrowDown":
        if (model.displaySuggestion) {
          if (model.nextSuggestion()) {
            e.preventDefault();
          }
        }
        return;
      case "ArrowUp":
        if (model.displaySuggestion) {
          if (model.previousSuggestion()) {
            e.preventDefault();
          }
        }
        return;
      case "Enter":
        if (model.displaySuggestion && model.activeSuggestion != -1) {
          e.preventDefault();
          model.selectSuggestion();
        }
        break;
      case "Escape":
        e.preventDefault();
        model.activeSuggestion = -1;
        model.hideSuggestion();
        return;
      case "Tab": {
        //TODO option to select 2 spaces, 4 spaces or tab \t
        let selectedText = value.substring(selectionStart, selectionEnd);
        let mod = 0;
        e.preventDefault();
        if (e.shiftKey) {
          //unindent
          let lineStart = value.substring(0, selectionStart + 1).lastIndexOf("\n") + 1;
          if (value.substring(lineStart).startsWith(tabChar)) {
            model.editor.setRangeText("", lineStart, lineStart + 2, "preserve");
            mod -= tabChar.length;
          }
          let breakLineRegEx = /\n/gmi;
          let breakLineMatch;
          while ((breakLineMatch = breakLineRegEx.exec(selectedText)) !== null) {
            lineStart = selectionStart + breakLineMatch.index + breakLineMatch[0].length;
            if (value.substring(lineStart).startsWith(tabChar)) {
              model.editor.setRangeText("", lineStart + mod, lineStart + 2 + mod, "preserve");
              mod -= tabChar.length;
            }
          }
        } else if (selectionStart !== selectionEnd) {
          //indent
          let lineStart = value.substring(0, selectionStart + 1).lastIndexOf("\n") + 1;
          model.editor.setRangeText(tabChar, lineStart, lineStart, "preserve");
          mod += tabChar.length;
          let breakLineRegEx = /\n/gmi;
          let breakLineMatch;
          while ((breakLineMatch = breakLineRegEx.exec(selectedText)) !== null) {
            lineStart = selectionStart + breakLineMatch.index + breakLineMatch[0].length;
            model.editor.setRangeText(tabChar, lineStart + mod, lineStart + mod, "preserve");
            mod += tabChar.length;
          }
        } else if (model.displaySuggestion && model.activeSuggestion) {
          model.selectSuggestion();
        } else {
          model.editor.setRangeText(tabChar, selectionStart, selectionStart, "preserve");
        }
        break;
      }
      case "[":
      case "(":
      case "{":
      case "'":
      case "\"": {
        e.preventDefault();
        const openToCloseChar = new Map([
          ["[", "]"],
          ["(", ")"],
          ["{", "}"],
          ["'", "'"],
          ["\"", "\""],
        ]);
        const closeChar = openToCloseChar.get(e.key);
        // if quote (or any other start char) before and quote (or any other corresponding end char) right after it do not add quote (or the corresponding end char) but just move cursor after the it
        if ((e.key === "'" || e.key === "\"") && selectionStart > 0 && selectionEnd < model.editor.value.length && selectionStart === selectionEnd && model.editor.value.substring(selectionStart - 1, selectionStart) == e.key && model.editor.value.substring(selectionEnd, selectionEnd + 1) == closeChar) {
          model.editor.setRangeText("", selectionEnd + 1, selectionEnd + 1, "end");
        } else {
          model.editor.setRangeText(e.key, selectionStart, selectionStart, "end");
          // add of close quote after open quote happend only if nxt character is space, break line, close parenthesis, close bracket... maybe just if next charactere is not a-z or 0-9
          // look for char at + 1 because start char is already inserted
          if (selectionStart != selectionEnd) {
            model.editor.setRangeText(closeChar, selectionEnd + 1, selectionEnd + 1, "preserve");
          } else if (
            // If parenthesis, brace or bracket
            (e.key !== "'" && e.key !== "\"")
            // Or one side is a whitespace or a carriage return
            || (selectionEnd + 1 < model.editor.value.length && /[\n|\s]/.test(model.editor.value.substring(selectionEnd + 1, selectionEnd + 2)))
            || (selectionEnd > 0 && /[\n|\s]/.test(model.editor.value.substring(selectionEnd - 1, selectionEnd)))
            // Or end of document
            || selectionEnd + 1 === model.editor.value.length
            // Or start of document
            || selectionEnd === 0) {
            model.editor.setRangeText(closeChar, selectionEnd + 1, selectionEnd + 1, "preserve");
          }
        }
        break;
      }
      case "]":
      case ")":
      case "}": {
        // if quote (or any other start char) before and quote (or any other corresponding end char) right after it do not add quote (or the corresponding end char) but just move cursor after the it
        const closeToOpenChar = new Map([
          ["]", "["],
          [")", "("],
          ["}", "{"],
        ]);
        const openChar = closeToOpenChar.get(e.key);
        // if start char before and corresponding end char right after it do not add the corresponding end char but just move cursor after the it
        if (selectionStart === selectionEnd && model.editor.value.substring(selectionStart - 1, selectionStart) == openChar && model.editor.value.substring(selectionEnd, selectionEnd + 1) == e.key) {
          e.preventDefault();
          model.editor.setRangeText("", selectionEnd + 1, selectionEnd + 1, "end");
        }
        break;
      }
      case "Backspace": {
        const textBeforeCaret = value.substring(0, selectionStart);
        let indentRgEx = new RegExp("\n(" + tabChar + ")+$", "g");
        if (selectionStart == selectionEnd && textBeforeCaret.match(indentRgEx)) {
          e.preventDefault();
          model.editor.setRangeText("", selectionStart, selectionStart - tabChar.length, "preserve");
        }
        //TODO if previous input without other keydown (even move)is openChar then delete open and closeChar
        break;
      }
    }
    if (!model.displaySuggestion && e.key != "Control" && e.key != "Shift" && e.key != "Alt" && e.key != "Meta" && e.key != "Escape") {
      model.displaySuggestion = true;
    }
  }
  handleMouseUp() {
    let {model} = this.props;
    if (!model.displaySuggestion) {
      model.activeSuggestion = -1;
      // disable show suggestion on click
      //model.showSuggestion();
    }
  }
  onBlur(e) {
    let {model} = this.props;
    model.activeSuggestion = -1;
    if (e.relatedTarget && e.relatedTarget.parentElement && e.relatedTarget.parentElement.classList.contains("autocomplete-result")) {
      model.displaySuggestion = false;//to avoid didUpdate that will be done in click of suggestion
    } else {
      model.hideSuggestion();
    }
  }
  componentWillUnmount() {
    //let {model} = this.props;
    //TODO
  }

  componentDidUpdate() {
    let {model} = this.props;
    let caretEle = model.editorMirror.getElementsByClassName("editor_caret")[0];
    if (caretEle) {
      const rect = caretEle.getBoundingClientRect();
      let threshold = 200;
      if (model.autocompleteResultBox) {
        const autocompleteResultBoxRect = model.autocompleteResultBox.getBoundingClientRect();
        threshold = autocompleteResultBoxRect.width;
      }
      const textareaRect = model.editor.getBoundingClientRect();
      let suggestionLeft = rect.left;
      // If caret's right edge is too close to the left of textarea, position suggestion to the left of caret
      if (rect.left + threshold > textareaRect.right) {
        suggestionLeft = rect.left - threshold;
      }
      model.setSuggestionPosition(rect.top + rect.height, suggestionLeft);
    } else {
      model.displaySuggestion = false;
    }
  }
  processText(src) {
    let {keywordColor, keywordCaseSensitive, model} = this.props;
    let remaining = src;
    let keywordMatch;
    let highlighted = [];
    let numberOfLines = src ? src.split("\n").length : 1;
    let selStart = model.editor ? model.editor.selectionStart : 0;
    //let endIndex;
    let keywords = [];
    for (let keyword of keywordColor.keys()) {
      keywords.push(keyword);
    }

    let keywordRegEx = new RegExp("\\b(" + keywords.join("|") + ")\\b|(\\/\\/|\\/\\*|'|{|\\[|\\(|}|\\]|\\))", "g" + (keywordCaseSensitive ? "" : "i"));
    const colorBrackets = ["gold", "purple", "deepskyblue"];
    let bracketIndex = 0;
    //yellow for function
    while ((keywordMatch = keywordRegEx.exec(remaining)) !== null) {
      let color = "blue";
      let sentence = keywordMatch[1];
      if (keywordMatch[0] == "'") {
        color = "orange";
        let match = remaining.substring(keywordMatch.index + 1).match(/[^\\]'/);
        if (match) {
          sentence = remaining.substring(keywordMatch.index, keywordMatch.index + 1 + match.index + 2);
        } else {
          sentence = remaining.substring(keywordMatch.index);
        }
      } else if (keywordMatch[0] == "//") {
        color = "green";
        let endIndex = remaining.indexOf("\n", keywordMatch.index + 2);
        if (endIndex > 0) {
          sentence = remaining.substring(keywordMatch.index, endIndex + 1);
        } else {
          sentence = remaining.substring(keywordMatch.index);
        }
      } else if (keywordMatch[0] == "/*") {
        color = "green";
        let endIndex = remaining.indexOf("*/", keywordMatch.index + 2);
        if (endIndex > 0) {
          sentence = remaining.substring(keywordMatch.index, endIndex + 2);
        } else {
          sentence = remaining.substring(keywordMatch.index);
        }
      } else if (keywordMatch[0] == "(" || keywordMatch[0] == "[" || keywordMatch[0] == "{") {
        color = colorBrackets[bracketIndex % 3];
        sentence = keywordMatch[0];
        bracketIndex++;
      } else if (keywordMatch[0] == ")" || keywordMatch[0] == "]" || keywordMatch[0] == "}") {
        if (bracketIndex == 0) {
          color = "red";//error
        } else {
          bracketIndex--;
          color = colorBrackets[bracketIndex % 3];
        }
        sentence = keywordMatch[0];
      } else {
        color = keywordColor.get(keywordMatch[1].toLowerCase());
      }
      if (selStart <= keywordMatch.index && selStart > 0) { // sel before keyword
        if (selStart > 0) {
          highlighted.push({value: remaining.substring(0, selStart), attributes: {style: {color: "black"}, key: "hl" + highlighted.length}});
        }
        highlighted.push({value: "", attributes: {className: "editor_caret", key: "hl" + highlighted.length}});
        if (selStart < keywordMatch.index) {
          highlighted.push({value: remaining.substring(selStart, keywordMatch.index), attributes: {style: {color: "black"}, key: "hl" + highlighted.length}});
        }
        highlighted.push({value: sentence, attributes: {style: {color}, key: "hl" + highlighted.length}});
      } else if (selStart <= keywordMatch.index + sentence.length && selStart > 0) { // sel on keyword
        if (keywordMatch.index != 0) {
          highlighted.push({value: remaining.substring(0, keywordMatch.index), attributes: {style: {color: "black"}, key: "hl" + highlighted.length}});
        }
        if (keywordMatch.index < selStart) {
          highlighted.push({value: remaining.substring(keywordMatch.index, selStart), attributes: {style: {color}, key: "hl" + highlighted.length}});
        }
        highlighted.push({value: "", attributes: {className: "editor_caret", key: "hl" + highlighted.length}});
        if (selStart < keywordMatch.index + sentence.length) {
          highlighted.push({value: remaining.substring(selStart, keywordMatch.index + sentence.length), attributes: {style: {color}, key: "hl" + highlighted.length}});
        }
      } else { //sel after keyword
        if (keywordMatch.index != 0) {
          highlighted.push({value: remaining.substring(0, keywordMatch.index), attributes: {style: {color: "black"}, key: "hl" + highlighted.length}});
        }
        highlighted.push({value: sentence, attributes: {style: {color}, key: "hl" + highlighted.length}});
      }
      remaining = remaining.substring(keywordMatch.index + sentence.length);
      selStart -= keywordMatch.index + sentence.length;
      keywordRegEx = new RegExp("\\b(" + keywords.join("|") + ")\\b|(\\/\\/|\\/\\*|'|{|\\[|\\(|}|\\]|\\))", "g" + (keywordCaseSensitive ? "" : "i"));
      if (highlighted.length > 1000) {
        break;
      }
    }
    if (selStart > 0) {
      highlighted.push({value: remaining.substring(0, selStart), attributes: {style: {color: "black"}, key: "hl" + highlighted.length}});
      highlighted.push({value: "", attributes: {className: "editor_caret", key: "hl" + highlighted.length}});
      remaining = remaining.substring(selStart);
    }
    if (remaining) {
      highlighted.push({value: remaining, attributes: {style: {color: "black"}, key: "hl" + highlighted.length}});
    }
    return {highlighted, numberOfLines};
  }
  render() {
    let {model} = this.props;
    let {highlighted, numberOfLines} = this.processText(model.editor ? model.editor.value : "");
    // bug chrome with respect of white space
    let endOfText = "";
    if (highlighted.length) {
      let last = highlighted[highlighted.length - 1];
      if (last.attributes.className == "editor_caret") {
        last = highlighted[highlighted.length - 2];
      }
      if (last.value && last.value.endsWith("\n")) {
        endOfText = h("br", {});
      }
    }
    return h("div", {className: "editor_container", style: {maxHeight: (model.winInnerHeight - 200) + "px"}},
      h("div", {className: "editor-container"},
        h("div", {className: "line-numbers-wrapper", style: {lineHeight: this.state.lineHeight}},
          h("div", {className: "line-numbers", style: {top: -this.state.scrolltop + "px"}},
            Array(numberOfLines).fill(null).map((e, i) => h("span", {key: "LineNumber" + i}))
          )
        ),
        h("div", {className: "editor-wrapper"},
          h("div", {ref: "editorMirror", className: "editor_container_mirror"}, highlighted.map((s) => h("span", s.attributes, s.value)),
            endOfText
          ),
          h("textarea", {id: "editor", autoComplete: "off", autoCorrect: "off", spellCheck: "false", autoCapitalize: "off", className: "editor_textarea", ref: "editor", onScroll: this.onScroll, onKeyUp: this.editorAutocompleteEvent, onMouseUp: this.handleMouseUp, onSelect: this.editorAutocompleteEvent, onInput: this.editorAutocompleteEvent, onKeyDown: this.handlekeyDown, onChange: this.handleChange, onBlur: this.onBlur})
        )
      )
    );
  }
}
