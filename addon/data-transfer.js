/* global React ReactDOM */
import {sfConn, apiVersion, createConnection} from "./inspector.js";
/* global initButton */
import {DescribeInfo, copyToClipboard} from "./data-load.js";
import {HistoryBox} from "./history-box.js";
import {createImportArgs, soapImport} from "./import-engine.js";
import {DEFAULT_EXCLUDED_FIELDS, relationshipKey, listChildRelationships, copyableFields, sentFields, objectSkipReason, insertionOrder, lookupKey, buildSobject, buildDeferredUpdate, externalLinks, linkedRecordsToCopy, upsertKeyOptions, matchFieldOptions, matchByExternalId, rememberIds} from "./transfer-plan.js";

// Copies records of the current org with their related records (e.g. an Account with its Contacts and Opportunities) to a sandbox, for debugging.
// The user picks a start object and a filter, checks the child relationships to follow and may uncheck fields: no SOQL to write.
// Objects are inserted in an order computed from their lookups, and lookups between copied records point to the new records.

const MAX_RECORDS = 20000;
const BATCH_SIZE = 200;
const BATCH_CONCURRENCY = 3;
const ID_CHUNK_SIZE = 200; // Ids per "IN (...)" condition
const MAX_QUERY_URL_LENGTH = 15000; // longer query URLs fail with HTTP 414
// Duplicate rules set to alert only must not block the copy
const SOAP_HEADERS = {DuplicateRuleHeader: {allowSave: true, includeRecordDetails: false, runAsCurrentUser: true}};
const CONFIGS_STORAGE_KEY = "dataTransferConfigs";
// Target Ids of the records copied to a sandbox, to update them when the transfer runs again: one entry per target org
const ID_MAP_STORAGE_PREFIX = "dataTransferIdMap_";
const MAX_REMEMBERED_IDS = 50000;

class Model {
  constructor(sfHost, args) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;
    this.reactCallback = null;
    this.spinnerCount = 0;
    this.userInfo = "...";
    this.sourceOrgId = "";
    this.configs = loadConfigs();
    this.configName = "";
    this.showHelp = false;
    // Source
    this.rootSobject = args.get("sobject") || "";
    this.filter = args.get("filter") || "";
    this.filterInput = null; // filter being typed, applied on Enter or blur
    this.root = {ids: null, error: "", loading: false}; // Ids of the records matching the filter
    this.rootVersion = 0;
    // Target
    this.targetHost = "";
    this.target = null; // {conn, host, org, describeInfo}
    this.targetError = "";
    this.targetConnecting = false;
    this.targetVersion = 0;
    this.knownHosts = [];
    // Selection
    this.relationships = []; // checked child relationships: [{parent, relationshipName, childSObject, field, label}]
    this.excludedFields = {}; // sobject to unchecked field names, DEFAULT_EXCLUDED_FIELDS when absent
    this.lookupChoices = {}; // "Object.Field" to "clear", "keep", "copy" or "match"
    this.lookupMatchFields = {}; // "Object.Field" to the external ID field of the linked object, for the "match" choice
    this.upsertKeys = {}; // sobject to the external ID field matching the records already in the target org ("Match by")
    this.mode = "create"; // "create": new copies each time, "updatePrevious": update the records copied by a previous run
    this.expanded = new Set(); // tree paths showing their unchecked relationships
    this.showAllRelationships = new Set(); // sobjects listing their technical relationships too
    this.fieldsSobject = ""; // object of the open fields panel
    this.fieldsFilter = "";
    // Ids of the selected records, before loading their fields
    this.childIdCache = new Map(); // relationship key to Map of parent Id to child Ids
    this.relationshipErrors = new Map(); // relationship key to query error
    this.ids = null; // Map of sobject to Set of Ids, root object first
    this.relationshipIds = new Map(); // relationship key to Set of child Ids
    this.idsLoading = false;
    this.idsVersion = 0;
    // Loaded records and copy
    this.plan = null; // {nodes: [node], order: [sobject], sourceIds, keyPrefixes, links, keptFields, previousCount, matchedIds}
    this.planStale = false; // a link choice needs to load more records, or to match them again
    this.idMap = new Map(); // source Id to target Id of the copied records
    this.status = "";
    this.error = "";
    this.isWorking = false;
    this.cancelRequested = false;
    this.confirmPopup = false;

