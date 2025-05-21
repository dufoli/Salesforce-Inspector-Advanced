/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {FlameChartComponent} from "./flamechart/wrappers/react/flame-chart-component.js";
/* global initButton */

//documentation to implement profiler
//https://www.developerforce.com/guides/fr/apex_fr/Content/code_setting_debug_log_levels.htm
class LogParser {
  constructor() {
    this.index = 0;//skip line 0 which contain version and log level for moment
    this.lineCount = 1;
    this.rootNode = null;
    this.nodes = null;
    this.nodeCount = 0;
    this.lines = [];
    this.lastTimestampNano = 0;
    this.logLinePattern = /^[0-9]{2}:[0-9]{2}:[0-9]{2}/m;
  }
  parseLog(data) {
    this.lines = data.split("\n");
    this.lineCount = this.lines.length;
    let node = new RootNode(this);
    this.parseLine(node, null);
    this.aggregate(node);
    this.rootNode = node;
    let result = [];
    [this.nodes, this.maxLvlNodes] = this.flatternNode(node.child, result, 1, 1);
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
  parseLine(node, expected){
    this.index++;

    for (; this.index < this.lineCount; this.index++) {
      let line = this.lines[this.index];
      while (this.index + 1 < this.lineCount && !this.logLinePattern.test(this.lines[this.index + 1])) {
        if (this.lines[this.index + 1]){
          line += "\n" + this.lines[this.index + 1];
        }
        this.index++;
      }
      let l = line.split("|");
      if (l.length <= 1) {
        continue;
      }
      //l[3] =log level
      switch (l[1]) {
        //EXECUTION_STARTED EXECUTION_FINISHED
        case "CODE_UNIT_STARTED": {
          new CodeUnitLogNode(l, this, node);
          break;
        } case "HEAP_ALLOCATE": {
          if (l.length > 3 && l[3].startsWith("Bytes:")) {
            let heap = Number(l[3].substring(6));
            if (!isNaN(heap)) {
              node.heap += heap;
            }
          }
          break;
        }
        case "SYSTEM_METHOD_ENTRY" : {
          new SystemMethodNode(l, this, node);
          break;
        }
        case "METHOD_ENTRY" : {
          new MethodNode(l, this, node);
          break;
        }
        case "SYSTEM_CONSTRUCTOR_ENTRY" : {
          new SystemConstructorNode(l, this, node);
          break;
        }
        case "CONSTRUCTOR_ENTRY": {
          new ConstructorNode(l, this, node);
          break;
        }
        case "FLOW_START_INTERVIEW_BEGIN" : {
          new FlowInterviewNode(l, this, node);
          break;
        }
        case "VALIDATION_RULE":{
          new ValidationRuleNode(l, this, node);
          break;
        }
        case "SOQL_EXECUTE_BEGIN":{
          new SOQLNode(l, this, node);
          break;
        }
        case "SOSL_EXECUTE_BEGIN":{
          new SOSLNode(l, this, node);
          break;
        }
        case "CALLOUT_REQUEST": { //not interesting
          new CalloutNode(l, this, node);
          break;
        }
        case "FLOW_ELEMENT_BEGIN": {
          new FlowElementNode(l, this, node);
          break;
        }
        case "DML_BEGIN": {
          new DMLNode(l, this, node);
          break;
        }
        case "NAMED_CREDENTIAL_REQUEST":
        {
          new NamedCredentialNode(l, this, node);
          break;
        }
        case "VF_APEX_CALL_START": {
          new VFApexCallNode(l, this, node);
          break;
        }
        case "VF_SERIALIZE_VIEWSTATE_BEGIN": {
          new VFSerializeViewstateNode(l, this, node);
          break;
        }
        case "VF_DESERIALIZE_VIEWSTATE_BEGIN": {
          new VFDeserializeViewstateNode(l, this, node);
          break;
        }
        case "VF_EVALUATE_FORMULA_BEGIN": {
          new VFEvaluateFormulaNode(l, this, node);
          break;
        }
        case "NBA_NODE_BEGIN": {
          new NextBestActionNode(l, this, node);
          break;
        }
        case "CALLOUT_RESPONSE":
        case "CODE_UNIT_FINISHED":
        case "CONSTRUCTOR_EXIT":
        case "CUMULATIVE_LIMIT_USAGE_END":
        case "DML_END":
        case "DUPLICATE_DETECTION_END" :
        case "FLOW_BULK_ELEMENT_END":
        case "FLOW_ELEMENT_DEFERRED":
        case "FLOW_ELEMENT_END":
        case "FLOW_ELEMENT_ERROR":
        case "FLOW_START_INTERVIEW_END":
        case "MATCH_ENGINE_END" :
        case "METHOD_EXIT":
        case "NAMED_CREDENTIAL_RESPONSE":
        case "NBA_NODE_END":
        case "ORG_CACHE_GET_END" :
        case "ORG_CACHE_PUT_END" :
        case "ORG_CACHE_REMOVE_END" :
        case "SESSION_CACHE_GET_END" :
        case "SESSION_CACHE_PUT_END" :
        case "SESSION_CACHE_REMOVE_END" :
        case "SOQL_EXECUTE_END":
        case "SOSL_EXECUTE_END":
        case "SYSTEM_CONSTRUCTOR_EXIT":
        case "SYSTEM_METHOD_EXIT":
        case "VALIDATION_FAIL":
        case "VALIDATION_PASS":
        case "VF_APEX_CALL_END":
        case "VF_DESERIALIZE_VIEWSTATE_END":
        case "VF_EVALUATE_FORMULA_END":
        case "VF_SERIALIZE_VIEWSTATE_END":
        case "WF_EMAIL_SENT" :
        case "VF_DESERIALIZE_CONTINUATION_STATE_END" :
        case "VF_SERIALIZE_CONTINUATION_STATE_END" :
        case "QUERY_MORE_END":
        case "CUMULATIVE_PROFILING_END":
        case "WF_RULE_EVAL_END": {
          if (Array.isArray(expected) && !expected.includes(l[1])) {
            console.log("Expected " + expected.join(", ") + " but got " + l[1]);
          } else if (!Array.isArray(expected) && expected != l[1]) {
            console.log("Expected " + expected + " but got " + l[1]);
          }
          node.finished(l, this);
          return;
        }
        case "SOQL_EXECUTE_EXPLAIN": {
          if (!(node instanceof SOQLNode)) {
            console.log("Expected SOQLNode but got " + node.constructor.name);
          } else {
            node.explain(l);
          }
          break;
        }
        case "CUMULATIVE_LIMIT_USAGE": {
          new CumulativeLimitUsageNode(l, this, node);
          break;
        }
        case "LIMIT_USAGE_FOR_NS": { //handle in CUMULATIVE_LIMIT_USAGE
          node.setLimits(l);
          break;
        }
        case "USER_DEBUG": {
          node.attachDebugInfo(l.slice(4).join("|"));
          break;
        }
        case "VALIDATION_FORMULA": {
          node.addFormula(l);
          break;
        }
        case "VALIDATION_ERROR": {
          node.addError(l);
          break;
        }
        case "WF_RULE_EVAL_BEGIN": {
          new WFRuleEvalNode(l, this, node);
          break;
        }
        case "WF_CRITERIA_BEGIN": {
          if (node.child.length > 0 && node.child[node.child.length - 1] instanceof WFRuleInvocationNode) {
            node.child[node.child.length - 1].setCriteria(l, this);
          } else if (node instanceof WFRuleEvalNode) {
            node.setCriteria(l, this);
          }
          break;
        }
        case "WF_FORMULA": {
          if (node.child.length > 0 && node.child[node.child.length - 1] instanceof WFRuleInvocationNode) {
            node.child[node.child.length - 1].setFormula(l, this);
          } else if (node instanceof WFRuleEvalNode) {
            node.setFormula(l, this);
          }
          break;
        }
        case "WF_FIELD_UPDATE": {
          if (node.child.length > 0 && node.child[node.child.length - 1] instanceof WFRuleInvocationNode) {
            node.child[node.child.length - 1].addFieldUpdate(l, this);
          } else if (node instanceof WFRuleEvalNode) {
            node.addFieldUpdate(l, this);
          }
          break;
        }
        case "WF_APPROVAL": {
          new WFApprovalNode(l, this, node);
          break;
        }
        case "WF_SPOOL_ACTION_BEGIN": {
          new WFSpoolActionBeginNode(l, this, node);
          break;
        }
        case "WF_APPROVAL_SUBMIT": {
          new WFApprovalSubmitNode(l, this, node);
          break;
        }
        case "WF_EMAIL_ALERT": {
          new WFEmailAlertNode(l, this, node);
          break;
        }
        case "WF_EVAL_ENTRY_CRITERIA": {
          new WFEvalEntryCriteriaNode(l, this, node);
          break;
        }
        case "WF_NEXT_APPROVER": {
          new WFNextApproverNode(l, this, node);
          break;
        }
        case "WF_PROCESS_FOUND": {
          new WFProcessFoundNode(l, this, node);
          break;
        }
        case "WF_PROCESS_NODE": {
          new WFProcessNodeNode(l, this, node);
          break;
        }
        case "MATCH_ENGINE_BEGIN": {
          new MatchEngineNode(l, this, node);
          break;
        }
        case "DUPLICATE_DETECTION_BEGIN": {
          new DuplicationDetectionNode(l, this, node);
          break;
        }
        case "ORG_CACHE_GET_BEGIN": {
          new OrgCacheGetNode(l, this, node);
          break;
        }
        case "ORG_CACHE_PUT_BEGIN": {
          new OrgCachePutNode(l, this, node);
          break;
        }
        case "ORG_CACHE_REMOVE_BEGIN": {
          new OrgCacheRemoveNode(l, this, node);
          break;
        }
        case "SESSION_CACHE_GET_BEGIN": {
          new SessionCacheGetNode(l, this, node);
          break;
        }
        case "SESSION_CACHE_PUT_BEGIN": {
          new SessionCachePutNode(l, this, node);
          break;
        }
        case "SESSION_CACHE_REMOVE_BEGIN": {
          new SessionCacheRemoveNode(l, this, node);
          break;
        }
        case "FLOW_BULK_ELEMENT_BEGIN": {
          new FlowBulkElementNode(l, this, node);
          break;
        }
        case "VF_DESERIALIZE_CONTINUATION_STATE_BEGIN": {
          new VFDeserializeContinuationStateNode(l, this, node);
          break;
        }
        case "VF_SERIALIZE_CONTINUATION_STATE_BEGIN":
        {
          new VFSerializeContinuationStateNode(l, this, node);
          break;
        }
        case "QUERY_MORE_BEGIN": {
          new QueryMoreNode(l, this, node);
          break;
        }
        case "CUMULATIVE_PROFILING_BEGIN": {
          new CumulativeProfilingNode(l, this, node);
          break;
        }

        case "CUMULATIVE_PROFILING": {
          if (node instanceof CumulativeProfilingNode) {
            node.addInfo(l);
          }
          break;
        }

        //missing node to parse
        case "APP_CONTAINER_INITIATED" :
        case "ASSET_DIFF_DETAIL" :
        case "ASSET_DIFF_SUMMARY" :
        case "BULK_COUNTABLE_STATEMENT_EXECUTE" :
        case "BULK_DML_RETRY":
        case "BULK_HEAP_ALLOCATE":
        case "CALLOUT_REQUEST_FINALIZE" :
        case "CALLOUT_REQUEST_PREPARE" :
        case "DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS":
        case "DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY":
        case "DUPLICATE_DETECTION_RULE_INVOCATION":
        case "DUPLICATE_RULE_FILTER_RESULT" :
        case "DUPLICATE_RULE_FILTER_VALUE" :
        case "DUPLICATE_RULE_FILTER" :
        case "EMAIL_QUEUE":
        case "ENTERING_MANAGED_PKG":
        case "EVENT_SERVICE_PUB_BEGIN":
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
        case "FLOW_BULK_ELEMENT_DETAIL":
        case "FLOW_BULK_ELEMENT_LIMIT_USAGE":
        case "FLOW_BULK_ELEMENT_NOT_SUPPORTED":
        case "FLOW_CREATE_INTERVIEW_BEGIN":
        case "FLOW_CREATE_INTERVIEW_END":
        case "FLOW_CREATE_INTERVIEW_ERROR":
        case "FLOW_ELEMENT_FAULT":
        case "FLOW_ELEMENT_LIMIT_USAGE":
        case "FLOW_INTERVIEW_FINISHED_LIMIT_USAGE":
        case "FLOW_INTERVIEW_FINISHED":
        case "FLOW_INTERVIEW_PAUSED":
        case "FLOW_INTERVIEW_RESUMED":
        case "FLOW_LOOP_DETAIL":
        case "FLOW_RULE_DETAIL":
        case "FLOW_START_INTERVIEW_LIMIT_USAGE":
        case "FLOW_START_INTERVIEWS_BEGIN":
        case "FLOW_START_INTERVIEWS_END":
        case "FLOW_START_INTERVIEWS_ERROR":
        case "FLOW_START_SCHEDULED_RECORDS":
        case "FLOW_SUBFLOW_DETAIL":
        case "FLOW_VALUE_ASSIGNMENT":
        case "FLOW_WAIT_EVENT_RESUMING_DETAIL":
        case "FLOW_WAIT_EVENT_WAITING_DETAIL":
        case "FLOW_WAIT_RESUMING_DETAIL":
        case "FLOW_WAIT_WAITING_DETAIL":
        case "HEAP_DEALLOCATE":
        case "HEAP_DUMP" :
        case "IDEAS_QUERY_EXECUTE":
        case "INVOCABLE_ACTION_DETAIL" :
        case "INVOCABLE_ACTION_ERROR" :
        case "JSON_DIFF_DETAIL" :
        case "JSON_DIFF_SUMMARY" :
        case "LIMIT_USAGE":
        case "MATCH_ENGINE_INVOCATION" :
        case "NAMED_CREDENTIAL_RESPONSE_DETAIL":
        case "NBA_NODE_DETAIL":
        case "NBA_NODE_ERROR":
        case "NBA_OFFER_INVALID":
        case "NBA_STRATEGY_BEGIN":
        case "NBA_STRATEGY_END":
        case "NBA_STRATEGY_ERROR":
        case "ORG_CACHE_MEMORY_USAGE" :
        case "POP_TRACE_FLAGS":
        case "PUSH_NOTIFICATION_INVALID_APP":
        case "PUSH_NOTIFICATION_INVALID_CERTIFICATE":
        case "PUSH_NOTIFICATION_INVALID_NOTIFICATION":
        case "PUSH_NOTIFICATION_NO_DEVICES":
        case "PUSH_NOTIFICATION_NOT_ENABLED":
        case "PUSH_NOTIFICATION_SENT":
        case "PUSH_TRACE_FLAGS":
        case "QUERY_MORE_ITERATIONS":
        case "REFERENCED_OBJECT_LIST" :
        case "RULES_EXECUTION_DETAIL" :
        case "RULES_EXECUTION_SUMMARY" :
        case "SAVEPOINT_ROLLBACK":
        case "SAVEPOINT_SET":
        case "SCRIPT_EXECUTION" :
        case "SESSION_CACHE_MEMORY_USAGE" :
        case "SLA_END":
        case "SLA_EVAL_MILESTONE":
        case "SLA_NULL_START_DATE":
        case "SLA_PROCESS_CASE":
        case "STACK_FRAME_VARIABLE_LIST":
        case "STATEMENT_EXECUTE"://apex statement: nothing important
        case "STATIC_VARIABLE_LIST":
        case "SYSTEM_MODE_ENTER":
        case "SYSTEM_MODE_EXIT":
        case "TEMPLATE_PROCESSING_ERROR" :
        case "TEMPLATED_ASSET" :
        case "TESTING_LIMITS":
        case "TOTAL_EMAIL_RECIPIENTS_QUEUED":
        case "TRANSFORMATION_SUMMARY" :
        case "USER_DEBUG_DEBUG" :
        case "USER_DEBUG_ERROR" :
        case "USER_DEBUG_FINE" :
        case "USER_DEBUG_FINER" :
        case "USER_DEBUG_FINEST" :
        case "USER_DEBUG_INFO" :
        case "USER_DEBUG_WARN" :
        case "USER_INFO":
        case "VARIABLE_ASSIGNMENT"://apex variable: nothing important
        case "VARIABLE_SCOPE_BEGIN"://apex variable: nothing important
        case "VARIABLE_SCOPE_END":
        case "VF_APEX_CALL" :
        case "VF_PAGE_MESSAGE":
        case "WAVE_APP_LIFECYCLE" :
        case "WF_ACTION_TASK":
        case "WF_ACTION":
        case "WF_ACTIONS_END":
        case "WF_APEX_ACTION" :
        case "WF_APPROVAL_REMOVE":
        case "WF_APPROVAL_SUBMITTER":
        case "WF_ASSIGN":
        case "WF_CHATTER_POST" :
        case "WF_CRITERIA_END":
        case "WF_ENQUEUE_ACTIONS":
        case "WF_ESCALATION_ACTION":
        case "WF_ESCALATION_RULE":
        case "WF_FLOW_ACTION_BEGIN":
        case "WF_FLOW_ACTION_DETAIL":
        case "WF_FLOW_ACTION_END":
        case "WF_FLOW_ACTION_ERROR_DETAIL":
        case "WF_FLOW_ACTION_ERROR":
        case "WF_HARD_REJECT":
        case "WF_KNOWLEDGE_ACTION" :
        case "WF_NO_PROCESS_FOUND":
        case "WF_OUTBOUND_MSG":
        case "WF_QUICK_CREATE" :
        case "WF_REASSIGN_RECORD":
        case "WF_RESPONSE_NOTIFY":
        case "WF_RULE_ENTRY_ORDER":
        case "WF_RULE_EVAL_VALUE":
        case "WF_RULE_FILTER":
        case "WF_RULE_INVOCATION":
        case "WF_RULE_NOT_EVALUATED":
        case "WF_SEND_ACTION" :
        case "WF_SOFT_REJECT":
        case "WF_TIME_TRIGGER":
        case "WF_TIME_TRIGGERS_BEGIN":
        case "XDS_DETAIL":
        case "XDS_REQUEST_DETAIL" :
        case "XDS_RESPONSE_DETAIL":
        case "XDS_RESPONSE_ERROR":
        case "XDS_RESPONSE": {
          //SKIP
          break;
        }
        default:
          break;
      }
    }
    node.finished(null, this);
    return;
  }
  aggregate(node) {
    node.heapTotal = node.heap;
    //duration is done on each node so no aggregate
    node.rowTotal = node.row || 0;
    node.dmlRowCountTotal = node.dmlRowCount || 0;
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
      node.dmlRowCountTotal += c.dmlRowCountTotal;
      node.dmlTotal += c.dmlTotal;
      node.soqlTotal += c.soqlTotal;
      node.soslTotal += c.soslTotal;
      node.calloutTotal += c.calloutTotal;
    }
  }
}
class BaseNode {
  constructor(logParser) {
    this.index = logParser.nodeCount;
    logParser.nodeCount++;
    this.child = [];
    this.heap = 0;
    this.expanded = true;
    this.hidden = false;
  }
  attachDebugInfo(debugInfo) {
    if (this.debug == null) {
      this.debug = [];
    }
    this.debug.push(debugInfo);
  }
}
class RootNode extends BaseNode {
  constructor(logParser) {
    super(logParser);
    this.title = "Log";
  }
  finished(splittedLine, logParser){
    //do nothing
  }
}
class LogNode extends BaseNode {
  constructor(splittedLine, logParser, node, expected, autoclose) {
    super(logParser);
    this.begin(splittedLine, logParser);
    this.title = splittedLine.slice(3).join(" ");
    node.child.push(this);
    if (autoclose) {
      let i = 1;
      while (logParser.index + i < logParser.lineCount) {
        if (logParser.lines[logParser.index + i] && logParser.logLinePattern.test(logParser.lines[logParser.index + i])){
          let l = logParser.lines[logParser.index + i].split("|");
          this.finished(l, logParser);
          return;
        }
        i++;
      }
      this.finished(splittedLine, logParser);
    } else {
      logParser.parseLine(this, expected);
    }
  }
  begin(splittedLine, logParser) {
    [this.start, this.startNano] = this.parseDate(splittedLine);
    if (this.startNano) {
      logParser.lastTimestampNano = this.startNano;
    }
  }
  parseDate(splittedLine) {
    if (splittedLine.length == 0) {
      return [null, null];
    }
    let datetimeTimestamp = splittedLine[0].split(/[:. ]/);
    if (datetimeTimestamp.length == 5){
      let rawHour = Number(datetimeTimestamp[0]);
      let rawMin = Number(datetimeTimestamp[1]);
      let rawSec = Number(datetimeTimestamp[2]);
      let rawMil = Number(datetimeTimestamp[3]);
      let rawNano = Number(datetimeTimestamp[4].substring(1, datetimeTimestamp[4].length - 1));
      let dt = null;
      if (!isNaN(rawHour) && !isNaN(rawMin) && !isNaN(rawSec) && !isNaN(rawMil)) {
        dt = new Date();
        dt.setHours(rawHour);
        dt.setMinutes(rawMin);
        dt.setSeconds(rawSec);
        dt.setMilliseconds(rawMil * 100);
      }
      if (!isNaN(rawNano)) {
        return [dt, rawNano];
      }
      return [dt, null];
    }
    return [null, null];
  }
  finished(splittedLine, logParser){
    if (splittedLine == null) {
      this.endNano = logParser.lastTimestampNano;
    } else {
      [this.end, this.endNano] = this.parseDate(splittedLine);
      if (this.endNano != null){
        logParser.lastTimestampNano = this.endNano;
      }
    }
    if (this.startNano && this.endNano) {
      this.duration = (this.endNano - this.startNano) / 1000000.0;
    } else if (this.start && this.end) {
      this.duration = (this.end.getTime() - this.start.getTime());
    }
    if (this.duration == 0) { //force minimum size to display on flamechart
      this.duration = 1;
    }
  }
}
class CodeUnitLogNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "CODE_UNIT_FINISHED");
    this.title = "code unit";
  }
}
class ApexNode extends LogNode {
  constructor(splittedLine, logParser, node, expected) {
    super(splittedLine, logParser, node, expected);
    this.lineNumber = splittedLine[2].substring(1, -1);
  }
}
class SystemMethodNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "SYSTEM_METHOD_EXIT");
  }
}
class MethodNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "METHOD_EXIT");
  }
}
class SystemConstructorNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "SYSTEM_CONSTRUCTOR_EXIT");
  }
}
class ConstructorNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "CONSTRUCTOR_EXIT");
  }
}
class FlowInterviewNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "FLOW_START_INTERVIEW_END");
    this.icon = "flow";
  }
}
class ValidationRuleNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, ["VALIDATION_PASS", "VALIDATION_FAIL"]);
    this.icon = "approval";
  }
  finished(l, logParser) {
    super.finished(l, logParser);
    if (l == null || l.length < 4) {
      return;
    }
    this.status = l[1];
  }
  addFormula(l) {
    if (l.length > 3) {
      this.formula = l.slice(2).join("|");
    }
  }
  addError(l) {
    if (l.length > 3) {
      this.error = l.slice(2).join("|");
    }
  }
}
class SOQLNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "SOQL_EXECUTE_END");
    this.icon = "table";
    this.soql = 1;
    if (splittedLine[3].startsWith("Aggregations:")) {
      let agg = Number(splittedLine[3].substring(13));
      if (!isNaN(agg)) {
        this.aggregations = agg;
      }
    }
  }
  finished(l, logParser) {
    super.finished(l, logParser);
    if (l == null || l.length < 4) {
      return;
    }
    //Rows:1
    let row = Number(l[3].substring(5));
    if (!isNaN(row)){
      this.row = row;
    }
  }
  explain(l) {
    //Index on User : [Id], cardinality: 1, sobjectCardinality: 575, relativeCost 0.006
    if (l.length > 3) {
      let explaination = l[3].split("],");
      let dbIndex = explaination[0].split(" : [");
      this.SObjectName = dbIndex[0].substring(9);
      this.fields = dbIndex[1].split(",");
      explaination[1].split(",").map((p) => {
        let pair = p.trim().split(/: /).filter(el => el);
        if (pair.length > 2) {
          let val = pair.pop();
          pair = [pair.join(""), val];
        }
        if (pair[0] == "cardinality" || pair[0] == "sobjectCardinality" || pair[0] == "relativeCost") {
          this[pair[0]] = Number(pair[1]);
        } else {
          this[pair[0]] = pair[1];
        }
      });
    }
  }
}
class SOSLNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "SOSL_EXECUTE_END");
    this.icon = "search";
    this.sosl = 1;
  }
  finished(l, logParser) {
    super.finished(l, logParser);
    if (l == null || l.length < 4) {
      return;
    }
    //Rows:1
    let row = Number(l[3].substring(5));
    if (!isNaN(row)){
      this.row = row;
    }
  }
}
class CalloutNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "CALLOUT_RESPONSE");
    this.icon = "broadcast";
    this.callout = 1;
  }
  finished(l, logParser) {
    super.finished(l, logParser);
    if (l == null || l.length < 4) {
      return;
    }
    //System.HttpResponse[Status=OK, StatusCode=200]
    this.title += l[3].substring(19);
  }
}
//TODO "futur", "queue",

class FlowElementNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "FLOW_ELEMENT_");
    this.icon = "flow";
  }
}
class DMLNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "DML_END");
    //DML_BEGIN|[71]|Op:Update|Type:Account|Rows:1
    this.icon = "database";
    this.title = "DML " + splittedLine[3].substring(3) + " " + splittedLine[4].substring(5);
    this.dml = 1;
    if (splittedLine.length > 4){
      let dmlRowCount = Number(splittedLine[5].substring());
      if (!isNaN(dmlRowCount)){
        this.dmlRowCount = dmlRowCount;
      }
    }
  }
}

class NamedCredentialNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "NAMED_CREDENTIAL_RESPONSE");
    this.icon = "broadcast";
  }
}
class VFApexCallNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "VF_APEX_CALL_END");
  }
}

class VFSerializeViewstateNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "VF_SERIALIZE_VIEWSTATE_END");
  }
}
class VFDeserializeViewstateNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "VF_DESERIALIZE_VIEWSTATE_END");
  }
}
class VFSerializeContinuationStateNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "VF_SERIALIZE_CONTINUATION_STATE_END");
  }
}
class VFDeserializeContinuationStateNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "VF_DESERIALIZE_CONTINUATION_STATE_END");
  }
}
class VFEvaluateFormulaNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "VF_EVALUATE_FORMULA_END");
  }
}
class CumulativeLimitUsageNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "CUMULATIVE_LIMIT_USAGE_END");
  }
  setLimits(l) {
    let limits = l.slice(3).join("|").split("\n");
    for (let i = 0; i < limits.length; i++) {
      if (!limits[i]) {
        continue;
      }
      let pair = limits[i].split(": ");
      this[pair[0].replace("Number of ", "").trim().replace(" ", "_")] = pair[1];
    }
  }
}

