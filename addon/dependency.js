/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {PageHeader} from "./page-header.js";
/* global initButton */
import {DescribeInfo} from "./data-load.js";
import {getCacheRaw, setCache} from "./cache.js";

function getFieldValue(record, path) {
  if (path instanceof Array) {
    return path.map(p => getFieldValue(record, p)).filter(v => v != null).join(" - ");
  }
  return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), record);
}

// Escapes a value for a SOQL string literal (backslash first, then quote).
function soqlString(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Escapes a value for a SOQL LIKE pattern, where % and _ are wildcards.
function soqlLike(value) {
  return soqlString(value).replace(/%/g, "\\%").replace(/_/g, "\\_");
}

class Model {
  constructor({sfHost, args}) {
    this.sfHost = sfHost;
    this.spinnerCount = 0;
    this.error = null;
    this.name = args.get("name") || "";
    this.type = args.get("type") || "";
    this.rootKey = null; // Component key of the searched component
    this.dependenciesByType = {}; // Group dependencies by type
    this.expandedTypes = new Set(); // Track which accordion sections are expanded
    this.expandedItems = new Set(); // Path keys of the expanded items (a component can appear at several places)
    this.childDependencies = new Map(); // Component key to its sub dependencies, fetched once per search
    this.loadingItems = new Set(); // Component keys whose sub dependencies are being fetched
    this.flowScanProgress = null; // {done, total} while scanning flowsToRescan for subflow references
    this.metadataTypes = [
      //StandardEntity or User
      {object: "ApexClass", label: "Apex Class", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "apex", display: true},
      {object: "ApexComponent", label: "Visualforce Component", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "page", display: true},
      {object: "ApexPage", label: "Visualforce Page", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "page", display: true},
      {object: "ApexTrigger", label: "Apex Trigger", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "apex", display: true},
      {object: "AuraDefinitionBundle", label: "Lightning Component", idField: "Id", nameField: "DeveloperName", labelField: ["NamespacePrefix", "DeveloperName"], icon: "thunder", display: true},
      {object: "CustomField", label: "Custom Field", idField: "Id", nameField: "DeveloperName", labelField: ["NamespacePrefix", "EntityDefinition.QualifiedApiName", "DeveloperName"], extraField: ["TableEnumOrId"], icon: "picklist", display: true},
      {object: "CustomObject", label: "Custom Object", idField: "Id", nameField: "DeveloperName", labelField: ["NamespacePrefix", "DeveloperName"], icon: "standard_objects", display: true},
      {object: "EmailTemplate", label: "Email Template", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "email", display: true},
      {object: "ExternalString", label: "Custom Label", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "snippet", display: true},
      {object: "FlexiPage", label: "lightning Page", idField: "Id", nameField: "DeveloperName", labelField: ["NamespacePrefix", "DeveloperName"], icon: "page", display: true},
      {object: "Flow", label: "Flow/Process builder", idField: "Id", nameField: "Definition.DeveloperName", labelField: ["Definition.DeveloperName", "ProcessType", "VersionNumber"], filter: "Status = 'Active'", icon: "flow", display: true}, //FlowDefinition
      {object: "Layout", label: "Layout", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "EntityDefinition.QualifiedApiName", "Name"], icon: "layout", display: true},
      {object: "LightningComponentBundle", label: "Lightning Web Component", idField: "Id", nameField: "DeveloperName", labelField: ["NamespacePrefix", "DeveloperName"], icon: "thunder", display: true},
      {object: "QuickActionDefinition", label: "Quick Action", idField: "Id", nameField: "DeveloperName", labelField: ["NamespacePrefix", "EntityDefinition.QualifiedApiName", "DeveloperName"], extraField: ["EntityDefinitionId"], icon: "magicwand", display: true},
      {object: "ValidationRule", label: "Validation Rule", idField: "Id", nameField: "ValidationName", labelField: ["NamespacePrefix", "ValidationName"], icon: "shield", display: true},
      {object: "WebLink", label: "Web Link", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "EntityDefinition.QualifiedApiName", "Name"], icon: "link", display: true},
      {object: "WorkflowAlert", label: "Workflow Alert", idField: "Id", nameField: "DeveloperName", labelField: ["NamespacePrefix", "EntityDefinition.QualifiedApiName", "DeveloperName"], icon: "notification", display: true},
      {object: "WorkflowRule", label: "Workflow Rule", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "process", display: true},

      // Additional types with display: false
      {object: "CustomMetadata", label: "Custom Metadata", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "DeveloperName"], icon: "database", display: false},
      {object: "Dashboard", label: "Dashboard", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "DeveloperName"], icon: "chart", display: false},
      {object: "FlowDefinition", label: "Flow Definition", idField: "Id", nameField: "Definition.DeveloperName", labelField: ["ProcessType", "Definition.DeveloperName", "VersionNumber"], filter: "Status = 'Active'", icon: "flow", display: false},
      {object: "PermissionSet", label: "Permission Set", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "shield", display: false},
      {object: "Profile", label: "Profile", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "user_role", display: false},
      {object: "Report", label: "Report", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "DeveloperName"], icon: "chart", display: false},
      {object: "StandardEntity", label: "Standard Entity", idField: "Id", nameField: "Name", labelField: ["Name"], icon: "standard_objects", display: false}
    ];

    // Map metadata types to Tooling API object and field names for querying
    this.typeToObjectMap = new Map(this.metadataTypes.map(mtype => [mtype.object, mtype]));

    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.didUpdate();
    });

    // Component name suggestions cache
    this.componentNameSuggestions = [];
    this.componentNameSuggestionsLoading = false;

    // If both name and type are provided in URL, fetch dependencies automatically
    if (this.name && this.type) {
      this.fetchDependencies(this.type, this.name, args.get("direction") === "parent" ? "parent" : "child");
    }
  }

  async fetchComponentNames(type, searchTerm = "") {
    const typeMap = this.typeToObjectMap.get(type);
    if (!typeMap) {
      return [];
    }

    try {
      this.componentNameSuggestionsLoading = true;
      this.didUpdate();

      const labelFields = typeMap.labelField instanceof Array ? typeMap.labelField : [typeMap.labelField];
      const selectFields = Array.from(new Set([typeMap.nameField, ...labelFields]));
      let query = `SELECT ${selectFields.join(",")} FROM ${typeMap.object}`;
      const conditions = [];
      if (typeMap.filter) {
        conditions.push(typeMap.filter);
      }
      if (searchTerm) {
        conditions.push(`${typeMap.nameField} LIKE '%${soqlLike(searchTerm)}%'`);
      }
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }
      query += ` ORDER BY ${typeMap.nameField} LIMIT 100`;

      const result = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {method: "GET"});
      this.componentNameSuggestions = (result.records || []).map(rec => ({
        value: getFieldValue(rec, typeMap.nameField),
        label: getFieldValue(rec, typeMap.labelField) || getFieldValue(rec, typeMap.nameField)
      }));
      this.componentNameSuggestionsLoading = false;
      this.didUpdate();
      return this.componentNameSuggestions;
    } catch (err) {
      console.error("Error fetching component names:", err);
      this.componentNameSuggestionsLoading = false;
      this.didUpdate();
      return [];
    }
  }

  async getComponentId(type, name) {
    const typeMap = this.typeToObjectMap.get(type);
    if (!typeMap) {
      throw new Error("Unknown metadata type: " + type);
    }

    const conditions = [`${typeMap.nameField} = '${soqlString(name)}'`];
    if (typeMap.filter) {
      conditions.push(typeMap.filter);
    }
    const query = `SELECT Id FROM ${typeMap.object} WHERE ${conditions.join(" AND ")} LIMIT 1`;

    try {
      const result = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {method: "GET"});
      if (result.records && result.records.length > 0) {
        return result.records[0].Id;
      }
      return null;
    } catch (err) {
      console.error("Error querying component ID:", err);
      return null;
    }
  }

  // Names of the flows a flow calls: Subflow elements, Action elements calling a flow
  // (actionCalls with actionType "flow", the usual way to call an autolaunched flow) and
  // screen actions calling a flow. MetadataComponentDependency reports none of these reliably.
  static getCalledFlowNames(metadata) {
    if (!metadata) {
      return [];
    }
    const names = new Set();
    (metadata.subflows || []).forEach(sf => sf.flowName && names.add(sf.flowName));
    const addFlowActions = actions => (actions || []).forEach(action => {
      if (action.actionType === "flow" && action.actionName) {
        names.add(action.actionName);
      }
    });
    addFlowActions(metadata.actionCalls);
    (metadata.screens || []).forEach(screen => addFlowActions(screen.actions));
    return Array.from(names);
  }

  // Precomputes "flow X calls flow Y" dependency records for every active flow, so that
  // finding who calls a given flow is a simple filter by id instead of a per-search scan.
  // The flow metadata only gives the called flow's name, not its id, hence the name->id map
  // (built from a cheap full listing query, always refreshed). Fetching each flow's Metadata
  // to look for flow calls is the expensive part (one Tooling API query per flow), so that
  // part stays incremental: only flows created/modified since the last sync are re-scanned.
  async getFlowSubflowRecords() {
    // Bump the version whenever getCalledFlowNames changes, so that flows already scanned are scanned again.
    const cacheKey = "flowSubflowRecords_v2_" + sfConn.instanceHostname;
    const cached = await getCacheRaw(cacheKey);
    let lastSyncDate = cached ? cached.lastSyncDate : null;
    const recordsByCallerId = new Map(cached ? cached.flowRecords.reduce((acc, rec) => {
      if (!acc.has(rec.MetadataComponentId)) {
        acc.set(rec.MetadataComponentId, []);
      }
      acc.get(rec.MetadataComponentId).push(rec);
      return acc;
    }, new Map()) : []);

    // Cheap (no Metadata field), always fetched in full so the name->id map stays complete and correct.
    const listQuery = "SELECT Id,Definition.DeveloperName,LastModifiedDate FROM Flow WHERE Status = 'Active'";
    const resFlows = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(listQuery), {method: "GET"});
    for (let page = resFlows; !page.done && page.nextRecordsUrl;) {
      page = await sfConn.rest(page.nextRecordsUrl, {method: "GET"});
      resFlows.records.push(...page.records);
    }

    const flowNameToId = new Map(resFlows.records.map(f => [f.Definition.DeveloperName, f.Id]));
    const activeIds = new Set(resFlows.records.map(f => f.Id));
    let maxLastModified = lastSyncDate;
    const flowsToRescan = [];
    for (const flow of resFlows.records) {
      if (!maxLastModified || flow.LastModifiedDate > maxLastModified) {
        maxLastModified = flow.LastModifiedDate;
      }
      if (!lastSyncDate || flow.LastModifiedDate > lastSyncDate) {
        flowsToRescan.push(flow);
      }
    }
    // Flows that are no longer active can no longer call anything.
    for (const callerId of Array.from(recordsByCallerId.keys())) {
      if (!activeIds.has(callerId)) {
        recordsByCallerId.delete(callerId);
      }
    }

    if (flowsToRescan.length > 0) {
      this.flowScanProgress = {done: 0, total: flowsToRescan.length};
      this.didUpdate();
    }
    // A flow whose Metadata cannot be read must not stop the scan; it is only skipped, and the
    // sync date is not moved forward so that it is scanned again next time.
    let scanFailed = false;
    for (const flow of flowsToRescan) {
      let flowRes;
      try {
        flowRes = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent("SELECT Id,Definition.DeveloperName,Metadata FROM Flow WHERE Id='" + flow.Id + "'"), {method: "GET"});
      } catch (err) {
        console.error("Error reading flow metadata " + flow.Id + ":", err);
        scanFailed = true;
        flowRes = {records: []};
      }
      flowRes.records.forEach(flowDetail => {
        const records = Model.getCalledFlowNames(flowDetail.Metadata).map(flowName => {
          const refId = flowNameToId.get(flowName);
          if (!refId) {
            return null; // referenced flow is not currently active/known - nothing to filter on
          }
          return {
            attributes: {
              type: "MetadataComponentDependency",
              url: "/services/data/v" + apiVersion + "/tooling/sobjects/MetadataComponentDependency/000000000000000AAA"
            },
            MetadataComponentId: flowDetail.Id,
            MetadataComponentName: flowDetail.Definition.DeveloperName,
            MetadataComponentType: "Flow",
            RefMetadataComponentId: refId,
            RefMetadataComponentName: flowName,
            RefMetadataComponentType: "Flow"
          };
        }).filter(Boolean);
        if (records.length > 0) {
          recordsByCallerId.set(flowDetail.Id, records);
        } else {
          recordsByCallerId.delete(flowDetail.Id);
        }
      });
      if (this.flowScanProgress) {
        this.flowScanProgress.done++;
      }
      this.didUpdate();
    }
    this.flowScanProgress = null;

    const flowRecords = Array.from(recordsByCallerId.values()).flat();
    await setCache(cacheKey, {lastSyncDate: scanFailed ? lastSyncDate : maxLastModified, flowRecords});
    return flowRecords;
  }

  // The flow call records are computed once per search and reused when expanding items,
  // since getFlowSubflowRecords always runs a full listing query of the active flows.
  getFlowSubflowRecordsCached() {
    if (!this.flowSubflowRecordsPromise) {
      this.flowSubflowRecordsPromise = this.getFlowSubflowRecords().catch(err => {
        this.flowSubflowRecordsPromise = null;
        throw err;
      });
    }
    return this.flowSubflowRecordsPromise;
  }

  // Dependencies of a component in the given direction, normalized so that MetadataComponent*
  // is always the component to display and RefMetadataComponent* the one we searched from.
  // direction "parent": components that reference this one (RefMetadataComponentId = id)
  // direction "child": components that this one references (MetadataComponentId = id)
  async queryDependencies(componentId, type, direction) {
    const filterField = direction === "parent" ? "RefMetadataComponentId" : "MetadataComponentId";
    const query = `SELECT MetadataComponentId,MetadataComponentName,MetadataComponentType,RefMetadataComponentName,RefMetadataComponentType,RefMetadataComponentId FROM MetadataComponentDependency WHERE ${filterField} = '${soqlString(componentId)}'`;
    const res = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {method: "GET"});
    let records = res.records || [];

    // Flow calls between flows are not reliably reported by MetadataComponentDependency
    if (type === "Flow" || type === "FlowDefinition") {
      const flowRecords = await this.getFlowSubflowRecordsCached();
      records = records.concat(flowRecords.filter(rec => rec[filterField] === componentId));
    }

    const deps = direction === "parent" ? records : records.map(rec => ({
      ...rec,
      MetadataComponentId: rec.RefMetadataComponentId,
      MetadataComponentName: rec.RefMetadataComponentName,
      MetadataComponentType: rec.RefMetadataComponentType,
      RefMetadataComponentId: rec.MetadataComponentId,
      RefMetadataComponentName: rec.MetadataComponentName,
      RefMetadataComponentType: rec.MetadataComponentType
    }));
    // A flow call may be reported both by MetadataComponentDependency and by the flow scan
    const seen = new Set();
    return deps.filter(dep => {
      const key = `${dep.MetadataComponentType}:${dep.MetadataComponentId || dep.MetadataComponentName}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async fetchDependenciesInternal(type, name, dependencyType = "child") {
    if (!type || !name) {
      this.error = "Please select both Type and enter Name";
      this.didUpdate();
      return;
    }

    this.error = null;
    this.direction = dependencyType;
    this.rootKey = Model.componentKey(type, name);
    this.dependenciesByType = {};
    this.expandedItems.clear();
    this.childDependencies.clear();
    this.loadingItems.clear();
    this.flowSubflowRecordsPromise = null;

    try {
      const componentId = await this.getComponentId(type, name);
      if (!componentId) {
        this.error = `Component not found: ${type} with name ${name}`;
        this.didUpdate();
        return;
      }

      const deps = await this.queryDependencies(componentId, type, dependencyType);
      deps.forEach(dep => {
        const depType = dep.MetadataComponentType || "Unknown";
        if (!this.dependenciesByType[depType]) {
          this.dependenciesByType[depType] = [];
        }
        this.dependenciesByType[depType].push(dep);
      });
      // Enrich dependencies with additional information (e.g., objectName for CustomField)
      await this.enrichDependencies(deps);
      this.didUpdate();
    } catch (err) {
      console.error("Error fetching dependencies:", err);
      this.error = "Error fetching dependencies: " + (err.message || JSON.stringify(err));
      this.didUpdate();
    }
  }

  fetchDependencies(type, name, dependencyType = "child") {
    this.spinFor(this.fetchDependenciesInternal(type, name, dependencyType));
  }

  setType(type) {
    this.type = type;
    this.componentNameSuggestions = []; // suggestions of the previous type
    this.didUpdate();
  }

  setName(name) {
    this.name = name;
    this.didUpdate();
  }

  toggleTypeExpanded(type) {
    if (this.expandedTypes.has(type)) {
      this.expandedTypes.delete(type);
    } else {
      this.expandedTypes.add(type);
    }
    this.didUpdate();
  }

  toggleItemExpanded(itemKey) {
    if (this.expandedItems.has(itemKey)) {
      this.expandedItems.delete(itemKey);
    } else {
      this.expandedItems.add(itemKey);
    }
    this.didUpdate();
  }

  // Expands an item in the same direction as the search: up to the components using it
  // after a parent search, down to the components it uses after a child search.
  // The sub dependencies are cached by component (componentKey), the expansion is tracked by
  // position in the tree (pathKey), so the same component can be expanded at several places.
  async fetchSubDependencies(pathKey, dependency) {
    const componentType = dependency.MetadataComponentType;
    const componentKey = Model.componentKey(componentType, dependency.MetadataComponentName);
    if (this.childDependencies.has(componentKey)) {
      this.toggleItemExpanded(pathKey);
      return;
    }
    if (this.loadingItems.has(componentKey)) {
      return; // a click while fetching must not toggle twice
    }

    this.loadingItems.add(componentKey);
    this.didUpdate();
    try {
      let componentId = dependency.MetadataComponentId;
      // The flow scan records use the id of the active version
      if (componentType === "Flow" || componentType === "FlowDefinition") {
        componentId = (await this.getComponentId(componentType, dependency.MetadataComponentName)) || componentId;
      }
      const subDeps = componentId ? await this.queryDependencies(componentId, componentType, this.direction || "child") : [];
      await this.enrichDependencies(subDeps);
      this.childDependencies.set(componentKey, subDeps);
      this.expandedItems.add(pathKey);
    } catch (err) {
      console.error("Error fetching sub dependencies:", err);
      this.error = "Error fetching dependencies of " + dependency.MetadataComponentName + ": " + (err.message || JSON.stringify(err));
    } finally {
      this.loadingItems.delete(componentKey);
      this.didUpdate();
    }
  }

  // Name shown in the results and used in package.xml. A custom field is given as Object.Field__c
  // (the dependency only gives the field developer name, the object comes from enrichDependencies).
  static getDisplayName(dep) {
    const name = dep.MetadataComponentName;
    if (dep.MetadataComponentType === "CustomField" && name && !name.includes(".") && dep.objectName) {
      return `${dep.objectName}.${name}${name.endsWith("__c") ? "" : "__c"}`;
    }
    return name;
  }

  static componentKey(type, name) {
    return `${type}:${name}`;
  }
  async enrichDependencies(dependencies) {
    if (!dependencies || dependencies.length === 0) {
      return;
    }

    // Only the displayed component (MetadataComponent*) needs its object name, for its link and package.xml
    const fieldDeps = dependencies.filter(dep => !dep.objectName && dep.MetadataComponentType === "CustomField" && dep.MetadataComponentId);
    if (fieldDeps.length === 0) {
      return;
    }
    const fieldIds = Array.from(new Set(fieldDeps.map(dep => dep.MetadataComponentId)));
    const query = `SELECT Id, TableEnumOrId FROM CustomField WHERE Id IN ('${fieldIds.map(soqlString).join("','")}')`;

    try {
      const result = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {method: "GET"});
      // TableEnumOrId is the API name of a standard object (e.g. "Account") or the 01I id of a custom object
      const fieldIdToTable = new Map((result.records || []).filter(f => f.TableEnumOrId).map(f => [f.Id.substring(0, 15), f.TableEnumOrId]));
      const isId = value => /^01I[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?$/.test(value);

      // Custom objects: the 01I id is the DurableId of EntityDefinition
      const objectIdToName = new Map();
      const objectIds = Array.from(new Set(Array.from(fieldIdToTable.values()).filter(isId)));
      if (objectIds.length > 0) {
        const sobjectQuery = `SELECT DurableId, QualifiedApiName FROM EntityDefinition WHERE DurableId IN ('${objectIds.map(soqlString).join("','")}')`;
        const sobjectResult = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(sobjectQuery), {method: "GET"});
        (sobjectResult.records || []).forEach(sobject => {
          objectIdToName.set(sobject.DurableId.substring(0, 15), sobject.QualifiedApiName);
        });
      }

      fieldDeps.forEach(dep => {
        const table = fieldIdToTable.get(dep.MetadataComponentId.substring(0, 15));
        if (table) {
          dep.objectName = isId(table) ? objectIdToName.get(table.substring(0, 15)) : table;
        }
      });
    } catch (err) {
      console.error("Error enriching dependencies:", err);
    }
  }
  // Generate package.xml from dependencies
  generatePackageXml() {
    const dependencies = [];

    // Collect all unique dependencies by type
    Object.keys(this.dependenciesByType).forEach(type => {
      if (type === "Unknown") {
        return; // not a metadata type, would make the package invalid
      }
      const deps = this.dependenciesByType[type];
      const uniqueNames = new Set();

      deps.forEach(dep => {
        let name = dep.MetadataComponentName;
        if (!name) {
          return;
        }
        uniqueNames.add(Model.getDisplayName(dep));
      });

      if (uniqueNames.size > 0) {
        dependencies.push({
          type,
          members: Array.from(uniqueNames).sort()
        });
      }
    });

    if (dependencies.length === 0) {
      return null;
    }

    // Generate package.xml
    let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    xml += "<Package xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n";

    dependencies.forEach(dep => {
      xml += "  <types>\n";
      dep.members.forEach(member => {
        xml += `    <members>${this._escapeXml(member)}</members>\n`;
      });
      xml += `    <name>${this._escapeXml(dep.type)}</name>\n`;
      xml += "  </types>\n";
    });

    xml += `  <version>${apiVersion}</version>\n`;
    xml += "</Package>";

    return xml;
  }

  // Escape XML special characters
  _escapeXml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  // Export package.xml as file
  exportPackageXml() {
    const xml = this.generatePackageXml();
    if (!xml) {
      this.error = "No dependencies to export";
      this.didUpdate();
      return;
    }

    const blob = new Blob([xml], {type: "application/xml"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "package.xml";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  getComponentLink(dependency) {
    let componentId = dependency.MetadataComponentId;
    let componentType = dependency.MetadataComponentType;

    switch (componentType) {
      case "ApexClass":
        return `https://${this.sfHost}/lightning/setup/ApexClasses/page?address=%2F${componentId}`;
      case "ApexTrigger":
        return `https://${this.sfHost}/lightning/setup/ApexTriggers/page?address=%2F${componentId}`;
      case "Flow":
      case "FlowDefinition":
        return `https://${this.sfHost}/lightning/setup/Flows/page?address=%2F${componentId}`;
      case "ApexPage":
        return `https://${this.sfHost}/lightning/setup/VisualforcePages/page?address=%2F${componentId}`;
      case "ApexComponent":
        return `https://${this.sfHost}/lightning/setup/VisualforceComponents/page?address=%2F${componentId}`;
      case "StaticResource":
        return `https://${this.sfHost}/lightning/setup/StaticResources/page?address=%2F${componentId}`;
      case "LightningComponent":
        return `https://${this.sfHost}/lightning/setup/LightningComponents/page?address=%2F${componentId}`;
      case "CustomLabel":
        return `https://${this.sfHost}/lightning/setup/CustomLabels/page?address=%2F${componentId}`;
      case "LightningWebComponent":
      case "LightningComponentBundle":
        return `https://${this.sfHost}/lightning/setup/LightningWebComponents/page?address=%2F${componentId}`;
      case "EmailTemplate":
        return `https://${this.sfHost}/lightning/setup/EmailTemplates/page?address=%2F${componentId}`;
      case "WorkflowAlert":
        return `https://${this.sfHost}/lightning/setup/WorkflowAlerts/page?address=%2F${componentId}`;
      // ValidationRule, WebLink and Layout: Object Manager URLs need the object, which the
      // dependency does not give, so they use the id URL (default) that Salesforce redirects.
      case "FlexiPage":
        return `https://${this.sfHost}/lightning/setup/FlexiPages/page?address=%2F${componentId}`;
      case "CustomObject":
        return `https://${this.sfHost}/lightning/setup/ObjectManager/${componentId}/Details/view`;
      case "CustomField":
        if (dependency.objectName) {
          return `https://${this.sfHost}/lightning/setup/ObjectManager/${dependency.objectName}/FieldsAndRelationships/${componentId}/view`;
        }
        return `https://${this.sfHost}/${componentId}`;
      default:
        // Use API URL as fallback
        return `https://${this.sfHost}/${componentId}`;
    }
  }

  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
    }
    if (this.testCallback) {
      this.testCallback();
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
  recalculateSize() {
    // No longer needed without table view
  }
}

