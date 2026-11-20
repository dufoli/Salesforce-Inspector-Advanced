/* exported initFormulaEditor */
"use strict";

// Enhances the native formula textareas of classic setup pages (formula field, validation rule,
// ...) with the Formula Helper editor (syntax highlighting, Ctrl+Space autocomplete, problems).
// Off by default; the injected toggle switches it on/off and that choice is remembered. When on,
// the native textarea is hidden and replaced by an extension iframe (formula-helper.html?embedded=1)
// kept in sync both ways, so the native "Check Syntax" / "Save" buttons keep working on the real
// textarea.
const FORMULA_TEXTAREA_SELECTOR = "textarea#CalculatedFormula, textarea#ValidationFormula";
const FORMULA_EDITOR_ENABLED_KEY = "formulaEditorEnabled";
// Code editors (by library) that something else may have put next to the formula textarea.
const FOREIGN_EDITOR_SELECTOR = ".CodeMirror, .monaco-editor, .ace_editor";
// Classes set by these libraries themselves, so not specific to whoever added the editor.
const EDITOR_LIBRARY_CLASS = /^(CodeMirror|cm-|monaco|ace_)/;
// Stop hiding foreign editors past this many insertions, to never loop against another extension.
const MAX_FOREIGN_EDITOR_HIDES = 10;
// Iframe min height (px), see the insextFormulaHeight message.
const MIN_FRAME_HEIGHT = 260;

function initFormulaEditor(sfHost) {
  let textareas = Array.from(document.querySelectorAll(FORMULA_TEXTAREA_SELECTOR));
  if (textareas.length == 0) {
    return;
  }
  chrome.storage.local.get(FORMULA_EDITOR_ENABLED_KEY, items => {
    let enabled = !!(items && items[FORMULA_EDITOR_ENABLED_KEY]);
    for (let textarea of textareas) {
      attachFormulaToggle(sfHost, textarea, enabled);
    }
  });
}

// Best effort hints to find the object the formula is written for; resolved to an API name by
// the embedded page (which can call the API). The user can still change it there.
function formulaContextHints() {
  let params = new URLSearchParams(location.search);
  let objectHint = params.get("type") || params.get("entity") || params.get("tableEnumOrId") || "";
  if (!objectHint) {
    let input = document.querySelector("input[name=type], input[name=entity], input[name=tableEnumOrId]");
    objectHint = input ? input.value : "";
  }
  // e.g. /00N.../e (custom field) or /03d.../e (validation rule)
  let idMatch = location.pathname.match(/^\/([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})(\/|$)/);
  return {objectHint, recordId: idMatch ? idMatch[1] : ""};
}

