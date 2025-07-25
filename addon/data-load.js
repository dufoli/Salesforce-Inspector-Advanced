/* global React */
import {sfConn, apiVersion} from "./inspector.js";

// Inspired by C# System.Linq.Enumerable
export function Enumerable(iterable) {
  this[Symbol.iterator] = iterable[Symbol.iterator].bind(iterable);
}
Enumerable.prototype = {
  __proto__: function*(){}.prototype,
  *map(f) {
    for (let e of this) {
      yield f(e);
    }
  },
  *filter(f) {
    for (let e of this) {
      if (f(e)) {
        yield e;
      }
    }
  },
  *flatMap(f) {
    for (let e of this) {
      yield* f(e);
    }
  },
  *concat(other) {
    yield* this;
    yield* other;
  },
  some() {
    for (let e of this) { // eslint-disable-line no-unused-vars
      return true;
    }
    return false;
  },
  groupBy(f) {
    const mapEnum = new Map();
    for (let e of this) {
      mapEnum.set(f(e), e);
    }
    return new Enumerable(mapEnum.values());
  },
  toArray() {
    return Array.from(this);
  }
};
Enumerable.prototype.map.prototype = Enumerable.prototype;
Enumerable.prototype.filter.prototype = Enumerable.prototype;
Enumerable.prototype.flatMap.prototype = Enumerable.prototype;
Enumerable.prototype.concat.prototype = Enumerable.prototype;

// @param didUpdate: A callback function to listen for updates to describe data
export function DescribeInfo(spinFor, didUpdate) {
  function initialState() {
    return {
      data: {global: {globalStatus: "pending", globalDescribe: null}, sobjects: null},
      tool: {global: {globalStatus: "pending", globalDescribe: null}, sobjects: null}
    };
  }
  let sobjectAllDescribes = initialState();
  function getGlobal(useToolingApi) {
    let apiDescribes = sobjectAllDescribes[useToolingApi ? "tool" : "data"];
    if (apiDescribes.global.globalStatus == "pending") {
      apiDescribes.global.globalStatus = "loading";
      spinFor(sfConn.rest(useToolingApi ? "/services/data/v" + apiVersion + "/tooling/sobjects/" : "/services/data/v" + apiVersion + "/sobjects/").then(res => {
        apiDescribes.global.globalStatus = "ready";
        apiDescribes.global.globalDescribe = res;
        apiDescribes.sobjects = new Map();
        for (let sobjectDescribe of res.sobjects) {
          apiDescribes.sobjects.set(sobjectDescribe.name.toLowerCase(), {global: sobjectDescribe, sobject: {sobjectStatus: "pending", sobjectDescribe: null}});
        }
        didUpdate();
      }, () => {
        apiDescribes.global.globalStatus = "loadfailed";
        didUpdate();
      }));
    }
    return apiDescribes;
  }
  // Makes global and sobject describe API calls, and caches the results.
  // If the result of an API call is not already cashed, empty data is returned immediately, and the API call is made asynchronously.
  // The caller is notified using the didUpdate callback or the spinFor promise when the API call completes, so it can make the call again to get the cached results.
  return {
    // Returns an object with two properties:
    // - globalStatus: a string with one of the following values:
    //    "pending": (has not started loading, never returned by this function)
    //    "loading": Describe info for the api is being downloaded
    //    "loadfailed": Downloading of describe info for the api failed
    //    "ready": Describe info is available
    // - globalDescribe: contains a DescribeGlobalResult if it has been loaded
    describeGlobal(useToolingApi) {
      return getGlobal(useToolingApi).global;
    },
    // Returns an object with two properties:
    // - sobjectStatus: a string with one of the following values:
    //    "pending": (has not started loading, never returned by this function)
    //    "notfound": The object does not exist
    //    "loading": Describe info for the object is being downloaded
    //    "loadfailed": Downloading of describe info for the object failed
    //    "ready": Describe info is available
    // - sobjectDescribe: contains a DescribeSObjectResult if the object exists and has been loaded
    describeSobject(useToolingApi, sobjectName, onUpdate) {
      let apiDescribes = getGlobal(useToolingApi);
      if (!apiDescribes.sobjects) {
        return {sobjectStatus: apiDescribes.global.globalStatus, sobjectDescribe: null};
      }
      let sobjectInfo = apiDescribes.sobjects.get(sobjectName.toLowerCase());
      if (!sobjectInfo) {
        return {sobjectStatus: "notfound", sobjectDescribe: null};
      }
      if (sobjectInfo.sobject.sobjectStatus == "pending") {
        sobjectInfo.sobject.sobjectStatus = "loading";
        spinFor(sfConn.rest(sobjectInfo.global.urls.describe).then(res => {
          sobjectInfo.sobject.sobjectStatus = "ready";
          sobjectInfo.sobject.sobjectDescribe = res;
          didUpdate();
          if (onUpdate) {
            onUpdate(sobjectInfo.sobject.sobjectDescribe);
          }
        }, () => {
          sobjectInfo.sobject.sobjectStatus = "loadfailed";
          didUpdate();
          if (onUpdate){
            onUpdate(null);
          }
        }));
      } else if (onUpdate){
        onUpdate(sobjectInfo.sobject.sobjectDescribe);
      }
      return sobjectInfo.sobject;
    },
    reloadAll() {
      sobjectAllDescribes = initialState();
      didUpdate();
    }
  };
}

// Pluralize a numeric value by adding an s (or optional suffix) if it is not 1
export function s(num, suffix = "s") {
  return num == 1 ? "" : suffix;
}