let h = React.createElement;

class DependencyItem extends React.Component {
  constructor(props) {
    super(props);
    this.onExpandClick = this.onExpandClick.bind(this);
  }

  getKeys() {
    const {dependency, ancestors = []} = this.props;
    const componentKey = Model.componentKey(dependency.MetadataComponentType, dependency.MetadataComponentName);
    return {componentKey, pathKey: [...ancestors, componentKey].join("/")};
  }

  onExpandClick(e) {
    e.stopPropagation();
    const {model, dependency} = this.props;
    model.fetchSubDependencies(this.getKeys().pathKey, dependency);
  }

  render() {
    const {model, dependency, ancestors = []} = this.props;
    const {componentKey, pathKey} = this.getKeys();
    // Expanding a component already shown above it (dependency cycle) would only repeat the tree
    const isCycle = componentKey === model.rootKey || ancestors.includes(componentKey);
    const isLoading = model.loadingItems.has(componentKey);
    const isExpanded = model.expandedItems.has(pathKey);
    const typeInfo = model.typeToObjectMap.get(dependency.MetadataComponentType);
    const iconName = typeInfo?.icon || "fallback";
    const link = model.getComponentLink(dependency);
    const children = model.childDependencies.get(componentKey) || [];
    const fetched = model.childDependencies.has(componentKey);

    const {isSubdependency = false} = this.props;
    const itemStyle = {
      border: "1px solid #DDDBDA",
      borderRadius: "0.25rem",
      padding: "0.5rem",
      marginBottom: "0.25rem",
      backgroundColor: isSubdependency ? "#F3F2F2" : "#FFFFFF"
    };
    const childrenStyle = {
      marginLeft: "2rem",
      marginTop: "0.5rem"
    };

    return h("div", {className: "dependency-item" + (isSubdependency ? " dependency-sub" : "")},
      h("div", {
        className: "dependency-item-content slds-grid slds-grid_vertical-align-center" + (isSubdependency ? " dependency-sub-content" : ""),
        style: itemStyle
      },
      h("button", {
        className: "slds-button slds-button_icon slds-m-right_x-small slds-button_icon-small",
        disabled: !dependency.MetadataComponentId || isLoading,
        onClick: this.onExpandClick,
        hidden: !dependency.MetadataComponentId || isCycle,
        title: model.direction === "parent" ? "Show the components using it" : "Show the components it uses"
      },
      h("svg", {
        className: "slds-button__icon slds-button__icon_small",
        "aria-hidden": "true",
        viewBox: "0 0 52 52"
      },
      h("use", {
        xlinkHref: isExpanded ? "symbols.svg#chevrondown" : "symbols.svg#chevronright"
      })
      )
      ),
      h("div", {className: "slds-icon_container slds-m-right_x-small"},
        h("svg", {className: "slds-icon slds-icon_x-small slds-icon-text-default", viewBox: "0 0 52 52"},
          h("use", {xlinkHref: `symbols.svg#${iconName}`})
        )
      ),
      h("div", {className: "slds-grid slds-grid_align-spread slds-flex-grow"},
        h("div", {},
          h("a", {
            href: link,
            target: "_blank",
            className: "slds-truncate",
            title: Model.getDisplayName(dependency)
          }, Model.getDisplayName(dependency)),
          h("span", {className: "slds-text-body_small slds-m-left_small slds-text-color_weak"},
            dependency.MetadataComponentType
          ),
          isCycle && h("span", {className: "slds-text-body_small slds-m-left_small slds-text-color_weak"}, "(cyclic dependency)"),
          isLoading && h("span", {className: "slds-text-body_small slds-m-left_small slds-text-color_weak"}, "Loading...")
        )
      )
      ),
      isExpanded && fetched && h("div", {
        className: "dependency-children",
        style: childrenStyle
      },
      children.length > 0
        ? children.map((childDep, idx) =>
          h(DependencyItem, {
            key: `${pathKey}-${idx}`,
            model,
            dependency: childDep,
            ancestors: [...ancestors, componentKey],
            isSubdependency: true
          })
        )
        : h("p", {className: "slds-text-body_small slds-text-color_weak"}, "No dependencies found")
      )
    );
  }
}

