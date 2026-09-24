/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
import {ScrollTable, TableModel, RecordTable} from "./record-table.js";
import {DescribeInfo} from "./data-load.js";
/* global initButton */

/*
be able to launch new run (run of rule start by deleting previous result from local db)
make priority high red and low yellow
list of rule to create:

class:
  bachable or queuable schedulable without jobs in last 365 days
  hardcoded id in code instead of label
  soql in loop
  dml in loop
  SOQL injection : missing escape on parameter
  apex class without explicit sharing
  apex trigger with logic, soql or dml instead of service class
  apex class not reference and not rest apex

user:
  too many system admin
  custom Profiles or Permission Sets that with no assignment
  Role Hierarchy with too many levels
  Role with no member
  Empty Public Groups that are used only in Sharing Rules

Security:
  connected app admin pre auth with too many permission
  connected app admin pre auth without permission
  enable high assurance setting(s)

*/

class ApexAnalyzer {
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let apexLowCoverageRule = this.model.isRuleEnable("Apex Class with poor code coverage");
    let apexOldApiVersionRule = this.model.isRuleEnable("Apex Class with old API Version");
    let apexNeedRecompilationRule = this.model.isRuleEnable("Apex Class need recompilation");
    let apexHardcodedIdRule = this.model.isRuleEnable("Apex hardcoded id in code instead of label");
    let apexSoqlInLoopRule = this.model.isRuleEnable("Apex SOQL in loop");
    let apexDmlInLoopRule = this.model.isRuleEnable("Apex DML in loop");
    let apexWithoutSharingRule = this.model.isRuleEnable("Apex class without explicit sharing");
    let apexTriggerWithLogicRule = this.model.isRuleEnable("Apex trigger with SOQL/DML instead of service class");
    let apexClassNotReferencedRule = this.model.isRuleEnable("Apex class not referenced (not REST Apex)");
    let apexBatchableWithoutJobsRule = this.model.isRuleEnable("Apex job schedulable with no jobs in 365 days");
    let apexSoqlInjectionRule = this.model.isRuleEnable("Apex SOQL injection: missing escape on parameter");

