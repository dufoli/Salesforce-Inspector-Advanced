import {sfConn, apiVersion} from "./inspector.js";
import {Enumerable} from "./data-load.js";
import {EditHistory} from "./editor.js";
import {RecordTable} from "./record-table.js";

const modifierRegex = /^(?:(?:public|private|protected|global|static|final|transient|override|virtual|abstract|webservice|testmethod)\s+|(?:with|without|inherited)\s+sharing\s+)/i;
const visibilities = ["public", "private", "protected", "global"];
// words which can start a statement like a type does
const notTypes = new Set(["return", "throw", "new", "else", "if", "for", "while", "do", "try", "catch", "finally", "insert", "update", "upsert", "delete",
  "undelete", "merge", "switch", "when", "break", "continue", "class", "interface", "enum", "extends", "implements", "instanceof", "trigger", "get", "set"]);
const typePattern = "[A-Za-z_][\\w.]*(?:\\s*<[^;{}()=]*>)?(?:\\s*\\[\\s*\\])?";
const declarationRegex = new RegExp("^(" + typePattern + ")\\s+([A-Za-z_]\\w*)\\s*(?:=|,|$)");
const methodRegex = new RegExp("^(" + typePattern + ")\\s+([A-Za-z_]\\w*)\\s*\\(([^]*)\\)$");
const propertyRegex = new RegExp("^(" + typePattern + ")\\s+([A-Za-z_]\\w*)$");
const constructorRegex = /^([A-Za-z_]\w*)\s*\(([^]*)\)$/;
const classHeaderRegex = /^(class|interface|enum)\s+([A-Za-z_]\w*)(?:[^]*?\bextends\s+([A-Za-z_][\w.]*))?/i;
const loopRegex = /^(for|catch)\s*\(([^]*)\)$/i;
const sobjectMethods = ["addError", "clear", "clone", "get", "getCloneSourceId", "getErrors", "getOptions", "getPopulatedFieldsAsMap", "getSObject", "getSObjects",
  "getSObjectType", "getQuickActionName", "hasErrors", "isClone", "isSet", "put", "putSObject", "setOptions"];

/**
 * Replaces the comments and the strings of Apex code by spaces (newlines kept), so that the code
 * can be analyzed with regular expressions while keeping the positions.
 */
export function maskApex(source) {
  let parts = [];
  let regex = /\/\/|\/\*|'/g;
  let pos = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    let start = match.index;
    let end;
    if (match[0] == "//") {
      end = source.indexOf("\n", start);
      end = end < 0 ? source.length : end;
    } else if (match[0] == "/*") {
      end = source.indexOf("*/", start + 2);
      end = end < 0 ? source.length : end + 2;
    } else {
      end = start + 1;
      while (end < source.length && source[end] != "'" && source[end] != "\n") {
        end += source[end] == "\\" ? 2 : 1;
      }
      end = Math.min(end + 1, source.length);
    }
    parts.push(source.substring(pos, start), source.substring(start, end).replace(/[^\n]/g, " "));
    pos = end;
    regex.lastIndex = end;
  }
  parts.push(source.substring(pos));
  return parts.join("");
}

function cleanType(type) {
  return type.replace(/\s+/g, "");
}

function parseModifiers(text) {
  text = text.replace(/@\w+(\s*\([^)]*\))?/g, " ").replace(/\s+/g, " ").trim();
  let modifiers = [];
  let match;
  while ((match = modifierRegex.exec(text)) !== null) {
    modifiers.push(match[0].trim().toLowerCase());
    text = text.substring(match[0].length);
  }
  return {
    text: text.trim(),
    isStatic: modifiers.includes("static"),
    visibility: modifiers.find(m => visibilities.includes(m)) || "private"
  };
}

function parseDeclaration(text) {
  let match = declarationRegex.exec(text.trim());
  return match && !notTypes.has(match[1].toLowerCase()) ? {name: match[2], type: cleanType(match[1])} : null;
}

// Parameters of a method, split on the commas which are not inside a generic type
function parseParameters(text) {
  let params = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    let c = text[i];
    if (c == "<") {
      depth++;
    } else if (c == ">") {
      depth--;
    } else if (i == text.length || (c == "," && depth == 0)) {
      let param = parseDeclaration(text.substring(start, i).replace(/^\s*final\s+/i, ""));
      if (param) {
        params.push(param);
      }
      start = i + 1;
    }
  }
  return params;
}

/**
 * Analyzes Apex code (a class, a trigger or anonymous Apex) for the autocomplete:
 * - classes: the classes declared in the code (outer and inner, by lowercase name) with their members
 *   {name, type, kind: "field"|"property"|"method"|"class", params, isStatic, visibility} and their parent class,
 * - variables: the local variables, parameters and loop variables visible at pos {name, type},
 * - classNames: the names of the classes enclosing pos, from the outer one.
 * It is a light parser: generic types, annotations and modifiers are supported, but not every Apex construct.
 */