    this.sourceDescribeInfo = new DescribeInfo(this.spinFor.bind(this), () => this.didUpdate());
    if (localStorage.getItem(sfHost + "_isSandbox") != "true") {
      //change background color for production
      document.body.classList.add("prod");
    }
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
      this.sourceOrgId = res.organizationId;
    }));
    this.loadKnownHosts();
    // From Data Export: subqueries as relationship paths, e.g. "Opportunities,Opportunities.OpportunityLineItems"
    let paths = (args.get("relationships") || "").split(",").filter(path => path);
    if (this.rootSobject) {
      this.spinFor(this.resolveRelationshipPaths(paths).then(() => this.loadRootIds()));
    }
  }

  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
    }
  }

  spinFor(promise) {
    this.spinnerCount++;
    return promise
      .catch(err => {
        console.error("spinFor", err);
      })
      .then(() => {
        this.spinnerCount--;
        this.didUpdate();
      })
      .catch(err => console.log("error handling failed", err));
  }

  // Suggests the orgs with a session (cookie) or an OAuth token, sandboxes first
  loadKnownHosts() {
    const TOKEN_SUFFIX = "_access__token";
    let oauthHosts = Object.keys(localStorage).filter(key => key.endsWith(TOKEN_SUFFIX)).map(key => key.slice(0, -TOKEN_SUFFIX.length));
    chrome.runtime.sendMessage({message: "getSessionHosts"}, cookieHosts => {
      let hosts = [...new Set([...(cookieHosts || []), ...oauthHosts])].filter(host => host != this.sfHost);
      this.knownHosts = hosts
        .map(host => ({host, isSandbox: localStorage.getItem(host + "_isSandbox")}))
        .sort((a, b) => (a.isSandbox == "true" ? 0 : 1) - (b.isSandbox == "true" ? 0 : 1) || a.host.localeCompare(b.host));
      this.didUpdate();
    });
  }

  setStatus(status) {
    this.status = status;
    this.didUpdate();
  }

  // Describes, from the cache or loaded in the background (the page is rendered again when they arrive)

  sourceGlobal() {
    return this.sourceDescribeInfo.describeGlobal(false).globalDescribe;
  }

  sourceDescribe(sobject) {
    return this.sourceDescribeInfo.describeSobject(false, sobject).sobjectDescribe;
  }

  // undefined while unknown (no target org or loading), null when the object does not exist in the target org
  targetDescribe(sobject) {
    if (!this.target) {
      return undefined;
    }
    let {sobjectStatus, sobjectDescribe} = this.target.describeInfo.describeSobject(false, sobject);
    return sobjectStatus == "ready" ? sobjectDescribe : sobjectStatus == "notfound" ? null : undefined;
  }

  // Objects which can be the start object: queryable and createable
  rootSobjectOptions() {
    let global = this.sourceGlobal();
    return global ? global.sobjects.filter(sobject => sobject.queryable && sobject.createable) : [];
  }

  childRelationships(sobject) {
    let describe = this.sourceDescribe(sobject);
    let global = this.sourceGlobal();
    return describe && global ? listChildRelationships(describe, global, {showAll: this.showAllRelationships.has(sobject)}) : null;
  }

  isSelected(relationship) {
    let key = relationshipKey(relationship);
    return this.relationships.some(r => relationshipKey(r) == key);
  }

  // Why a relationship cannot be checked: its object cannot be created in the target org.
  // Uses the global describe, to avoid describing every object of the tree in the target org.
  targetSkipReason(sobject) {
    let global = this.target ? this.target.describeInfo.describeGlobal(false).globalDescribe : null;
    if (!global) {
      return "";
    }
    return objectSkipReason(global.sobjects.find(s => s.name == sobject) || null, []);
  }

  // Fields linking the records of an object to their parent, through the checked relationships
  parentFields(sobject) {
    return this.relationships.filter(r => r.childSObject == sobject).map(r => r.field);
  }

  excluded(sobject) {
    return this.excludedFields[sobject] || DEFAULT_EXCLUDED_FIELDS[sobject] || [];
  }

  fieldInfos(sobject) {
    let describe = this.sourceDescribe(sobject);
    if (!describe) {
      return null;
    }
    return this.buildFieldInfos(sobject, describe, this.targetDescribe(sobject) || null);
  }

  // The upsert key is always copied, and the fields must be updateable when the records can be updated
  buildFieldInfos(sobject, sourceDescribe, targetDescribe) {
    let key = this.upsertKeys[sobject];
    let mode = this.mode == "updatePrevious" || key ? "update" : "create";
    let fieldInfos = copyableFields(sourceDescribe, targetDescribe, {mode, parentFields: this.parentFields(sobject)});
    if (key && upsertKeyOptions(fieldInfos, targetDescribe).includes(key)) {
      for (let field of fieldInfos) {
        if (field.name == key) {
          field.locked = true;
          field.isKey = true;
        }
      }
    }
    return fieldInfos;
  }

  // External ID fields to match the records of an object with the records already in the target org
  upsertKeyChoices(sobject) {
    let describe = this.sourceDescribe(sobject);
    let targetDescribe = this.targetDescribe(sobject);
    return describe && targetDescribe ? upsertKeyOptions(copyableFields(describe, targetDescribe, {mode: "update"}), targetDescribe) : [];
  }

  setUpsertKey(sobject, key) {
    if (key) {
      this.upsertKeys[sobject] = key;
    } else {
      delete this.upsertKeys[sobject];
    }
    this.resetPlan();
  }

  setMode(mode) {
    this.mode = mode;
    this.resetPlan();
  }

  setLookupChoice(link, choice) {
    let key = lookupKey(link.sobject, link.field);
    let previous = this.lookupChoices[key] || "clear";
    this.lookupChoices[key] = choice;
    // Copying the linked records needs to load them, and not copying them anymore needs to drop them. Matching them needs to query them.
    if (choice == "copy" || previous == "copy" || choice == "match") {
      this.planStale = true;
    }
  }

  // External ID fields of the linked object to match its records in the target org, none for a link to several objects
  matchFieldChoices(link) {
    if (link.referenceTo.length != 1) {
      return [];
    }
    let [sobject] = link.referenceTo;
    let targetDescribe = this.targetDescribe(sobject);
    return matchFieldOptions(this.sourceDescribe(sobject), targetDescribe || null);
  }

  setLookupMatchField(link, field) {
    let key = lookupKey(link.sobject, link.field);
    if (field) {
      this.lookupMatchFields[key] = field;
    } else {
      delete this.lookupMatchFields[key];
    }
    if (this.lookupChoices[key] == "match") {
      this.planStale = true;
    }
  }

  // Selection changes

  // Any change of the records or fields to copy needs a new "Load records"
  resetPlan() {
    this.plan = null;
    this.planStale = false;
    this.idMap = new Map();
    this.status = "";
    this.error = "";
  }

  setRootSobject(sobject) {
    if (sobject == this.rootSobject) {
      return;
    }
    this.rootSobject = sobject;
    this.pruneRelationships();
    this.loadRootIds();
  }

  setFilter(filter) {
    if (filter == this.filter && (this.root.ids || this.root.error)) {
      return;
    }
    this.filter = filter;
    this.loadRootIds();
  }

  toggleRelationship(relationship, checked) {
    if (checked) {
      if (!this.isSelected(relationship)) {
        this.relationships.push(relationship);
      }
    } else {
      let key = relationshipKey(relationship);
      this.relationships = this.relationships.filter(r => relationshipKey(r) != key);
      this.pruneRelationships();
    }
    this.loadRelatedIds();
  }

  // Unchecking a relationship unchecks the relationships below it: keeps the relationships reachable from the start object
  pruneRelationships() {
    let reachable = new Set([this.rootSobject]);
    let kept = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (let relationship of this.relationships) {
        if (!kept.includes(relationship) && reachable.has(relationship.parent)) {
          kept.push(relationship);
          reachable.add(relationship.childSObject);
          changed = true;
        }
      }
    }
    this.relationships = this.relationships.filter(r => kept.includes(r));
  }

  setFieldExcluded(sobject, names, excluded) {
    let current = new Set(this.excluded(sobject));
    for (let name of names) {
      if (excluded) {
        current.add(name);
      } else {
        current.delete(name);
      }
    }
    this.excludedFields[sobject] = [...current];
    this.resetPlan();
  }

  // Resolves relationship paths of the start object, e.g. "Opportunities.OpportunityLineItems", into checked relationships
  async resolveRelationshipPaths(paths) {
    for (let path of paths) {
      let parent = this.rootSobject;
      for (let name of path.split(".")) {
        let describe = await this.sourceDescribeInfo.describeSobjectPromise(false, parent);
        let relationship = describe.childRelationships.find(r => r.relationshipName && r.relationshipName.toLowerCase() == name.toLowerCase());
        if (!relationship) {
          break;
        }
        let resolved = {parent: describe.name, relationshipName: relationship.relationshipName, childSObject: relationship.childSObject, field: relationship.field, label: relationship.childSObject};
        if (!this.isSelected(resolved)) {
          this.relationships.push(resolved);
        }
        parent = relationship.childSObject;
      }
    }
    // The start object may be named in another case in the query
    let rootDescribe = this.rootSobject ? await this.sourceDescribeInfo.describeSobjectPromise(false, this.rootSobject).catch(() => null) : null;
    if (rootDescribe) {
      this.rootSobject = rootDescribe.name;
    }
  }

  // Ids of the selected records

  async loadRootIds() {
    let version = ++this.rootVersion;
    this.root = {ids: null, error: "", loading: !!this.rootSobject};
    this.childIdCache = new Map();
    this.relationshipErrors = new Map();
    this.ids = null;
    this.resetPlan();
    this.didUpdate();
    if (!this.rootSobject) {
      return;
    }
    try {
      let filter = this.filter.trim();
      let records = await queryAll(sfConn, `SELECT Id FROM ${this.rootSobject}${filter ? " WHERE " + filter : ""} LIMIT ${MAX_RECORDS + 1}`);
      if (version != this.rootVersion) {
        return;
      }
      this.root.ids = records.map(record => record.Id);
    } catch (err) {
      if (version != this.rootVersion) {
        return;
      }
      this.root.error = err.message;
    }
    this.root.loading = false;
    await this.loadRelatedIds();
  }

  // Follows the checked relationships from the records of the start object until no new record is found.
  // A record reached by several relationships is counted once in its object.
  computeIds() {
    let ids = new Map([[this.rootSobject, new Set(this.root.ids)]]);
    let relationshipIds = new Map();
    let missing = new Map(); // relationship to Set of parent Ids not queried yet
    let total = this.root.ids.length;
    let changed = true;
    while (changed && total <= MAX_RECORDS) {
      changed = false;
      for (let relationship of this.relationships) {
        let key = relationshipKey(relationship);
        let parentIds = ids.get(relationship.parent);
        if (!parentIds || this.relationshipErrors.has(key)) {
          continue;
        }
        let cache = this.childIdCache.get(key) || new Map();
        if (!ids.has(relationship.childSObject)) {
          ids.set(relationship.childSObject, new Set());
        }
        let childIds = ids.get(relationship.childSObject);
        if (!relationshipIds.has(key)) {
          relationshipIds.set(key, new Set());
        }
        for (let parentId of parentIds) {
          if (!cache.has(parentId)) {
            if (!missing.has(relationship)) {
              missing.set(relationship, new Set());
            }
            missing.get(relationship).add(parentId);
            continue;
          }
          for (let childId of cache.get(parentId)) {
            relationshipIds.get(key).add(childId);
            if (!childIds.has(childId)) {
              childIds.add(childId);
              total++;
              changed = true;
            }
          }
        }
      }
    }
    return {ids, relationshipIds, missing, total};
  }

  async loadRelatedIds() {
    let version = ++this.idsVersion;
    this.ids = null;
    this.resetPlan();
    if (!this.root.ids) {
      this.idsLoading = false;
      this.didUpdate();
      return;
    }
    this.idsLoading = true;
    this.didUpdate();
    for (;;) {
      let {ids, relationshipIds, missing, total} = this.computeIds();
      if (version != this.idsVersion) {
        return;
      }
      this.relationshipIds = relationshipIds;
      if (missing.size == 0 || total > MAX_RECORDS) {
        this.ids = ids;
        break;
      }
      this.didUpdate();
      let tasks = [];
      for (let [relationship, parentIdSet] of missing) {
        let parentIds = [...parentIdSet];
        for (let i = 0; i < parentIds.length; i += ID_CHUNK_SIZE) {
          tasks.push(() => this.fetchChildIds(relationship, parentIds.slice(i, i + ID_CHUNK_SIZE)));
        }
      }
      await runConcurrently(tasks, BATCH_CONCURRENCY);
    }
    this.idsLoading = false;
    this.didUpdate();
  }

  async fetchChildIds(relationship, parentIds) {
    let key = relationshipKey(relationship);
    if (this.relationshipErrors.has(key)) {
      return;
    }
    try {
      let records = await queryAll(sfConn, `SELECT Id, ${relationship.field} FROM ${relationship.childSObject} WHERE ${relationship.field} IN (${parentIds.map(soqlString).join(", ")})`);
      if (!this.childIdCache.has(key)) {
        this.childIdCache.set(key, new Map());
      }
      let cache = this.childIdCache.get(key);
      for (let parentId of parentIds) {
        cache.set(parentId, []);
      }
      for (let record of records) {
        let parentId = record[relationship.field];
        if (cache.has(parentId)) {
          cache.get(parentId).push(record.Id);
        }
      }
    } catch (err) {
      this.relationshipErrors.set(key, err.message);
    }
  }

  totalCount() {
    return this.ids ? [...this.ids.values()].reduce((count, ids) => count + ids.size, 0) : 0;
  }

  // Target org

  async setTargetHost(targetHost) {
    let host = targetHost.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (this.target && this.target.inputHost == host) {
      return;
    }
    let version = ++this.targetVersion;
    this.target = null;
    this.targetError = "";
    this.resetPlan();
    if (!host) {
      this.targetConnecting = false;
      this.didUpdate();
      return;
    }
    this.targetConnecting = true;
    this.didUpdate();
    try {
      let target = await this.connectTarget(host);
      if (version == this.targetVersion) {
        this.target = target;
      }
    } catch (err) {
      if (version == this.targetVersion) {
        this.targetError = err.message;
      }
    }
    if (version == this.targetVersion) {
      this.targetConnecting = false;
      this.didUpdate();
    }
  }

  async connectTarget(host) {
    let conn = createConnection();
    await conn.getSession(host);
    if (!conn.sessionId) {
      throw new Error(`No session found for ${host}. Log in to this org in this browser, then try again.`);
    }
    let orgResult;
    try {
      orgResult = await conn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent("SELECT Id, Name, IsSandbox FROM Organization"));
    } catch (err) {
      if (err.name == "Unauthorized") {
        // Usually an expired OAuth token (External Client App), which getSession reuses without checking it
        throw new Error(`The session of ${host} has expired (${err.message}). Open Salesforce Inspector on this org to log in again, then try again.`);
      }
      throw err;
    }
    let org = orgResult.records[0];
    if (this.sourceOrgId && org.Id.substring(0, 15) == this.sourceOrgId.substring(0, 15)) {
      throw new Error("The target org is the current org, choose a sandbox.");
    }
    if (!org.IsSandbox) {
      throw new Error(`${org.Name} (${host}) is not a sandbox: the data transfer only writes to sandboxes.`);
    }
    let describeInfo = new DescribeInfo(this.spinFor.bind(this), () => this.didUpdate(), conn);
    return {conn, inputHost: host, host: conn.instanceHostname, org, describeInfo};
  }

  // Load records

  canLoad() {
    return !this.isWorking && !this.idsLoading && this.target && this.ids && this.totalCount() > 0 && this.totalCount() <= MAX_RECORDS;
  }

  // Queries the checked fields of all the selected records, then computes the insertion order and the links to records not copied.
  // Records linked with the "copy" choice are added, with their own links, until no new record is found.
  async loadRecords() {
    this.resetPlan();
    this.isWorking = true;
    this.didUpdate();
    try {
      await this.sourceDescribeInfo.describeGlobal(false).promise;
      let global = this.sourceGlobal();
      if (!global) {
        throw new Error("Failed to describe the current org");
      }
      let keyPrefixes = new Map(global.sobjects.filter(sobject => sobject.keyPrefix).map(sobject => [sobject.keyPrefix, sobject.name]));
      let nodes = [];
      let addRecords = async (sobject, idSet, linked) => {
        let node = nodes.find(n => n.sobject == sobject);
        if (!node) {
          this.setStatus(`Describing ${sobject}`);
          let sourceDescribe = await this.sourceDescribeInfo.describeSobjectPromise(false, sobject);
          let targetDescribe = await this.target.describeInfo.describeSobjectPromise(false, sobject).catch(() => null);
          let fieldInfos = this.buildFieldInfos(sobject, sourceDescribe, targetDescribe);
          let skipReason = objectSkipReason(targetDescribe, fieldInfos);
          let fields = skipReason ? [] : sentFields(fieldInfos, this.excluded(sobject));
          let key = fields.find(field => field.isKey);
          node = {sobject, label: sourceDescribe.labelPlural || sobject, fields, skipReason, records: new Map(), deferred: new Set(), upsertKey: key ? key.name : "", linkedCount: 0};
          nodes.push(node);
        }
        let ids = [...idSet].filter(id => !node.records.has(id));
        this.setStatus(`Loading ${ids.length} ${sobject} records`);
        for (let [id, record] of await this.fetchRecords(sobject, node.fields.map(field => field.name), ids)) {
          node.records.set(id, record);
        }
        if (linked) {
          node.linkedCount += ids.length;
        }
      };
      for (let [sobject, idSet] of this.ids) {
        if (idSet.size > 0) {
          await addRecords(sobject, idSet, false);
        }
      }
      let sourceIds, links, keptFields;
      for (;;) {
        // Records of objects which cannot be copied are part of the copy too: their child records are skipped instead of pointing to production records
        sourceIds = new Set(nodes.flatMap(node => [...node.records.keys()]));
        ({links, keptFields} = externalLinks(nodes.filter(node => !node.skipReason), sourceIds, keyPrefixes));
        let linked = linkedRecordsToCopy(links, this.lookupChoices, sourceIds, keyPrefixes);
        if (linked.size == 0) {
          break;
        }
        let total = sourceIds.size + [...linked.values()].reduce((count, ids) => count + ids.size, 0);
        if (total > MAX_RECORDS) {
          throw new Error(`The linked records to copy make more than ${MAX_RECORDS} records: choose Leave empty for some links.`);
        }
        for (let [sobject, idSet] of linked) {
          await addRecords(sobject, idSet, true);
        }
      }
      let copied = nodes.filter(node => !node.skipReason);
      let {order, deferred} = insertionOrder(copied);
      for (let node of copied) {
        node.deferred = deferred.get(node.sobject);
      }
      let previousCount = this.mode == "updatePrevious" ? await this.findPreviousCopies(copied) : 0;
      let matchedIds = await this.matchLinks(links);
      this.plan = {nodes, order, sourceIds, keyPrefixes, links, keptFields, previousCount, matchedIds};
      this.status = "";
    } catch (err) {
      console.error(err);
      this.status = "";
      this.error = err.message;
    }
    this.isWorking = false;
    this.didUpdate();
  }

  // Finds in the target org the records the links with the "match" choice point to, by their external ID.
  // Sets matchField and matchedCount on these links.
  // @returns Map of lookup key to Map source Id to target Id
  async matchLinks(links) {
    let matchedIds = new Map();
    for (let link of links) {
      let key = lookupKey(link.sobject, link.field);
      let field = this.lookupMatchFields[key];
      if (this.lookupChoices[key] != "match" || !field || link.referenceTo.length != 1) {
        continue;
      }
      let [sobject] = link.referenceTo;
      this.setStatus(`Matching ${link.sobject}.${link.field} by ${sobject}.${field}`);
      let sourceDescribe = await this.sourceDescribeInfo.describeSobjectPromise(false, sobject);
      let fieldDescribe = sourceDescribe.fields.find(f => f.name == field);
      let quote = fieldDescribe && ["int", "double", "currency", "percent"].includes(fieldDescribe.type) ? value => String(value) : soqlString;
      let sourceRows = [];
      for (let i = 0; i < link.ids.length; i += ID_CHUNK_SIZE) {
        let chunk = link.ids.slice(i, i + ID_CHUNK_SIZE);
        sourceRows.push(...await queryAll(sfConn, `SELECT Id, ${field} FROM ${sobject} WHERE Id IN (${chunk.map(soqlString).join(", ")})`));
      }
      let values = [...new Set(sourceRows.map(row => row[field]).filter(value => value != null && value !== "").map(quote))];
      let targetRows = [];
      // External ID values can be long: the chunks are limited by the length of the query URL
      let prefix = `SELECT Id, ${field} FROM ${sobject} WHERE ${field} IN (`;
      let maxLength = MAX_QUERY_URL_LENGTH - 200 - encodeURIComponent(prefix + ")").length;
      let chunk = [];
      let chunkLength = 0;
      for (let i = 0; i <= values.length; i++) {
        let length = i < values.length ? encodeURIComponent(values[i] + ", ").length : 0;
        if (chunk.length > 0 && (i == values.length || chunk.length == ID_CHUNK_SIZE || chunkLength + length > maxLength)) {
          targetRows.push(...await queryAll(this.target.conn, prefix + chunk.join(", ") + ")"));
          chunk = [];
          chunkLength = 0;
        }
        if (i < values.length) {
          chunk.push(values[i]);
          chunkLength += length;
        }
      }
      let matched = matchByExternalId(sourceRows, targetRows, field);
      matchedIds.set(key, matched);
      link.matchField = field;
      link.matchedCount = matched.size;
    }
    return matchedIds;
  }

  idMapStorageKey() {
    return ID_MAP_STORAGE_PREFIX + this.target.host;
  }

  // Sets previousTargetId on the records copied by a previous run which still exist in the target org, and returns their number.
  // Records matched by an upsert key are not concerned.
  async findPreviousCopies(nodes) {
    let stored = loadStoredIds(this.idMapStorageKey());
    let count = 0;
    for (let node of nodes) {
      if (node.upsertKey) {
        continue;
      }
      let byTargetId = new Map();
      for (let record of node.records.values()) {
        if (stored[record.sourceId]) {
          byTargetId.set(stored[record.sourceId], record);
        }
      }
      let targetIds = [...byTargetId.keys()];
      if (targetIds.length == 0) {
        continue;
      }
      this.setStatus(`Looking for the previous copies of ${node.label}`);
      for (let i = 0; i < targetIds.length; i += ID_CHUNK_SIZE) {
        let chunk = targetIds.slice(i, i + ID_CHUNK_SIZE);
        for (let row of await queryAll(this.target.conn, `SELECT Id FROM ${node.sobject} WHERE Id IN (${chunk.map(soqlString).join(", ")})`)) {
          let record = byTargetId.get(row.Id);
          if (record) {
            record.previousTargetId = row.Id;
            count++;
          }
        }
      }
    }
    return count;
  }

  // Queries fields of records by Id, by chunks of Ids, and in several queries merged by Id when the field list is too long for one URL
  async fetchRecords(sobject, fieldNames, ids) {
    let records = new Map();
    for (let id of ids) {
      records.set(id, {sourceId: id, values: {}, targetId: "", status: "Queued", action: "", error: "", pendingFields: [], linkError: ""});
    }
    let idListLength = ID_CHUNK_SIZE * encodeURIComponent("'000000000000000AAA', ").length;
    let maxFieldsLength = MAX_QUERY_URL_LENGTH - idListLength - 200;
    let fieldGroups = [[]];
    let groupLength = 0;
    for (let name of fieldNames) {
      let length = encodeURIComponent(", " + name).length;
      if (groupLength + length > maxFieldsLength && fieldGroups[fieldGroups.length - 1].length > 0) {
        fieldGroups.push([]);
        groupLength = 0;
      }
      fieldGroups[fieldGroups.length - 1].push(name);
      groupLength += length;
    }
    let tasks = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
      let chunk = ids.slice(i, i + ID_CHUNK_SIZE);
      for (let group of fieldGroups) {
        tasks.push(async () => {
          let result = await queryAll(sfConn, `SELECT ${["Id"].concat(group).join(", ")} FROM ${sobject} WHERE Id IN (${chunk.map(soqlString).join(", ")})`);
          for (let row of result) {
            let record = records.get(row.Id);
            if (record) {
              for (let name of group) {
                record.values[name] = row[name];
              }
            }
          }
        });
      }
    }
    await runConcurrently(tasks, BATCH_CONCURRENCY);
    return records;
  }

  // Saved transfers

  saveConfig() {
    let name = this.configName.trim();
    let previous = this.configs.find(c => c.name == name);
    let config = {
      name,
      tags: previous ? previous.tags : [],
      targetHost: this.targetHost,
      root: {sobject: this.rootSobject, filter: this.filter},
      relationships: this.relationships.map(({parent, relationshipName, childSObject, field}) => ({parent, relationshipName, childSObject, field})),
      excludedFields: this.excludedFields,
      lookupChoices: this.lookupChoices,
      lookupMatchFields: this.lookupMatchFields,
      upsertKeys: this.upsertKeys,
      mode: this.mode
    };
    this.configs = this.configs.filter(c => c.name != name).concat([config]).sort((a, b) => a.name.localeCompare(b.name));
    storeConfigs(this.configs);
  }

  // Saved transfers as HistoryBox suggestions, like the saved queries of data export
  configSuggestions() {
    return this.configs.map(config => ({name: config.name, label: config.name, value: config.root.sobject + " " + config.root.filter, favorite: true, tags: (config.tags || []).slice(), config}));
  }

  // HistoryBox rename and tag changes
  updateConfig(suggestion) {
    let {config} = suggestion;
    if (suggestion.name && suggestion.name != config.name) {
      this.configs = this.configs.filter(c => c == config || c.name != suggestion.name);
      if (this.configName == config.name) {
        this.configName = suggestion.name;
      }
      config.name = suggestion.name;
    }
    config.tags = suggestion.tags || [];
    this.configs.sort((a, b) => a.name.localeCompare(b.name));
    storeConfigs(this.configs);
  }

  loadConfig(config) {
    this.configName = config.name;
    this.rootSobject = config.root.sobject || "";
    this.filter = config.root.filter || "";
    this.relationships = (config.relationships || []).filter(r => r.childSObject && r.field).map(r => Object.assign({label: r.childSObject}, r));
    this.excludedFields = Object.assign({}, config.excludedFields);
    this.lookupChoices = Object.assign({}, config.lookupChoices);
    this.lookupMatchFields = Object.assign({}, config.lookupMatchFields);
    this.upsertKeys = Object.assign({}, config.upsertKeys);
    this.mode = config.mode == "updatePrevious" ? "updatePrevious" : "create";
    this.fieldsSobject = "";
    this.targetHost = config.targetHost || "";
    this.setTargetHost(this.targetHost);
    this.loadRootIds();
  }

  deleteConfig(config) {
    this.configs = this.configs.filter(c => c != config);
    storeConfigs(this.configs);
    if (this.configName == config.name) {
      this.configName = "";
    }
  }

  // Copy

  planNodes() {
    return this.plan ? this.plan.nodes : [];
  }

  // Nodes in insertion order, then the objects which cannot be copied
  orderedNodes() {
    if (!this.plan) {
      return [];
    }
    let {nodes, order} = this.plan;
    return order.map(sobject => nodes.find(node => node.sobject == sobject)).concat(nodes.filter(node => node.skipReason));
  }

  allRecords() {
    return this.planNodes().flatMap(node => [...node.records.values()].map(record => ({node, record})));
  }

  counts(node) {
    let counts = {Queued: 0, Succeeded: 0, Failed: 0, Skipped: 0};
    for (let record of node.records.values()) {
      counts[record.status]++;
    }
    return counts;
  }

  copyCount() {
    return this.allRecords().filter(({node}) => !node.skipReason).length;
  }

  hasRun() {
    return this.allRecords().some(({record}) => record.status != "Queued");
  }

  // Records a retry can copy: failed, left queued by Stop, skipped because their parent failed, or whose lookups could not be set.
  // Records of an object which cannot be copied (e.g. missing in the target org) need a new "Load records".
  retryableCount() {
    return this.allRecords().filter(({node, record}) => !node.skipReason && (record.status != "Succeeded" || record.linkError)).length;
  }

  // Writes the records not copied yet in the computed order, then sets the lookups which were left empty.
  // A record is upserted when its object has an upsert key, updated when it has a previous copy, and inserted otherwise.
  // Running it again retries the failed and skipped records.
  async doTransfer() {
    this.confirmPopup = false;
    this.isWorking = true;
    this.cancelRequested = false;
    this.error = "";
    this.didUpdate();
    let {sourceIds, keyPrefixes, matchedIds} = this.plan;
    let ctx = {idMap: this.idMap, sourceIds, keyPrefixes, lookupChoices: this.lookupChoices, matchedIds};
    let writer = {consecutiveFailures: 0};
    let copiedIds = [];
    // Lookups to records with a previous copy point to it, also before the record is updated
    for (let {record} of this.allRecords()) {
      if (record.previousTargetId && !this.idMap.has(record.sourceId)) {
        this.idMap.set(record.sourceId, record.previousTargetId);
      }
    }
    try {
      for (let node of this.orderedNodes()) {
        if (this.cancelRequested) {
          break;
        }
        let pending = [...node.records.values()].filter(record => record.status != "Succeeded");
        if (node.skipReason) {
          for (let record of pending) {
            record.status = "Skipped";
            record.error = node.skipReason;
          }
          continue;
        }
        let itemsByAction = {create: [], update: [], upsert: []};
        for (let record of pending) {
          let action = writeAction(node, record);
          let {sobject, pendingFields, error} = buildSobject(node, record, ctx, {targetId: action == "update" ? record.previousTargetId : null, upsertKey: action == "upsert" ? node.upsertKey : null});
          record.status = error ? "Skipped" : "Queued";
          record.error = error || "";
          if (sobject) {
            itemsByAction[action].push({record, sobject, pendingFields});
          }
        }
        this.setStatus(`Copying ${node.label}`);
        for (let [action, items] of Object.entries(itemsByAction)) {
          await this.writeBatches(action, items, writer, (item, result) => {
            let {record} = item;
            record.status = result.success ? "Succeeded" : "Failed";
            record.targetId = result.id;
            record.error = result.error;
            record.action = result.action;
            if (result.success) {
              this.idMap.set(record.sourceId, result.id);
              record.pendingFields = item.pendingFields;
              copiedIds.push([record.sourceId, result.id]);
            }
          }, error => item => {
            item.record.status = "Failed";
            item.record.error = error;
          }, node.upsertKey);
        }
      }
      // Second pass: lookups to records inserted after the record, e.g. Account.ParentId or a lookup of a cycle
      for (let node of this.orderedNodes()) {
        if (this.cancelRequested || node.skipReason) {
          continue;
        }
        let items = [];
        for (let record of node.records.values()) {
          if (record.status == "Succeeded" && record.pendingFields.length > 0) {
            let {sobject, remainingFields} = buildDeferredUpdate(node.sobject, record, this.idMap);
            if (sobject) {
              items.push({record, sobject, remainingFields});
            }
          }
        }
        if (items.length == 0) {
          continue;
        }
        this.setStatus(`Linking ${node.label}`);
        await this.writeBatches("update", items, writer, (item, result) => {
          if (result.success) {
            item.record.pendingFields = item.remainingFields;
            item.record.linkError = "";
          } else {
            item.record.linkError = "Copied, but setting " + item.record.pendingFields.join(", ") + " failed: " + result.error;
          }
        }, error => item => {
          item.record.linkError = "Copied, but setting " + item.record.pendingFields.join(", ") + " failed: " + error;
        });
      }
      this.status = this.cancelRequested ? "Stopped" : "Done";
    } catch (err) {
      console.error(err);
      this.status = "";
      this.error = err.message;
    }
    if (copiedIds.length > 0) {
      storeIds(this.idMapStorageKey(), rememberIds(loadStoredIds(this.idMapStorageKey()), copiedIds, MAX_REMEMBERED_IDS));
    }
    this.isWorking = false;
    this.didUpdate();
  }

  // Number of records of the copy by write action
  actionCounts() {
    let counts = {create: 0, update: 0, upsert: 0};
    for (let {node, record} of this.allRecords()) {
      if (!node.skipReason) {
        counts[writeAction(node, record)]++;
      }
    }
    return counts;
  }

  // Sends items ({sobject}) by batches, a few batches at the same time, and stops after 3 failed batches in a row
  // @param onResult: called with each item and its result
  // @param onBatchError: returns the function called with each item of a batch which failed as a whole
  // @param upsertKey: the external ID field of an upsert
  async writeBatches(importAction, items, writer, onResult, onBatchError, upsertKey) {
    let batches = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }
    await runConcurrently(batches.map(batch => async () => {
      if (this.cancelRequested) {
        return;
      }
      let importArgs = createImportArgs(importAction, upsertKey);
      importArgs.sObjects = batch.map(item => item.sobject);
      try {
        let results = await soapImport(this.target.conn, "Enterprise", importAction, importArgs, SOAP_HEADERS);
        results.forEach((result, i) => onResult(batch[i], result));
        writer.consecutiveFailures = 0;
      } catch (err) {
        if (err.name != "SalesforceSoapError") {
          throw err;
        }
        batch.forEach(onBatchError(err.message));
        // An error affecting every batch (e.g. a validation rule) would otherwise fail the whole copy batch by batch
        writer.consecutiveFailures++;
        if (writer.consecutiveFailures >= 3) {
          this.cancelRequested = true;
          this.error = "Stopped after 3 failed batches in a row: " + err.message;
        }
      }
      this.didUpdate();
    }), BATCH_CONCURRENCY);
  }

  copyResults() {
    let rows = [["Object", "Source Id", "Target Id", "Status", "Action", "Error"]];
    for (let {node, record} of this.allRecords()) {
      rows.push([node.sobject, record.sourceId, record.targetId, record.status, record.action || "", [record.error, record.linkError].filter(e => e).join(" ")]);
    }
    copyToClipboard(rows.map(row => row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join("\t")).join("\r\n"));
  }
}

