/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */

//documentation to implement profiler
//https://www.developerforce.com/guides/fr/apex_fr/Content/code_setting_debug_log_levels.htm


class Model {

  constructor({sfHost}) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.userInfo = "...";
    // URL parameters
    this.recordId = null;
    this.lineCount = 1;
    this.lineNumbers = Array.from(Array(this.lineCount).keys());

    //full log text data
    this.logData = "";
    this.logSearch = "";
    this.logFilter = "";
    this.logInput = null;
    this.searchInput = null;
    this.spinnerCount = 0;
    this.searchIndex = -1;
    this.winInnerHeight = 0;
    this.forceScroll = false;
    this.nodes = null;
    this.rootNode = null;
    this.resizeColumnIndex = null;
    this.resizeColumnpageX = null;
    this.resizeColumnWidth = null;
    this.resizeNextColumnWidth = null;
    this.EnrichLog = [];
    this.timeout = null;

    this.column = [
      {
        id: 0,
        title: "Item",
        field: null,
        width: 500
      },
      {
        id: 1,
        title: "Heap",
        field: "heapTotal",
        width: 70
      },
      {
        id: 2,
        title: "Duration(ms)",
        field: "duration",
        width: 70
      },
      {
        id: 3,
        title: "DML",
        field: "dmlTotal",
        width: 70
      },
      {
        id: 4,
        title: "SOQL",
        field: "soqlTotal",
        width: 70
      },
      {
        id: 5,
        title: "SOSL",
        field: "soslTotal",
        width: 70
      },
      {
        id: 6,
        title: "Query rows",
        field: "rowTotal",
        width: 70
      },
      {
        id: 7,
        title: "DML rows",
        field: "dmlRowTotal",
        width: 70
      },
      {
        id: 8,
        title: "Callouts",
        field: "calloutTotal",
        width: 70
      },
      {
        id: 9,
        title: "Futur calls",
        field: "futurTotal",
        width: 70
      },
      {
        id: 10,
        title: "jobs enqueue",
        field: "queueTotal",
        width: 70
      }
      /*Number of Publish Immediate DML: 0 out of 150
      Number of Email Invocations: 0 out of 10
      Number of Mobile Apex push calls: 0 out of 10*/
    ];
    this.filterToField = {"SOQL": "soqlTotal", "SOSL": "soslTotal", "DML": "dmlTotal", "Callout": "calloutTotal"};
    if (localStorage.getItem(sfHost + "_isSandbox") != "true") {
      //change background color for production
      document.body.classList.add("prod");
    }
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
    }));
    this.hideNodeByFilter = this.hideNodeByFilter.bind(this);
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
  recalculculSearch() {
    let searchIdx = 0;
    let lastSearchIdx = 0;
    this.lineNumbers = Array.from(Array(this.lineCount).keys());
    if (this.logSearch) {
      this.EnrichLog = [];
      searchIdx = this.logData.indexOf(this.logSearch);
      while (searchIdx >= 0) {
        if (lastSearchIdx < this.logData.length && lastSearchIdx != searchIdx) {
          this.EnrichLog.push({value: this.logData.substring(lastSearchIdx, searchIdx)});
        }
        //handle case sensitive or not later but use substring instead model.logSearch to be sure to respect the case.
        this.EnrichLog.push({value: this.logData.substring(searchIdx, searchIdx + this.logSearch.length), cls: "highlight"});
        lastSearchIdx = searchIdx + this.logSearch.length;
        searchIdx = this.logData.indexOf(this.logSearch, searchIdx + this.logSearch.length);
      }
      if (lastSearchIdx < this.logData.length && lastSearchIdx != searchIdx) {
        this.EnrichLog.push({value: this.logData.substring(lastSearchIdx)});
      }
    } else {
      this.EnrichLog = [{value: this.logData}];
    }
  }
  recalculculFilter() {
    if (this.logFilter) {
      this.EnrichLog = [];
      this.lineNumbers = [];
      let lineNumber = 0;
      let lines = this.logData.split("\n");
      for (let line of lines) {
        let searchIdx = line.indexOf(this.logFilter);
        if (searchIdx >= 0) {
          this.EnrichLog.push({value: line + "\n"});
          this.lineNumbers.push(lineNumber);
        }
        lineNumber++;
      }
    } else {
      this.EnrichLog = [{value: this.logData}];
      this.lineNumbers = Array.from(Array(this.lineCount).keys());
    }
  }
  setLogSearch(value) {
    this.logSearch = value;
    if (this.logData == null) {
      return;
    }
    let self = this;
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      self.recalculculSearch();
      this.hideNodesBySearch(value);
      this.didUpdate();
    }, 500);

    if (this.logSearch == null || this.logSearch.length == 0) {
      this.searchIndex = -1;
      return;
    }
    this.scrollLog(0);
  }
  setLogFilter(value) {
    this.logFilter = value;
    if (this.logData == null) {
      return;
    }
    let self = this;
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      self.recalculculFilter();
      this.hideNodesByFilter(value);
      this.didUpdate();
    }, 500);

    if (this.logFilter == null || this.logFilter.length == 0) {
      this.searchIndex = -1;
      return;
    }
    this.scrollLog(0);
  }
  setLogInput(logInput) {
    this.logInput = logInput;
  }
  setSearchInput(searchInput) {
    this.searchInput = searchInput;
  }
  onKeypress(key, shiftKey){
    switch (key) {
      case "ArrowRight":
      case "ArrowDown":
        this.scrollLog(this.searchIndex);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        this.scrollLogBackward();
        break;
      case "Enter":
        if (shiftKey) {
          this.scrollLogBackward();
        } else {
          this.scrollLog(this.searchIndex);
        }
        break;
    }
  }
  scrollLogBackward() {
    let vm = this; // eslint-disable-line consistent-this
    let rawLog = vm.logData;
    let selStart = vm.searchIndex != -1 ? vm.searchIndex : 0;
    let searchIndex = rawLog.substring(0, selStart).lastIndexOf(vm.logSearch);
    if (searchIndex != -1){
      vm.searchIndex = searchIndex;
      vm.forceScroll = true;
    } else {
      //restart from beginning
      searchIndex = rawLog.lastIndexOf(vm.logSearch);
      if (searchIndex != -1){
        vm.searchIndex = searchIndex;
        vm.forceScroll = true;
      }
    }
    this.didUpdate();
  }
  scrollLog(searchIdx) {
    let vm = this; // eslint-disable-line consistent-this
    let rawLog = vm.logData;
    //let selStart = vm.logInput.selectionStart;
    let selEnd = searchIdx != 1 ? searchIdx + 1 : 0;
    let searchIndex = rawLog.indexOf(vm.logSearch, selEnd);
    if (searchIndex != -1){
      vm.searchIndex = searchIndex;
      vm.forceScroll = true;
    } else {
      //restart from beginning
      searchIndex = rawLog.indexOf(vm.logSearch);
      if (searchIndex != -1){
        vm.searchIndex = searchIndex;
        vm.forceScroll = true;
      }
    }
    this.didUpdate();
  }
  startLoading() {
    if (this.recordId == null){
      return;
    }
    this.spinFor(
      sfConn.rest("/services/data/v" + apiVersion + "/tooling/sobjects/ApexLog/" + this.recordId + "/Body?_dc=1705483656182", {responseType: "text"}).then(data => {
        this.logData = data;
        this.EnrichLog = [{value: data}];

        //for test only
        /*+ Array(5000).fill(null).map(() => {
          let v = Math.floor(Math.random() * 30);
          if (v == 4) {
            return "\n";
          }
          return v.toString();
        }).join("");*/
        this.parseLog(data);
        //this.refs.editor.dataChange();
        this.didUpdate();
      }
      )
    );
  }
  parseLog(data) {
    let lines = data.split("\n");
    this.lineCount = lines.length;
    this.lineNumbers = Array.from(Array(this.lineCount).keys());
    let node = {index: 0, title: "Log", child: [], heap: 0};
    this.parseLine(lines, node);
    this.aggregate(node);
    this.rootNode = node;
    let result = [];
    [this.nodes, this.maxLvlNodes] = this.flatternNode(node.child, result, 1, 1);
  }
  hideNodesByFilter(filter) {
    if (!this.rootNode) {
      return;
    }
    this.rootNode.hidden = this.hideNodeByFilter(filter, this.rootNode);
    this.didUpdate();
  }
  hideNodeByFilter(filter, node) {
    node.hidden = true;
    let field = "";
    if (filter in this.filterToField) {
      field = this.filterToField[filter];
    }
    if (!filter || !field || (field in node && node[field] > 0)) {
      node.hidden = false;
    }
    if (!node.child) {
      return node.hidden;
    }
    for (let i = 0; i < node.child.length; i++) {
      const c = node.child[i];
      if (!this.hideNodeByFilter(filter, c)) {
        node.hidden = false;
      }
    }
    return node.hidden;
  }
  hideNodesBySearch(searchTerm) {
    if (!this.rootNode) {
      return;
    }
    let searchRegEx = null;
    if (searchTerm) {
      searchRegEx = new RegExp(searchTerm, "i");
    }
    this.rootNode.hidden = this.hideNodeBySearch(searchRegEx, this.rootNode);
    this.didUpdate();
  }
  hideNodeBySearch(searchRegEx, node) {
    node.hidden = true;
    if (!searchRegEx || (node.title && node.title.match(searchRegEx))) {
      node.hidden = false;
    }
    if (!node.child) {
      return node.hidden;
    }
    for (let i = 0; i < node.child.length; i++) {
      const c = node.child[i];
      if (!this.hideNodeBySearch(searchRegEx, c)) {
        node.hidden = false;
      }
    }
    return node.hidden;
  }

  hideNode(node){
    node.hidden = true;
    if (!node.expanded){
      //do not hide if sub node is already collapse
      return;
    }
    for (let c = 0; c < node.child.length; c++){
      this.hideNode(node.child[c]);
    }
  }
  showNode(node){
    node.hidden = false;
    if (!node.expanded){
      //do not show if sub node is collapse
      return;
    }
    for (let c = 0; c < node.child.length; c++){
      this.showNode(node.child[c]);
    }
  }
  toggleExpand(i) {
    let n = this.nodes[i];
    if (n.expanded) { //collapse
      for (let c = 0; c < n.child.length; c++){
        this.hideNode(n.child[c]);
      }
    } else { //expand
      for (let c = 0; c < n.child.length; c++){
        this.showNode(n.child[c]);
      }
    }
    n.expanded = n.expanded ? false : true;
  }
  aggregate(node) {
    node.heapTotal = node.heap;
    //duration is done on each node so no aggregate
    node.rowTotal = node.row || 0;
    node.dmlRowTotal = node.dmlRow || 0;
    node.dmlTotal = node.dml || 0;
    node.soqlTotal = node.soql || 0;
    node.soslTotal = node.sosl || 0;
    node.calloutTotal = node.callout || 0;
    //todo futur, queue
    for (let i = 0; i < node.child.length; i++) {
      let c = node.child[i];
      this.aggregate(c);
      node.heapTotal += c.heapTotal;
      node.rowTotal += c.rowTotal;
      node.dmlRowTotal += c.dmlRowTotal;
      node.dmlTotal += c.dmlTotal;
      node.soqlTotal += c.soqlTotal;
      node.soslTotal += c.soslTotal;
      node.calloutTotal += c.calloutTotal;
    }
  }
  flatternNode(child, result, lvl, maxLvlNodes) {
    if (lvl > maxLvlNodes) {
      maxLvlNodes = lvl;
    }
    for (let i = 0; i < child.length; i++) {
      let c = child[i];
      c.key = "node" + result.length;
      c.level = lvl;
      c.position = i + 1;
      c.tabIndex = -1;
      c.index = result.length;
      result.push(c);
      if (c.child && c.child.length > 0) {
        maxLvlNodes = this.flatternNode(c.child, result, lvl + 1, maxLvlNodes)[1];
      }
    }
    return [result, maxLvlNodes];
  }

  parseLine(lines, node){
    let expected = null;
    let i = node.index + 1;
    let self = this;
    function produceNode(l, dt, timestampNanos, child) {
      child.index = i;
      child.title = l.length > 4 ? l[4] : (l.length > 3 ? l[3] : (child.title ? child.title : l[1]));
      child.child = [];
      child.start = dt;
      child.startNano = timestampNanos;
      child.heap = 0;
      child.expanded = true;
      child.hidden = false;
      i = self.parseLine(lines, child);
      node.child.push(child);
    }
    for (i = node.index + 1; i < lines.length; i++) {
      let line = lines[i];
      let l = line.split("|");
      if (l.length <= 1) {
        continue;
      }
      let datetimeTimestamp = l[0].split(/[:. ]/);
      let dt = null;
      let timestampNanos = null;
      if (datetimeTimestamp.length == 5){
        let rawHour = Number(datetimeTimestamp[0]);
        let rawMin = Number(datetimeTimestamp[1]);
        let rawSec = Number(datetimeTimestamp[2]);
        let rawMil = Number(datetimeTimestamp[3]);
        let rawNano = Number(datetimeTimestamp[4].substring(1, datetimeTimestamp[4].length - 1));
        if (!isNaN(rawHour) && !isNaN(rawMin) && !isNaN(rawSec) && !isNaN(rawMil)) {
          dt = new Date();
          dt.setHours(rawHour);
          dt.setMinutes(rawMin);
          dt.setSeconds(rawSec);
          dt.setMilliseconds(rawMil * 100);
        }
        if (!isNaN(rawNano)) {
          timestampNanos = rawNano;
        }
      }
      //TODO l[2] =line number
      //l[3] =log level
      switch (l[1]) {
        //EXECUTION_STARTED EXECUTION_FINISHED
        case "CODE_UNIT_STARTED": {
          expected = "CODE_UNIT_FINISHED";
          produceNode(l, dt, timestampNanos, {title: "code unit"});
          break;
        } case "CODE_UNIT_FINISHED": {
          if (l[1] != expected) {
            console.log("Expected " + expected + " but got " + l[1]);
          }
          node.end = dt;
          node.endNano = timestampNanos;
          if (node.startNano && timestampNanos) {
            node.duration = (timestampNanos - node.startNano) / 1000000.0;
          } else if (node.start && dt) {
            node.duration = (dt.getTime() - node.start.getTime());
          }
          return i;
        } case "HEAP_ALLOCATE": {
          if (l.length > 3 && l[3].startsWith("Bytes:")) {
            let heap = Number(l[3].substring(6));
            if (!isNaN(heap)) {
              node.heap += heap;
            }
          }
          break;
        } case "HEAP_DEALLOCATE":
        case "BULK_HEAP_ALLOCATE":{
          //TODO
          break;
        }
        case "SYSTEM_METHOD_ENTRY" : {
          expected = "SYSTEM_METHOD_EXIT";
          produceNode(l, dt, timestampNanos, {icon: "apex"});
          break;
        }
        case "METHOD_ENTRY" : {
          expected = "METHOD_EXIT";
          produceNode(l, dt, timestampNanos, {icon: "apex"});
          break;
        }
        case "SYSTEM_CONSTRUCTOR_ENTRY" : {
          expected = "SYSTEM_CONSTRUCTOR_EXIT";
          produceNode(l, dt, timestampNanos, {icon: "apex"});
          break;
        }
        case "FLOW_START_INTERVIEW_BEGIN" : {
          expected = "FLOW_INTERVIEW_FINISHED"; //"FLOW_START_INTERVIEW_END"; to get error
          produceNode(l, dt, timestampNanos, {icon: "flow"});
          break;
        }
        case "VALIDATION_RULE":{
          expected = "VALIDATION_";
          produceNode(l, dt, timestampNanos, {icon: "approval"});
          break;
        }
        case "SOQL_EXECUTE_BEGIN":{
          expected = "SOQL_EXECUTE_END";
          produceNode(l, dt, timestampNanos, {icon: "table", soql: 1});
          break;
        }
        case "SOSL_EXECUTE_BEGIN":{
          expected = "SOSL_EXECUTE_END";
          produceNode(l, dt, timestampNanos, {icon: "search", sosl: 1});
          break;
        }
        case "CALLOUT_REQUEST": {
          expected = "CALLOUT_RESPONSE";
          produceNode(l, dt, timestampNanos, {icon: "broadcast", callout: 1});
          break;
        }//TODO "futur", "queue",
        case "FLOW_ELEMENT_BEGIN": {
          expected = "FLOW_ELEMENT_";
          produceNode(l, dt, timestampNanos, {icon: "flow"});
          break;
        }
        case "DML_BEGIN": {
          //DML_BEGIN|[71]|Op:Update|Type:Account|Rows:1
          expected = "DML_END";
          let child = {icon: "database", title: "DML", dml: 1};
          if (l.length > 4){
            let dmlRow = Number(l[5].substring());
            if (!isNaN(dmlRow)){
              child.dmlRow = dmlRow;
            }
          }
          produceNode(l, dt, timestampNanos, child);
          break;
        }
        case "SYSTEM_METHOD_EXIT":
        case "METHOD_EXIT":
        case "SYSTEM_CONSTRUCTOR_EXIT":
        case "DML_END":
        case "CALLOUT_RESPONSE":
        case "FLOW_ELEMENT_DEFERRED":
        case "FLOW_ELEMENT_END":
        case "FLOW_ELEMENT_ERROR":
        case "FLOW_INTERVIEW_FINISHED": {
          if (!l[1].startsWith(expected)) {
            console.log("Expected " + expected + " but got " + l[1]);
          }
          node.end = dt;
          node.endNano = timestampNanos;
          if (node.startNano && timestampNanos) {
            node.duration = (timestampNanos - node.startNano) / 1000000.0;
          } else if (node.start && dt) {
            node.duration = (dt.getTime() - node.start.getTime());
          }
          return i;
        } case "SOSL_EXECUTE_END":
        case "SOQL_EXECUTE_END": {
          if (l[1] != expected) {
            console.log("Expected " + expected + " but got " + l[1]);
          }
          node.end = dt;
          node.endNano = timestampNanos;
          if (node.startNano && timestampNanos) {
            node.duration = (timestampNanos - node.startNano) / 1000000.0;
          } else if (node.start && dt) {
            node.duration = (dt.getTime() - node.start.getTime());
          }
          //Rows:1
          let row = Number(l[3].substring(5));
          if (!isNaN(row)){
            node.row = row;
          }
          return i;
        } case "VALIDATION_ERROR":
        case "VALIDATION_FAIL":
        case "VALIDATION_PASS": {
          if (!l[1].startsWith(expected)) {
            console.log("Expected " + expected + " but got " + l[1]);
          }
          node.end = dt;
          node.endNano = timestampNanos;
          if (node.startNano && timestampNanos) {
            node.duration = (timestampNanos - node.startNano) / 1000000.0;
          } else if (node.start && dt) {
            node.duration = (dt.getTime() - node.start.getTime());
          }
          node.status = l[1];
          return i;
        }
        case "SOQL_EXECUTE_EXPLAIN": {
          //Index on User : [Id], cardinality: 1, sobjectCardinality: 575, relativeCost 0.006
          if (l.length > 3) {
            l[3].split(",").map((p) => {
              let pair = p.trim().split(/: /).filter(el => el);
              if (pair.length > 2) {
                let val = pair.pop();
                pair = [pair.join(""), val];
              }
              node[pair[0]] = pair[1];
            });
          }
          break;
        } case "LIMIT_USAGE_FOR_NS": {
          //for human read only
          /*
          LIMIT_USAGE_FOR_NS|(default)|
            Number of SOQL queries: 0 out of 100
            Number of query rows: 0 out of 50000
            Number of SOSL queries: 0 out of 20
            Number of DML statements: 0 out of 150
            Number of Publish Immediate DML: 0 out of 150
            Number of DML rows: 0 out of 10000
            Maximum CPU time: 0 out of 10000
            Maximum heap size: 0 out of 6000000
            Number of callouts: 0 out of 100
            Number of Email Invocations: 0 out of 10
            Number of future calls: 0 out of 50
            Number of queueable jobs added to the queue: 0 out of 50
            Number of Mobile Apex push calls: 0 out of 10
          */
          break;
        }
        case "NAMED_CREDENTIAL_REQUEST":
        case "NAMED_CREDENTIAL_RESPONSE":
        case "NAMED_CREDENTIAL_RESPONSE_DETAIL":
        case "CUMULATIVE_PROFILING":
        case "CUMULATIVE_PROFILING_BEGIN":
        case "CUMULATIVE_PROFILING_END":
        case "EMAIL_QUEUE":
        case "ENTERING_MANAGED_PKG":
        case "EVENT_SERVICE_PUB_BEGIN":
        case "FLOW_ELEMENT_FAULT": {
          //TODO
          break;
        }
        case "CUMULATIVE_LIMIT_USAGE":
        case "CUMULATIVE_LIMIT_USAGE_END":
        case "FLOW_CREATE_INTERVIEW_END":
        case "FLOW_START_INTERVIEW_END":
        case "FLOW_START_INTERVIEWS_BEGIN":
        case "FLOW_START_INTERVIEWS_END":
        case "VARIABLE_SCOPE_BEGIN":
        case "VARIABLE_ASSIGNMENT":
        case "USER_DEBUG":
        case "SYSTEM_MODE_ENTER":
        case "SYSTEM_MODE_EXIT":
        case "STATEMENT_EXECUTE":
        case "VALIDATION_FORMULA":
        case "EVENT_SERVICE_PUB_DETAIL":
        case "EVENT_SERVICE_PUB_END":
        case "EVENT_SERVICE_SUB_BEGIN":
        case "EVENT_SERVICE_SUB_DETAIL":
        case "EVENT_SERVICE_SUB_END":
        case "EXCEPTION_THROWN":
        case "EXECUTION_FINISHED":
        case "EXECUTION_STARTED":
        case "FATAL_ERROR":
        case "FLOW_ACTIONCALL_DETAIL":
        case "FLOW_ASSIGNMENT_DETAIL":
        case "FLOW_BULK_ELEMENT_BEGIN":
        case "FLOW_BULK_ELEMENT_DETAIL":
        case "FLOW_BULK_ELEMENT_END":
        case "FLOW_BULK_ELEMENT_LIMIT_USAGE":
        case "FLOW_BULK_ELEMENT_NOT_SUPPORTED":
        case "FLOW_CREATE_INTERVIEW_ERROR":
        case "FLOW_ELEMENT_LIMIT_USAGE":
        case "FLOW_INTERVIEW_FINISHED_LIMIT_USAGE":
        case "FLOW_INTERVIEW_PAUSED":
        case "FLOW_INTERVIEW_RESUMED":
        case "FLOW_LOOP_DETAIL":
        case "FLOW_RULE_DETAIL":
        case "FLOW_START_INTERVIEW_LIMIT_USAGE":
        case "FLOW_START_INTERVIEWS_ERROR":
        case "FLOW_START_SCHEDULED_RECORDS":
        case "FLOW_SUBFLOW_DETAIL":
        case "FLOW_VALUE_ASSIGNMENT":
        case "FLOW_WAIT_EVENT_RESUMING_DETAIL":
        case "FLOW_WAIT_EVENT_WAITING_DETAIL":
        case "FLOW_WAIT_RESUMING_DETAIL":
        case "FLOW_WAIT_WAITING_DETAIL":
        case "IDEAS_QUERY_EXECUTE":
        case "NBA_NODE_BEGIN":
        case "NBA_NODE_DETAIL":
        case "NBA_NODE_END":
        case "NBA_NODE_ERROR":
        case "NBA_OFFER_INVALID":
        case "NBA_STRATEGY_BEGIN":
        case "NBA_STRATEGY_END":
        case "NBA_STRATEGY_ERROR":
        case "POP_TRACE_FLAGS":
        case "PUSH_NOTIFICATION_INVALID_APP":
        case "PUSH_NOTIFICATION_INVALID_CERTIFICATE":
        case "PUSH_NOTIFICATION_INVALID_NOTIFICATION":
        case "PUSH_NOTIFICATION_NO_DEVICES":
        case "PUSH_NOTIFICATION_NOT_ENABLED":
        case "PUSH_NOTIFICATION_SENT":
        case "PUSH_TRACE_FLAGS":
        case "QUERY_MORE_BEGIN":
        case "QUERY_MORE_END":
        case "QUERY_MORE_ITERATIONS":
        case "SAVEPOINT_ROLLBACK":
        case "SAVEPOINT_SET":
        case "SLA_END":
        case "SLA_EVAL_MILESTONE":
        case "SLA_NULL_START_DATE":
        case "SLA_PROCESS_CASE":
        case "STACK_FRAME_VARIABLE_LIST":
        case "STATIC_VARIABLE_LIST":
        case "TESTING_LIMITS":
        case "TOTAL_EMAIL_RECIPIENTS_QUEUED":
        case "USER_INFO":
        case "VARIABLE_SCOPE_END":
        case "VF_APEX_CALL_END":
        case "VF_APEX_CALL_START":
        case "VF_DESERIALIZE_VIEWSTATE_BEGIN":
        case "VF_DESERIALIZE_VIEWSTATE_END":
        case "VF_EVALUATE_FORMULA_BEGIN":
        case "VF_EVALUATE_FORMULA_END":
        case "VF_PAGE_MESSAGE":
        case "VF_SERIALIZE_VIEWSTATE_BEGIN":
        case "VF_SERIALIZE_VIEWSTATE_END":
        case "WF_ACTION":
        case "WF_ACTION_TASK":
        case "WF_ACTIONS_END":
        case "WF_APPROVAL":
        case "WF_APPROVAL_REMOVE":
        case "WF_APPROVAL_SUBMIT":
        case "WF_APPROVAL_SUBMITTER":
        case "WF_ASSIGN":
        case "WF_CRITERIA_BEGIN":
        case "WF_CRITERIA_END":
        case "WF_EMAIL_ALERT":
        case "WF_EMAIL_SENT":
        case "WF_ENQUEUE_ACTIONS":
        case "WF_ESCALATION_ACTION":
        case "WF_ESCALATION_RULE":
        case "WF_EVAL_ENTRY_CRITERIA":
        case "WF_FIELD_UPDATE":
        case "WF_FLOW_ACTION_BEGIN":
        case "WF_FLOW_ACTION_DETAILflow variables":
        case "WF_FLOW_ACTION_END":
        case "WF_FLOW_ACTION_ERROR":
        case "WF_FLOW_ACTION_ERROR_DETAIL":
        case "WF_FORMULA":
        case "WF_HARD_REJECT":
        case "WF_NEXT_APPROVER":
        case "WF_NO_PROCESS_FOUND":
        case "WF_OUTBOUND_MSG":
        case "WF_PROCESS_FOUND":
        case "WF_PROCESS_NODE":
        case "WF_REASSIGN_RECORD":
        case "WF_RESPONSE_NOTIFY":
        case "WF_RULE_ENTRY_ORDER":
        case "WF_RULE_EVAL_BEGIN":
        case "WF_RULE_EVAL_END":
        case "WF_RULE_EVAL_VALUE":
        case "WF_RULE_FILTER":
        case "WF_RULE_INVOCATION":
        case "WF_RULE_NOT_EVALUATED":
        case "WF_SOFT_REJECT":
        case "WF_SPOOL_ACTION_BEGIN":
        case "WF_TIME_TRIGGER":
        case "WF_TIME_TRIGGERS_BEGIN":
        case "XDS_DETAIL":
        case "XDS_RESPONSE":
        case "XDS_RESPONSE_DETAIL":
        case "XDS_RESPONSE_ERROR": {
          //SKIP
          break;
        }
        default:
          break;
      }

    }
    i = lines.length - 1;
    let line = lines[i];
    let l = line.split("|");
    while (l.length <= 1 && i >= 0) {
      i--;
      line = lines[i];
      l = line.split("|");
    }
    let datetimeTimestamp = l[0].split(/[:. ]/);
    let dt = null;
    let timestampNanos = null;
    if (datetimeTimestamp.length == 5){
      let rawHour = Number(datetimeTimestamp[0]);
      let rawMin = Number(datetimeTimestamp[1]);
      let rawSec = Number(datetimeTimestamp[2]);
      let rawMil = Number(datetimeTimestamp[3]);
      let rawNano = Number(datetimeTimestamp[4].substring(1, datetimeTimestamp[4].length - 1));
      if (!isNaN(rawHour) && !isNaN(rawMin) && !isNaN(rawSec) && !isNaN(rawMil)) {
        dt = new Date();
        dt.setHours(rawHour);
        dt.setMinutes(rawMin);
        dt.setSeconds(rawSec);
        dt.setMilliseconds(rawMil * 100);
      }
      if (!isNaN(rawNano)) {
        timestampNanos = rawNano;
      }
    }
    node.end = dt;
    node.endNano = timestampNanos;
    if (node.startNano && timestampNanos) {
      node.duration = (timestampNanos - node.startNano) / 1000000.0;
    } else if (node.start && dt) {
      node.duration = (dt.getTime() - node.start.getTime());
    }
    node.status = l[1];
    return lines.length;
  }
}

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      filterBy: "",
    };
    this.availableFilters = ["Debug", "SOQL", "SOSL", "DML", "Callout", "Exception"];

    this.onSelectFilterBy = this.onSelectFilterBy.bind(this);
    this.onLogSearchInput = this.onLogSearchInput.bind(this);
    this.onKeypress = this.onKeypress.bind(this);
    this.downloadFile = this.downloadFile.bind(this);
    this.listAllLogs = this.listAllLogs.bind(this);
  }
  componentDidMount() {
    let {model} = this.props;
    let search = this.refs.search;

    model.setSearchInput(search);
  }

  componentDidUpdate() {
  }

  componentWillUnmount() {
  }

  onLogSearchInput(e) {
    let {model} = this.props;
    model.setLogSearch(e.target.value);
    model.didUpdate();
  }

  onKeypress(e) {
    let {model} = this.props;
    model.onKeypress(e.key, e.shiftKey);
    model.didUpdate();
  }

  downloadFile() {
    let {model} = this.props;
    if (model.recordId == null){
      return;
    }
    let downloadLink = document.createElement("a");
    downloadLink.download = model.recordId + ".txt";
    let BOM = "\uFEFF";
    let bb = new Blob([BOM, model.logData], {type: "text/csv;charset=utf-8"});
    downloadLink.href = window.URL.createObjectURL(bb);
    downloadLink.click();
  }

  onSelectFilterBy(e) {
    let {model} = this.props;
    this.setState({filterBy: e.target.value});
    model.setLogFilter(e.target.value);
    model.didUpdate();
  }

  listAllLogs() {
    let args = new URLSearchParams();
    args.set("host", this.props.model.sfHost);
    args.set("query", "SELECT Id, Application, Status, Operation, StartTime, LogLength, LogUser.Name FROM ApexLog ORDER BY StartTime DESC");

    window.open("data-export.html?" + args, "_blank");
  }

  render() {
    let {model} = this.props;
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 5);
    return h("div", {},
      h("div", {id: "user-info"},
        h("a", {href: model.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {}, "Script Execute"),
        h("span", {}, " / " + model.userInfo),
        h("div", {className: "flex-right"},
          h("div", {id: "spinner", role: "status", className: "slds-spinner slds-spinner_small slds-spinner_inline", hidden: model.spinnerCount == 0},
            h("span", {className: "slds-assistive-text"}),
            h("div", {className: "slds-spinner__dot-a"}),
            h("div", {className: "slds-spinner__dot-b"}),
          ),
          h("a", {href: "options.html?" + hostArg, className: "top-btn", id: "options-btn", title: "Option", target: "_blank"},
            h("div", {className: "icon"})
          ),
        ),
      ),
      h("div", {className: "area"},
        h("div", {className: "area-header"},
        ),
        h("div", {className: "script-controls"},
          h("div", {className: "script-history-controls"},
            h("label", {htmlFor: "search-text", className: "slds-label"}, "Search"),
            h("input", {id: "search-text", name: "search-text", ref: "search", placeholder: "Search a word", onKeyPress: this.onKeypress, type: "search", value: model.logSearch, onInput: this.onLogSearchInput, className: "slds-input"})
          ),
          h("div", {className: "button-group"},
            h("select", {name: "log-filter", value: this.state.filterBy, onChange: this.onSelectFilterBy, className: "log-filter"},
              h("option", {value: ""}, "No filter"),
              this.availableFilters.map(q => h("option", {key: q.toUpperCase(), value: q.toUpperCase()}, q))
            ),
          ),
          h("div", {},
            h("a", {href: "#", onClick: this.downloadFile, title: "Download Log"},
              h("svg", {className: "download-icon"},
                h("use", {xlinkHref: "symbols.svg#download"})
              )
            ),
          ),
          h(FileUpload, {model}),
          h("div", {},
            h("button", {onClick: this.listAllLogs, className: "slds-button slds-button_brand"}, "List all logs"),
          ),
        ),
        h(LogTabNavigation, {model})
      )
    );
  }
}


