/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */
import {DescribeInfo} from "./data-load.js";

class Model {
  constructor({sfHost, args}) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.userInfo = "...";
    this.spinnerCount = 0;
    this.error = null;
    this.name = args.get("name") || "";
    this.type = args.get("type") || "";
    this.processedIds = new Set(); // Track processed IDs for hierarchy
    this.dependenciesByType = {}; // Group dependencies by type
    this.expandedTypes = new Set(); // Track which accordion sections are expanded
    this.expandedItems = new Set(); // Track which dependency items are expanded
    this.childDependencies = new Map(); // Map of parent item key to child dependencies
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
      {object: "Flow", label: "Flow/Process builder", idField: "Id", nameField: "Definition.DeveloperName", labelField: ["ProcessType", "Definition.DeveloperName", "VersionNumber"], icon: "flow", display: true}, //FlowDefinition
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
      {object: "FlowDefinition", label: "Flow Definition", idField: "Id", nameField: "Definition.DeveloperName", labelField: ["ProcessType", "Definition.DeveloperName", "VersionNumber"], icon: "flow", display: false},
      {object: "PermissionSet", label: "Permission Set", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "shield", display: false},
      {object: "Profile", label: "Profile", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "Name"], icon: "user_role", display: false},
      {object: "Report", label: "Report", idField: "Id", nameField: "Name", labelField: ["NamespacePrefix", "DeveloperName"], icon: "chart", display: false},
      {object: "StandardEntity", label: "Standard Entity", idField: "Id", nameField: "Name", labelField: ["Name"], icon: "standard_objects", display: false}
    ];

    // Map metadata types to Tooling API object and field names for querying
    this.typeToObjectMap = new Map(this.metadataTypes.map(mtype => [mtype.object, mtype]));

    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
    }));
    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.didUpdate();
    });

    // Component name suggestions cache
    this.componentNameSuggestions = [];
    this.componentNameSuggestionsLoading = false;

    // If both name and type are provided in URL, fetch dependencies automatically
    if (this.name && this.type) {
      this.fetchDependencies(this.type, this.name);
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

      let query = `SELECT ${typeMap.nameField} FROM ${typeMap.object}`;
      if (searchTerm) {
        const escapedTerm = searchTerm.replace(/'/g, "\\'");
        query += ` WHERE ${typeMap.nameField} LIKE '%${escapedTerm}%'`;
      }
      query += ` ORDER BY ${typeMap.nameField} LIMIT 100`;

      const result = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {method: "GET"});
      this.componentNameSuggestions = (result.records || []).map(rec => ({
        value: rec[typeMap.nameField],
        label: rec[typeMap.nameField]
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

    const escapedName = name.replace(/'/g, "\\'");
    const query = `SELECT Id FROM ${typeMap.object} WHERE ${typeMap.nameField} = '${escapedName}' LIMIT 1`;

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

  async fetchDependenciesInternal(type, name, dependencyType = "child", parentKey = null) {
    const parentId = parentKey ? null : null; // parentKey is used instead of parentId for child tracking
    if (!type || !name) {
      this.error = "Please select both Type and enter Name";
      this.didUpdate();
      return;
    }

    // Reset data on initial call
    if (!parentId) {
      this.error = null;
      this.processedIds.clear();
    }

    try {
      // First, get the component ID by querying the type
      const componentId = await this.getComponentId(type, name);
      if (!componentId) {
        if (!parentId) {
          this.error = `Component not found: ${type} with name ${name}`;
          this.didUpdate();
        }
        return;
      }

      // Check if we've already processed this ID (prevent infinite loops)
      if (this.processedIds.has(componentId)) {
        return;
      }
      this.processedIds.add(componentId);

      // Escape the ID for SOQL
      const escapedId = componentId.replace(/'/g, "\\'");

      // Query MetadataComponentDependency
      // dependencyType === "parent" means: find components that reference this one (RefMetadataComponentId)
      // dependencyType === "child" means: find components that this one references (MetadataComponentId)
      let query;
      if (dependencyType === "parent") {
        query = `SELECT MetadataComponentId,MetadataComponentName,MetadataComponentType,RefMetadataComponentName,RefMetadataComponentType,RefMetadataComponentId FROM MetadataComponentDependency WHERE RefMetadataComponentId = '${escapedId}'`;
      } else {
        query = `SELECT MetadataComponentId,MetadataComponentName,MetadataComponentType,RefMetadataComponentName,RefMetadataComponentType,RefMetadataComponentId FROM MetadataComponentDependency WHERE MetadataComponentId = '${escapedId}'`;
      }

      const res = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {method: "GET"});
      const records = res.records || [];

      if (records.length > 0) {
        // Group dependencies by type
        if (!parentId) {
          this.dependenciesByType = {};
        }
        const processedDeps = [];
        records.forEach(rec => {
          // For parent dependencies: rec.MetadataComponentId/Name/Type are the components that reference our component
          // For child dependencies: rec.RefMetadataComponentId/Name/Type are the components that our component references
          const depType = dependencyType === "parent" ? rec.MetadataComponentType : (rec.RefMetadataComponentType || "Unknown");
          if (!this.dependenciesByType[depType]) {
            this.dependenciesByType[depType] = [];
          }
          // For parent dependencies, we want to show the components that reference our component
          // For child dependencies, we want to show the components that our component references
          let dependency;
          if (dependencyType === "parent") {
            dependency = rec;
          } else {
            // For child dependencies, swap so MetadataComponent* shows the referenced component
            dependency = {
              ...rec,
              MetadataComponentId: rec.RefMetadataComponentId,
              MetadataComponentName: rec.RefMetadataComponentName,
              MetadataComponentType: rec.RefMetadataComponentType,
              RefMetadataComponentId: rec.MetadataComponentId,
              RefMetadataComponentName: rec.MetadataComponentName,
              RefMetadataComponentType: rec.MetadataComponentType
            };
          }
          this.dependenciesByType[depType].push(dependency);
          processedDeps.push(dependency);
        });
        // Enrich dependencies with additional information (e.g., objectName for CustomField)
        await this.enrichDependencies(processedDeps);
        this.didUpdate();
      }

      // Special handling for Flow types - Flow do not worked well with MetadataComponentDependency
      if ((type === "Flow" || type === "FlowDefinition") && !parentId) {
        const resFlowId = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=SELECT+Id+FROM+Flow+WHERE+Status+='Active'", {method: "GET"});
        for (const flowRec of resFlowId.records) {
          const flowRes = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=SELECT+Id,Definition.DeveloperName,Metadata+FROM+Flow+WHERE+Id+='" + flowRec.Id + "'", {method: "GET"});
          flowRes.records.forEach(flow => {
            if (flow.Metadata && flow.Metadata.subflows && flow.Metadata.subflows.some(f => f.flowName == name)) {
              const flowRecord = {
                "attributes": {
                  "type": "MetadataComponentDependency",
                  "url": "/services/data/v" + apiVersion + "/tooling/sobjects/MetadataComponentDependency/000000000000000AAA"
                },
                "MetadataComponentId": flow.Id,
                "MetadataComponentName": flow.Definition.DeveloperName,
                "MetadataComponentType": "Flow",
                "RefMetadataComponentName": name,
                "RefMetadataComponentType": type,
                "RefMetadataComponentId": componentId
              };
              const depType = "Flow";
              if (!this.dependenciesByType[depType]) {
                this.dependenciesByType[depType] = [];
              }
              this.dependenciesByType[depType].push(flowRecord);
            }
          });
          // Enrich flow dependencies
          const flowDeps = this.dependenciesByType["Flow"] || [];
          await this.enrichDependencies(flowDeps.slice(-1)); // Enrich the last added flow record
        }
        this.didUpdate();
      }
    } catch (err) {
      console.error("Error fetching dependencies:", err);
      if (!parentId) {
        this.error = "Error fetching dependencies: " + (err.message || JSON.stringify(err));
        this.didUpdate();
      }
    }
  }

  fetchDependencies(type, name, dependencyType = "child") {
    this.spinFor(this.fetchDependenciesInternal(type, name, dependencyType));
  }

  setType(type) {
    this.type = type;
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

  async fetchChildDependencies(itemKey, componentType, componentName) {
    if (this.childDependencies.has(itemKey)) {
      // Already fetched, just toggle
      this.toggleItemExpanded(itemKey);
      return;
    }

    // Fetch child dependencies for this component (what this component references)
    try {
      const componentId = await this.getComponentId(componentType, componentName);
      if (!componentId || this.processedIds.has(componentId)) {
        this.toggleItemExpanded(itemKey);
        return;
      }

      this.processedIds.add(componentId);
      const escapedId = componentId.replace(/'/g, "\\'");
      // Get child dependencies (components that this component references)
      const query = `SELECT MetadataComponentId,MetadataComponentName,MetadataComponentType,RefMetadataComponentName,RefMetadataComponentType,RefMetadataComponentId FROM MetadataComponentDependency WHERE MetadataComponentId = '${escapedId}'`;
      const res = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {method: "GET"});
      const records = res.records || [];
      // Transform to show referenced components
      const children = records.map(rec => ({
        ...rec,
        MetadataComponentId: rec.RefMetadataComponentId,
        MetadataComponentName: rec.RefMetadataComponentName,
        MetadataComponentType: rec.RefMetadataComponentType,
        RefMetadataComponentId: rec.MetadataComponentId,
        RefMetadataComponentName: rec.MetadataComponentName,
        RefMetadataComponentType: rec.MetadataComponentType
      }));
      await this.enrichDependencies(children);
      // Store children separately
      this.childDependencies.set(itemKey, children);
      this.toggleItemExpanded(itemKey);
    } catch (err) {
      console.error("Error fetching child dependencies:", err);
    }
  }
  async enrichDependencies(dependencies) {
    if (!dependencies || dependencies.length === 0) {
      return;
    }

    // Collect all CustomField dependencies that need enrichment
    const fieldIds = dependencies.filter(dep => !dep.objectName && dep.MetadataComponentType === "CustomField").map(dep => dep.MetadataComponentId);
    fieldIds.concat(dependencies.filter(dep => !dep.objectName && dep.refMetadataComponentType === "CustomField").map(dep => dep.refMetadataComponentId));
    if (fieldIds.length === 0) {
      return;
    }

    // Extract object names from field names (format: ObjectName.FieldName)
    const objectIdToObjectName = new Map();
    const query = `SELECT Id, TableEnumOrId, DeveloperName FROM CustomField WHERE Id IN ('${fieldIds.join("','")}')`;

    try {
      const result = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {method: "GET"});
      const fieldRecords = result.records || [];

      // Create a map of field ID to TableEnumOrId
      const fieldIdToSobjectId = new Map();
      fieldRecords.forEach(field => {
        if (field.TableEnumOrId) {
          fieldIdToSobjectId.set(field.Id, field.TableEnumOrId);
        }
      });
      const idPattern = /\b[a-zA-Z0-9]{5}0[a-zA-Z0-9]{9}(?:[a-zA-Z0-9]{3})?\b/g;

      // Query EntityDefinition to get object names from TableEnumOrId
      const sobjectIds = Array.from(new Set(fieldIdToSobjectId.values())).filter(id => id && idPattern.test(id));
      if (sobjectIds.length > 0) {
        const sobjectQuery = `SELECT Id, QualifiedApiName FROM EntityDefinition WHERE Id IN ('${sobjectIds.join("','")}')`;
        const sobjectResult = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(sobjectQuery), {method: "GET"});
        const sobjects = sobjectResult.records || [];
        sobjects.forEach(sobject => {
          objectIdToObjectName.set(sobject.Id, sobject.QualifiedApiName);
        });
      }

      // Apply object names to dependencies for the link
      dependencies.forEach(dep => {
        if (!dep.objectName && dep.MetadataComponentType === "CustomField" && dep.MetadataComponentId) {
          const objectId = fieldIdToSobjectId.get(dep.MetadataComponentId);
          if (objectId) {
            dep.objectName = objectIdToObjectName.get(objectId);
          }
        }
        if (!dep.objectName && dep.refMetadataComponentType === "CustomField" && dep.refMetadataComponentId) {
          const objectId = fieldIdToSobjectId.get(dep.refMetadataComponentId);
          if (objectId) {
            dep.objectName = objectIdToObjectName.get(objectId);
          }
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
      const deps = this.dependenciesByType[type];
      const uniqueNames = new Set();

      deps.forEach(dep => {
        let name = dep.MetadataComponentName;

        // Handle namespaced components
        if (dep.MetadataComponentNamespace) {
          name = name.replace(`${dep.MetadataComponentNamespace}__`, "");
        }

        // Handle CustomField format (Object.Field)
        if (type === "CustomField" && name.includes(".")) {
          const parts = name.split(".");
          if (parts.length === 2) {
            // Add object and field separately
            const objectName = parts[0];
            const fieldName = parts[1];
            uniqueNames.add(`${objectName}.${fieldName}`);
          } else {
            uniqueNames.add(name);
          }
        } else {
          uniqueNames.add(name);
        }
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

    xml += "  <version>58.0</version>\n";
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
      case "ValidationRule":
        return `https://${this.sfHost}/lightning/setup/ObjectManager/${componentId}/ValidationRules/view`;
      case "CustomLabel":
        return `https://${this.sfHost}/lightning/setup/CustomLabels/page?address=%2F${componentId}`;
      case "LightningWebComponent":
      case "LightningComponentBundle":
        return `https://${this.sfHost}/lightning/setup/LightningWebComponents/page?address=%2F${componentId}`;
      case "EmailTemplate":
        return `https://${this.sfHost}/lightning/setup/EmailTemplates/page?address=%2F${componentId}`;
      case "WorkflowAlert":
        return `https://${this.sfHost}/lightning/setup/WorkflowAlerts/page?address=%2F${componentId}`;
      case "WebLink":
        return `https://${this.sfHost}/lightning/setup/ObjectManager/${componentId}/ButtonsLinksAndActions/view`;
      case "Layout":
        return `https://${this.sfHost}/lightning/setup/ObjectManager/${componentId}/PageLayouts/view`;
      case "FlexiPage":
        return `https://${this.sfHost}/lightning/setup/FlexiPages/page?address=%2F${componentId}`;
      case "CustomObject":
        return `https://${this.sfHost}/lightning/setup/ObjectManager/${componentId}/Details/view`;
      case "CustomField":
        return `https://${this.sfHost}/lightning/setup/ObjectManager/${dependency.objectName}/FieldsAndRelationships/${componentId}/view`;
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

  onExpandClick(e) {
    e.stopPropagation();
    const {model, dependency} = this.props;
    const itemKey = `${dependency.MetadataComponentType}:${dependency.MetadataComponentName}`;
    model.fetchChildDependencies(itemKey, dependency.MetadataComponentType, dependency.MetadataComponentName);
  }

  render() {
    const {model, dependency} = this.props;
    const itemKey = `${dependency.MetadataComponentType}:${dependency.MetadataComponentName}`;
    const isExpanded = model.expandedItems.has(itemKey);
    const typeInfo = model.typeToObjectMap.get(dependency.MetadataComponentType);
    const iconName = typeInfo?.icon || "fallback";
    const link = model.getComponentLink(dependency);
    const hasChildren = model.childDependencies.has(itemKey) && model.childDependencies.get(itemKey).length > 0;

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
        disabled: !dependency.MetadataComponentId,
        onClick: this.onExpandClick,
        hidden: !dependency.MetadataComponentId
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
            title: dependency.MetadataComponentName
          }, dependency.MetadataComponentName),
          h("span", {className: "slds-text-body_small slds-m-left_small slds-text-color_weak"},
            dependency.MetadataComponentType
          )
        )
      )
      ),
      isExpanded && hasChildren && h("div", {
        className: "dependency-children",
        style: childrenStyle
      },
      model.childDependencies.get(itemKey).map((childDep, idx) =>
        h(DependencyItem, {
          key: `${itemKey}-${idx}`,
          model,
          dependency: childDep,
          isSubdependency: true
        })
      )
      )
    );
  }
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

    if (types.length === 0) {
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
  }

  componentDidUpdate(prevProps) {
  }

  onFocus() {
    const {model, type} = this.props;
    if (!type) return;

    if (!model.componentNameSuggestionsLoading) {
      model.fetchComponentNames(type, model.name || "");
    }

    const filteredSuggestions = model.componentNameSuggestions.filter(suggestion =>
      !this.state.searchTerm || suggestion.label.toLowerCase().includes(this.state.searchTerm.toLowerCase())
    );

    this.setState({
      activeSuggestion: 0,
      filteredSuggestions,
      showSuggestions: true
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

    // Fetch suggestions if needed
    if (!model.componentNameSuggestionsLoading) {
      model.fetchComponentNames(type, userInput);
    }

    const filteredSuggestions = model.componentNameSuggestions.filter(suggestion =>
      suggestion.label.toLowerCase().includes(userInput.toLowerCase())
    );

    this.setState({
      activeSuggestion: 0,
      filteredSuggestions,
      showSuggestions: true,
      searchTerm: userInput
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
    const {model, type, name, disabled} = this.props;
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
          [h("option", {value: "", key: "", label: "-- Select Type --"}), ...(model.metadataTypes.filter(type => type.display !== false).map(type =>
            h("option", {key: type.value, value: type.object}, type.label)
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
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 3);

    return h("div", {},
      h("div", {id: "user-info"},
        h("a", {href: model.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {}, "Dependencies"),
        h("span", {}, " / " + model.userInfo),
        h("div", {className: "flex-right"},
          h("div", {id: "spinner", role: "status", className: "slds-spinner slds-spinner_small slds-spinner_inline", hidden: model.spinnerCount == 0},
            h("span", {className: "slds-assistive-text"}),
            h("div", {className: "slds-spinner__dot-a"}),
            h("div", {className: "slds-spinner__dot-b"}),
          ),
          h("a", {href: "options.html?" + hostArg, className: "top-btn", id: "options-btn", title: "Option", target: "_blank"},
            h("div", {className: "icon"})
          )
        ),
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
        h(DependencyAccordion, {model, hidden: model.error != null})
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