// Visible loading state in the results area: the header spinner alone is easy to miss,
// and the first flow scan can take a while (one Tooling API query per active flow).
function DependencyLoading({model}) {
  const progress = model.flowScanProgress;
  const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : null;
  return h("div", {className: "slds-p-around_large", role: "status", style: {textAlign: "center"}},
    h("div", {style: {position: "relative", height: "2rem", marginBottom: "0.75rem"}},
      h("div", {className: "slds-spinner slds-spinner_small slds-spinner_brand"},
        h("div", {className: "slds-spinner__dot-a"}),
        h("div", {className: "slds-spinner__dot-b"})
      )
    ),
    percent == null
      ? h("p", {}, "Searching dependencies...")
      : h("div", {style: {maxWidth: "30rem", margin: "0 auto"}},
        h("p", {}, `Scanning flows for calls to other flows: ${percent}% (${progress.done}/${progress.total} flows)`),
        h("div", {
          role: "progressbar",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": percent,
          style: {height: "0.5rem", marginTop: "0.5rem", borderRadius: "0.25rem", backgroundColor: "#DDDBDA", overflow: "hidden"}
        },
        h("div", {style: {width: percent + "%", height: "100%", backgroundColor: "#0176D3", transition: "width 0.2s"}})
        ),
        h("p", {className: "slds-text-body_small slds-text-color_weak", style: {marginTop: "0.5rem"}},
          "Only the first scan is long: next searches only rescan flows modified since.")
      )
  );
}