export function analyzeApex(source, pos = source.length) {
  let text = maskApex(source);
  let classes = new Map();
  let stack = [{kind: "block", vars: []}];
  let atPos = null;
  let top = () => stack[stack.length - 1];
  let addMember = member => {
    let {info} = top();
    if (info.isInterface) {
      member.visibility = "public";
    }
    info.members.push(member);
  };
  pos = Math.min(pos, text.length);

  function statement(segment) {
    let {text: code, isStatic, visibility} = parseModifiers(segment);
    let block = top();
    if (block.kind == "class") {
      // fields, and the methods without body of interfaces and abstract classes
      let method = methodRegex.exec(code);
      if (method && !notTypes.has(method[1].toLowerCase())) {
        addMember({name: method[2], type: cleanType(method[1]), kind: "method", params: parseParameters(method[3]), isStatic, visibility});
        return;
      }
      let field = parseDeclaration(code);
      if (field) {
        addMember(Object.assign(field, {kind: "field", isStatic, visibility}));
      }
      return;
    }
    let variable = parseDeclaration(code);
    if (variable) {
      block.vars.push(variable);
    }
  }

  function openBlock(header) {
    let {text: code, isStatic, visibility} = parseModifiers(header);
    let block = top();
    let classHeader = classHeaderRegex.exec(code);
    if (classHeader) {
      let info = {name: classHeader[2], parent: classHeader[3] || null, isEnum: classHeader[1].toLowerCase() == "enum", isInterface: classHeader[1].toLowerCase() == "interface", members: []};
      if (block.kind == "class") {
        addMember({name: info.name, type: info.name, kind: "class", params: [], isStatic: true, visibility});
      }
      classes.set(info.name.toLowerCase(), info);
      stack.push({kind: "class", name: info.name, info, vars: []});
      return;
    }
    let method = methodRegex.exec(code);
    if (method && !notTypes.has(method[1].toLowerCase())) {
      let params = parseParameters(method[3]);
      if (block.kind == "class") {
        addMember({name: method[2], type: cleanType(method[1]), kind: "method", params, isStatic, visibility});
      }
      // a copy: the local variables of the method are added to the block variables, not to its parameters
      stack.push({kind: "block", vars: params.slice()});
      return;
    }
    let constructor = constructorRegex.exec(code);
    if (constructor && block.kind == "class" && constructor[1].toLowerCase() == block.name.toLowerCase()) {
      stack.push({kind: "block", vars: parseParameters(constructor[2])});
      return;
    }
    let loop = loopRegex.exec(code);
    if (loop) {
      let variable = parseDeclaration(loop[2].split(/[;:]/)[0]);
      stack.push({kind: "block", vars: variable ? [variable] : []});
      return;
    }
    let property = propertyRegex.exec(code);
    if (property && block.kind == "class" && !notTypes.has(property[1].toLowerCase())) {
      addMember({name: property[2], type: cleanType(property[1]), kind: "property", params: [], isStatic, visibility});
    } else if (block.kind != "class") {
      // a declaration with a collection initializer, e.g. List<String> names = new List<String>{...}
      let variable = parseDeclaration(code);
      if (variable) {
        block.vars.push(variable);
      }
    }
    stack.push({kind: "block", vars: []});
  }

  function closeBlock(segment) {
    let block = top();
    if (block.kind == "class" && block.info.isEnum) {
      segment.split(",").map(v => v.trim()).filter(v => /^[A-Za-z_]\w*$/.test(v))
        .forEach(v => addMember({name: v, type: block.name, kind: "field", params: [], isStatic: true, visibility: "public"}));
    }
    if (stack.length > 1) {
      stack.pop();
    }
  }

  let segmentStart = 0;
  let parenDepth = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i == pos) {
      atPos = {
        variables: stack.flatMap(b => (b.kind == "class" ? [] : b.vars)),
        classNames: stack.filter(b => b.kind == "class").map(b => b.name)
      };
    }
    let c = text[i];
    if (c == "(") {
      parenDepth++;
    } else if (c == ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if ((c == ";" && parenDepth == 0) || c == "{" || c == "}") {
      // a brace always delimits a block, so that a parenthesis being typed does not hide the rest of the code
      let segment = text.substring(segmentStart, i);
      segmentStart = i + 1;
      if (c == ";") {
        statement(segment);
      } else if (c == "{") {
        parenDepth = 0;
        openBlock(segment);
      } else {
        parenDepth = 0;
        closeBlock(segment);
      }
    }
  }
  return Object.assign({classes}, atPos);
}

/**
 * Apex autocomplete of the Editor component (classes, sObjects, keywords, variable members, inline SOQL),
 * shared by the pages editing Apex: their Model extends this class and provides
 * describeInfo (DescribeInfo), didUpdate() and spinFor(promise).
 */
