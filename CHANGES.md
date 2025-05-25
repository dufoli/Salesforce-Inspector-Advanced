# Release Notes

## Version 1.31
> [!IMPORTANT]
- Fix :bug: long-time connection issue with yellow message to reconnect [issue 203](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/203) and [issue 197](https://github.com/dufoli/Salesforce-Inspector-Advanced/issues/197)
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