class NextBestActionNode extends ApexNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "NBA_NODE_END");
    this.icon = "question";
  }
}

class WFNode extends LogNode {
  constructor(splittedLine, logParser, node, expected, autoclose) {
    super(splittedLine, logParser, node, expected, autoclose);
    this.icon = "flow";
    this.fieldUpdates = [];
  }
  setCriteria(l, logParser) { //WF_CRITERIA_BEGIN|[ObjectName: RecordName RecordID]|WorkflowRuleName|WorkflowRuleNameID
    this.criteria = l.slice(2).join("|");
  }
  setFormula(l, logParser) { //WF_FORMULA (multi line)
    this.formula = l.slice(2).join("|");
  }
  addFieldUpdate(l, logParser) { //WF_FIELD_UPDATE|[ObjectName Record Name RecordID]|WorkflowRuleName|WorkflowRuleNameID
    this.fieldUpdates.push(l.slice(2).join("|"));
  }
}

class WFRuleEvalNode extends WFNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "WF_RULE_EVAL_END");
  }
}
class WFRuleInvocationNode extends WFNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, null, true);
  }
  setCriteria(l, logParser) {
    super.setCriteria(l, logParser);
    this.finished(l, logParser);
  }
  setFormula(l, logParser) { //WF_FORMULA (multi line)
    this.formula = l.slice(2).join("|");
    this.finished(l, logParser);
  }
  addFieldUpdate(l, logParser) { //WF_FIELD_UPDATE|[ObjectName Record Name RecordID]|WorkflowRuleName|WorkflowRuleNameID
    this.fieldUpdates.push(l.slice(2).join("|"));
    this.finished(l, logParser);
  }
}

class WFApprovalNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, null, true);
    this.icon = "approval";
    this.status = splittedLine[2];
    this.step = splittedLine[4];
  }
}
class WFSpoolActionBeginNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, null, true);
    this.icon = "approval";
    this.status = splittedLine[2];
  }
}
class WFApprovalSubmitNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, null, true);
    this.icon = "approval";
  }
}

class WFEmailAlertNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "WF_EMAIL_SENT");
    this.icon = "email";
  }
}

class WFEvalEntryCriteriaNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, null, true);
    this.icon = "flow";
  }
}
class WFNextApproverNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, null, true);
    this.icon = "flow";
  }
}
class WFProcessFoundNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, null, true);
    this.icon = "flow";
  }
}
class WFProcessNodeNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, null, true);
    this.icon = "flow";
  }
}
class MatchEngineNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "MATCH_ENGINE_END");
    this.icon = "groups";
  }
}

class DuplicationDetectionNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "DUPLICATE_DETECTION_END");
    this.icon = "groups";
  }
}

class OrgCacheRemoveNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "ORG_CACHE_REMOVE_END");
    this.icon = "offline_cached";
  }
}
class OrgCacheGetNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "ORG_CACHE_GET_END");
    this.icon = "offline_cached";
  }
}
class OrgCachePutNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "ORG_CACHE_PUT_END");
    this.icon = "offline_cached";
  }
}
class SessionCacheRemoveNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "SESSION_CACHE_REMOVE_END");
    this.icon = "offline_cached";
  }
}
class SessionCacheGetNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "SESSION_CACHE_GET_END");
    this.icon = "offline_cached";
  }
}
class SessionCachePutNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "SESSION_CACHE_PUT_END");
    this.icon = "offline_cached";
  }
}
class FlowBulkElementNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "FLOW_BULK_ELEMENT_END");
    this.icon = "flow";
  }
}
class QueryMoreNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "QUERY_MORE_END");
    this.icon = "database";
  }
}
class CumulativeProfilingNode extends LogNode {
  constructor(splittedLine, logParser, node) {
    super(splittedLine, logParser, node, "CUMULATIVE_PROFILING_END");
    this.icon = "database";
    this.infos = [];
  }
  addInfo(l) {
    if (l.length > 3) {
      this.infos.push(l.slice(2).join("|"));
    }
  }
}

