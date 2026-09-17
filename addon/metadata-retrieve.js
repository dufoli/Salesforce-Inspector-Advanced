/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {RecordTable} from "./record-table.js";
/* global initButton */

// Fallback list used when the org has no existing Translations metadata to discover languages from.
// https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_customobjecttranslation.htm
const defaultTranslationLanguages = [
  {code: "ar", label: "Arabic"},
  {code: "bg", label: "Bulgarian"},
  {code: "ca", label: "Catalan"},
  {code: "zh_CN", label: "Chinese (Simplified)"},
  {code: "zh_TW", label: "Chinese (Traditional)"},
  {code: "hr", label: "Croatian"},
  {code: "cs", label: "Czech"},
  {code: "da", label: "Danish"},
  {code: "nl_NL", label: "Dutch"},
  {code: "en_US", label: "English (US)"},
  {code: "en_GB", label: "English (UK)"},
  {code: "fi", label: "Finnish"},
  {code: "fr", label: "French"},
  {code: "de", label: "German"},
  {code: "el", label: "Greek"},
  {code: "iw", label: "Hebrew"},
  {code: "hu", label: "Hungarian"},
  {code: "in", label: "Indonesian"},
  {code: "it", label: "Italian"},
  {code: "ja", label: "Japanese"},
  {code: "ko", label: "Korean"},
  {code: "no", label: "Norwegian"},
  {code: "pl", label: "Polish"},
  {code: "pt_BR", label: "Portuguese (Brazil)"},
  {code: "pt_PT", label: "Portuguese (Portugal)"},
  {code: "ro", label: "Romanian"},
  {code: "ru", label: "Russian"},
  {code: "sk", label: "Slovak"},
  {code: "sl", label: "Slovenian"},
  {code: "es", label: "Spanish"},
  {code: "es_MX", label: "Spanish (Mexico)"},
  {code: "sv", label: "Swedish"},
  {code: "th", label: "Thai"},
  {code: "tr", label: "Turkish"},
  {code: "uk", label: "Ukrainian"},
  {code: "vi", label: "Vietnamese"}
];

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

let timeout = ms => new Promise(resolve => setTimeout(resolve, ms));

