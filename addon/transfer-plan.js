// Planning logic of the data transfer (copy of records and their related records to a sandbox), without any API call, see data-transfer.js

// Lookups to these objects keep their Id: a sandbox created from production keeps the Ids of users and setup records
export const KEPT_REFERENCE_TYPES = ["User", "Group", "RecordType", "Profile", "UserRole", "BusinessHours", "Organization"];

// Child objects hidden unless "Show all relationships" is checked: they cannot be copied in a useful way
const TECHNICAL_SUFFIXES = ["History", "Share", "Feed", "ChangeEvent", "__hd", "__Tag", "__History", "__Share", "__Feed"];
const TECHNICAL_OBJECTS = ["ProcessInstance", "AttachedContentDocument", "CombinedAttachment", "NoteAndAttachment", "OpenActivity", "ActivityHistory"];

// Fields unchecked by default, when no saved choice exists
// OpportunityLineItem: Salesforce rejects UnitPrice and TotalPrice together
export const DEFAULT_EXCLUDED_FIELDS = {OpportunityLineItem: ["TotalPrice"]};

function findField(describe, name) {
  let lowerName = name.toLowerCase();
  return describe.fields.find(field => field.name.toLowerCase() == lowerName);
}

function isTechnicalObject(name) {
  return TECHNICAL_OBJECTS.includes(name) || TECHNICAL_SUFFIXES.some(suffix => name.endsWith(suffix));
}

// Key of a child relationship, the same wherever it appears in the tree, e.g. "Account.Contacts"
export function relationshipKey(relationship) {
  return relationship.parent + "." + relationship.relationshipName;
}