    try {
      if (apexLowCoverageRule) {
        let logs = [];
        let queryCoverage = "SELECT ApexClassOrTriggerId, ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId != NULL AND ApexClassOrTrigger.Name != NULL AND (NumLinesCovered > 0 OR NumLinesUncovered > 0) AND NumLinesCovered != NULL AND NumLinesUncovered != NULL ORDER BY ApexClassOrTrigger.Name";
        let result = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryCoverage), {}), result, "Apex Class with poor code coverage").catch(error => {
          console.error(error);
        });
        for (let coverage of result.rows) {
          if (coverage.NumLinesCovered * 100 / (coverage.NumLinesCovered + coverage.NumLinesUncovered) < 75){
            logs.push({reference: coverage.ApexClassOrTrigger.Name, name: "Apex Class with poor code coverage", description: "This Apex class has a code coverage below 75%. Consider improving the test coverage to meet Salesforce deployment requirements.", priority: 3, setupLink: this.model.apexSetupLink(coverage.ApexClassOrTriggerId)});
          }
        }
        this.recordTable.addToTable(logs, {column: "priority"});
        this.model.resultTableModel.dataChange(this.recordTable);
        this.model.didUpdate();
      }
    } catch (error) {
      console.log(error);
    }

    try {
      if (apexOldApiVersionRule || apexNeedRecompilationRule) {
        let logs = [];
        let queryApexClass = "SELECT Id, Name, ApiVersion, IsValid, Status, NamespacePrefix FROM ApexClass";
        let result = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryApexClass), {}), result, "Apex Class with old API Version / need recompilation").catch(error => {
          console.error(error);
        });
        for (let apexClass of result.rows) {
          if (apexOldApiVersionRule && apexClass.ApiVersion < 50){
            logs.push({reference: (apexClass.NamespacePrefix ? apexClass.NamespacePrefix + "." : "") + apexClass.Name, name: "Apex Class with old API Version", description: "This Apex class is using an old API version (" + apexClass.ApiVersion + "). Consider updating it to a more recent version to take advantage of new features and improvements.", priority: apexClass.ApiVersion < 30 ? 1 : (apexClass.ApiVersion < 40 ? 2 : 3), setupLink: this.model.apexSetupLink(apexClass.Id)});
          }
          if (apexNeedRecompilationRule && !apexClass.IsValid){
            logs.push({reference: (apexClass.NamespacePrefix ? apexClass.NamespacePrefix + "." : "") + apexClass.Name, name: "Apex Class need recompilation", description: "This Apex class is invalid and needs recompilation. Please recompile the class to ensure it functions correctly.", priority: 1, setupLink: this.model.apexSetupLink(apexClass.Id)});
          }
        }
        this.recordTable.addToTable(logs, {column: "priority"});
        this.model.resultTableModel.dataChange(this.recordTable);
        this.model.didUpdate();
      }
    } catch (error) {
      console.log(error);
    }

    // Analyze Apex code patterns (hardcoded IDs, SOQL/DML in loops, etc.)
    try {
      if (apexHardcodedIdRule || apexSoqlInLoopRule || apexDmlInLoopRule || apexWithoutSharingRule || apexTriggerWithLogicRule || apexClassNotReferencedRule || apexBatchableWithoutJobsRule || apexSoqlInjectionRule) {
        let logs = [];

        // Get all Apex Classes with Body
        if (apexHardcodedIdRule || apexSoqlInLoopRule || apexDmlInLoopRule || apexWithoutSharingRule || apexClassNotReferencedRule || apexBatchableWithoutJobsRule || apexSoqlInjectionRule) {
          let queryApexClass = "SELECT Id, Name, Body, NamespacePrefix FROM ApexClass WHERE Status = 'Active' AND NamespacePrefix = null";
          let apexClassResult = {rows: []};
          await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryApexClass), {}), apexClassResult, "Apex code rules (ApexClass source)")
            .catch(error => {
              console.error(error);
            });

          // Get all Apex Triggers with Body
          let queryApexTrigger = "SELECT Id, Name, Body, TableEnumOrId, NamespacePrefix FROM ApexTrigger WHERE Status = 'Active' AND NamespacePrefix = null";
          let apexTriggerResult = {rows: []};
          if (apexTriggerWithLogicRule) {
            await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryApexTrigger), {}), apexTriggerResult, "Apex trigger with SOQL/DML instead of service class")
              .catch(error => {
                console.error(error);
              });
          }

          // Get referenced classes (for "not referenced" rule)
          let referencedClasses = new Set();
          let testClasses = new Set();
          if (apexClassNotReferencedRule) {
            // First, identify test classes to exclude them from references
            for (let apexClass of apexClassResult.rows) {
              if (apexClass.Body) {
                let className = (apexClass.NamespacePrefix ? apexClass.NamespacePrefix + "." : "") + apexClass.Name;
                if (/@isTest|@Test/i.test(apexClass.Body) || className.endsWith("Test") || className.endsWith("TestClass")) {
                  testClasses.add(apexClass.Name);
                  testClasses.add(className);
                }
              }
            }

            // Query MetadataComponentDependency to find class references
            let dependencyQuery = "SELECT MetadataComponentName, RefMetadataComponentName FROM MetadataComponentDependency WHERE RefMetadataComponentType = 'ApexClass'";
            let dependencyResult = {rows: []};
            await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(dependencyQuery), {}), dependencyResult, "Apex class not referenced (not REST Apex)")
              .catch(error => {
                console.error(error);
              });
            for (let dep of dependencyResult.rows) {
              // Only count references if the referencing class is NOT a test class
              if (dep.RefMetadataComponentName && !testClasses.has(dep.MetadataComponentName)) {
                referencedClasses.add(dep.RefMetadataComponentName);
              }
            }

            // Also check for REST Apex classes (classes with @RestResource annotation)
            for (let apexClass of apexClassResult.rows) {
              if (apexClass.Body && /@RestResource/i.test(apexClass.Body)) {
                referencedClasses.add(apexClass.Name);
              }
            }
          }

          // Get AsyncApexJob data for batchable/queueable/schedulable check
          let jobsInLastYear = new Set();
          if (apexBatchableWithoutJobsRule) {
            // Use LAST_N_DAYS:365 for last year
            let jobQuery = "SELECT ApexClass.Name FROM AsyncApexJob WHERE CreatedDate = LAST_N_DAYS:365 AND (JobType = 'BatchApex' OR JobType = 'Queueable' OR JobType = 'ScheduledApex')";
            let jobResult = {rows: []};
            await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(jobQuery), {}), jobResult, "Apex job schedulable with no jobs in 365 days")
              .catch(error => {
                console.error(error);
              });
            for (let job of jobResult.rows) {
              if (job.ApexClass?.Name) {
                jobsInLastYear.add(job.ApexClass.Name);
              }
            }
          }

          // Analyze each Apex Class
          for (let apexClass of apexClassResult.rows) {
            if (!apexClass.Body) continue;
            let className = (apexClass.NamespacePrefix ? apexClass.NamespacePrefix + "." : "") + apexClass.Name;
            let body = apexClass.Body;

            // Rule: Hardcoded ID in code instead of label
            if (apexHardcodedIdRule) {
              // Pattern for Salesforce IDs: 15 or 18 characters starting with alphanumeric
              let hardcodedIdPattern = /'([a-zA-Z0-9]{5}0[a-zA-Z0-9]{9}(?:[a-zA-Z0-9]{3})?)'/g;
              let matches = body.match(hardcodedIdPattern);
              if (matches && matches.length > 0) {
                logs.push({
                  reference: className,
                  name: "Apex hardcoded id in code instead of label",
                  description: `This Apex class contains ${matches.length} hardcoded Salesforce ID(s). Use custom labels or custom metadata instead of hardcoded IDs to improve maintainability and support multiple orgs.`,
                  priority: matches.length > 5 ? 2 : 3,
                  setupLink: this.model.apexSetupLink(apexClass.Id)
                });
              }
            }

            // Helper function to get line number from character index
            let getLineNumber = (code, index) => {
              let lineNumber = 1;
              for (let i = 0; i < index && i < code.length; i++) {
                if (code[i] === "\n") {
                  lineNumber++;
                }
              }
              return lineNumber;
            };

            // Helper function to extract code block by counting braces
            let extractBlock = (code, startIndex) => {
              if (startIndex >= code.length || code[startIndex] !== "{") {
                return null;
              }
              let depth = 0;
              let i = startIndex;
              let start = i;
              while (i < code.length) {
                if (code[i] === "{") {
                  depth++;
                } else if (code[i] === "}") {
                  depth--;
                  if (depth === 0) {
                    return code.substring(start + 1, i);
                  }
                } else if (code[i] === '"' || code[i] === "'") {
                  // Skip string literals
                  let quote = code[i];
                  i++;
                  while (i < code.length && code[i] !== quote) {
                    if (code[i] === "\\") {
                      i++; // Skip escaped character
                    }
                    i++;
                  }
                } else if (code.substring(i, i + 2) === "//") {
                  // Skip single-line comments
                  while (i < code.length && code[i] !== "\n") {
                    i++;
                  }
                } else if (code.substring(i, i + 2) === "/*") {
                  // Skip multi-line comments
                  i += 2;
                  while (i < code.length - 1 && code.substring(i, i + 2) !== "*/") {
                    i++;
                  }
                  i += 2;
                }
                i++;
              }
              return null;
            };

            // Rule: SOQL in loop
            if (apexSoqlInLoopRule) {
              // Find all loop statements
              let loopPattern = /(for\s*\([^)]*\)|while\s*\([^)]*\)|do)\s*\{/gi;
              let loopMatch;
              let foundSoqlInLoop = false;
              let soqlLineNumbers = [];

              while ((loopMatch = loopPattern.exec(body)) !== null) {
                let blockStart = loopMatch.index + loopMatch[0].length - 1; // Position of opening brace
                let blockContent = extractBlock(body, blockStart);

                if (blockContent) {
                  // Check if block contains SOQL (SELECT ... FROM ...)
                  let soqlPattern = /SELECT\s+[\s\S]{0,200}?FROM\s+\w+/gi;
                  let soqlMatch;
                  while ((soqlMatch = soqlPattern.exec(blockContent)) !== null) {
                    // Calculate line number relative to block start
                    let soqlIndexInBlock = soqlMatch.index;
                    let absoluteIndex = blockStart + 1 + soqlIndexInBlock;
                    let lineNumber = getLineNumber(body, absoluteIndex);
                    soqlLineNumbers.push(lineNumber);
                    foundSoqlInLoop = true;
                  }
                }
              }

              if (foundSoqlInLoop) {
                let lineNumbersText = soqlLineNumbers.length > 0 ? " Found at line(s): " + soqlLineNumbers.join(", ") + "." : "";
                logs.push({
                  reference: className,
                  name: "Apex SOQL in loop",
                  description: "This Apex class contains SOQL queries inside loops. This can lead to governor limit issues. Consider querying data outside the loop and storing it in collections." + lineNumbersText,
                  priority: 1,
                  setupLink: this.model.apexSetupLink(apexClass.Id)
                });
              }
            }

            // Rule: DML in loop
            if (apexDmlInLoopRule) {
              // Find all loop statements
              let loopPattern = /(for\s*\([^)]*\)|while\s*\([^)]*\)|do)\s*\{/gi;
              let loopMatch;
              let foundDmlInLoop = false;
              let dmlLineNumbers = [];

              while ((loopMatch = loopPattern.exec(body)) !== null) {
                let blockStart = loopMatch.index + loopMatch[0].length - 1; // Position of opening brace
                let blockContent = extractBlock(body, blockStart);

                if (blockContent) {
                  // Check if block contains DML operations
                  // Direct DML: insert, update, delete, upsert
                  // Database methods: Database.insert, Database.update, Database.delete, Database.upsert
                  let dmlPattern = /\n\s*(insert|update|delete|upsert)\s+|\bDatabase\.(insert|update|delete|upsert)\s*\(/gi;
                  let dmlMatch;
                  while ((dmlMatch = dmlPattern.exec(blockContent)) !== null) {
                    // Calculate line number relative to block start
                    let dmlIndexInBlock = dmlMatch.index;
                    let absoluteIndex = blockStart + 1 + dmlIndexInBlock;
                    let lineNumber = getLineNumber(body, absoluteIndex);
                    dmlLineNumbers.push(lineNumber);
                    foundDmlInLoop = true;
                  }
                }
              }

              if (foundDmlInLoop) {
                let lineNumbersText = dmlLineNumbers.length > 0 ? " Found at line(s): " + dmlLineNumbers.join(", ") + "." : "";
                logs.push({
                  reference: className,
                  name: "Apex DML in loop",
                  description: "This Apex class contains DML operations (insert, update, delete, upsert) inside loops. This can lead to governor limit issues. Consider collecting records and performing bulk DML operations outside the loop." + lineNumbersText,
                  priority: 1,
                  setupLink: this.model.apexSetupLink(apexClass.Id)
                });
              }
            }

            // Rule: Without explicit sharing
            if (apexWithoutSharingRule) {
              // Check if class has "with sharing" or "without sharing" declaration
              let classDeclarationPattern = /(public|global|private)?\s*(with\s+sharing|without\s+sharing)?\s*class\s+\w+/i;
              let match = body.match(classDeclarationPattern);
              if (match && !match[2]) {
                // No explicit sharing declaration found
                logs.push({
                  reference: className,
                  name: "Apex class without explicit sharing",
                  description: "This Apex class does not have an explicit sharing declaration (with sharing or without sharing). It's recommended to explicitly declare sharing model for security and clarity.",
                  priority: 3,
                  setupLink: this.model.apexSetupLink(apexClass.Id)
                });
              }
            }

            // Rule: Class not referenced (not REST Apex)
            if (apexClassNotReferencedRule) {
              // Skip test classes
              if (!/@isTest|@Test/i.test(body) && !className.endsWith("Test") && !className.endsWith("TestClass")) {
                if (!referencedClasses.has(apexClass.Name) && !referencedClasses.has(className)) {
                  logs.push({
                    reference: className,
                    name: "Apex class not referenced (not REST Apex)",
                    description: "This Apex class does not appear to be referenced by other classes and is not a REST Apex class. Consider reviewing if this class is still needed or if it should be removed.",
                    priority: 4,
                    setupLink: this.model.apexSetupLink(apexClass.Id)
                  });
                }
              }
            }

            // Rule: Batchable/Queueable/Schedulable without jobs in last 365 days
            if (apexBatchableWithoutJobsRule) {
              let isBatchable = /implements\s+Database\.Batchable/i.test(body);
              let isQueueable = /implements\s+Queueable/i.test(body);
              let isSchedulable = /implements\s+Schedulable/i.test(body);
              if ((isBatchable || isQueueable || isSchedulable) && !jobsInLastYear.has(apexClass.Name)) {
                let type = isBatchable ? "Batchable" : (isQueueable ? "Queueable" : "Schedulable");
                logs.push({
                  reference: className,
                  name: "Apex job schedulable with no jobs in 365 days",
                  description: `This Apex class implements ${type} but has no jobs executed in the last 365 days. Consider reviewing if this class is still needed or if it should be scheduled/executed.`,
                  priority: 4,
                  setupLink: this.model.setupLink("/lightning/setup/ScheduledJobs/home")
                });
              }
            }

            // Rule: SOQL injection - missing escape on parameter
            if (apexSoqlInjectionRule) {
              // Pattern: look for SOQL queries with string concatenation that might be vulnerable
              // This checks for patterns like: SELECT ... FROM ... WHERE field = ' + variable + '
              let soqlInjectionPattern = /SELECT\s+[\s\S]{0,300}?FROM\s+\w+[\s\S]{0,300}?WHERE[\s\S]{0,200}?['"]\s*\+\s*\w+\s*\+\s*['"]/i;
              if (soqlInjectionPattern.test(body)) {
                logs.push({
                  reference: className,
                  name: "Apex SOQL injection: missing escape on parameter",
                  description: "This Apex class contains SOQL queries with string concatenation that may be vulnerable to SOQL injection. Use bind variables or String.escapeSingleQuotes() to safely handle user input.",
                  priority: 1,
                  setupLink: this.model.apexSetupLink(apexClass.Id)
                });
              }
            }
          }

          // Analyze Apex Triggers
          if (apexTriggerWithLogicRule) {
            for (let apexTrigger of apexTriggerResult.rows) {
              if (!apexTrigger.Body) continue;
              let triggerName = (apexTrigger.NamespacePrefix ? apexTrigger.NamespacePrefix + "." : "") + apexTrigger.Name;
              let body = apexTrigger.Body;

              // Check if trigger has SOQL or DML directly (not calling service classes)
              // Simple heuristic: if trigger has SELECT or DML operations, it might have logic
              let hasSoql = /SELECT\s+[\s\S]{0,200}?FROM\s+\w+/i.test(body);
              let hasDml = /\b(insert|update|delete|upsert)\s+/i.test(body);
              // Check if it calls service classes (common pattern: ServiceClass.method())
              let callsServiceClass = /\w+Service\s*\.\s*\w+\s*\(/i.test(body) || /\w+Handler\s*\.\s*\w+\s*\(/i.test(body);

              if ((hasSoql || hasDml) && !callsServiceClass) {
                logs.push({
                  reference: triggerName + (apexTrigger.TableEnumOrId ? " (" + apexTrigger.TableEnumOrId + ")" : ""),
                  name: "Apex trigger with SOQL/DML instead of service class",
                  description: "This Apex trigger contains SOQL queries or DML operations directly instead of delegating to a service class. Consider refactoring to use a trigger handler pattern with service classes for better maintainability and testability.",
                  priority: 2,
                  setupLink: this.model.apexSetupLink(apexTrigger.Id)
                });
              }
            }
          }

          this.recordTable.addToTable(logs, {column: "priority"});
          this.model.resultTableModel.dataChange(this.recordTable);
          this.model.didUpdate();
        }
      }
    } catch (error) {
      console.error("Error analyzing Apex code patterns:", error);
    }
  }
}
class SecurityAnalyzer {
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let logs = [];
    let appNotUsedRule = this.model.isRuleEnable("Connected App OAuth Token not used recently");
    let appSelfAuthRule = this.model.isRuleEnable("Connected App allows self-authorization");
    let appUsedNotInstalledRule = this.model.isRuleEnable("Connected App is used but not installed");
    let appAdminPreAuthTooManyPermsRule = this.model.isRuleEnable("Connected app admin pre auth with too many permission");
    let appAdminPreAuthNoPermsRule = this.model.isRuleEnable("Connected app admin pre auth without permission");
    let extAppSelfAuthRule = this.model.isRuleEnable("External client app allows self-authorization");
    let extAppNotUsedRule = this.model.isRuleEnable("External client app OAuth Token not used recently");
    let orgWithoutIpRangeRule = this.model.isRuleEnable("No IP Range defined");