class DependencyAccordion extends React.Component {
  constructor(props) {
    super(props);
    this.onToggleType = this.onToggleType.bind(this);
  }

  onToggleType(type) {
    this.props.model.toggleTypeExpanded(type);
  }

  render() {
    const {model} = this.props;
    const types = Object.keys(model.dependenciesByType).sort();

    if (model.spinnerCount > 0) {
      return h(DependencyLoading, {model});
    }

    if (types.length === 0) {
      if (model.error) {
        return null; // the error is already shown, "No dependencies found" would be misleading
      }
      return h("div", {className: "slds-text-align_center slds-p-around_large"},
        h("p", {}, "No dependencies found")
      );
    }

    // Helper function to generate color from type hash
    const getTypeColor = (type) => {
      if (!type) return "#808080";
      let hash = 0;
      for (let i = 0; i < type.length; i++) {
        hash = type.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash % 360);
      const saturation = 50 + (Math.abs(hash) % 30);
      const lightness = 45 + (Math.abs(hash) % 15);
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    };

    return h("div", {className: "slds-accordion"},
      types.map(type => {
        const dependencies = model.dependenciesByType[type];
        const isExpanded = model.expandedTypes.has(type);
        const typeInfo = model.typeToObjectMap.get(type);
        const iconName = typeInfo?.icon || "fallback";
        const count = dependencies.length;
        const badgeColor = getTypeColor(type);

        return h("div", {key: type, className: "slds-accordion__list-item"},
          h("div", {
            className: "slds-accordion__summary slds-grid slds-grid_vertical-align-center",
            style: {
              border: "1px solid #DDDBDA",
              borderRadius: "0.25rem",
              padding: "0.5rem",
              marginBottom: "0.25rem",
              backgroundColor: "#FFFFFF",
              cursor: "pointer"
            }
          },
          h("button", {
            className: "slds-button slds-button_icon slds-button_icon-small slds-m-right_x-small",
            onClick: (e) => {
              e.stopPropagation();
              this.onToggleType(type);
            },
            style: {flexShrink: 0}
          },
          h("svg", {
            className: "slds-button__icon slds-button__icon_small",
            "aria-hidden": "true",
            viewBox: "0 0 52 52"
          },
          h("use", {
            xlinkHref: isExpanded ? "symbols.svg#chevrondown" : "symbols.svg#chevronright"
          })
          )
          ),
          h("div", {className: "slds-icon_container slds-m-right_x-small", style: {flexShrink: 0}},
            h("svg", {className: "slds-icon slds-icon_x-small slds-icon-text-default", viewBox: "0 0 52 52"},
              h("use", {xlinkHref: `symbols.svg#${iconName}`})
            )
          ),
          h("div", {className: "slds-grid slds-grid_align-spread slds-flex-grow"},
            h("h3", {className: "slds-accordion__summary-heading slds-truncate", style: {margin: 0}},
              h("span", {className: "slds-truncate"}, type)
            ),
            h("span", {
              className: "slds-badge",
              style: {
                backgroundColor: badgeColor,
                color: "#fff",
                marginLeft: "0.5rem",
                flexShrink: 0
              }
            }, count)
          )
          ),
          isExpanded && h("div", {className: "slds-accordion__details", style: {marginTop: "0.5rem"}},
            h("div", {className: "slds-tree_container slds-p-around_small"},
              dependencies.map((dep, idx) =>
                h(DependencyItem, {key: `${type}-${idx}`, model, dependency: dep})
              )
            )
          )
        );
      })
    );
  }
}