// Upsert when the object has an upsert key, update when the record has a previous copy, insert otherwise
function writeAction(node, record) {
  return node.upsertKey ? "upsert" : record.previousTargetId ? "update" : "create";
}

function soqlString(value) {
  return "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

// Runs a query and follows its pagination
async function queryAll(conn, soql) {
  let records = [];
  let result = await conn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(soql));
  for (;;) {
    records.push(...result.records);
    if (result.done) {
      return records;
    }
    result = await conn.rest(result.nextRecordsUrl);
  }
}

// Runs the async tasks with at most `concurrency` of them at the same time
async function runConcurrently(tasks, concurrency) {
  let next = 0;
  let worker = async () => {
    while (next < tasks.length) {
      let task = tasks[next++];
      await task();
    }
  };
  await Promise.all(Array.from({length: Math.min(concurrency, tasks.length)}, worker));
}

// Saved transfers of the first version (a SOQL query, without "root") are ignored
function loadConfigs() {
  try {
    let configs = JSON.parse(localStorage.getItem(CONFIGS_STORAGE_KEY));
    return Array.isArray(configs) ? configs.filter(config => config && typeof config.name == "string" && config.root && typeof config.root.sobject == "string") : [];
  } catch (e) {
    return [];
  }
}

function storeConfigs(configs) {
  localStorage.setItem(CONFIGS_STORAGE_KEY, JSON.stringify(configs));
}