    try {
      if (orgWithoutIpRangeRule) {
        let queryApp = "SELECT Id, Start, End FROM IPRange";
        let ipRangeResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryApp), {}), ipRangeResult, "No IP Range defined");
        if (!ipRangeResult.failed && ipRangeResult.rows.length == 0){
          logs.push({reference: "", name: "No IP Range defined", description: "No IP Ranges are defined in your Salesforce org. It is recommended to set up IP Ranges to restrict access and enhance security.", priority: 2, setupLink: this.model.setupLink("/lightning/setup/NetworkAccess/home")});
        }
        this.recordTable.addToTable(logs, {column: "priority"});
        this.model.resultTableModel.dataChange(this.recordTable);
        this.model.didUpdate();
        logs = [];
      }
    } catch (error) {
      console.log(error);
    }

    if (!appNotUsedRule && !appSelfAuthRule && !appUsedNotInstalledRule && !appAdminPreAuthTooManyPermsRule && !appAdminPreAuthNoPermsRule && !extAppSelfAuthRule && !extAppNotUsedRule){
      return;
    }

    // List of allowed inactive connected apps (common Salesforce apps that are expected to be inactive)
    const allowedInactiveConnectedApps = [
      "Ant Migration Tool",
      "Chatter Desktop",
      "Chatter Mobile for BlackBerry",
      "Force.com IDE",
      "OIQ_Integration",
      "Salesforce CLI",
      "Salesforce Files",
      "Salesforce Mobile Dashboards",
      "Salesforce Touch",
      "Salesforce for Outlook",
      "SalesforceA",
      "SalesforceA for Android",
      "SalesforceA for iOS",
      "SalesforceDX Namespace Registry",
      "SalesforceIQ"
    ];

    try {
      // Get all applications found in LoginHistory (shared between connected apps and external client apps)
      let allAppsInLoginHistoryQuery = "SELECT Application FROM LoginHistory GROUP BY Application ORDER BY Application";
      let loginHistoryResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(allAppsInLoginHistoryQuery), {}), loginHistoryResult, "Connected App / External client app rules (LoginHistory)")
        .catch(error => {
          console.error(error);
        });
      let allAppsInLoginHistoryNames = new Set(loginHistoryResult.rows.map(record => record.Application));

      // Get all OAuthTokens (shared between connected apps and external client apps)
      // Create a map: AppName -> {LastUsedDate, User.Name}
      let oAuthTokenMap = new Map();
      if (appNotUsedRule || extAppNotUsedRule) {
        let oAuthTokenQuery = "SELECT AppName, User.Name, LastUsedDate FROM OAuthToken WHERE AppName != null ORDER BY AppName, LastUsedDate DESC";
        let oAuthTokenResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(oAuthTokenQuery), {}), oAuthTokenResult, "Connected App / External client app rules (OAuthToken)")
          .catch(error => {
            console.error(error);
          });

        // Group by AppName and keep only the latest (most recent LastUsedDate) for each app
        // Since we ordered by AppName, LastUsedDate DESC, the first token for each app is the latest
        for (let token of oAuthTokenResult.rows) {
          if (!token.AppName) continue;
          if (!oAuthTokenMap.has(token.AppName) && token.LastUsedDate) {
            oAuthTokenMap.set(token.AppName, {
              LastUsedDate: token.LastUsedDate,
              UserName: token.User?.Name || "Not set"
            });
          }
        }
      }

      // Get all Connected Apps
      let queryApp = "SELECT Id,Name,CreatedBy.Name,CreatedDate,LastModifiedBy.Name,LastModifiedDate,OptionsAllowAdminApprovedUsersOnly FROM ConnectedApplication ORDER BY Name";
      let allConnectedAppsResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryApp), {}), allConnectedAppsResult, "Connected App rules")
        .catch(error => {
          console.error(error);
        });

      // ConnectedApplication doesn't expose its OAuth scopes nor its pre-approved profiles/permission sets.
      // The latter are SetupEntityAccess rows (one per profile/permission set granted access to the app).
      let appAccessCounts = new Map();
      if (appAdminPreAuthTooManyPermsRule || appAdminPreAuthNoPermsRule) {
        let appAccessQuery = "SELECT SetupEntityId FROM SetupEntityAccess WHERE SetupEntityType = 'ConnectedApplication'";
        let appAccessResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(appAccessQuery), {}), appAccessResult, "Connected app admin pre auth rules")
          .catch(error => {
            console.error(error);
          });
        for (let access of appAccessResult.rows) {
          let appId = access.SetupEntityId.substring(0, 15);
          appAccessCounts.set(appId, (appAccessCounts.get(appId) || 0) + 1);
        }
      }

      // Get all installed AppMenuItems (for "used but not installed" check)
      // AppMenuItem has no relationship to ConnectedApplication: match on ApplicationId instead.
      let installedAppIds = null;
      if (appUsedNotInstalledRule) {
        let appMenuItemQuery = "SELECT ApplicationId FROM AppMenuItem WHERE Type = 'ConnectedApplication'";
        let appMenuItemResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(appMenuItemQuery), {}), appMenuItemResult, "Connected App is used but not installed")
          .catch(error => {
            appMenuItemResult.failed = true;
            console.error(error);
          });
        // An empty result may also mean a failed query: never flag every used app in that case
        if (!appMenuItemResult.failed && appMenuItemResult.rows.length > 0) {
          installedAppIds = new Set(appMenuItemResult.rows.filter(item => item.ApplicationId).map(item => item.ApplicationId.substring(0, 15)));
        }
      }

      // Analyze each connected app
      for (let connectedApp of allConnectedAppsResult.rows) {
        let appName = connectedApp.Name;
        // The app detail page needs the connected app definition Id (06P), which no API exposes: link to the "Manage Connected Apps" list
        let connectedAppLink = this.model.setupLink("/lightning/setup/ConnectedApplication/home");
        let loginHistoryFound = allAppsInLoginHistoryNames.has(appName);
        let severity = "log";
        let reason = "Found in Login History";

        // Check if app is in LoginHistory - if not, it's potentially unused
        if (!loginHistoryFound) {
          severity = "warning";
          reason = "Not Found in Login History";
        }

        // Check OAuthToken for last usage (from shared map)
        let oAuthTokenData = oAuthTokenMap.get(appName);
        let lastOAuthUsageDate = null;
        let lastOAuthUsageBy = null;

        if (oAuthTokenData && oAuthTokenData.LastUsedDate) {
          lastOAuthUsageDate = new Date(oAuthTokenData.LastUsedDate);
          lastOAuthUsageBy = oAuthTokenData.UserName;
          let now = new Date();
          let monthsSinceLastUsage = Math.floor((now - lastOAuthUsageDate) / (1000 * 60 * 60 * 24 * 30));

          // If OAuthToken < 6 months and not in LoginHistory, it's still OK
          if (monthsSinceLastUsage < 6 && !loginHistoryFound) {
            severity = "log";
            reason = "OAuth Token < 6 months";
          } else if (!loginHistoryFound) {
            // Not in LoginHistory and OAuthToken > 6 months
            reason = "Not Found in Login History and OAuth Token > 6 months";
          }
        } else if (!loginHistoryFound) {
          // Not in LoginHistory and no OAuthToken usage
          reason = "Not Found in Login History or used OAuth Token";
        }

        // Check if app is in allowed inactive list
        if (severity === "warning" && allowedInactiveConnectedApps.includes(appName)) {
          severity = "info";
          reason = "Member of ignored connected apps";
        }

        // Only log if severity is warning (unused apps)
        if (appNotUsedRule && severity === "warning") {
          let description = `This connected app has not been used recently. ${reason}.`;
          if (lastOAuthUsageDate) {
            description += ` Last OAuth token usage: ${lastOAuthUsageDate.toLocaleDateString()} (${lastOAuthUsageBy}).`;
          }
          description += " Consider reviewing the app's usage and revoking access if it's no longer needed.";
          logs.push({
            reference: appName,
            name: "Connected App OAuth Token not used recently",
            description,
            priority: 3,
            setupLink: connectedAppLink
          });
        }

        // Check self-authorization rule
        if (appSelfAuthRule && !connectedApp.OptionsAllowAdminApprovedUsersOnly) {
          logs.push({
            reference: appName,
            name: "Connected App allows self-authorization",
            description: "This connected app allows users to self-authorize. Consider restricting authorization to admin-approved users only to enhance security. (Click on [Manage Policies]>[Admin Users are pre-approved] > save + Select profiles/permission sets allowed",
            priority: 2,
            setupLink: connectedAppLink
          });
        }

        // Check if app is used but not installed
        if (appUsedNotInstalledRule && installedAppIds && oAuthTokenData && !installedAppIds.has(connectedApp.Id.substring(0, 15))) {
          logs.push({
            reference: appName,
            name: "Connected App is used but not installed",
            description: "This connected app has OAuth tokens in use but is not listed among installed connected apps. Investigate this discrepancy to ensure proper management of connected apps.",
            priority: 1,
            setupLink: connectedAppLink
          });
        }

        // Check admin pre-auth with too many permissions
        let permissionCount = appAccessCounts.get(connectedApp.Id.substring(0, 15)) || 0;
        if (appAdminPreAuthTooManyPermsRule && connectedApp.OptionsAllowAdminApprovedUsersOnly) {
          // Threshold: 10 profiles/permission sets
          const permissionThreshold = 10;
          if (permissionCount > permissionThreshold) {
            logs.push({
              reference: appName,
              name: "Connected app admin pre auth with too many permission",
              description: `This connected app has admin pre-approved users enabled and is granted to ${permissionCount} profiles/permission sets. Granting access too broadly increases security risk. Consider reviewing and reducing the profiles/permission sets allowed to follow the principle of least privilege.`,
              priority: permissionCount > 15 ? 1 : (permissionCount > 12 ? 2 : 3),
              setupLink: connectedAppLink
            });
          }
        }

        // Check admin pre-auth without permissions
        if (appAdminPreAuthNoPermsRule && connectedApp.OptionsAllowAdminApprovedUsersOnly && permissionCount == 0) {
          logs.push({
            reference: appName,
            name: "Connected app admin pre auth without permission",
            description: "This connected app has admin pre-approved users enabled but no profile or permission set is granted access, so no user can use it. Consider either assigning the appropriate profiles/permission sets or disabling admin pre-approval if not needed.",
            priority: 3,
            setupLink: connectedAppLink
          });
        }
      }

      // Analyze External Client Apps
      if (extAppSelfAuthRule || extAppNotUsedRule) {
        let extAppQuery = "SELECT Id, DeveloperName, CreatedBy.Name, CreatedDate, LastModifiedBy.Name, LastModifiedDate FROM ExternalClientApplication ORDER BY DeveloperName";
        let extAppResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(extAppQuery), {}), extAppResult, "External client app rules")
          .catch(error => {
            console.error(error);
          });

        // Query OAuth policy configuration for external client apps
        let extAppPolicyMap = new Map();
        if (extAppSelfAuthRule) {
          let extAppPolicyQuery = "SELECT ExternalClientApplicationId, PermittedUsersPolicyType FROM ExtlClntAppOauthPlcyCnfg WHERE ExternalClientApplicationId != null";
          let extAppPolicyResult = {rows: []};
          await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(extAppPolicyQuery), {}), extAppPolicyResult, "External client app allows self-authorization")
            .catch(error => {
              console.error(error);
            });
          for (let policy of extAppPolicyResult.rows) {
            if (policy.ExternalClientApplicationId) {
              extAppPolicyMap.set(policy.ExternalClientApplicationId, policy.PermittedUsersPolicyType);
            }
          }
        }

        for (let extApp of extAppResult.rows) {
          let appName = extApp.DeveloperName || extApp.Id;

          // Check self-authorization rule for external client apps
          if (extAppSelfAuthRule) {
            let policyType = extAppPolicyMap.get(extApp.Id);
            // If policy type is "AllSelfAuthorized" or not set (null), it allows self-authorization
            if (policyType === "AllSelfAuthorized" || policyType === null) {
              logs.push({
                reference: appName,
                name: "External client app allows self-authorization",
                description: "This external client app allows users to self-authorize. Consider restricting authorization to admin-approved users only to enhance security.",
                priority: 2,
                setupLink: this.model.setupLink("/lightning/setup/ManageExternalClientApplication/home")
              });
            }
          }

          // Check OAuth token usage for external client apps (using shared data)
          if (extAppNotUsedRule) {
            let loginHistoryFound = allAppsInLoginHistoryNames.has(appName);
            let severity = "log";
            let reason = "Found in Login History";

            if (!loginHistoryFound) {
              severity = "warning";
              reason = "Not Found in Login History";
            }

            // Check OAuthToken for last usage (from shared map)
            let oAuthTokenData = oAuthTokenMap.get(appName);
            let lastOAuthUsageDate = null;
            let lastOAuthUsageBy = null;

            if (oAuthTokenData && oAuthTokenData.LastUsedDate) {
              lastOAuthUsageDate = new Date(oAuthTokenData.LastUsedDate);
              lastOAuthUsageBy = oAuthTokenData.UserName;
              let now = new Date();
              let monthsSinceLastUsage = Math.floor((now - lastOAuthUsageDate) / (1000 * 60 * 60 * 24 * 30));

              if (monthsSinceLastUsage < 6 && !loginHistoryFound) {
                severity = "log";
                reason = "OAuth Token < 6 months";
              } else if (!loginHistoryFound) {
                reason = "Not Found in Login History and OAuth Token > 6 months";
              }
            } else if (!loginHistoryFound) {
              reason = "Not Found in Login History or used OAuth Token";
            }

            // Only log if severity is warning (unused apps)
            if (severity === "warning") {
              let description = `This external client app has not been used recently. ${reason}.`;
              if (lastOAuthUsageDate) {
                description += ` Last OAuth token usage: ${lastOAuthUsageDate.toLocaleDateString()} (${lastOAuthUsageBy}).`;
              }
              description += " Consider reviewing the app's usage and revoking access if it's no longer needed.";
              logs.push({
                reference: appName,
                name: "External client app OAuth Token not used recently",
                description,
                priority: 3,
                setupLink: this.model.setupLink("/lightning/setup/ManageExternalClientApplication/home")
              });
            }
          }
        }
      }

      this.recordTable.addToTable(logs, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    } catch (error) {
      console.error("Error analyzing connected apps and external client apps:", error);
    }
  }
}
class UserAnalyzer {
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let inactiveUserRule = this.model.isRuleEnable("Inactive user");
    let tooManySystemAdminRule = this.model.isRuleEnable("Too many System Administrators");
    let tooManyRoleLevelsRule = this.model.isRuleEnable("Role Hierarchy with too many levels");
    if (!inactiveUserRule && !tooManySystemAdminRule && !tooManyRoleLevelsRule) {
      return;
    }