class Model {
  constructor(sfHost) {
    this.reactCallback = null;

    this.sfLink = "https://" + sfHost;

    // Metadata type catalog (from describeMetadata), used by the type autosuggest and package.xml expansion
    this.metadataTypeCatalog = null;

    // Download Metadata: filters
    this.selectedTypes = [];
    this.typeFilterInput = "";
    this.typeSuggestions = [];
    this.showTypeSuggestions = false;
    this.nameContains = "";
    this.modifiedFrom = "";
    this.modifiedTo = "";
    this.modifiedByInput = "";
    this.modifiedBySuggestions = [];
    this.showModifiedBySuggestions = false;
    this.userCatalog = null;
    this.userCatalogLoading = false;

    // Download Metadata: search results
    this.searchResults = null;
    this.searchProgress = "ready";
    this.searchLogMessages = [];

    // Download Metadata: retrieve / download
    this.logMessages = [];
    this.progress = "ready";
    this.downloadLink = null;
    this.statusLink = null;
    this.downloadAuto = false;
    this.dragOverPackageXml = false;
    this.downloadMode = "filter"; // "filter" (search & filter metadata) or "upload" (import an existing package.xml)

    // Translation download state
    this.translationLanguages = null;
    this.existingTranslationLanguageCodes = null;
    this.selectedTranslationLanguage = "";
    this.objectsForTranslation = null;
    this.filteredObjectsForTranslation = null;
    this.objectSearchValue = "";
    this.translationProgress = "ready";
    this.translationLogMessages = [];
    this.translationDownloadLink = null;
    this.translationStatusLink = null;

    // Deploy state
    this.deployProgress = "ready";
    this.deployLogMessages = [];
    this.selectedFile = null;
    this.deployStatusLink = null;
    this.showDeployOptions = false;
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

  title() {
    if (this.progress == "working") {
      return "(Loading) Download Metadata";
    }
    if (this.searchProgress == "working") {
      return "(Searching) Download Metadata";
    }
    if (this.deployProgress == "working") {
      return "(Deploying) Upload Metadata";
    }
    if (this.translationProgress == "working") {
      return "(Loading) Download Translations";
    }
    return "Metadata Retrieve";
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
    let self = this;
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
    let BOM = "﻿";
    let rt = new RecordTable();
    rt.addToTable(fieldsFesult.rows);
    let bb = new Blob([BOM, rt.csvSerialize(separator)], {type: "text/csv;charset=utf-8"});
    downloadLink.href = window.URL.createObjectURL(bb);
    downloadLink.click();
    this.progress = "done";
    this.didUpdate();
  }

  // ----- Metadata type catalog -----

  async loadMetadataTypeCatalog() {
    try {
      this.progress = "working";
      this.didUpdate();
      let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
      let res = await this.logWait(
        "DescribeMetadata",
        sfConn.soap(metadataApi, "describeMetadata", {apiVersion})
      );
      this.metadataTypeCatalog = sfConn.asArray(res.metadataObjects)
        .filter(metadataObject => metadataObject.xmlName != "InstalledPackage");
      this.progress = "ready";
      this.didUpdate();
    } catch (e) {
      this.logError(e);
    }
  }

  // ----- Metadata Type filter (multi-select autosuggest) -----

  updateTypeSuggestions() {
    if (!this.metadataTypeCatalog) {
      this.typeSuggestions = [];
      return;
    }
    let kw = this.typeFilterInput.trim().toLowerCase();
    this.typeSuggestions = this.metadataTypeCatalog
      .filter(metadataObject => !this.selectedTypes.includes(metadataObject.xmlName))
      .filter(metadataObject => !kw
        || metadataObject.xmlName.toLowerCase().includes(kw)
        || metadataObject.directoryName.toLowerCase().includes(kw))
      .sort((a, b) => a.xmlName < b.xmlName ? -1 : a.xmlName > b.xmlName ? 1 : 0)
      .slice(0, 50);
  }
  onTypeFilterInput(text) {
    this.typeFilterInput = text;
    this.updateTypeSuggestions();
  }
  onTypeFilterFocus() {
    this.showTypeSuggestions = true;
    this.updateTypeSuggestions();
  }
  onTypeFilterBlur() {
    this.showTypeSuggestions = false;
  }
  addSelectedType(xmlName) {
    if (!this.selectedTypes.includes(xmlName)) {
      this.selectedTypes.push(xmlName);
    }
    this.typeFilterInput = "";
    this.updateTypeSuggestions();
  }
  removeSelectedType(xmlName) {
    this.selectedTypes = this.selectedTypes.filter(t => t != xmlName);
    this.updateTypeSuggestions();
  }

  // ----- Modified By filter (autosuggest of users) -----

  async loadUserCatalogIfNeeded() {
    if (this.userCatalog || this.userCatalogLoading) {
      return;
    }
    this.userCatalogLoading = true;
    try {
      let query = "SELECT Name FROM User ORDER BY Name LIMIT 2000";
      let res = await sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query), {});
      this.userCatalog = (res.records || []).map(u => u.Name);
    } catch (e) {
      this.userCatalog = [];
    }
    this.userCatalogLoading = false;
    this.updateModifiedBySuggestions();
    this.didUpdate();
  }
  updateModifiedBySuggestions() {
    if (!this.userCatalog) {
      this.modifiedBySuggestions = [];
      return;
    }
    let kw = this.modifiedByInput.trim().toLowerCase();
    this.modifiedBySuggestions = !kw
      ? this.userCatalog.slice(0, 20)
      : this.userCatalog.filter(name => name.toLowerCase().includes(kw)).slice(0, 20);
  }
  onModifiedByInput(text) {
    this.modifiedByInput = text;
    this.updateModifiedBySuggestions();
  }
  onModifiedByFocus() {
    this.showModifiedBySuggestions = true;
    this.loadUserCatalogIfNeeded();
    this.updateModifiedBySuggestions();
  }
  onModifiedByBlur() {
    this.showModifiedBySuggestions = false;
  }
  selectModifiedByUser(name) {
    this.modifiedByInput = name;
    this.showModifiedBySuggestions = false;
  }

  clearFilters() {
    this.selectedTypes = [];
    this.typeFilterInput = "";
    this.nameContains = "";
    this.modifiedFrom = "";
    this.modifiedTo = "";
    this.modifiedByInput = "";
    this.searchResults = null;
    this.searchProgress = "ready";
    this.searchLogMessages = [];
    this.didUpdate();
  }

  // ----- Search (lists actual metadata components matching the filters) -----

  logWaitSearch(msg, promise) {
    let message = {level: "working", text: msg};
    this.searchLogMessages.push(message);
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

  async runSearch() {
    if (this.selectedTypes.length === 0) {
      this.searchLogMessages = [{level: "error", text: "(Please select at least one metadata type)"}];
      this.didUpdate();
      return;
    }
    let logWait = this.logWaitSearch.bind(this);
    try {
      this.searchProgress = "working";
      this.searchResults = null;
      this.searchLogMessages = [];
      this.didUpdate();

      let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
      let selectedCatalogEntries = this.metadataTypeCatalog
        .filter(metadataObject => this.selectedTypes.includes(metadataObject.xmlName));
      let folderMap = {};
      let xmlNameGroups = selectedCatalogEntries.map(metadataObject => {
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
      let xmlNames = flattenArray(xmlNameGroups);

      let resultGroups = await Promise.all(groupByThree(xmlNames).map(async xmlNamesGroup => {
        let someItems = sfConn.asArray(await logWait(
          "ListMetadata " + xmlNamesGroup.join(", "),
          sfConn.soap(metadataApi, "listMetadata", {queries: xmlNamesGroup.map(xmlName => ({type: xmlName}))})
        ));
        let folders = someItems.filter(item => folderMap[item.type]);
        let nonFolders = someItems.filter(item => !folderMap[item.type]);
        let folderContents = await Promise.all(groupByThree(folders).map(async folderGroup =>
          sfConn.asArray(await logWait(
            "ListMetadata " + folderGroup.map(folder => folderMap[folder.type] + "/" + folder.fullName).join(", "),
            sfConn.soap(metadataApi, "listMetadata", {queries: folderGroup.map(folder => ({type: folderMap[folder.type], folder: folder.fullName}))})
          ))
        ));
        return nonFolders.concat(flattenArray(folderContents));
      }));
      let items = flattenArray(resultGroups);

      let nameKw = this.nameContains.trim().toLowerCase();
      let byKw = this.modifiedByInput.trim().toLowerCase();
      let fromDate = this.modifiedFrom ? new Date(this.modifiedFrom + "T00:00:00") : null;
      let toDate = this.modifiedTo ? new Date(this.modifiedTo + "T23:59:59") : null;

      let filtered = items.filter(item => {
        if (nameKw && !(item.fullName || "").toLowerCase().includes(nameKw)) {
          return false;
        }
        if (byKw && !(item.lastModifiedByName || "").toLowerCase().includes(byKw)) {
          return false;
        }
        if (fromDate || toDate) {
          if (!item.lastModifiedDate) {
            return false;
          }
          let d = new Date(item.lastModifiedDate);
          if (fromDate && d < fromDate) {
            return false;
          }
          if (toDate && d > toDate) {
            return false;
          }
        }
        return true;
      });

      filtered.sort((a, b) => {
        let ka = a.type + "~" + a.fullName;
        let kb = b.type + "~" + b.fullName;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });

      this.searchResults = filtered.map(item => ({
        type: item.type,
        fullName: item.fullName,
        lastModifiedByName: item.lastModifiedByName || "",
        lastModifiedDate: item.lastModifiedDate || "",
        selected: false
      }));
      this.searchProgress = "done";
      this.didUpdate();
    } catch (e) {
      this.searchProgress = "error";
      console.error(e);
      this.searchLogMessages.push({level: "error", text: "(Error: " + e.message + ")"});
      this.didUpdate();
    }
  }

  toggleResultSelected(row, checked) {
    row.selected = checked;
    this.didUpdate();
  }
  toggleSelectAllResults(checked) {
    if (!this.searchResults) {
      return;
    }
    for (let row of this.searchResults) {
      row.selected = checked;
    }
    this.didUpdate();
  }

  getSelectedResultsTypeMap() {
    let selected = (this.searchResults || []).filter(row => row.selected);
    let typeMap = {};
    for (let row of selected) {
      if (!typeMap[row.type]) {
        typeMap[row.type] = [];
      }
      typeMap[row.type].push(row.fullName);
    }
    return typeMap;
  }

  buildPackageXml(typeMap) {
    let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    xml += "<Package xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n";
    let sortedTypes = Object.keys(typeMap).sort();
    for (let typeName of sortedTypes) {
      xml += "    <types>\n";
      for (let member of typeMap[typeName]) {
        xml += "        <members>" + member + "</members>\n";
      }
      xml += "        <name>" + typeName + "</name>\n";
      xml += "    </types>\n";
    }
    xml += "    <version>" + apiVersion + "</version>\n";
    xml += "</Package>";
    return xml;
  }

  generatePackageXmlFromResults() {
    let typeMap = this.getSelectedResultsTypeMap();
    if (Object.keys(typeMap).length === 0) {
      this.searchLogMessages.push({level: "error", text: "(Error: Please select at least one metadata item)"});
      this.didUpdate();
      return;
    }
    let xml = this.buildPackageXml(typeMap);
    let downloadLink = document.createElement("a");
    downloadLink.download = "package.xml";
    downloadLink.href = window.URL.createObjectURL(new Blob([xml], {type: "application/xml"}));
    downloadLink.click();
    this.searchLogMessages.push({level: "info", text: "(package.xml generated successfully)"});
    this.didUpdate();
  }

  async startDownloadSelectedResults() {
    let typeMap = this.getSelectedResultsTypeMap();
    if (Object.keys(typeMap).length === 0) {
      this.searchLogMessages.push({level: "error", text: "(Error: Please select at least one metadata item)"});
      this.didUpdate();
      return;
    }
    let types = Object.keys(typeMap).sort().map(name => ({name, members: typeMap[name]}));
    await this.performRetrieve(types);
  }

  // ----- package.xml import (downloads directly, without going through Search) -----

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

  async resolveWildcardTypes(typeEntries) {
    let exactEntries = typeEntries.filter(entry => !entry.members.includes("*"));
    let wildcardNames = typeEntries.filter(entry => entry.members.includes("*")).map(entry => entry.name);
    if (wildcardNames.length === 0) {
      return exactEntries;
    }
    if (!this.metadataTypeCatalog) {
      await this.loadMetadataTypeCatalog();
    }
    let catalogByName = {};
    for (let metadataObject of this.metadataTypeCatalog || []) {
      catalogByName[metadataObject.xmlName] = metadataObject;
    }
    let folderMap = {};
    let xmlNames = wildcardNames.map(xmlName => {
      let metadataObject = catalogByName[xmlName];
      if (metadataObject && metadataObject.inFolder == "true") {
        if (xmlName == "EmailTemplate") {
          folderMap["EmailFolder"] = "EmailTemplate";
          return "EmailFolder";
        }
        folderMap[xmlName + "Folder"] = xmlName;
        return xmlName + "Folder";
      }
      return xmlName;
    });

    let logWait = this.logWait.bind(this);
    let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
    let resultGroups = await Promise.all(groupByThree(xmlNames).map(async xmlNamesGroup => {
      let someItems = sfConn.asArray(await logWait(
        "ListMetadata " + xmlNamesGroup.join(", "),
        sfConn.soap(metadataApi, "listMetadata", {queries: xmlNamesGroup.map(xmlName => ({type: xmlName}))})
      ));
      let folders = someItems.filter(item => folderMap[item.type]);
      let nonFolders = someItems.filter(item => !folderMap[item.type]);
      let folderContents = await Promise.all(groupByThree(folders).map(async folderGroup =>
        sfConn.asArray(await logWait(
          "ListMetadata " + folderGroup.map(folder => folderMap[folder.type] + "/" + folder.fullName).join(", "),
          sfConn.soap(metadataApi, "listMetadata", {queries: folderGroup.map(folder => ({type: folderMap[folder.type], folder: folder.fullName}))})
        ))
      ));
      return {
        items: nonFolders.concat(flattenArray(folderContents)),
        folderContainers: folders.map(folder => ({type: folderMap[folder.type], fullName: folder.fullName}))
      };
    }));

    let expandedTypeMap = {};
    for (let name of wildcardNames) {
      expandedTypeMap[name] = new Set(["*"]);
    }
    for (let group of resultGroups) {
      for (let item of group.items) {
        if (!expandedTypeMap[item.type]) {
          expandedTypeMap[item.type] = new Set();
        }
        expandedTypeMap[item.type].add(item.fullName);
      }
      for (let container of group.folderContainers) {
        if (!expandedTypeMap[container.type]) {
          expandedTypeMap[container.type] = new Set();
        }
        expandedTypeMap[container.type].add(container.fullName);
      }
    }
    let expandedEntries = Object.keys(expandedTypeMap).map(name => ({name, members: [...expandedTypeMap[name]]}));
    return exactEntries.concat(expandedEntries);
  }

  async importPackageXml(file) {
    try {
      this.progress = "working";
      this.downloadLink = null;
      this.statusLink = null;
      this.logMessages = [{level: "info", text: "(Reading package.xml file)"}];
      this.didUpdate();

      const xmlContent = await this.readPackageXmlFile(file);
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, "text/xml");

      const parseError = xmlDoc.querySelector("parsererror");
      if (parseError) {
        throw new Error("Invalid XML format: " + parseError.textContent);
      }
      const packageElement = xmlDoc.querySelector("Package");
      if (!packageElement) {
        throw new Error("Invalid package.xml: Package element not found");
      }
      const typeElements = packageElement.querySelectorAll("types");
      let typeEntries = [];
      for (let typeElement of typeElements) {
        const nameEl = typeElement.querySelector("name");
        if (!nameEl) {
          continue;
        }
        const members = [...typeElement.querySelectorAll("members")].map(m => m.textContent.trim()).filter(Boolean);
        typeEntries.push({name: nameEl.textContent.trim(), members: members.length ? members : ["*"]});
      }
      if (typeEntries.length === 0) {
        throw new Error("No <types> found in package.xml");
      }

      this.logMessages.push({level: "info", text: "(Found " + typeEntries.length + " metadata type(s) in package.xml)"});
      this.didUpdate();

      let resolvedTypes = await this.resolveWildcardTypes(typeEntries);
      await this.performRetrieve(resolvedTypes);
    } catch (e) {
      this.logError(e);
    }
  }

  // ----- Shared retrieve (SOAP retrieve + poll + zip) -----

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

  async performRetrieve(types) {
    let logWait = this.logWait.bind(this);
    try {
      this.progress = "working";
      this.downloadLink = null;
      this.statusLink = null;
      this.didUpdate();

      let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
      let result = await logWait(
        "Retrieve",
        sfConn.soap(metadataApi, "retrieve", {retrieveRequest: {apiVersion, unpackaged: {types, version: apiVersion}}})
      );
      this.logMessages.push({level: "info", text: "(Id: " + result.id + ")"});
      this.didUpdate();
      let res;
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
      this.logMessages.push({level: "info", text: "(Finished)"});
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
  }

  // ----- Translations -----

  async loadTranslationOptions() {
    if (this.objectsForTranslation) {
      return;
    }
    try {
      let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
      let languagesPromise = sfConn.soap(metadataApi, "listMetadata", {queries: [{type: "Translations"}]})
        .catch(e => {
          console.log(e);
          this.translationLogMessages.push({level: "info", text: "(Translation disabled on org)"});
          return [];
        });
      let [languagesRes, sobjectsRes] = await Promise.all([
        languagesPromise,
        sfConn.rest("/services/data/v" + apiVersion + "/sobjects/", {})
      ]);
      let existingLanguageCodes = sfConn.asArray(languagesRes).map(l => l.fullName).filter(Boolean);
      this.existingTranslationLanguageCodes = existingLanguageCodes;
      let languageCodes = existingLanguageCodes.length > 0 ? existingLanguageCodes : defaultTranslationLanguages.map(l => l.code);
      this.translationLanguages = languageCodes
        .map(code => ({code, label: (defaultTranslationLanguages.find(l => l.code == code) || {label: code}).label}))
        .sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
      if (!this.selectedTranslationLanguage && this.translationLanguages.length > 0) {
        this.selectedTranslationLanguage = this.translationLanguages[0].code;
      }
      this.objectsForTranslation = sobjectsRes.sobjects
        .map(sobject => ({name: sobject.name, label: sobject.label, selected: false}))
        .sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
      this.filteredObjectsForTranslation = this.objectsForTranslation;
    } catch (e) {
      this.logTranslationError(e);
    }
    this.didUpdate();
  }

  filterObjectsForTranslation(searchKeyword) {
    this.objectSearchValue = searchKeyword;
    this.filteredObjectsForTranslation = this.objectsForTranslation
      .filter(sobject => sobject.name.toLowerCase().includes(searchKeyword)
      || sobject.label.toLowerCase().includes(searchKeyword));
  }

  startDownloadingTranslations() {
    let logWait = this.logWaitTranslation.bind(this);
    (async () => {
      try {
        if (!this.selectedTranslationLanguage) {
          throw new Error("Please select a language");
        }
        let selectedObjects = (this.objectsForTranslation || []).filter(sobject => sobject.selected);
        if (selectedObjects.length === 0) {
          throw new Error("Please select at least one object");
        }
        this.translationProgress = "working";
        this.translationDownloadLink = null;
        this.translationStatusLink = null;
        this.translationLogMessages = [];
        this.didUpdate();

        let metadataApi = sfConn.wsdl(apiVersion, "Metadata");
        let types = [
          {name: "CustomObjectTranslation", members: selectedObjects.map(sobject => sobject.name + "-" + this.selectedTranslationLanguage)}
        ];
        if ((this.existingTranslationLanguageCodes || []).includes(this.selectedTranslationLanguage)) {
          types.push({name: "Translations", members: [this.selectedTranslationLanguage]});
        } else {
          this.translationLogMessages.push({level: "info", text: "(Skipping global Translations: \"" + this.selectedTranslationLanguage + "\" is not an active Translation Workbench language in this org)"});
          this.didUpdate();
        }
        let result = await logWait(
          "Retrieve",
          sfConn.soap(metadataApi, "retrieve", {retrieveRequest: {apiVersion, unpackaged: {types, version: apiVersion}}})
        );
        this.translationLogMessages.push({level: "info", text: "(Id: " + result.id + ")"});
        this.didUpdate();
        let res;
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
        this.translationLogMessages.push({level: "info", text: "(Finished)"});
        let zipBin = Uint8Array.from(atob(res.zipFile), c => c.charCodeAt(0));
        this.translationDownloadLink = URL.createObjectURL(new Blob([zipBin], {type: "application/zip"}));
        this.translationStatusLink = URL.createObjectURL(new Blob([statusJson], {type: "application/json"}));
        this.translationProgress = "done";
        this.didUpdate();
      } catch (e) {
        this.logTranslationError(e);
      }
    })();
  }

  logWaitTranslation(msg, promise) {
    let message = {level: "working", text: msg};
    this.translationLogMessages.push(message);
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

  logTranslationError(err) {
    this.translationProgress = "error";
    console.error(err);
    let msg;
    if (err.message == "Retrieve failed") {
      msg = "(Error: Retrieve failed: " + JSON.stringify(err.result) + ")";
    } else {
      msg = "(Error: " + err.message + ")";
    }
    this.translationLogMessages.push({level: "error", text: msg});
    this.didUpdate();
  }

  // ----- Deploy (Upload Metadata) -----

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

let h = React.createElement;

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {activeTab: "download"};
    this.onSetTab = this.onSetTab.bind(this);
    // Download Metadata tab
    this.onTypeFilterChange = this.onTypeFilterChange.bind(this);
    this.onTypeFilterFocus = this.onTypeFilterFocus.bind(this);
    this.onTypeFilterBlur = this.onTypeFilterBlur.bind(this);
    this.onTypeFilterKeyDown = this.onTypeFilterKeyDown.bind(this);
    this.onAddType = this.onAddType.bind(this);
    this.onRemoveType = this.onRemoveType.bind(this);
    this.onNameContainsChange = this.onNameContainsChange.bind(this);
    this.onModifiedFromChange = this.onModifiedFromChange.bind(this);
    this.onModifiedToChange = this.onModifiedToChange.bind(this);
    this.onModifiedByChange = this.onModifiedByChange.bind(this);
    this.onModifiedByFocus = this.onModifiedByFocus.bind(this);
    this.onModifiedByBlur = this.onModifiedByBlur.bind(this);
    this.onSelectModifiedBy = this.onSelectModifiedBy.bind(this);
    this.onClearFilters = this.onClearFilters.bind(this);
    this.onSearchClick = this.onSearchClick.bind(this);
    this.onSelectAllResultsChange = this.onSelectAllResultsChange.bind(this);
    this.onToggleResultRow = this.onToggleResultRow.bind(this);
    this.onGeneratePackageXmlFromResults = this.onGeneratePackageXmlFromResults.bind(this);
    this.onDownloadSelectedResults = this.onDownloadSelectedResults.bind(this);
    this.onDownloadAutoChange = this.onDownloadAutoChange.bind(this);
    this.onImportPackageXml = this.onImportPackageXml.bind(this);
    this.onDragOverPackageXml = this.onDragOverPackageXml.bind(this);
    this.onDragLeavePackageXml = this.onDragLeavePackageXml.bind(this);
    this.onDropPackageXml = this.onDropPackageXml.bind(this);
    this.onClickDataModel = this.onClickDataModel.bind(this);
    this.onSetDownloadMode = this.onSetDownloadMode.bind(this);
    // Upload Metadata tab
    this.onFileChange = this.onFileChange.bind(this);
    this.onDeployClick = this.onDeployClick.bind(this);
    this.onToggleDeployOptions = this.onToggleDeployOptions.bind(this);
    this.onDeployOptionChange = this.onDeployOptionChange.bind(this);
    this.onDragOverZip = this.onDragOverZip.bind(this);
    this.onDragLeaveZip = this.onDragLeaveZip.bind(this);
    this.onDropZip = this.onDropZip.bind(this);
    // Download Translation tab
    this.onTranslationLanguageChange = this.onTranslationLanguageChange.bind(this);
    this.onTranslationSearchInput = this.onTranslationSearchInput.bind(this);
    this.onSelectAllTranslationObjectsChange = this.onSelectAllTranslationObjectsChange.bind(this);
    this.onStartTranslationClick = this.onStartTranslationClick.bind(this);
  }

  onSetTab(tab) {
    let {model} = this.props;
    this.setState({activeTab: tab});
    if (tab == "translation") {
      model.loadTranslationOptions();
    }
  }

  // --- Download Metadata tab handlers ---
  onTypeFilterChange(e) {
    let {model} = this.props;
    model.onTypeFilterInput(e.target.value);
    model.didUpdate();
  }
  onTypeFilterFocus() {
    let {model} = this.props;
    model.onTypeFilterFocus();
    model.didUpdate();
  }
  onTypeFilterBlur() {
    let {model} = this.props;
    setTimeout(() => {
      model.onTypeFilterBlur();
      model.didUpdate();
    }, 150);
  }
  onTypeFilterKeyDown(e) {
    let {model} = this.props;
    if (e.keyCode === 13 && model.typeSuggestions.length > 0) {
      e.preventDefault();
      model.addSelectedType(model.typeSuggestions[0].xmlName);
      model.didUpdate();
    }
  }
  onAddType(xmlName) {
    let {model} = this.props;
    model.addSelectedType(xmlName);
    model.didUpdate();
  }
  onRemoveType(xmlName) {
    let {model} = this.props;
    model.removeSelectedType(xmlName);
    model.didUpdate();
  }
  onNameContainsChange(e) {
    let {model} = this.props;
    model.nameContains = e.target.value;
    model.didUpdate();
  }
  onModifiedFromChange(e) {
    let {model} = this.props;
    model.modifiedFrom = e.target.value;
    model.didUpdate();
  }
  onModifiedToChange(e) {
    let {model} = this.props;
    model.modifiedTo = e.target.value;
    model.didUpdate();
  }
  onModifiedByChange(e) {
    let {model} = this.props;
    model.onModifiedByInput(e.target.value);
    model.didUpdate();
  }
  onModifiedByFocus() {
    let {model} = this.props;
    model.onModifiedByFocus();
    model.didUpdate();
  }
  onModifiedByBlur() {
    let {model} = this.props;
    setTimeout(() => {
      model.onModifiedByBlur();
      model.didUpdate();
    }, 150);
  }
  onSelectModifiedBy(name) {
    let {model} = this.props;
    model.selectModifiedByUser(name);
    model.didUpdate();
  }
  onClearFilters() {
    let {model} = this.props;
    model.clearFilters();
  }
  onSearchClick() {
    let {model} = this.props;
    model.runSearch();
  }
  onSelectAllResultsChange(e) {
    let {model} = this.props;
    model.toggleSelectAllResults(e.target.checked);
  }
  onToggleResultRow(row, checked) {
    let {model} = this.props;
    model.toggleResultSelected(row, checked);
  }
  onGeneratePackageXmlFromResults() {
    let {model} = this.props;
    model.generatePackageXmlFromResults();
  }
  onDownloadSelectedResults() {
    let {model} = this.props;
    model.startDownloadSelectedResults();
  }
  onDownloadAutoChange(e) {
    let {model} = this.props;
    model.downloadAuto = e.target.checked;
    model.didUpdate();
  }
  onImportPackageXml(e) {
    let {model} = this.props;
    const file = e.target.files[0];
    if (file) {
      model.importPackageXml(file);
    }
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
  onClickDataModel() {
    let {model} = this.props;
    model.downloadDataModel();
    model.didUpdate();
  }
  onSetDownloadMode(mode) {
    let {model} = this.props;
    model.downloadMode = mode;
    model.didUpdate();
  }

  // --- Upload Metadata tab handlers ---
  onFileChange(e) {
    let {model} = this.props;
    model.selectedFile = e.target.files[0] || null;
    model.didUpdate();
  }
  onDeployClick() {
    let {model} = this.props;
    model.startDeploying();
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

  // --- Download Translation tab handlers ---
  onTranslationLanguageChange(e) {
    let {model} = this.props;
    model.selectedTranslationLanguage = e.target.value;
    model.didUpdate();
  }
  onTranslationSearchInput(e) {
    let {model} = this.props;
    model.filterObjectsForTranslation(e.target.value.toLowerCase());
    model.didUpdate();
  }
  onSelectAllTranslationObjectsChange(e) {
    let {model} = this.props;
    let checked = e.target.checked;
    for (let sobject of model.filteredObjectsForTranslation) {
      sobject.selected = checked;
    }
    model.didUpdate();
  }
  onStartTranslationClick() {
    let {model} = this.props;
    model.startDownloadingTranslations();
  }

  renderRetrieveOutput() {
    let {model} = this.props;
    if (!model.downloadLink && !model.statusLink && model.logMessages.length === 0) {
      return null;
    }
    return h("div", {className: "slds-m-top_small"},
      model.downloadLink ? h("div", {className: "slds-m-bottom_small"},
        h("a", {href: model.downloadLink, download: "metadata.zip", className: "button slds-m-right_x-small"}, "Save downloaded metadata"),
        model.statusLink ? h("a", {href: model.statusLink, download: "status.json", className: "button"}, "Save status info") : null
      ) : null,
      h("div", {},
        model.logMessages.map(({level, text}, index) => h("div", {key: index, className: "log-" + level}, text))
      )
    );
  }

  renderDownloadMetadataTab() {
    let {model} = this.props;
    let allResultsSelected = model.searchResults && model.searchResults.length > 0 && model.searchResults.every(row => row.selected);
    let anySelected = model.searchResults && model.searchResults.some(row => row.selected);
    return h("div", {},
      h("div", {className: "slds-m-bottom_medium"},
        h("div", {className: "slds-form-element"},
          h("label", {className: "slds-form-element__label"}, "How do you want to pick the metadata to download?"),
          h("div", {className: "slds-button-group", role: "group", "aria-label": "Download mode"},
            h("button", {
              type: "button",
              className: "slds-button slds-button_neutral" + (model.downloadMode == "filter" ? " slds-button_brand" : ""),
              "aria-pressed": model.downloadMode == "filter" ? "true" : "false",
              onClick: () => this.onSetDownloadMode("filter")
            }, "Search & filter"),
            h("button", {
              type: "button",
              className: "slds-button slds-button_neutral" + (model.downloadMode == "upload" ? " slds-button_brand" : ""),
              "aria-pressed": model.downloadMode == "upload" ? "true" : "false",
              onClick: () => this.onSetDownloadMode("upload")
            }, "Upload a package.xml")
          )
        )
      ),

      model.downloadMode == "filter" ? h("div", {className: "filter-bar"},
        h("h3", {className: "slds-text-heading_small slds-m-bottom_small"}, "Filters"),
        h("div", {className: "slds-form-element slds-m-bottom_small"},
          h("label", {className: "slds-form-element__label", htmlFor: "metadataTypeInput"}, "Metadata Type"),
          model.selectedTypes.length > 0 ? h("div", {className: "slds-m-bottom_x-small"},
            model.selectedTypes.map(xmlName => h("span", {className: "filter-pill", key: xmlName},
              h("span", {}, xmlName),
              h("button", {type: "button", title: "Remove", onClick: () => this.onRemoveType(xmlName)},
                h("svg", {className: "slds-button__icon slds-button__icon_x-small", "aria-hidden": "true", style: {width: "0.6rem", height: "0.6rem"}},
                  h("use", {xlinkHref: "symbols.svg#close"})
                )
              )
            ))
          ) : null,
          h("div", {className: "slds-form-element__control"},
            h("div", {className: "slds-combobox_container"},
              h("div", {className: "slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click" + ((model.showTypeSuggestions && model.typeSuggestions.length) ? " slds-is-open" : "")},
                h("div", {className: "slds-combobox__form-element slds-input-has-icon slds-input-has-icon_right", role: "none"},
                  h("input", {
                    id: "metadataTypeInput",
                    type: "text",
                    className: "slds-input slds-combobox__input",
                    autoComplete: "off",
                    placeholder: model.metadataTypeCatalog ? "Search a metadata type…" : "Loading metadata types…",
                    disabled: !model.metadataTypeCatalog,
                    value: model.typeFilterInput,
                    onChange: this.onTypeFilterChange,
                    onFocus: this.onTypeFilterFocus,
                    onBlur: this.onTypeFilterBlur,
                    onKeyDown: this.onTypeFilterKeyDown
                  }),
                  h("span", {className: "slds-icon_container slds-icon-utility-search slds-input__icon slds-input__icon_right"},
                    h("svg", {className: "slds-icon slds-icon_x-small slds-icon-text-default", "aria-hidden": "true"},
                      h("use", {xlinkHref: "symbols.svg#search"})
                    )
                  )
                ),
                (model.showTypeSuggestions && model.typeSuggestions.length > 0) ? h("div", {className: "slds-dropdown slds-dropdown_length-5 slds-dropdown_fluid", role: "listbox"},
                  h("ul", {className: "slds-listbox slds-listbox_vertical", role: "presentation"},
                    model.typeSuggestions.map(metadataObject => h("li", {role: "presentation", className: "slds-listbox-item", key: metadataObject.xmlName, onMouseDown: () => this.onAddType(metadataObject.xmlName)},
                      h("div", {className: "slds-media slds-listbox__option slds-listbox__option_plain slds-media_small", role: "option"},
                        h("span", {className: "slds-media__body"},
                          h("span", {className: "slds-truncate"}, metadataObject.xmlName + (metadataObject.directoryName && metadataObject.directoryName != metadataObject.xmlName ? " (" + metadataObject.directoryName + ")" : ""))
                        )
                      )
                    ))
                  )
                ) : null
              )
            )
          )
        ),
        h("div", {className: "slds-grid slds-gutters slds-wrap"},
          h("div", {className: "slds-col slds-size_1-of-1 slds-medium-size_1-of-4 slds-form-element"},
            h("label", {className: "slds-form-element__label", htmlFor: "nameContainsInput"}, "Metadata Name"),
            h("div", {className: "slds-form-element__control"},
              h("input", {id: "nameContainsInput", type: "text", className: "slds-input", placeholder: "Contains…", value: model.nameContains, onChange: this.onNameContainsChange})
            )
          ),
          h("div", {className: "slds-col slds-size_1-of-2 slds-medium-size_1-of-4 slds-form-element"},
            h("label", {className: "slds-form-element__label", htmlFor: "modifiedFromInput"}, "Modified From"),
            h("div", {className: "slds-form-element__control"},
              h("input", {id: "modifiedFromInput", type: "date", className: "slds-input", value: model.modifiedFrom, onChange: this.onModifiedFromChange})
            )
          ),
          h("div", {className: "slds-col slds-size_1-of-2 slds-medium-size_1-of-4 slds-form-element"},
            h("label", {className: "slds-form-element__label", htmlFor: "modifiedToInput"}, "Modified To"),
            h("div", {className: "slds-form-element__control"},
              h("input", {id: "modifiedToInput", type: "date", className: "slds-input", value: model.modifiedTo, onChange: this.onModifiedToChange})
            )
          ),
          h("div", {className: "slds-col slds-size_1-of-1 slds-medium-size_1-of-4 slds-form-element"},
            h("label", {className: "slds-form-element__label", htmlFor: "modifiedByInput"}, "Modified By"),
            h("div", {className: "slds-form-element__control"},
              h("div", {className: "slds-combobox_container"},
                h("div", {className: "slds-combobox slds-dropdown-trigger slds-dropdown-trigger_click" + ((model.showModifiedBySuggestions && model.modifiedBySuggestions.length) ? " slds-is-open" : "")},
                  h("div", {className: "slds-combobox__form-element slds-input-has-icon slds-input-has-icon_right", role: "none"},
                    h("input", {
                      id: "modifiedByInput",
                      type: "text",
                      className: "slds-input slds-combobox__input",
                      autoComplete: "off",
                      placeholder: "User name…",
                      value: model.modifiedByInput,
                      onChange: this.onModifiedByChange,
                      onFocus: this.onModifiedByFocus,
                      onBlur: this.onModifiedByBlur
                    })
                  ),
                  (model.showModifiedBySuggestions && model.modifiedBySuggestions.length > 0) ? h("div", {className: "slds-dropdown slds-dropdown_length-5 slds-dropdown_fluid", role: "listbox"},
                    h("ul", {className: "slds-listbox slds-listbox_vertical", role: "presentation"},
                      model.modifiedBySuggestions.map(name => h("li", {role: "presentation", className: "slds-listbox-item", key: name, onMouseDown: () => this.onSelectModifiedBy(name)},
                        h("div", {className: "slds-media slds-listbox__option slds-listbox__option_plain slds-media_small", role: "option"},
                          h("span", {className: "slds-media__body"}, h("span", {className: "slds-truncate"}, name))
                        )
                      ))
                    )
                  ) : null
                )
              )
            )
          )
        ),
        h("div", {className: "slds-m-top_small"},
          h("button", {
            className: "slds-button slds-button_brand",
            onClick: this.onSearchClick,
            disabled: model.searchProgress == "working",
            title: model.selectedTypes.length == 0 ? "Select at least one metadata type" : ""
          }, "Search"),
          h("button", {className: "slds-button slds-button_neutral", onClick: this.onClearFilters, disabled: model.searchProgress == "working"}, "Clear filters")
        ),
        model.searchLogMessages.length > 0 ? h("div", {className: "slds-m-top_small"},
          model.searchLogMessages.map(({level, text}, index) => h("div", {key: index, className: "log-" + level}, text))
        ) : null
      ) : null,

      model.downloadMode == "upload" ? h("div", {className: "package-xml-tools"},
        h("h3", {className: "slds-text-heading_small slds-m-bottom_small"}, "Upload a package.xml"),
        h("div", {
          onDragOver: this.onDragOverPackageXml,
          onDragLeave: this.onDragLeavePackageXml,
          onDrop: this.onDropPackageXml,
          className: "drag-drop-zone" + (model.dragOverPackageXml ? " drag-over" : "")
        },
        h("p", {className: "slds-text-body_regular slds-m-bottom_x-small slds-text-color_weak"}, "Drop it here to download its metadata directly, or"),
        h("label", {htmlFor: "packageXmlFile", className: "slds-button slds-button_link"}, "click to browse"),
        h("input", {
          id: "packageXmlFile",
          name: "packageXmlFile",
          type: "file",
          accept: ".xml",
          onChange: this.onImportPackageXml,
          disabled: model.progress == "working",
          className: "file-input-hidden"
        })
        ),
        this.renderRetrieveOutput()
      ) : null,

      (model.downloadMode == "filter" && model.searchResults) ? h("div", {},
        h("div", {className: "slds-grid slds-grid_align-spread slds-m-bottom_x-small"},
          h("h3", {className: "slds-text-heading_small"}, "Results"),
          h("span", {className: "slds-text-body_small slds-text-color_weak"}, model.searchResults.length + " result(s)")
        ),
        model.searchResults.length > 0 ? h("div", {className: "results-table-container"},
          h("table", {className: "slds-table slds-table_bordered slds-table_striped slds-no-row-hover"},
            h("thead", {},
              h("tr", {className: "slds-line-height_reset"},
                h("th", {style: {width: "2.5rem"}},
                  h("input", {type: "checkbox", checked: allResultsSelected, onChange: this.onSelectAllResultsChange, className: "slds-checkbox"}),
                  h("span", {className: "slds-checkbox__label"})
                ),
                h("th", {}, "Metadata Type"),
                h("th", {}, "Metadata Name"),
                h("th", {}, "Modified By"),
                h("th", {}, "Modified At")
              )
            ),
            h("tbody", {},
              model.searchResults.map(row => h("tr", {key: row.type + "~" + row.fullName, className: "slds-hint-parent"},
                h("td", {},
                  h("input", {type: "checkbox", checked: row.selected, onChange: e => this.onToggleResultRow(row, e.target.checked), className: "slds-checkbox"}),
                  h("span", {className: "slds-checkbox__label"})
                ),
                h("td", {title: row.type}, row.type),
                h("td", {title: row.fullName}, row.fullName),
                h("td", {title: row.lastModifiedByName}, row.lastModifiedByName),
                h("td", {title: row.lastModifiedDate}, row.lastModifiedDate ? new Date(row.lastModifiedDate).toLocaleString() : "")
              ))
            )
          )
        ) : h("p", {className: "slds-text-body_regular slds-text-color_weak slds-m-bottom_small"}, "No metadata matches the current filters."),

        h("div", {className: "slds-grid slds-grid_align-spread slds-gutters slds-m-bottom_small slds-wrap slds-m-top_small"},
          h("div", {},
            h("button", {className: "slds-button slds-button_neutral", onClick: this.onGeneratePackageXmlFromResults, disabled: !anySelected}, "Generate package.xml"),
            h("button", {className: "slds-button slds-button_brand", onClick: this.onDownloadSelectedResults, disabled: !anySelected || model.progress == "working"}, "Download metadata package")
          ),
          h("div", {},
            h("input", {type: "checkbox", checked: model.downloadAuto, onChange: this.onDownloadAutoChange, className: "slds-checkbox__input"}),
            h("span", {className: "slds-checkbox__label"}, "Download package when ready")
          )
        ),
        this.renderRetrieveOutput()
      ) : null
    );
  }

  renderToolsTab() {
    let {model} = this.props;
    return h("div", {},
      h("div", {className: "package-xml-tools"},
        h("h3", {className: "slds-text-heading_small slds-m-bottom_small"}, "Data Model"),
        h("p", {className: "slds-text-body_regular slds-m-bottom_small slds-text-color_weak"}, "Download a CSV export of all objects and fields in this org."),
        h("button", {onClick: this.onClickDataModel, disabled: (model.progress == "working" || model.deployProgress == "working"), title: "Download Data Model"},
          h("svg", {className: "download-icon"},
            h("use", {xlinkHref: "symbols.svg#download"})
          ),
          " Download Data Model"
        )
      )
    );
  }

  renderUploadMetadataTab() {
    let {model} = this.props;
    return h("div", {},
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
        h("label", {className: "slds-m-top_x-small"},
          h("input", {
            type: "checkbox",
            checked: model.checkOnly,
            onChange: e => this.onDeployOptionChange("checkOnly", e.target.checked),
            disabled: (model.deployProgress == "working"),
            className: "slds-checkbox__input"
          }),
          h("span", {className: "slds-checkbox__label"}, " Check only (validate without deploying)")
        ),
        h("label", {className: "slds-m-top_x-small"},
          h("input", {
            type: "checkbox",
            checked: model.allowMissingFiles,
            onChange: e => this.onDeployOptionChange("allowMissingFiles", e.target.checked),
            disabled: (model.deployProgress == "working"),
            className: "slds-checkbox__input"
          }),
          h("span", {className: "slds-checkbox__label"}, " Allow missing files")
        ),
        h("label", {className: "slds-m-top_x-small"},
          h("input", {
            type: "checkbox",
            checked: model.ignoreWarnings,
            onChange: e => this.onDeployOptionChange("ignoreWarnings", e.target.checked),
            disabled: (model.deployProgress == "working"),
            className: "slds-checkbox__input"
          }),
          h("span", {className: "slds-checkbox__label"}, " Ignore warnings")
        ),
        h("label", {className: "slds-m-top_x-small"},
          h("input", {
            type: "checkbox",
            checked: model.performRetrieve,
            onChange: e => this.onDeployOptionChange("performRetrieve", e.target.checked),
            disabled: (model.deployProgress == "working"),
            className: "slds-checkbox__input"
          }),
          h("span", {className: "slds-checkbox__label"}, " Perform retrieve")
        ),
        h("label", {className: "slds-m-top_x-small"},
          h("input", {
            type: "checkbox",
            checked: model.purgeOnDelete,
            onChange: e => this.onDeployOptionChange("purgeOnDelete", e.target.checked),
            disabled: (model.deployProgress == "working"),
            className: "slds-checkbox__input"
          }),
          h("span", {className: "slds-checkbox__label"}, " Purge on delete")
        ),
        h("label", {className: "slds-m-top_x-small"},
          h("input", {
            type: "checkbox",
            checked: model.rollbackOnError,
            onChange: e => this.onDeployOptionChange("rollbackOnError", e.target.checked),
            disabled: (model.deployProgress == "working"),
            className: "slds-checkbox__input"
          }),
          h("span", {className: "slds-checkbox__label"}, " Rollback on error")
        ),
        h("label", {className: "slds-m-top_x-small"},
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
    );
  }

  renderDownloadTranslationTab() {
    let {model} = this.props;
    let selectAllTranslationChecked = model.filteredObjectsForTranslation && model.filteredObjectsForTranslation.length > 0 && model.filteredObjectsForTranslation.every(sobject => sobject.selected);
    if (!model.objectsForTranslation) {
      return h("div", {}, "Loading translation options…");
    }
    return h("div", {className: "package-xml-tools"},
      h("div", {className: "slds-form-element"},
        h("label", {className: "slds-form-element__label"}, "Language:"),
        h("div", {className: "slds-form-element__control"},
          h("select", {
            value: model.selectedTranslationLanguage,
            onChange: this.onTranslationLanguageChange,
            disabled: (!model.translationLanguages || model.translationProgress == "working"),
            className: "slds-select"
          },
          (model.translationLanguages || []).map(lang => h("option", {key: lang.code, value: lang.code}, lang.label))
          )
        )
      ),
      model.translationDownloadLink ? h("div", {className: "slds-m-top_small slds-m-bottom_small"},
        h("a", {href: model.translationDownloadLink, download: "translations.zip", className: "button slds-m-right_x-small"}, "Save downloaded translations"),
        model.translationStatusLink ? h("a", {href: model.translationStatusLink, download: "translationStatus.json", className: "button"}, "Save status info") : null
      ) : null,
      h("div", {className: "slds-grid slds-grid_align-spread slds-gutters slds-m-top_small slds-m-bottom_small slds-wrap"},
        h("label", {htmlFor: "translationSearchText", className: "slds-form-element__label"}, "Search:"),
        h("input", {
          id: "translationSearchText",
          name: "translationSearchText",
          placeholder: "Filter objects",
          type: "search",
          value: model.objectSearchValue,
          onInput: this.onTranslationSearchInput,
          disabled: model.translationProgress == "working",
          className: "slds-input"
        }),
        h("label", {},
          h("input", {
            type: "checkbox",
            checked: selectAllTranslationChecked,
            onChange: this.onSelectAllTranslationObjectsChange,
            disabled: model.translationProgress == "working",
            className: "slds-checkbox__input"
          }),
          h("span", {className: "slds-checkbox__label"}, "Select all")
        )
      ),
      h("p", {className: "slds-text-body_regular slds-m-bottom_small slds-text-color_weak"}, "Select a language and the objects to include, then click the button below."),
      h("button", {
        onClick: this.onStartTranslationClick,
        disabled: (model.translationProgress == "working" || !model.objectsForTranslation),
        className: "slds-button slds-button_brand slds-m-bottom_small"
      }, "Download translations"),
      h("div", {className: "slds-grid slds-wrap"},
        model.filteredObjectsForTranslation.map(sobject => h(TranslationObjectSelector, {key: sobject.name, sobject, model}))
      ),
      h("div", {},
        model.translationLogMessages.map(({level, text}, index) => h("div", {key: index, className: "log-" + level}, text))
      )
    );
  }

  render() {
    let {model} = this.props;
    let {activeTab} = this.state;
    document.title = model.title();
    let anyWorking = model.progress == "working" || model.deployProgress == "working" || model.translationProgress == "working" || model.searchProgress == "working";
    return (
      h("div", {},
        h("div", {className: "object-bar"},
          h("a", {href: model.sfLink, className: "sf-link"},
            h("svg", {viewBox: "0 0 24 24"},
              h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
            ),
            " Salesforce Home"
          ),
          h("span", {className: "progress progress-" + (anyWorking ? "working" : (model.progress == "done" || model.deployProgress == "done" || model.translationProgress == "done" || model.searchProgress == "done") ? "done" : (model.progress == "error" || model.deployProgress == "error" || model.translationProgress == "error" || model.searchProgress == "error") ? "error" : "ready")},
            model.progress == "working" ? "Downloading..."
            : model.deployProgress == "working" ? "Deploying..."
            : model.translationProgress == "working" ? "Downloading Translations..."
            : model.searchProgress == "working" ? "Searching..."
            : anyWorking ? "Working..."
            : (model.progress == "done" || model.deployProgress == "done" || model.translationProgress == "done" || model.searchProgress == "done") ? "Finished"
            : (model.progress == "error" || model.deployProgress == "error" || model.translationProgress == "error" || model.searchProgress == "error") ? "Error!"
            : "Ready"
          )
        ),
        h("div", {className: "body"},
          h("div", {className: "slds-tabs_default"},
            h("ul", {className: "slds-tabs_default__nav", role: "tablist"},
              h("li", {className: "slds-tabs_default__item" + (activeTab == "download" ? " slds-is-active" : ""), title: "Download Metadata", role: "presentation"},
                h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: "0", onClick: e => { e.preventDefault(); this.onSetTab("download"); }}, "Download Metadata")
              ),
              h("li", {className: "slds-tabs_default__item" + (activeTab == "translation" ? " slds-is-active" : ""), title: "Download Translation", role: "presentation"},
                h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: "0", onClick: e => { e.preventDefault(); this.onSetTab("translation"); }}, "Download Translation")
              ),
              h("li", {className: "slds-tabs_default__item" + (activeTab == "upload" ? " slds-is-active" : ""), title: "Upload Metadata", role: "presentation"},
                h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: "0", onClick: e => { e.preventDefault(); this.onSetTab("upload"); }}, "Upload Metadata")
              ),
              h("li", {className: "slds-tabs_default__item" + (activeTab == "dataModel" ? " slds-is-active" : ""), title: "Data Model", role: "presentation"},
                h("a", {className: "slds-tabs_default__link", href: "#", role: "tab", tabIndex: "0", onClick: e => { e.preventDefault(); this.onSetTab("dataModel"); }}, "Data Model")
              )
            )
          ),
          h("div", {className: "slds-tabs_default__content slds-m-top_medium"},
            activeTab == "download" ? this.renderDownloadMetadataTab() : null,
            activeTab == "translation" ? this.renderDownloadTranslationTab() : null,
            activeTab == "upload" ? this.renderUploadMetadataTab() : null,
            activeTab == "dataModel" ? this.renderToolsTab() : null
          )
        )
      )
    );
  }
}

class TranslationObjectSelector extends React.Component {
  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
  }
  onChange(e) {
    let {sobject, model} = this.props;
    sobject.selected = e.target.checked;
    model.didUpdate();
  }
  render() {
    let {sobject} = this.props;
    return h("div", {className: "slds-col slds-size_3-of-12"}, h("label", {title: sobject.name},
      h("input", {type: "checkbox", checked: sobject.selected, onChange: this.onChange}),
      sobject.label
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
    model.loadMetadataTypeCatalog();
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

  });

}