function loadStoredIds(key) {
  try {
    let stored = JSON.parse(localStorage.getItem(key));
    return stored && typeof stored == "object" ? stored : {};
  } catch (e) {
    return {};
  }
}

function storeIds(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch (e) {
    console.error("Failed to remember the copied records", e); // quota exceeded: the next run creates new copies
  }
}

let h = React.createElement;

// True when an input event comes from picking a datalist option, not from typing
function isPickedInList(e) {
  return !e.nativeEvent.inputType || e.nativeEvent.inputType == "insertReplacementText";
}

function actionsText(counts) {
  return [
    counts.create ? "insert " + counts.create : "",
    counts.update ? "update " + counts.update : "",
    counts.upsert ? "upsert " + counts.upsert : ""
  ].filter(text => text).join(", ");
}

function countsText(counts) {
  return [
    counts.Succeeded ? "✓ " + counts.Succeeded : "",
    counts.Failed ? "✗ " + counts.Failed : "",
    counts.Skipped ? counts.Skipped + " skipped" : ""
  ].filter(text => text).join("  ");
}

// One object of the tree: the start object, or a child relationship with its checkbox.
// Checked relationships below it are always shown, unchecked ones when the row is expanded.
// Relationship name (when it differs from the label) and the lookup field linking the child to its parent
function relationshipDetail(relationship) {
  let name = relationship.label.replace(/ /g, "") != relationship.relationshipName ? relationship.relationshipName + " " : "";
  return name + "(" + relationship.field + ")";
}