class Model {

  constructor({sfHost}) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.userInfo = "...";
    // URL parameters
    this.recordId = null;
    this.logParser = new LogParser();
    this.lineNumbers = Array.from(Array(this.logParser.lineCount).keys());

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
        field: "dmlRowCountTotal",
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
    this.lineNumbers = Array.from(Array(this.logParser.lineCount).keys());
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
      this.lineNumbers = Array.from(Array(this.logParser.lineCount).keys());
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

  hideNodesByFilter(filter) {
    if (!this.logParser.rootNode) {
      return;
    }
    this.logParser.rootNode.hidden = this.hideNodeByFilter(filter, this.logParser.rootNode);
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
    if (!this.logParser.rootNode) {
      return;
    }
    let searchRegEx = null;
    if (searchTerm) {
      searchRegEx = new RegExp(searchTerm, "i");
    }
    this.logParser.rootNode.hidden = this.hideNodeBySearch(searchRegEx, this.logParser.rootNode);
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
    let n = this.logParser.nodes[i];
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

  parseLog(data) {
    this.logData = data;
    this.EnrichLog = [{value: data}];
    this.logParser.parseLog(data);
    this.lineNumbers = Array.from(Array(this.lineCount).keys());
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
  //TODO instead of switch make a map to get node parser with inheritence from node name
  render() {
    let model = this.model;
    let keywordColor = new Map([["CODE_UNIT_STARTED", "violet"], ["CODE_UNIT_FINISHED", "violet"],
      ["SYSTEM_METHOD_ENTRY", "violet"], ["METHOD_ENTRY", "violet"], ["SYSTEM_CONSTRUCTOR_ENTRY", "violet"], ["FLOW_START_INTERVIEW_BEGIN", "green"],
      ["SYSTEM_METHOD_EXIT", "violet"], ["METHOD_EXIT", "violet"], ["SYSTEM_CONSTRUCTOR_EXIT", "violet"], ["FLOW_START_INTERVIEW_END", "green"],
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
        content: NewFlameGraph
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
    this.nodes = this.model.logParser.nodes;
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
    let totalHeight = model.logParser.lineCount * rowHeight;

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
      model.parseLog(event.target.result);
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

class NewFlameGraph extends React.Component {
  constructor(props) {
    super(props);
    this.model = props.model;
    this.column = props.model.column;
    this.rootNode = this.model.logParser.rootNode;
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
      field: "dmlRowCountTotal",
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
  convert(node) {
    return {
      name: node.title,
      start: node.startNano ? node.startNano / 1000000.0 : (node.Start ? node.start.getTime() : 0),
      duration: node.duration,
      type: node.icon,
      children: node.child.map((c) => this.convert(c)),
    };
  }
  render() {
    let data = [this.convert(this.rootNode)];
    let settings = {
      hotkeys: {
        active: true, // enable navigation using arrow keys
        scrollSpeed: 0.5, // scroll speed (ArrowLeft, ArrowRight)
        zoomSpeed: 0.001, // zoom speed (ArrowUp, ArrowDown, -, +)
        fastMultiplayer: 5, // speed multiplier when zooming and scrolling (activated by Shift key)
      },
      options: {
        timeUnits: "ms",
      },
    };
    let colors = {
      "flow": "#92d1d1",
      "approval": "#92b2d1",
      "broadcast": "#9292d1",
      "database": "#b292d1",
      "email": "#d192d1",
      "groups": "#d192b2",
      "offline_cached": "#82bfec",
      "question": "#e492c3",
      "search": "#f899a5",
      "table": "#e9bd87",
    };
    return h("div", {style: {overflow: "scroll", height: "inherit"}}, //className: "slds-tree_container"},
      h(FlameChartComponent, {data, settings, colors, className: "flameChart"})
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