class RawLog extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
  }

  componentDidMount() {

  }
  render() {
    let model = this.model;
    let keywordColor = new Map([["CODE_UNIT_STARTED", "violet"], ["CODE_UNIT_FINISHED", "violet"],
      ["SYSTEM_METHOD_ENTRY", "violet"], ["METHOD_ENTRY", "violet"], ["SYSTEM_CONSTRUCTOR_ENTRY", "violet"], ["FLOW_START_INTERVIEW_BEGIN", "green"],
      ["SYSTEM_METHOD_EXIT", "violet"], ["METHOD_EXIT", "violet"], ["SYSTEM_CONSTRUCTOR_EXIT", "violet"], ["FLOW_INTERVIEW_FINISHED", "green"],
      ["DML_BEGIN", "pink"], ["DML_END", "pink"],
      ["VALIDATION_RULE", "blue"], ["VALIDATION_PASS", "blue"],
      ["SOQL_EXECUTE_BEGIN", "navy"], ["SOSL_EXECUTE_BEGIN", "navy"], ["CALLOUT_REQUEST", "brown"], ["FLOW_ELEMENT_BEGIN", "green"],
      ["SOQL_EXECUTE_END", "navy"], ["SOSL_EXECUTE_END", "navy"], ["CALLOUT_REQUEST", "brown"], ["FLOW_ELEMENT_BEGIN", "green"],
      ["EXCEPTION_THROWN", "red"], ["VALIDATION_ERROR", "red"], ["VALIDATION_FAIL", "red"], ["FLOW_ELEMENT_ERROR", "red"], ["FATAL_ERROR", "red"], ["FLOW_CREATE_INTERVIEW_ERROR", "red"], ["FLOW_START_INTERVIEWS_ERROR", "red"]
    ]);
    return h("div", {},
      h(LogViewer, {model, keywordColor, keywordCaseSensitive: true}),
    );
  }
}