// Copy text to the clipboard, without rendering it, since rendering is slow.
export function copyToClipboard(value) {
  if (parent && parent.isUnitTest) { // for unit tests
    parent.testClipboardValue = value;
    return;
  }
  // Use execCommand to trigger an oncopy event and use an event handler to copy the text to the clipboard.
  // The oncopy event only works on editable elements, e.g. an input field.
  let temp = document.createElement("input");
  // The oncopy event only works if there is something selected in the editable element.
  temp.value = "temp";
  temp.addEventListener("copy", e => {
    e.clipboardData.setData("text/plain", value);
    e.preventDefault();
  });
  document.body.appendChild(temp);
  try {
    // The oncopy event only works if there is something selected in the editable element.
    temp.select();
    // Trigger the oncopy event
    let success = document.execCommand("copy");
    if (!success) {
      alert("Copy failed");
    }
  } finally {
    document.body.removeChild(temp);
  }
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
/*
A table that contains millions of records will freeze the browser if we try to render the entire table at once.
Therefore we implement a table within a scrollable area, where the cells are only rendered, when they are scrolled into view.

Limitations:
* It is not possible to select or search the contents of the table outside the rendered area. The user will need to copy to Excel or CSV to do that.
* Since we initially estimate the size of each cell and then update as we render them, the table will sometimes "jump" as the user scrolls.
* There is no line wrapping within the cells. A cell with a lot of text will be very wide.

Implementation:
Since we don't know the height of each row before we render it, we assume to begin with that it is fairly small, and we then grow it to fit the rendered content, as the user scrolls.
We never schrink the height of a row, to ensure that it stabilzes as the user scrolls. The heights are stored in the `rowHeights` array.
To avoid re-rendering the visible part on every scroll, we render an area that is slightly larger than the viewport, and we then only re-render, when the viewport moves outside the rendered area.
Since we don't know the height of each row before we render it, we don't know exactly how many rows to render.
However since we never schrink the height of a row, we never render too few rows, and since we update the height estimates after each render, we won't repeatedly render too many rows.
The initial estimate of the height of each row should be large enough to ensure we don't render too many rows in our initial render.
We only measure the current size at the end of each render, to minimize the number of synchronous layouts the browser needs to make.
We support adding new rows to the end of the table, and new cells to the end of a row, but not deleting existing rows, and we do not reduce the height of a row if the existing content changes.
Each row may be visible or hidden.
In addition to keeping track of the height of each cell, we keep track of the total height in order to adjust the height of the scrollable area, and we keep track of the position of the scrolled area.
After a scroll we search for the position of the new rendered area using the position of the old scrolled area, which should be the least amount of work when the user scrolls in one direction.
The table must have at least one row, since the code keeps track of the first rendered row.
We assume that the height of the cells we measure sum up to the height of the table.
We do the exact same logic for columns, as we do for rows.
We assume that the size of a cell is not influenced by the size of other cells. Therefore we style cells with `white-space: pre`.

interface Table {
  Cell[][] table; // a two-dimensional array of table rows and cells
  boolean[] rowVisibilities; // For each row, true if it is visible, or false if it is hidden
  boolean[] colVisibilities; // For each column, true if it is visible, or false if it is hidden
  // Refactor: The following three attributes are only used by renderCell, they should be moved to a different interface
  boolean isTooling;
  DescribeInfo describeInfo;
  String sfHost;
}
*/

let h = React.createElement;

export class RecordTable {
  constructor(setStatus, vm) {
    this.records = [];
    this.table = [];
    this.rowVisibilities = [];
    this.colVisibilities = [true];
    this.countOfVisibleRecords = null;
    this.isTooling = false;
    this.totalSize = -1;
    this.columnIdx = new Map();
    this.header = ["_"];
    this.columnType = new Map();
    this.skipTechnicalColumns = localStorage.getItem("skipTechnicalColumns") !== "false";
    this.dateFormat = localStorage.getItem("dateFormat");
    this.datetimeFormat = localStorage.getItem("datetimeFormat");
    this.decimalFormat = localStorage.getItem("decimalFormat");
    this.convertToLocalTime = localStorage.getItem("convertToLocalTime") != "false";
    if (this.decimalFormat != "." && this.decimalFormat != ",") {
      this.decimalFormat = ".";
      localStorage.setItem("decimalFormat", this.decimalFormat);
    }
    this.filter = "";
    this.setStatus = setStatus;
    this.vm = vm;
  }
  convertDate(field, format) {
    if (!field) {
      return "";
    }
    let dt = new Date(field);
    let pad = (n, d) => ("000" + n).slice(-d);
    if (!this.convertToLocalTime) {
      let tzOffset = dt.getTimezoneOffset();// returns the difference in minutes.
      dt.setMinutes(dt.getMinutes() + tzOffset);
    }
    let formatedDate = "";
    let remaining = format;
    while (remaining) {
      if (remaining.match(/^yyyy/i)) {
        remaining = remaining.substring(4);
        formatedDate += dt.getFullYear();
      } else if (remaining.match(/^MM/)) {
        remaining = remaining.substring(2);
        formatedDate += ("0" + (dt.getMonth() + 1)).slice(-2);
      } else if (remaining.match(/^dd/i)) {
        remaining = remaining.substring(2);
        formatedDate += ("0" + dt.getDate()).slice(-2);
      } else if (remaining.match(/^HH/)) {
        remaining = remaining.substring(2);
        formatedDate += ("0" + dt.getHours()).slice(-2);
      } else if (remaining.match(/^mm/)) {
        remaining = remaining.substring(2);
        formatedDate += ("0" + dt.getMinutes()).slice(-2);
      } else if (remaining.match(/^ss/)) {
        remaining = remaining.substring(2);
        formatedDate += ("0" + dt.getSeconds()).slice(-2);
      } else if (remaining.match(/^SSS/)) {
        remaining = remaining.substring(3);
        formatedDate += ("00" + dt.getMilliseconds()).slice(-3);
      } else if (remaining.match(/^\+/)) { //+0000
        remaining = remaining.substring(1);
        formatedDate += (dt.getTimezoneOffset() <= 0 ? "+" : "-");
      } else if (remaining.match(/^FF/)) { //+0000
        remaining = remaining.substring(2);
        if (this.convertToLocalTime) {
          formatedDate += pad(Math.floor(Math.abs(dt.getTimezoneOffset()) / 60), 2);
        } else {
          formatedDate += "00";
        }
      } else if (remaining.match(/^ff/)) {
        remaining = remaining.substring(2);
        if (this.convertToLocalTime) {
          formatedDate += pad(Math.abs(dt.getTimezoneOffset()) % 60, 2);
        } else {
          formatedDate += "00";
        }
      } else {
        formatedDate += remaining[0];
        remaining = remaining.substring(1);
      }
    }
    return formatedDate;
  }
  cellToString(cell) {
    if (cell == null) {
      return "";
    } else if (typeof cell == "object" && cell.attributes && cell.attributes.type) {
      return "[" + cell.attributes.type + "]";
    } else {
      return "" + cell;
    }
  }
  csvSerialize(separator) {
    return this.getVisibleTable().map(row => row.map(cell => "\"" + this.cellToString(cell).split("\"").join("\"\"") + "\"").join(separator)).join("\r\n");
  }
  csvIdSerialize(separator) {
    let idIdx = this.table[0].findIndex(header => header.toLowerCase() === "id");
    return this.getVisibleTable().map(row => row.filter((c, i) => (i == 0 || i == idIdx)).map(cell => "\"" + this.cellToString(cell).split("\"").join("\"\"") + "\"").join(separator)).join("\r\n");
  }
  isVisible(row) {
    return !this.filter || row.some(cell => this.cellToString(cell).toLowerCase().includes(this.filter.toLowerCase()));
  }
  async discoverQueryColumns(record, vm) {
    let fields = vm.columnIndex.fields;
    let sobjectDescribe = null;
    //TODO we will need parent model of rt maybe
    if (record.attributes && record.attributes.type) {
      let sobjectName = record.attributes.type;
      //TODO maybe we will need to wait that cache is already filled on describe
      sobjectDescribe = vm.describeInfo.describeSobject(vm.queryTooling, sobjectName).sobjectDescribe;
    }
    for (let field of fields) {
      let fieldName = "";
      let fieldType = "";
      if (field.name) {
        let fieldNameSplitted = field.name.split(".");
        let subRecord = record;
        let currentSobjectDescribe = sobjectDescribe;
        for (let i = 0; i < fieldNameSplitted.length; i++) {
          const currentFieldName = fieldNameSplitted[i];
          // 1. try to collect name with describe
          if (currentSobjectDescribe) {
            let arr = currentSobjectDescribe.fields
              .filter(sobjField => sobjField.relationshipName && sobjField.relationshipName.toLowerCase() == currentFieldName.toLowerCase())
              .map(sobjField => (sobjField));
            if (arr.length > 0) {
              if (arr[0].referenceTo) {
                //only take first referenceTo
                currentSobjectDescribe = await new Promise(resolve =>
                  vm.describeInfo.describeSobject(vm.queryTooling, arr[0].referenceTo[0], resolve));

                //currentSobjectDescribe = vm.describeInfo.describeSobject(vm.queryTooling, arr[0].referenceTo[0]).sobjectDescribe;
                fieldName = fieldName ? fieldName + "." + arr[0].relationshipName : arr[0].relationshipName;
                if (!this.columnType.has(fieldName)) {
                  this.columnType.set(fieldName, arr[0].type);
                }
                continue;
              }
            }
            arr = currentSobjectDescribe.fields
              .filter(sobjField => sobjField.name.toLowerCase() == currentFieldName.toLowerCase())
              .map(sobjField => (sobjField));
            if (arr.length > 0) {
              fieldName = fieldName ? fieldName + "." + arr[0].name : arr[0].name;
              fieldType = arr[0].type;
              if (!this.columnType.has(fieldName)) {
                this.columnType.set(fieldName, fieldType);
              }
              break;
            }
          }
          // 2. try to collect name with record structure
          for (let f in subRecord) {
            if (f && currentFieldName && f.toLowerCase() == currentFieldName.toLowerCase()) {
              subRecord = subRecord[f];
              fieldName = fieldName ? fieldName + "." + f : f;
              break;
            }
          }
        }
      }
      if (fieldName && !this.columnIdx.has(fieldName)) {
        let c = this.header.length;
        this.columnIdx.set(fieldName, c);
        for (let row of this.table) {
          row.push(undefined);
        }
        this.header[c] = fieldName;
        // hide object column
        this.colVisibilities.push((!field.fields));
        if (fieldName.includes(".")) {
          let splittedField = fieldName.split(".");
          splittedField.slice(0, splittedField.length - 1).map(col => {
            if (!this.skipTechnicalColumns && !this.columnIdx.has(col)) {
              let c = this.header.length;
              this.columnIdx.set(col, c);
              for (let row of this.table) {
                row.push(undefined);
              }
              this.header[c] = col;
              //hide parent column
              this.colVisibilities.push((false));
            }
          });
        }
      }
    }
  }
  discoverColumns(record, prefix, row) {
    for (let field in record) {
      if (field == "attributes") {
        continue;
      }
      let column = prefix + field;
      //remove totalsize, done and records column
      //start
      if (typeof record[field] == "object" && record[field] != null) {
        if (record[field]["records"] != null) {
          record[field] = record[field]["records"];
        } else if (this.skipTechnicalColumns && record[field] != null) {
          this.discoverColumns(record[field], column + ".", row);
          continue;
        }
      }
      if (Array.isArray(record[field])) {
        this.discoverColumns(record[field], column + ".", row);
        continue;
      }
      //end
      let c;
      if (this.columnIdx.has(column)) {
        c = this.columnIdx.get(column);
      } else {
        c = this.header.length;
        this.columnIdx.set(column, c);
        for (let r of this.table) {
          r.push(undefined);
        }
        this.header[c] = column;
        this.colVisibilities.push(true);
      }
      if (this.columnType.get(field) == "date" && this.dateFormat) {
        row[c] = this.convertDate(record[field], this.dateFormat);
      } else if (this.columnType.get(field) == "datetime" && this.datetimeFormat) {
        row[c] = this.convertDate(record[field], this.datetimeFormat);
      } else if (this.columnType.get(field) == "datetime" && this.convertToLocalTime) {
        row[c] = this.convertDtToLocalTime(record[field]);
      } else if ((this.columnType.get(field) == "decimal" || this.columnType.get(field) == "currency") && this.decimalFormat && this.decimalFormat != ".") {
        row[c] = record[field] ? record[field].toString().replace(".", this.decimalFormat) : record[field];
      } else {
        row[c] = record[field];
      }
      if (typeof record[field] == "object" && record[field] != null) {
        this.discoverColumns(record[field], column + ".", row);
      }
    }
  }
  convertDtToLocalTime(field) {
    if (!field) {
      return "";
    }
    let dt = new Date(field);
    let tzOffset = dt.getTimezoneOffset();// returns the difference in minutes.
    dt.setMinutes(dt.getMinutes() - tzOffset);
    let finalDate = dt.toISOString().replace("Z", "");
    finalDate += (tzOffset > 0 ? "-" : "+");
    tzOffset = Math.abs(tzOffset);
    let offsetHours = Math.floor(tzOffset / 60);
    let offsetMinutes = tzOffset % 60;
    finalDate += String(offsetHours).padStart(2, "0");
    finalDate += String(offsetMinutes).padStart(2, "0");
    return finalDate;
  }
  async addToTable(expRecords) {
    this.records = this.records.concat(expRecords);
    if (this.table.length == 0 && expRecords.length > 0) {
      this.table.push(this.header);
      this.rowVisibilities.push(true);
    }
    for (let record of expRecords) {
      let row = new Array(this.header.length);
      row[0] = record;
      this.table.push(row);
      this.rowVisibilities.push(this.isVisible(row));
      if (this.vm){
        await this.discoverQueryColumns(record, this.vm);
      }
      this.discoverColumns(record, "", row);
    }
  }
  resetTable() {
    this.records = [];
    this.table = [];
    this.columnIdx = new Map();
    this.header = ["_"];
    this.rowVisibilities = [];
    this.totalSize = -1;
  }
  updateVisibility(fltr) {
    this.filter = fltr;
    let countOfVisibleRecords = 0;
    for (let r = 1/* always show header */; r < this.table.length; r++) {
      this.rowVisibilities[r] = this.isVisible(this.table[r]);
      if (this.isVisible(this.table[r])) countOfVisibleRecords++;
    }
    this.countOfVisibleRecords = countOfVisibleRecords;
    if (this.setStatus) {
      this.setStatus("Filtered " + countOfVisibleRecords + " records out of " + this.records.length + " records");
    }
  }
  getVisibleTable() {
    if (this.filter) {
      let filteredTable = [];
      for (let i = 0; i < this.table.length; i++) {
        if (this.rowVisibilities[i]) { filteredTable.push(this.table[i]); }
      }
      return filteredTable;
    }
    return this.table;
  }
}
export class TableModel {
  constructor(sfHost, reactCallback, options = {}) {
    this.reactCallback = reactCallback;
    this.options = options;
    this.headerCallout = localStorage.getItem("createUpdateRestCalloutHeaders") ? JSON.parse(localStorage.getItem("createUpdateRestCalloutHeaders")) : "{}";
    this.sfHost = sfHost;
    this.data = null;
    this.initialRowHeight = 15; // constant: The initial estimated height of a row before it is rendered
    this.initialColWidth = 50; // constant: The initial estimated width of a column before it is rendered
    this.bufferHeight = 500; // constant: The number of pixels to render above and below the current viewport
    this.bufferWidth = 500; // constant: The number of pixels to render to the left and right of the current viewport
    this.headerRows = 1; // constant: The number of header rows
    this.headerCols = 0; // constant: The number of header columns
    this.rowHeights = []; // The height in pixels of each row
    this.rowVisible = []; // The visibility of each row. 0 = hidden, 1 = visible
    this.rowCount = 0;
    this.totalHeight = 0; // The sum of heights of visible cells
    this.firstRowIdx = 0; // The index of the first rendered row
    this.firstRowTop = 0; // The distance from the top of the table to the top of the first rendered row
    this.lastRowIdx = 0; // The index of the row below the last rendered row
    this.lastRowTop = 0; // The distance from the top of the table to the bottom of the last rendered row (the top of the row below the last rendered row)
    this.colWidths = []; // The width in pixels of each column
    this.colVisible = []; // The visibility of each column. 0 = hidden, 1 = visible
    this.colCount = 0;
    this.totalWidth = 0; // The sum of widths of visible cells
    this.firstColIdx = 0; // The index of the first rendered column
    this.firstColLeft = 0; // The distance from the left of the table to the left of the first rendered column
    this.lastColIdx = 0; // The index of the column to the right of the last rendered column
    this.lastColLeft = 0; // The distance from the left of the table to the right of the last rendered column (the left of the column after the last rendered column)
    this.cellMenuOpened = null;
    this.cellMenuToClose = null;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.offsetHeight = 0;
    this.offsetWidth = 0;
    this.scrolled = null;
    this.scroller = null;
    this.header = [];
    this.rows = [];
    this.scrolledHeight = 0;
    this.scrolledWidth = 0;
    this.editedRows = new Map();//idx to {cellidx: {dataEditValue:}, cellIdx2: {dataEditValue:}}
    this.state = {
      skipRecalculate: true
    };
    this.bgColors = new Map();
  }
  setScrollerElement(scroller, scrolled) {
    this.scrolled = scrolled;
    this.scroller = scroller;
    this.dataChange(null);
  }
  //called after render
  viewportChange() {
    if (this.scrollTop == this.scroller.scrollTop
      && this.scrollLeft == this.scroller.scrollLeft
      && this.offsetHeight == this.scroller.offsetHeight
      && this.offsetWidth == this.scroller.offsetWidth
    ) {
      this.state.skipRecalculate = true;
      return;
    }
    this.renderData({force: false});
  }

  recalculate(){
    if (this.state.skipRecalculate) {
      return;
    }
    // Before this point we invalidate style and layout. After this point we recalculate style and layout, and we do not invalidate them again.
    if (this.rows.length > 0) {
      //thead
      let thead = this.scrolled.firstElementChild.firstElementChild;
      if (thead){
        let tr = thead.firstElementChild;
        let rowRect = tr.firstElementChild.getBoundingClientRect();
        let oldHeight = this.rowHeights[0];
        let newHeight = Math.max(oldHeight, rowRect.height);
        this.rowHeights[0] = newHeight;
        this.totalHeight += newHeight - oldHeight;
        this.lastRowTop += newHeight - oldHeight;
      }
      let tbody = this.scrolled.firstElementChild.lastElementChild;
      let tr = tbody.firstElementChild;
      for (let r = (this.firstRowIdx > 0 ? this.firstRowIdx : 1); r < this.lastRowIdx; r++) {
        //display happend after model refresh so tr can be null
        if (this.rowVisible[r] == 0 || tr == null) {
          continue;
        }
        let rowRect = tr.firstElementChild.getBoundingClientRect();
        let oldHeight = this.rowHeights[r];
        let newHeight = Math.max(oldHeight, rowRect.height);
        this.rowHeights[r] = newHeight;
        this.totalHeight += newHeight - oldHeight;
        this.lastRowTop += newHeight - oldHeight;
        tr = tr.nextElementSibling;
      }
      let td = tbody.firstElementChild.firstElementChild;
      for (let c = this.firstColIdx; c < this.lastColIdx; c++) {
        //display happend after model refresh so td can be null
        if (this.colVisible[c] == 0 || td == null) {
          continue;
        }
        let colRect = td.getBoundingClientRect();
        let oldWidth = this.colWidths[c];
        let newWidth = Math.max(oldWidth, colRect.width);
        this.colWidths[c] = newWidth;
        this.totalWidth += newWidth - oldWidth;
        this.lastColLeft += newWidth - oldWidth;
        td = td.nextElementSibling;
      }
    }
  }
  getBackgroundColor(rowIdx, cellIdx) {
    return this.bgColors.get(`${rowIdx}-${cellIdx}`);
  }
  doSaveAll(){
    let cnt = this.editedRows.size;
    this.editedRows.forEach((cellMap, rowIdx) => {
      cnt--;
      let record = {};
      if (!cellMap.values().some(cell => (cell.dataEditValue != null))) {
        if (cnt == 0) {
          this.didUpdate();
        }
        return;
      }
      cellMap.forEach((cell, cellIdx) => {
        if (cell.dataEditValue != null) {
          record[this.data.table[0][cellIdx]] = cell.dataEditValue;
        }
      });
      let recordUrl;
      let firstCell = this.data.table[rowIdx][0];
      if (typeof firstCell == "object" && firstCell != null && firstCell.attributes && firstCell.attributes.url) {
        recordUrl = firstCell.attributes.url;
      }
      sfConn.rest(recordUrl, {method: "PATCH", body: record, headers: this.headerCallout}).then(() => {
        let row = this.rows.find(r => r.idx == rowIdx);
        row.cells.filter(c => c.dataEditValue !== null).forEach(c => {
          c.label = c.dataEditValue;
          c.dataEditValue = null;
          c.isEditing = false;
        });
        cellMap.forEach(cell => {
          cell.label = cell.dataEditValue;
          cell.dataEditValue = null;
          cell.isEditing = false;
        });

        if (cnt == 0) {
          this.didUpdate();
        }
      }).catch(error => {
        //TODO handle error and display
        //row.error = error.message;
        console.log(error);
        this.didUpdate();
      });
    });
  }
  doApplyAll(rowId) {
    let row = this.rows[rowId];
    let separator = ",";
    if (localStorage.getItem("csvSeparator")) {
      separator = localStorage.getItem("csvSeparator");
    }
    let suffix = "";
    let header = "\"Id\"";
    row.cells.filter(c => c.dataEditValue !== undefined).forEach((c) => {
      suffix += `${separator}"${c.dataEditValue}"`;
      header += `${separator}"${this.data.table[0][c.idx]}"`;
    });
    let idFieldIdx = this.data.table[0].indexOf("Id");
    let csv = header + "\r\n" + this.data.table.filter((c, i) => i != 0).map(row => `"${row[idFieldIdx]}"${suffix}`).join("\r\n");
    let encodedData = window.btoa(csv);

    let args = new URLSearchParams();
    args.set("host", this.sfHost);
    args.set("data", encodedData);
    args.set("sobject", this.data.table[1][0]?.attributes?.type);
    args.set("action", "update");
    if (this.queryTooling) args.set("apitype", "Tooling");

    window.open("data-import.html?" + args, "_blank");
  }
  doSave(rowId) {
    let row = this.rows[rowId];
    let record = {};
    row.cells.filter(c => c.dataEditValue !== undefined).forEach(c => {
      record[this.data.table[0][c.idx]] = c.dataEditValue;
    });
    let recordUrl;
    let firstCell = this.data.table[row.idx][0];
    let idFieldIdx = this.data.table[0].indexOf("Id");
    let recordId = this.data.table[row.idx][idFieldIdx];
    let toolingUrl = (this.data.isTooling ? "tooling/" : "");
    if (typeof firstCell == "object" && firstCell != null && firstCell.attributes && firstCell.attributes.type) {
      //recordUrl = firstCell.attributes.url; wrong on entityDfinition
      recordUrl = `/services/data/v${apiVersion}${toolingUrl}/sobjects/${firstCell.attributes.type}/${recordId}`;
    } else {
      let {globalDescribe} = this.data.describeInfo.describeGlobal(this.data.isTooling);
      if (globalDescribe) {
        let keyPrefix = recordId.substring(0, 3);
        let desc = globalDescribe.sobjects.find(sobject => sobject.keyPrefix == keyPrefix);
        if (desc){
          recordUrl = `/services/data/v${apiVersion}${toolingUrl}/sobjects/${desc.name}/${recordId}`;
        }
      }
    }

    //TODO spinfor
    sfConn.rest(recordUrl, {method: "PATCH", body: record, headers: this.headerCallout}).then(() => {
      //do not refresh trigger data update because too complicated.
      this.endEdit(rowId);
    }).catch(error => {
      row.error = error.message;
      console.log(error);
      this.didUpdate();
    });
  }
  endEdit(rowId) {
    let row = this.rows[rowId];
    if (!row) {
      return;
    }
    row.cells.filter(c => c.dataEditValue !== undefined).forEach(c => {
      c.label = c.dataEditValue;
      c.dataEditValue = undefined;
      c.isEditing = false;
    });
    this.editedRows.get(row.idx).forEach((cell) => {
      if (cell.dataEditValue != null) {
        cell.label = cell.dataEditValue;
        cell.dataEditValue = null;
        cell.isEditing = false;
      }
    });
    this.didUpdate();
  }
  cancelEditCell(rowId, cellId) {
    let row = this.rows[rowId];
    let cell = row.cells[cellId];
    cell.dataEditValue = null;
    cell.isEditing = false;
    let rowEditedCells = this.editedRows.get(row.idx);
    if (rowEditedCells){
      let c = rowEditedCells.get(cell.idx);
      c.dataEditValue = null;
      c.isEditing = false;
    }
    this.didUpdate();
  }
  setEditCell(rowId, cellId, newValue){
    let row = this.rows[rowId];
    let cell = row.cells[cellId];
    cell.dataEditValue = newValue;
    cell.isEditing = true;
    let rowEditedCells = this.editedRows.get(row.idx);
    if (!rowEditedCells){
      rowEditedCells = new Map();
      this.editedRows.set(row.idx, rowEditedCells);
    }
    let c = rowEditedCells.get(cell.idx);
    if (!c){
      c = {};
      rowEditedCells.set(cell.idx, c);
    }
    c.dataEditValue = newValue;
    c.isEditing = true;
  }
  editRow(rowId) {
    let row = this.rows[rowId];
    let rowEditedCells = this.editedRows.get(row.idx);
    if (!rowEditedCells){
      rowEditedCells = new Map();
      this.editedRows.set(row.idx, rowEditedCells);
    }
    for (let cellId = 0; cellId < row.cells.length; cellId++) {
      let cell = row.cells[cellId];
      //do not allow edit of id, CreatedById, LastModifiedById, createddate, lastmodifieddate
      if (this.header[cellId] && this.header[cellId].name
        && (this.header[cellId].name.toLowerCase() == "id"
        || this.header[cellId].name.toLowerCase() == "createdbyid"
        || this.header[cellId].name.toLowerCase() == "lastmodifiedbyid"
        || this.header[cellId].name.toLowerCase() == "createddate"
        || this.header[cellId].name.toLowerCase() == "lastmodifieddate")) {
        continue;
      }
      // do not allow edit if no id column
      if (!this.header.some(c => c?.name != null && c?.name?.toLowerCase() == "id")) {
        continue;
      }
      //do not allow edit of object column
      if (cell.linkable && !this.isRecordId(cell.label)){
        continue;
      }
      // not sub record for moment
      if (this.header[cell.id].name && this.header[cell.id].name.includes(".")){
        continue;
      }
      let tableRow = this.data.table[row.idx];
      let objectCell = tableRow && tableRow.length ? tableRow[0] : null;
      if (objectCell && objectCell.attributes && objectCell.attributes.type) {
        let {sobjectStatus, sobjectDescribe} = this.data.describeInfo.describeSobject(this.data.isTooling, objectCell.attributes.type);
        if (sobjectStatus == "ready") {
          let picklistValues = sobjectDescribe.fields
            .filter(f => f.name.toLowerCase() == this.header[cell.id].name.toLowerCase())
            .flatMap(f => f.picklistValues)
            .map(pv => pv.value);
          if (picklistValues && picklistValues.length) {
            cell.suggestions = picklistValues;
            cell.filteredSuggestions = cell.suggestions;
          }
        }
      }
      cell.dataEditValue = cell.label;
      cell.isEditing = true;
      let c = rowEditedCells.get(cell.idx);
      if (!c){
        c = {};
        rowEditedCells.set(cell.idx, c);
      }
      c.dataEditValue = cell.label;
      c.isEditing = true;
    }
    this.didUpdate();
  }
  editCell(rowId, cellId) {
    let row = this.rows[rowId];
    let cell = row.cells[cellId];
    //do not allow edit of id
    if (this.header[cellId] && this.header[cellId].name && this.header[cellId].name.toLowerCase() == "Id") {
      return;
    }
    // do not allow edit if no id column
    if (!this.data.table[0].some(c => c == "Id")) {
      return;
    }
    //do not allow edit of object column
    if (cell.linkable && !this.isRecordId(cell.label)){
      return;
    }
    // not sub record for moment
    if (this.header[cell.id].name && this.header[cell.id].name.includes(".")){
      return;
    }
    let tableRow = this.data.table[row.idx];
    let objectCell = tableRow && tableRow.length ? tableRow[0] : null;
    if (objectCell && objectCell.attributes && objectCell.attributes.type) {
      let {sobjectStatus, sobjectDescribe} = this.data.describeInfo.describeSobject(this.data.isTooling, objectCell.attributes.type);
      if (sobjectStatus == "ready") {
        let picklistValues = sobjectDescribe.fields
          .filter(f => f.name.toLowerCase() == this.header[cell.id].name.toLowerCase())
          .flatMap(f => f.picklistValues)
          .map(pv => pv.value);
        if (picklistValues && picklistValues.length) {
          cell.suggestions = picklistValues;
          cell.filteredSuggestions = cell.suggestions;
        }
      }
    }

    cell.dataEditValue = cell.label;
    cell.isEditing = true;
    let rowEditedCells = this.editedRows.get(row.idx);
    if (!rowEditedCells){
      rowEditedCells = new Map();
      this.editedRows.set(row.idx, rowEditedCells);
    }
    let c = rowEditedCells.get(cell.idx);
    if (!c){
      c = {};
      rowEditedCells.set(cell.idx, c);
    }
    c.dataEditValue = cell.label;
    c.isEditing = true;
    this.didUpdate();
  }
  renderData({force}) {
    this.scrollTop = this.scroller.scrollTop;
    this.scrollLeft = this.scroller.scrollLeft;
    this.offsetHeight = this.scroller.offsetHeight;
    this.offsetWidth = this.scroller.offsetWidth;

    if (this.rowCount == 0 || this.colCount == 0) {
      this.header = [];
      this.rows = [];
      this.scrolledHeight = 0;
      this.scrolledWidth = 0;
      this.state.skipRecalculate = true;
      return;
    }

    if (!force && this.firstRowTop <= this.scrollTop && (this.lastRowTop >= this.scrollTop + this.offsetHeight || this.lastRowIdx == this.rowCount)
     && this.firstColLeft <= this.scrollLeft && (this.lastColLeft >= this.scrollLeft + this.offsetWidth || this.lastColIdx == this.colCount)) {
      if (this.scrolledHeight != this.totalHeight || this.scrolledWidth != this.totalWidth){
        this.scrolledHeight = this.totalHeight;
        this.scrolledWidth = this.totalWidth;
        this.state.skipRecalculate = true;
        this.didUpdate();
      }
      return;
    }
    this.state.skipRecalculate = false;
    while (this.firstRowTop < this.scrollTop - this.bufferHeight && this.firstRowIdx < this.rowCount - 1) {
      this.firstRowTop += this.rowVisible[this.firstRowIdx] * this.rowHeights[this.firstRowIdx];
      this.firstRowIdx++;
    }
    while (this.firstRowTop > this.scrollTop - this.bufferHeight && this.firstRowIdx > 0) {
      this.firstRowIdx--;
      this.firstRowTop -= this.rowVisible[this.firstRowIdx] * this.rowHeights[this.firstRowIdx];
    }
    while (this.firstColLeft < this.scrollLeft - this.bufferWidth && this.firstColIdx < this.colCount - 1) {
      this.firstColLeft += this.colVisible[this.firstColIdx] * this.colWidths[this.firstColIdx];
      this.firstColIdx++;
    }
    while (this.firstColLeft > this.scrollLeft - this.bufferWidth && this.firstColIdx > 0) {
      this.firstColIdx--;
      this.firstColLeft -= this.colVisible[this.firstColIdx] * this.colWidths[this.firstColIdx];
    }

    this.lastRowIdx = this.firstRowIdx;
    this.lastRowTop = this.firstRowTop;
    while (this.lastRowTop < this.scrollTop + this.offsetHeight + this.bufferHeight && this.lastRowIdx < this.rowCount) {
      this.lastRowTop += this.rowVisible[this.lastRowIdx] * this.rowHeights[this.lastRowIdx];
      this.lastRowIdx++;
    }
    this.lastColIdx = this.firstColIdx;
    this.lastColLeft = this.firstColLeft;
    while (this.lastColLeft < this.scrollLeft + this.offsetWidth + this.bufferWidth && this.lastColIdx < this.colCount) {
      this.lastColLeft += this.colVisible[this.lastColIdx] * this.colWidths[this.lastColIdx];
      this.lastColIdx++;
    }
    //first calculate header
    this.header = [];
    let head = this.data.table[0];
    for (let c = this.firstColIdx; c < this.lastColIdx; c++) {
      if (this.colVisible[c] == 0) {
        continue;
      }
      if (this.options.columns && this.options.columns.find(co => co.name == this.data.table[0][c])?.title) {
        head[c] = this.options.columns.find(co => co.name == this.data.table[0][c]).title;
      }
      this.header.push({name: head[c], idx: c, id: this.header.length});
    }
    this.rows = [];
    this.scrolledHeight = this.totalHeight;
    this.scrolledWidth = this.totalWidth;

    for (let r = (this.firstRowIdx > 0 ? this.firstRowIdx : 1); r < this.lastRowIdx; r++) {
      if (this.rowVisible[r] == 0) {
        continue;
      }

      let row = this.data.table[r];
      let dataRow = {cells: []};
      let editedRow = this.editedRows.get(r);
      for (let c = this.firstColIdx; c < this.lastColIdx; c++) {
        if (this.colVisible[c] == 0) {
          continue;
        }
        let cell = row[c];
        let dataCell;
        if (editedRow){
          let editedVal = editedRow.get(c);
          if (editedVal != null) {
            dataCell = editedVal;
          }
        }
        if (dataCell == null) {
          dataCell = {linkable: false, label: "", showMenu: false, links: []};
        }

        //row.height
        if (typeof cell == "object" && cell != null && cell.attributes && cell.attributes.type) {
          if (cell.attributes.url) {
            dataCell.recordId = cell.attributes.url.replace(/.*\//, "");
          }
          dataCell.objectTypes = [cell.attributes.type];
          dataCell.label = cell.attributes.type;
          dataCell.linkable = true;
        } else if (typeof cell == "string" && this.isRecordId(cell)) {
          dataCell.recordId = cell;
          dataCell.label = cell;
          dataCell.linkable = true;
          let {globalDescribe} = this.data.describeInfo.describeGlobal(this.data.isTooling);
          if (globalDescribe) {
            let keyPrefix = dataCell.recordId.substring(0, 3);
            dataCell.objectTypes = globalDescribe.sobjects.filter(sobject => sobject.keyPrefix == keyPrefix).map(sobject => sobject.name);
          } else {
            dataCell.objectTypes = [];
          }
        } else if (typeof cell == "string" && this.isEventLogFile(cell)) {
          dataCell.recordId = cell;
          dataCell.objectTypes = [];
          dataCell.label = cell;
          dataCell.linkable = true;
        } else if (cell == null) {
          dataCell.label = "";
        } else {
          dataCell.label = cell;
        }
        dataCell.id = dataRow.cells.length;
        dataCell.idx = c;
        dataRow.cells.push(dataCell);
      }
      dataRow.id = this.rows.length;
      dataRow.idx = r;
      this.rows.push(dataRow);
    }
    this.didUpdate();
  }

  dataChange(newData) {
    this.data = newData;
    if (this.data == null || this.data.rowVisibilities.length == 0 || this.data.colVisibilities.length == 0) {
      // First render, or table was cleared
      this.rowHeights = [];
      this.rowVisible = [];
      this.rowCount = 0;
      this.totalHeight = 0;
      this.firstRowIdx = 0;
      this.firstRowTop = 0;
      this.lastRowIdx = 0;
      this.lastRowTop = 0;
      this.colWidths = [];
      this.colVisible = [];
      this.colCount = 0;
      this.totalWidth = 0;
      this.firstColIdx = 0;
      this.firstColLeft = 0;
      this.lastColIdx = 0;
      this.lastColLeft = 0;
      this.editedRows = new Map();
      this.cellMenuOpened = null;
      this.cellMenuToClose = null;
      this.state.skipRecalculate = false;
      this.bgColors = new Map();
      this.renderData({force: true});
    } else {
      this.bgColors = this.data.bgColors ?? new Map();
      // Data or visibility was changed
      let newRowCount = this.data.rowVisibilities.length;
      for (let r = this.rowCount; r < newRowCount; r++) {
        this.rowHeights[r] = this.initialRowHeight;
        this.rowVisible[r] = 0;
      }
      this.rowCount = newRowCount;
      for (let r = 0; r < this.rowCount; r++) {
        let newVisible = Number(this.data.rowVisibilities[r]);
        let visibilityChange = newVisible - this.rowVisible[r];
        this.totalHeight += visibilityChange * this.rowHeights[r];
        if (r < this.firstRowIdx) {
          this.firstRowTop += visibilityChange * this.rowHeights[r];
        }
        this.rowVisible[r] = newVisible;
      }
      let newColCount = this.data.colVisibilities.length;
      for (let c = this.colCount; c < newColCount; c++) {
        this.colWidths[c] = this.initialColWidth;
        this.colVisible[c] = 0;
      }
      this.colCount = newColCount;
      for (let c = 0; c < this.colCount; c++) {
        let newVisible = Number(this.data.colVisibilities[c]);
        let visibilityChange = newVisible - this.colVisible[c];
        this.totalWidth += visibilityChange * this.colWidths[c];
        if (c < this.firstColIdx) {
          this.firstColLeft += visibilityChange * this.colWidths[c];
        }
        if (this.options.columns && this.options.columns.find(co => co.name == this.data.table[0][c])?.hidden) {
          this.colVisible[c] = 0;
        } else {
          this.colVisible[c] = newVisible;
        }
      }
      this.state.skipRecalculate = false;
      this.renderData({force: true});
    }
  }
  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
    }
  }
  isRecordId(recordId) {
    // We assume a string is a Salesforce ID if it is 18 characters,
    // contains only alphanumeric characters,
    // the record part (after the 3 character object key prefix and 2 character instance id) starts with at least four zeroes,
    // and the 3 character object key prefix is not all zeroes.
    return /^[a-z0-9]{5}0000[a-z0-9]{9}$/i.exec(recordId) && !recordId.startsWith("000");
  }
  isEventLogFile(text) {
    // test the text to identify if this is a path to an eventLogFile
    return /^\/services\/data\/v[0-9]{2,3}.[0-9]{1}\/sobjects\/EventLogFile\/[a-z0-9]{5}0000[a-z0-9]{9}\/LogFile$/i.exec(text);
  }
  toggleMenu(rowId, cellId) {
    if (!this.rows || this.rows.length == 0) {
      return;
    }
    let row = this.rows[rowId];
    if (!row) {
      return;
    }
    let cell = row.cells[cellId];
    if (!cell) {
      return;
    }
    cell.showMenu = !cell.showMenu;
    let editedRow = this.editedRows.get(row.idx);
    if (editedRow == null) {
      editedRow = new Map();
      this.editedRows.set(row.idx, editedRow);
    }
    let editedCell = editedRow.get(cell.idx);
    if (editedCell == null) {
      editedCell = new Map();
      editedRow.set(cell.idx, editedCell);
    }
    editedCell.showMenu = cell.showMenu;
    let self = this;
    function setLinks(){
      cell.links = [];
      let args = new URLSearchParams();
      args.set("host", self.sfHost);
      args.set("objectType", cell.objectType);
      if (self.data.isTooling) {
        args.set("useToolingApi", "1");
      }
      if (cell.recordId) {
        args.set("recordId", cell.recordId);
      }
      if (cell.objectType == "AggregateResult") {
        return;
      }
      cell.links.push({withIcon: true, href: "inspect.html?" + args, label: "Show all data", className: "view-inspector", action: ""});

      let query = "SELECT Id FROM " + cell.objectType + " WHERE Id = '" + cell.recordId + "'";
      let queryArgs = new URLSearchParams();
      queryArgs.set("host", self.sfHost);
      queryArgs.set("query", query);
      if (self.data.isTooling) {
        queryArgs.set("useToolingApi", "1");
      }
      cell.links.push({withIcon: true, href: "data-export.html?" + queryArgs, label: "Query Record", className: "query-record", action: ""});

      if (cell.objectType == "ApexLog") {
        let queryLogArgs = new URLSearchParams();
        queryLogArgs.set("host", self.sfHost);
        queryLogArgs.set("recordId", cell.recordId);
        cell.links.push({withIcon: true, href: "log.html?" + queryLogArgs, label: "View Log", className: "view-log", action: ""});
      }
      if (cell.objectType == "AsyncApexJob") {
        cell.links.push({withIcon: true, href: cell.recordId, label: "Abord Job", className: "abord-job", action: "abord"});
      }

      // If the recordId ends with 0000000000AAA it is a dummy ID such as the ID for the master record type 012000000000000AAA
      if (cell.recordId && self.isRecordId(cell.recordId) && !cell.recordId.endsWith("0000000000AAA")) {
        cell.links.push({withIcon: true, href: "https://" + self.sfHost + "/" + cell.recordId, label: "View in Salesforce", className: "view-salesforce", action: ""});
      }

      //Download event logFile
      if (self.isEventLogFile(cell.recordId)) {
        cell.links.push({withIcon: true, href: cell.recordId, label: "Download File", className: "download-salesforce", action: "download"});
      } else {
        cell.links.push({withIcon: true, href: cell.recordId, label: "Copy Id", className: "copy-id", action: "copy"});
      }
      cell.links.push({withIcon: true, href: cell.recordId, label: "Edit", title: "Double click on cell to edit", className: "edit-record", action: "edit"});
      editedCell.links = cell.links;
      self.didUpdate();
    }
    if (cell.showMenu) {
      this.cellMenuOpened = {cellId, rowId};
      if (!cell.links || cell.links.length === 0) {
        if (cell.objectTypes.length === 1){
          cell.objectType = cell.objectTypes[0];
          editedCell.objectType = cell.objectType;
          setLinks();
        } else {
          sfConn.rest(`/services/data/v${apiVersion}/ui-api/records/${cell.recordId}?layoutTypes=Compact`).then(res => {
            cell.objectType = res.apiName;
            editedCell.objectType = cell.objectType;
            setLinks();
          });
        }
      }
    }
    // refresh to hide menu
    this.didUpdate();
  }

  onClick(){
    //bubble event so handle it after
    if (this.cellMenuToClose){
      //close menu
      this.toggleMenu(this.cellMenuToClose.rowId, this.cellMenuToClose.cellId);
    }
    this.cellMenuToClose = this.cellMenuOpened;
    this.cellMenuOpened = null;
  }
}
class ScrollTableCell extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.cell = props.cell;
    this.colWidth = props.colWidth;
    this.row = props.row;
    this.previousCell = props.previousCell;
    this.onTryEdit = this.onTryEdit.bind(this);
    this.onClick = this.onClick.bind(this);
    this.downloadFile = this.downloadFile.bind(this);
    this.copyToClipboard = this.copyToClipboard.bind(this);
    this.onCancelEdit = this.onCancelEdit.bind(this);
    this.onDataEditValueInput = this.onDataEditValueInput.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onSuggestionClick = this.onSuggestionClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onEditRecord = this.onEditRecord.bind(this);
    this.state = {
      activeSuggestion: 0,
      showSuggestions: false
    };
  }
  onTryEdit() {
    let {model} = this.props;
    model.editCell(this.row.id, this.cell.id);
  }
  onEditRecord(e) {
    e.preventDefault();
    let {model} = this.props;
    model.editRow(this.row.id);
  }
  componentDidMount() {

  }

  abordJob(e){
    let script = "System.abortJob('" + e.target.href + "')";
    sfConn.rest("/services/data/v" + apiVersion + "/tooling/executeAnonymous/?anonymousBody=" + encodeURIComponent(script), {})
      .catch(error => { console.error(error); });
  }
  downloadFile(e){
    sfConn.rest(e.target.href, {responseType: "text/csv"}).then(data => {
      let downloadLink = document.createElement("a");
      downloadLink.download = e.target.href.split("/")[6];
      let BOM = "\uFEFF";
      let bb = new Blob([BOM, data], {type: "text/csv;charset=utf-8"});
      downloadLink.href = window.URL.createObjectURL(bb);
      downloadLink.click();
    });
  }
  copyToClipboard(e){
    e.preventDefault();
    navigator.clipboard.writeText(this.cell.recordId);
    this.model.toggleMenu(this.row.id, this.cell.id);
  }
  onClick(e) {
    e.preventDefault();
    this.model.toggleMenu(this.row.id, this.cell.id);
  }
  onFocus() {
    let {model} = this.props;
    this.setState({
      activeSuggestion: 0,
      showSuggestions: true
    });
    model.didUpdate();
  }
  onBlur() {
    let {model} = this.props;
    setTimeout(() => {
      //no need to refresh if already refresh by click on value
      if (!this.state || !this.state.showSuggestions) {
        return;
      }
      this.setState({
        activeSuggestion: 0,
        showSuggestions: false
      });
      model.didUpdate();
    }, 100); // Set timeout for 500ms
  }
  onDataEditValueInput(e) {
    let {model, cell, row} = this.props;
    const userInput = e.target.value;
    //TODO state
    if (cell.suggestions){
      cell.filteredSuggestions = cell.suggestions.filter(
        suggestion =>
          suggestion.toLowerCase().indexOf(userInput.toLowerCase()) > -1
      );
    }
    this.setState({
      activeSuggestion: 0,
      showSuggestions: true
    });
    cell.dataEditValue = userInput;
    model.setEditCell(row.id, cell.id, userInput);
    model.didUpdate();
  }
  onSuggestionClick(e) {
    let {cell} = this.props;
    this.setState({
      activeSuggestion: 0,
      showSuggestions: false
    });
    cell.filteredSuggestions = [];
    cell.dataEditValue = e.target.innerText;
  }
  onKeyDown(e){
    const {activeSuggestion} = this.state;
    let {cell} = this.props;
    if (!cell.filteredSuggestions || cell.filteredSuggestions.length == 0) {
      return;
    }
    switch (e.keyCode) {
      case 40:
        if (activeSuggestion - 1 === cell.filteredSuggestions.length) {
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
        cell.dataEditValue = cell.filteredSuggestions[activeSuggestion];
        e.preventDefault();
        break;
    }
  }
  onCancelEdit(e) {
    e.preventDefault();
    let {model} = this.props;
    model.cancelEditCell(this.row.id, this.cell.id);
  }
  render() {
    let {cell, rowHeight, colWidth, previousCell, row, model} = this.props;
    let {activeSuggestion, showSuggestions} = this.state;
    let cellLabel = cell.label?.toString();
    if (cellLabel == "[object Object]") {
      cellLabel = "";
    }
    let cellDataEditValue = cell.dataEditValue?.toString();
    if (cellDataEditValue == "[object Object]") {
      cellDataEditValue = "";
    }
    let className = "scrolltable-cell";
    let cellStyle = {minWidth: colWidth + "px", height: rowHeight + "px"};
    let bgColor = model.getBackgroundColor(row.idx, cell.idx);
    if (bgColor) {
      cellStyle.backgroundColor = bgColor;
    }
    if (cell.isEditing){
      if (previousCell != null && previousCell.dataEditValue != cell.dataEditValue) {
        className += " scrolltable-cell-diff";
      }
      return h("td", {className, style: cellStyle},
        h("textarea", {value: cellDataEditValue, onChange: this.onDataEditValueInput, onFocus: this.onFocus, onBlur: this.onBlur, onKeyDown: this.onKeyDown}),
        h("a", {href: "about:blank", onClick: this.onCancelEdit, className: "undo-button"}, "\u21B6"),
        (showSuggestions && cell.filteredSuggestions && cell.filteredSuggestions.length)
          ? h("ul", {className: "suggestions"},
            cell.filteredSuggestions.map((suggestion, index) => {
              let SuggestionClass;
              if (index === activeSuggestion) {
                SuggestionClass = "suggestion-active";
              }
              return h("li", {className: SuggestionClass, key: suggestion, onMouseDown: this.onSuggestionClick}, suggestion);
            })
          ) : "");
    } else {
      if (previousCell != null && previousCell.label != cell.label) {
        className += " scrolltable-cell-diff";
      }
      return h("td", {className, style: cellStyle},
        cell.linkable ? h("a", {href: "about:blank", title: "Show all data", onClick: this.onClick, onDoubleClick: this.onTryEdit}, cellLabel) : h("div", {style: {height: "100%"}, onDoubleClick: this.onTryEdit}, cellLabel),
        cell.showMenu ? h("div", {className: "pop-menu"},
          cell.links.map((l, idx) => {
            let arr = [];
            if (l.withIcon) {
              arr.push(h("div", {className: "icon"}));
            }
            arr.push(l.label);
            let attributes = {href: l.href, target: "_blank", className: l.className, key: "link" + idx};
            if (l.title) {
              attributes.title = l.title;
            }
            if (l.action == "copy") {
              attributes.onClick = this.copyToClipboard;
            } else if (l.action == "edit") {
              attributes.onClick = this.onEditRecord;
            } else if (l.action == "download") {
              attributes.onClick = this.downloadFile;
            } else if (l.action == "abord") {
              attributes.onClick = this.abordJob;
            }
            return h("a", attributes, ...arr);
          })) : ""
      );
    }
  }
}
export class ScrollTableRow extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.row = props.row;
    this.previousRow = props.previousRow;
    this.onDoSave = this.onDoSave.bind(this);
    this.onDoApplyAll = this.onDoApplyAll.bind(this);
  }
  onDoSave(){
    let {model} = this.props;
    model.doSave(this.row.id);
  }
  onDoApplyAll(){
    let {model} = this.props;
    model.doApplyAll(this.row.id);
  }
  render() {
    let {model, row, rowHeight, previousRow} = this.props;
    let previousCell = null;
    let cells = row.cells.map((cell, c) => {
      if (previousRow != null && c < previousRow.cells.length) {
        previousCell = previousRow.cells[c];
      }
      return h(ScrollTableCell, {key: "cell" + cell.id, row, model, cell, rowHeight, colWidth: model.colWidths[cell.idx], previousCell});
    });
    if (row.cells.some(c => c.isEditing)) {
      cells.push(h("td", {key: "editcell" + row.id}, h("button", {
        name: "saveBtn",
        key: "saveBtn" + row.id,
        title: "Save the values of this record",
        className: "button button-brand",
        onClick: this.onDoSave
      }, "Save"), h("button", {
        name: "applyAllBtn",
        key: "applyAllBtn" + row.id,
        title: "Apply this value to all records",
        className: "button button-brand",
        onClick: this.onDoApplyAll
      }, "Apply all"), row.error ? row.error : ""));
    }
    return h("tr", {}, cells);
  }
}
export class ScrollTable extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.onScroll = this.onScroll.bind(this);
  }

  onScroll(){
    let {model} = this.props;
    model.viewportChange();
  }
  componentDidMount() {
    let {model} = this.props;
    let scroller = this.refs.scroller;
    let scrolled = this.refs.scrolled;
    model.setScrollerElement(scroller, scrolled);
  }
  componentDidUpdate() {
    let {model} = this.props;
    //model.recalculate();
  }
  render() {
    let {model} = this.props;
    let previousRow = null;
    return h("div", {className: "result-table", onScroll: this.onScroll, ref: "scroller"},
      h("div", {className: "scrolltable-scrolled", ref: "scrolled", style: {height: model.scrolledHeight + "px", width: model.scrolledWidth + "px"}},
        h("table", {style: {top: model.firstRowTop + "px", left: model.firstColLeft + "px"}},
          h("thead", {},
            h("tr", {},
              model.header.map((cell) => h("td", {key: "head" + cell.id, className: "scrolltable-cell header", style: {minWidth: model.colWidths[cell.idx] + "px", height: model.headerHeight + "px"}}, cell.name))
            )
          ),
          h("tbody", {},
            model.rows.map((row) => {
              let result = h(ScrollTableRow, {key: "row" + row.id, model, row, rowHeight: model.rowHeights[row.idx], rowId: row.id, previousRow});
              if (model.rows.length == 2) {
                previousRow = row;
              }
              return result;
            })
          )
        ),
        model.editedRows.size ? h("div", {className: "footer-edit-bar"}, h("span", {className: "edit-bar"},
          h("button", {
            name: "saveBtn",
            title: "Save all editd records",
            className: "button button-brand",
            disabled: model.spinnerCount != 0 ? true : false,
            onClick: this.onDoSaveAll
          }, "Save all")
        )) : null
      )
    );
  }
}

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
  handleMouseUp(e) {
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
      model.setSuggestionPosition(rect.top + rect.height, rect.left);
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