class ComponentNameAutocomplete extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      activeSuggestion: 0,
      filteredSuggestions: [],
      showSuggestions: false,
      searchTerm: ""
    };
    this.onChange = this.onChange.bind(this);
    this.onSuggestionClick = this.onSuggestionClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onFocus = this.onFocus.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.latestRequestId = 0;
  }

  componentDidUpdate() {
  }

  onFocus() {
    const {model, type} = this.props;
    if (!type) return;

    // Show whatever we already have immediately, then refresh once the fetch resolves.
    const staleFiltered = model.componentNameSuggestions.filter(suggestion =>
      !this.state.searchTerm || suggestion.label.toLowerCase().includes(this.state.searchTerm.toLowerCase())
    );
    this.setState({
      activeSuggestion: 0,
      filteredSuggestions: staleFiltered,
      showSuggestions: true
    });

    const requestId = ++this.latestRequestId;
    const searchTerm = model.name || "";
    model.fetchComponentNames(type, searchTerm).then(suggestions => {
      if (requestId !== this.latestRequestId) return; // a newer request superseded this one
      const filteredSuggestions = suggestions.filter(suggestion =>
        !searchTerm || suggestion.label.toLowerCase().includes(searchTerm.toLowerCase())
      );
      this.setState({
        activeSuggestion: 0,
        filteredSuggestions,
        showSuggestions: true
      });
    });
  }

  onBlur(e) {
    const dropdownContainer = e.currentTarget.parentElement?.parentElement?.parentElement;
    if (dropdownContainer && dropdownContainer.contains(e.relatedTarget)) {
      return;
    }
    setTimeout(() => {
      this.setState({
        activeSuggestion: 0,
        filteredSuggestions: [],
        showSuggestions: false,
        searchTerm: ""
      });
    }, 100);
  }

  onChange(e) {
    const {model, type} = this.props;
    const userInput = e.target.value;

    if (!type) {
      this.props.onChange(e);
      return;
    }

    // Update the model's name
    this.props.onChange(e);

    // Show whatever we already have immediately, then refresh once the fetch resolves.
    const staleFiltered = model.componentNameSuggestions.filter(suggestion =>
      suggestion.label.toLowerCase().includes(userInput.toLowerCase())
    );
    this.setState({
      activeSuggestion: 0,
      filteredSuggestions: staleFiltered,
      showSuggestions: true,
      searchTerm: userInput
    });

    const requestId = ++this.latestRequestId;
    model.fetchComponentNames(type, userInput).then(suggestions => {
      if (requestId !== this.latestRequestId) return; // a newer request superseded this one
      const filteredSuggestions = suggestions.filter(suggestion =>
        suggestion.label.toLowerCase().includes(userInput.toLowerCase())
      );
      this.setState({
        activeSuggestion: 0,
        filteredSuggestions,
        showSuggestions: true
      });
    });
  }

  onSuggestionClick(e, index) {
    if (e.target.tagName === "BUTTON" || e.target.tagName === "USE") {
      return;
    }
    const {filteredSuggestions} = this.state;
    const selected = filteredSuggestions[index];
    if (selected) {
      this.props.model.setName(selected.value);
      this.setState({
        activeSuggestion: 0,
        filteredSuggestions: [],
        showSuggestions: false,
        searchTerm: ""
      });
    }
  }

  onKeyDown(e) {
    const {activeSuggestion, filteredSuggestions} = this.state;
    switch (e.keyCode) {
      case 40: // Arrow down
        if (activeSuggestion < filteredSuggestions.length - 1) {
          this.setState({activeSuggestion: activeSuggestion + 1});
        }
        break;
      case 38: // Arrow up
        if (activeSuggestion > 0) {
          this.setState({activeSuggestion: activeSuggestion - 1});
        }
        break;
      case 13: // Enter
        if (filteredSuggestions[activeSuggestion]) {
          this.props.model.setName(filteredSuggestions[activeSuggestion].value);
          this.setState({
            activeSuggestion: 0,
            showSuggestions: false,
            searchTerm: ""
          });
        }
        break;
      case 27: // Escape
        this.setState({
          activeSuggestion: 0,
          filteredSuggestions: [],
          showSuggestions: false,
          searchTerm: ""
        });
        break;
    }
  }

  render() {
    const {type, name, disabled} = this.props;
    const {activeSuggestion, filteredSuggestions, showSuggestions} = this.state;
    const hasSuggestions = type && filteredSuggestions.length > 0;

    return h("div", {className: "slds-form-element slds-nowrap", style: {position: "relative"}},
      h("div", {className: "slds-form-element__control"},
        h("div", {className: "slds-combobox_container"},
          h("div", {className: "slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click" + (showSuggestions ? " slds-is-open" : "")},
            h("div", {className: "slds-combobox__form-element slds-input-has-icon slds-input-has-icon_right", role: "none"},
              h("input", {
                type: "search",
                className: "slds-input slds-combobox__input" + (showSuggestions ? " slds-has-focus" : ""),
                placeholder: "Component Name",
                value: name || "",
                onChange: this.onChange,
                onFocus: this.onFocus,
                onBlur: this.onBlur,
                onKeyDown: this.onKeyDown,
                disabled: disabled || !type,
                "aria-autocomplete": "list",
                "aria-controls": "component-name-listbox",
                "aria-expanded": (showSuggestions ? "true" : "false"),
                autoComplete: "off"
              }),
              h("span", {className: "slds-icon_container slds-icon-utility-search slds-input__icon slds-input__icon_right"},
                h("svg", {className: "slds-icon slds-icon_x-small slds-icon-text-default", "aria-hidden": "true"},
                  h("use", {xlinkHref: "symbols.svg#search"})
                )
              )
            ),
            (showSuggestions && hasSuggestions)
              ? h("div", {
                id: "component-name-listbox",
                className: "slds-dropdown slds-dropdown_length-5 slds-dropdown_fluid",
                role: "listbox",
                style: {position: "absolute", zIndex: 1000, width: "100%"}
              },
              h("ul", {className: "slds-listbox slds-listbox_vertical", role: "presentation"},
                filteredSuggestions.map((suggestion, index) => {
                  const suggestionClass = "slds-listbox-item" + (index === activeSuggestion ? " history-suggestion-active" : "");
                  return h("li", {
                    role: "presentation",
                    className: suggestionClass,
                    key: "suggestion-" + index,
                    onMouseDown: (e) => this.onSuggestionClick(e, index)
                  },
                  h("div", {
                    id: "option-" + index,
                    className: "slds-media slds-listbox__option slds-listbox__option_plain slds-media_small",
                    role: "option",
                    "aria-selected": (index === activeSuggestion ? "true" : "false")
                  },
                  h("span", {className: "slds-media__body slds-align-middle"},
                    h("span", {className: "slds-truncate", title: suggestion.label}, suggestion.label)
                  )
                  )
                  );
                })
              )
              ) : null
          )
        )
      )
    );
  }
}