class LogTabNavigation extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.state = {
      selectedTabId: 1
    };
    this.tabs = [
      {
        id: 1,
        tabTitle: "Tab1",
        title: "Raw Log",
        content: RawLog
      },
      {
        id: 2,
        tabTitle: "Tab2",
        title: "Profiler",
        content: Profiler
      },
      {
        id: 3,
        tabTitle: "Tab3",
        title: "FlamGraph",
        content: FlamGraph
      }
    ];
    this.onTabSelect = this.onTabSelect.bind(this);
  }

  onTabSelect(e) {
    e.preventDefault();
    this.setState({selectedTabId: e.target.tabIndex});
  }

  componentDidMount() {

  }
  render() {
    return h("div", {className: "slds-tabs_default", style: {height: "inherit"}},
      h("ul", {className: "options-tab-container slds-tabs_default__nav", role: "tablist"},
        this.tabs.map((tab) => h(LogTab, {key: tab.id, id: tab.id, title: tab.title, content: tab.content, onTabSelect: this.onTabSelect, selectedTabId: this.state.selectedTabId, model: this.model}))
      ),
      this.tabs
        .filter((tab) => tab.id == this.state.selectedTabId)
        .map((tab) => h(tab.content, {key: tab.id, id: tab.id, model: this.model}))
    );
  }
}
class LogTab extends React.Component {

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
class LogTreeviewNode extends React.Component {
  constructor(props) {
    super(props);
    this.node = props.node;
    this.column = props.column;
    this.model = props.model;
    this.toggleExpand = this.toggleExpand.bind(this);
  }
  toggleExpand(){
    this.model.toggleExpand(this.node.index);
    this.model.didUpdate();
  }

