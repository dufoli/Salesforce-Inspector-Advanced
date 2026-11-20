// Popup of the extension toolbar button: a list of saved orgs to open their login page.
// Only the org URL, a name and an optional username are stored, never a password.
const STORAGE_KEY = "savedOrgs";

let orgs = [];
let filteredOrgs = [];
let selectedIndex = 0;
let editingId = null;
let currentHost = null; // login host of the org in the active tab

const searchInput = document.getElementById("search");
const orgList = document.getElementById("org-list");
const emptyMessage = document.getElementById("empty");
const form = document.getElementById("org-form");
const formLabel = document.getElementById("form-label");
const formUrl = document.getElementById("form-url");
const formUsername = document.getElementById("form-username");
const formError = document.getElementById("form-error");
const formLanding = document.getElementById("form-landing");
const formLandingPath = document.getElementById("form-landing-path");
const statusMessage = document.getElementById("status");
const defaultStatus = statusMessage.textContent;
const orgSettings = document.getElementById("org-settings");
const formFavicon = document.getElementById("form-favicon");
const formFaviconPicker = document.getElementById("form-favicon-picker");
const formClientId = document.getElementById("form-client-id");

function loadOrgs() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, result => resolve(result[STORAGE_KEY] || []));
  });
}

function saveOrgs() {
  return new Promise(resolve => {
    chrome.storage.local.set({[STORAGE_KEY]: orgs}, resolve);
  });
}

// Convert any Salesforce host (Lightning, Visualforce, Setup...) to the My Domain host which serves the login page.
export function toLoginHost(hostname) {
  let host = hostname.toLowerCase();
  if (host.endsWith(".mcas.ms")) {
    host = host.slice(0, -".mcas.ms".length);
  }
  host = host
    .replace(/\.lightning\.force\.com$/, ".my.salesforce.com")
    .replace(/\.lightning\.force\.mil$/, ".my.salesforce.mil")
    .replace(/\.my\.salesforce-setup\.com$/, ".my.salesforce.com");
  // Visualforce domains: mydomain--c.vf.force.com, mydomain--sbx--c.sandbox.vf.force.com
  let vfMatch = host.match(/^([^.]+)--[^.-]+((?:\.[^.]+)?)\.vf\.force\.(com|mil)$/);
  if (vfMatch) {
    host = vfMatch[1] + vfMatch[2] + ".my.salesforce." + vfMatch[3];
  }
  return host;
}

export function normalizeUrl(input) {
  let value = input.trim();
  if (!value) {
    throw new Error("URL is required");
  }
  if (!/^[a-z]+:\/\//i.test(value)) {
    value = "https://" + value;
  }
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    throw new Error("Invalid URL");
  }
  if (url.protocol != "https:") {
    throw new Error("URL must use https");
  }
  return "https://" + toLoginHost(url.hostname);
}

const SETUP_PATH = "/lightning/setup/SetupOneHome/home";

// landing: "" (Home), "setup" or a custom relative path, opened once logged in
export function getLandingPath(landing) {
  if (!landing) {
    return "";
  }
  return landing == "setup" ? SETUP_PATH : landing;
}

export function normalizeLandingPath(input) {
  let path = input.trim();
  if (!path) {
    return "";
  }
  if (/^[a-z]+:/i.test(path) || path.startsWith("//")) {
    // Keep only the path of a pasted full URL, so the landing page always stays on the org
    let url = new URL(path, "https://x");
    path = url.pathname + url.search + url.hash;
  }
  return path.startsWith("/") ? path : "/" + path;
}

export function getLoginUrl(org) {
  let url = new URL(org.url);
  if (org.username) {
    url.searchParams.set("un", org.username);
  }
  let landingPath = getLandingPath(org.landing);
  if (landingPath) {
    url.searchParams.set("startURL", landingPath);
  }
  return url.toString();
}

// Per-org settings shared with the options page (same extension localStorage, keyed by host)
function faviconKey(host) {
  return host + "_customFavicon";
}
function clientIdKey(host) {
  return host + "_clientId";
}

// Generic login pages are not an org: per-org settings make no sense there
function isGenericLoginHost(host) {
  return /^(login|test)\.salesforce\.(com|mil)$/.test(host);
}

