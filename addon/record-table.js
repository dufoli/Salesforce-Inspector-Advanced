/* global React */
import {sfConn, apiVersion} from "./inspector.js";
let h = React.createElement;

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
    this.ColumnSortIndex = new Map();
    this.sortCfg = {};
    this.skipTechnicalColumns = localStorage.getItem("skipTechnicalColumns") !== "false";
    this.dateFormat = localStorage.getItem("dateFormat");
    this.datetimeFormat = localStorage.getItem("datetimeFormat");
    this.decimalFormat = localStorage.getItem("decimalFormat");
    this.convertToLocalTime = localStorage.getItem("convertToLocalTime") != "false";
    if (this.decimalFormat != "." && this.decimalFormat != ",") {
      this.decimalFormat = ".";
      localStorage.setItem("decimalFormat", this.decimalFormat);
    }
    this.filter = null;
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
    if (!this.filter) {
      return true;
    }
    let filterValue;
    //TODO migrate legacy search on all components
    if (typeof this.filter === "string" || this.filter instanceof String) {
      filterValue = this.filter;
    } else {
      filterValue = this.filter.value;
    }
    if (!filterValue && this.filter.operator && this.filter.operator != "!=" && this.filter.operator != "=") {
      return true;
    }
    if (this.filter.fieldIndex == null || row[this.filter.fieldIndex] == null){
      return row.some(cell => this.cellToString(cell).toLowerCase().includes(filterValue.toLowerCase()));
    }
    let cell = row[this.filter.fieldIndex];
    switch (this.filter.operator) {
      case "=": //equal
        return this.cellToString(cell).toLowerCase() == this.filter.value.toLowerCase();
      case "!=": //not equal
        return this.cellToString(cell).toLowerCase() != this.filter.value.toLowerCase();
      case "startsWith":
        return this.cellToString(cell).toLowerCase().startsWith(this.filter.value.toLowerCase());
      case "endsWith":
        return this.cellToString(cell).toLowerCase().endsWith(this.filter.value.toLowerCase());
      // case ">":
      //TODO cell is already converted to text so we need move conversion on redering
      //   if (this.filter.fieldType == "date" || this.filter.fieldType == "datetime") {
      //     return cell > new Date(this.filter.value);
      //   } else if (this.filter.fieldType == "decimal" || this.filter.fieldType == "currency") {
      //     return cell > parseFloat(this.filter.value);
      //   }
      //   return true;//default display
      // case "<":
      //   if (this.filter.fieldType == "date" || this.filter.fieldType == "datetime") {
      //     return cell < new Date(this.filter.value);
      //   } else if (this.filter.fieldType == "decimal" || this.filter.fieldType == "currency") {
      //     return cell < parseFloat(this.filter.value);
      //   }
      //   return true;//default display
      default: //like and bad operator
        return this.cellToString(cell).toLowerCase().includes(this.filter.value.toLowerCase());
    }
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
      //TODO move conversion to rendering (dataChange)
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
  sortColumn(sortCfg) {
    //TODO remove header from table and user header instead.
    // in order to avoid that header is sorted with data
    this.sortCfg = sortCfg;
    //this.columnType.get(field) == "decimal" || this.columnType.get(field) == "currency"
    let colType = this.columnType.get(this.header[sortCfg.column]);
    let modeText = true;
    if (colType == "decimal" || colType == "currency") {
      modeText = false;
    }

    if (sortCfg) {
      this.table = this.table.slice(1);
      this.table.sort((rowA, rowB) => {
        let valueA = rowA[sortCfg.column];
        let valueB = rowB[sortCfg.column];
        if (valueA == null && valueB == null) {
          return 0;
        } else if (valueA == null) {
          return sortCfg.ascending ? -1 : 1;
        } else if (valueB == null) {
          return sortCfg.ascending ? 1 : -1;
        }
        if (sortCfg.ascending) {
          if (modeText) {
            return valueA.toString().localeCompare(valueB.toString());
          } else {
            return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
          }
        } else if (modeText) { //descending
          return valueB.toString().localeCompare(valueA.toString());
        } else { //descending decimal
          return valueB < valueA ? -1 : valueB > valueA ? 1 : 0;
        }
      });
      this.table.splice(0, 0, this.header);
      this.updateVisibility(this.filter);
    }
  }
  async addToTable(expRecords, sortCfg) {
    this.records = this.records.concat(expRecords);
    if (this.table.length == 0 && expRecords.length > 0) {
      this.table.push(this.header);
      this.rowVisibilities.push(true);
    }
    for (let record of expRecords) {
      let row = new Array(this.header.length);
      row[0] = record;

      if (sortCfg) {
        let sortValue = record[sortCfg.column];
        let lastIndex = this.ColumnSortIndex.get(sortValue);
        let isAscending = sortCfg.ascending !== false; // Default to ascending if not specified

        if (lastIndex == null) {
          lastIndex = isAscending ? 0 : this.table.length - 1;
          for (let [key, index] of this.ColumnSortIndex) {
            if (
              (isAscending && key < sortValue && index > lastIndex)
              || (!isAscending && key > sortValue && index < lastIndex)
            ) {
              lastIndex = index;
            }
          }
        }

        // Insert the row at the correct position
        this.table.splice(lastIndex + 1, 0, row);
        this.rowVisibilities.splice(lastIndex + 1, 0, this.isVisible(row));
        this.ColumnSortIndex.set(sortValue, lastIndex + 1);

        // Update indices for subsequent values in ColumnSortIndex
        for (let [key, index] of this.ColumnSortIndex) {
          if (index > lastIndex + 1) {
            this.ColumnSortIndex.set(key, index + 1);
          }
        }
      } else {
        // Add the row at the end if no sorting is specified
        this.table.push(row);
        this.rowVisibilities.push(this.isVisible(row));
      }

      if (this.vm) {
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
    if (fltr != null && fltr.field != null && fltr.field != "") {
      fltr.fieldIndex = this.columnIdx.get(fltr.field);
      fltr.fieldType = this.columnType.get(fltr.field);
    }
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
        let newHeight = Math.floor(Math.max(oldHeight, rowRect.height));
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
        let colRect;
        if (td.firstElementChild != null) {
          colRect = td.firstElementChild.getBoundingClientRect();
        } else {
          colRect = td.getBoundingClientRect();
        }
        let oldWidth = this.colWidths[c];
        let newWidth = Math.floor(Math.max(oldWidth, colRect.width));
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
        //TODO reset height and width of cell
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
    //TODO reset height and width of cell
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
    //TODO reset height and width of cell
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
    this.offsetHeight = this.scroller.offsetHeight;
    this.offsetWidth = this.scroller.offsetWidth;
    this.scrollTop = this.scroller.scrollTop;
    this.scrollLeft = this.scroller.scrollLeft;
    this.bufferHeight = Math.min(this.bufferHeight, this.scroller.offsetHeight);
    this.bufferWidth = Math.min(this.bufferWidth, this.scroller.offsetWidth);

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
        //this.recalculate();
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
    this.didUpdate(() => this.recalculate());
    //this.recalculate();
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
    this.bufferHeight = Math.min(this.bufferHeight, this.scroller.offsetHeight);
    this.bufferWidth = Math.min(this.bufferWidth, this.scroller.offsetWidth);
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
    this.abordJob = this.abordJob.bind(this);
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
    e.preventDefault();
    let script = "System.abortJob('" + this.cell.recordId + "');";
    sfConn.rest("/services/data/v" + apiVersion + "/tooling/executeAnonymous/?anonymousBody=" + encodeURIComponent(script), {})
      .catch(error => { console.error(error); });
  }
  downloadFile(e){
    e.preventDefault();
    sfConn.rest(this.cell.recordId, {responseType: "text/csv"}).then(data => {
      let downloadLink = document.createElement("a");
      downloadLink.download = this.cell.recordId.split("/")[6];
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
        cell.linkable ? h("a", {href: "about:blank", title: "Show all data", onClick: this.onClick, onDoubleClick: this.onTryEdit}, cellLabel) : h("span", {style: {height: "100%"}, onDoubleClick: this.onTryEdit}, cellLabel),
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
class ScrollTableRow extends React.Component {
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
    this.onSort = this.onSort.bind(this);
  }

  onScroll(){
    let {model} = this.props;
    model.viewportChange();
  }
  onSort(colIdx){
    let {model} = this.props;
    model.data.sortColumn({column: colIdx, ascending: (model.data.sortCfg.column == colIdx) ? !model.data.sortCfg.ascending : true});
    model.dataChange(model.data);
    model.didUpdate();
  }
  componentDidMount() {
    let {model} = this.props;
    let scroller = this.refs.scroller;
    let scrolled = this.refs.scrolled;
    model.setScrollerElement(scroller, scrolled);
  }
  componentDidUpdate() {
    let {model} = this.props;
    model.recalculate();
  }
  render() {
    let {model} = this.props;
    let previousRow = null;
    let showSort = model?.data?.sortColumn && model.rowCount < 100000;
    return h("div", {className: "result-table", onScroll: this.onScroll, ref: "scroller"},
      h("div", {className: "scrolltable-scrolled", ref: "scrolled", style: {height: model.scrolledHeight + "px", width: model.scrolledWidth + "px"}},
        h("table", {style: {top: model.firstRowTop + "px", left: model.firstColLeft + "px"}},
          h("thead", {},
            h("tr", {},
              model.header.map((cell) => h("td", {key: "head" + cell.id, className: "scrolltable-cell header", style: {minWidth: model.colWidths[cell.idx] + "px", height: model.headerHeight + "px"}}, cell.name, (showSort && cell.idx != 0) ? h("span", {title: "Sort", className: "sort-indicator" + (model.data.sortCfg.column == cell.idx ? " active" : ""), onClick: () => this.onSort(cell.idx)}, (model.data.sortCfg.column != cell.idx ? "▼▲" : (model.data.sortCfg.ascending ? "▼" : "▲"))) : null))
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
        // model.editedRows.size ? h("div", {className: "footer-edit-bar"}, h("span", {className: "edit-bar"},
        //   h("button", {
        //     name: "saveBtn",
        //     title: "Save all edited records",
        //     className: "button button-brand",
        //     disabled: model.spinnerCount != 0 ? true : false,
        //     onClick: this.onDoSaveAll
        //   }, "Save all")
        // )) : null
      )
    );
  }
}