class TreeNode extends React.Component {
  constructor(props) {
    super(props);
    this.onToggleChecked = this.onToggleChecked.bind(this);
    this.onToggleExpanded = this.onToggleExpanded.bind(this);
    this.onToggleFields = this.onToggleFields.bind(this);
    this.onToggleShowAll = this.onToggleShowAll.bind(this);
    this.onUpsertKeyChange = this.onUpsertKeyChange.bind(this);
  }
  onUpsertKeyChange(e) {
    let {model, sobject} = this.props;
    model.setUpsertKey(sobject, e.target.value);
    model.didUpdate();
  }
  onToggleChecked(e) {
    let {model, relationship} = this.props;
    model.toggleRelationship(relationship, e.target.checked);
    model.didUpdate();
  }
  onToggleExpanded() {
    let {model, path} = this.props;
    if (model.expanded.has(path)) {
      model.expanded.delete(path);
    } else {
      model.expanded.add(path);
    }
    model.didUpdate();
  }
  onToggleFields() {
    let {model, sobject} = this.props;
    model.fieldsSobject = model.fieldsSobject == sobject ? "" : sobject;
    model.fieldsFilter = "";
    model.didUpdate();
  }
  onToggleShowAll(e) {
    let {model, sobject} = this.props;
    if (e.target.checked) {
      model.showAllRelationships.add(sobject);
    } else {
      model.showAllRelationships.delete(sobject);
    }
    model.didUpdate();
  }
  // Upsert on an external ID instead of insert, when the object has one in the target org
  renderMatchBy() {
    let {model, sobject} = this.props;
    let choices = model.upsertKeyChoices(sobject);
    let key = model.upsertKeys[sobject] || "";
    if (choices.length == 0 && !key) {
      return null;
    }
    return h("label", {className: "tree-match", title: "Match the records already in the sandbox on an external ID: records with the same value are updated, the others are inserted (upsert). Empty: always insert new records."},
      "Match by ",
      h("select", {value: key, onChange: this.onUpsertKeyChange, disabled: model.isWorking},
        h("option", {value: ""}, "\u2014 (insert)"),
        choices.concat(key && !choices.includes(key) ? [key] : []).map(name => h("option", {key: name, value: name}, name))
      )
    );
  }
  render() {
    let {model, sobject, relationship, path, ancestors} = this.props;
    let key = relationship ? relationshipKey(relationship) : null;
    let checked = !relationship || model.isSelected(relationship);
    let expanded = !relationship || model.expanded.has(path);
    let skipReason = model.targetSkipReason(sobject);
    let relationshipError = key ? model.relationshipErrors.get(key) : "";
    // A relationship already above in this branch (e.g. ChildAccounts) is not shown again
    let repeated = key && ancestors.includes(key);
    let children = checked && !repeated ? model.childRelationships(sobject) : null;
    let count = !relationship ? (model.root.ids ? model.root.ids.length : null)
      : checked && model.relationshipIds.has(key) ? model.relationshipIds.get(key).size
      : null;
    let fieldInfos = checked ? model.fieldInfos(sobject) : null;
    let node = model.planNodes().find(n => n.sobject == sobject);
    let links = model.plan ? model.plan.links.filter(link => link.sobject == sobject) : [];
    let selectedChildren = children ? children.filter(r => model.isSelected(r)) : [];
    // Checked relationships whose object is now hidden, e.g. a technical object from a saved transfer
    if (checked && !repeated) {
      for (let r of model.relationships) {
        if (r.parent == sobject && !selectedChildren.some(c => relationshipKey(c) == relationshipKey(r))) {
          selectedChildren.push(r);
        }
      }
    }
    let unselectedChildren = children ? children.filter(r => !model.isSelected(r)) : [];
    return h("li", {className: "tree-node"},
      h("div", {className: "tree-row" + (skipReason ? " tree-row-disabled" : "")},
        relationship
          ? h("button", {className: "tree-toggle", onClick: this.onToggleExpanded, disabled: !checked || repeated, title: expanded ? "Hide the relationships which are not checked" : "Show the relationships of " + sobject}, checked && !repeated ? (expanded ? "▾" : "▸") : "")
          : null,
        relationship
          ? h("label", {className: "tree-label", title: `${relationship.childSObject}.${relationship.field}`},
            h("input", {type: "checkbox", checked, onChange: this.onToggleChecked, disabled: model.isWorking || (!checked && !!skipReason)}),
            relationship.label,
            h("span", {className: "tree-detail"}, relationshipDetail(relationship))
          )
          : h("span", {className: "tree-label tree-root"}, sobject),
        count != null ? h("span", {className: "tree-count"}, "(" + count + ")") : null,
        checked && relationship && !model.relationshipIds.has(key) && model.idsLoading ? h("span", {className: "tree-count"}, "…") : null,
        fieldInfos && !repeated ? h("button", {className: "tree-fields" + (model.fieldsSobject == sobject ? " active" : ""), onClick: this.onToggleFields, title: "Choose the copied fields of " + sobject},
          "Fields " + sentFields(fieldInfos, model.excluded(sobject)).length + "/" + fieldInfos.filter(f => f.status == "copy").length + " ▸") : null,
        fieldInfos && !repeated ? this.renderMatchBy() : null,
        skipReason ? h("span", {className: "tree-warning"}, skipReason) : null,
        relationshipError ? h("span", {className: "conf-error tree-error"}, relationshipError) : null,
        repeated ? h("span", {className: "tree-detail"}, " same as above") : null,
        links.length > 0 ? h("span", {className: "tree-warning", title: "See Links to records not copied"}, "⚠ " + links.map(link => link.field).join(", ") + ": see links") : null,
        node && !node.skipReason && model.hasRun() ? h("span", {className: "tree-result"}, countsText(model.counts(node))) : null
      ),
      checked && !repeated ? h("ul", {className: "tree-children"},
        selectedChildren.map(r => h(TreeNode, {key: relationshipKey(r), model, sobject: r.childSObject, relationship: r, path: path + "." + r.relationshipName, ancestors: key ? ancestors.concat([key]) : ancestors})),
        expanded && children ? h("li", {className: "tree-candidates"},
          unselectedChildren.map(r => {
            let reason = model.targetSkipReason(r.childSObject);
            return h("label", {key: relationshipKey(r), className: "tree-candidate" + (reason ? " tree-row-disabled" : ""), title: reason || `${r.childSObject}.${r.field}`},
              h("input", {type: "checkbox", checked: false, disabled: model.isWorking || !!reason, onChange: () => { model.toggleRelationship(r, true); model.didUpdate(); }}),
              r.label,
              h("span", {className: "tree-detail"}, " " + relationshipDetail(r))
            );
          }),
          unselectedChildren.length == 0 ? h("span", {className: "tree-detail"}, "No other relationship ") : null,
          h("label", {className: "tree-candidate tree-show-all", title: "Also list history, share, feed and other technical objects"},
            h("input", {type: "checkbox", checked: model.showAllRelationships.has(sobject), onChange: this.onToggleShowAll}),
            "Show all relationships"
          )
        ) : null,
        expanded && !children ? h("li", {className: "tree-detail"}, "Loading relationships…") : null
      ) : null
    );
  }
}