function formHost() {
  try {
    return new URL(normalizeUrl(formUrl.value)).hostname;
  } catch (e) {
    return null;
  }
}

function updateSettingsVisibility() {
  let host = formHost();
  orgSettings.hidden = !host || isGenericLoginHost(host);
}

function setFavicon(value) {
  formFavicon.value = value;
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    formFaviconPicker.value = value;
  }
}

function loadOrgSettings(host) {
  setFavicon((host && localStorage.getItem(faviconKey(host))) || "");
  formClientId.value = (host && localStorage.getItem(clientIdKey(host))) || "";
}

function saveOrgSettings(host) {
  if (isGenericLoginHost(host)) {
    return;
  }
  let settings = [[faviconKey(host), formFavicon.value.trim()], [clientIdKey(host), formClientId.value.trim()]];
  for (let [key, value] of settings) {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  }
}

function hostLabel(url) {
  return new URL(url).hostname.split(".")[0];
}

function filterOrgs() {
  let terms = searchInput.value.trim().toLowerCase().split(/\s+/).filter(t => t);
  filteredOrgs = orgs
    .filter(org => {
      let text = [org.label, org.url, org.username].join(" ").toLowerCase();
      return terms.every(term => text.includes(term));
    })
    // The org of the active tab first, then in the saved order (sort is stable)
    .sort((a, b) => isCurrentOrg(b) - isCurrentOrg(a));
  if (selectedIndex >= filteredOrgs.length) {
    selectedIndex = Math.max(0, filteredOrgs.length - 1);
  }
}

function isCurrentOrg(org) {
  return currentHost != null && new URL(org.url).hostname == currentHost;
}

let statusTimer = null;
function showStatus(message, isError) {
  statusMessage.textContent = message;
  statusMessage.className = "status" + (isError ? " error" : "");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMessage.textContent = defaultStatus;
    statusMessage.className = "status";
  }, isError ? 5000 : 1500);
}

function iconButton(title, text, onClick) {
  let button = document.createElement("button");
  button.type = "button";
  button.title = title;
  button.textContent = text;
  button.addEventListener("click", e => {
    e.stopPropagation();
    onClick(e);
  });
  return button;
}

function render() {
  filterOrgs();
  orgList.textContent = "";
  filteredOrgs.forEach((org, index) => {
    let li = document.createElement("li");
    li.title = getLoginUrl(org);
    if (index == selectedIndex) {
      li.classList.add("selected");
    }
    if (isCurrentOrg(org)) {
      li.classList.add("current");
    }
    let info = document.createElement("div");
    info.className = "org-info";
    let label = document.createElement("div");
    label.className = "org-label";
    label.textContent = org.label;
    if (isCurrentOrg(org)) {
      let badge = document.createElement("span");
      badge.className = "current-badge";
      badge.textContent = "current tab";
      label.append(badge);
    }
    let detail = document.createElement("div");
    detail.className = "org-detail";
    detail.textContent = new URL(org.url).hostname;
    if (org.username) {
      let username = document.createElement("span");
      username.className = "org-username";
      username.title = "Copy the username";
      username.textContent = org.username;
      username.addEventListener("click", e => {
        e.stopPropagation();
        copyUsername(org.username);
      });
      detail.append(" · ", username);
    }
    info.append(label, detail);

    let actions = document.createElement("div");
    actions.className = "org-actions";
    actions.append(
      iconButton("Open in a new window (Shift+click)", "⧉", () => openOrg(org, "window")),
      iconButton("Open in a private window (Alt+click)", "🕶", () => openOrg(org, "private")),
      iconButton("Options", "⚙", () => openOptions(new URL(org.url).hostname)),
      iconButton("Edit", "✎", () => openForm(org)),
      iconButton("Delete", "🗑", async () => {
        if (!confirm(`Delete "${org.label}"?`)) {
          return;
        }
        orgs = orgs.filter(o => o.id != org.id);
        await saveOrgs();
        render();
      })
    );

    li.append(info, actions);
    li.addEventListener("click", e => openOrg(org, openModeFromEvent(e)));
    addDragHandlers(li, org);
    orgList.append(li);
  });
  if (filteredOrgs.length == 0) {
    emptyMessage.hidden = false;
    emptyMessage.textContent = orgs.length == 0
      ? "No saved org yet. Click + to add one."
      : "No org matches your search.";
  } else {
    emptyMessage.hidden = true;
  }
}

