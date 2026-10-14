/* eslint quotes: ["error", "single", {"avoidEscape": true}] */
export async function apexCodeTest(test) {
  console.log('TEST apexCode');
  let {assertEquals, assertThrows, loadPage} = test;
  let {failedTestsToRun, mergeCoverage, splitTokensByLine, parseStackTrace, parseTestClassesResponse, upsertTestSet, resolveTestSet, tokenizeCode} = await loadPage('apex-code.html');

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
