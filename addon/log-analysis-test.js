/* eslint quotes: ["error", "single", {"avoidEscape": true}] */
export async function logAnalysisTest(test) {
  console.log('TEST logAnalysis');
  let {assertEquals} = test;
  let {parseLimitUsage, summarizeLimits, limitSeverity} = await import('./log-analysis.js');

  // parseLimitUsage: body of a LIMIT_USAGE_FOR_NS line (first line is empty, values may be flagged CLOSE TO LIMIT)
  let body = '\n  Number of SOQL queries: 95 out of 100 ******* CLOSE TO LIMIT\n  Number of query rows: 12 out of 50000\n  Number of Publish Immediate DML: 0 out of 150\n  Maximum CPU time: 250 out of 10000\n  Maximum heap size: 0 out of 6000000\n';
  assertEquals([
    {name: 'SOQL queries', used: 95, max: 100},
    {name: 'query rows', used: 12, max: 50000},
    {name: 'Publish Immediate DML', used: 0, max: 150},
    {name: 'Maximum CPU time', used: 250, max: 10000},
    {name: 'Maximum heap size', used: 0, max: 6000000}
  ], parseLimitUsage(body));
  assertEquals([], parseLimitUsage(''));
  assertEquals([], parseLimitUsage('not a limit line'));

  // summarizeLimits: max value kept across blocks, grouped by scope + namespace, sorted by percent desc
  let summary = summarizeLimits([
    {scope: 'cumulative', namespace: '(default)', limits: [{name: 'SOQL queries', used: 10, max: 100}, {name: 'Maximum heap size', used: 3000000, max: 6000000}]},
    {scope: 'cumulative', namespace: 'ns1', limits: [{name: 'SOQL queries', used: 1, max: 100}]},
    {scope: 'cumulative', namespace: '(default)', limits: [{name: 'SOQL queries', used: 20, max: 100}, {name: 'Maximum heap size', used: 1000, max: 6000000}]},
    {scope: 'testing', namespace: '(default)', limits: [{name: 'SOQL queries', used: 2, max: 100}]}
  ]);
  assertEquals([
    {
      scope: 'cumulative',
      namespace: '(default)',
      limits: [
        {name: 'Maximum heap size', used: 3000000, max: 6000000, percent: 50},
        {name: 'SOQL queries', used: 20, max: 100, percent: 20}
      ]
    },
    {scope: 'cumulative', namespace: 'ns1', limits: [{name: 'SOQL queries', used: 1, max: 100, percent: 1}]},
    {scope: 'testing', namespace: '(default)', limits: [{name: 'SOQL queries', used: 2, max: 100, percent: 2}]}
  ], summary);
  assertEquals([{scope: 'cumulative', namespace: 'x', limits: [{name: 'a', used: 0, max: 0, percent: 0}]}],
    summarizeLimits([{scope: 'cumulative', namespace: 'x', limits: [{name: 'a', used: 0, max: 0}]}]));

  // limitSeverity thresholds
  assertEquals('success', limitSeverity(49.9));
  assertEquals('warning', limitSeverity(50));
  assertEquals('error', limitSeverity(80));
}
