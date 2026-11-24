/* eslint quotes: ["error", "single", {"avoidEscape": true}] */
import {analyzeApex, maskApex} from './apex-autocomplete.js';

export async function apexCodeTest(test) {
  console.log('TEST apexCode');
  let {assertEquals, assertThrows, loadPage} = test;
  let {model, traceFlagChange, failedTestsToRun, saveErrors, mergeCoverage, splitTokensByLine, parseStackTrace, parseTestClassesResponse, upsertTestSet, resolveTestSet, tokenizeCode} = await loadPage('apex-code.html');

  // Coverage: a line covered by one test is covered, even if another test leaves it uncovered
  let merged = mergeCoverage([
    {coveredLines: [1, 2], uncoveredLines: [3, 4]},
    {coveredLines: [3], uncoveredLines: [1, 4]},
    null
  ]);
  assertEquals([1, 2, 3], Array.from(merged.covered).sort());
  assertEquals([4], Array.from(merged.uncovered));
  assertEquals({covered: [], uncovered: []}, {covered: Array.from(mergeCoverage([]).covered), uncovered: Array.from(mergeCoverage([]).uncovered)});

  // Rerun failed tests: failed methods grouped by class, passed ones skipped
  assertEquals([{classId: '01p000000000001', testMethods: ['a', 'c']}, {classId: '01p000000000002', testMethods: ['d']}], failedTestsToRun([
    {ApexClassId: '01p000000000001', MethodName: 'a', Outcome: 'Fail'},
    {ApexClassId: '01p000000000001', MethodName: 'b', Outcome: 'Pass'},
    {ApexClassId: '01p000000000001', MethodName: 'c', Outcome: 'CompileFail'},
    {ApexClassId: '01p000000000002', MethodName: 'd', Outcome: 'Fail'}
  ]));
  assertEquals([], failedTestsToRun([{ApexClassId: '01p000000000001', MethodName: 'a', Outcome: 'Pass'}]));

  // Save: compile errors with their line, otherwise the error message of the request
  assertEquals([], saveErrors({State: 'Completed'}));
  assertEquals([{line: 3, column: 5, problem: 'Variable does not exist: x'}, {line: null, column: null, problem: 'Other'}], saveErrors({State: 'Failed',
    DeployDetails: {componentFailures: [{lineNumber: 3, columnNumber: 5, problem: 'Variable does not exist: x'}, {problem: 'Other'}]}}));
  assertEquals([{line: null, column: null, problem: 'Not allowed in production'}], saveErrors({State: 'Error', ErrorMsg: 'Not allowed in production', DeployDetails: null}));
  assertEquals([{line: null, column: null, problem: 'Save Aborted'}], saveErrors({State: 'Aborted'}));

  // Autocomplete: comments and strings masked with the same length
  assertEquals('a       \nb      ;', maskApex("a // x;{\nb 'c;}';"));
  // Variables visible at the caret: parameters, locals and loop variables of the enclosing blocks only
  let code = 'public class A extends B {\n'
    + '  /** doc; { */\n'
    + '  private static final String PREFIX = \'a;{\';\n'
    + '  public List<Account> accounts { get; set; }\n'
    + '  public enum Status { ACTIVE, INACTIVE }\n'
    + '  public class Result { public Boolean success; }\n'
    + '  @AuraEnabled(cacheable=true)\n'
    + '  public static Result run(Map<Id, List<Contact>> byId, final String mode) {\n'
    + '    Result res = new Result();\n'
    + '    for (Integer i = 0; i < 2; i++) { String s; }\n'
    + '    for (Account acc : accounts) {\n'
    + '      // caret\n'
    + '    }\n'
    + '    return res;\n'
    + '  }\n'
    + '}';
  let analysis = analyzeApex(code, code.indexOf('// caret'));
  assertEquals([{name: 'byId', type: 'Map<Id,List<Contact>>'}, {name: 'mode', type: 'String'}, {name: 'res', type: 'Result'}, {name: 'acc', type: 'Account'}], analysis.variables);
  assertEquals(['A'], analysis.classNames);
  // Members of the classes: fields, properties, inner classes and enums, methods with their parameters (not the local variables)
  let a = analysis.classes.get('a');
  assertEquals('B', a.parent);
  assertEquals([['field', 'PREFIX', 'String', true, 'private'], ['property', 'accounts', 'List<Account>', false, 'public'], ['class', 'Status', 'Status', true, 'public'],
    ['class', 'Result', 'Result', true, 'public'], ['method', 'run', 'Result', true, 'public']], a.members.map(m => [m.kind, m.name, m.type, m.isStatic, m.visibility]));
  assertEquals(['byId', 'mode'], a.members.find(m => m.name == 'run').params.map(p => p.name));
  assertEquals(['ACTIVE', 'INACTIVE'], analysis.classes.get('status').members.map(m => m.name));
  assertEquals(['success'], analysis.classes.get('result').members.map(m => m.name));
  // Interface methods are public
  assertEquals([['area', 'public']], Array.from(analyzeApex('public interface Shape { Decimal area(); }').classes.values())[0].members.map(m => [m.name, m.visibility]));
  // Anonymous Apex, the declaration being typed is not visible yet
  assertEquals([{name: 'a', type: 'Account'}], analyzeApex('Account a = [SELECT Id FROM Account];\nContact c').variables);
  // Suggestions: methods with their signature, those without parameters are completed
  assertEquals({key: 'res.log(String m): void', value: 'res.log(', title: 'log(String m): void', suffix: '', rank: 1, autocompleteType: 'variable', dataType: ''},
    model.memberSuggestion({name: 'log', kind: 'method', type: 'void', params: [{type: 'String', name: 'm'}]}, 'res.'));
  assertEquals(')', model.memberSuggestion({name: 'size', kind: 'method', type: 'Integer', params: []}, '').suffix);

  // Debug logs: an active trace flag lasting until the end is kept, otherwise the developer log one is extended or inserted
  let now = new Date('2026-01-01T10:00:00.000Z');
  let until = new Date('2026-01-01T10:15:00.000Z');
  let period = {StartDate: '2026-01-01T10:00:00.000Z', ExpirationDate: '2026-01-01T10:15:00.000Z'};
  assertEquals(null, traceFlagChange([{Id: '7tf1', LogType: 'USER_DEBUG', StartDate: '2026-01-01T09:00:00.000Z', ExpirationDate: '2026-01-01T11:00:00.000Z'}], now, until));
  assertEquals(null, traceFlagChange([{Id: '7tf1', LogType: 'DEVELOPER_LOG', StartDate: null, ExpirationDate: '2026-01-01T11:00:00.000Z'}], now, until));
  assertEquals({id: '7tf2', body: period}, traceFlagChange([
    {Id: '7tf1', LogType: 'USER_DEBUG', StartDate: '2026-01-01T09:00:00.000Z', ExpirationDate: '2026-01-01T10:05:00.000Z'},
    {Id: '7tf2', LogType: 'DEVELOPER_LOG', StartDate: '2025-12-01T09:00:00.000Z', ExpirationDate: '2025-12-01T10:00:00.000Z'}
  ], now, until));
  assertEquals({id: null, body: Object.assign({LogType: 'DEVELOPER_LOG'}, period)}, traceFlagChange([], now, until));

  // Tokenizer: keywords, strings (escaped quotes, empty strings) and comments
  let keywordColor = new Map([['public', 'blue'], ['return', 'violet']]);
  assertEquals([
    {value: 'public', color: 'blue'},
    {value: ' x = ', color: 'black'},
    {value: "''", color: 'orange'},
    {value: '; ', color: 'black'},
    {value: "'a\\'b'", color: 'orange'},
    {value: ' ', color: 'black'},
    {value: '// public', color: 'green'}
  ], tokenizeCode("public x = ''; 'a\\'b' // public", {keywordColor}));
  // Past the segment limit, the rest of the code is one black segment
  assertEquals([{value: 'public', color: 'blue'}, {value: ' x return y', color: 'black'}], tokenizeCode('public x return y', {keywordColor}, 0));
  // Case insensitive by default, like Apex
  assertEquals([{value: 'RETURN', color: 'violet'}], tokenizeCode('RETURN', {keywordColor}));

  // Lines: a multi-line comment is split in one segment per line, empty lines are kept
  let lines = splitTokensByLine(tokenizeCode('public /* a\nb */\n\nreturn', {keywordColor}));
  assertEquals(4, lines.length);
  assertEquals([{value: 'public', color: 'blue'}, {value: ' ', color: 'black'}, {value: '/* a', color: 'green'}], lines[0]);
  assertEquals([{value: 'b */', color: 'green'}], lines[1]);
  assertEquals([], lines[2]);
  assertEquals([{value: 'return', color: 'violet'}], lines[3]);

  // Stack trace frames
  assertEquals([
    {text: 'Class.MyService.doIt: line 3, column 1', kind: 'Class', path: 'MyService.doIt', line: 3},
    {text: 'Trigger.AccountTrigger: line 12, column 1', kind: 'Trigger', path: 'AccountTrigger', line: 12},
    {text: 'External entry point'}
  ], parseStackTrace('Class.MyService.doIt: line 3, column 1\nTrigger.AccountTrigger: line 12, column 1\nExternal entry point'));
  assertEquals([], parseStackTrace(null));

  // Developer Console test class list: "while(1);" prefix, org classes have the "[My Namespace]" namespace
  assertEquals([
    {Id: '01pbR000008Idnv', label: 'aircall.AircallLogTriggerHandlerTest', managed: true},
    {Id: '01p1v00000PYfcA', label: 'MyService_TEST', managed: false}
  ], parseTestClassesResponse('while(1);{"success": true, "testClasses": [{"id": "01pbR000008Idnv", "name": "aircall.AircallLogTriggerHandlerTest", "ns": "aircall"},'
    + ' {"id": "01p1v00000PYfcA", "name": "MyService_TEST", "ns": "[My Namespace]"}], "namespaces": [["aircall"], ["[My Namespace]"]]}'));
  assertThrows({}, () => parseTestClassesResponse('while(1);{"success": false}'));

  // Test sets: saved by class name, sorted, a test set of the same name is replaced
  let sets = upsertTestSet([], 'Billing', ['InvoiceTest']);
  sets = upsertTestSet(sets, 'Accounts', ['AccountTest']);
  sets = upsertTestSet(sets, 'Billing', ['InvoiceTest', 'PaymentTest']);
  assertEquals([{name: 'Accounts', classes: ['AccountTest']}, {name: 'Billing', classes: ['InvoiceTest', 'PaymentTest']}], sets);
  // Classes are found by name in the org (Ids differ between orgs), the missing ones are reported
  let options = [{Id: '01p000000000001', label: 'InvoiceTest'}, {Id: '01p000000000002', label: 'OtherTest'}];
  assertEquals({tests: [{Id: '01p000000000001', label: 'InvoiceTest'}], missing: ['PaymentTest']},
    resolveTestSet({name: 'Billing', classes: ['invoicetest', 'PaymentTest']}, options));
}
