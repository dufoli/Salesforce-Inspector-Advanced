/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {RecordTable} from "./record-table.js";
/* global initButton */


class Model {
  constructor(sfHost) {
    this.reactCallback = null;

    // Raw fetched data
    this.globalDescribe = null;
    this.sobjectDescribePromise = null;
    this.objectData = null;
    this.recordData = null;
    this.layoutInfo = null;

    // Processed data and UI state
    this.sfLink = "https://" + sfHost;
    this.logMessages = [];
    this.progress = "ready";
    this.downloadLink = null;
    this.statusLink = null;
    this.metadataObjects = null;
    this.searchValue = "";
    this.filteredMetadataObjects = null;
    this.selectAll = null;
    this.downloadAuto = false;
    // Deploy state
    this.deployProgress = "ready";
    this.deployLogMessages = [];
    this.selectedFile = null;
    this.deployStatusLink = null;
    this.showDeployOptions = false;
    // Drag and drop state
    this.dragOverPackageXml = false;
    this.dragOverZip = false;
    // Deploy options
    this.checkOnly = false;
    this.allowMissingFiles = false;
    this.ignoreWarnings = false;
    this.performRetrieve = true;
    this.purgeOnDelete = false;
    this.rollbackOnError = true;
    this.singlePackage = false;
    this.testLevel = "NoTestRun";
    this.runTests = "";
  }
  /**
   * Notify React that we changed something, so it will rerender the view.
   * Should only be called once at the end of an event or asynchronous operation, since each call can take some time.
   * All event listeners (functions starting with "on") should call this function if they update the model.
   * Asynchronous operations should use the spinFor function, which will call this function after calling its callback.
   * Other functions should not call this function, since they are called by a function that does.
   * @param cb A function to be called once React has processed the update.
   */
  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
    }
  }

  setSelectAll(selec) {
    this.selectAll = selec;
  }

  title() {
    if (this.progress == "working") {
      return "(Loading) Download Metadata";
    }
    if (this.deployProgress == "working") {
      return "(Deploying) Upload Metadata";
    }
    return "Download Metadata";
  }

  async batchHandler(batch, options) {
    let self = this;
    return batch.catch(err => {
      if (err.name == "AbortError") {
        return {records: [], done: true, totalSize: -1};
      }
      throw err;
    }).then(data => {
      options.rows = options.rows.concat(data.records);
      if (!data.done) {
        let pr = this.batchHandler(sfConn.rest(data.nextRecordsUrl, {}), options);
        return pr;
      }
      return null;
    }, err => {
      if (err.name != "SalesforceRestError") {
        throw err; // not a SalesforceRestError
      }
      self.logError(err);
      return null;
    });
  }

  async downloadDataModel() {
    this.progress = "working";
    let query = "SELECT QualifiedApiName FROM EntityDefinition ORDER BY QualifiedApiName";
    let result = {rows: []};
    this.didUpdate();
    await this.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query), {}), result)
      .catch(error => {
        self.logError(error);
      });
    let fieldsFesult = {rows: []};
    query = "SELECT Id, DeveloperName, QualifiedApiName, EntityDefinition.QualifiedApiName, DataType, Length, Precision, NamespacePrefix, IsCalculated, IsHighScaleNumber, IsHtmlFormatted, IsNameField, IsNillable, IsWorkflowFilterable, IsCompactLayoutable, IsFieldHistoryTracked, IsIndexed, IsApiFilterable, IsApiSortable, IsListFilterable, IsListSortable, IsApiGroupable, IsListVisible, PublisherId, IsCompound, IsSearchPrefilterable, IsPolymorphicForeignKey, IsAiPredictionField, Description, ExtraTypeInfo, Label FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName in ([RANGE])";
    for (let index = 0; index < result.rows.length; index += 50) {
      let entityNames = result.rows.slice(index, index + 50).map(e => "'" + e.QualifiedApiName + "'");
      await this.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query.replace("[RANGE]", entityNames.join(", "))), {}), fieldsFesult)
        .catch(error => {
          self.logError(error);
        });
    }
    let separator = ",";
    if (localStorage.getItem("csvSeparator")) {
      separator = localStorage.getItem("csvSeparator");
    }
    let downloadLink = document.createElement("a");
    downloadLink.download = "datamodel.csv";
    let BOM = "\uFEFF";
    let rt = new RecordTable();
    rt.addToTable(fieldsFesult.rows);
    let bb = new Blob([BOM, rt.csvSerialize(separator)], {type: "text/csv;charset=utf-8"});
    downloadLink.href = window.URL.createObjectURL(bb);
    downloadLink.click();
    this.progress = "done";
    this.didUpdate();
  }

  filterMetadata(searchKeyword) {
    this.searchValue = searchKeyword;
    this.filteredMetadataObjects = this.metadataObjects
      .filter(metadataObject => metadataObject.xmlName.toLowerCase().includes(searchKeyword)
      || metadataObject.directoryName.toLowerCase().includes(searchKeyword));
  }

  startLoading() {
    let logWait = this.logWait.bind(this);
    (async () => {
      try {
        this.progress = "working";
        this.didUpdate();

        // Code below is originally from forcecmd
        let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
        let res = await logWait(
          "DescribeMetadata",
          sfConn.soap(metadataApi, "describeMetadata", {apiVersion})
        );
        let availableMetadataObjects = res.metadataObjects
          .filter(metadataObject => metadataObject.xmlName != "InstalledPackage");
        // End of forcecmd code
        this.metadataObjects = availableMetadataObjects;
        this.filteredMetadataObjects = availableMetadataObjects;
        for (let metadataObject of this.metadataObjects) {
          metadataObject.selected = true;
        }
        this.progress = "ready";
        this.didUpdate();
      } catch (e) {
        this.logError(e);
      }
    })();
  }

  startDownloading() {
    let logMsg = msg => {
      this.logMessages.push({level: "info", text: msg});
      this.didUpdate();
    };
    let logWait = this.logWait.bind(this);
    (async () => {
      function flattenArray(x) {
        return [].concat(...x);
      }

      function groupByThree(list) {
        let groups = [];
        for (let element of list) {
          if (groups.length == 0 || groups[groups.length - 1].length == 3) {
            groups.push([]);
          }
          groups[groups.length - 1].push(element);
        }
        return groups;
      }

      try {
        let metadataObjects = this.metadataObjects;
        //this.metadataObjects = null;
        //this.filteredMetadataObjects = null;
        this.progress = "working";
        this.downloadLink = null;
        this.statusLink = null;
        this.didUpdate();

        let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
        let res;
        let selectedMetadataObjects = metadataObjects
          .filter(metadataObject => metadataObject.selected);
        // Code below is originally from forcecmd
        let folderMap = {};
        let x = selectedMetadataObjects
          .map(metadataObject => {
            let xmlNames = sfConn.asArray(metadataObject.childXmlNames).concat(metadataObject.xmlName);
            return xmlNames.map(xmlName => {
              if (metadataObject.inFolder == "true") {
                if (xmlName == "EmailTemplate") {
                  folderMap["EmailFolder"] = "EmailTemplate";
                  xmlName = "EmailFolder";
                } else {
                  folderMap[xmlName + "Folder"] = xmlName;
                  xmlName = xmlName + "Folder";
                }
              }
              return xmlName;
            });
          });
        res = await Promise.all(groupByThree(flattenArray(x)).map(async xmlNames => {
          let someItems = sfConn.asArray(await logWait(
            "ListMetadata " + xmlNames.join(", "),
            sfConn.soap(metadataApi, "listMetadata", {queries: xmlNames.map(xmlName => ({type: xmlName}))})
          ));
          let folders = someItems.filter(folder => folderMap[folder.type]);
          let nonFolders = someItems.filter(folder => !folderMap[folder.type]);
          let p = await Promise
            .all(groupByThree(folders).map(async folderGroup =>
              sfConn.asArray(await logWait(
                "ListMetadata " + folderGroup.map(folder => folderMap[folder.type] + "/" + folder.fullName).join(", "),
                sfConn.soap(metadataApi, "listMetadata", {queries: folderGroup.map(folder => ({type: folderMap[folder.type], folder: folder.fullName}))})
              ))
            ));
          return flattenArray(p).concat(
            folders.map(folder => ({type: folderMap[folder.type], fullName: folder.fullName})),
            nonFolders,
            xmlNames.map(xmlName => ({type: xmlName, fullName: "*"}))
          );
        }));
        let types = flattenArray(res);
        if (types.filter(x => x.type == "StandardValueSet").map(x => x.fullName).join(",") == "*") {
          // We are using an API version that supports the StandardValueSet type, but it didn't list its contents.
          // https://success.salesforce.com/ideaView?id=0873A000000cMdrQAE
          // Here we hardcode the supported values as of Winter 17 / API version 38.
          types = types.concat([
            "AccountContactMultiRoles", "AccountContactRole", "AccountOwnership", "AccountRating", "AccountType", "AddressCountryCode", "AddressStateCode", "AssetStatus", "CampaignMemberStatus", "CampaignStatus", "CampaignType", "CaseContactRole", "CaseOrigin", "CasePriority", "CaseReason", "CaseStatus", "CaseType", "ContactRole", "ContractContactRole", "ContractStatus", "EntitlementType", "EventSubject", "EventType", "FiscalYearPeriodName", "FiscalYearPeriodPrefix", "FiscalYearQuarterName", "FiscalYearQuarterPrefix", "IdeaCategory1", "IdeaMultiCategory", "IdeaStatus", "IdeaThemeStatus", "Industry", "InvoiceStatus", "LeadSource", "LeadStatus", "OpportunityCompetitor", "OpportunityStage", "OpportunityType", "OrderStatus1", "OrderType", "PartnerRole", "Product2Family", "QuestionOrigin1", "QuickTextCategory", "QuickTextChannel", "QuoteStatus", "SalesTeamRole", "Salutation", "ServiceContractApprovalStatus", "SocialPostClassification", "SocialPostEngagementLevel", "SocialPostReviewedStatus", "SolutionStatus", "TaskPriority", "TaskStatus", "TaskSubject", "TaskType", "WorkOrderLineItemStatus", "WorkOrderPriority", "WorkOrderStatus"
          ].map(x => ({type: "StandardValueSet", fullName: x})));
        }
        types.sort((a, b) => {
          let ka = a.type + "~" + a.fullName;
          let kb = b.type + "~" + b.fullName;
          if (ka < kb) {
            return -1;
          }
          if (ka > kb) {
            return 1;
          }
          return 0;
        });
        types = types.map(x => ({name: x.type, members: decodeURIComponent(x.fullName)}));
        //console.log(types);
        let result = await logWait(
          "Retrieve",
          sfConn.soap(metadataApi, "retrieve", {retrieveRequest: {apiVersion, unpackaged: {types, version: apiVersion}}})
        );
        logMsg("(Id: " + result.id + ")");
        for (let interval = 2000; ;) {
          await logWait(
            "(Waiting)",
            timeout(interval)
          );
          res = await logWait(
            "CheckRetrieveStatus",
            sfConn.soap(metadataApi, "checkRetrieveStatus", {id: result.id})
          );
          if (res.done !== "false") {
            break;
          }
        }
        if (res.success != "true") {
          let err = new Error("Retrieve failed");
          err.result = res;
          throw err;
        }
        let statusJson = JSON.stringify({
          fileProperties: sfConn.asArray(res.fileProperties)
            .filter(fp => fp.id != "000000000000000AAA" || fp.fullName != "")
            .sort((fp1, fp2) => fp1.fileName < fp2.fileName ? -1 : fp1.fileName > fp2.fileName ? 1 : 0),
          messages: res.messages
        }, null, "    ");
        //console.log("(Reading response and writing files)");
        // End of forcecmd code
        logMsg("(Finished)");
        let zipBin = Uint8Array.from(atob(res.zipFile), c => c.charCodeAt(0));
        this.downloadLink = URL.createObjectURL(new Blob([zipBin], {type: "application/zip"}));
        this.statusLink = URL.createObjectURL(new Blob([statusJson], {type: "application/json"}));
        if (this.downloadAuto) {
          let downloadATag = document.createElement("a");
          downloadATag.download = "metadata.zip";
          downloadATag.href = this.downloadLink;
          downloadATag.click();
          let downloadATag2 = document.createElement("a");
          downloadATag2.download = "metadataStatus.json";
          downloadATag2.href = this.statusLink;
          downloadATag2.click();
        }
        this.progress = "done";
        this.didUpdate();
      } catch (e) {
        this.logError(e);
      }
    })();
  }

  logWait(msg, promise) {
    let message = {level: "working", text: msg};
    this.logMessages.push(message);
    this.didUpdate();
    promise.then(res => {
      message.level = "info";
      this.didUpdate();
      return res;
    }, err => {
      message.level = "error";
      this.didUpdate();
      throw err;
    });
    return promise;
  }

  logError(err) {
    this.progress = "error";
    console.error(err);
    let msg;
    if (err.message == "Retrieve failed") {
      msg = "(Error: Retrieve failed: " + JSON.stringify(err.result) + ")";
    } else {
      msg = "(Error: " + err.message + ")";
    }
    this.logMessages.push({level: "error", text: msg});
    this.didUpdate();
  }

  async readZipFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target.result;
        const uint8Array = new Uint8Array(arrayBuffer);
        // Convert to base64
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  async readPackageXmlFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve(event.target.result);
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  generatePackageXml() {
    if (!this.metadataObjects) {
      this.logMessages.push({level: "error", text: "(Error: Please wait for metadata objects to load)"});
      this.didUpdate();
      return;
    }

    let selectedMetadataObjects = this.metadataObjects
      .filter(metadataObject => metadataObject.selected);

    if (selectedMetadataObjects.length === 0) {
      this.logMessages.push({level: "error", text: "(Error: Please select at least one metadata type)"});
      this.didUpdate();
      return;
    }

    // Group selected metadata by type
    let typeMap = {};
    for (let metadataObject of selectedMetadataObjects) {
      let xmlName = metadataObject.xmlName;
      if (!typeMap[xmlName]) {
        typeMap[xmlName] = [];
      }
      // For now, we'll use "*" to indicate all members of this type
      // In a more advanced version, we could track individual members
      typeMap[xmlName].push("*");
    }

    // Build package.xml
    let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    xml += "<Package xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n";

    // Sort types for consistent output
    let sortedTypes = Object.keys(typeMap).sort();
    for (let typeName of sortedTypes) {
      xml += "    <types>\n";
      // Add all members (using * for all)
      for (let member of typeMap[typeName]) {
        xml += "        <members>" + member + "</members>\n";
      }
      xml += "        <name>" + typeName + "</name>\n";
      xml += "    </types>\n";
    }

    xml += "    <version>" + apiVersion + "</version>\n";
    xml += "</Package>";

    // Create download link
    let downloadLink = document.createElement("a");
    downloadLink.download = "package.xml";
    let blob = new Blob([xml], {type: "application/xml"});
    downloadLink.href = window.URL.createObjectURL(blob);
    downloadLink.click();

    this.logMessages.push({level: "info", text: "(Package.xml generated successfully)"});
    this.didUpdate();
  }

  async importPackageXml(file) {
    try {
      this.progress = "working";
      this.logMessages.push({level: "info", text: "(Reading package.xml file)"});
      this.didUpdate();

      const xmlContent = await this.readPackageXmlFile(file);

      // Parse XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, "text/xml");

      // Check for parsing errors
      const parseError = xmlDoc.querySelector("parsererror");
      if (parseError) {
        throw new Error("Invalid XML format: " + parseError.textContent);
      }

      const packageElement = xmlDoc.querySelector("Package");
      if (!packageElement) {
        throw new Error("Invalid package.xml: Package element not found");
      }

      // Get all type elements
      const typeElements = packageElement.querySelectorAll("types");

      if (!this.metadataObjects) {
        throw new Error("Metadata objects not loaded. Please wait and try again.");
      }

      // First, unselect all
      for (let metadataObject of this.metadataObjects) {
        metadataObject.selected = false;
      }

      // Map of XML names to metadata objects
      let xmlNameMap = {};
      for (let metadataObject of this.metadataObjects) {
        xmlNameMap[metadataObject.xmlName] = metadataObject;
        // Also check child XML names
        if (metadataObject.childXmlNames) {
          let childNames = sfConn.asArray(metadataObject.childXmlNames);
          for (let childName of childNames) {
            xmlNameMap[childName] = metadataObject;
          }
        }
      }

      // Select metadata objects based on package.xml
      let selectedCount = 0;
      for (let typeElement of typeElements) {
        const nameElement = typeElement.querySelector("name");
        if (nameElement) {
          const typeName = nameElement.textContent.trim();
          if (xmlNameMap[typeName]) {
            xmlNameMap[typeName].selected = true;
            selectedCount++;
          } else {
            this.logMessages.push({level: "warning", text: "(Warning: Unknown metadata type in package.xml: " + typeName + ")"});
          }
        }
      }

      // Update filtered list if search is active
      if (this.searchValue) {
        this.filterMetadata(this.searchValue);
      } else {
        this.filteredMetadataObjects = this.metadataObjects;
      }

      this.logMessages.push({level: "info", text: "(Package.xml imported successfully. Selected " + selectedCount + " metadata type(s))"});
      this.progress = "ready";
      this.didUpdate();
    } catch (e) {
      this.logError(e);
    }
  }

  startDeploying() {
    let logMsg = msg => {
      this.deployLogMessages.push({level: "info", text: msg});
      this.didUpdate();
    };
    let logWait = this.logWaitDeploy.bind(this);
    (async () => {
      try {
        if (!this.selectedFile) {
          throw new Error("Please select a zip file to deploy");
        }
        this.deployProgress = "working";
        this.deployLogMessages = [];
        this.deployStatusLink = null;
        this.didUpdate();

        logMsg("(Reading zip file)");
        const zipBase64 = await this.readZipFile(this.selectedFile);
        logMsg("(File read: " + this.selectedFile.name + ")");

        let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
        logMsg("(Starting deployment)");
        let deployResult = await logWait(
          "Deploy",
          sfConn.soap(metadataApi, "deploy", {
            ZipFile: zipBase64,
            DeployOptions: {
              allowMissingFiles: this.allowMissingFiles,
              checkOnly: this.checkOnly,
              ignoreWarnings: this.ignoreWarnings,
              performRetrieve: this.performRetrieve,
              purgeOnDelete: this.purgeOnDelete,
              rollbackOnError: this.rollbackOnError,
              runTests: this.runTests ? this.runTests.split(",").map(t => t.trim()).filter(t => t) : [],
              singlePackage: this.singlePackage,
              testLevel: this.testLevel
            }
          })
        );

        logMsg("(Deployment Id: " + deployResult.id + ")");
        let res;
        for (let interval = 2000; ;) {
          await logWait(
            "(Waiting)",
            timeout(interval)
          );
          res = await logWait(
            "CheckDeployStatus",
            sfConn.soap(metadataApi, "checkDeployStatus", {
              asyncProcessId: deployResult.id,
              includeDetails: true
            })
          );
          if (res.done !== "false") {
            break;
          }
        }

        if (res.status !== "Succeeded") {
          let err = new Error("Deploy failed");
          err.result = res;
          throw err;
        }

        let statusJson = JSON.stringify({
          id: res.id,
          status: res.status,
          success: res.success,
          done: res.done,
          numberComponentErrors: res.numberComponentErrors,
          numberComponentsDeployed: res.numberComponentsDeployed,
          numberComponentsTotal: res.numberComponentsTotal,
          numberTestErrors: res.numberTestErrors,
          numberTestsCompleted: res.numberTestsCompleted,
          numberTestsTotal: res.numberTestsTotal,
          details: res.details,
          messages: res.messages
        }, null, "    ");

        logMsg("(Finished)");
        this.deployStatusLink = URL.createObjectURL(new Blob([statusJson], {type: "application/json"}));
        this.deployProgress = "done";
        this.didUpdate();
      } catch (e) {
        this.logDeployError(e);
      }
    })();
  }

  logWaitDeploy(msg, promise) {
    let message = {level: "working", text: msg};
    this.deployLogMessages.push(message);
    this.didUpdate();
    promise.then(res => {
      message.level = "info";
      this.didUpdate();
      return res;
    }, err => {
      message.level = "error";
      this.didUpdate();
      throw err;
    });
    return promise;
  }

  logDeployError(err) {
    this.deployProgress = "error";
    console.error(err);
    let msg;
    if (err.message == "Deploy failed") {
      let result = err.result;
      if (result && result.details && result.details.componentFailures) {
        let failures = sfConn.asArray(result.details.componentFailures);
        if (failures.length > 0) {
          msg = "(Error: Deploy failed - " + failures.length + " component failure(s). Status: " + (result.status || "Unknown") + ")";
          failures.forEach((failure, index) => {
            this.deployLogMessages.push({level: "error", text: "  Component " + (index + 1) + ": " + (failure.fullName || "Unknown") + " - " + (failure.problem || failure.problemType || "Unknown error")});
          });
        } else {
          msg = "(Error: Deploy failed. Status: " + (result.status || "Unknown") + ", Message: " + (result.statusMessage || "No details available") + ")";
        }
      } else {
        msg = "(Error: Deploy failed. Status: " + (result && result.status ? result.status : "Unknown") + ")";
        if (result && result.statusMessage) {
          this.deployLogMessages.push({level: "error", text: "  Message: " + result.statusMessage});
        }
      }
    } else {
      msg = "(Error: " + err.message + ")";
    }
    this.deployLogMessages.push({level: "error", text: msg});
    this.didUpdate();
  }

}

