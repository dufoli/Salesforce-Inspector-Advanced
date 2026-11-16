// Pure analysis helpers for Apex debug logs (no DOM, no network) so they can be unit tested.

const limitLinePattern = /^\s*(.+?):\s*(\d+)\s+out of\s+(\d+)/;

// Parses the body of a LIMIT_USAGE_FOR_NS line, e.g.
//   "  Number of SOQL queries: 2 out of 100\n  Maximum heap size: 0 out of 6000000 ******* CLOSE TO LIMIT"
// into [{name: "SOQL queries", used: 2, max: 100}, ...]
export function parseLimitUsage(text) {
  let limits = [];
  for (let line of text.split("\n")) {
    let match = limitLinePattern.exec(line);
    if (!match) {
      continue;
    }
    let name = match[1].replace(/^Number of /, "").trim();
    limits.push({name, used: Number(match[2]), max: Number(match[3])});
  }
  return limits;
}

// Merges every LIMIT_USAGE_FOR_NS block of a log into one summary per scope and namespace.
// Cumulative counters only grow within a transaction, and heap/CPU are snapshots, so the max observed value is kept.
// usages: [{scope: "cumulative"|"testing", namespace, limits: [{name, used, max}]}]
// returns: [{scope, namespace, limits: [{name, used, max, percent}]}] with limits sorted by percent desc
export function summarizeLimits(usages) {
  let groups = new Map();
  for (let usage of usages) {
    let key = usage.scope + "|" + usage.namespace;
    let group = groups.get(key);
    if (!group) {
      group = {scope: usage.scope, namespace: usage.namespace, limits: new Map()};
      groups.set(key, group);
    }
    for (let limit of usage.limits) {
      let current = group.limits.get(limit.name);
      if (!current) {
        group.limits.set(limit.name, {name: limit.name, used: limit.used, max: limit.max});
      } else {
        current.used = Math.max(current.used, limit.used);
        current.max = limit.max;
      }
    }
  }
  return Array.from(groups.values()).map(group => ({
    scope: group.scope,
    namespace: group.namespace,
    limits: Array.from(group.limits.values())
      .map(limit => ({...limit, percent: limit.max > 0 ? (limit.used * 100) / limit.max : 0}))
      .sort((a, b) => b.percent - a.percent)
  }));
}

export function limitSeverity(percent) {
  if (percent >= 80) {
    return "error";
  }
  if (percent >= 50) {
    return "warning";
  }
  return "success";
}