  render() {
    let attributes = {hidden: this.node.hidden, "aria-level": this.node.level.toString(), "aria-posinset": this.node.position.toString(), "aria-selected": "false", "aria-setsize": this.node.child.length.toString(), className: "slds-hint-parent", tabIndex: -1};
    if (this.node.child.length > 0) {
      attributes["aria-expanded"] = this.node.expanded;
    }

    return h("tr", attributes,
      h("th", {className: "slds-tree__item", "data-label": "Item", scope: "row"},
        h("button", {className: "slds-button slds-button_icon slds-button_icon-x-small slds-m-right_x-small", hidden: (this.node.child.length == 0), "aria-hidden": true, tabIndex: -1, title: "Expand", onClick: this.toggleExpand},
          h("svg", {className: "slds-button__icon slds-button__icon_small", "aria-hidden": true},
            h("use", {xlinkHref: "symbols.svg#chevronright"})
          ),
          h("span", {className: "slds-assistive-text"}, "Expand " + this.node.title),
        ),
        this.node.icon ? h("svg", {className: "tree-icon"},
          h("use", {xlinkHref: "symbols.svg#" + this.node.icon})
        ) : "",
        h("div", {className: "slds-truncate", title: this.node.title},
          h("a", {href: "#", tabIndex: "-1"}, this.node.title)
        )
      ),
      this.column.filter(c => c.field).map((c, i) => h("td", {"data-label": c.title, role: "gridcell", key: "cell" + i},
        h("div", {className: "slds-truncate", title: this.node[c.field] || ""}, this.node[c.field] || "")
      ))
    );
  }
}

class Profiler extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.column = props.model.column;
    this.nodes = this.model.nodes;
    this.onMouseDown = this.onMouseDown.bind(this);
  }
  onMouseDown(e, id) {
    //let col = e.target.parentElement.parentElement;
    this.model.resizeColumnIndex = id;
    this.model.resizeColumnpageX = e.pageX;
    this.resizeColumnWidth = null;
    this.resizeNextColumnWidth = null;
    //this.model.resizeColumnWidth = col.offsetWidth;
    this.model.resizeColumnWidth = this.model.column[id].width;
    if (id + 1 < this.model.column.length) {
      this.model.resizeNextColumnWidth = this.model.column[id + 1].width;
    }
  }
  render() {
    return h("div", {style: {overflow: "scroll", height: "inherit"}}, //className: "slds-tree_container"},
      h("h4", {className: "slds-tree__group-header", id: "treeheading"}, "Log"),
      h("table", {className: "slds-table slds-table_bordered slds-table_edit slds-table_fixed-layout slds-table_resizable-cols slds-tree slds-table_tree", role: "treegrid", "aria-labelledby": "treeheading"},
        h("thead", {},
          h("tr", {className: "slds-line-height_reset"},
            this.column.map((c, i) =>
              h("th", {"aria-sort": "none", key: "column" + i, className: "slds-has-button-menu slds-is-resizable slds-is-sortable", scope: "col", style: {width: c.width + "px"}},
                h("a", {className: "slds-th__action slds-text-link_reset", href: "#", role: "button", tabIndex: "-1"},
                  h("div", {className: "slds-grid slds-grid_vertical-align-center slds-has-flexi-truncate"},
                    h("span", {className: "slds-truncate", title: c.title || ""}, c.title || "")
                  )
                ),
                h("div", {className: "slds-resizable"},
                  h("input", {type: "range", "aria-label": (c.title || "") + " column width", className: "slds-resizable__input slds-assistive-text", id: "cell-resize-handle-151", max: "1000", min: "20", tabIndex: "-1"}),
                  h("span", {className: "slds-resizable__handle", onMouseDown: e => this.onMouseDown(e, c.id)},
                    h("span", {className: "slds-resizable__divider"})
                  )
                )
              ))
          )
        ),
        h("tbody", {},
          this.nodes.map((c) => h(LogTreeviewNode, {node: c, key: c.key, model: this.model, column: this.column}))
        )
      )
    );
  }
}

