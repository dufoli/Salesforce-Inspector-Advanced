/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */

export class Model {
  constructor({sfHost, args}) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.userInfo = "...";
    this.spinnerCount = 0;
    this.error = null;
    this.flowId = args.get("flowId");
    this.flowMetadata = null;
    this.analysisResults = [];
    this.title = "Flow Analyzer";
    if (this.flowId) {
      this.spinFor(this.loadFlowMetadata());
    }
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
    }));
  }

  async loadFlowMetadata() {
    try {
      // Get flow metadata
      const flowQuery = `SELECT Id, FullName, MasterLabel, Status, Metadata, ApiVersion, DefinitionId FROM Flow WHERE Id='${this.flowId.replace(/([\\'])/g, "\\$1")}'`;
      const flowResponse = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(flowQuery));

      if (!flowResponse.records || flowResponse.records.length === 0) {
        throw new Error("Flow not found");
      }

      this.flowMetadata = flowResponse.records[0];
      this.title = `Flow Analyzer: ${this.flowMetadata.MasterLabel}`;

      // Get flow versions count
      const versionsQuery = `SELECT COUNT() FROM Flow WHERE DefinitionId='${this.flowMetadata.DefinitionId.replace(/([\\'])/g, "\\$1")}'`;
      const versionsResponse = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(versionsQuery));
      this.flowVersionCount = versionsResponse.totalSize;

      // Run analysis
      this.analysisResults = this.analyzeFlow(this.flowMetadata);
      this.didUpdate();
    } catch (err) {
      console.error("Error loading flow metadata:", err);
      this.error = err.message || "Failed to load flow metadata";
      this.didUpdate();
    }
  }

  analyzeFlow(flow) {
    const results = [];
    const metadata = flow.Metadata;

    //for performance store map name to element
    let nameToElement = new Map();
    for (const key of Object.keys(metadata)) {
      let element = metadata[key];
      if (!element || typeof element != "object") {
        continue;
      }
      this.normalizeMetadataProperty(element).forEach(element => {
        if (element.name) {
          element.type = key;
          nameToElement.set(element.name, element);
        }
      });
    }
    flow.nameToElement = nameToElement;

    // Rule 1: Flow with too many versions
    if (this.flowVersionCount > 50) {
      results.push({
        rule: "Flow with too many versions",
        severity: "warning",
        message: `This flow has ${this.flowVersionCount} versions. Consider cleaning up old versions.`
      });
    }
    const currentApiVersionNum = parseFloat(apiVersion);
    let flowApiVersionNum = 0;
    // Rule 2: Flow old API version
    if (flow.ApiVersion) {
      flowApiVersionNum = parseFloat(flow.ApiVersion);
    }
    if (flowApiVersionNum < currentApiVersionNum - 15) {
      results.push({
        rule: "Flow old API version",
        severity: "warning",
        message: `Flow API version is ${flow.ApiVersion}. Current API version is ${apiVersion}. Consider updating the flow to use a newer API version.`
      });
    }

    // Rule 3: PRB or workflow to migrate to flow
    // This would require checking for related Process Builder or Workflow Rules
    // For now, we'll note if flow type is not AutoLaunched or Screen

    // Rule 4: Hardcoded ID in code instead of label
    const hardcodedIds = this.findHardcodedIds(metadata);
    if (hardcodedIds.length > 0) {
      results.push({
        rule: "Hardcoded ID in code instead of label",
        severity: "warning",
        message: `Found ${hardcodedIds.length} hardcoded IDs. Use labels or references instead.`,
        details: hardcodedIds
      });
    }

    // Rule 5-8: DML operations in loops
    const dmlInLoops = this.findDMLInLoops(flow);
    if (dmlInLoops.getRecord.length > 0) {
      results.push({
        rule: "Get Record in Loop",
        severity: "error",
        message: `Found ${dmlInLoops.getRecord.length} Get Record element(s) inside loops.`,
        details: dmlInLoops.getRecord
      });
    }
    if (dmlInLoops.updateRecord.length > 0) {
      results.push({
        rule: "Update Record in Loop",
        severity: "error",
        message: `Found ${dmlInLoops.updateRecord.length} Update Record element(s) inside loops.`,
        details: dmlInLoops.updateRecord
      });
    }
    if (dmlInLoops.createRecord.length > 0) {
      results.push({
        rule: "Create Record in Loop",
        severity: "error",
        message: `Found ${dmlInLoops.createRecord.length} Create Record element(s) inside loops.`,
        details: dmlInLoops.createRecord
      });
    }
    if (dmlInLoops.deleteRecord.length > 0) {
      results.push({
        rule: "Delete Record in Loop",
        severity: "error",
        message: `Found ${dmlInLoops.deleteRecord.length} Delete Record element(s) inside loops.`,
        details: dmlInLoops.deleteRecord
      });
    }

    // Rule 9: Action Calls In Loop
    const actionCallsInLoops = this.findActionCallsInLoops(flow);
    if (actionCallsInLoops.length > 0) {
      results.push({
        rule: "Action Calls In Loop",
        severity: "warning",
        message: `Found ${actionCallsInLoops.length} action call(s) inside loops.`,
        details: actionCallsInLoops
      });
    }

    // Rule 10: Not Auto Layout
    if (metadata.processMetadataValues) {
      const processMetadataValues = this.normalizeMetadataProperty(metadata.processMetadataValues);
      if (processMetadataValues.some(p => p.name === "CanvasMode" && p.value.stringValue !== "AUTO_LAYOUT_CANVAS")) {
        results.push({
          rule: "Not Auto Layout",
          severity: "info",
          message: "Flow is not using Auto Layout. Consider using Auto Layout for better maintainability."
        });
      }
    }

    // Rule 11: Copy API Name
    const copyApiNames = this.findCopyApiNames(metadata);
    if (copyApiNames.length > 0) {
      for (const copyApiName of copyApiNames) {
        results.push({
          rule: "Copy API Name",
          severity: "info",
          message: `API Name ${copyApiName} with a similar name like 'Copy_X_Of_Element' must be renamed.`,
          recommendation: "Using repetitive names such as Copy_X_Of_Element can make your Flow harder to read. Always rename the API name after duplicating an element."
        });
      }
    }

    // Rule 12: Cyclomatic Complexity
    const complexity = this.calculateCyclomaticComplexity(metadata);
    if (complexity > 25) {
      results.push({
        rule: "Cyclomatic Complexity",
        severity: "warning",
        message: `Flow has a cyclomatic complexity of ${complexity}. Consider simplifying the flow (recommended: < 11).`
      });
    }

    // Rule 13: Flow Naming Convention
    if (!this.checkNamingConvention(flow.FullName)) {
      results.push({
        rule: "Flow Naming Convention",
        severity: "info",
        message: "Flow API name does not follow common naming conventions (Best practice is to use a domain name as a prefix and a briefdescription)."
      });
    }

    // Rule 14: Get Record All Fields => select the needed field only
    const getAllFields = this.findGetRecordAllFields(flow);
    if (getAllFields.length > 0) {
      results.push({
        rule: "Get Record All Fields",
        severity: "warning",
        message: `Found ${getAllFields.length} Get Record element(s) that retrieve all fields. Select only needed fields for better performance.`,
        details: getAllFields
      });
    }

    // Rule 15: Hardcode URL
    const hardcodedUrls = this.findHardcodedUrls(metadata);
    if (hardcodedUrls.length > 0) {
      results.push({
        rule: "Hardcoded URL",
        severity: "warning",
        message: `Found ${hardcodedUrls.length} hardcoded URL(s). Consider using custom settings or variables.`,
        details: hardcodedUrls
      });
    }

    // Rule 16: Missing fault path
    const missingFaultPaths = this.findMissingFaultPaths(metadata);
    if (missingFaultPaths.length > 0) {
      results.push({
        rule: "Missing fault path",
        severity: "warning",
        message: `Found ${missingFaultPaths.length} element(s) without fault path configured.`,
        details: missingFaultPaths
      });
    }

    // Rule 17: Missing null handler
    const missingNullHandlers = this.findMissingNullHandlers(metadata);
    if (missingNullHandlers.length > 0) {
      for (const missingNullHandler of missingNullHandlers) {
        results.push({
          rule: "Missing null handler",
          severity: "warning",
          message: `Found ${missingNullHandler} element(s) without null handling.`
        });
      }
    }

    // Rule 18: Recursive after update
    const recursiveAfterUpdate = this.findRecursiveAfterUpdate(metadata);
    if (recursiveAfterUpdate) {
      results.push({
        rule: "Recursive after update",
        severity: "error",
        message: "Flow may trigger itself recursively on after update. Check for triggers that could cause infinite loops."
      });
    }

    // Rule 19: Same Record Field Updates
    const sameFieldUpdates = this.findSameFieldUpdates(metadata);
    if (sameFieldUpdates) {
      results.push({
        rule: "Same Record Field Updates",
        severity: "warning",
        message: "Before-save same-record field updates allows you to update the record using variable assignments to `$Record`. This is significantly faster than doing another DML on the same-record that triggered the flow"
      });
    }

    // Rule 20: Unconnected Element
    const unconnectedElements = this.findUnconnectedElements(flow);
    if (unconnectedElements.length > 0) {
      results.push({
        rule: "Unconnected Element",
        severity: "warning",
        message: `Found ${unconnectedElements.length} unconnected element(s).`,
        details: unconnectedElements
      });
    }

    // Rule 21: Unsafe Running Context
    const unsafeContext = this.checkUnsafeRunningContext(metadata);
    if (unsafeContext) {
      results.push({
        rule: "Unsafe Running Context",
        severity: "warning",
        message: "Flow may run in unsafe context. Review system context and sharing settings."
      });
    }

    // Rule 22: Unused Variable
    const unusedVariables = this.findUnusedVariables(metadata);
    if (unusedVariables.length > 0) {
      results.push({
        rule: "Unused Variable",
        severity: "info",
        message: `Found ${unusedVariables.length} unused variable(s).`,
        details: unusedVariables
      });
    }

    // Rule 23: Missing Flow Description
    if (!metadata.description || metadata.description.trim() === "") {
      results.push({
        rule: "Missing Flow Description",
        severity: "info",
        message: "Flow is missing a description. Add a description to document the flow's purpose and functionality."
      });
    }

    return results;
  }

  // Helper method to normalize metadata property (convert to array if needed)
  normalizeMetadataProperty(property) {
    if (!property) return [];
    if (Array.isArray(property)) return property;
    return [property];
  }

  // Helper method to get an element by name from metadata
  getElementByName(flow, name) {
    if (!name || !flow || !flow.nameToElement) return null;
    return flow.nameToElement.get(name) || null;
  }

  // Helper method to resolve connector (can be string name or object with targetReference)
  resolveConnector(flow, connector) {
    if (!connector) return null;

    // If connector is a string, treat it as a name
    if (typeof connector === "string") {
      return this.getElementByName(flow, connector);
    }

    // If connector is an array, resolve each element
    if (Array.isArray(connector)) {
      return connector.map(c => this.resolveConnector(flow, c)).filter(Boolean);
    }

    // If connector has targetReference, resolve it
    if (connector.targetReference) {
      return this.getElementByName(flow, connector.targetReference);
    }

    // If connector is already an element object, return it
    return connector;
  }

  findHardcodedIds(metadata) {
    const ids = [];
    const idPattern = /\b[a-zA-Z0-9]{5}0[a-zA-Z0-9]{9}(?:[a-zA-Z0-9]{3})?\b/g;

    const searchInObject = (obj, path = "") => {
      if (typeof obj === "string" && idPattern.test(obj)) {
        ids.push(`${path}: ${obj}`);
      } else if (typeof obj === "object" && obj !== null) {
        for (const key in obj) {
          searchInObject(obj[key], path ? `${path}.${key}` : key);
        }
      }
    };

    searchInObject(metadata);
    return ids;
  }

  findDMLInLoops(flow) {
    const metadata = flow.Metadata;
    const result = {
      getRecord: [],
      updateRecord: [],
      createRecord: [],
      deleteRecord: []
    };

    // Get all loops directly from metadata
    const loops = this.normalizeMetadataProperty(metadata.loops || []);
    if (loops.length === 0) {
      return result;
    }

    // Helper function to process nodes and collect DML operations
    const visited = new Set();
    const processDMLNode = (element) => {
      // Check element type and collect DML operations
      if (element.type === "recordLookups") {
        result.getRecord.push(element.name || element.label || "Unnamed");
      } else if (element.type === "recordUpdates") {
        result.updateRecord.push(element.name || element.label || "Unnamed");
      } else if (element.type === "recordCreates") {
        result.createRecord.push(element.name || element.label || "Unnamed");
      } else if (element.type === "recordDeletes") {
        result.deleteRecord.push(element.name || element.label || "Unnamed");
      }
    };

    // For each loop, start from nextValueConnector.targetReference
    loops.forEach(loop => {
      visited.clear(); // Reset visited for each loop
      visited.add(loop.name || loop.label || "Unnamed");
      if (loop.nextValueConnector) {
        const resolvedNode = this.resolveConnector(flow, loop.nextValueConnector);
        if (resolvedNode) {
          const resolvedArray = Array.isArray(resolvedNode) ? resolvedNode : [resolvedNode];
          resolvedArray.forEach(resolved => {
            this.traverseConnectorChain(flow, resolved, processDMLNode, visited);
          });
        }
      }
    });

    return result;
  }

  findActionCallsInLoops(flow) {
    const metadata = flow.Metadata;
    const actionCalls = [];

    // Get all loops directly from metadata
    const loops = this.normalizeMetadataProperty(metadata.loops || []);
    if (loops.length === 0) {
      return actionCalls;
    }

    // Helper function to process nodes and collect action calls
    const visited = new Set();
    const processActionCallNode = (element) => {
      // Check if it's an action call
      if (element.type === "actionCalls" || element.type === "apexPluginCalls") {
        actionCalls.push(element.name || element.label || "Unnamed");
      }
    };

    // For each loop, start from nextValueConnector.targetReference
    loops.forEach(loop => {
      visited.clear(); // Reset visited for each loop
      visited.add(loop.name || loop.label || "Unnamed");
      if (loop.nextValueConnector) {
        const resolvedNode = this.resolveConnector(flow, loop.nextValueConnector);
        if (resolvedNode) {
          const resolvedArray = Array.isArray(resolvedNode) ? resolvedNode : [resolvedNode];
          resolvedArray.forEach(resolved => {
            this.traverseConnectorChain(flow, resolved, processActionCallNode, visited);
          });
        }
      }
    });

    return actionCalls;
  }

  findCopyApiNames(metadata) {
    return Object.values(metadata)
      .filter(e => typeof e === "object" && e !== null)
      .flat()
      .filter(e => e?.name)
      .reduce((acc, element) => {
        if (/Copy_[0-9]+_of_[A-Za-z0-9]+/.test(element.name)) {
          acc.push(element.name);
        }
        return acc;
      }, []);
  }

  calculateCyclomaticComplexity(metadata) {
    let complexity = 1; // Base complexity
    if (metadata?.decisions) {
      const decisions = this.normalizeMetadataProperty(metadata.decisions);
      decisions.forEach(decision => {
        complexity += decision.rules ? decision.rules.length : 1;
      });
    }
    if (metadata?.loops) {
      const loops = this.normalizeMetadataProperty(metadata.loops);
      complexity += loops.length;
    }

    return complexity;
  }

  checkNamingConvention(fullName) {
    // Basic check: should not contain spaces, should follow camelCase or PascalCase
    return /[A-Za-z0-9]+_[A-Za-z0-9]+/.test(fullName) && fullName.length > 5;
  }

  findGetRecordAllFields(flow) {
    const metadata = flow.Metadata;
    const getAllFields = [];


    // Check all recordLookups
    const recordLookups = this.normalizeMetadataProperty(metadata.recordLookups || []);
    recordLookups.forEach(element => {
      // Check if querying all fields (queryAllFields is true or no specific fields selected)
      if (element.queryAllFields === true
            || (!element.field && !element.fields && element.queryAllFields !== false)) {
        getAllFields.push(element.name || element.label || element.apiName || "Unnamed");
      }
    });

    return [...new Set(getAllFields)]; // Remove duplicates
  }

  findHardcodedUrls(metadata) {
    const urls = [];
    const urlPattern = /https?:\/\/[^\/]+(\.salesforce\.com|\.cloudforce\.com|\.salesforce\.mil|\.cloudforce\.mil|\.sfcrmproducts\.cn|\.force\.com|\.salesforce-setup\.com|\.visualforce\.com|\.sfcrmapps\.cn|\.force\.mil|\.visualforce\.mil|\.crmforce\.mil)/gi;

    const searchUrls = (obj, path = "") => {
      if (typeof obj === "string") {
        const matches = obj.match(urlPattern);
        if (matches) {
          matches.forEach(url => urls.push(`${path}: ${url}`));
        }
      } else if (typeof obj === "object" && obj !== null) {
        for (const key in obj) {
          if (key === "xmlns") continue;
          searchUrls(obj[key], path ? `${path}.${key}` : key);
        }
      }
    };

    searchUrls(metadata);
    return urls;
  }

  findMissingFaultPaths(metadata) {
    const missingFaults = [];

    const checkFaultPaths = (nodes) => {
      nodes.forEach(element => {
        if (!element.faultConnector) {
          missingFaults.push(element.name || element.label || "Unnamed");
        }
      });
    };

    if (metadata.recordLookups) {
      checkFaultPaths(this.normalizeMetadataProperty(metadata.recordLookups));
    }
    if (metadata.recordUpdates) {
      checkFaultPaths(this.normalizeMetadataProperty(metadata.recordUpdates));
    }
    if (metadata.recordCreates) {
      checkFaultPaths(this.normalizeMetadataProperty(metadata.recordCreates));
    }
    if (metadata.recordDeletes) {
      checkFaultPaths(this.normalizeMetadataProperty(metadata.recordDeletes));
    }
    if (metadata.waits) {
      checkFaultPaths(this.normalizeMetadataProperty(metadata.waits));
    }
    if (metadata.actionCalls) {
      checkFaultPaths(this.normalizeMetadataProperty(metadata.actionCalls));
    }
    if (metadata.apexPluginCalls) {
      checkFaultPaths(this.normalizeMetadataProperty(metadata.apexPluginCalls));
    }

    return missingFaults;
  }

  findMissingNullHandlers(metadata) {
    const references = [];
    this.normalizeMetadataProperty(metadata.recordLookups).forEach(element => {
      if (element.assignNullValuesIfNoRecordsFound && element.assignNullValuesIfNoRecordsFound.toLowerCase() === "true") {
        if (element.storeOutputAutomatically === "true") {
          references.push(element.name);
        } else if (element.outputReference) {
          references.push(element.outputReference);
        } else if (element.outputAssignments) {
          this.normalizeMetadataProperty(element.outputAssignments).forEach(assignment => {
            references.push(assignment.assignToReference);
          });
        }
      }
    });
    this.normalizeMetadataProperty(metadata.decisions).forEach(element => {
      this.normalizeMetadataProperty(element.rules).forEach(rule => {
        this.normalizeMetadataProperty(rule.conditions).forEach(condition => {
          if (references.includes(condition.leftValueReference)) {
            if (condition.operator === "IsNull") {
              references.splice(references.indexOf(condition.leftValueReference), 1);
            }
          }
        });
      });
    });
    return references;
  }

  findRecursiveAfterUpdate(metadata) {

    if (metadata.start?.triggerType != "RecordAfterSave" || (
      metadata.start?.recordTriggerType != "Create"
      && metadata.start?.recordTriggerType != "CreateAndUpdate"
      && metadata.start?.recordTriggerType != "Update")) {
      return false;
    }

    // Check if flow triggers on same object it updates
    for (let element of this.normalizeMetadataProperty(metadata.recordUpdates)) {
      if (element.inputReference.includes("$Record")) {
        return true;
      }
    }

    return false;
  }

  findSameFieldUpdates(metadata) {

    let isBeforeSave = metadata.start?.triggerType === "RecordBeforeSave";
    const isQualifiedTriggerTypes = (metadata.start?.recordTriggerType === "Create"
      || metadata.start?.recordTriggerType === "Update"
      || metadata.start?.recordTriggerType === "CreateAndUpdate");

    if (!isBeforeSave || !isQualifiedTriggerTypes) {
      return false;
    }

    const potentialElements = metadata.recordUpdates;
    if (!potentialElements) return false;

    for (const node of this.normalizeMetadataProperty(potentialElements)) {
      if (node.inputReference === "$Record") {
        return true;
      }
    }

    return false;
  }
  traverseConnectorChain(flow, node, processNode, visitedElements = new Set()) {
    if (!node) return;

    // Resolve node if it's a string name or needs resolution
    const actualElement = typeof node === "string"
      ? this.getElementByName(flow, node)
      : node;

    if (!actualElement || !actualElement.name) return;

    // Use element name for visited tracking
    if (visitedElements.has(actualElement.name)) {
      return;
    }
    visitedElements.add(actualElement.name);

    // Process the node
    processNode(actualElement);

    // Traverse all connector types
    this.normalizeMetadataProperty(actualElement.connector).forEach(conn => {
      const resolvedNode = this.resolveConnector(flow, conn);
      if (resolvedNode) {
        this.traverseConnectorChain(flow, resolvedNode, processNode, visitedElements);
      }
    });
    this.normalizeMetadataProperty(actualElement.faultConnector).forEach(faultConn => {
      const resolvedNode = this.resolveConnector(flow, faultConn);
      if (resolvedNode) {
        this.traverseConnectorChain(flow, resolvedNode, processNode, visitedElements);
      }
    });
    this.normalizeMetadataProperty(actualElement.nextValueConnector).forEach(element => {
      const resolvedNode = this.resolveConnector(flow, element);
      if (resolvedNode) {
        this.traverseConnectorChain(flow, resolvedNode, processNode, visitedElements);
      }
    });
    this.normalizeMetadataProperty(actualElement.noMoreValuesConnector).forEach(element => {
      const resolvedNode = this.resolveConnector(flow, element);
      if (resolvedNode) {
        this.traverseConnectorChain(flow, resolvedNode, processNode, visitedElements);
      }
    });
    this.normalizeMetadataProperty(actualElement.defaultConnector).forEach(element => {
      const resolvedNode = this.resolveConnector(flow, element);
      if (resolvedNode) {
        this.traverseConnectorChain(flow, resolvedNode, processNode, visitedElements);
      }
    });
    if (actualElement.rules){
      this.normalizeMetadataProperty(actualElement.rules).forEach(rule => {
        if (rule?.connector?.targetReference){
          const resolvedNode = this.resolveConnector(flow, rule.connector);
          if (resolvedNode) {
            this.traverseConnectorChain(flow, resolvedNode, processNode, visitedElements);
          }
        }
      });
    }
  }

  findUnconnectedElements(flow) {
    const metadata = flow.Metadata;
    const connected = new Set();
    const allElements = [];
    for (let key of Object.keys(metadata)) {
      if (key == "variables" || key == "processMetadataValues" || key == "constants" || key == "formulas" || key == "textTemplates") {
        continue;
      }
      let elements = metadata[key];
      this.normalizeMetadataProperty(elements).forEach(element => {
        if (element.name || element.apiName || element.label) {
          allElements.push(element.name || element.apiName || element.label);
        }
      });
    }

    // Helper function to mark nodes as connected
    const visited = new Set();
    const markConnectedNode = (element) => {
      const elementName = element.name || element.apiName || element.label;
      if (elementName) {
        connected.add(elementName);
      }
    };

    // Traverse from start to mark all connected elements
    if (metadata.start) {
      this.traverseConnectorChain(flow, metadata?.start?.connector?.targetReference, markConnectedNode, visited);
    }

    return allElements.filter(name => !connected.has(name));
  }

  checkUnsafeRunningContext(metadata) {
    // Check if flow runs in system context without proper sharing
    if (metadata.runInMode === "SystemModeWithoutSharing") {
      return true;
    }
    return false;
  }

  findUnusedVariables(metadata) {
    const unusedVariables = [];

    // Get all variables
    const variables = this.normalizeMetadataProperty(metadata.variables || []);
    if (variables.length === 0) {
      return unusedVariables;
    }

    // Get all FlowNode elements (non-variable, non-resource elements)
    const flowNodeKeys = [
      "start", "decisions", "loops", "recordLookups", "recordUpdates", "recordCreates",
      "recordDeletes", "actionCalls", "apexPluginCalls", "screens", "waits", "constants",
      "flows", "subflows", "choices", "formulas", "textTemplates", "stages", "steps"
    ];
    const flowNodes = [];
    flowNodeKeys.forEach(key => {
      const elements = this.normalizeMetadataProperty(metadata[key]);
      flowNodes.push(...elements);
    });

    // Get all FlowResource elements (choices, constants, dynamicChoiceSets, formulas, textTemplates)
    const flowResourceKeys = ["choices", "constants", "dynamicChoiceSets", "formulas", "textTemplates"];
    const flowResources = [];
    flowResourceKeys.forEach(key => {
      const elements = this.normalizeMetadataProperty(metadata[key]);
      flowResources.push(...elements);
    });

    // Get all variables array for searching within variables
    const allVariables = this.normalizeMetadataProperty(metadata.variables || []);

    // Check each variable
    for (const variable of variables) {
      const variableName = variable.name;
      if (!variableName) continue;

      // Search in FlowNode elements (case-insensitive)
      const nodeMatches = [
        ...JSON.stringify(flowNodes).matchAll(new RegExp(variableName, "gi"))
      ].map(a => a.index);

      if (nodeMatches.length > 0) continue; // Variable is used in FlowNodes

      // Search in FlowResource elements (case-insensitive)
      const resourceMatches = [
        ...JSON.stringify(flowResources).matchAll(new RegExp(variableName, "gi"))
      ].map(a => a.index);

      if (resourceMatches.length > 0) continue; // Variable is used in FlowResources

      // Count occurrences in the variable's own definition
      const insideCounter = [
        ...JSON.stringify(variable).matchAll(new RegExp(variable.name, "gi"))
      ].map(a => a.index);

      // Count occurrences in all variable definitions
      const variableUsage = [
        ...JSON.stringify(allVariables).matchAll(new RegExp(variableName, "gi"))
      ].map(a => a.index);

      // If variableUsage equals insideCounter, the variable only appears in its own definition (unused)
      if (variableUsage.length === insideCounter.length) {
        unusedVariables.push(variableName);
      }
    }

    return unusedVariables;
  }

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
        this.error = err.message || "An error occurred";
      })
      .then(() => {
        this.spinnerCount--;
        this.didUpdate();
      })
      .catch(err => console.log("error handling failed", err));
  }
}

