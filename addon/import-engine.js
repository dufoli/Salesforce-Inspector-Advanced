import {apiVersion} from "./inspector.js";

// Writes records to Salesforce with the SOAP API, shared by data import and data transfer.
// Callers own batch scheduling (size, concurrency, retries) and pass the connection of the target org.

// Returns the empty SOAP arguments for importAction, to be filled with one batch of records:
// ID (delete, undelete, hardDelete), met:fullNames (deleteMetadata), met:metadata (upsertMetadata) or sObjects (others)
export function createImportArgs(importAction, externalIdFieldName) {
  let importArgs = {};
  if (importAction == "upsert") {
    importArgs.externalIDFieldName = externalIdFieldName;
  }
  if (importAction == "delete" || importAction == "undelete" || importAction == "hardDelete") {
    importArgs.ID = [];
  } else if (importAction == "deleteMetadata") {
    importArgs["met:type"] = "CustomMetadata";
    importArgs["met:fullNames"] = [];
  } else if (importAction == "upsertMetadata") {
    importArgs["met:metadata"] = [];
  } else {
    importArgs.sObjects = [];
  }
  return importArgs;
}

// Sends one batch and resolves with one result per record, in input order: {success, id, action, error}.
// When the whole batch fails (e.g. a misspelled field), rejects with an error named "SalesforceSoapError".
// @param headers: optional SOAP headers, e.g. {AssignmentRuleHeader: {useDefaultRule: true}}
export async function soapImport(conn, apiType, importAction, importArgs, headers) {
  let wsdl = conn.wsdl(apiVersion, apiType);
  let res = await conn.soap(wsdl, importAction, importArgs, {headers});
  return conn.asArray(res).map(result => {
    let success = result.success == "true";
    return {
      success,
      id: result.id || "",
      action: success ? importActionLabel(importAction, result) : "",
      error: conn.asArray(result.errors).map(errorNode =>
        errorNode.statusCode
        + ": " + errorNode.message
        + " [" + conn.asArray(errorNode.fields).join(", ") + "]"
      ).join(", ")
    };
  });
}

function importActionLabel(importAction, result) {
  return importAction == "create" ? "Inserted"
    : importAction == "update" ? "Updated"
    : importAction == "upsert" || importAction == "upsertMetadata" ? (result.created == "true" ? "Inserted" : "Updated")
    : importAction == "delete" || importAction == "deleteMetadata" ? "Deleted"
    : importAction == "undelete" ? "Undeleted"
    : "Unknown";
}