class LogViewer extends React.Component {
  constructor(props) {
    super(props);
    this.keywordColor = props.keywordColor;
    this.keywordCaseSensitive = props.keywordCaseSensitive;

    //this.scrollTo = this.onShowStatusChange.bind(this);
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.offsetHeight = 0;
    this.offsetWidth = 0;
    this.scroller = null;

    this.renderNode = this.renderNode.bind(this);
  }
  componentDidMount() {
    let {model} = this.props;
    let log = this.refs.log;
    this.scroller = this.refs.scroller;

    model.setLogInput(log);
    function resize() {
      model.winInnerHeight = window.innerHeight;
      model.didUpdate(); // Will call recalculateSize
    }
    model.winInnerHeight = window.innerHeight;
    window.addEventListener("resize", resize);
  }
  dataChange() {

  }
  componentDidUpdate() {
    let {model} = this.props;
    let logView = model.logData;
    let currentSearchIdx = model.searchIndex;
    let rowHeight = 14;
    let scrollerOffsetHeight = 0;
    let totalHeight = model.lineCount * rowHeight;

    if (this.scroller != null) {
      scrollerOffsetHeight = this.scroller.offsetHeight;
    }

    if (currentSearchIdx != -1 && currentSearchIdx < logView.length && model.forceScroll) {
      let lineNum = logView.substring(0, currentSearchIdx).split("\n").length;
      let scrollLog = (lineNum * rowHeight) - (scrollerOffsetHeight / 2);
      if (scrollLog > 0 && scrollLog < totalHeight - scrollerOffsetHeight) {
        model.forceScroll = false;
        this.scroller.scrollTo(0, scrollLog);
      }
    }
  }