class DependencyForm extends React.Component {
  constructor(props) {
    super(props);
    this.onTypeChange = this.onTypeChange.bind(this);
    this.onNameChange = this.onNameChange.bind(this);
    this.onFetchParents = this.onFetchParents.bind(this);
    this.onFetchChildren = this.onFetchChildren.bind(this);
    this.onExportPackageXml = this.onExportPackageXml.bind(this);
  }

  onTypeChange(e) {
    this.props.model.setType(e.target.value);
    // Clear name when type changes
    this.props.model.setName("");
  }

  onNameChange(e) {
    this.props.model.setName(e.target.value);
  }

  onFetchParents() {
    const {model} = this.props;
    // Update URL with new parameters
    let args = new URLSearchParams();
    args.set("host", model.sfHost);
    if (model.type) args.set("type", model.type);
    if (model.name) args.set("name", model.name);
    args.set("direction", "parent");
    window.history.pushState({}, "", "dependency.html?" + args);
    model.fetchDependencies(model.type, model.name, "parent");
  }

  onFetchChildren() {
    const {model} = this.props;
    // Update URL with new parameters
    let args = new URLSearchParams();
    args.set("host", model.sfHost);
    if (model.type) args.set("type", model.type);
    if (model.name) args.set("name", model.name);
    args.set("direction", "child");
    window.history.pushState({}, "", "dependency.html?" + args);
    model.fetchDependencies(model.type, model.name, "child");
  }