// Fields of one object: checked fields are copied, the field linking the records to their parent is always copied
class FieldsPanel extends React.Component {
  constructor(props) {
    super(props);
    this.onFilterChange = this.onFilterChange.bind(this);
    this.onAllNoneChange = this.onAllNoneChange.bind(this);
    this.onCloseClick = this.onCloseClick.bind(this);
  }
  visibleFields() {
    let {model} = this.props;
    let filter = model.fieldsFilter.trim().toLowerCase();
    return (model.fieldInfos(model.fieldsSobject) || []).filter(field => !filter || (field.name + " " + field.label + " " + field.type).toLowerCase().includes(filter));
  }
  onFilterChange(e) {
    let {model} = this.props;
    model.fieldsFilter = e.target.value;
    model.didUpdate();
  }
  onAllNoneChange(e) {
    let {model} = this.props;
    if (e.target.checked) {
      model.setFieldExcluded(model.fieldsSobject, this.visibleFields().map(field => field.name), false);
    } else {
      model.setFieldExcluded(model.fieldsSobject, this.visibleFields().filter(field => !field.locked).map(field => field.name), true);
    }
    model.didUpdate();
  }
  onCloseClick() {
    let {model} = this.props;
    model.fieldsSobject = "";
    model.didUpdate();
  }
  render() {
    let {model} = this.props;
    let sobject = model.fieldsSobject;
    let excluded = model.excluded(sobject);
    let fields = this.visibleFields();
    let toggleable = fields.filter(field => field.status == "copy" && !field.locked);
    let selectedCount = toggleable.filter(field => !excluded.includes(field.name)).length;
    return h("div", {className: "area transfer-fields"},
      h("div", {className: "area-header flex-wrapper"},
        h("h1", {}, "Fields of " + sobject),
        h("input", {type: "search", placeholder: "Filter fields", value: model.fieldsFilter, onChange: this.onFilterChange}),
        model.targetDescribe(sobject) === undefined ? h("span", {className: "tree-detail"}, model.target ? "Loading the target org fields…" : "Choose the target sandbox to see which fields it has") : null,
        h("div", {className: "flex-right"}, h("button", {onClick: this.onCloseClick}, "Close"))
      ),
      h("table", {className: "transfer-table"},
        h("thead", {}, h("tr", {},
          h("th", {}, h("input", {
            type: "checkbox",
            checked: toggleable.length > 0 && selectedCount == toggleable.length,
            ref: el => { if (el) { el.indeterminate = selectedCount > 0 && selectedCount < toggleable.length; } },
            disabled: model.isWorking || toggleable.length == 0,
            title: "Select all / none of the listed fields",
            onChange: this.onAllNoneChange
          })),
          ["Field", "Label", "Type", ""].map((title, i) => h("th", {key: i}, title))
        )),
        h("tbody", {}, fields.map(field => {
          let available = field.status == "copy";
          return h("tr", {key: field.name, className: available ? "" : "tree-row-disabled"},
            h("td", {}, h("input", {
              type: "checkbox",
              checked: available && (field.locked || !excluded.includes(field.name)),
              disabled: model.isWorking || !available || field.locked,
              title: field.isKey ? "Matches the records already in the sandbox (Match by)" : field.locked ? "Links the record to its parent" : "",
              onChange: e => { model.setFieldExcluded(sobject, [field.name], !e.target.checked); model.didUpdate(); }
            })),
            h("td", {}, field.name),
            h("td", {}, field.label),
            h("td", {}, field.type + (field.type == "reference" ? " (" + field.referenceTo.join(", ") + ")" : "")),
            h("td", {}, field.isKey ? "matches the records already in the sandbox" : field.locked ? "links the record to its parent" : field.reason)
          );
        }))
      )
    );
  }
}

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onRootSobjectChange = this.onRootSobjectChange.bind(this);
    this.onRootSobjectBlur = this.onRootSobjectBlur.bind(this);
    this.onFilterChange = this.onFilterChange.bind(this);
    this.onFilterBlur = this.onFilterBlur.bind(this);
    this.onFilterKeyDown = this.onFilterKeyDown.bind(this);
    this.onTargetHostChange = this.onTargetHostChange.bind(this);
    this.onTargetHostBlur = this.onTargetHostBlur.bind(this);
    this.onSelectConfig = this.onSelectConfig.bind(this);
    this.onUpdateConfig = this.onUpdateConfig.bind(this);
    this.onDeleteConfig = this.onDeleteConfig.bind(this);
    this.onConfigNameChange = this.onConfigNameChange.bind(this);
    this.onSaveConfigClick = this.onSaveConfigClick.bind(this);
    this.onLoadClick = this.onLoadClick.bind(this);
    this.onTransferClick = this.onTransferClick.bind(this);
    this.onRetryFailedClick = this.onRetryFailedClick.bind(this);
    this.onConfirmYesClick = this.onConfirmYesClick.bind(this);
    this.onConfirmNoClick = this.onConfirmNoClick.bind(this);
    this.onCancelClick = this.onCancelClick.bind(this);
    this.onCopyResultsClick = this.onCopyResultsClick.bind(this);
    this.onToggleHelpClick = this.onToggleHelpClick.bind(this);
    this.rootSobjectInput = null; // object name being typed, applied when picked in the list, on Enter or blur
  }
  onRootSobjectChange(e) {
    let {model} = this.props;
    this.rootSobjectInput = e.target.value;
    if (isPickedInList(e)) {
      this.onRootSobjectBlur();
    }
    model.didUpdate();
  }
  onRootSobjectBlur() {
    let {model} = this.props;
    if (this.rootSobjectInput == null) {
      return;
    }
    let value = this.rootSobjectInput.trim().toLowerCase();
    let option = model.rootSobjectOptions().find(sobject => sobject.name.toLowerCase() == value);
    if (option) {
      model.setRootSobject(option.name);
    }
    this.rootSobjectInput = null;
    model.didUpdate();
  }
  onFilterChange(e) {
    let {model} = this.props;
    model.filterInput = e.target.value;
    model.didUpdate();
  }
  onFilterBlur() {
    let {model} = this.props;
    if (model.filterInput != null) {
      model.setFilter(model.filterInput);
      model.filterInput = null;
    }
  }
  onFilterKeyDown(e) {
    if (e.key == "Enter") {
      this.onFilterBlur();
    }
  }
  onTargetHostChange(e) {
    let {model} = this.props;
    model.targetHost = e.target.value;
    if (isPickedInList(e)) {
      model.setTargetHost(model.targetHost);
    }
    model.didUpdate();
  }
  onTargetHostBlur() {
    let {model} = this.props;
    model.setTargetHost(model.targetHost);
  }
  onSelectConfig(suggestion) {
    let {model} = this.props;
    if (suggestion) {
      model.loadConfig(suggestion.config);
    }
    model.didUpdate();
  }
  onUpdateConfig(suggestion) {
    let {model} = this.props;
    model.updateConfig(suggestion);
    model.didUpdate();
  }
  onDeleteConfig(suggestion) {
    let {model} = this.props;
    model.deleteConfig(suggestion.config);
    model.didUpdate();
  }
  onConfigNameChange(e) {
    let {model} = this.props;
    model.configName = e.target.value;
    model.didUpdate();
  }
  onSaveConfigClick() {
    let {model} = this.props;
    model.saveConfig();
    model.didUpdate();
  }
  onLoadClick() {
    let {model} = this.props;
    model.loadRecords();
  }
  onRetryFailedClick() {
    let {model} = this.props;
    model.doTransfer();
  }
  onTransferClick() {
    let {model} = this.props;
    model.confirmPopup = true;
    model.didUpdate();
  }
  onConfirmYesClick() {
    let {model} = this.props;
    model.doTransfer();
  }
  onConfirmNoClick() {
    let {model} = this.props;
    model.confirmPopup = false;
    model.didUpdate();
  }
  onCancelClick() {
    let {model} = this.props;
    model.cancelRequested = true;
    model.didUpdate();
  }
  onCopyResultsClick() {
    let {model} = this.props;
    model.copyResults();
  }
  onToggleHelpClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.showHelp = !model.showHelp;
    model.didUpdate();
  }
  onLookupChoiceChange(link, choice) {
    let {model} = this.props;
    model.setLookupChoice(link, choice);
    model.didUpdate();
  }
  onLookupMatchFieldChange(link, field) {
    let {model} = this.props;
    model.setLookupMatchField(link, field);
    model.didUpdate();
  }
  onModeChange(mode) {
    let {model} = this.props;
    model.setMode(mode);
    model.didUpdate();
  }
  renderSource() {
    let {model} = this.props;
    let {root} = model;
    let total = model.totalCount();
    return h("div", {className: "transfer-source"},
      h("div", {className: "conf-line transfer-line"},
        h("label", {className: "conf-input", title: "The object of the records to copy"},
          h("span", {className: "conf-label"}, "Start from"),
          h("input", {type: "search", className: "transfer-sobject", value: this.rootSobjectInput != null ? this.rootSobjectInput : model.rootSobject, onChange: this.onRootSobjectChange, onBlur: this.onRootSobjectBlur, onKeyDown: e => { if (e.key == "Enter") { this.onRootSobjectBlur(); } }, disabled: model.isWorking, list: "sobjectlist", placeholder: "Account"})
        ),
        h("datalist", {id: "sobjectlist"}, model.rootSobjectOptions().map(sobject => h("option", {key: sobject.name, value: sobject.name}, sobject.label))),
        h("label", {className: "conf-input transfer-filter", title: "A SOQL condition, without the WHERE keyword. Press Enter to count the records."},
          h("span", {className: "conf-label"}, "WHERE"),
          h("input", {type: "text", value: model.filterInput != null ? model.filterInput : model.filter, onChange: this.onFilterChange, onBlur: this.onFilterBlur, onKeyDown: this.onFilterKeyDown, disabled: model.isWorking, placeholder: "Id = '001...'"})
        ),
        h("span", {className: "transfer-status"},
          root.loading ? "Counting…"
          : root.ids ? (root.ids.length > MAX_RECORDS ? `More than ${MAX_RECORDS} records` : `→ ${root.ids.length} record${root.ids.length == 1 ? "" : "s"}`)
          : ""
        )
      ),
      root.error ? h("div", {className: "conf-error"}, root.error) : null,
      h("div", {className: "conf-line transfer-line"},
        h("label", {className: "conf-input", title: "A sandbox where you are logged in with this browser"},
          h("span", {className: "conf-label"}, "Target"),
          h("input", {type: "search", className: "transfer-target", value: model.targetHost, onChange: this.onTargetHostChange, onFocus: () => model.loadKnownHosts(), onBlur: this.onTargetHostBlur, onKeyDown: e => { if (e.key == "Enter") { this.onTargetHostBlur(); } }, disabled: model.isWorking, list: "targethostlist", placeholder: "mydomain--dev.sandbox.my.salesforce.com"})
        ),
        h("datalist", {id: "targethostlist"}, model.knownHosts.map(({host, isSandbox}) =>
          h("option", {key: host, value: host}, isSandbox == "true" ? "Sandbox" : isSandbox == "false" ? "Production" : "")
        )),
        h("span", {className: "transfer-status"},
          model.targetConnecting ? "Connecting…"
          : model.target ? `✓ Sandbox "${model.target.org.Name}"`
          : ""
        )
      ),
      model.targetError ? h("div", {className: "conf-error"}, model.targetError) : null,
      h("div", {className: "conf-line transfer-line radio-buttons"},
        h("span", {className: "conf-label"}, "Each run"),
        h("label", {title: "Insert new copies each time the transfer runs"}, h("input", {type: "radio", name: "mode", checked: model.mode == "create", disabled: model.isWorking, onChange: () => this.onModeChange("create")}), "Creates new copies"),
        h("label", {title: "Update the records copied to this sandbox by a previous run (remembered in this browser), insert the others"}, h("input", {type: "radio", name: "mode", checked: model.mode == "updatePrevious", disabled: model.isWorking, onChange: () => this.onModeChange("updatePrevious")}), "Updates the previous copies")
      ),
      total > MAX_RECORDS ? h("div", {className: "conf-error"}, `More than ${MAX_RECORDS} records are selected: narrow the filter or uncheck relationships.`) : null
    );
  }
  renderLinks() {
    let {model} = this.props;
    let {plan} = model;
    if (!plan || (plan.links.length == 0 && plan.keptFields.length == 0)) {
      return null;
    }
    return h("div", {className: "area transfer-links"},
      h("h1", {}, "Links to records not copied"),
      h("p", {className: "tree-detail"}, "These lookups point to production records which are not part of the copy. The copies get new Ids, but these records do not: choose what to put in the lookup."),
      model.planStale ? h("p", {className: "tree-warning"}, "Click Load records to apply the Copy them and Match by external ID choices.") : null,
      h("table", {className: "transfer-table"},
        h("tbody", {},
          plan.links.map(link => {
            let key = lookupKey(link.sobject, link.field);
            let choice = model.lookupChoices[key] || "clear";
            let name = "choice-" + link.sobject + "-" + link.field;
            let matchFields = model.matchFieldChoices(link);
            let matchField = model.lookupMatchFields[key] || "";
            return h("tr", {key: name},
              h("td", {}, link.sobject + "." + link.field),
              h("td", {title: link.sampleIds.join(", ") + (link.distinctCount > link.sampleIds.length ? ", …" : "")}, "→ " + link.distinctCount + " " + link.referenceTo.join(" / ")),
              h("td", {className: "radio-buttons"},
                h("label", {title: "Leave the lookup empty in the sandbox"}, h("input", {type: "radio", name, checked: choice == "clear", disabled: model.isWorking, onChange: () => this.onLookupChoiceChange(link, "clear")}), "Leave empty"),
                h("label", {title: "Keep the production Id in the lookup: works in a full or partial sandbox, which holds these records with the same Ids as production. Fails if the record is not in the sandbox."}, h("input", {type: "radio", name, checked: choice == "keep", disabled: model.isWorking, onChange: () => this.onLookupChoiceChange(link, "keep")}), "Keep production Id"),
                h("label", {title: "Copy these records too, and point the lookup to their copies. Their own links are then listed here."}, h("input", {type: "radio", name, checked: choice == "copy", disabled: model.isWorking, onChange: () => this.onLookupChoiceChange(link, "copy")}), "Copy them"),
                h("label", {title: link.referenceTo.length != 1 ? "Not available for a lookup to several objects" : "Point the lookup to the sandbox record with the same external ID value. Left empty when no sandbox record (or several) has this value."},
                  h("input", {type: "radio", name, checked: choice == "match", disabled: model.isWorking || link.referenceTo.length != 1, onChange: () => this.onLookupChoiceChange(link, "match")}), "Match by external ID"),
                choice == "match" ? h("select", {value: matchField, disabled: model.isWorking, onChange: e => this.onLookupMatchFieldChange(link, e.target.value)},
                  h("option", {value: ""}, matchFields.length > 0 || matchField ? "-- External ID field --" : "No external ID field in both orgs"),
                  matchFields.concat(matchField && !matchFields.includes(matchField) ? [matchField] : []).map(field => h("option", {key: field, value: field}, field))
                ) : null,
                choice == "match" && !model.planStale && link.matchField == matchField && matchField
                  ? h("span", {className: link.matchedCount < link.distinctCount ? "tree-warning" : "tree-detail"}, ` ${link.matchedCount}/${link.distinctCount} found in the sandbox`)
                  : null
              )
            );
          }),
          plan.keptFields.length > 0 ? h("tr", {},
            h("td", {}, plan.keptFields.join(", ")),
            h("td", {colSpan: 2}, "Id kept: users, queues, record types and other setup records have the same Ids in a sandbox created from production")
          ) : null
        )
      )
    );
  }
  // Objects copied because of a "Copy them" link choice
  renderLinkedNodes() {
    let {model} = this.props;
    let nodes = model.planNodes().filter(node => node.linkedCount > 0);
    if (nodes.length == 0) {
      return null;
    }
    return h("div", {className: "tree-linked"},
      h("span", {className: "tree-detail"}, "Also copied for the links:"),
      nodes.map(node => h("span", {key: node.sobject, className: "tree-row"},
        h("span", {}, node.label + " (" + node.linkedCount + ")"),
        h("button", {className: "tree-fields" + (model.fieldsSobject == node.sobject ? " active" : ""), onClick: () => { model.fieldsSobject = model.fieldsSobject == node.sobject ? "" : node.sobject; model.fieldsFilter = ""; model.didUpdate(); }}, "Fields \u25B8"),
        node.skipReason ? h("span", {className: "tree-warning"}, node.skipReason) : null,
        !node.skipReason && model.hasRun() ? h("span", {className: "tree-result"}, countsText(model.counts(node))) : null
      ))
    );
  }
  renderResults() {
    let {model} = this.props;
    let problems = model.allRecords().filter(({record}) => record.status == "Failed" || record.status == "Skipped" || record.linkError);
    if (problems.length == 0) {
      return null;
    }
    return h("div", {className: "area transfer-problems"},
      h("h1", {}, "Records not copied"),
      h("table", {className: "transfer-table"},
        h("thead", {},
          h("tr", {}, ["Object", "Source Id", "Status", "Error"].map(title => h("th", {key: title}, title)))
        ),
        h("tbody", {}, problems.slice(0, 1000).map(({node, record}) =>
          h("tr", {key: record.sourceId},
            h("td", {}, node.sobject),
            h("td", {}, h("a", {href: model.sfLink + "/" + record.sourceId, target: "_blank"}, record.sourceId)),
            h("td", {}, record.linkError && record.status == "Succeeded" ? "Inserted" : record.status),
            h("td", {}, record.error || record.linkError)
          )
        ))
      ),
      problems.length > 1000 ? h("p", {}, `${problems.length - 1000} more, use Copy Results to see them all`) : null
    );
  }
  render() {
    let {model} = this.props;
    let {plan} = model;
    let copyCount = model.copyCount();
    let total = model.totalCount();
    return h("div", {},
      h("div", {id: "user-info"},
        h("a", {href: model.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {}, "Data Transfer"),
        h("span", {}, " / " + model.userInfo),
        h("div", {className: "flex-right"},
          h("div", {id: "spinner", role: "status", className: "slds-spinner slds-spinner_small slds-spinner_inline", hidden: model.spinnerCount == 0 && !model.isWorking && !model.idsLoading},
            h("span", {className: "slds-assistive-text"}),
            h("div", {className: "slds-spinner__dot-a"}),
            h("div", {className: "slds-spinner__dot-b"}),
          ),
          h("a", {href: "#", className: "top-btn", id: "help-btn", title: "Transfer Help", onClick: this.onToggleHelpClick},
            h("div", {className: "icon"})
          ),
        ),
      ),
      h("div", {className: "area transfer-config"},
        h("div", {className: "query-controls"},
          h("h1", {}, "Copy records to a sandbox"),
          h(HistoryBox, {title: "Saved Transfers", didUpdate: model.didUpdate.bind(model), suggestions: model.configSuggestions(), onSelect: this.onSelectConfig, onUpdate: this.onUpdateConfig, onDelete: this.onDeleteConfig}),
          h("div", {className: "button-group"},
            h("input", {placeholder: "Transfer Label", type: "save", className: "text-control save-control", value: model.configName, onChange: this.onConfigNameChange, disabled: model.isWorking}),
            h("button", {onClick: this.onSaveConfigClick, disabled: model.isWorking || !model.configName.trim() || !model.rootSobject, title: "Save the start object, filter, target org, checked relationships, unchecked fields, Match by fields, link choices and run mode under this label"}, "Save Transfer")
          )
        ),
        h("div", {hidden: !model.showHelp, className: "help-text"},
          h("h3", {}, "Transfer Help"),
          h("p", {}, "Copies records of the current org, with their related records, to a sandbox, e.g. to reproduce a production issue."),
          h("ul", {},
            h("li", {}, "Choose the start object and a filter, e.g. Id = '001...', then press Enter to count the matching records."),
            h("li", {}, "Check the related objects to copy too, e.g. the Contacts and Opportunities of an Account, then the Opportunity Products of these Opportunities. A record reached by several relationships is copied once."),
            h("li", {}, "All the fields which exist and can be created in both orgs are copied. Click Fields to uncheck some, e.g. a field which triggers an automation in the sandbox. The field linking a record to its parent is always copied."),
            h("li", {}, "Match by: for an object with an external ID field, upsert on it instead of inserting, to update the records already in the sandbox."),
            h("li", {}, "Click Load records. Copies get new Ids, so a lookup pointing to a production record which is not copied (e.g. Opportunity.CampaignId) needs a choice: leave it empty, keep the production Id (works in a full or partial sandbox, which holds that record with the same Id), or copy these records too. Lookups to users, queues and record types keep their Id."),
            h("li", {}, "Records are inserted in an order computed from their lookups, and lookups between copied records point to the new records. Lookups which cannot be set at insert (e.g. Account.ParentId) are set by an update afterwards."),
            h("li", {}, "Records which failed are listed with their error: fix the cause in the sandbox (validation rule, duplicate rule, missing record type...) and click Retry Failed."),
            h("li", {}, "Each run creates new copies, or updates the copies made by a previous run with Updates the previous copies (remembered in this browser, per sandbox). Type a label and click Save Transfer to run the same transfer again later."),
            h("li", {}, "The target org must be a sandbox where you are logged in with this browser. The copy contains production data: mind personal data.")
          )
        ),
        this.renderSource()
      ),
      model.rootSobject ? h("div", {className: "area transfer-tree"},
        h("div", {className: "area-header flex-wrapper"},
          h("h1", {}, "Objects"),
          h("span", {className: "transfer-status"}, model.ids ? `${total} record${total == 1 ? "" : "s"} selected` : model.idsLoading ? "Counting related records…" : "")
        ),
        h("ul", {className: "tree"},
          h(TreeNode, {model, sobject: model.rootSobject, relationship: null, path: model.rootSobject, ancestors: []})
        ),
        this.renderLinkedNodes()
      ) : null,
      model.fieldsSobject ? h(FieldsPanel, {model}) : null,
      this.renderLinks(),
      h("div", {className: "area transfer-actions"},
        h("div", {className: "flex-wrapper"},
          h("button", {onClick: this.onLoadClick, disabled: !model.canLoad(), className: plan && !model.planStale ? "" : "highlighted", title: model.target ? "Query the checked fields of the selected records" : "Choose the target sandbox first"}, "Load records"),
          h("button", {onClick: this.onTransferClick, disabled: !plan || model.planStale || model.isWorking || model.hasRun() || copyCount == 0, className: plan && !model.planStale ? "highlighted" : ""}, `Copy ${plan ? copyCount + " " : ""}records`),
          h("button", {onClick: this.onRetryFailedClick, disabled: !plan || model.isWorking || !model.hasRun() || model.retryableCount() == 0, title: "Copy again the records which failed, were left by Stop, or were skipped because their parent failed, e.g. after fixing a validation rule in the sandbox"}, "Retry Failed"),
          h("button", {onClick: this.onCancelClick, disabled: !model.isWorking || model.cancelRequested, className: "cancel-btn"}, "Stop"),
          h("button", {onClick: this.onCopyResultsClick, disabled: !model.hasRun(), title: "Copy the source and target Id, status and error of every record, for pasting into Excel"}, "Copy Results"),
          plan && plan.previousCount > 0 ? h("span", {className: "transfer-status"}, `${plan.previousCount} previous copies found, they are updated`) : null,
          h("span", {className: "transfer-status"}, model.status),
          h("span", {className: "conf-error", hidden: !model.error}, model.error)
        )
      ),
      this.renderResults(),
      model.confirmPopup ? h("div", {id: "confirm-background"},
        h("div", {id: "confirm-dialog"},
          h("h1", {}, "Data Transfer"),
          h("p", {}, `You are about to ${actionsText(model.actionCounts())} records in ${model.target.org.Name} (${model.target.host}). This cannot be undone.`),
          h("ul", {className: "confirm-details"}, model.orderedNodes().filter(node => !node.skipReason).map(node =>
            h("li", {key: node.sobject}, `${node.records.size} ${node.label}` + (node.upsertKey ? ` (upsert on ${node.upsertKey})` : ""))
          )),
          h("div", {className: "dialog-buttons"},
            h("button", {onClick: this.onConfirmYesClick, className: "highlighted"}, "Copy"),
            h("button", {onClick: this.onConfirmNoClick, className: "cancel-btn"}, "Cancel")
          )
        )
      ) : null
    );
  }
}

{

  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {

    let root = document.getElementById("root");
    let model = new Model(sfHost, args);
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

    if (parent && parent.isUnitTest) { // for unit tests
      parent.insextTestLoaded({model});
    }

  });

}