  renderNode(txtNode, i) {
    let {keywordColor, keywordCaseSensitive} = this.props;
    let remaining = txtNode.value;

    let keywords = [];
    for (let keyword of keywordColor.keys()) {
      keywords.push(keyword);
    }

    let keywordRegEx = new RegExp("\\b(" + keywords.join("|") + ")\\b", (keywordCaseSensitive ? "" : "i"));
    let keywordMatch;
    let color = null;
    let children = [];
    while ((keywordMatch = keywordRegEx.exec(remaining)) !== null) {
      color = keywordColor.get(keywordMatch[1]);
      let sentence = keywordMatch[1];
      let endIndex = keywordMatch.index + sentence.length;
      children.push(remaining.substring(0, keywordMatch.index));
      if (endIndex < remaining.length) {
        remaining = remaining.substring(keywordMatch.index + sentence.length);
      } else {
        remaining = ""; // no remaining
      }
      children.push(h("span", {style: {color}}, sentence));
    }
    if (remaining) {
      children.push(remaining);
    }
    if (txtNode.cls) {
      return h("span", {key: "TxtNode" + i, className: txtNode.cls}, children);
    } else {
      return children;
    }
  }

  render() {
    let {model} = this.props;

    // Scroll
    let rowHeight = 14; // constant: The initial estimated height of a row before it is rendered
    let scrollerOffsetHeight = 0;
    let scrollerScrollTop = 0;
    if (this.scroller != null) {
      scrollerScrollTop = this.scroller.scrollTop;
      scrollerOffsetHeight = this.scroller.offsetHeight;
    }

    //return h("div", {className: "editor", ref: "scroller", onScroll: onScrollerScroll, style: {offsetHeight: scrollerOffsetHeight, scrollTop: scrollerScrollTop, maxHeight: (model.winInnerHeight - 160) + "px"}},
    return h("div", {className: "editor", ref: "scroller", style: {offsetHeight: scrollerOffsetHeight, scrollTop: scrollerScrollTop, maxHeight: (model.winInnerHeight - 212) + "px"}},
      //h("div", {className: "scrolled"}, style: {height: scrolledHeight, top: scrolledTop}},
      h("div", {className: "line-numbers", style: {lineHeight: rowHeight + "px"}},
        //Array(lastRowIdx - firstRowIdx).fill(null).map((e, i) => h("span", {key: "LineNumber" + i}, i + firstRowIdx))
        model.lineNumbers.map((e) => e + "\n")
      ),
      h("div", {id: "log-text", ref: "log", style: {lineHeight: rowHeight + "px"}},
        model.EnrichLog.map(this.renderNode)
      )//, readOnly: true
      //)
    );
  }
}

