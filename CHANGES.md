# Release Notes

## Version 1.38

### Inspect
- **Field Usage Analysis**: New feature to analyze field usage across your Salesforce org. View the percentage of records that have values populated for each field, helping you identify unused or underutilized fields. Accessible via the "Show field usage" option in the object actions menu. [issue 268](https://github.com/dufoli/Salesforce-Inspector-Advanced/268)
- **Polymorphic Field Types Display**: Improved display of polymorphic reference fields in the Type column. When a field references multiple object types, only the first 3 types are shown initially with a clickable "...(X more)" link to expand and view all remaining types. This makes the interface cleaner and easier to read when dealing with fields that reference many object types.

### Flow Analyzer
New comprehensive tool to analyze and optimize Salesforce Flows. Accessible via the "Analyze Flow" button when viewing a Flow in Flow Builder. The analyzer scans flow metadata for potential issues across multiple categories:

- **Performance Issues**: 
  - DML operations in loops (Get/Update/Create/Delete Record)
  - Action calls within loops
  - Get Record elements retrieving all fields instead of specific fields
  
- **Best Practices**: 
  - Missing flow descriptions
  - Unused variables
  - Unconnected elements
  - Copy API names (should use labels)
  - Not using Auto Layout
  
- **Security & Reliability**: 
  - Hardcoded IDs and URLs
  - Missing fault paths
  - Missing null handlers
  - Unsafe running context configurations
  
- **Maintainability**: 
  - High cyclomatic complexity
  - Flow naming convention violations
  - Old API versions in use
  - Too many flow versions
  
- **Logic Issues**: 
  - Recursive after update triggers
  - Same record field updates

Results are displayed with severity levels (error, warning, info) and include actionable recommendations to help maintain secure, performant, and reliable Flow automations. [issue 251](https://github.com/dufoli/Salesforce-Inspector-Advanced/251)

### Org Analyzer
Expanded with many new detection rules to help identify potential issues and optimization opportunities:

- **Unused Resources**: 
  - Custom fields with no references (flow, Apex, layout) and no data
  
- **Code Quality**: 
  - Too many validation rules per object
  - Too many triggers per object
  - SOQL queries in loops
  - DML operations in loops
  - Hardcoded IDs in code instead of custom labels
  - SOQL injection vulnerabilities (missing escape on parameters)
  - Apex classes without explicit sharing model
  - Apex triggers containing logic, SOQL, or DML instead of delegating to service classes
  - Unreferenced Apex classes (excluding REST Apex)
  - Batchable, Queueable, or Schedulable classes without jobs in the last 365 days
  
- **Flow Management**: 
  - Flows with too many versions
  - Flows using old API versions
  
- **Migration Opportunities**: 
  - Process Builder or Workflow Rules that should be migrated to Flow
  - Visualforce pages or Lightning Components that should be migrated to LWC
  
- **Security & Access Management**: 
  - Too many system administrators
  - Role Hierarchy with too many levels
  - Users without login activity for extended periods or never logged in
  - Connected Apps with admin pre-authorized users having too many permissions
  - Connected Apps with admin pre-authorized users without proper permissions

### Metadata
- **Package.xml Generation**: Upload metadata files and automatically generate a `package.xml` file, streamlining the process of creating deployment packages.

### Editor
- **Suggestion Positioning**: Improved positioning of code suggestions to better align with the cursor and provide a more intuitive editing experience.

### Options
- **Favicon Color Picker**: New color picker in the options page to customize the favicon color for your Salesforce environment and extension, making it easier to visually distinguish between different orgs.

### Popup
- **Clone User**: New functionality to clone user records directly from the popup interface, simplifying user management tasks.
  

## Version 1.37
- Security: switch to oauth 2 web service flow with PKCE over external client app  [issue 254](https://github.com/dufoli/Salesforce-Inspector-Advanced/254) / [issue 265](https://github.com/dufoli/Salesforce-Inspector-Advanced/265) / [issue 255](https://github.com/dufoli/Salesforce-Inspector-Advanced/255)
- Security : wizard to help on creation of external client app with new [documentation](https://dufoli.github.io/Salesforce-Inspector-Advanced/how-to/#use-sf-inspector-with-an-external-client-app)
- AI: support agentforce, chatgpt, mystral and claude api to analyse flow and generate SOQL [issue 258](https://github.com/dufoli/Salesforce-Inspector-Advanced/258) / [issue 128](https://github.com/dufoli/Salesforce-Inspector-Advanced/128) / [issue 213](https://github.com/dufoli/Salesforce-Inspector-Advanced/213)
- Data import : support hard delete  [issue 129](https://github.com/dufoli/Salesforce-Inspector-Advanced/129)
- Data import : support Bulk API [issue267](https://github.com/dufoli/Salesforce-Inspector-Advanced/267)
- Metadata: automatic download produce zip file and not csv and add metadataStatus json file [issue 262](https://github.com/dufoli/Salesforce-Inspector-Advanced/262)
- Add a report bug button on popup [issue 264](https://github.com/dufoli/Salesforce-Inspector-Advanced/264)
- Data export: fix filter operator behaviour with null
- Data export: fix filter operator behaviour with picklist suggestion

## Version 1.36.2
- data export: fix performance freeze with in keyword for suggestion
- data export: fix performance freeze by limiting colored syntax in query
- connected app: switch to production conecteed app client id
- data export: allow to set value on cell even if empty
- editor :make selected suggestion more visible
 
## Version 1.36.1
- data export: fix filter null which make sort not possible sometimes
- data export: fix suggestion of values whithout any input
- data export: fix do not suggest field when IN keyword is used with subquery
- data export: fix remove address from auto complete whereas it is removed from suggestion

## Version 1.36
- Org Analyzer: Detect vulnerabilities and bad practices in your Salesforce org using customizable rules. Get actionable insights to improve security and maintainability. [issue 225](https://github.com/dufoli/Salesforce-Inspector-Advanced/225)
- Data-export: Sort column by clicking on icon on header. [issue 248](https://github.com/dufoli/Salesforce-Inspector-Advanced/248)
- Data-export: Advanced filtering on column: Filter non-queryable fields (e.g., "Description not empty") with intuitive operators for precise data extraction.
- Apex runner: Open log when script is execute with success [issue 247](https://github.com/dufoli/Salesforce-Inspector-Advanced/247)
- Performance: Fix freeze on data export when a huge list in "IN" operator is provide
- Editor: Fix missing picklist value suggestion when standard list have no label (example: Location in ApexLog)
- Editor: fix a bug with editor do not align with textarea
- Fix client identification
- Security: check args of page
- Log: Fix missing log analyzed for unit test by parsing remaining log after first code unit
- Fix [issue 244](https://github.com/dufoli/Salesforce-Inspector-Advanced/244) access_token callback param by @ethpsantos in https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/245
  
## Version 1.35.3
- History box: revert merge of history and saved query combobox
- Log: fix log View doesn't load consistently from the Apex Execute page. [issue 243](https://github.com/dufoli/Salesforce-Inspector-Advanced/243)
## Version 1.35.2
- Data export: Fix delete records button and csv serialize when option is displayed
- popup: Fix first time use of enable log on user
## Version 1.35.1
- Metadata: Fix download metadata [issue 240](https://github.com/dufoli/Salesforce-Inspector-Advanced/240)
- Inspect: Fix name field when no name field found
## Version 1.35
- Apex runner: add Duration column on logs table
- Data export: Fix infinite increase of width of column in table [issue 239](https://github.com/dufoli/Salesforce-Inspector-Advanced/239)
- Data export / Apex runner: Autosuggestion box for history, template and saved query in data export and apex runner [issue 234](https://github.com/dufoli/Salesforce-Inspector-Advanced/234)
- Project cleaning: split each component on dedicated file
- Shortcut : Search in validation rule error message [issue 235](https://github.com/dufoli/Salesforce-Inspector-Advanced/235)
- Data export: Add include, exclude keyword suggestions on soql [issue 233](https://github.com/dufoli/Salesforce-Inspector-Advanced/233)

## Version 1.34
- Log: Clear old apexlog button, run unit test [issue 227](https://github.com/dufoli/Salesforce-Inspector-Advanced/227)
- Log: Launch unit test, see result and code coverage, highlight in red if less than 75% [issue 116](https://github.com/dufoli/Salesforce-Inspector-Advanced/116)
- Log: Improve performance with calcul only on viewport of log and link on apex line number [issue 57]https://github.com/dufoli/Salesforce-Inspector-Advanced/(57)
- Popup: Fix unable to close pop out window once opened [issue 210](https://github.com/dufoli/Salesforce-Inspector-Advanced/210)
- Log: Scroll vertically on search [issue 229](https://github.com/dufoli/Salesforce-Inspector-Advanced/229)
- SOQL support improvement: Polymorphic fields typeof and type, in suggestion, subquery suggestion [issue 231](https://github.com/dufoli/Salesforce-Inspector-Advanced/231)
- Data Export: Edit a cell on then "apply all" action on data export display delete button on import instead of update [issue 232](https://github.com/dufoli/Salesforce-Inspector-Advanced/232)
- Inspect: Allow Go back from Show all data screen [issue 162](https://github.com/dufoli/Salesforce-Inspector-Advanced/162)

## Version 1.33
- Popup > user: enable lwc debug [issue 220](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/220)
- Popup: data export on report create a SOQL with same column (in Beta) [issue 216](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/216)
- Data export: use local culture for timezone [issue 212](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/212)
- Shortcut: include experience cloud site list [issue 70](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/70)
- Data export: make parameter button more visible, make some column not editable, hide menu on aggregate result [issue 214](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/214)
- Log: apex class view: display line number and color in green line with logs, click on apex view log go to raw log [issue 221](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/221)
- Popup: Resize popup bug if mouse is too fast [issue 150](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/150)
- Option: Auto suggestion box on csv separator, date format, datetime format, decimal format [issue 223](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/223)
- Popup: Add button to export listview data in popup [issue 215](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/215)

## Version 1.32
- Import: Fixed metadata relationship by setting string type.
- Import: Fixed import of JSON.
- Import: Fixed metadata relation import.
- Editor: Permit naviguation with up and down arrow when no suggestions are shown.
- Editor: Added undo and redo functionality with ctrl+z and ctrl+y.
- Inspect: Fixed filter on object with summary field.
- Data Export: Added support for keywords in suggestions.
- Data Export: Added bulk update with fixed value functionality.
- Data export: Clean query from common mistakes on export.
- Data Export: Fixed batch size number on query with parameters.
- User: Added reset password functionality.
- Log: Linked on click in flame chart or profiler to log line.
- Log: Added Apex view to display related logs to an Apex class line.
- Log: Added Ressource view to list SOQL, SOSL, DML and callout with count
- Security: Identified client Salesforce Inspector Advanced in logs.
- Security: Fixed potential SOQL injection and XSS vulnerabilities.
- Security: Restricted access to resources in the manifest.

## Version 1.31
> [!IMPORTANT]
> Fix :bug: long-time connection issue with yellow message to reconnect [issue 203](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/203) and [issue 197](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/197)

- Flamechart: migrate to flamechart js with zoom possibility from https://github.com/pyatyispyatil/flame-chart-js (MIT licence) and improve a lot the log-parser to get more info and migrate to use the new flamechart.
- login as incognito [issue 209](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/209) and [issue 202](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/202)
- SOQL: Remove duplicate columns and technical columns completely [issue 201](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/201)
- Delete button should only forward Id and type to avoid skipping unnecessary columns [issue 205](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/205)
- Access to Flow Trigger Explorer in shortcut [issue 208](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/208)

## Version 1.30.1
- api explorer: mesure time, store small response in history, http header and body type support, add template : bulk api, chatter api, report api, platform event channel, platform event channel member. [issue 194](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/194)
- update to 62 api version
- enable on flow debug and experince builder
- fix log parsing infinite loop and more readable duration
- apex runner : fix bug with error remain sometimes and wrong log displayed
- fix auto suggest data export who delete some text [issue 192](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/192)
- fix a toggle menu null ref
- fix warning missing key on array

## Version 1.30
- Share date format option for import and export [issue 166](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/166)
- Fix token generation issue and display message on popup if failed [issue 165](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/165)
- Save all button on data export [issue 174](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/174)
- Retry system for token before hard failing [issue 172](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/172)
- Fix edit and menu which disappear on scroll by keeping state of cells with scroll or loading data [issue 178](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/178)
- Get all tokens if other window refresh token [issue 180](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/180) and [issue 83](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/83)
- Support Graphql in data export [issue 109](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/109)
- Ability to load a range of data as parameter of query [issue 169](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/169)
- button on flow to know where the flow is used (subflow, flexipage, quick action) [issue 157](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/157)
- Improved quote management close to editor by @Dufgui [issue 61](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/61)
- API explorer: add template, history and saved request and display format according data [issue 171](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/171)
- streaming: format json and filter result and download button [issue 114](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/114)

## Version 1.29
- fix name in saved queries [issue 159](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/159)
- make shortcut editable [issue 161](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/161)
- fix inline edit on data export [issue 158](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/158)
- fix plateform event link on popup objects tab [issue 155](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/155)
- add gear link to option from each page [issue 152](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/152)
- export option : skip technical column and date format [issue 151](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/151)
- fix copy record id [issue 143](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/143)


## Version 1.28

- Fields() do not handle metadata and address field [issue 130](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/130)
- Explore api: new ux  [issue 84](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/84)
- Flamgraph on other mesures (SOQL, Heap,...) [issue 139](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/139)
- Suggestion on data export edit [issue 126](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/126)
- Custom Favicon for Salesforce environment and extension [issue 138](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/138)
- Add roll up summary info [issue 125](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/125)
- Shortcut insid screen instead of popup [issue 141](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/141)
- Default action [issue 140](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/140)
- Import guess sobject based on id prefix if no type column [issue 135](https://github.com/dufoli/Salesforce-Inspector-Advanced/pull/135)
- Data export: select child object field remove parent (exemple: RecordType.Dev => DeveloperName = remove recordType)
- Data export : Fix __r must display all custom relationship
- Data export : field in subquery failed to suggest
- Data export, inspect: select value picklist value if already a value selected will failed to update and need to erase a letter to make it working
- Data export, apex runner: , column width grow exponentially during lateral scroll


## Version 1.27

> [!IMPORTANT]
> New plateform event Manager
> A Streaming tool to manage plateform event, push topic, generic event, change data capture is available with new features:
> - Subscribe and monitor event
> - Register channel and plateform event
> - Publish an event with payload

- Icon menu in popup
- Plateform event Manager [issue 15](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/15)
- Show diff cells in blue when 2 rows displayed [issue 48](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/48)
- Review profiler to be more readable [issue 105](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/105)
- Profiler: add flame chart [issue 115](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/115)
- Display name, number, subject or title according to what is available [issue 37](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/37)
- Handle address field properly [issue 108](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/108)

## Version 1.26

> [!IMPORTANT]
> A new editor (query and script) is available in apex runner and data export with new features:
> - Inplace suggestions (can be disable in option)
> - Modular syntax highlighting for APEX, SOQL, and SOSL
> - Automatic indent on new lines
> - Indent selected text or lines with tab key
> - Parentheses, curly brace, brackets, or quotes
>   - Wrap selected text
>   - Automatic close completion


### Editor

- Migrate apex runner to new editor [issue 85](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/85)
- Add option to show/hide proposal with ctrl+space shortcut [issue 89](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/89)
- Highlight keywords [issue 62](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/62)
- Move suggestion over text area with list as regular IDE do [issue 41](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/41)
- Improve quote in editor [issue 73](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/73)
- Missing close/open char (parenthesis, bracket, curly brace), corresponding open/close char must be in red. [issue 90](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/90)

### Popup

- Escape to close popup [issue 71](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/71)
- Resize popup window [issue 77](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/77)


### Option

- Manage custom links in option [issue 91](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/91)
- Enhance option component (template, history, ...) [issue 80](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/80)

### Table

- Migrate data-loader to new table react component [issue 75](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/75)

### Flow

- Access flow version details from flow builder [issue 86](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/86)
- Clear old flow versions inside FlowBuilder [issue 50](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/50)

### Log and Profile

- Upload a previous log file [issue 103](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/103)

### Other

- Navigation bugs: custom settings and knowledge link [issue 91](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/91)

## Version 1.25

- Metadata: download data model by @dufoli in [issue 11](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/11)
- Apex fields and methods suggestion by @dufoli in [issue 45](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/45)
- Log: improove ux and performance by @dufoli in [issue 43](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/43)
- data export: Inline edit by @dufoli in [issue 47](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/47)
- Metadata: UX multi column and search  by @dufoli in [issue 55](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/55)
- Close popup on inspect and data export by @dufoli in [issue 42](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/42)
- save query history with comments, fix horizontal scroll, make apex log more readable, fix stop polling and restart, typo by @dufoli in [issue 63](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/63)
- auto indent on new line by @dufoli in [issue 58](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/58)
- indent/unindent selection with tab/shift tab by @dufoli in [issue 59](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/59)
- Wrap selected text with paretheses, brackets or quotes by @dufoli in [issue 60](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/60)
- make popup button movable by @Dufgui in [issue 24](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/24)
- support new domain : salesforce-setup.com

## Version 1.24

- Export: Support comments in SOQL / SOSL [issue 22](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/12)
- Export: format query SOQL/ SOSL [issue 22](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/12)
- Export: keep header on top of result on scrolling [issue 20](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/20)
- Export: Add download CSV [issue 26](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/26)
- Inspect: suggest value for picklist [issue 28](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/28)
- Import: assignment rule for Lead, Case and Account [issue 23](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/23)
- Popup: increase height of pannel and move it heigher
- Fix misc bugs (conecteed app,...)
- Log: Fix encoding for log dowload [issue 33](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/33)

## Version 1.23

- Export SOQL: suggest field and related object link in subquery: SELECT Id, (SELECT Id from Contacts) FROM Account
- Export SOQL: suggest field value with IN, LIKE, excludes(), includes()
- Export SOQL: respect order of column
- Export SOQL: Remove total, done, index column for subquery result 
- Export SOSL : execution
- Export SOSL : suggest keywords, field and object
- Apex Runner: execute batch, enqueue job or just anonymous code
- Apex Runner: poll log
- Apex Runner: auto suggest className
- Log: profiler
- Log: search with autoscroll
- Log: download