// Child relationships which can be copied: named, not deprecated, to an object queryable and createable in the source org.
// Technical objects (history, share, feed...) are only listed with showAll. Sorted by child object label.
// @param globalDescribe: the source org global describe, {sobjects: [...]}
// @returns [{parent, relationshipName, childSObject, field, label}]
export function listChildRelationships(sourceDescribe, globalDescribe, {showAll = false} = {}) {
  let globals = new Map(globalDescribe.sobjects.map(sobject => [sobject.name, sobject]));
  return sourceDescribe.childRelationships
    .filter(relationship => {
      let child = globals.get(relationship.childSObject);
      return relationship.relationshipName && !relationship.deprecatedAndHidden
        && child && child.queryable && child.createable
        && (showAll || !isTechnicalObject(relationship.childSObject));
    })
    .map(relationship => ({
      parent: sourceDescribe.name,
      relationshipName: relationship.relationshipName,
      childSObject: relationship.childSObject,
      field: relationship.field,
      label: globals.get(relationship.childSObject).labelPlural || relationship.childSObject
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.relationshipName.localeCompare(b.relationshipName));
}

// Fields of an object which can be copied from the source org to the target org.
// Fields not createable in the source org (Id, system fields, formulas, auto-numbers) are not listed.
// @param mode: "create", or "update" which also needs updateable fields
// @param parentFields: the fields linking the records to their parent, always copied (locked)
// @returns [{name, label, type, referenceTo, nillable, required, locked, status: "copy" | "unavailable", reason}]
export function copyableFields(sourceDescribe, targetDescribe, {mode = "create", parentFields = []} = {}) {
  let lowerParentFields = parentFields.map(name => name.toLowerCase());
  let result = [];
  for (let field of sourceDescribe.fields) {
    if (field.name == "Id" || !field.createable) {
      continue;
    }
    let targetField = targetDescribe ? findField(targetDescribe, field.name) : null;
    let reason = "";
    if (field.type == "address" || field.type == "location") {
      reason = "compound field, its components are copied";
    } else if (field.type == "base64") {
      reason = "binary fields are not supported";
    } else if (targetDescribe && !targetField) {
      reason = "not in the target org";
    } else if (targetField && !targetField.createable) {
      reason = "not createable in the target org";
    } else if (targetField && mode == "update" && !targetField.updateable) {
      reason = "not updateable in the target org";
    }
    let describe = targetField || field;
    result.push({
      name: field.name,
      label: field.label,
      type: field.type,
      referenceTo: field.referenceTo || [],
      nillable: describe.nillable !== false,
      required: describe.nillable === false && !describe.defaultedOnCreate && field.type != "boolean",
      locked: lowerParentFields.includes(field.name.toLowerCase()),
      status: reason ? "unavailable" : "copy",
      reason
    });
  }
  return result;
}

// Fields sent to the target org: copyable, and not unchecked by the user unless they link the records to their parent
export function sentFields(fieldInfos, excludedFields = []) {
  return fieldInfos.filter(field => field.status == "copy" && (field.locked || !excludedFields.includes(field.name)));
}

// Returns why the records of an object cannot be copied, or "" when they can
// @param targetDescribe: the target org describe of the object, null when it does not exist there
export function objectSkipReason(targetDescribe, fieldInfos) {
  if (!targetDescribe) {
    return "Object not found in the target org";
  }
  if (!targetDescribe.createable) {
    return "Object not createable in the target org";
  }
  let parentField = fieldInfos.find(field => field.locked && field.status != "copy");
  if (parentField) {
    return `${parentField.name} ${parentField.reason}, the records cannot be linked to their parent`;
  }
  return "";
}

function referenceFields(node) {
  return node.fields.filter(field => field.type == "reference");
}

// Order in which objects are inserted: an object is inserted after the objects its sent lookups point to.
// Self-references (e.g. Account.ParentId) are deferred. A cycle is broken by deferring a nillable lookup of the cycle,
// preferably one which does not link the records to their parent. Deferred lookups are set by an update once all records are inserted.
// @param nodes: [{sobject, fields}] with the sent fields of each object, see sentFields()
// @returns {order: [sobject], deferred: Map<sobject, Set<field name>>}
export function insertionOrder(nodes) {
  let selected = new Set(nodes.map(node => node.sobject));
  let deferred = new Map(nodes.map(node => [node.sobject, new Set()]));
  for (let node of nodes) {
    for (let field of referenceFields(node)) {
      if (field.referenceTo.includes(node.sobject)) {
        deferred.get(node.sobject).add(field.name);
      }
    }
  }
  // Objects a node waits for, through its lookups which are not deferred
  let dependencies = node => new Set(referenceFields(node)
    .filter(field => !deferred.get(node.sobject).has(field.name))
    .flatMap(field => field.referenceTo)
    .filter(type => type != node.sobject && selected.has(type)));
  let order = [];
  let remaining = nodes.slice();
  while (remaining.length > 0) {
    let remainingTypes = new Set(remaining.map(node => node.sobject));
    let ready = remaining.filter(node => [...dependencies(node)].every(type => !remainingTypes.has(type)));
    if (ready.length > 0) {
      order.push(...ready.map(node => node.sobject));
      remaining = remaining.filter(node => !ready.includes(node));
      continue;
    }
    // Cycle: drop the objects no remaining object waits for, to keep only the objects of the cycles
    let cycle = remaining.slice();
    for (;;) {
      let cycleTypes = new Set(cycle.map(node => node.sobject));
      let awaited = new Set(cycle.flatMap(node => [...dependencies(node)].filter(type => cycleTypes.has(type))));
      let kept = cycle.filter(node => awaited.has(node.sobject));
      if (kept.length == cycle.length) {
        break;
      }
      cycle = kept;
    }
    let cycleTypes = new Set(cycle.map(node => node.sobject));
    let candidates = cycle.flatMap(node => referenceFields(node)
      .filter(field => !deferred.get(node.sobject).has(field.name) && field.nillable && field.referenceTo.some(type => type != node.sobject && cycleTypes.has(type)))
      .map(field => ({node, field})));
    let candidate = candidates.find(({field}) => !field.locked) || candidates[0];
    if (!candidate) {
      throw new Error(`Cannot order ${cycle.map(node => node.sobject).join(", ")}: they point to each other with required lookups (master-detail or not nillable). Uncheck one of these objects or one of these lookups.`);
    }
    deferred.get(candidate.node.sobject).add(candidate.field.name);
  }
  return {order, deferred};
}

// The sobject type of a record Id, from the key prefixes of the source org global describe
// @param keyPrefixes: Map of 3 character key prefix to sobject name
export function idType(id, keyPrefixes) {
  return keyPrefixes.get(String(id).substring(0, 3)) || null;
}

// True when a lookup value keeps its Id because it points to a user or setup record, see KEPT_REFERENCE_TYPES.
// For a polymorphic lookup (e.g. OwnerId to User or Group, WhatId), the type is found from the Id.
export function keepsReference(value, field, keyPrefixes) {
  if (field.referenceTo.length > 0 && field.referenceTo.every(type => KEPT_REFERENCE_TYPES.includes(type))) {
    return true;
  }
  return KEPT_REFERENCE_TYPES.includes(idType(value, keyPrefixes));
}

// Key of a lookup in lookupChoices, e.g. "Opportunity.CampaignId"
export function lookupKey(sobject, fieldName) {
  return sobject + "." + fieldName;
}

// Value to send for a lookup field:
// 1. the new Id of a copied record,
// 2. null for a record of the copy which is not copied (yet), never the production record,
// 3. the same Id for users and setup records,
// 4. otherwise the user's choice for this lookup: "keep" the Id, "match" the target record with the same external ID, or "clear" (default).
// @param ctx: {idMap: Map source Id to target Id, sourceIds: Set of all the Ids of the copy, keyPrefixes, lookupChoices,
//   matchedIds: Map of lookup key to Map source Id to target Id, see matchByExternalId()}
export function lookupValue(value, sobject, field, ctx) {
  if (value == null) {
    return null;
  }
  if (ctx.idMap.has(value)) {
    return ctx.idMap.get(value);
  }
  if (ctx.sourceIds.has(value)) {
    return null;
  }
  if (keepsReference(value, field, ctx.keyPrefixes)) {
    return value;
  }
  let key = lookupKey(sobject, field.name);
  let choice = ctx.lookupChoices[key];
  if (choice == "match") {
    let matched = ctx.matchedIds && ctx.matchedIds.get(key);
    return (matched && matched.get(value)) || null;
  }
  return choice == "keep" ? value : null;
}

// Builds the SOAP sObject to insert, update or upsert for a record.
// Returns {sobject, pendingFields} where pendingFields are the lookups to records of the copy not copied yet, to set later with buildDeferredUpdate(),
// or {error} when the record cannot be written: its parent record, or a record a required lookup points to, was not copied.
// An update (targetId) or an upsert (upsertKey) clears the fields which are empty in the source org, except pending lookups.
// @param node: {sobject, fields, deferred: Set of deferred field names}
// @param targetId: the Id of the previous copy of the record, to update it
// @param upsertKey: an external ID field, to upsert the record
export function buildSobject(node, record, ctx, {targetId = null, upsertKey = null} = {}) {
  let sobject = {"$xsi:type": node.sobject};
  let fieldsToNull = targetId || upsertKey ? [] : null;
  if (fieldsToNull) {
    sobject.fieldsToNull = fieldsToNull; // first element of an sObject in the SOAP API
  }
  if (targetId) {
    sobject.Id = targetId;
  }
  if (upsertKey) {
    let keyValue = record.values[upsertKey];
    if (keyValue == null || keyValue === "") {
      return {error: `No value for the upsert key ${upsertKey}`};
    }
  }
  let pendingFields = [];
  for (let field of node.fields) {
    let sourceValue = record.values[field.name];
    let value;
    if (field.type == "reference") {
      value = lookupValue(sourceValue, node.sobject, field, ctx);
      let pending = value == null && sourceValue != null && ctx.sourceIds.has(sourceValue);
      if (pending) {
        pendingFields.push(field.name);
      }
      let isDeferred = node.deferred && node.deferred.has(field.name);
      if (pending && field.locked && !isDeferred) {
        return {error: `Parent record not copied: ${field.name} ${sourceValue}`};
      }
      if (value == null && sourceValue != null && field.required && !isDeferred) {
        return {error: `${field.name} is required and ${sourceValue} is not copied`};
      }
    } else {
      value = sourceValue;
      if (field.type == "datetime" && typeof value == "string") {
        value = value.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"); // REST returns +0000, SOAP expects +00:00
      }
    }
    if (value != null) {
      sobject[field.name] = value;
    } else if (fieldsToNull && field.nillable && !pendingFields.includes(field.name)) {
      fieldsToNull.push(field.name);
    }
  }
  return {sobject, pendingFields};
}

// Second pass: the update which sets the lookups left empty at insert, once the records they point to are copied.
// Returns {sobject, remainingFields}, sobject being null when none of the pending lookups can be set yet.
export function buildDeferredUpdate(sobjectType, record, idMap) {
  let sobject = {"$xsi:type": sobjectType, Id: record.targetId};
  let remainingFields = [];
  let count = 0;
  for (let name of record.pendingFields || []) {
    let targetId = idMap.get(record.values[name]);
    if (targetId) {
      sobject[name] = targetId;
      count++;
    } else {
      remainingFields.push(name);
    }
  }
  return {sobject: count > 0 ? sobject : null, remainingFields};
}

// Lookups pointing to records which are neither copied nor kept automatically (users, setup records): the user chooses to clear them or keep their Id.
// @param nodes: [{sobject, fields, records: Map source Id to {values}}]
// @returns {links: [{sobject, field, referenceTo, distinctCount, sampleIds}], keptFields: ["Account.OwnerId", ...]}
export function externalLinks(nodes, sourceIds, keyPrefixes) {
  let links = [];
  let keptFields = [];
  for (let node of nodes) {
    for (let field of referenceFields(node)) {
      let external = new Set();
      let kept = false;
      for (let record of node.records.values()) {
        let value = record.values[field.name];
        if (value == null || sourceIds.has(value)) {
          continue;
        }
        if (keepsReference(value, field, keyPrefixes)) {
          kept = true;
        } else {
          external.add(value);
        }
      }
      if (kept) {
        keptFields.push(lookupKey(node.sobject, field.name));
      }
      if (external.size > 0) {
        let ids = [...external];
        let types = [...new Set(ids.map(id => idType(id, keyPrefixes)).filter(type => type))];
        links.push({sobject: node.sobject, field: field.name, referenceTo: types.length > 0 ? types : field.referenceTo, distinctCount: ids.length, sampleIds: ids.slice(0, 5), ids});
      }
    }
  }
  return {links, keptFields};
}

// Records referenced by the links whose choice is "copy", by object, which are not part of the copy yet
// @returns Map of sobject to Set of Ids
export function linkedRecordsToCopy(links, lookupChoices, sourceIds, keyPrefixes) {
  let result = new Map();
  for (let link of links) {
    if (lookupChoices[lookupKey(link.sobject, link.field)] != "copy") {
      continue;
    }
    for (let id of link.ids) {
      let type = idType(id, keyPrefixes);
      if (!type || sourceIds.has(id)) {
        continue;
      }
      if (!result.has(type)) {
        result.set(type, new Set());
      }
      result.get(type).add(id);
    }
  }
  return result;
}

// External ID fields which can be the upsert key of an object: copied and updateable in the target org
export function upsertKeyOptions(fieldInfos, targetDescribe) {
  if (!targetDescribe) {
    return [];
  }
  return fieldInfos
    .filter(field => field.status == "copy")
    .filter(field => {
      let targetField = findField(targetDescribe, field.name);
      return targetField && targetField.externalId && targetField.updateable;
    })
    .map(field => field.name);
}

// External ID fields to find in the target org the records a lookup points to ("match" choice): external ID in both orgs
export function matchFieldOptions(sourceDescribe, targetDescribe) {
  if (!sourceDescribe || !targetDescribe) {
    return [];
  }
  return sourceDescribe.fields
    .filter(field => field.externalId)
    .filter(field => {
      let targetField = findField(targetDescribe, field.name);
      return targetField && targetField.externalId;
    })
    .map(field => field.name);
}

// Pairs source records with the target records having the same external ID value (case insensitive, like SOQL).
// Records without value, or whose value is found on several target records, are not matched.
// @param sourceRows, targetRows: [{Id, [field]: value}]
// @returns Map source Id to target Id
export function matchByExternalId(sourceRows, targetRows, field) {
  let normalize = value => String(value).toLowerCase();
  let targetIds = new Map();
  for (let row of targetRows) {
    let value = row[field];
    if (value == null || value === "") {
      continue;
    }
    let key = normalize(value);
    targetIds.set(key, targetIds.has(key) ? null : row.Id); // null: ambiguous
  }
  let result = new Map();
  for (let row of sourceRows) {
    let value = row[field];
    let targetId = value == null || value === "" ? null : targetIds.get(normalize(value));
    if (targetId) {
      result.set(row.Id, targetId);
    }
  }
  return result;
}

// Remembers the target Id of copied records, the most recent last, keeping at most `max` of them
// @param stored: object of source Id to target Id, from localStorage
// @param entries: [[sourceId, targetId]]
export function rememberIds(stored, entries, max) {
  let result = Object.assign({}, stored);
  for (let [sourceId, targetId] of entries) {
    delete result[sourceId];
    result[sourceId] = targetId;
  }
  let keys = Object.keys(result);
  for (let i = 0; i < keys.length - max; i++) {
    delete result[keys[i]];
  }
  return result;
}

// Replaces the content of strings and parentheses by spaces, so that keywords can be searched at the top level of a query
function maskQuery(soql) {
  let masked = "";
  let depth = 0;
  let quote = false;
  for (let i = 0; i < soql.length; i++) {
    let c = soql[i];
    if (quote) {
      if (c == "\\") {
        masked += "  ";
        i++;
        continue;
      }
      if (c == "'") {
        quote = false;
      }
      masked += depth == 0 && c == "'" ? c : " ";
    } else if (c == "'") {
      quote = true;
      masked += depth == 0 ? c : " ";
    } else if (c == "(") {
      masked += depth == 0 ? c : " ";
      depth++;
    } else if (c == ")") {
      depth--;
      masked += depth == 0 ? c : " ";
    } else {
      masked += depth == 0 ? c : " ";
    }
  }
  return masked;
}

// Extracts what the data transfer needs from a SOQL query with subqueries:
// the object of the main FROM, the main WHERE (without ORDER BY, LIMIT...), and the subqueries as relationship paths,
// e.g. ["Opportunities", "Opportunities.OpportunityLineItems"]. Returns null when it is not a SELECT ... FROM query.
export function parseTransferQuery(soql) {
  let masked = maskQuery(soql);
  let select = /^\s*SELECT\b/i.exec(masked);
  let from = /\bFROM\s+(\w+)/i.exec(masked);
  if (!select || !from) {
    return null;
  }
  let sobject = from[1];
  let filter = "";
  let afterFrom = from.index + from[0].length;
  let where = /\bWHERE\b/i.exec(masked.substring(afterFrom));
  if (where) {
    let start = afterFrom + where.index + where[0].length;
    let end = /\b(WITH|GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET|FOR|UPDATE)\b/i.exec(masked.substring(start));
    filter = soql.substring(start, end ? start + end.index : soql.length).trim();
  }
  let relationships = [];
  // Subqueries are the top level parentheses of the SELECT list
  for (let i = 0; i < from.index; i++) {
    if (masked[i] != "(") {
      continue;
    }
    let close = masked.indexOf(")", i);
    let subquery = parseTransferQuery(soql.substring(i + 1, close));
    if (subquery) {
      relationships.push(subquery.sobject, ...subquery.relationships.map(path => subquery.sobject + "." + path));
    }
    i = close;
  }
  return {sobject, filter, relationships};
}