class FileUpload extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      logFile: null,
    };
    this.onFileChange = this.onFileChange.bind(this);
    this.onFileUpload = this.onFileUpload.bind(this);
  }

  onFileChange(event) {
    this.setState({logFile: event.target.files[0]});
  }

  onFileUpload() {
    let {model} = this.props;

    if (this.state.logFile == null) {
      console.log("Please select a log file to load.");
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", (event) => {
      model.logData = event.target.result;
      model.EnrichLog = [{value: model.logData}];
      model.parseLog(model.logData);
      model.didUpdate();
    });
    reader.readAsText(this.state.logFile);
  }

  render() {
    return (
      h("div", {},
        h("label", {htmlFor: "logFile"}, "Load a previous log"),
        h("input", {type: "file", name: "logFile", onChange: this.onFileChange, className: "slds-input"}),
        h("button", {onClick: this.onFileUpload, className: "slds-button slds-button_brand"}, "Load"),
      )
    );
  }
}


class FlamGraphRect extends React.Component {
  constructor(props) {
    super(props);
    this.height = 20;
    this.fontSize = 12;
  }

  render() {
    let {node, width, offsetHeight, offsetWidth} = this.props;
    let nextChildOffsetWidth = offsetWidth;
    let greenColor = 255 - (255 * width / 1000);
    let nodeTitle = node.title;
    nodeTitle = node.title;
    if (nodeTitle.length > (width / this.fontSize)) {
      nodeTitle = nodeTitle.substring(0, Math.floor(width / this.fontSize));
    }
    if (nodeTitle.length > (width / this.fontSize)) {
      nodeTitle = nodeTitle.substring(0, Math.floor(width / this.fontSize));
    }
    return h("g", {},
      h("rect", {width, height: this.height, style: {fill: "rgb(236," + greenColor + ",100)", strokeWidth: "3", stroke: "rgb(255," + greenColor + ",0)"}, x: offsetWidth, y: offsetHeight * this.height},
        h("title", {}, node.title)
      ),
      h("text", {x: offsetWidth + (width / 2), y: (offsetHeight + 0.5) * this.height, fontSize: this.fontSize, textAnchor: "middle", fill: "white"}, nodeTitle),
      node.child.map((c) => this.renderChild(c, node, width, nextChildOffsetWidth, offsetHeight))
    );
  }

