// Persistent cache for metadata that is expensive to (re)fetch from the Salesforce API
// (describeGlobal, describeSobject, flow dependencies, ...).
// Uses browser.storage.local / chrome.storage.local when available (larger quota than
// localStorage), and falls back to localStorage otherwise (e.g. if the "storage"
// permission is ever missing). Both backends are exposed behind the same async API.

const CACHE_PREFIX = "sfInspectorCache_";
const DEFAULT_TTL_HOURS = 24;

let currentBrowser;
if (typeof browser !== "undefined") {
  currentBrowser = browser;
} else if (typeof chrome !== "undefined") {
  currentBrowser = chrome;
} else {
  currentBrowser = null;
}

function hasStorageLocal() {
  return !!(currentBrowser && currentBrowser.storage && currentBrowser.storage.local);
}

function getTtlMs() {
  let hours = parseFloat(localStorage.getItem("cacheTTLHours"));
  if (!hours || hours <= 0) {
    hours = DEFAULT_TTL_HOURS;
  }
  return hours * 60 * 60 * 1000;
}

async function storageGet(fullKey) {
  if (hasStorageLocal()) {
    let res = await currentBrowser.storage.local.get(fullKey);
    return res[fullKey];
  }
  let raw = localStorage.getItem(fullKey);
  return raw == null ? undefined : JSON.parse(raw);
}

async function storageSet(fullKey, value) {
  if (hasStorageLocal()) {
    await currentBrowser.storage.local.set({[fullKey]: value});
    return;
  }
  localStorage.setItem(fullKey, JSON.stringify(value));
}

async function storageRemove(fullKey) {
  if (hasStorageLocal()) {
    await currentBrowser.storage.local.remove(fullKey);
    return;
  }
  localStorage.removeItem(fullKey);
}

async function storageRemoveAllCacheKeys() {
  if (hasStorageLocal()) {
    let all = await currentBrowser.storage.local.get(null);
    let keys = Object.keys(all).filter(k => k.startsWith(CACHE_PREFIX));
    if (keys.length > 0) {
      await currentBrowser.storage.local.remove(keys);
    }
    return;
  }
  let keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    let key = localStorage.key(i);
    if (key && key.startsWith(CACHE_PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach(key => localStorage.removeItem(key));
}

// Returns the cached value for `key`, or undefined if missing or expired.
export async function getCache(key) {
  let entry;
  try {
    entry = await storageGet(CACHE_PREFIX + key);
  } catch (e) {
    console.warn("[SFInspector] cache read failed for " + key, e);
    return undefined;
  }
  if (!entry) {
    return undefined;
  }
  if (Date.now() - entry.timestamp > getTtlMs()) {
    removeCache(key);
    return undefined;
  }
  return entry.data;
}

// Like getCache, but never expires/deletes the entry. For caches that track their own
// freshness (e.g. a "last synced at" field used to fetch only what changed since then),
// where losing the previous value on expiry would defeat the delta sync.
export async function getCacheRaw(key) {
  try {
    let entry = await storageGet(CACHE_PREFIX + key);
    return entry ? entry.data : undefined;
  } catch (e) {
    console.warn("[SFInspector] cache read failed for " + key, e);
    return undefined;
  }
}

export async function setCache(key, data) {
  try {
    await storageSet(CACHE_PREFIX + key, {data, timestamp: Date.now()});
  } catch (e) {
    console.warn("[SFInspector] cache write failed for " + key, e);
  }
}

export async function removeCache(key) {
  try {
    await storageRemove(CACHE_PREFIX + key);
  } catch (e) {
    console.warn("[SFInspector] cache remove failed for " + key, e);
  }
}

// Clears every cache entry, for every org, regardless of which backend stored it.
export async function clearAllCache() {
  await storageRemoveAllCacheKeys();
}