    try {
      let logs = [];
      let query = "SELECT Id, LastLoginDate, LastName, FirstName, Profile.UserLicense.Name, Profile.Name, Username, Profile.UserLicense.LicenseDefinitionKey, IsActive, CreatedDate FROM User WHERE IsActive = true";
      let result = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query), {}), result, "User rules")
        .catch(error => {
          console.error(error);
        });

      // Check for too many System Administrators
      if (tooManySystemAdminRule) {
        let systemAdminCount = 0;
        let totalActiveUsers = 0;
        let systemAdminUsers = [];

        for (let user of result.rows) {
          totalActiveUsers++;
          if (user.Profile?.Name === "System Administrator") {
            systemAdminCount++;
            systemAdminUsers.push(user);
          }
        }

        // Threshold: 10% of active users or 10 absolute, whichever is higher
        const percentageThreshold = Math.max(10, Math.ceil(totalActiveUsers * 0.1));
        const absoluteThreshold = 10;
        const threshold = Math.max(percentageThreshold, absoluteThreshold);

        if (systemAdminCount > threshold) {
          let percentage = ((systemAdminCount / totalActiveUsers) * 100).toFixed(1);
          logs.push({
            reference: "System Administrator Profile",
            name: "Too many System Administrators",
            description: `Your org has ${systemAdminCount} System Administrators out of ${totalActiveUsers} active users (${percentage}%). Having too many System Administrators increases security risk. Consider using Permission Sets or custom profiles with limited administrative access for users who don't need full system administrator privileges.`,
            priority: systemAdminCount > 20 ? 1 : (systemAdminCount > 15 ? 2 : 3),
            setupLink: this.model.setupLink("/lightning/setup/ManageUsers/home")
          });
        }
      }

      // Check for inactive users
      if (inactiveUserRule) {
        let now = new Date();
        const oneMonthInDays = 30;
        const threeMonthsInDays = 90;

        for (let user of result.rows) {
          if (!user.IsActive) {
            continue;
          }

          let lastLoginDate = user.LastLoginDate ? new Date(user.LastLoginDate) : null;
          let userName = (user.FirstName ? user.FirstName + " " : "") + (user.LastName || "");
          let userReference = user.Username || user.Id;
          let userLink = this.model.setupLink("/lightning/setup/ManageUsers/page?address=%2F" + user.Id + "%3Fnoredirect%3D1");

          if (!lastLoginDate) {
            // User has never logged in - check if created more than 3 months ago
            let createdDate = user.CreatedDate ? new Date(user.CreatedDate) : null;
            if (createdDate) {
              let daysSinceCreation = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
              if (daysSinceCreation > threeMonthsInDays) {
                logs.push({
                  reference: userReference,
                  name: "Inactive user",
                  description: `User ${userName} (${user.Username}) has never logged in and was created ${Math.floor(daysSinceCreation / oneMonthInDays)} months ago. Consider deactivating if no longer needed.`,
                  priority: 3,
                  setupLink: userLink
                });
              } else if (daysSinceCreation > oneMonthInDays) {
                logs.push({
                  reference: userReference,
                  name: "Inactive user",
                  description: `User ${userName} (${user.Username}) has never logged in and was created ${Math.floor(daysSinceCreation / oneMonthInDays)} months ago.`,
                  priority: 5,
                  setupLink: userLink
                });
              }
            } else {
              // No creation date either - assume inactive
              logs.push({
                reference: userReference,
                name: "Inactive user",
                description: `User ${userName} (${user.Username}) has never logged in. Consider deactivating if no longer needed.`,
                priority: 5,
                setupLink: userLink
              });
            }
          } else {
            // User has logged in before - check last login date
            let daysSinceLastLogin = Math.floor((now - lastLoginDate) / (1000 * 60 * 60 * 24));
            if (daysSinceLastLogin > threeMonthsInDays) {
              logs.push({
                reference: userReference,
                name: "Inactive user",
                description: `User ${userName} (${user.Username}) has not logged in for ${Math.floor(daysSinceLastLogin / oneMonthInDays)} months (last login: ${lastLoginDate.toLocaleDateString()}). Consider deactivating if no longer needed.`,
                priority: 3,
                setupLink: userLink
              });
            } else if (daysSinceLastLogin > oneMonthInDays) {
              logs.push({
                reference: userReference,
                name: "Inactive user",
                description: `User ${userName} (${user.Username}) has not logged in for ${Math.floor(daysSinceLastLogin / oneMonthInDays)} months (last login: ${lastLoginDate.toLocaleDateString()}).`,
                priority: 5,
                setupLink: userLink
              });
            }
          }
        }
      }

      // Check for too many levels in role hierarchy
      if (tooManyRoleLevelsRule) {
        let roleQuery = "SELECT Id, Name, ParentRoleId FROM UserRole ORDER BY Name";
        let roleResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(roleQuery), {}), roleResult, "Role Hierarchy with too many levels")
          .catch(error => {
            console.error(error);
          });

        // Build role map: roleId -> role object
        let roleMap = new Map();
        for (let role of roleResult.rows) {
          roleMap.set(role.Id, {id: role.Id, name: role.Name, parentRoleId: role.ParentRoleId, children: []});
        }

        // Build parent-child relationships
        let rootRoles = [];
        for (let role of roleMap.values()) {
          if (role.parentRoleId) {
            let parentRole = roleMap.get(role.parentRoleId);
            if (parentRole) {
              parentRole.children.push(role);
            }
          } else {
            rootRoles.push(role);
          }
        }

        // Calculate maximum depth in hierarchy
        let calculateDepth = (role) => {
          if (role.children.length === 0) {
            return 1;
          }
          let maxChildDepth = 0;
          for (let child of role.children) {
            let childDepth = calculateDepth(child);
            if (childDepth > maxChildDepth) {
              maxChildDepth = childDepth;
            }
          }
          return maxChildDepth + 1;
        };

        let maxDepth = 0;
        for (let rootRole of rootRoles) {
          let depth = calculateDepth(rootRole);
          if (depth > maxDepth) {
            maxDepth = depth;
          }
        }

        // If no roles found, maxDepth will be 0, which is fine
        if (roleResult.rows.length > 0 && maxDepth === 0) {
          maxDepth = 1; // At least one level if roles exist
        }

        // Threshold: 10 levels
        const roleHierarchyThreshold = 10;
        if (maxDepth > roleHierarchyThreshold) {
          logs.push({
            reference: "Role Hierarchy",
            name: "Role Hierarchy with too many levels",
            description: `Your org's role hierarchy has ${maxDepth} levels. Having too many levels in the role hierarchy can make it difficult to manage and understand access control. Consider flattening the hierarchy or restructuring roles to reduce complexity. Salesforce recommends keeping role hierarchies manageable.`,
            priority: maxDepth > 15 ? 1 : (maxDepth > 12 ? 2 : 3),
            setupLink: this.model.setupLink("/lightning/setup/Roles/home")
          });
        }
      }

      this.recordTable.addToTable(logs, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    } catch (error) {
      console.error("Error analyzing users and roles:", error);
    }
  }
}

class InterfaceAnalyzer {
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let vfPageRule = this.model.isRuleEnable("Visualforce Page not migrated to LWC");
    let auraComponentRule = this.model.isRuleEnable("Aura Component not migrated to LWC");
    if (!vfPageRule && !auraComponentRule) {
      return;
    }

