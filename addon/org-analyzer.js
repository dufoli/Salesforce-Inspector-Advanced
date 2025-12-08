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
    let apexTriggerWithLogicRule = this.model.isRuleEnable("Apex trigger with logic, SOQL or DML instead of service class");
    let apexClassNotReferencedRule = this.model.isRuleEnable("Apex class not referenced (not REST Apex)");
    let apexBatchableWithoutJobsRule = this.model.isRuleEnable("Apex batchable or queueable schedulable without jobs in last 365 days");
    let apexSoqlInjectionRule = this.model.isRuleEnable("Apex SOQL injection: missing escape on parameter");

    try {
      if (apexLowCoverageRule) {
        let logs = [];
        let queryCoverage = "SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId != NULL AND ApexClassOrTrigger.Name != NULL AND (NumLinesCovered > 0 OR NumLinesUncovered > 0) AND NumLinesCovered != NULL AND NumLinesUncovered != NULL ORDER BY ApexClassOrTrigger.Name";
        let result = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryCoverage), {}), result).catch(error => {
          console.error(error);
        });
        for (let coverage of result.rows) {
          if (coverage.NumLinesCovered * 100 / (coverage.NumLinesCovered + coverage.NumLinesUncovered) < 75){
            logs.push({reference: coverage.ApexClassOrTrigger.Name, name: "Apex Class with poor code coverage", description: "This Apex class has a code coverage below 75%. Consider improving the test coverage to meet Salesforce deployment requirements.", priority: 3});
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
        let queryApexClass = "SELECT Name, ApiVersion, IsValid, Status, NamespacePrefix FROM ApexClass";
        let result = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryApexClass), {}), result).catch(error => {
          console.error(error);
        });
        for (let apexClass of result.rows) {
          if (apexOldApiVersionRule && apexClass.ApiVersion < 50){
            logs.push({reference: (apexClass.NamespacePrefix ? apexClass.NamespacePrefix + "." : "") + apexClass.Name, name: "Apex Class with old API Version", description: "This Apex class is using an old API version (" + apexClass.ApiVersion + "). Consider updating it to a more recent version to take advantage of new features and improvements.", priority: apexClass.ApiVersion < 30 ? 1 : (apexClass.ApiVersion < 40 ? 2 : 3)});
          }
          if (apexNeedRecompilationRule && !apexClass.IsValid){
            logs.push({reference: (apexClass.NamespacePrefix ? apexClass.NamespacePrefix + "." : "") + apexClass.Name, name: "Apex Class need recompilation", description: "This Apex class is invalid and needs recompilation. Please recompile the class to ensure it functions correctly.", priority: 1});
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
          await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryApexClass), {}), apexClassResult)
            .catch(error => {
              console.error(error);
            });

          // Get all Apex Triggers with Body
          let queryApexTrigger = "SELECT Id, Name, Body, TableEnumOrId, NamespacePrefix FROM ApexTrigger WHERE Status = 'Active' AND NamespacePrefix = null";
          let apexTriggerResult = {rows: []};
          if (apexTriggerWithLogicRule) {
            await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryApexTrigger), {}), apexTriggerResult)
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
            let dependencyQuery = "SELECT MetadataComponentName, RefMetadataComponentName FROM MetadataComponentDependency WHERE MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'ApexClass'";
            let dependencyResult = {rows: []};
            await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(dependencyQuery), {}), dependencyResult)
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
            await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(jobQuery), {}), jobResult)
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
                  priority: matches.length > 5 ? 2 : 3
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
                  priority: 1
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
                  priority: 1
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
                  priority: 3
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
                    priority: 4
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
                  name: "Apex batchable or queueable schedulable without jobs in last 365 days",
                  description: `This Apex class implements ${type} but has no jobs executed in the last 365 days. Consider reviewing if this class is still needed or if it should be scheduled/executed.`,
                  priority: 4
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
                  priority: 1
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
                  name: "Apex trigger with logic, SOQL or DML instead of service class",
                  description: "This Apex trigger contains SOQL queries or DML operations directly instead of delegating to a service class. Consider refactoring to use a trigger handler pattern with service classes for better maintainability and testability.",
                  priority: 2
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
        let data = await sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(queryApp), {});
        if (!data.records || data.records.length == 0){
          logs.push({reference: "", name: "No IP Range defined", description: "No IP Ranges are defined in your Salesforce org. It is recommended to set up IP Ranges to restrict access and enhance security.", priority: 2});
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
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(allAppsInLoginHistoryQuery), {}), loginHistoryResult)
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
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(oAuthTokenQuery), {}), oAuthTokenResult)
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
      let queryApp = "SELECT Name,CreatedBy.Name,CreatedDate,LastModifiedBy.Name,LastModifiedDate,OptionsAllowAdminApprovedUsersOnly,OAuthScopes,Permissions FROM ConnectedApplication ORDER BY Name";
      let allConnectedAppsResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(queryApp), {}), allConnectedAppsResult)
        .catch(error => {
          console.error(error);
        });

      // Get all installed AppMenuItems (for "used but not installed" check)
      let installedAppNames = new Set();
      if (appUsedNotInstalledRule) {
        let appMenuItemQuery = "SELECT ApplicationId, ConnectedApplication.Name FROM AppMenuItem WHERE ConnectedApplication.Name != null";
        let appMenuItemResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(appMenuItemQuery), {}), appMenuItemResult)
          .catch(error => {
            console.error(error);
          });
        for (let item of appMenuItemResult.rows) {
          if (item.ConnectedApplication?.Name) {
            installedAppNames.add(item.ConnectedApplication.Name);
          }
        }
      }

      // Analyze each connected app
      for (let connectedApp of allConnectedAppsResult.rows) {
        let appName = connectedApp.Name;
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
            priority: 3
          });
        }

        // Check self-authorization rule
        if (appSelfAuthRule && !connectedApp.OptionsAllowAdminApprovedUsersOnly) {
          logs.push({
            reference: appName,
            name: "Connected App allows self-authorization",
            description: "This connected app allows users to self-authorize. Consider restricting authorization to admin-approved users only to enhance security. (Click on [Manage Policies]>[Admin Users are pre-approved] > save + Select profiles/permission sets allowed",
            priority: 2
          });
        }

        // Check if app is used but not installed
        if (appUsedNotInstalledRule && oAuthTokenData && !installedAppNames.has(appName)) {
          logs.push({
            reference: appName,
            name: "Connected App is used but not installed",
            description: "This connected app has OAuth tokens in use but is not listed among installed connected apps. Investigate this discrepancy to ensure proper management of connected apps.",
            priority: 1
          });
        }

        // Check admin pre-auth with too many permissions
        if (appAdminPreAuthTooManyPermsRule && connectedApp.OptionsAllowAdminApprovedUsersOnly) {
          let permissions = connectedApp.Permissions || "";
          let oauthScopes = connectedApp.OAuthScopes || "";
          let permissionCount = 0;

          // Count permissions (comma-separated or semicolon-separated)
          if (permissions) {
            permissionCount += permissions.split(/[,;]/).filter(p => p.trim()).length;
          }
          if (oauthScopes) {
            permissionCount += oauthScopes.split(/[,;]/).filter(s => s.trim()).length;
          }

          // Threshold: 10 permissions/scopes
          const permissionThreshold = 10;
          if (permissionCount > permissionThreshold) {
            logs.push({
              reference: appName,
              name: "Connected app admin pre auth with too many permission",
              description: `This connected app has admin pre-approved users enabled but has ${permissionCount} permissions/OAuth scopes. Having too many permissions increases security risk. Consider reviewing and reducing the number of permissions to follow the principle of least privilege.`,
              priority: permissionCount > 15 ? 1 : (permissionCount > 12 ? 2 : 3)
            });
          }
        }

        // Check admin pre-auth without permissions
        if (appAdminPreAuthNoPermsRule && connectedApp.OptionsAllowAdminApprovedUsersOnly) {
          let permissions = connectedApp.Permissions || "";
          let oauthScopes = connectedApp.OAuthScopes || "";
          let hasPermissions = (permissions && permissions.trim()) || (oauthScopes && oauthScopes.trim());

          if (!hasPermissions) {
            logs.push({
              reference: appName,
              name: "Connected app admin pre auth without permission",
              description: "This connected app has admin pre-approved users enabled but has no permissions or OAuth scopes configured. This configuration may be incomplete or unnecessary. Consider either adding appropriate permissions or disabling admin pre-approval if not needed.",
              priority: 3
            });
          }
        }
      }

      // Analyze External Client Apps
      if (extAppSelfAuthRule || extAppNotUsedRule) {
        let extAppQuery = "SELECT Id, Name, CreatedBy.Name, CreatedDate, LastModifiedBy.Name, LastModifiedDate, OptionsAllowAdminApprovedUsersOnly FROM ExternalClientApplication ORDER BY Name";
        let extAppResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(extAppQuery), {}), extAppResult)
          .catch(error => {
            console.error(error);
          });

        for (let extApp of extAppResult.rows) {
          let appName = extApp.Name;

          // Check self-authorization rule for external client apps
          if (extAppSelfAuthRule && !extApp.OptionsAllowAdminApprovedUsersOnly) {
            logs.push({
              reference: appName,
              name: "External client app allows self-authorization",
              description: "This external client app allows users to self-authorize. Consider restricting authorization to admin-approved users only to enhance security.",
              priority: 2
            });
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
                priority: 3
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
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query), {}), result)
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
            priority: systemAdminCount > 20 ? 1 : (systemAdminCount > 15 ? 2 : 3)
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
                  priority: 3
                });
              } else if (daysSinceCreation > oneMonthInDays) {
                logs.push({
                  reference: userReference,
                  name: "Inactive user",
                  description: `User ${userName} (${user.Username}) has never logged in and was created ${Math.floor(daysSinceCreation / oneMonthInDays)} months ago.`,
                  priority: 5
                });
              }
            } else {
              // No creation date either - assume inactive
              logs.push({
                reference: userReference,
                name: "Inactive user",
                description: `User ${userName} (${user.Username}) has never logged in. Consider deactivating if no longer needed.`,
                priority: 5
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
                priority: 3
              });
            } else if (daysSinceLastLogin > oneMonthInDays) {
              logs.push({
                reference: userReference,
                name: "Inactive user",
                description: `User ${userName} (${user.Username}) has not logged in for ${Math.floor(daysSinceLastLogin / oneMonthInDays)} months (last login: ${lastLoginDate.toLocaleDateString()}).`,
                priority: 5
              });
            }
          }
        }
      }

      // Check for too many levels in role hierarchy
      if (tooManyRoleLevelsRule) {
        let roleQuery = "SELECT Id, Name, ParentRoleId FROM UserRole ORDER BY Name";
        let roleResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(roleQuery), {}), roleResult)
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
            priority: maxDepth > 15 ? 1 : (maxDepth > 12 ? 2 : 3)
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
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(vfPageQuery), {}), vfPageResult)
          .catch(error => {
            console.error(error);
          });

        for (let vfPage of vfPageResult.rows) {
          logs.push({
            reference: vfPage.Name,
            name: "Visualforce Page not migrated to LWC",
            description: `This Visualforce page (API Version: ${vfPage.ApiVersion || "N/A"}) should be migrated to Lightning Web Component (LWC) for better performance and modern UI capabilities. Last modified: ${vfPage.LastModifiedDate ? new Date(vfPage.LastModifiedDate).toLocaleDateString() : "N/A"} by ${vfPage.LastModifiedBy?.Name || "N/A"}.`,
            priority: 4
          });
        }
      }

      // Query Aura Components
      if (auraComponentRule) {
        let auraComponentQuery = "SELECT Id, DeveloperName, ApiVersion, LastModifiedDate, LastModifiedBy.Name FROM AuraDefinitionBundle WHERE NamespacePrefix = null ORDER BY DeveloperName";
        let auraComponentResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(auraComponentQuery), {}), auraComponentResult)
          .catch(error => {
            console.error(error);
          });

        for (let auraComponent of auraComponentResult.rows) {
          logs.push({
            reference: auraComponent.DeveloperName,
            name: "Aura Component not migrated to LWC",
            description: `This Aura component (API Version: ${auraComponent.ApiVersion || "N/A"}) should be migrated to Lightning Web Component (LWC) for better performance and modern UI capabilities. Last modified: ${auraComponent.LastModifiedDate ? new Date(auraComponent.LastModifiedDate).toLocaleDateString() : "N/A"} by ${auraComponent.LastModifiedBy?.Name || "N/A"}.`,
            priority: 4
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
    if (!processBuilderRule && !workflowRule) {
      return;
    }

    let logs = [];

    try {
      // Query Process Builder processes
      // Process Builder processes are Flow records with ProcessType = 'AutoLaunchedFlow' and ProcessDefinitionId != null
      if (processBuilderRule) {
        let processBuilderQuery = "SELECT Id, MasterLabel, ProcessType, ProcessDefinitionId, LastModifiedDate, LastModifiedBy.Name, Status FROM Flow WHERE ProcessType = 'AutoLaunchedFlow' AND ProcessDefinitionId != null AND Status = 'Active' ORDER BY MasterLabel";
        let processBuilderResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(processBuilderQuery), {}), processBuilderResult)
          .catch(error => {
            console.error(error);
          });

        for (let processBuilder of processBuilderResult.rows) {
          logs.push({
            reference: processBuilder.MasterLabel,
            name: "Process Builder to migrate to Flow",
            description: `This Process Builder process should be migrated to a Flow. Process Builder is being deprecated in favor of Flow Builder, which provides better performance and more capabilities. Last modified: ${processBuilder.LastModifiedDate ? new Date(processBuilder.LastModifiedDate).toLocaleDateString() : "N/A"} by ${processBuilder.LastModifiedBy?.Name || "N/A"}.`,
            priority: 2
          });
        }
      }

      // Query Workflow Rules
      if (workflowRule) {
        let workflowQuery = "SELECT Id, Name, TableEnumOrId, LastModifiedDate, LastModifiedBy.Name, Active FROM WorkflowRule WHERE Active = true ORDER BY Name";
        let workflowResult = {rows: []};
        await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(workflowQuery), {}), workflowResult)
          .catch(error => {
            console.error(error);
          });

        for (let workflow of workflowResult.rows) {
          logs.push({
            reference: workflow.Name + (workflow.TableEnumOrId ? " (" + workflow.TableEnumOrId + ")" : ""),
            name: "Workflow Rule to migrate to Flow",
            description: `This Workflow Rule should be migrated to a Flow. Workflow Rules are being deprecated in favor of Flow Builder, which provides better performance, more capabilities, and better debugging tools. Last modified: ${workflow.LastModifiedDate ? new Date(workflow.LastModifiedDate).toLocaleDateString() : "N/A"} by ${workflow.LastModifiedBy?.Name || "N/A"}.`,
            priority: 2
          });
        }
      }

      this.recordTable.addToTable(logs, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    } catch (error) {
      console.error("Error analyzing Process Builder and Workflow Rules:", error);
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
    let objWithManyFieldsDescRule = this.model.isRuleEnable("Entity with too many fields");
    let objWithManyValidationRulesRule = this.model.isRuleEnable("Entity with too many validation rules");
    let objWithManyTriggersRule = this.model.isRuleEnable("Entity with too many triggers");
    if (!objWithoutDescRule && !fieldWithoutDescRule && !objWithManyFieldsDescRule && !objWithManyValidationRulesRule && !objWithManyTriggersRule){
      return;
    }

    let query = "SELECT QualifiedApiName FROM EntityDefinition WHERE PublisherId != 'System' and Description = null ORDER BY QualifiedApiName";
    let result = {rows: []};
    await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(query), {}), result)
      .catch(error => {
        console.log(error);
      });
    let tableFields = new Map();
    let logs = [];
    if (objWithoutDescRule) {
      for (let i = 0; i < result.rows.length; i++) {
        let entity = result.rows[i];
        logs.push({reference: entity.QualifiedApiName, name: "Custom SObject without description", description: "Add description from SETUP > Object Manager > (select entity) > Edit", priority: 5});//5 low
      }
      this.recordTable.addToTable(logs, {column: "priority"});
      this.model.resultTableModel.dataChange(this.recordTable);
      this.model.didUpdate();
    }
    let {globalDescribe} = this.model.describeInfo.describeGlobal(false);
    //const validationRuleSelect = "SELECT Id, Active, EntityDefinitionId, EntityDefinition.DeveloperName, ErrorMessage, ValidationName FROM ValidationRule WHERE ErrorMessage LIKE '%" + shortcutSearch.replace(/([%_\\'])/g, "\\$1") + "%' LIMIT 30";
    query = "SELECT Id, QualifiedApiName, EntityDefinition.QualifiedApiName, Description FROM FieldDefinition WHERE PublisherId!= 'System' AND EntityDefinition.QualifiedApiName in ([RANGE])";
    let objectList = globalDescribe.sobjects.filter(s => (s.associateEntityType == null));
    for (let index = 0; index < objectList.length; index += 50) {
      let entityNames = objectList.slice(index, index + 50).map(e => "'" + e.name + "'");
      let fieldsFesult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(query.replace("[RANGE]", entityNames.join(", "))), {}), fieldsFesult)
        .catch(error => {
          console.log(error);
        });
      let logs2 = [];
      for (let j = 0; j < fieldsFesult.rows.length; j++){
        let field = fieldsFesult.rows[j];
        //&& field.QualifiedApiName.endsWith("__c")
        if (!field.Description && fieldWithoutDescRule){
          logs2.push({reference: field.EntityDefinition.QualifiedApiName + "." + field.QualifiedApiName, name: "Custom Field without description", description: "Add description from SETUP > Object Manager > (select entity) > Fields & Relationships > (select field) > Edit", priority: 5});//5 low
        }
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
    let logs3 = [];
    if (objWithManyFieldsDescRule){
      for (let [key, value] of tableFields) {
        if (value > 100){
          logs3.push({reference: key, name: "Entity with too many fields", description: "Consider reducing the number of fields on this entity. Salesforce recommends no more than " + (value > 200 ? "200" : "100") + " fields per object to ensure optimal performance.", priority: (value > 200 ? 3 : 4)});
        }
      }
    }
    this.recordTable.addToTable(logs3, {column: "priority"});
    this.model.resultTableModel.dataChange(this.recordTable);
    this.model.didUpdate();

    // Check validation rules count per object
    if (objWithManyValidationRulesRule) {
      let logs4 = [];
      let validationRuleQuery = "SELECT Id, EntityDefinition.QualifiedApiName, Active FROM ValidationRule WHERE EntityDefinition.QualifiedApiName != null ORDER BY EntityDefinition.QualifiedApiName";
      let validationRuleResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(validationRuleQuery), {}), validationRuleResult)
        .catch(error => {
          console.error(error);
        });

      // Count validation rules per object
      let validationRuleCounts = new Map();
      for (let validationRule of validationRuleResult.rows) {
        let objectName = validationRule.EntityDefinition?.QualifiedApiName;
        if (objectName) {
          let count = validationRuleCounts.get(objectName) || 0;
          validationRuleCounts.set(objectName, count + 1);
        }
      }

      // Check for objects with too many validation rules (threshold: 15)
      const validationRuleThreshold = 15;
      for (let [objectName, count] of validationRuleCounts) {
        if (count > validationRuleThreshold) {
          logs4.push({
            reference: objectName,
            name: "Entity with too many validation rules",
            description: `This entity has ${count} validation rules. Consider consolidating or reviewing validation rules to improve maintainability and performance. Salesforce recommends keeping validation rules manageable per object.`,
            priority: count > 25 ? 2 : 3
          });
        }
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
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(apexTriggerQuery), {}), apexTriggerResult)
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
      let flowTriggerQuery = "SELECT Id, MasterLabel, RecordTriggerType, TriggerType FROM Flow WHERE Status = 'Active' AND RecordTriggerType != null ORDER BY MasterLabel";
      let flowTriggerResult = {rows: []};
      await this.model.batchHandler(sfConn.rest("/services/data/v" + apiVersion + "/tooling/query/?q=" + encodeURIComponent(flowTriggerQuery), {}), flowTriggerResult)
        .catch(error => {
          console.error(error);
        });

      // Count Flow triggers per object
      // Note: Flow triggers can be on multiple objects, but for simplicity we'll count each flow as one trigger
      // RecordTriggerType can be a single object or multiple objects separated by comma
      for (let flowTrigger of flowTriggerResult.rows) {
        if (flowTrigger.RecordTriggerType) {
          // RecordTriggerType can be a comma-separated list of objects
          let objects = flowTrigger.RecordTriggerType.split(",").map(obj => obj.trim());
          for (let objectName of objects) {
            if (objectName) {
              let count = triggerCounts.get(objectName) || 0;
              triggerCounts.set(objectName, count + 1);
            }
          }
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
            priority: count > 10 ? 2 : 3
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
    this.resultTableModel = new TableModel(sfHost, this.didUpdate.bind(this), {});
    this.resultError = null;
    this.analyzeStatus = "Ready";
    this.recordTable = new RecordTable(st => { this.analyzeStatus = st; });
    this.recordTable.describeInfo = this.describeInfo;
    this.recordTable.sfHost = sfHost;
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
      this.userId = res.userId;
    }));
    this.rules = [
      {name: "Custom SObject without description", selected: true},
      {name: "Custom Field without description", selected: true},
      {name: "Entity with too many fields", selected: true},
      {name: "Entity with too many validation rules", selected: true},
      {name: "Entity with too many triggers", selected: true},
      {name: "Connected App OAuth Token not used recently", selected: true},
      {name: "Connected App allows self-authorization", selected: true},
      {name: "Connected App is used but not installed", selected: true},
      {name: "Connected app admin pre auth with too many permission", selected: true},
      {name: "Connected app admin pre auth without permission", selected: true},
      {name: "External client app allows self-authorization", selected: true},
      {name: "External client app OAuth Token not used recently", selected: true},
      {name: "No IP Range defined", selected: true},
      {name: "Apex Class with poor code coverage", selected: true},
      {name: "Apex Class with old API Version", selected: true},
      {name: "Apex Class need recompilation", selected: true},
      {name: "Apex hardcoded id in code instead of label", selected: true},
      {name: "Apex SOQL in loop", selected: true},
      {name: "Apex DML in loop", selected: true},
      {name: "Apex class without explicit sharing", selected: true},
      {name: "Apex trigger with logic, SOQL or DML instead of service class", selected: true},
      {name: "Apex class not referenced (not REST Apex)", selected: true},
      {name: "Apex batchable or queueable schedulable without jobs in last 365 days", selected: true},
      {name: "Apex SOQL injection: missing escape on parameter", selected: true},
      {name: "Inactive user", selected: true},
      {name: "Too many System Administrators", selected: true},
      {name: "Role Hierarchy with too many levels", selected: true},
      {name: "Visualforce Page not migrated to LWC", selected: true},
      {name: "Aura Component not migrated to LWC", selected: true},
      {name: "Process Builder to migrate to Flow", selected: true},
      {name: "Workflow Rule to migrate to Flow", selected: true},
    ];
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

  async batchHandler(batch, options) {
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
      console.log(err);
      return null;
    });
  }
  async startAnalyze(){
    //this.logs = [];
    this.analyzeStatus = "Running";
    this.progressCurrent = 0;
    this.progressTotal = 6; // Total number of analyzers
    this.progressCurrentStep = "";
    this.didUpdate();

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

class App extends React.Component {
  constructor(props) {
    super(props);
    this.onStartClick = this.onStartClick.bind(this);
    this.onStopAnalyze = this.onStopAnalyze.bind(this);
    this.onSelectPriorityFilter = this.onSelectPriorityFilter.bind(this);
    this.onSelectAllChange = this.onSelectAllChange.bind(this);
    this.onDownloadCsv = this.onDownloadCsv.bind(this);
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
    if (model.priorityFilter == null) {
      model.recordTable.updateVisibility(null);
    } else {
      model.recordTable.updateVisibility({field: "priority", operator: "=", value: model.priorityFilter});
    }
    model.resultTableModel.dataChange(model.recordTable);
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
          h("div", {className: "slds-notification slds-notification_alert", role: "alert", style: {backgroundColor: "#FFB75D", color: "#080707", padding: "12px", marginBottom: "16px", borderRadius: "4px", border: "1px solid #DDDBDA"}},
            h("div", {style: {display: "flex", alignItems: "center"}},
              h("svg", {style: {width: "20px", height: "20px", marginRight: "8px", flexShrink: 0}, viewBox: "0 0 24 24", fill: "currentColor"},
                h("path", {d: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"})
              ),
              h("div", {style: {flex: 1}},
                h("strong", {style: {display: "block", marginBottom: "4px"}}, "Warning: High API Usage"),
                h("span", {style: {fontSize: "12px"}}, "The Org Analyzer makes extensive API calls to analyze your org. Please monitor your org's API limits and save results using the CSV download feature for future reference.")
              )
            )
          ),
          h("h1", {}, "Rules"),
          h("div", {},
            h("span", {}, "Select the rules you want to run: "),
            h("label", {},
              h("input", {type: "checkbox", ref: "selectref", checked: selectAllChecked, onChange: this.onSelectAllChange}),
              "Select all"
            ),
            h("br", {}),
            h("div", {className: "slds-grid slds-wrap"},
              model.rules.map((rule, i) => h(RuleSelector, {key: "rule" + i, model, rule}))
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
            h("select", {value: model.priorityFilter, onChange: this.onSelectPriorityFilter, className: "priority-filter"},
              h("option", {value: null, defaultValue: true}, "All priorities"),
              h("option", {key: "1", value: 1}, "1"),
              h("option", {key: "2", value: 2}, "2"),
              h("option", {key: "3", value: 3}, "3"),
              h("option", {key: "4", value: 4}, "4"),
              h("option", {key: "5", value: 5}, "5"),
            ),
            h("span", {className: "result-status flex-right"},
              h("span", {}, model.analyzeStatus),
              h("button", {className: "cancel-btn", hidden: (model.analyzeStatus == "Ready"), onClick: this.onStopAnalyze}, "Stop"),
            ),
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
    model.didUpdate();
  }
  render() {
    let {rule} = this.props;
    return h("div", {className: "slds-col slds-size_3-of-12"}, h("label", {title: rule.name},
      h("input", {type: "checkbox", checked: rule.selected, onChange: this.onChange}),
      rule.name
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
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

  });

}