  renderChild(c, node, width, nextChildOffsetWidth, offsetHeight) {
    let childWidth;
    if (node[this.props.field]) {
      childWidth = width * (c[this.props.field] / node[this.props.field]);
    } else if (node[this.props.field] == 0){
      childWidth = 0;
    } else {
      childWidth = width;
    }
    let offsetWidth = nextChildOffsetWidth;
    nextChildOffsetWidth += childWidth;
    if (childWidth == 0) {
      return "";
    }
    return h(FlamGraphRect, {node: c, field: this.props.field, key: c.key, offsetHeight: offsetHeight + 1, width: childWidth, offsetWidth});
  }
}


class FlamGraph extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.column = props.model.column;
    this.rootNode = this.model.rootNode;
    this.availableFilters = [{
      title: "Duration",
      field: "duration"
    },
    {
      title: "Heap",
      field: "heapTotal"
    },
    {
      title: "DML",
      field: "dmlTotal",
    },
    {
      title: "SOQL",
      field: "soqlTotal",
    },
    {
      title: "SOSL",
      field: "soslTotal",
    },
    {
      title: "Query rows",
      field: "rowTotal",
    },
    {
      title: "DML rows",
      field: "dmlRowTotal",
    },
    {
      title: "Callouts",
      field: "calloutTotal",
    },
    {
      title: "Futur calls",
      field: "futurTotal",
    },
    {
      title: "jobs enqueue",
      field: "queueTotal",
    }];
    this.state = {
      filterBy: "duration",
    };
    this.onSelectFilterBy = this.onSelectFilterBy.bind(this);

  }
  onSelectFilterBy(e) {
    let {model} = this.props;
    this.setState({filterBy: e.target.value});
    model.didUpdate();
  }
  render() {
    return h("div", {style: {overflow: "scroll", height: "inherit"}}, //className: "slds-tree_container"},
      h("div", {className: "button-group"},
        h("select", {name: "log-filter", value: this.state.filterBy, onChange: this.onSelectFilterBy, className: "log-filter"},
          this.availableFilters.map(q => h("option", {key: q.field, value: q.field}, q.title))
        ),
      ),
      h("svg", {ref: "logFlameGraph", version: "1.1", baseProfile: "full", xmlns: "http://www.w3.org/2000/svg", width: "100%", height: "100%"},
        h(FlamGraphRect, {node: this.rootNode, field: this.state.filterBy, key: this.rootNode.key, offsetHeight: 0, width: 1000, offsetWidth: 0})
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
    let model = new Model({sfHost});
    model.recordId = args.get("recordId");
    model.startLoading();
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

    document.body.onmousemove = e => {
      if (model.resizeColumnIndex !== null) {
        let col = model.column[model.resizeColumnIndex];
        let diffX = e.pageX - model.resizeColumnpageX;
        if (model.resizeNextColumnWidth !== null && model.resizeColumnIndex + 1 < model.column.length) {
          model.column[model.resizeColumnIndex + 1].width = (model.resizeNextColumnWidth - diffX);
        }
        col.width = (model.resizeColumnWidth + diffX);
        model.didUpdate();
      }
    };
    document.body.onmouseup = () => {
      model.resizeColumnpageX = null;
      model.resizeColumnIndex = null;
      model.resizeNextColumnWidth = null;
      model.resizeColumnWidth = null;
      model.didUpdate();
    };
    if (parent && parent.isUnitTest) { // for unit tests
      parent.insextTestLoaded({model, sfConn});
    }

  });
}
