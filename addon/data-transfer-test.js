/* eslint-disable camelcase */ // sObject field names
export async function dataTransferTest(test) {
  console.log("TEST data-transfer");
  let {assertEquals} = test;
  let {listChildRelationships, copyableFields, sentFields, objectSkipReason, insertionOrder, idType, keepsReference, lookupValue, buildSobject, buildDeferredUpdate, externalLinks, parseTransferQuery, relationshipKey, linkedRecordsToCopy, upsertKeyOptions, matchFieldOptions, matchByExternalId, rememberIds} = await import("./transfer-plan.js");

  function thrownMessage(fn) {
    try {
      fn();
    } catch (err) {
      return err.message;
    }
    return null;
  }
  // Minimal describes, with only the properties used by the transfer
  function field(name, type = "string", props = {}) {
    return Object.assign({name, label: name, type, createable: true, updateable: true, nillable: true, referenceTo: []}, props);
  }
  function lookup(name, referenceTo, props = {}) {
    return field(name, "reference", Object.assign({referenceTo}, props));
  }
  function node(sobject, fields) {
    return {sobject, fields: fields.map(f => Object.assign({nillable: true, locked: false}, f))};
  }

  // Child relationships: named, not deprecated, child queryable and createable, technical objects only with showAll, sorted by label
  let globalDescribe = {sobjects: [
    {name: "Account", labelPlural: "Accounts", queryable: true, createable: true, keyPrefix: "001"},
    {name: "Contact", labelPlural: "Contacts", queryable: true, createable: true, keyPrefix: "003"},
    {name: "Opportunity", labelPlural: "Opportunities", queryable: true, createable: true, keyPrefix: "006"},
    {name: "AccountHistory", labelPlural: "Account History", queryable: true, createable: true, keyPrefix: "017"},
    {name: "AccountShare", labelPlural: "Account Share", queryable: true, createable: true},
    {name: "Custom__Feed", labelPlural: "Custom Feed", queryable: true, createable: true},
    {name: "ActivityHistory", labelPlural: "Activity Histories", queryable: true, createable: true},
    {name: "UserRecordAccess", labelPlural: "User Record Access", queryable: true, createable: false},
    {name: "Campaign", labelPlural: "Campaigns", queryable: true, createable: true, keyPrefix: "701"},
    {name: "User", labelPlural: "Users", queryable: true, createable: true, keyPrefix: "005"},
    {name: "Group", labelPlural: "Groups", queryable: true, createable: true, keyPrefix: "00G"}
  ]};
  let accountDescribe = {name: "Account",
    fields: [],
    childRelationships: [
      {relationshipName: "Opportunities", childSObject: "Opportunity", field: "AccountId"},
      {relationshipName: "Contacts", childSObject: "Contact", field: "AccountId"},
      {relationshipName: "ChildAccounts", childSObject: "Account", field: "ParentId"},
      {relationshipName: null, childSObject: "Contact", field: "Other__c"},
      {relationshipName: "Histories", childSObject: "AccountHistory", field: "AccountId"},
      {relationshipName: "Shares", childSObject: "AccountShare", field: "AccountId"},
      {relationshipName: "Feeds", childSObject: "Custom__Feed", field: "ParentId"},
      {relationshipName: "ActivityHistories", childSObject: "ActivityHistory", field: "AccountId"},
      {relationshipName: "UserRecordAccesses", childSObject: "UserRecordAccess", field: "RecordId"},
      {relationshipName: "Old", childSObject: "Contact", field: "Old__c", deprecatedAndHidden: true},
      {relationshipName: "Unknown", childSObject: "Missing__c", field: "AccountId"}
    ]};
  assertEquals([["Accounts", "ChildAccounts", "Account", "ParentId"], ["Contacts", "Contacts", "Contact", "AccountId"], ["Opportunities", "Opportunities", "Opportunity", "AccountId"]],
    listChildRelationships(accountDescribe, globalDescribe).map(r => [r.label, r.relationshipName, r.childSObject, r.field]));
  assertEquals(["Histories", "Shares", "ChildAccounts", "ActivityHistories", "Contacts", "Feeds", "Opportunities"],
    listChildRelationships(accountDescribe, globalDescribe, {showAll: true}).map(r => r.relationshipName));
  assertEquals("Account.Contacts", relationshipKey(listChildRelationships(accountDescribe, globalDescribe)[1]));

  // Copyable fields: in both orgs and createable in the target org, unavailable ones with a reason, parent links locked
  let sourceContact = {name: "Contact",
    fields: [
      field("Id", "id", {createable: false}), field("LastName"), field("Name", "string", {createable: false}), field("CreatedDate", "datetime", {createable: false}),
      lookup("AccountId", ["Account"]), field("Missing__c"), field("Locked__c"), field("ReadOnly__c"), field("MailingAddress", "address"), field("Photo__c", "base64"),
      lookup("Required__c", ["Account"])
    ]};
  let targetContact = {name: "Contact",
    createable: true,
    fields: [
      field("LastName", "string", {nillable: false}), field("Name", "string", {createable: false}), lookup("AccountId", ["Account"]), field("Locked__c", "string", {createable: false}),
      field("ReadOnly__c", "string", {updateable: false}), field("MailingAddress", "address"), field("Photo__c", "base64"), lookup("Required__c", ["Account"], {nillable: false})
    ]};
  let contactFields = copyableFields(sourceContact, targetContact, {parentFields: ["accountid"]});
  assertEquals([
    ["LastName", "copy", "", true, false], ["AccountId", "copy", "", false, true], ["Missing__c", "unavailable", "not in the target org", false, false],
    ["Locked__c", "unavailable", "not createable in the target org", false, false], ["ReadOnly__c", "copy", "", false, false],
    ["MailingAddress", "unavailable", "compound field, its components are copied", false, false], ["Photo__c", "unavailable", "binary fields are not supported", false, false],
    ["Required__c", "copy", "", true, false]
  ], contactFields.map(f => [f.name, f.status, f.reason, f.required, f.locked]));
  assertEquals([false, true], contactFields.filter(f => f.name == "LastName" || f.name == "AccountId").map(f => f.nillable));
  assertEquals("not updateable in the target org", copyableFields(sourceContact, targetContact, {mode: "update"}).find(f => f.name == "ReadOnly__c").reason);
  assertEquals(["LastName", "AccountId", "Missing__c", "Locked__c"], copyableFields(sourceContact, null).filter(f => f.status == "copy").map(f => f.name).slice(0, 4));
  // Sent fields: unchecked fields are not sent, except the parent link
  assertEquals(["AccountId", "Required__c"], sentFields(contactFields, ["LastName", "ReadOnly__c", "AccountId"]).map(f => f.name));

  // Objects which cannot be copied
  assertEquals("", objectSkipReason(targetContact, contactFields));
  assertEquals("Object not found in the target org", objectSkipReason(null, contactFields));
  assertEquals("Object not createable in the target org", objectSkipReason({createable: false, fields: []}, contactFields));
  assertEquals("Locked__c not createable in the target org, the records cannot be linked to their parent",
    objectSkipReason(targetContact, copyableFields(sourceContact, targetContact, {parentFields: ["Locked__c"]})));

  // Insertion order: Account -> Contract -> Opportunity -> OpportunityLineItem, whatever the input order
  let orderNodes = [
    node("OpportunityLineItem", [lookup("OpportunityId", ["Opportunity"], {nillable: false, locked: true}), lookup("PricebookEntryId", ["PricebookEntry"], {nillable: false})]),
    node("Opportunity", [lookup("AccountId", ["Account"], {locked: true}), lookup("ContractId", ["Contract"]), lookup("OwnerId", ["User"])]),
    node("Contract", [lookup("AccountId", ["Account"], {nillable: false})]),
    node("Account", [lookup("ParentId", ["Account"]), lookup("OwnerId", ["Group", "User"])])
  ];
  let ordered = insertionOrder(orderNodes);
  assertEquals(["Account", "Contract", "Opportunity", "OpportunityLineItem"], ordered.order);
  // Self-references are always deferred
  assertEquals([["Account", ["ParentId"]], ["Contract", []], ["Opportunity", []], ["OpportunityLineItem", []]],
    ordered.order.map(type => [type, [...ordered.deferred.get(type)]]));
  // Cycle: a nillable lookup is deferred, preferably not a parent link; objects waiting for the cycle come after it
  let cycle = insertionOrder([
    node("C__c", [lookup("A__c", ["A__c"], {nillable: false})]),
    node("B__c", [lookup("A__c", ["A__c"], {locked: true})]),
    node("A__c", [lookup("B__c", ["B__c"])])
  ]);
  assertEquals(["A__c", "C__c", "B__c"], cycle.order);
  assertEquals([[], []], [[...cycle.deferred.get("B__c")], [...cycle.deferred.get("C__c")]]);
  assertEquals(["B__c"], [...cycle.deferred.get("A__c")]);
  assertEquals(["A__c"], [...insertionOrder([node("A__c", [lookup("B__c", ["B__c"], {nillable: false})]), node("B__c", [lookup("A__c", ["A__c"], {locked: true})])]).deferred.get("B__c")]);
  // Cycle without a nillable lookup
  assertEquals("Cannot order A__c, B__c: they point to each other with required lookups (master-detail or not nillable). Uncheck one of these objects or one of these lookups.",
    thrownMessage(() => insertionOrder([node("A__c", [lookup("B__c", ["B__c"], {nillable: false})]), node("B__c", [lookup("A__c", ["A__c"], {nillable: false})]), node("C__c", [lookup("A__c", ["A__c"])])])));
  // Lookups to objects which are not copied do not change the order
  assertEquals(["Contact", "Case"], insertionOrder([node("Contact", [lookup("AccountId", ["Account"])]), node("Case", [lookup("ContactId", ["Contact"])])]).order);

  // Lookup values
  let keyPrefixes = new Map(globalDescribe.sobjects.filter(s => s.keyPrefix).map(s => [s.keyPrefix, s.name]));
  assertEquals("Group", idType("00G000000000001", keyPrefixes));
  assertEquals(null, idType("a00000000000001", keyPrefixes));
  let ctx = {idMap: new Map([["001A", "001NEWA"]]), sourceIds: new Set(["001A", "001B", "003A", "003B"]), keyPrefixes, lookupChoices: {"Opportunity.CampaignId": "keep"}};
  let accountLookup = lookup("AccountId", ["Account"]);
  assertEquals("001NEWA", lookupValue("001A", "Contact", accountLookup, ctx)); // copied
  assertEquals(null, lookupValue("001B", "Contact", accountLookup, ctx)); // part of the copy, not copied yet
  assertEquals(null, lookupValue(null, "Contact", accountLookup, ctx));
  assertEquals("005000000000001", lookupValue("005000000000001", "Contact", lookup("OwnerId", ["User"]), ctx)); // kept type
  let whoLookup = lookup("WhoId", ["Contact", "Lead", "User"]);
  assertEquals(true, keepsReference("005000000000001", whoLookup, keyPrefixes)); // polymorphic, kept by key prefix
  assertEquals(false, keepsReference("003000000000001", whoLookup, keyPrefixes));
  assertEquals("005000000000001", lookupValue("005000000000001", "Task", whoLookup, ctx));
  assertEquals(null, lookupValue("003000000000009", "Task", whoLookup, ctx)); // cleared by default
  assertEquals("701000000000001", lookupValue("701000000000001", "Opportunity", lookup("CampaignId", ["Campaign"]), ctx)); // "keep" choice
  assertEquals(null, lookupValue("701000000000001", "Opportunity", lookup("CampaignId", ["Campaign"]), Object.assign({}, ctx, {lookupChoices: {"Opportunity.CampaignId": "clear"}})));
  // "match" choice: the target record with the same external ID, empty when not found
  let matchCtx = Object.assign({}, ctx, {lookupChoices: {"Opportunity.CampaignId": "match"}, matchedIds: new Map([["Opportunity.CampaignId", new Map([["701000000000001", "701NEW"]])]])});
  assertEquals("701NEW", lookupValue("701000000000001", "Opportunity", lookup("CampaignId", ["Campaign"]), matchCtx));
  assertEquals(null, lookupValue("701000000000002", "Opportunity", lookup("CampaignId", ["Campaign"]), matchCtx));
  assertEquals(null, lookupValue("701000000000001", "Opportunity", lookup("CampaignId", ["Campaign"]), Object.assign({}, matchCtx, {matchedIds: new Map()}))); // no field chosen

  // SOAP sObjects
  let contactNode = {sobject: "Contact",
    deferred: new Set(["ReportsToId"]),
    fields: [
      field("LastName"), field("LastCURequestDate", "datetime"), Object.assign(lookup("AccountId", ["Account"]), {locked: true}),
      lookup("ReportsToId", ["Contact"]), lookup("Partner__c", ["Account"]), lookup("Owner__c", ["User"])
    ]};
  let contactA = {sourceId: "003A", values: {LastName: "Doe", LastCURequestDate: "2024-05-01T10:00:00.000+0000", AccountId: "001A", ReportsToId: "003B", Partner__c: "001B", Owner__c: "005000000000001"}};
  assertEquals({sobject: {"$xsi:type": "Contact", LastName: "Doe", LastCURequestDate: "2024-05-01T10:00:00.000+00:00", AccountId: "001NEWA", Owner__c: "005000000000001"}, pendingFields: ["ReportsToId", "Partner__c"]},
    buildSobject(contactNode, contactA, ctx));
  // Parent record not copied
  assertEquals({error: "Parent record not copied: AccountId 001B"}, buildSobject(contactNode, {values: {LastName: "Roe", AccountId: "001B"}}, ctx));
  // A required lookup cleared or pending is an error
  let roleNode = {sobject: "OpportunityContactRole", deferred: new Set(), fields: [lookup("ContactId", ["Contact"], {required: true})]};
  assertEquals({error: "ContactId is required and 003000000000009 is not copied"}, buildSobject(roleNode, {values: {ContactId: "003000000000009"}}, ctx));
  assertEquals({error: "ContactId is required and 003B is not copied"}, buildSobject(roleNode, {values: {ContactId: "003B"}}, ctx));

  // Update of a previous copy and upsert: empty fields are cleared, except pending lookups
  let updateNode = {sobject: "Contact", deferred: new Set(), fields: [field("LastName"), field("Email"), field("Ext__c"), lookup("ReportsToId", ["Contact"]), lookup("Partner__c", ["Account"], {nillable: false})]};
  let updated = {values: {LastName: "Doe", Email: null, Ext__c: "E1", ReportsToId: "003B", Partner__c: null}};
  assertEquals({sobject: {"$xsi:type": "Contact", fieldsToNull: ["Email"], Id: "003OLD", LastName: "Doe", Ext__c: "E1"}, pendingFields: ["ReportsToId"]},
    buildSobject(updateNode, updated, ctx, {targetId: "003OLD"}));
  assertEquals({sobject: {"$xsi:type": "Contact", fieldsToNull: ["Email"], LastName: "Doe", Ext__c: "E1"}, pendingFields: ["ReportsToId"]},
    buildSobject(updateNode, updated, ctx, {upsertKey: "Ext__c"}));
  assertEquals({error: "No value for the upsert key Email"}, buildSobject(updateNode, updated, ctx, {upsertKey: "Email"}));

  // Upsert keys: external IDs copied and updateable in the target org
  let keyTarget = {fields: [field("LastName"), field("Ext__c", "string", {externalId: true}), field("Locked_Ext__c", "string", {externalId: true, updateable: false}), field("Missing_Ext__c", "string", {externalId: true, createable: false})]};
  let keySource = {fields: [field("LastName"), field("Ext__c"), field("Locked_Ext__c"), field("Missing_Ext__c")]};
  assertEquals(["Ext__c"], upsertKeyOptions(copyableFields(keySource, keyTarget), keyTarget));
  assertEquals([], upsertKeyOptions(copyableFields(keySource, null), null));

  // Match by external ID: external ID in both orgs, case insensitive, ambiguous and empty values not matched
  let matchSource = {fields: [field("Name"), field("Ext__c", "string", {externalId: true}), field("Other_Ext__c", "string", {externalId: true})]};
  let matchTarget = {fields: [field("Name"), field("ext__c", "string", {externalId: true}), field("Other_Ext__c")]};
  assertEquals(["Ext__c"], matchFieldOptions(matchSource, matchTarget));
  assertEquals([], matchFieldOptions(matchSource, null));
  let matched = matchByExternalId(
    [{Id: "S1", Ext__c: "abc"}, {Id: "S2", Ext__c: "DUP"}, {Id: "S3", Ext__c: null}, {Id: "S4", Ext__c: "missing"}, {Id: "S5", Ext__c: 12}],
    [{Id: "T1", Ext__c: "ABC"}, {Id: "T2", Ext__c: "dup"}, {Id: "T3", Ext__c: "Dup"}, {Id: "T5", Ext__c: 12}],
    "Ext__c");
  assertEquals([["S1", "T1"], ["S5", "T5"]], [...matched]);

  // Remembered target Ids, most recent last, capped
  assertEquals({b: "B2", c: "C1", a: "A2"}, rememberIds({a: "A1", b: "B1"}, [["b", "B2"], ["c", "C1"], ["a", "A2"]], 3));
  assertEquals(["c", "a"], Object.keys(rememberIds({a: "A1", b: "B1"}, [["c", "C1"], ["a", "A2"]], 2)));

  // Second pass: sets the pending lookups once the records they point to are copied
  let inserted = {sourceId: "003A", targetId: "003NEWA", values: contactA.values, pendingFields: ["ReportsToId", "Partner__c"]};
  assertEquals({sobject: null, remainingFields: ["ReportsToId", "Partner__c"]}, buildDeferredUpdate("Contact", inserted, ctx.idMap));
  ctx.idMap.set("003B", "003NEWB");
  assertEquals({sobject: {"$xsi:type": "Contact", Id: "003NEWA", ReportsToId: "003NEWB"}, remainingFields: ["Partner__c"]}, buildDeferredUpdate("Contact", inserted, ctx.idMap));

  // A record reached by two relationships is one record of its object
  let roles = new Map();
  for (let id of ["00KA", "00KB", "00KA"]) {
    roles.set(id, {sourceId: id, values: {}});
  }
  assertEquals(2, roles.size);

  // Links to records not copied, and lookups kept automatically
  let linkNodes = [
    {sobject: "Opportunity",
      fields: [lookup("AccountId", ["Account"]), lookup("CampaignId", ["Campaign"]), lookup("OwnerId", ["User"])],
      records: new Map([
        ["006A", {values: {AccountId: "001A", CampaignId: "701000000000001", OwnerId: "005000000000001"}}],
        ["006B", {values: {AccountId: "001A", CampaignId: "701000000000002", OwnerId: "005000000000001"}}],
        ["006C", {values: {AccountId: "001A", CampaignId: "701000000000001", OwnerId: null}}]
      ])},
    {sobject: "Task",
      fields: [lookup("WhoId", ["Contact", "Lead", "User"])],
      records: new Map([
        ["00TA", {values: {WhoId: "003A"}}], ["00TB", {values: {WhoId: "005000000000001"}}], ["00TC", {values: {WhoId: "003000000000009"}}]
      ])}
  ];
  assertEquals({
    links: [
      {sobject: "Opportunity", field: "CampaignId", referenceTo: ["Campaign"], distinctCount: 2, sampleIds: ["701000000000001", "701000000000002"], ids: ["701000000000001", "701000000000002"]},
      {sobject: "Task", field: "WhoId", referenceTo: ["Contact"], distinctCount: 1, sampleIds: ["003000000000009"], ids: ["003000000000009"]}
    ],
    keptFields: ["Opportunity.OwnerId", "Task.WhoId"]
  }, externalLinks(linkNodes, ctx.sourceIds, keyPrefixes));

  // Records to copy because of a "copy" link choice, by object
  let {links} = externalLinks(linkNodes, ctx.sourceIds, keyPrefixes);
  assertEquals([["Campaign", ["701000000000001", "701000000000002"]]],
    [...linkedRecordsToCopy(links, {"Opportunity.CampaignId": "copy", "Task.WhoId": "clear"}, ctx.sourceIds, keyPrefixes)].map(([type, ids]) => [type, [...ids]]));
  assertEquals([["Campaign", ["701000000000002"]], ["Contact", ["003000000000009"]]],
    [...linkedRecordsToCopy(links, {"Opportunity.CampaignId": "copy", "Task.WhoId": "copy"}, new Set(["701000000000001"]), keyPrefixes)].map(([type, ids]) => [type, [...ids]]));

  // Data Export query to transfer settings
  assertEquals({sobject: "Account", filter: "Id = '001A' AND Name != 'x ORDER BY (y)'", relationships: ["Contacts", "Opportunities", "Opportunities.OpportunityLineItems"]},
    parseTransferQuery("SELECT Id, Name, (SELECT Id FROM Contacts WHERE Email != null ORDER BY Name), (SELECT Id, (SELECT Id FROM OpportunityLineItems) FROM Opportunities) FROM Account WHERE Id = '001A' AND Name != 'x ORDER BY (y)' ORDER BY Name LIMIT 10"));
  assertEquals({sobject: "Contact", filter: "AccountId IN (SELECT Id FROM Account WHERE Name LIKE 'A%')", relationships: []},
    parseTransferQuery("select Id from Contact where AccountId IN (SELECT Id FROM Account WHERE Name LIKE 'A%') with SECURITY_ENFORCED"));
  assertEquals({sobject: "Lead", filter: "", relationships: []}, parseTransferQuery("SELECT Id FROM Lead LIMIT 5"));
  assertEquals({sobject: "Case", filter: "Subject = 'It\\'s (broken)'", relationships: []}, parseTransferQuery("SELECT Id FROM Case WHERE Subject = 'It\\'s (broken)'"));
  assertEquals(null, parseTransferQuery("FIND {Acme} RETURNING Account"));
}