    let logs = [];

    try {
      // Query Visualforce Pages
      if (vfPageRule) {
        let vfPageQuery = "SELECT Id, Name, ApiVersion, LastModifiedDate, LastModifiedBy.Name FROM ApexPage WHERE NamespacePrefix = null ORDER BY Name";
        let vfPageResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(vfPageQuery), {}), vfPageResult, "Visualforce Page not migrated to LWC")
          .catch(error => {
            console.error(error);
          });

        for (let vfPage of vfPageResult.rows) {
          logs.push({
            reference: vfPage.Name,
            name: "Visualforce Page not migrated to LWC",
            description: `This Visualforce page (API Version: ${vfPage.ApiVersion || "N/A"}) should be migrated to Lightning Web Component (LWC) for better performance and modern UI capabilities. Last modified: ${vfPage.LastModifiedDate ? new Date(vfPage.LastModifiedDate).toLocaleDateString() : "N/A"} by ${vfPage.LastModifiedBy?.Name || "N/A"}.`,
            priority: 4,
            setupLink: this.model.setupLink("/lightning/setup/ApexPages/page?address=%2F" + vfPage.Id)
          });
        }
      }

      // Query Aura Components
      if (auraComponentRule) {
        let auraComponentQuery = "SELECT Id, DeveloperName, ApiVersion, LastModifiedDate, LastModifiedBy.Name FROM AuraDefinitionBundle WHERE NamespacePrefix = null ORDER BY DeveloperName";
        let auraComponentResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(auraComponentQuery), {}), auraComponentResult, "Aura Component not migrated to LWC")
          .catch(error => {
            console.error(error);
          });

        for (let auraComponent of auraComponentResult.rows) {
          logs.push({
            reference: auraComponent.DeveloperName,
            name: "Aura Component not migrated to LWC",
            description: `This Aura component (API Version: ${auraComponent.ApiVersion || "N/A"}) should be migrated to Lightning Web Component (LWC) for better performance and modern UI capabilities. Last modified: ${auraComponent.LastModifiedDate ? new Date(auraComponent.LastModifiedDate).toLocaleDateString() : "N/A"} by ${auraComponent.LastModifiedBy?.Name || "N/A"}.`,
            priority: 4,
            setupLink: this.model.setupLink("/lightning/setup/LightningComponentBundles/home")
          });
        }
      }

      this.recordTable.addToTable(logs, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    } catch (error) {
      console.error("Error analyzing Visualforce pages and Aura components:", error);
    }
  }
}

class AutomationAnalyzer {
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let processBuilderRule = this.model.isRuleEnable("Process Builder to migrate to Flow");
    let workflowRule = this.model.isRuleEnable("Workflow Rule to migrate to Flow");
    let flowOldApiVersionRule = this.model.isRuleEnable("Flow with old API Version");
    if (!processBuilderRule && !workflowRule && !flowOldApiVersionRule) {
      return;
    }

    let logs = [];

    try {
      // Query Process Builder processes
      // Process Builder processes are Flow records with ProcessType = 'Workflow' (legacy internal naming)
      if (processBuilderRule) {
        let processBuilderQuery = "SELECT Id, MasterLabel, ProcessType, LastModifiedDate, LastModifiedBy.Name, Status FROM Flow WHERE ProcessType = 'Workflow' AND Status = 'Active' ORDER BY MasterLabel";
        let processBuilderResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(processBuilderQuery), {}), processBuilderResult, "Process Builder to migrate to Flow")
          .catch(error => {
            console.error(error);
          });

        for (let processBuilder of processBuilderResult.rows) {
          logs.push({
            reference: processBuilder.MasterLabel,
            name: "Process Builder to migrate to Flow",
            description: `This Process Builder process should be migrated to a Flow. Process Builder is being deprecated in favor of Flow Builder, which provides better performance and more capabilities. Last modified: ${processBuilder.LastModifiedDate ? new Date(processBuilder.LastModifiedDate).toLocaleDateString() : "N/A"} by ${processBuilder.LastModifiedBy?.Name || "N/A"}.`,
            priority: 2,
            setupLink: this.model.setupLink("/lightning/setup/MigrateToFlowTool/home")
          });
        }
      }

      // Query Workflow Rules
      if (workflowRule) {
        // WorkflowRule has no Active field: the active flag is only in the Metadata field, which can be queried
        // one record at a time. So all non-managed rules are reported, active or not.
        let workflowQuery = "SELECT Id, Name, TableEnumOrId, LastModifiedDate, LastModifiedBy.Name FROM WorkflowRule WHERE NamespacePrefix = null ORDER BY Name";
        let workflowResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(workflowQuery), {}), workflowResult, "Workflow Rule to migrate to Flow")
          .catch(error => {
            console.error(error);
          });

        for (let workflow of workflowResult.rows) {
          logs.push({
            reference: workflow.Name + (workflow.TableEnumOrId ? " (" + workflow.TableEnumOrId + ")" : ""),
            name: "Workflow Rule to migrate to Flow",
            description: `This Workflow Rule should be migrated to a Flow, or deleted if it is inactive. Workflow Rules are being deprecated in favor of Flow Builder, which provides better performance, more capabilities, and better debugging tools. Last modified: ${workflow.LastModifiedDate ? new Date(workflow.LastModifiedDate).toLocaleDateString() : "N/A"} by ${workflow.LastModifiedBy?.Name || "N/A"}.`,
            priority: 2,
            setupLink: this.model.setupLink("/lightning/setup/MigrateToFlowTool/home")
          });
        }
      }

      // Query active Flow versions with an old API version
      // Only active versions matter (inactive/obsolete versions don't run), Process Builders are already
      // reported by the migration rule, and managed package flows can't be updated by the customer.
      if (flowOldApiVersionRule) {
        let flowQuery = "SELECT Id, MasterLabel, ApiVersion, ProcessType, VersionNumber, Definition.DeveloperName, Definition.NamespacePrefix FROM Flow WHERE Status = 'Active' AND ProcessType != 'Workflow' AND ApiVersion < 50 ORDER BY MasterLabel";
        let flowResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(flowQuery), {}), flowResult, "Flow with old API Version")
          .catch(error => {
            console.error(error);
          });

        for (let flow of flowResult.rows) {
          if (flow.Definition?.NamespacePrefix) {
            continue;
          }
          logs.push({
            reference: (flow.Definition?.DeveloperName || flow.MasterLabel) + " (v" + flow.VersionNumber + ")",
            name: "Flow with old API Version",
            description: `This active ${flow.ProcessType} flow is using an old API version (${flow.ApiVersion}). Flow runtime behavior depends on the API version: consider saving a new version with a recent API version and testing it.`,
            priority: flow.ApiVersion < 30 ? 1 : (flow.ApiVersion < 40 ? 2 : 3),
            setupLink: this.model.setupLink("/builder_platform_interaction/flowBuilder.app?flowId=" + flow.Id)
          });
        }
      }

      this.recordTable.addToTable(logs, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    } catch (error) {
      console.error("Error analyzing Process Builder, Workflow Rules and Flows:", error);
    }
  }
}

class EntityAnalyzer {
  //   object:
  //   too much validation rule by object
  //   too much trigger by object