  onExportPackageXml() {
    this.props.model.exportPackageXml();
  }

  render() {
    const {model} = this.props;
    const hasDependencies = Object.keys(model.dependenciesByType).length > 0;
    return h("div", {className: "area"},
      h("div", {className: ""},
        h("h1", {}, "Find Dependencies"),
        h("div", {className: "area"},
          h("select", {
            className: "slds-select slds-m-right_small",
            value: model.type,
            onChange: this.onTypeChange,
            placeholder: "Type"
          },
          [h("option", {value: "", key: "None", label: "-- Select Type --"}), ...(model.metadataTypes.filter(type => type.display !== false).map(type =>
            h("option", {key: type.object, value: type.object}, type.label)
          ))]
          ),
          h(ComponentNameAutocomplete, {
            model,
            type: model.type,
            name: model.name,
            onChange: this.onNameChange,
            disabled: !model.type
          }),
          h("button", {
            className: "slds-button slds-button_brand highlighted slds-m-right_x-small",
            onClick: this.onFetchParents,
            disabled: !model.type || !model.name
          }, "Get Parent Dependencies"),
          h("button", {
            className: "slds-button slds-button_brand highlighted slds-m-right_x-small",
            onClick: this.onFetchChildren,
            disabled: !model.type || !model.name
          }, "Get Child Dependencies"),
          h("div", {className: "slds-m-top_small slds-grid slds-grid_align-spread"},
            hasDependencies && h("button", {
              className: "slds-button slds-button_outline-brand",
              onClick: this.onExportPackageXml,
              title: "Export dependencies as package.xml"
            }, "Export package.xml")
          )
        )
      )
    );
  }
}