let timeout = ms => new Promise(resolve => setTimeout(resolve, ms));

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onStartClick = this.onStartClick.bind(this);
    this.onSelectAllChange = this.onSelectAllChange.bind(this);
    this.onSearchInput = this.onSearchInput.bind(this);
    this.onDownloadAutoChange = this.onDownloadAutoChange.bind(this);
    this.onClickDataModel = this.onClickDataModel.bind(this);
    this.onFileChange = this.onFileChange.bind(this);
    this.onDeployClick = this.onDeployClick.bind(this);
    this.onCheckOnlyChange = this.onCheckOnlyChange.bind(this);
    this.onToggleDeployOptions = this.onToggleDeployOptions.bind(this);
    this.onDeployOptionChange = this.onDeployOptionChange.bind(this);
    this.onGeneratePackageXml = this.onGeneratePackageXml.bind(this);
    this.onImportPackageXml = this.onImportPackageXml.bind(this);
    this.onDragOverPackageXml = this.onDragOverPackageXml.bind(this);
    this.onDragLeavePackageXml = this.onDragLeavePackageXml.bind(this);
    this.onDropPackageXml = this.onDropPackageXml.bind(this);
    this.onDragOverZip = this.onDragOverZip.bind(this);
    this.onDragLeaveZip = this.onDragLeaveZip.bind(this);
    this.onDropZip = this.onDropZip.bind(this);
  }
  onSelectAllChange(e) {
    let {model} = this.props;
    let checked = e.target.checked;
    for (let metadataObject of model.filteredMetadataObjects) {
      metadataObject.selected = checked;
    }
    if (model.selectAll && model.filteredMetadataObjects) {
      model.selectAll.indeterminate = (model.filteredMetadataObjects.some(metadataObject => metadataObject.selected) && model.filteredMetadataObjects.some(metadataObject => !metadataObject.selected));
    }
    model.didUpdate();
  }
  onStartClick() {
    let {model} = this.props;
    model.startDownloading();
  }
  onSearchInput(e) {
    let {model} = this.props;
    model.filterMetadata(e.target.value);
    model.didUpdate();
  }
  onDownloadAutoChange(e) {
    let {model} = this.props;
    model.downloadAuto = e.target.checked;
    model.didUpdate();
  }
  onClickDataModel() {
    let {model} = this.props;
    model.downloadDataModel();
    model.didUpdate();
  }
  onFileChange(e) {
    let {model} = this.props;
    model.selectedFile = e.target.files[0] || null;
    model.didUpdate();
  }
  onDeployClick() {
    let {model} = this.props;
    model.startDeploying();
  }
  onCheckOnlyChange(e) {
    let {model} = this.props;
    model.checkOnly = e.target.checked;
    model.didUpdate();
  }
  onToggleDeployOptions() {
    let {model} = this.props;
    model.showDeployOptions = !model.showDeployOptions;
    model.didUpdate();
  }
  onDeployOptionChange(optionName, value) {
    let {model} = this.props;
    model[optionName] = value;
    model.didUpdate();
  }
  onGeneratePackageXml() {
    let {model} = this.props;
    model.generatePackageXml();
  }
  onImportPackageXml(e) {
    let {model} = this.props;
    const file = e.target.files[0];
    if (file) {
      model.importPackageXml(file);
    }
    // Reset the input so the same file can be selected again
    e.target.value = "";
  }
  onDragOverPackageXml(e) {
    e.preventDefault();
    e.stopPropagation();
    let {model} = this.props;
    if (!model.dragOverPackageXml) {
      model.dragOverPackageXml = true;
      model.didUpdate();
    }
  }
  onDragLeavePackageXml(e) {
    e.preventDefault();
    e.stopPropagation();
    let {model} = this.props;
    if (model.dragOverPackageXml) {
      model.dragOverPackageXml = false;
      model.didUpdate();
    }
  }
  onDropPackageXml(e) {
    e.preventDefault();
    e.stopPropagation();
    let {model} = this.props;
    model.dragOverPackageXml = false;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith(".xml") || file.type === "application/xml" || file.type === "text/xml") {
        model.importPackageXml(file);
      } else {
        model.logMessages.push({level: "error", text: "(Error: Please drop a valid package.xml file)"});
        model.didUpdate();
      }
    }
  }
  onDragOverZip(e) {
    e.preventDefault();
    e.stopPropagation();
    let {model} = this.props;
    if (!model.dragOverZip) {
      model.dragOverZip = true;
      model.didUpdate();
    }
  }
  onDragLeaveZip(e) {
    e.preventDefault();
    e.stopPropagation();
    let {model} = this.props;
    if (model.dragOverZip) {
      model.dragOverZip = false;
      model.didUpdate();
    }
  }
  onDropZip(e) {
    e.preventDefault();
    e.stopPropagation();
    let {model} = this.props;
    model.dragOverZip = false;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
        model.selectedFile = file;
        model.didUpdate();
      } else {
        model.deployLogMessages.push({level: "error", text: "(Error: Please drop a valid zip file)"});
        model.didUpdate();
      }
    }
  }
  componentDidMount() {
    let {model} = this.props;
    let selectAll = this.refs.selectref;
    model.setSelectAll(selectAll);
  }
  render() {
    let {model} = this.props;
    document.title = model.title();
    let selectAllChecked = model.filteredMetadataObjects && model.filteredMetadataObjects.every(metadataObject => metadataObject.selected);
    return (
      h("div", {},
        h("div", {className: "object-bar"},
          h("a", {href: model.sfLink, className: "sf-link"},
            h("svg", {viewBox: "0 0 24 24"},
              h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
            ),
            " Salesforce Home"
          ),
          h("span", {className: "progress progress-" + (model.progress == "working" ? model.progress : model.deployProgress)},
            model.progress == "working" ? "Downloading..."
            : model.deployProgress == "working" ? "Deploying..."
            : model.progress == "done" || model.deployProgress == "done" ? "Finished"
            : model.progress == "error" || model.deployProgress == "error" ? "Error!"
            : "Ready"
          )
        ),
        h("div", {className: "body"},
          h("h1", {}, "Data Model"),
          h("button", {onClick: this.onClickDataModel, disabled: (model.progress == "working" || model.deployProgress == "working"), title: "Download Data Model"},
            h("svg", {className: "download-icon"},
              h("use", {xlinkHref: "symbols.svg#download"})
            )
          ),
          h("h1", {}, "Upload Metadata"),
          h("div", {},
            h("div", {
              onDragOver: this.onDragOverZip,
              onDragLeave: this.onDragLeaveZip,
              onDrop: this.onDropZip,
              className: "drag-drop-zone" + (model.dragOverZip ? " drag-over" : "")
            },
            h("p", {className: "slds-text-heading_small slds-m-bottom_x-small"}, "Drop zip file here or"),
            h("label", {htmlFor: "zipFile", className: "slds-button slds-button_link"}, "click to browse"),
            h("input", {
              id: "zipFile",
              name: "zipFile",
              type: "file",
              accept: ".zip",
              onChange: this.onFileChange,
              disabled: (model.deployProgress == "working"),
              className: "file-input-hidden"
            }),
            model.selectedFile ? h("p", {className: "slds-text-body_small slds-m-top_x-small slds-text-color_weak"}, "Selected: " + model.selectedFile.name) : null
            ),
            h("button", {
              onClick: this.onToggleDeployOptions,
              disabled: (model.deployProgress == "working"),
              className: "slds-button slds-button_neutral slds-m-top_small slds-m-bottom_small"
            }, model.showDeployOptions ? "Hide Deploy Options" : "Show Deploy Options"),
            model.showDeployOptions ? h("div", {className: "slds-card slds-m-top_small slds-m-bottom_small"},
              h("h3", {className: "slds-text-heading_small slds-m-bottom_small"}, "Deploy Options"),
              h("label", {className: "slds-checkbox slds-m-top_x-small"},
                h("input", {
                  type: "checkbox",
                  checked: model.checkOnly,
                  onChange: e => this.onDeployOptionChange("checkOnly", e.target.checked),
                  disabled: (model.deployProgress == "working"),
                  className: "slds-checkbox__input"
                }),
                h("span", {className: "slds-checkbox__label"}, " Check only (validate without deploying)")
              ),
              h("label", {className: "slds-checkbox slds-m-top_x-small"},
                h("input", {
                  type: "checkbox",
                  checked: model.allowMissingFiles,
                  onChange: e => this.onDeployOptionChange("allowMissingFiles", e.target.checked),
                  disabled: (model.deployProgress == "working"),
                  className: "slds-checkbox__input"
                }),
                h("span", {className: "slds-checkbox__label"}, " Allow missing files")
              ),
              h("label", {className: "slds-checkbox slds-m-top_x-small"},
                h("input", {
                  type: "checkbox",
                  checked: model.ignoreWarnings,
                  onChange: e => this.onDeployOptionChange("ignoreWarnings", e.target.checked),
                  disabled: (model.deployProgress == "working"),
                  className: "slds-checkbox__input"
                }),
                h("span", {className: "slds-checkbox__label"}, " Ignore warnings")
              ),
              h("label", {className: "slds-checkbox slds-m-top_x-small"},
                h("input", {
                  type: "checkbox",
                  checked: model.performRetrieve,
                  onChange: e => this.onDeployOptionChange("performRetrieve", e.target.checked),
                  disabled: (model.deployProgress == "working"),
                  className: "slds-checkbox__input"
                }),
                h("span", {className: "slds-checkbox__label"}, " Perform retrieve")
              ),
              h("label", {className: "slds-checkbox slds-m-top_x-small"},
                h("input", {
                  type: "checkbox",
                  checked: model.purgeOnDelete,
                  onChange: e => this.onDeployOptionChange("purgeOnDelete", e.target.checked),
                  disabled: (model.deployProgress == "working"),
                  className: "slds-checkbox__input"
                }),
                h("span", {className: "slds-checkbox__label"}, " Purge on delete")
              ),
              h("label", {className: "slds-checkbox slds-m-top_x-small"},
                h("input", {
                  type: "checkbox",
                  checked: model.rollbackOnError,
                  onChange: e => this.onDeployOptionChange("rollbackOnError", e.target.checked),
                  disabled: (model.deployProgress == "working"),
                  className: "slds-checkbox__input"
                }),
                h("span", {className: "slds-checkbox__label"}, " Rollback on error")
              ),
              h("label", {className: "slds-checkbox slds-m-top_x-small"},
                h("input", {
                  type: "checkbox",
                  checked: model.singlePackage,
                  onChange: e => this.onDeployOptionChange("singlePackage", e.target.checked),
                  disabled: (model.deployProgress == "working"),
                  className: "slds-checkbox__input"
                }),
                h("span", {className: "slds-checkbox__label"}, " Single package")
              ),
              h("div", {className: "slds-form-element slds-m-top_x-small"},
                h("label", {className: "slds-form-element__label"}, "Test Level:"),
                h("div", {className: "slds-form-element__control"},
                  h("select", {
                    value: model.testLevel,
                    onChange: e => this.onDeployOptionChange("testLevel", e.target.value),
                    disabled: (model.deployProgress == "working"),
                    className: "slds-select"
                  },
                  h("option", {value: "NoTestRun"}, "NoTestRun"),
                  h("option", {value: "RunSpecifiedTests"}, "RunSpecifiedTests"),
                  h("option", {value: "RunLocalTests"}, "RunLocalTests"),
                  h("option", {value: "RunAllTestsInOrg"}, "RunAllTestsInOrg")
                  )
                )
              ),
              h("div", {className: "slds-form-element slds-m-top_x-small"},
                h("label", {className: "slds-form-element__label"}, "Run Tests (comma-separated, for RunSpecifiedTests):"),
                h("div", {className: "slds-form-element__control"},
                  h("input", {
                    type: "text",
                    value: model.runTests,
                    onChange: e => this.onDeployOptionChange("runTests", e.target.value),
                    disabled: (model.deployProgress == "working" || model.testLevel !== "RunSpecifiedTests"),
                    placeholder: "e.g., MyTestClass1, MyTestClass2",
                    className: "slds-input"
                  })
                )
              )
            ) : null,
            h("br", {}),
            h("button", {onClick: this.onDeployClick, disabled: (model.deployProgress == "working" || !model.selectedFile)}, "Deploy metadata"),
            h("br", {}),
            model.deployStatusLink ? h("a", {href: model.deployStatusLink, download: "deployStatus.json", className: "button"}, "Save deployment status") : null,
            h("div", {},
              model.deployLogMessages.map(({level, text}, index) => h("div", {key: index, className: "log-" + level}, text))
            )
          ),
          h("h1", {}, "Download Metadata"),
          h("div", {hidden: !model.metadataObjects},
            h("div", {className: "package-xml-tools"},
              h("h3", {className: "slds-text-heading_small slds-m-bottom_small"}, "Package.xml Tools"),
              h("div", {
                onDragOver: this.onDragOverPackageXml,
                onDragLeave: this.onDragLeavePackageXml,
                onDrop: this.onDropPackageXml,
                className: "drag-drop-zone" + (model.dragOverPackageXml ? " drag-over" : "")
              },
              h("p", {className: "slds-text-body_regular slds-m-bottom_x-small slds-text-color_weak"}, "Drop package.xml here or"),
              h("label", {
                htmlFor: "packageXmlFile",
                className: "slds-button slds-button_link"
              }, "click to browse"),
              h("input", {
                id: "packageXmlFile",
                name: "packageXmlFile",
                type: "file",
                accept: ".xml",
                onChange: this.onImportPackageXml,
                disabled: (model.progress == "working" || model.deployProgress == "working"),
                className: "file-input-hidden"
              })
              ),
              h("div", {className: "slds-m-top_small"},
                h("button", {
                  onClick: this.onGeneratePackageXml,
                  disabled: (model.progress == "working" || model.deployProgress == "working" || !model.metadataObjects),
                  className: "slds-button slds-button_brand"
                }, "Generate Package.xml")
              )
            ),
            model.downloadLink ? h("div", {className: "slds-m-bottom_small"},
              h("a", {href: model.downloadLink, download: "metadata.zip", className: "button slds-m-right_x-small"}, "Save downloaded metadata"),
              model.statusLink ? h("a", {href: model.statusLink, download: "status.json", className: "button"}, "Save status info") : null
            ) : null,
            h("div", {className: "slds-grid slds-grid_align-spread slds-gutters slds-m-bottom_small slds-wrap"},
              h("label", {htmlFor: "search-text", className: "slds-form-element__label"}, "Search:"),
              h("input", {
                id: "searchText",
                name: "searchText",
                ref: "searchText",
                placeholder: "Filter metadata",
                type: "search",
                value: model.searchValue,
                onInput: this.onSearchInput,
                className: "slds-input"
              }),
              h("label", {className: "slds-checkbox"},
                h("input", {type: "checkbox", ref: "selectref", checked: selectAllChecked, onChange: this.onSelectAllChange, className: "slds-checkbox__input"}),
                h("span", {className: "slds-checkbox__label"}, "Select all")
              )
            ),
            h("p", {className: "slds-text-body_regular slds-m-bottom_small slds-text-color_weak"}, "Select what to download above, and then click the button below. If downloading fails, try unchecking some of the boxes."),
            h("div", {className: "slds-grid slds-grid_align-spread slds-gutters slds-m-bottom_small slds-wrap"},
              h("button", {
                onClick: this.onStartClick,
                disabled: (model.progress == "working" || model.deployProgress == "working"),
                className: "slds-button slds-button_brand"
              }, "Create metadata package"),
              h("label", {className: "slds-checkbox"},
                h("input", {type: "checkbox", checked: model.downloadAuto, onChange: this.onDownloadAutoChange, className: "slds-checkbox__input"}),
                h("span", {className: "slds-checkbox__label"}, "Download package when ready")
              )
            ),
            model.metadataObjects
              ? h("div", {},
                h("div", {className: "slds-grid slds-wrap"},
                  model.filteredMetadataObjects.map(metadataObject => h(ObjectSelector, {key: metadataObject.xmlName, metadataObject, model}))
                )
              )
              : h("div", {}, model.logMessages.map(({level, text}, index) => h("div", {key: index, className: "log-" + level}, text)))
          )
        )
      )
    );
  }
}

class ObjectSelector extends React.Component {
  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
  }
  onChange(e) {
    let {metadataObject, model} = this.props;
    metadataObject.selected = e.target.checked;
    if (model.selectAll && model.filteredMetadataObjects) {
      model.selectAll.indeterminate = (model.filteredMetadataObjects.some(metadataObject => metadataObject.selected) && model.filteredMetadataObjects.some(metadataObject => !metadataObject.selected));
    }
    model.didUpdate();
  }
  render() {
    let {metadataObject} = this.props;
    return h("div", {className: "slds-col slds-size_3-of-12"}, h("label", {title: metadataObject.xmlName},
      h("input", {type: "checkbox", checked: metadataObject.selected, onChange: this.onChange}),
      metadataObject.directoryName
    ));
  }
}

{

  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {

    let root = document.getElementById("root");
    let model = new Model(sfHost);
    model.startLoading();
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

  });

}