  // fields:
  //   custom field with no reference (flow, apex, layout) and no data
  //   custom field with no data
  constructor(model, recordTable) {
    this.model = model;
    this.recordTable = recordTable;
  }
  async analyse() {
    let objWithoutDescRule = this.model.isRuleEnable("Custom SObject without description");
    let fieldWithoutDescRule = this.model.isRuleEnable("Custom Field without description");
    let fieldNotReferencedRule = this.model.isRuleEnable("Custom Field not referenced");
    let objWithManyFieldsDescRule = this.model.isRuleEnable("Entity with too many fields");
    let objWithManyValidationRulesRule = this.model.isRuleEnable("Entity with too many validation rules");
    let objWithManyTriggersRule = this.model.isRuleEnable("Entity with too many triggers");
    if (!objWithoutDescRule && !fieldWithoutDescRule && !fieldNotReferencedRule && !objWithManyFieldsDescRule && !objWithManyValidationRulesRule && !objWithManyTriggersRule){
      return;
    }

    let query;
    let tableFields = new Map();
    let entityDurableIds = new Map(); // entity API name -> EntityDefinition DurableId
    let logs = [];
    if (objWithoutDescRule) {
      query = "SELECT DurableId, QualifiedApiName FROM EntityDefinition WHERE PublisherId != 'System' and Description = null ORDER BY QualifiedApiName";
      let result = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {}), result, "Custom SObject without description")
        .catch(error => {
          console.log(error);
        });
      for (let i = 0; i < result.rows.length; i++) {
        let entity = result.rows[i];
        logs.push({reference: entity.QualifiedApiName, name: "Custom SObject without description", description: "Add description from SETUP > Object Manager > (select entity) > Edit", priority: 5, setupLink: this.model.objectSetupLink(entity.DurableId, "Details")});//5 low
      }
      this.recordTable.addToTable(logs, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }
    let fieldMap = new Map();
    // FieldDefinition is queried in chunks of 50 objects: this is the most API-expensive part, only run it for field rules
    let objectList = [];
    if (fieldWithoutDescRule || fieldNotReferencedRule || objWithManyFieldsDescRule) {
      let {globalDescribe} = this.model.describeInfo.describeGlobal(false);
      objectList = globalDescribe.sobjects.filter(s => (s.associateEntityType == null));
    }
    query = "SELECT Id, DurableId, QualifiedApiName, EntityDefinition.QualifiedApiName, Description FROM FieldDefinition WHERE PublisherId!= 'System' AND EntityDefinition.QualifiedApiName in ([RANGE])";
    for (let index = 0; index < objectList.length; index += 50) {
      let entityNames = objectList.slice(index, index + 50).map(e => "'" + e.name + "'");
      let fieldsFesult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query.replace("[RANGE]", entityNames.join(", "))), {}), fieldsFesult, "Field rules (FieldDefinition)")
        .catch(error => {
          console.log(error);
        });
      let logs2 = [];
      for (let j = 0; j < fieldsFesult.rows.length; j++){
        let field = fieldsFesult.rows[j];
        //&& field.QualifiedApiName.endsWith("__c")
        if (field.QualifiedApiName.endsWith("__c")){
          let durableIdParts = field.DurableId.split(".");
          if (durableIdParts.length > 1) {
            let fieldDurableId = durableIdParts[1]; // Second part is the field ID
            fieldMap.set(fieldDurableId, field);
          }
        }
        // DurableId is "<entity durable id>.<field durable id>", as used by getFieldDefinitionSetupLinks (setup-links.js)
        let [entityDurableId, fieldDurableIdPart] = field.DurableId.split(".");
        if (!field.Description && fieldWithoutDescRule){
          logs2.push({reference: field.EntityDefinition.QualifiedApiName + "." + field.QualifiedApiName, name: "Custom Field without description", description: "Add description from SETUP > Object Manager > (select entity) > Fields & Relationships > (select field) > Edit", priority: 5, setupLink: this.model.objectSetupLink(entityDurableId, "FieldsAndRelationships/" + fieldDurableIdPart)});//5 low
        }
        entityDurableIds.set(field.EntityDefinition.QualifiedApiName, entityDurableId);
        let cnt = tableFields.get(field.EntityDefinition.QualifiedApiName);
        if (!cnt){
          cnt = 0;
        }
        cnt++;
        tableFields.set(field.EntityDefinition.QualifiedApiName, cnt);
      }
      this.recordTable.addToTable(logs2, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }

    // Check for custom fields not referenced in MetadataComponentDependency
    if (fieldNotReferencedRule) {
      let logsFieldNotReferenced = [];
      let referencedFieldIds = new Set();

      // Query MetadataComponentDependency for CustomField references
      let dependencyQuery = "SELECT RefMetadataComponentId FROM MetadataComponentDependency WHERE RefMetadataComponentType = 'CustomField'";
      let dependencyResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(dependencyQuery), {}), dependencyResult, "Custom Field not referenced")
        .catch(error => {
          console.error(error);
        });

      // Build set of referenced field IDs (RefMetadataComponentId contains the field DurableId second part)
      for (let dep of dependencyResult.rows) {
        if (dep.RefMetadataComponentId) {
          referencedFieldIds.add(dep.RefMetadataComponentId.substring(0, 15));
        }
      }

      // Filter the list of custom fields using the map - find fields not in referencedFieldIds
      for (let [fieldDurableId, field] of fieldMap) {
        // If this field ID is not in the referenced set, log it
        if (!referencedFieldIds.has(fieldDurableId)) {
          let fieldFullName = field.EntityDefinition.QualifiedApiName + "." + field.QualifiedApiName;
          logsFieldNotReferenced.push({
            reference: fieldFullName,
            name: "Custom Field not referenced",
            description: "This custom field does not appear to be referenced in any metadata components (Apex classes, Flows, Process Builders, etc.). Consider reviewing if this field is still needed or if it should be removed.",
            priority: 4,
            setupLink: this.model.objectSetupLink(field.DurableId.split(".")[0], "FieldsAndRelationships/" + fieldDurableId)
          });
        }
      }

      this.recordTable.addToTable(logsFieldNotReferenced, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }

    let logs3 = [];
    if (objWithManyFieldsDescRule){
      for (let [key, value] of tableFields) {
        if (value > 100){
          logs3.push({reference: key, name: "Entity with too many fields", description: "Consider reducing the number of fields on this entity. Salesforce recommends no more than " + (value > 200 ? "200" : "100") + " fields per object to ensure optimal performance.", priority: (value > 200 ? 3 : 4), setupLink: this.model.objectSetupLink(entityDurableIds.get(key) || key, "FieldsAndRelationships")});
        }
      }
    }
    this.recordTable.addToTable(logs3, {column: "priority"});
    this.model.resultTableModel.dataChange(this.recordTable);
    this.model.didUpdate();

    // Check validation rules count per object
    if (objWithManyValidationRulesRule) {
      let logs4 = [];
      // Don't traverse the EntityDefinition relationship here: EntityDefinition doesn't support queryMore(),
      // so the query would fail after the first batch. EntityDefinitionId is the API name for standard
      // objects and the 01I id for custom ones, resolved below only for the objects over the threshold.
      let validationRuleQuery = "SELECT Id, EntityDefinitionId FROM ValidationRule";
      let validationRuleResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(validationRuleQuery), {}), validationRuleResult, "Entity with too many validation rules")
        .catch(error => {
          console.error(error);
        });

      // Count validation rules per object
      let validationRuleCounts = new Map();
      for (let validationRule of validationRuleResult.rows) {
        let entityId = validationRule.EntityDefinitionId;
        if (entityId) {
          let count = validationRuleCounts.get(entityId) || 0;
          validationRuleCounts.set(entityId, count + 1);
        }
      }

      // Check for objects with too many validation rules (threshold: 15)
      const validationRuleThreshold = 15;
      let overThreshold = [...validationRuleCounts].filter(([, count]) => count > validationRuleThreshold);
      let entityIdToName = new Map();
      let customEntityIds = overThreshold.map(([entityId]) => entityId).filter(entityId => entityId.startsWith("01I"));
      if (customEntityIds.length > 0) {
        let entityQuery = "SELECT DurableId, QualifiedApiName FROM EntityDefinition WHERE DurableId IN (" + customEntityIds.map(entityId => "'" + entityId.substring(0, 15) + "'").join(", ") + ")";
        let entityResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(entityQuery), {}), entityResult, "Entity with too many validation rules")
          .catch(error => {
            console.error(error);
          });
        for (let entity of entityResult.rows) {
          entityIdToName.set(entity.DurableId.substring(0, 15), entity.QualifiedApiName);
        }
      }
      for (let [entityId, count] of overThreshold) {
        let objectName = entityIdToName.get(entityId.substring(0, 15)) || entityId;
        logs4.push({
          reference: objectName,
          name: "Entity with too many validation rules",
          description: `This entity has ${count} validation rules. Consider consolidating or reviewing validation rules to improve maintainability and performance. Salesforce recommends keeping validation rules manageable per object.`,
          priority: count > 25 ? 2 : 3,
          // EntityDefinitionId is already the API name (standard) or the DurableId (custom) Object Manager expects
          setupLink: this.model.objectSetupLink(entityId, "ValidationRules")
        });
      }

      this.recordTable.addToTable(logs4, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }

    // Check triggers count per object (Apex triggers + Flow triggers)
    if (objWithManyTriggersRule) {
      let logs5 = [];
      let triggerCounts = new Map();

      // Query Apex Triggers
      let apexTriggerQuery = "SELECT Id, Name, TableEnumOrId, Status FROM ApexTrigger WHERE Status = 'Active' AND TableEnumOrId != null ORDER BY TableEnumOrId";
      let apexTriggerResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(apexTriggerQuery), {}), apexTriggerResult, "Entity with too many triggers")
        .catch(error => {
          console.error(error);
        });

      // Count Apex triggers per object
      for (let apexTrigger of apexTriggerResult.rows) {
        let objectName = apexTrigger.TableEnumOrId;
        if (objectName) {
          let count = triggerCounts.get(objectName) || 0;
          triggerCounts.set(objectName, count + 1);
        }
      }

      // Query Flow triggers (record-triggered flows)
      // Note: RecordTriggerType/TriggerType aren't fields on the Flow (tooling) object; the object/event
      // a flow triggers on is exposed via FlowDefinitionView (standard API), as TriggerObjectOrEventLabel.
      let flowTriggerQuery = "SELECT Id, Label, TriggerObjectOrEventLabel FROM FlowDefinitionView WHERE IsActive = true AND TriggerObjectOrEventLabel != null ORDER BY Label";
      let flowTriggerResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(flowTriggerQuery), {}), flowTriggerResult, "Entity with too many triggers")
        .catch(error => {
          console.error(error);
        });

      // TriggerObjectOrEventLabel is a label, but ApexTrigger.TableEnumOrId (used above) is an API name.
      // Resolve the label back to an API name via the global describe so counts for the same object merge.
      let {globalDescribe} = this.model.describeInfo.describeGlobal(false);
      let labelToApiName = new Map();
      for (let sobject of globalDescribe.sobjects) {
        if (!labelToApiName.has(sobject.label)) {
          labelToApiName.set(sobject.label, sobject.name);
        }
      }

      // Count Flow triggers per object
      for (let flowTrigger of flowTriggerResult.rows) {
        let objectName = flowTrigger.TriggerObjectOrEventLabel;
        if (objectName) {
          objectName = labelToApiName.get(objectName) || objectName;
          let count = triggerCounts.get(objectName) || 0;
          triggerCounts.set(objectName, count + 1);
        }
      }

      // Check for objects with too many triggers (threshold: 5)
      const triggerThreshold = 5;
      for (let [objectName, count] of triggerCounts) {
        if (count > triggerThreshold) {
          logs5.push({
            reference: objectName,
            name: "Entity with too many triggers",
            description: `This entity has ${count} active triggers (Apex triggers and/or Flow triggers). Consider consolidating triggers or using a trigger framework to improve maintainability and avoid execution order issues. Salesforce recommends keeping the number of triggers per object manageable.`,
            priority: count > 10 ? 2 : 3,
            setupLink: this.model.objectSetupLink(objectName, "ApexTriggers")
          });
        }
      }

      this.recordTable.addToTable(logs5, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }
  }
}
class Model {
  constructor(sfHost) {
    this.sfHost = sfHost;
    this.reactCallback = null;
    this.spinnerCount = 0;
    this.sfLink = "https://" + sfHost;
    this.userInfo = "...";
    this.progress = 0;
    this.progressCurrent = 0;
    this.progressTotal = 0;
    this.progressCurrentStep = "";
    this.winInnerHeight = 0;

    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => {
      this.didUpdate();
    });
    this.describeInfo.describeGlobal(false);
    // Processed data and UI state
    this.resultTableModel = new TableModel(sfHost, this.didUpdate.bind(this), {
      cellBackgroundColor: (column, value) => (column == "priority" ? priorityColors[value] : null)
    });
    this.resultError = null;
    this.analyzeStatus = "Ready";
    // Filter status of the table, kept apart from analyzeStatus which drives the Analyze/Stop buttons
    this.recordTable = new RecordTable(st => { this.resultStatus = st; });
    this.resultStatus = "";
    this.apiUsage = null;
    this.recordTable.describeInfo = this.describeInfo;
    this.recordTable.sfHost = sfHost;
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
      this.userId = res.userId;
    }));
    // highApiUsage: the rule needs many API calls (chunked FieldDefinition queries, full Apex source download, ...)
    this.rules = [
      {name: "Custom SObject without description", category: "Objects & Fields", selected: true, help: "Custom objects with an empty description."},
      {name: "Custom Field without description", category: "Objects & Fields", selected: true, highApiUsage: true, help: "Custom fields with an empty description. Queries the fields of every object (one call per 50 objects)."},
      //TODO not working seems metadata component dependency is not working
      //{name: "Custom Field not referenced", category: "Objects & Fields", selected: true, highApiUsage: true},
      {name: "Entity with too many fields", category: "Objects & Fields", selected: true, highApiUsage: true, help: "Objects with more than 100 fields (higher priority above 200). Queries the fields of every object (one call per 50 objects)."},
      {name: "Entity with too many validation rules", category: "Objects & Fields", selected: true, help: "Objects with more than 15 validation rules (higher priority above 25)."},
      {name: "Entity with too many triggers", category: "Objects & Fields", selected: true, help: "Objects with more than 5 active Apex triggers and record-triggered flows (higher priority above 10)."},
      {name: "Connected App OAuth Token not used recently", category: "Security", selected: true, help: "Connected apps absent from Login History and without OAuth token used in the last 6 months."},
      {name: "Connected App allows self-authorization", category: "Security", selected: true, help: "Connected apps that users can self-authorize, instead of admin pre-approval."},
      {name: "Connected App is used but not installed", category: "Security", selected: true, help: "Connected apps with OAuth tokens in use but not installed."},
      {name: "Connected app admin pre auth with too many permission", category: "Security", selected: true, help: "Admin pre-approved connected apps granted to more than 10 profiles/permission sets."},
      {name: "Connected app admin pre auth without permission", category: "Security", selected: true, help: "Admin pre-approved connected apps granted to no profile/permission set: no user can use them."},
      {name: "External client app allows self-authorization", category: "Security", selected: true, help: "External client apps whose OAuth policy lets users self-authorize."},
      {name: "External client app OAuth Token not used recently", category: "Security", selected: true, help: "External client apps absent from Login History and without OAuth token used in the last 6 months."},
      {name: "No IP Range defined", category: "Security", selected: true, help: "No trusted IP range defined in Network Access."},
      {name: "Apex Class with poor code coverage", category: "Apex", selected: true, help: "Apex classes and triggers with less than 75% code coverage."},
      {name: "Apex Class with old API Version", category: "Apex", selected: true, help: "Apex classes with an API version below 50 (higher priority below 40 and 30)."},
      {name: "Apex Class need recompilation", category: "Apex", selected: true, help: "Invalid Apex classes that need recompilation."},
      {name: "Apex hardcoded id in code instead of label", category: "Apex", selected: true, highApiUsage: true, help: "Non-managed Apex classes containing hardcoded Salesforce Ids. Downloads the source of every Apex class."},
      {name: "Apex SOQL in loop", category: "Apex", selected: true, highApiUsage: true, help: "Non-managed Apex classes with a SOQL query inside a loop. Downloads the source of every Apex class."},
      {name: "Apex DML in loop", category: "Apex", selected: true, highApiUsage: true, help: "Non-managed Apex classes with a DML operation inside a loop. Downloads the source of every Apex class."},
      {name: "Apex class without explicit sharing", category: "Apex", selected: true, highApiUsage: true, help: "Non-managed Apex classes declared without \"with sharing\" nor \"without sharing\". Downloads the source of every Apex class."},
      {name: "Apex trigger with SOQL/DML instead of service class", category: "Apex", selected: true, highApiUsage: true, help: "Non-managed Apex triggers running SOQL/DML directly instead of calling a service or handler class. Downloads the source of every Apex trigger."},
      {name: "Apex class not referenced (not REST Apex)", category: "Apex", selected: true, highApiUsage: true, help: "Non-managed, non-test, non-REST Apex classes not referenced by other metadata. Downloads the source of every Apex class."},
      {name: "Apex job schedulable with no jobs in 365 days", category: "Apex", selected: true, highApiUsage: true, help: "Batchable, Queueable or Schedulable Apex classes without any job in the last 365 days. Downloads the source of every Apex class."},
      {name: "Apex SOQL injection: missing escape on parameter", category: "Apex", selected: true, highApiUsage: true, help: "Non-managed Apex classes building a SOQL WHERE clause by string concatenation. Downloads the source of every Apex class."},
      {name: "Inactive user", category: "Users", selected: true, help: "Active users who never logged in or not for more than 1 month (higher priority above 3 months)."},
      {name: "Too many System Administrators", category: "Users", selected: true, help: "More System Administrators than 10 or 10% of active users, whichever is higher."},
      {name: "Role Hierarchy with too many levels", category: "Users", selected: true, help: "Role hierarchy deeper than 10 levels."},
      {name: "Visualforce Page not migrated to LWC", category: "Automation & UI", selected: true, help: "Non-managed Visualforce pages."},
      {name: "Aura Component not migrated to LWC", category: "Automation & UI", selected: true, help: "Non-managed Aura components."},
      {name: "Process Builder to migrate to Flow", category: "Automation & UI", selected: true, help: "Active Process Builder processes."},
      {name: "Workflow Rule to migrate to Flow", category: "Automation & UI", selected: true, help: "Non-managed Workflow Rules, active or not (the active flag can't be queried in bulk)."},
      {name: "Flow with old API Version", category: "Automation & UI", selected: true, help: "Active non-managed flows with an API version below 50 (higher priority below 40 and 30)."},
    ];
    this.loadRuleSelection();
  }
  applyResultFilter() {
    let filters = [];
    if (this.priorityFilter) {
      filters.push({field: "priority", operator: "=", value: this.priorityFilter});
    }
    if (this.ruleFilter) {
      filters.push({field: "name", operator: "=", value: this.ruleFilter});
    }
    this.recordTable.updateVisibility(filters.length ? filters : null);
    this.resultTableModel.dataChange(this.recordTable);
  }
  // Unselected rules are stored (not selected ones) so that a new rule is selected by default
  loadRuleSelection() {
    try {
      let unselected = JSON.parse(localStorage.getItem(unselectedRulesStorageKey));
      if (Array.isArray(unselected)) {
        for (let rule of this.rules) {
          rule.selected = !unselected.includes(rule.name);
        }
      }
    } catch (e) {
      console.warn("Could not load the org analyzer rule selection", e);
    }
  }
  saveRuleSelection() {
    try {
      localStorage.setItem(unselectedRulesStorageKey, JSON.stringify(this.rules.filter(rule => !rule.selected).map(rule => rule.name)));
    } catch (e) {
      console.warn("Could not save the org analyzer rule selection", e);
    }
  }
  async getDailyApiRequests() {
    try {
      let limits = await sfConn.rest("/services/data/v" + apiVersion + "/limits");
      return limits.DailyApiRequests;
    } catch (e) {
      console.error(e);
      return null;
    }
  }
  // Link to a Setup page, shown in the setupLink column of a result
  setupLink(path) {
    return "https://" + this.sfHost + path;
  }
  // Setup page of an Apex class (01p) or trigger (01q)
  apexSetupLink(id) {
    return this.setupLink((id.startsWith("01q") ? "/lightning/setup/ApexTriggers/page?address=%2F" : "/lightning/setup/ApexClasses/page?address=%2F") + id);
  }
  // entity: API name, or EntityDefinition DurableId for custom objects
  objectSetupLink(entity, page) {
    return this.setupLink("/lightning/setup/ObjectManager/" + encodeURIComponent(entity) + "/" + page + "/view");
  }
  isRuleEnable(ruleName) {
    return this.rules.some(rule => rule.name == ruleName && rule.selected);
  }
  getSeparator() {
    let separator = ",";
    if (localStorage.getItem("csvSeparator")) {
      separator = localStorage.getItem("csvSeparator");
    }
    return separator;
  }
  downloadCsv() {
    let separator = this.getSeparator();
    let downloadLink = document.createElement("a");
    const date = new Date();
    const timestamp = date.toISOString().replace(/[^0-9]/g, "");
    downloadLink.download = `orgAnalyze${timestamp}.csv`;
    let BOM = "\uFEFF";
    let bb = new Blob([BOM, this.recordTable.csvSerialize(separator)], {type: "text/csv;charset=utf-8"});
    downloadLink.href = window.URL.createObjectURL(bb);
    downloadLink.click();
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

  title() {
    if (this.analyzeStatus == "Ready") {
      return "Org Analyzer";
    }
    return "(Loading) Running Org Analyzer";
  }

  // ruleName: when set, a SalesforceRestError is reported as a "Rule failed" result instead of only being logged,
  // so that a broken query doesn't look like a healthy org. options.failed is set in that case.
  async batchHandler(batch, options, ruleName) {
    return batch.catch(err => {
      if (err.name == "AbortError") {
        return {records: [], done: true, totalSize: -1};
      }
      throw err;
    }).then(data => {
      options.rows = options.rows.concat(data.records);
      if (!data.done) {
        let pr = this.batchHandler(sfConn.rest(data.nextRecordsUrl, {}), options, ruleName);
        return pr;
      }
      return null;
    }, err => {
      if (err.name != "SalesforceRestError") {
        throw err; // not a SalesforceRestError
      }
      console.log(err);
      options.failed = true;
      if (ruleName) {
        this.reportRuleFailure(ruleName, err.message);
      }
      return null;
    });
  }
  reportRuleFailure(ruleName, message) {
    this.recordTable.addToTable([{reference: ruleName, name: "Rule failed", description: "This rule could not be evaluated, its result is incomplete: " + message, priority: 1}], {column: "priority"});
    this.resultTableModel.dataChange(this.recordTable);
  }
  async startAnalyze(){
    //this.logs = [];
    this.analyzeStatus = "Running";
    this.progressCurrent = 0;
    this.progressTotal = 6; // Total number of analyzers
    this.progressCurrentStep = "";
    this.apiUsage = null;
    this.didUpdate();
    let apiRequestsBefore = await this.getDailyApiRequests();

    let analyser = new EntityAnalyzer(this, this.recordTable);
    this.progressCurrentStep = "Analyzing Entities...";
    this.progressCurrent = 1;
    this.didUpdate();
    await analyser.analyse();

    analyser = new SecurityAnalyzer(this, this.recordTable);
    this.progressCurrentStep = "Analyzing Security...";
    this.progressCurrent = 2;
    this.didUpdate();
    await analyser.analyse();

    analyser = new ApexAnalyzer(this, this.recordTable);
    this.progressCurrentStep = "Analyzing Apex...";
    this.progressCurrent = 3;
    this.didUpdate();
    await analyser.analyse();

    analyser = new UserAnalyzer(this, this.recordTable);
    this.progressCurrentStep = "Analyzing Users...";
    this.progressCurrent = 4;
    this.didUpdate();
    await analyser.analyse();

    analyser = new InterfaceAnalyzer(this, this.recordTable);
    this.progressCurrentStep = "Analyzing Interfaces...";
    this.progressCurrent = 5;
    this.didUpdate();
    await analyser.analyse();

    analyser = new AutomationAnalyzer(this, this.recordTable);
    this.progressCurrentStep = "Analyzing Automation...";
    this.progressCurrent = 6;
    this.didUpdate();
    await analyser.analyse();

    // Org-wide counter: other integrations running meanwhile are counted too
    let apiRequestsAfter = await this.getDailyApiRequests();
    if (apiRequestsBefore && apiRequestsAfter) {
      this.apiUsage = {used: apiRequestsBefore.Remaining - apiRequestsAfter.Remaining, remaining: apiRequestsAfter.Remaining, max: apiRequestsAfter.Max};
    }

    this.analyzeStatus = "Ready";
    this.progressCurrentStep = "";
    this.progressCurrent = 0;
    // self.recordTable.records = self.logs;
    // if (self.recordTable.table.length == 0 && self.logs.length > 0){
    //   self.recordTable.table.push(self.recordTable.header);
    //   self.recordTable.rowVisibilities.push(true);
    // }
    // for (let record of self.logs) {
    //   let row = new Array(self.recordTable.header.length);
    //   row[0] = record;
    //   self.recordTable.table.push(row);
    //   self.recordTable.rowVisibilities.push(self.recordTable.isVisible(row));
    //   self.recordTable.discoverColumns(record, "", row);
    // }
    //self.recordTable.totalSize = self.logs.length;
    this.didUpdate();
  }
}

