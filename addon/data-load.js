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

// Convert a 2D table array to HTML table string
// @param table: Array of rows, where first row is header: [[header1, header2, ...], [row1col1, row1col2, ...], ...]
// @param maxRows: Maximum number of rows (excluding header) to include in HTML. Returns null if exceeded.
export function tableToHtml(table) {
  if (!table || table.length === 0) {
    return null;
  }
  const header = table[0];
  const rows = table.slice(1);

  // Escape HTML entities
  function escapeHtml(text) {
    if (text == null) {
      return "";
    }
    const str = String(text);
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  let html = "<table><thead><tr>";
  for (let cell of header) {
    html += "<th>" + escapeHtml(cell) + "</th>";
  }
  html += "</tr></thead><tbody>";

  for (let row of rows) {
    html += "<tr>";
    for (let cell of row) {
      html += "<td>" + escapeHtml(cell) + "</td>";
    }
    html += "</tr>";
  }

  html += "</tbody></table>";
  return html;
}

// Convert a RecordTable instance to a simple 2D array of strings
// @param recordTable: RecordTable instance with getVisibleTable() and cellToString() methods
export function recordTableToArray(recordTable) {
  if (!recordTable || !recordTable.getVisibleTable) {
    return null;
  }
  const visibleTable = recordTable.getVisibleTable();
  if (!visibleTable || visibleTable.length === 0) {
    return null;
  }
  return visibleTable.map(row => row.map(cell => recordTable.cellToString ? recordTable.cellToString(cell) : String(cell == null ? "" : cell)));
}

// Copy text to the clipboard, without rendering it, since rendering is slow.
export async function copyToClipboard(value, html = null) {
  if (parent && parent.isUnitTest) { // for unit tests
    parent.testClipboardValue = value;
    return;
  }
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const clipboardItems = {};
      clipboardItems["text/plain"] = new Blob([value], {type: "text/plain"});
      if (html) {
        clipboardItems["text/html"] = new Blob([html], {type: "text/html"});
      }
      await navigator.clipboard.write([
        new ClipboardItem(clipboardItems)
      ]);
      return;
    } catch (e) {
      console.warn("Clipboard API failed, fallback to execCommand", e);
    }
  }

  // Use execCommand to trigger an oncopy event and use an event handler to copy the text to the clipboard.
  // The oncopy event only works on editable elements, e.g. an input field.
  let temp = document.createElement("input");
  // The oncopy event only works if there is something selected in the editable element.
  temp.value = "temp";
  temp.addEventListener("copy", e => {
    e.clipboardData.setData("text/plain", value);
    if (html) {
      e.clipboardData.setData("text/html", html);
    }
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