export class ApexAutocompleteModel {
  constructor() {
    this.editor = null;
    this.editHistory = new EditHistory();
    this.autocompleteResults = {sobjectName: "", title: "\u00A0", results: []};
    this.autocompleteClick = null;
    this.autocompleteState = "";
    this.autocompleteProgress = {};
    this.apexClasses = new RecordTable();
    // analysis of the org classes used by the edited code (see analyzeApex), by lowercase name ("outer.inner" for inner classes):
    // the class info, "loading" or null when its code cannot be read
    this.classInfos = new Map();
    this.suggestionTop = 0;
    this.suggestionLeft = 0;
    this.autoSelectFirstSuggestion = localStorage.getItem("autoSelectFirstSuggestion") === "true"; // default to false
    this.activeSuggestion = this.autoSelectFirstSuggestion ? 0 : -1;
    this.autocompleteResultBox = null;
    // with auto-select, suggestions are only shown on demand (Ctrl+Space) so typing never selects one by accident
    this.displaySuggestion = !this.autoSelectFirstSuggestion;
    // methods of the system classes, by name
    this.typeProperties = new Map();
    this.typeProperties.set("List", ["add(", "addAll(", "clear(", "clone(", "contains(", "deepClone(", "equals(", "get(", "getSObjectType(", "hashCode(", "indexOf(", "isEmpty(", "iterator(", "remove(", "set(", "size(", "sort(", "toString("]);
    this.typeProperties.set("Map", ["clear(", "clone(", "containsKey(", "deepClone(", "equals(", "get(", "getSObjectType(", "hashCode(", "isEmpty(", "keySet(", "put(", "putAll(", "putAll(", "remove(", "size(", "toString(", "values("]);
    this.typeProperties.set("Set", ["add(", "addAll(", "addAll(", "clear(", "clone(", "contains(", "containsAll(", "containsAll(", "equals(", "hashCode(", "isEmpty(", "remove(", "removeAll(", "removeAll(", "retainAll(", "retainAll(", "size("]);
    this.typeProperties.set("Database", ["convertLead(", "countQuery(", "countQueryWithBinds(", "delete(", "deleteAsync(", "deleteImmediate(", "emptyRecycleBin(", "executeBatch(", "getAsyncDeleteResult(", "getAsyncLocator(", "getAsyncSaveResult(", "getDeleted(", "getQueryLocator(", "getQueryLocatorWithBinds(", "getUpdated(", "insert(", "insertAsync(", "insertImmediate(", "merge(", "query(", "queryWithBinds(", "releaseSavepoint(", "rollback(", "setSavepoint(", "undelete(", "update(", "upsert(", "updateAsync(", "updateImmediate("]);
  }

  // Apex classes suggested by the autocomplete (names only)
  async loadApexClasses() {
    let url = "/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent("SELECT Id, Name, NamespacePrefix FROM ApexClass");
    while (url) {
      let result = await sfConn.rest(url);
      this.apexClasses.addToTable(result.records);
      url = result.done ? null : result.nextRecordsUrl;
    }
  }