class App extends React.Component {
  componentDidUpdate() {
    let {model} = this.props;
    model.recalculateSize();
  }
  render() {
    let {model} = this.props;

    return h("div", {},
      h(PageHeader, {sfHost: model.sfHost, title: "Dependencies", spinning: model.spinnerCount != 0, options: 3},
        model.flowScanProgress && h("span", {className: "slds-text-body_small slds-m-right_x-small", title: "Scanning flows for calls to other flows"},
          Math.round((model.flowScanProgress.done / model.flowScanProgress.total) * 100) + "%"
        )
      ),
      h(DependencyForm, {model}),
      h("div", {className: "area", id: "result-area"},
        h("div", {className: "result-bar"},
          h("h1", {}, "Results"),
          model.error && h("div", {
            className: "slds-notify slds-notify_alert slds-theme_error slds-m-top_small",
            role: "alert"
          },
          h("span", {className: "slds-assistive-text"}, "Error"),
          h("h2", {}, model.error)
          )
        ),
        h("div", {
          style: {
            overflowY: "auto",
            maxHeight: "calc(100vh - 250px)",
            padding: "0.5rem"
          }
        },
        h(DependencyAccordion, {model})
        )
      )
    );
  }
}

{

  let args = new URLSearchParams(location.search);
  let sfHost = args.get("host");
  let hash = new URLSearchParams(location.hash); //User-agent OAuth flow
  if (!sfHost && hash) {
    sfHost = decodeURIComponent(hash.get("instance_url")).replace(/^https?:\/\//i, "");
  }
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {

    let root = document.getElementById("root");
    let model = new Model({sfHost, args});
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

    if (parent && parent.isUnitTest) { // for unit tests
      parent.insextTestLoaded({model, sfConn});
    }

  });

}