// Move the org with the id movedId just before or after the org with the id targetId
export function moveOrg(list, movedId, targetId, after) {
  let moved = list.find(o => o.id == movedId);
  if (!moved || movedId == targetId) {
    return list;
  }
  let rest = list.filter(o => o.id != movedId);
  let index = rest.findIndex(o => o.id == targetId);
  if (index < 0) {
    return list;
  }
  rest.splice(after ? index + 1 : index, 0, moved);
  return rest;
}

let draggedId = null;

function clearDropMarker(li) {
  li.classList.remove("drop-before", "drop-after");
}

function isDropAfter(e, li) {
  let rect = li.getBoundingClientRect();
  return e.clientY > rect.top + (rect.height / 2);
}

function addDragHandlers(li, org) {
  li.draggable = true;
  li.addEventListener("dragstart", e => {
    draggedId = org.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", org.id); // Firefox does not start a drag without data
    li.classList.add("dragging");
  });
  li.addEventListener("dragend", () => {
    draggedId = null;
    li.classList.remove("dragging");
  });
  li.addEventListener("dragover", e => {
    if (!draggedId || draggedId == org.id) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    let after = isDropAfter(e, li);
    li.classList.toggle("drop-before", !after);
    li.classList.toggle("drop-after", after);
  });
  li.addEventListener("dragleave", () => clearDropMarker(li));
  li.addEventListener("drop", async e => {
    e.preventDefault();
    clearDropMarker(li);
    if (!draggedId) {
      return;
    }
    let movedId = draggedId;
    draggedId = null;
    orgs = moveOrg(orgs, movedId, org.id, isDropAfter(e, li));
    await saveOrgs();
    filterOrgs();
    selectedIndex = Math.max(0, filteredOrgs.findIndex(o => o.id == movedId));
    render();
  });
}

function openModeFromEvent(e) {
  if (e.altKey) {
    return "private";
  }
  return e.shiftKey ? "window" : "tab";
}

// mode: "tab", "window" or "private"
function openOrg(org, mode = "tab") {
  let url = getLoginUrl(org);
  if (mode == "tab") {
    chrome.tabs.create({url});
    window.close();
    return;
  }
  chrome.windows.create({url, incognito: mode == "private"}, () => {
    if (chrome.runtime.lastError) {
      // Private windows need "Allow in Incognito" (Chrome) / "Run in Private Windows" (Firefox)
      showStatus("Cannot open a private window: allow the extension in private browsing.", true);
      return;
    }
    window.close();
  });
}

function copyUsername(username) {
  navigator.clipboard.writeText(username).then(
    () => showStatus("Username copied"),
    () => showStatus("Cannot copy the username", true)
  );
}

function setLandingForm(landing) {
  if (!landing || landing == "setup") {
    formLanding.value = landing || "";
    formLandingPath.value = "";
  } else {
    formLanding.value = "custom";
    formLandingPath.value = landing;
  }
  formLandingPath.hidden = formLanding.value != "custom";
}

function getLandingForm() {
  if (formLanding.value == "custom") {
    return normalizeLandingPath(formLandingPath.value);
  }
  return formLanding.value;
}

function openOptions(host) {
  chrome.tabs.create({url: chrome.runtime.getURL("options.html") + "?host=" + encodeURIComponent(host)});
  window.close();
}

function getActiveTabUrl() {
  return new Promise(resolve => {
    chrome.tabs.query({active: true, currentWindow: true}, tabs => {
      resolve(tabs && tabs[0] && tabs[0].url ? tabs[0].url : null);
    });
  });
}

function isSalesforceUrl(url) {
  try {
    let {protocol, hostname} = new URL(url);
    return protocol == "https:" && /\.(salesforce|force|cloudforce|visualforce|salesforce-setup|sfcrmapps|sfcrmproducts|crmforce)\.(com|mil|cn)(\.mcas\.ms)?$/.test(hostname);
  } catch (e) {
    return false;
  }
}