let h = React.createElement;

const unselectedRulesStorageKey = "orgAnalyzerUnselectedRules";
const ruleCategories = ["Objects & Fields", "Security", "Apex", "Users", "Automation & UI"];
const priorityLabels = {1: "Critical", 2: "High", 3: "Medium", 4: "Low", 5: "Info"};
const priorityColors = {1: "#f9d2cf", 2: "#fde0c5", 3: "#fff1c2", 4: "#dcecf9", 5: "#eeeeee"};

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onStartClick = this.onStartClick.bind(this);
    this.onStopAnalyze = this.onStopAnalyze.bind(this);
    this.onSelectPriorityFilter = this.onSelectPriorityFilter.bind(this);
    this.onSelectRuleFilter = this.onSelectRuleFilter.bind(this);
    this.onSelectAllChange = this.onSelectAllChange.bind(this);
    this.onDownloadCsv = this.onDownloadCsv.bind(this);
    this.onPrioritySummaryClick = this.onPrioritySummaryClick.bind(this);
  }
  onPrioritySummaryClick(priority) {
    let {model} = this.props;
    // Clicking the active priority again clears the filter
    model.priorityFilter = model.priorityFilter == priority ? "" : priority;
    model.applyResultFilter();
  }
  onStartClick() {
    let {model} = this.props;
    model.startAnalyze();
  }
  onStopAnalyze() {
    let {model} = this.props;
    model.stopAnalyze();
  }
  onSelectPriorityFilter(event) {
    let {model} = this.props;
    model.priorityFilter = event.target.value;
    model.applyResultFilter();
  }
  onSelectRuleFilter(event) {
    let {model} = this.props;
    model.ruleFilter = event.target.value;
    model.applyResultFilter();
  }
  onSelectAllChange(e) {
    let {model} = this.props;
    let checked = e.target.checked;
    for (let rule of model.rules) {
      rule.selected = checked;
    }
    if (model.selectAll && model.rules) {
      model.selectAll.indeterminate = (model.rules.some(rule => rule.selected) && model.rules.some(rule => !rule.selected));
    }
    model.saveRuleSelection();
    model.didUpdate();
  }
  onDownloadCsv() {
    let {model} = this.props;
    model.downloadCsv();
    model.didUpdate();
  }
  componentDidMount() {
    let {model} = this.props;
    function resize() {
      model.winInnerHeight = innerHeight;
      model.didUpdate(); // Will call recalculateSize
    }
    addEventListener("resize", resize);
    resize();
  }
  render() {
    let {model} = this.props;
    //TODO UX
    // progress bar
    // checkbox for each rule => rules list
    document.title = model.title();
    let hostArg = new URLSearchParams();
    hostArg.set("host", model.sfHost);
    hostArg.set("tab", 5);
    let selectAllChecked = model.rules && model.rules.every(rule => rule.selected);
    let highApiUsageSelected = model.rules.some(rule => rule.highApiUsage && rule.selected);
    let priorityCounts = new Map();
    for (let record of model.recordTable.records) {
      priorityCounts.set(record.priority, (priorityCounts.get(record.priority) || 0) + 1);
    }
    let resultRuleNames = [...new Set(model.recordTable.records.map(record => record.name))].sort();

    return (
      h("div", {},
        h("div", {id: "user-info", className: "object-bar"},
          h("a", {href: model.sfLink, className: "sf-link"},
            h("svg", {viewBox: "0 0 24 24"},
              h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
            ),
            " Salesforce Home"
          ),
          h("h1", {}, "Org Analyzer"),
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
        h("div", {className: "area"},
          h("div", {className: "slds-notification slds-notification_alert", role: "alert", hidden: !highApiUsageSelected, style: {backgroundColor: "#FFB75D", color: "#080707", padding: "12px", marginBottom: "16px", borderRadius: "4px", border: "1px solid #DDDBDA"}},
            h("div", {style: {display: "flex", alignItems: "center"}},
              h("svg", {style: {width: "20px", height: "20px", marginRight: "8px", flexShrink: 0}, viewBox: "0 0 24 24", fill: "currentColor"},
                h("path", {d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"})
              ),
              h("div", {style: {flex: 1}},
                h("strong", {style: {display: "block", marginBottom: "4px"}}, "Warning: High API Usage"),
                h("span", {style: {fontSize: "12px"}}, "Some selected rules (marked with ", h(HighApiUsageIcon), ") make many API calls to analyze your org. Please monitor your org's API limits and save results using the CSV download feature for future reference.")
              )
            )
          ),
          h("h1", {}, "Rules"),
          h("div", {},
            h("span", {}, "Select the rules you want to run: "),
            h("label", {},
              h("input", {type: "checkbox", className: "checkbox-control", ref: "selectref", checked: selectAllChecked, onChange: this.onSelectAllChange}),
              "Select all"
            ),
            h("div", {className: "rule-categories"},
              ruleCategories.map(category => h(RuleCategory, {key: category, model, category, rules: model.rules.filter(rule => rule.category == category)}))
            )
          ),
          h("div", {className: "autocomplete-header"},
            h("div", {className: "flex-right"},
              h("button", {className: "highlighted", onClick: this.onStartClick, hidden: (model.analyzeStatus != "Ready")}, "Analyze org"),
            ),
          ),
        ),
        h("div", {className: "area", id: "result-area"},
          h("div", {className: "result-bar"},
            h("h1", {}, "Results"),
            h("button", {disabled: (model.recordTable == null || model.recordTable.countOfVisibleRecords == null), onClick: this.onDownloadCsv, title: "Download csv file"},
              h("svg", {className: "download-icon"},
                h("use", {xlinkHref: "symbols.svg#download"})
              )
            ),
            h("select", {value: model.ruleFilter || "", onChange: this.onSelectRuleFilter, className: "rule-filter select-control"},
              h("option", {value: ""}, "All rules"),
              resultRuleNames.map(ruleName => h("option", {key: ruleName, value: ruleName}, ruleName))
            ),
            h("span", {className: "result-status flex-right"},
              model.apiUsage ? h("span", {className: "api-usage", title: "Org-wide daily API requests: calls made meanwhile by other users or integrations are counted too"}, `~${model.apiUsage.used} API requests used, ${model.apiUsage.remaining} / ${model.apiUsage.max} remaining today`) : null,
              h("span", {}, model.analyzeStatus == "Ready" ? model.resultStatus : model.analyzeStatus),
              h("button", {className: "cancel-btn", hidden: (model.analyzeStatus == "Ready"), onClick: this.onStopAnalyze}, "Stop"),
            ),
          ),
          h("div", {className: "priority-summary", hidden: priorityCounts.size == 0},
            Object.entries(priorityLabels).map(([priority, label]) =>
              h("button", {
                key: priority,
                className: "priority-summary-item" + (model.priorityFilter == priority ? " active" : ""),
                style: {backgroundColor: priorityColors[priority]},
                disabled: !priorityCounts.get(Number(priority)),
                title: "Show only " + label + " results (click again to show all)",
                onClick: () => this.onPrioritySummaryClick(priority)
              }, h("strong", {}, priorityCounts.get(Number(priority)) || 0), " " + label)
            )
          ),
          h("div", {hidden: (model.analyzeStatus == "Ready" || model.progressTotal == 0), style: {marginTop: "12px", marginBottom: "8px", padding: "0 16px"}},
            h("div", {style: {display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "12px", color: "#706e6b"}},
              h("span", {}, model.progressCurrentStep || "Analyzing..."),
              h("span", {}, `${model.progressCurrent} / ${model.progressTotal}`)
            ),
            h("div", {style: {width: "100%", height: "8px", backgroundColor: "#DDDBDA", borderRadius: "4px", overflow: "hidden"}},
              h("div", {
                style: {
                  width: `${(model.progressCurrent / model.progressTotal) * 100}%`,
                  height: "100%",
                  backgroundColor: "#0070d2",
                  transition: "width 0.3s ease"
                }
              })
            )
          ),
          h("textarea", {className: "result-text", readOnly: true, value: model.resultError || "", hidden: model.resultError == null}),
          h(ScrollTable, {model: model.resultTableModel, hidden: (model.resultError != null)})
        )
      )
    );
  }
}
class RuleSelector extends React.Component {
  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
  }
  onChange(e) {
    let {rule, model} = this.props;
    rule.selected = e.target.checked;
    if (model.selectAll && model.rules) {
      model.selectAll.indeterminate = (model.rules.some(r => r.selected) && model.rules.some(r => !r.selected));
    }
    model.saveRuleSelection();
    model.didUpdate();
  }
  render() {
    let {rule} = this.props;
    return h("div", {className: "rule-item"}, h("label", {title: rule.help + (rule.highApiUsage ? " (high API usage)" : "")},
      h("input", {type: "checkbox", className: "checkbox-control", checked: rule.selected, onChange: this.onChange}),
      rule.highApiUsage ? h(HighApiUsageIcon) : null,
      rule.name
    ));
  }
}
class RuleCategory extends React.Component {
  constructor(props) {
    super(props);
    this.onChange = this.onChange.bind(this);
  }
  onChange(e) {
    let {rules, model} = this.props;
    for (let rule of rules) {
      rule.selected = e.target.checked;
    }
    model.saveRuleSelection();
    model.didUpdate();
  }
  render() {
    let {rules, model, category} = this.props;
    return h("div", {className: "rule-category"},
      h("h2", {className: "rule-group-title"},
        h("label", {},
          h("input", {type: "checkbox", className: "checkbox-control", checked: rules.every(rule => rule.selected), onChange: this.onChange}),
          category
        )
      ),
      h("div", {className: "rule-list"},
        rules.map(rule => h(RuleSelector, {key: rule.name, model, rule}))
      )
    );
  }
}
function HighApiUsageIcon() {
  return h("svg", {className: "high-api-usage-icon", "aria-label": "High API usage"},
    h("title", {}, "High API usage"),
    h("use", {xlinkHref: "symbols.svg#warning"})
  );
}

{

  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {

    let root = document.getElementById("root");
    let model = new Model(sfHost);
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

  });

}