  resultsSort(searchTerm) {
    function sortRank({value, title}) {
      let i = 0;
      if (value.toLowerCase() == searchTerm.toLowerCase()) {
        return i;
      }
      i++;
      if (title.toLowerCase() == searchTerm.toLowerCase()) {
        return i;
      }
      i++;
      if (value.toLowerCase().startsWith(searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      if (title.toLowerCase().startsWith(searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      if (value.toLowerCase().includes("__" + searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      if (value.toLowerCase().includes("_" + searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      if (title.toLowerCase().includes(" " + searchTerm.toLowerCase())) {
        return i;
      }
      i++;
      return i;
    }
    return function(a, b) {
      return sortRank(a) - sortRank(b) || a.rank - b.rank || a.value.localeCompare(b.value);
    };
  }

  autocompleteClass(vm, ctrlSpace) {
    let script = vm.editor.value;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let searchTerm = selStart != selEnd
      ? script.substring(selStart, selEnd)
      : script.substring(0, selStart).match(/[a-zA-Z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;

    if (ctrlSpace) {
      this.selectSuggestion();
      return;
    }
    if (this.autocompleteSoql(vm, script, selStart, searchTerm)) {
      return;
    }
    let analysis = analyzeApex(script, selStart);
    if (searchTerm.includes(".")) {
      let path = searchTerm.split(".");
      let term = path.pop().toLowerCase();
      let members = this.pathMembers(path, analysis);
      // null: the path is not a variable, a class or an object, e.g. a namespace
      if (members) {
        let prefix = path.join(".") + ".";
        vm.autocompleteResults = {
          sobjectName: "",
          title: members == "loading" ? "Loading " + path.join(".") + "..." : path.join(".") + " suggestions:",
          results: members == "loading" ? [] : members
            .filter(m => m.name.toLowerCase().includes(term))
            .map(m => this.memberSuggestion(m, prefix))
            .sort(vm.resultsSort(searchTerm))
            .slice(0, 50)
        };
        return;
      }
    }
    let contextPath;
    if (searchTerm && searchTerm.includes(".")) {
      [contextPath, searchTerm] = searchTerm.split(".", 2);
    }
    let keywords = [
      {value: "Blob", title: "Blob", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "double"},
      {value: "Boolean", title: "Boolean", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "boolean"},
      {value: "Date", title: "Date", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "date"},
      {value: "Datetime", title: "Datetime", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "datetime"},
      {value: "Decimal", title: "Decimal", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "double"},
      {value: "Double", title: "Double", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "double"},
      {value: "ID", title: "ID", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "id"},
      {value: "Integer", title: "Integer", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "int"},
      {value: "Long", title: "Long", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "long"},
      {value: "Object", title: "Object", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "reference"},
      {value: "String", title: "String", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "string"},
      {value: "Time", title: "Time", suffix: " ", rank: 3, autocompleteType: "fieldName", dataType: "time"},

      {value: "List", title: "List", suffix: " ", rank: 1, autocompleteType: "class", dataType: ""},
      {value: "Map", title: "Map", suffix: " ", rank: 1, autocompleteType: "class", dataType: ""},
      {value: "Set", title: "Set", suffix: " ", rank: 1, autocompleteType: "class", dataType: ""},
      {value: "Enum", title: "Enum", suffix: " ", rank: 1, autocompleteType: "class", dataType: ""},

      {value: "while", title: "while", suffix: " {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "for", key: "foreach", title: "foreach", suffix: "(Object item:lists) {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "for", key: "fori", title: "fori", suffix: "(Integer i = 0; i<length; i++) {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "try", title: "try", suffix: " {} catch (Exception e) {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "if", title: "if", suffix: " {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "else", title: "else", suffix: " {}", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "Database.executeBatch(", title: "Database.executeBatch();", suffix: "new batchable(), 200);", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "System.enqueueJob(", title: "System.enqueueJob();", suffix: "new job());", rank: 2, autocompleteType: "snippet", dataType: ""},
      {value: "System.debug(", title: "System.debug();", suffix: ");", rank: 2, autocompleteType: "snippet", dataType: ""}
    ];
    let {globalDescribe, globalStatus} = vm.describeInfo.describeGlobal(false);
    //isue duplicate namespace because need group by
    vm.autocompleteResults = {
      sobjectName: "ApexClass",
      title: "Class suggestions:",
      results: new Enumerable(vm.apexClasses.records) // custom class
        .flatMap(function* (c) {
          if (contextPath) {
            if (c.NamespacePrefix && c.NamespacePrefix.toLowerCase() == contextPath.toLowerCase()
            && c.Name.toLowerCase().includes(searchTerm.toLowerCase())) {
              yield {"value": c.NamespacePrefix + "." + c.Name, "title": c.NamespacePrefix + "." + c.Name, "suffix": " ", "rank": 4, "autocompleteType": "class"};
            }
          } else if (!c.NamespacePrefix && c.Name.toLowerCase().includes(searchTerm.toLowerCase())) {
            yield {"value": c.Name, "title": c.Name, "suffix": " ", "rank": 4, "autocompleteType": "class"};
          }
        })
        .concat(//customm class namespaces
          new Enumerable(vm.apexClasses.records)
            .map(c => c.NamespacePrefix)
            .filter(n => (n && n.toLowerCase().includes(searchTerm.toLowerCase())))
            .groupBy(n => n)
            .map(n => ({"value": n, "title": n, "suffix": " ", "rank": 5, "autocompleteType": "namespace"}))
        )
        .concat(//SOBJECT
          new Enumerable(globalStatus == "ready" ? globalDescribe.sobjects : [])
            .filter(sobjectDescribe => (sobjectDescribe.name.toLowerCase().includes(searchTerm.toLowerCase())))
            .map(sobjectDescribe => sobjectDescribe.name)
            .map(n => ({"value": n, "title": n, "suffix": " ", "rank": 6, "autocompleteType": "object"}))
        )
        .concat(
          new Enumerable(keywords) //keywords
            .filter(keyword => keyword.title.toLowerCase().includes(searchTerm.toLowerCase()))
        )
        .concat(// variables and members of the enclosing classes
          new Enumerable(contextPath ? [] : this.scopeMembers(analysis))
            .filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .map(m => this.memberSuggestion(m, ""))
        )
        .toArray()
        .sort(vm.resultsSort(searchTerm))
        .slice(0, 20) //only 20 first result
    };
  }

  memberSuggestion(member, prefix) {
    let isMethod = member.kind == "method";
    let params = member.params ? member.params.map(p => p.type + " " + p.name).join(", ") : "…";
    let title = member.name + (isMethod ? "(" + params + ")" : "") + (member.type ? ": " + member.type : "");
    return {
      key: prefix + title,
      value: prefix + member.name + (isMethod ? "(" : ""),
      title,
      // a method without parameters is complete, otherwise the caret stays in the parentheses
      suffix: isMethod && member.params && member.params.length == 0 ? ")" : "",
      rank: member.kind == "variable" ? 0 : 1,
      autocompleteType: member.kind == "class" ? "class" : "variable",
      dataType: member.dataType || ""
    };
  }

  // Variables visible at the caret, then members of the enclosing classes (whatever their visibility) and of their parents, innermost first
  scopeMembers(analysis) {
    let members = analysis.variables.slice().reverse().map(v => ({name: v.name, type: v.type, kind: "variable", params: []}));
    for (let className of analysis.classNames.slice().reverse()) {
      let info = analysis.classes.get(className.toLowerCase());
      members.push(...info.members);
      if (info.parent) {
        let inherited = this.typeMembers(info.parent, null, analysis, 1);
        if (Array.isArray(inherited)) {
          members.push(...inherited);
        }
      }
    }
    let names = new Set();
    // keep the overloads of a method, but a variable hides a field of the same name
    return members.filter(m => {
      let key = m.kind == "method" ? m.name + "(" + (m.params || []).length : m.name.toLowerCase();
      if (names.has(key)) {
        return false;
      }
      names.add(key);
      return true;
    });
  }

  /**
   * What the first name of a dotted path refers to: {type, isStatic} (isStatic: a class or an object, not an instance),
   * "loading" while the metadata is loading, or null when unknown.
   */
  resolveName(name, analysis) {
    let lower = name.toLowerCase();
    let innermost = analysis.classNames[analysis.classNames.length - 1];
    if (lower == "this") {
      return innermost ? {type: innermost, isStatic: false} : null;
    }
    if (lower == "super") {
      let parent = innermost && analysis.classes.get(innermost.toLowerCase()).parent;
      return parent ? {type: parent, isStatic: false} : null;
    }
    let variable = this.scopeMembers(analysis).find(m => m.kind != "method" && m.kind != "class" && m.name.toLowerCase() == lower);
    if (variable) {
      return {type: variable.type, isStatic: false};
    }
    if (Array.from(this.typeProperties.keys()).some(k => k.toLowerCase() == lower) || analysis.classes.has(lower)
      || this.apexClasses.records.some(c => !c.NamespacePrefix && c.Name.toLowerCase() == lower)) {
      return {type: name, isStatic: true};
    }
    let sobject = this.sobjectDescribe(name);
    return sobject == "loading" ? sobject : sobject ? {type: sobject.name, isStatic: true} : null;
  }

  // Members of what a dotted path (e.g. acc.Owner, MyClass, this.items) refers to, "loading", or null when its first name is unknown
  pathMembers(path, analysis) {
    let current = this.resolveName(path[0], analysis);
    if (!current || current == "loading") {
      return current;
    }
    for (let segment of path.slice(1)) {
      let members = this.typeMembers(current.type, current.isStatic, analysis);
      if (members == "loading") {
        return members;
      }
      let member = members.find(m => m.kind != "method" && m.name.toLowerCase() == segment.toLowerCase());
      if (!member) {
        return [];
      }
      current = member.kind == "class" ? {type: current.type + "." + member.name, isStatic: true} : {type: member.type, isStatic: false};
    }
    return this.typeMembers(current.type, current.isStatic, analysis);
  }

  /**
   * Members of a type which can be used from the edited code: static ones (isStatic true), instance ones (false) or both (null).
   * The private members of a class are only listed when the caret is inside it. Returns "loading" while its metadata is loading.
   */
  typeMembers(type, isStatic, analysis, depth = 0) {
    let name = cleanType(type);
    if (name.endsWith("[]")) {
      name = "List";
    }
    if (name.includes("<")) {
      name = name.substring(0, name.indexOf("<"));
    }
    let lower = name.toLowerCase();
    let system = Array.from(this.typeProperties.keys()).find(k => k.toLowerCase() == lower);
    if (system) {
      return this.typeProperties.get(system)
        .map(m => ({name: m.replace(/\($/, ""), type: "", kind: "method", params: null, isStatic: system == "Database"}))
        .filter(m => isStatic == null || m.isStatic == isStatic);
    }
    let info = this.classInfo(lower, analysis);
    if (info == "loading") {
      return info;
    }
    if (info) {
      let own = analysis.classNames.some(c => c.toLowerCase() == info.name.toLowerCase());
      let members = info.members.filter(m => (isStatic == null || (m.kind == "class" || m.isStatic) == isStatic)
        && (own || m.visibility == "public" || m.visibility == "global" || (depth > 0 && m.visibility == "protected")));
      if (info.parent && depth < 5) {
        let inherited = this.typeMembers(info.parent, isStatic, analysis, depth + 1);
        if (Array.isArray(inherited)) {
          members = members.concat(inherited);
        }
      }
      return members;
    }
    let sobjectDescribe = this.sobjectDescribe(name);
    if (sobjectDescribe == "loading") {
      return sobjectDescribe;
    }
    if (sobjectDescribe) {
      let fields = sobjectDescribe.fields.flatMap(f => {
        let fieldMembers = [{name: f.name, type: f.type, kind: "field", dataType: f.type}];
        if (f.relationshipName && f.referenceTo.length) {
          fieldMembers.push({name: f.relationshipName, type: f.referenceTo[0], kind: "field", dataType: "reference"});
        }
        return fieldMembers;
      });
      return isStatic
        ? fields.concat([{name: "SObjectType", type: "Schema.SObjectType", kind: "field"}])
        : fields.concat(sobjectMethods.map(m => ({name: m, type: "", kind: "method", params: null})));
    }
    return [];
  }

  // Describe of an sObject, "loading", or null when name is not an sObject
  sobjectDescribe(name) {
    let {sobjectStatus, sobjectDescribe} = this.describeInfo.describeSobject(false, name);
    if (sobjectStatus == "ready") {
      return sobjectDescribe;
    }
    return sobjectStatus == "pending" || sobjectStatus == "loading" ? "loading" : null;
  }

  // Analysis of a class of the edited code, or of an org class whose code is loaded once (lowerName: "outer" or "outer.inner")
  classInfo(lowerName, analysis) {
    if (analysis.classes.has(lowerName)) {
      return analysis.classes.get(lowerName);
    }
    let [outer, inner] = lowerName.split(".");
    if (inner && analysis.classes.has(outer) && analysis.classes.has(inner)) {
      return analysis.classes.get(inner);
    }
    if (!this.classInfos.has(outer)) {
      if (!this.apexClasses.records.some(c => !c.NamespacePrefix && c.Name.toLowerCase() == outer)) {
        return null;
      }
      this.loadClassInfo(outer);
    }
    if (this.classInfos.get(outer) == "loading") {
      return "loading";
    }
    return this.classInfos.get(lowerName) || null;
  }

  loadClassInfo(lowerName) {
    this.classInfos.set(lowerName, "loading");
    let soql = "SELECT Name, Body FROM ApexClass WHERE NamespacePrefix = null AND Name = '" + lowerName.replace(/[^\w]/g, "") + "'";
    sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(soql))
      .then(result => {
        this.classInfos.set(lowerName, null);
        let record = result.records[0];
        if (record && record.Body && record.Body != "(hidden)") {
          for (let [key, info] of analyzeApex(record.Body).classes) {
            this.classInfos.set(key == lowerName ? key : lowerName + "." + key, info);
          }
        }
      }, error => {
        console.error(error);
        this.classInfos.set(lowerName, null);
      })
      .then(() => {
        // suggest the members now known
        if (this.editor) {
          this.autocompleteState = "";
          this.editorAutocompleteHandler();
          this.didUpdate();
        }
      });
  }

  /**
   * Bounds of the inline SOQL query ([SELECT ... FROM ...]) enclosing pos, or null when pos is outside of any.
   */
  findInlineSoql(script, pos) {
    let depth = 0;
    let open = -1;
    for (let i = pos - 1; i >= 0; i--) {
      let ch = script[i];
      if (ch == "]") {
        depth++;
      } else if (ch == "[") {
        if (depth == 0) {
          open = i;
          break;
        }
        depth--;
      } else if (ch == ";") {
        return null; // a query cannot contain a statement separator
      }
    }
    if (open == -1 || !/^\s*select\b/i.test(script.substring(open + 1))) {
      return null;
    }
    let end = script.length;
    for (let i = pos; i < script.length; i++) {
      if (script[i] == "]" || script[i] == ";") {
        end = i;
        break;
      }
    }
    return {start: open + 1, end};
  }

  /**
   * Innermost (SELECT ...) sub-query of query enclosing pos, falling back to the whole query.
   */
  findSoqlScope(query, pos) {
    let depth = 0;
    for (let i = pos - 1; i >= 0; i--) {
      if (query[i] == ")") {
        depth++;
      } else if (query[i] == "(") {
        if (depth > 0) {
          depth--;
        } else if (/^\s*select\b/i.test(query.substring(i + 1))) {
          let end = query.length;
          let closeDepth = 0;
          for (let j = pos; j < query.length; j++) {
            if (query[j] == "(") {
              closeDepth++;
            } else if (query[j] == ")") {
              if (closeDepth == 0) {
                end = j;
                break;
              }
              closeDepth--;
            }
          }
          return {start: i + 1, end, parent: this.findSoqlScope(query, i)};
        }
        // otherwise a function call such as COUNT( or IN (, still in the same scope
      }
    }
    return {start: 0, end: query.length, parent: null};
  }

  // collapse parenthesized parts so keywords of sub-queries are not mistaken for the current scope ones
  stripSoqlParentheses(text) {
    let previous;
    do {
      previous = text;
      text = text.replace(/\([^()]*\)/g, "()");
    } while (text != previous);
    return text;
  }

  describeSobjectIfReady(sobjectName) {
    if (!sobjectName) {
      return null;
    }
    let {sobjectStatus, sobjectDescribe} = this.describeInfo.describeSobject(false, sobjectName);
    return sobjectStatus == "ready" ? sobjectDescribe : null;
  }

  // the sobject queried by a scope, resolving sub-query child relationships against the parent query object
  resolveSoqlSobject(query, scope) {
    let fromMatch = this.stripSoqlParentheses(query.substring(scope.start, scope.end)).match(/\bfrom\s+([a-zA-Z0-9_]+)/i);
    if (!fromMatch) {
      return null;
    }
    if (!scope.parent) {
      return fromMatch[1];
    }
    let parentDescribe = this.describeSobjectIfReady(this.resolveSoqlSobject(query, scope.parent));
    let rel = parentDescribe && parentDescribe.childRelationships.find(r => r.relationshipName && r.relationshipName.toLowerCase() == fromMatch[1].toLowerCase());
    return rel ? rel.childSObject : null;
  }

  /**
   * Suggest objects after FROM and fields elsewhere when the cursor is inside an inline SOQL query.
   * Returns false when Apex suggestions apply instead.
   */
  autocompleteSoql(vm, script, termStart, searchTerm) {
    let soql = this.findInlineSoql(script, termStart);
    if (!soql) {
      return false;
    }
    let query = script.substring(soql.start, soql.end);
    let pos = termStart - soql.start;
    let scope = this.findSoqlScope(query, pos);
    let before = this.stripSoqlParentheses(query.substring(scope.start, pos));
    if (/:\s*$/.test(before)) {
      return false; // bind variable
    }
    let term = searchTerm.toLowerCase();

    if (/\bfrom\s+$/i.test(before)) {
      if (scope.parent) {
        let parentDescribe = this.describeSobjectIfReady(this.resolveSoqlSobject(query, scope.parent));
        vm.autocompleteResults = {
          sobjectName: parentDescribe ? parentDescribe.name : "",
          title: parentDescribe ? parentDescribe.name + " child relationships suggestions:" : "Loading metadata...",
          results: new Enumerable(parentDescribe ? parentDescribe.childRelationships : [])
            .filter(rel => rel.relationshipName && (rel.relationshipName.toLowerCase().includes(term) || rel.childSObject.toLowerCase().includes(term)))
            .map(rel => ({value: rel.relationshipName, title: rel.relationshipName + " (" + rel.childSObject + "." + rel.field + ")", suffix: " ", rank: 1, autocompleteType: "object", dataType: rel.childSObject}))
            .toArray()
            .sort(vm.resultsSort(searchTerm))
        };
        return true;
      }
      let {globalDescribe, globalStatus} = vm.describeInfo.describeGlobal(false);
      vm.autocompleteResults = {
        sobjectName: "",
        title: globalStatus == "ready" ? "Objects suggestions:" : "Loading metadata...",
        results: new Enumerable(globalStatus == "ready" ? globalDescribe.sobjects : [])
          .filter(sobjectDescribe => sobjectDescribe.queryable && (sobjectDescribe.name.toLowerCase().includes(term) || sobjectDescribe.label.toLowerCase().includes(term)))
          .map(sobjectDescribe => ({value: sobjectDescribe.name, title: sobjectDescribe.name, suffix: " ", rank: 1, autocompleteType: "object", dataType: ""}))
          .toArray()
          .sort(vm.resultsSort(searchTerm))
      };
      return true;
    }

    // fields, following relationship paths such as Account.Owner.Na
    let path = searchTerm.split(".");
    let fieldTerm = path.pop();
    let contextPath = path.length ? path.join(".") + "." : "";
    let sobjectName = this.resolveSoqlSobject(query, scope);
    let sobjectDescribe = this.describeSobjectIfReady(sobjectName);
    for (let i = 0; sobjectDescribe && i < path.length; i++) {
      let field = sobjectDescribe.fields.find(f => f.relationshipName && f.relationshipName.toLowerCase() == path[i].toLowerCase());
      // polymorphic lookups resolve to their first referenceTo only
      sobjectDescribe = field && field.referenceTo && field.referenceTo.length > 0 ? this.describeSobjectIfReady(field.referenceTo[0]) : null;
    }
    if (!sobjectDescribe) {
      vm.autocompleteResults = {sobjectName: sobjectName || "", title: sobjectName ? "Loading metadata or unknown field: " + sobjectName + "." + contextPath : "Missing FROM object", results: []};
      return true;
    }
    let inSelectList = /^\s*select\b/i.test(before) && !/\bfrom\b/i.test(before);
    let fieldTermLower = fieldTerm.toLowerCase();
    vm.autocompleteResults = {
      sobjectName: sobjectDescribe.name,
      title: sobjectDescribe.name + " fields suggestions:",
      results: new Enumerable(sobjectDescribe.fields)
        .flatMap(function* (field) {
          yield {value: field.name, title: field.name, label: field.label, suffix: inSelectList ? ", " : " ", rank: 1, autocompleteType: "fieldName", dataType: field.type};
          if (field.relationshipName) {
            yield {value: field.relationshipName + ".", title: field.relationshipName + ".", label: field.label, suffix: "", rank: 2, autocompleteType: "relationshipName", dataType: ""};
          }
        })
        .filter(r => r.value.toLowerCase().includes(fieldTermLower) || r.label.toLowerCase().includes(fieldTermLower))
        .toArray()
        .sort(vm.resultsSort(fieldTerm))
        .map(r => ({...r, value: contextPath + r.value}))
    };
    return true;
  }

  showSuggestion(force) {
    if (this.autoSelectFirstSuggestion && !force) {
      return;
    }
    this.displaySuggestion = true;
    this.activeSuggestion = this.autoSelectFirstSuggestion ? 0 : -1;
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
    let scrolltop = (this.activeSuggestion * 22) - 100; //(half of total)
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
    let scrolltop = (this.activeSuggestion * 22) - 100; //(half of total)
    this.autocompleteResultBox.scrollTop = scrolltop > 0 ? scrolltop : 0;
    this.didUpdate();
    return true;
  }
  selectSuggestion() {
    if (!this.autocompleteResults || !this.autocompleteResults.results || this.autocompleteResults.results.length == 0) {
      return;
    }
    //by default auto complete the first item
    let idx = this.activeSuggestion > -1 ? this.activeSuggestion : 0;
    let ar = this.autocompleteResults.results;
    let selStart = this.editor.selectionStart;
    let selEnd = this.editor.selectionEnd;
    let searchTerm = selStart != selEnd
      ? this.editor.value.substring(selStart, selEnd)
      : this.editor.value.substring(0, selStart).match(/[a-zA-Z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;

    this.editor.focus();
    this.applyEdit(ar[idx].value + ar[idx].suffix, selStart, selEnd, "end");
    if (this.autoSelectFirstSuggestion) {
      // the first suggestion is always active, so keeping the list open would make Enter/Tab keep selecting
      this.displaySuggestion = false;
    }
    this.activeSuggestion = this.autoSelectFirstSuggestion ? 0 : -1;
    this.editorAutocompleteHandler();
  }
  setSuggestionPosition(top, left){
    if (this.suggestionTop == top && this.suggestionLeft == left) {
      return;
    }
    this.suggestionTop = top;
    this.suggestionLeft = left;
    this.didUpdate();
  }
  /**
   * APEX script autocomplete handling.
   */
  editorAutocompleteHandler(e = {}) {
    let vm = this; // eslint-disable-line consistent-this
    let script = vm.editor.value;
    let selStart = vm.editor.selectionStart;
    let selEnd = vm.editor.selectionEnd;
    let ctrlSpace = e.ctrlSpace;
    // Skip the calculation when no change is made. This improves performance and prevents async operations (Ctrl+Space) from being canceled when they should not be.
    let newAutocompleteState = [script, selStart, selEnd].join("$");
    if (newAutocompleteState == vm.autocompleteState && !ctrlSpace && !e.newDescribe) {
      return;
    }
    vm.autocompleteState = newAutocompleteState;

    // Cancel any async operation since its results will no longer be relevant.
    if (vm.autocompleteProgress.abort) {
      vm.autocompleteProgress.abort();
    }

    vm.autocompleteClick = ({value, suffix}) => {
      vm.editor.focus();
      vm.applyEdit(value + suffix, selStart, selEnd, "end");
      vm.editorAutocompleteHandler();
    };

    // Find the token we want to autocomplete. This is the selected text, or the last word before the cursor.
    let searchTerm = selStart != selEnd
      ? script.substring(selStart, selEnd)
      : script.substring(0, selStart).match(/[a-zA-Z0-9_.]*$/)[0];
    selStart = selEnd - searchTerm.length;
    if (e.inputType == "insertLineBreak") {
      let lastLine = script.substring(0, selStart - 1);
      lastLine = lastLine.substring(lastLine.lastIndexOf("\n") + 1);
      let m = lastLine.match(/^\s+/);
      if (m) {
        vm.applyEdit(m[0], selStart, selEnd, "end");
      }
    }
    this.autocompleteClass(vm, ctrlSpace);
  }
  applyEdit(value, selectionStart, selectionEnd, mode = "preserve") {
    if (this.editor) {
      this.editor.setRangeText(value, selectionStart, selectionEnd, mode);
      this.editHistory.record();
    }
  }
  undoEdit() {
    this.editHistory.undo();
  }
  redoEdit() {
    this.editHistory.redo();
  }
  handleEditorChange(mergeTyping) {
    this.editHistory.record(mergeTyping);
  }
}