async function fillFromCurrentTab() {
  let tabUrl = await getActiveTabUrl();
  if (!tabUrl || !isSalesforceUrl(tabUrl)) {
    formError.textContent = "The current tab is not a Salesforce org.";
    return;
  }
  let url = normalizeUrl(tabUrl);
  formUrl.value = url;
  if (!formLabel.value) {
    formLabel.value = hostLabel(url);
  }
  if (!formFavicon.value && !formClientId.value) {
    loadOrgSettings(new URL(url).hostname);
  }
  updateSettingsVisibility();
  formError.textContent = "";
}

function openForm(org) {
  editingId = org ? org.id : null;
  formLabel.value = org ? org.label : "";
  formUrl.value = org ? org.url : "";
  formUsername.value = org ? org.username || "" : "";
  formError.textContent = "";
  setLandingForm(org ? org.landing : "");
  loadOrgSettings(org ? new URL(org.url).hostname : null);
  updateSettingsVisibility();
  form.hidden = false;
  if (!org) {
    // Prefill with the current tab when it is a Salesforce org not saved yet
    getActiveTabUrl().then(tabUrl => {
      if (tabUrl && isSalesforceUrl(tabUrl) && !formUrl.value) {
        let url = normalizeUrl(tabUrl);
        if (!orgs.some(o => o.url == url)) {
          formUrl.value = url;
          formLabel.value = formLabel.value || hostLabel(url);
          loadOrgSettings(new URL(url).hostname);
          updateSettingsVisibility();
        }
      }
    });
  }
  formLabel.focus();
}

function closeForm() {
  form.hidden = true;
  editingId = null;
  searchInput.focus();
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  let url;
  try {
    url = normalizeUrl(formUrl.value);
  } catch (err) {
    formError.textContent = err.message;
    return;
  }
  let username = formUsername.value.trim();
  let label = formLabel.value.trim() || hostLabel(url);
  let landing = getLandingForm();
  if (orgs.some(o => o.id != editingId && o.url == url && (o.username || "") == username)) {
    formError.textContent = "This org is already saved with this username.";
    return;
  }
  if (editingId) {
    orgs = orgs.map(o => (o.id == editingId ? {...o, label, url, username, landing} : o));
  } else {
    orgs.push({id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), label, url, username, landing});
  }
  saveOrgSettings(new URL(url).hostname);
  await saveOrgs();
  closeForm();
  render();
});

formUrl.addEventListener("input", updateSettingsVisibility);
formLanding.addEventListener("change", () => {
  formLandingPath.hidden = formLanding.value != "custom";
  if (!formLandingPath.hidden) {
    formLandingPath.focus();
  }
});
formFaviconPicker.addEventListener("input", () => { formFavicon.value = formFaviconPicker.value; });
formFavicon.addEventListener("input", () => setFavicon(formFavicon.value.trim()));

document.getElementById("form-cancel").addEventListener("click", closeForm);
document.getElementById("form-current").addEventListener("click", fillFromCurrentTab);
document.getElementById("add-btn").addEventListener("click", () => openForm(null));

form.addEventListener("keydown", e => {
  if (e.key == "Escape") {
    e.preventDefault();
    closeForm();
  }
});

searchInput.addEventListener("input", () => {
  selectedIndex = 0;
  render();
});

searchInput.addEventListener("keydown", e => {
  if (e.key == "ArrowDown" || e.key == "ArrowUp") {
    e.preventDefault();
    if (filteredOrgs.length == 0) {
      return;
    }
    let delta = e.key == "ArrowDown" ? 1 : -1;
    selectedIndex = (selectedIndex + delta + filteredOrgs.length) % filteredOrgs.length;
    render();
    let selected = orgList.querySelector("li.selected");
    if (selected) {
      selected.scrollIntoView({block: "nearest"});
    }
  } else if (e.key == "Enter" && filteredOrgs[selectedIndex]) {
    e.preventDefault();
    openOrg(filteredOrgs[selectedIndex], openModeFromEvent(e));
  }
});

document.getElementById("options-link").addEventListener("click", async e => {
  e.preventDefault();
  let tabUrl = await getActiveTabUrl();
  openOptions(tabUrl && isSalesforceUrl(tabUrl) ? new URL(tabUrl).hostname : "");
});

Promise.all([loadOrgs(), getActiveTabUrl()]).then(([saved, tabUrl]) => {
  orgs = saved;
  if (tabUrl && isSalesforceUrl(tabUrl)) {
    currentHost = toLoginHost(new URL(tabUrl).hostname);
  }
  render();
});