let h = React.createElement;

class App extends React.Component {
  render() {
    let {model} = this.props;
    let linkTarget = "_blank";
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 1);
    return (
      h("div", {},
        h("div", {id: "user-info"},
          h("a", {href: model.sfLink, className: "sf-link"},
            h("svg", {viewBox: "0 0 24 24"},
              h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
            ),
            " Salesforce Home"
          ),
          h("h1", {}, "Flow Analyzer"),
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
            h("a", {href: "#", className: "top-btn", id: "help-btn", title: "Export Help", onClick: this.onToggleHelp},
              h("div", {className: "icon"})
            ),
          ),
        ),
        h("div", {className: "area"},
          h("div", {className: "area-header"},
            h("h2", {}, model.title || "Flow Analyzer")
          ),
          model.error ? h("div", {className: "error-message"}, model.error) : null,
          model.analysisResults && model.analysisResults.length > 0 ? h("div", {className: "analysis-results"},
            h("h2", {}, `Analysis Results (${model.analysisResults.length} issue(s) found)`),
            model.analysisResults.map((result, index) =>
              h("div", {key: index, className: `rule-item ${result.severity}`},
                h("div", {className: "rule-title"}, result.rule),
                h("div", {className: "rule-description"}, result.message),
                result.details && result.details.length > 0 ? h("div", {className: "rule-details"},
                  h("ul", {},
                    result.details.map((detail, idx) => h("li", {key: idx}, detail))
                  )
                ) : null
              )
            )
          ) : model.flowMetadata ? h("div", {className: "analysis-results"},
            h("div", {}, "No issues found in this flow.")
          ) : null
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
    let model = new Model({sfHost, args});
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);
    if (parent && parent.isUnitTest) { // for unit tests
      parent.insextTestLoaded({Model, model, sfConn});
    }
  });
}