function attachFormulaToggle(sfHost, textarea, enabled) {
  if (textarea.dataset.insextFormula) {
    return;
  }
  textarea.dataset.insextFormula = "true";

  // SLDS-like checkbox toggle; SLDS isn't loaded on classic setup pages, hence own insext- classes.
  let toggle = document.createElement("label");
  toggle.className = "insext-formula-toggle";
  toggle.title = "Salesforce Inspector Advanced: syntax highlighting and autocomplete (Ctrl+Space)";
  let checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  let faux = document.createElement("span");
  faux.className = "insext-formula-toggle-faux";
  let label = document.createElement("span");
  label.className = "insext-formula-toggle-label";
  label.textContent = "Salesforce Inspector Advanced Editor";
  toggle.append(checkbox, faux, label);
  textarea.parentNode.insertBefore(toggle, textarea);

  let iframe = null;
  let lastSynced = null;
  let pollTimer = null;
  let extensionOrigin = chrome.runtime.getURL("").replace(/\/$/, "");

  // --- Potential conflict: another editor enhancing the same textarea ---
  // When ours is switched on, the other editor is hidden (not removed, so its script doesn't
  // break). It stays hidden for the life of the page, even if ours is switched off (the native
  // textarea is shown then): it still holds the formula as it was at page load, and we can't
  // update it from our isolated world.
  let takenOver = false;
  let foreignHides = 0;

  // The editor itself, plus its companions: siblings sharing one of its own (non library)
  // classes, e.g. a status bar / footer added next to it by the same script.
  function foreignEditorElements() {
    let siblings = Array.from(textarea.parentNode.children).filter(el => el != iframe && el != toggle && el != textarea);
    let editors = siblings.filter(el => el.matches(FOREIGN_EDITOR_SELECTOR));
    let ownClasses = new Set(editors.flatMap(el => Array.from(el.classList)).filter(c => !EDITOR_LIBRARY_CLASS.test(c)));
    return siblings.filter(el => editors.includes(el) || Array.from(el.classList).some(c => ownClasses.has(c)));
  }

  function hideForeignEditors() {
    for (let el of foreignEditorElements()) {
      if (el.classList.contains("insext-formula-hidden")) {
        continue;
      }
      if (foreignHides >= MAX_FOREIGN_EDITOR_HIDES) {
        console.warn("Salesforce Inspector Advanced: another formula editor keeps being re-added, giving up hiding it", el);
        foreignObserver.disconnect();
        return;
      }
      foreignHides++;
      el.classList.add("insext-formula-hidden");
      if (!takenOver) {
        takenOver = true;
        toggle.title += " (another formula editor is hidden while this one is used)";
      }
    }
  }

  // Another editor may be injected before or after us, so keep watching.
  let foreignObserver = new MutationObserver(() => {
    if (iframe || takenOver) {
      hideForeignEditors();
    }
  });
  foreignObserver.observe(textarea.parentNode, {childList: true});

  // Textarea based editors may copy their own content into the textarea on submit, which would
  // overwrite the formula with the stale one of the hidden editor. Snapshot the
  // textarea before any form listener (window, capture) and restore it after all of them (window,
  // bubble), just before the form is actually sent (Save, Check Syntax).
  let submitSnapshot = null;
  addEventListener("submit", e => {
    submitSnapshot = takenOver && e.target == textarea.form ? textarea.value : null;
  }, true);
  addEventListener("submit", e => {
    if (submitSnapshot != null && e.target == textarea.form) {
      textarea.value = submitSnapshot;
    }
    submitSnapshot = null;
  });

  function writeTextarea(value) {
    lastSynced = value;
    if (textarea.value == value) {
      return;
    }
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", {bubbles: true}));
    textarea.dispatchEvent(new Event("change", {bubbles: true}));
  }

  function sendFormula() {
    lastSynced = textarea.value;
    iframe.contentWindow.postMessage({insextFormulaSet: textarea.value}, extensionOrigin);
  }

  function onMessage(e) {
    if (!iframe || e.source != iframe.contentWindow || e.origin != extensionOrigin) {
      return;
    }
    if (e.data.insextFormulaReady) {
      sendFormula();
    } else if (typeof e.data.insextFormulaChange == "string") {
      writeTextarea(e.data.insextFormulaChange);
    } else if (typeof e.data.insextFormulaHeight == "number") {
      // Min height so the autocomplete list (absolute, 200px) of a short formula isn't clipped;
      // +2 for the iframe border.
      iframe.style.height = Math.max(MIN_FRAME_HEIGHT, e.data.insextFormulaHeight + 2) + "px";
    }
  }

  function enable() {
    let {objectHint, recordId} = formulaContextHints();
    let args = new URLSearchParams({host: sfHost, embedded: "1", object: objectHint, recordId});
    iframe = document.createElement("iframe");
    iframe.className = "insext-formula-frame";
    iframe.src = chrome.runtime.getURL("formula-helper.html") + "?" + args;
    // Measured before hiding anything: the textarea may already be hidden by another editor
    // (offsetWidth 0), then that editor gives the width the user is used to.
    let width = Math.max(textarea.offsetWidth, ...foreignEditorElements().map(el => el.offsetWidth), 600);
    iframe.style.width = width + "px";
    textarea.style.display = "none";
    textarea.parentNode.insertBefore(iframe, textarea.nextSibling);
    hideForeignEditors();
    addEventListener("message", onMessage);
    // Native buttons (Insert Field, Insert Operator, ...) still write into the hidden textarea.
    pollTimer = setInterval(() => {
      if (lastSynced != null && textarea.value != lastSynced) {
        sendFormula();
      }
    }, 500);
  }

  function disable() {
    clearInterval(pollTimer);
    removeEventListener("message", onMessage);
    iframe.remove();
    iframe = null;
    lastSynced = null;
    textarea.style.display = "";
    textarea.focus();
  }

  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      enable();
    } else {
      disable();
    }
    chrome.storage.local.set({[FORMULA_EDITOR_ENABLED_KEY]: checkbox.checked});
  });

  if (enabled) {
    checkbox.checked = true;
    enable();
  }
}
