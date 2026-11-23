"use strict";
let sfHost = "";

// Resolves the API host of the org a page belongs to, or null when the page has no Salesforce session (e.g. Trailhead).
// When on a *.visual.force.com page, the session in the cookie does not have API access,
// so we read the corresponding session from *.salesforce.com page.
// The first part of the session cookie is the OrgID,
// which we use as key to support being logged in to multiple orgs at once.
// http://salesforce.stackexchange.com/questions/23277/different-session-ids-in-different-contexts
// There is no straight forward way to unambiguously understand if the user authenticated against salesforce.com or cloudforce.com
// (and thereby the domain of the relevant cookie) cookie domains are therefore tried in sequence.
// Firefox does not support incognito split mode, so we use the tab's cookieStoreId to select the right cookie store.
// Chrome does not support cookieStoreId, which means it is undefined, and we end up using the default cookie store according to incognito split mode.
function findSfHost(url, storeId) {
  return new Promise(resolve => {
    const currentDomain = new URL(url).hostname;
    chrome.cookies.get({url, name: "sid", storeId}, cookie => {
      if (!cookie) {
        resolve(null);
        return;
      }
      if (currentDomain.endsWith(".mcas.ms")) { //Domain used by Microsoft Defender for Cloud Apps, where sid exists but cannot be read
        resolve(currentDomain);
        return;
      }
      const [orgId] = cookie.value.split("!");
      const orderedDomains = ["salesforce.com", "cloudforce.com", "salesforce.mil", "cloudforce.mil", "sfcrmproducts.cn", "force.com", "salesforce-setup.com", "visualforce.com", "sfcrmapps.cn", "force.mil", "visualforce.mil", "crmforce.mil"];
      let pending = orderedDomains.length;
      orderedDomains.forEach(cookieDomain => {
        chrome.cookies.getAll({name: "sid", domain: cookieDomain, secure: true, storeId}, cookies => {
          let filteredCookies = cookies.filter(c => c.value.startsWith(orgId + "!"));
          let sessionCookie = null;
          if (filteredCookies.length > 1) {
            sessionCookie = filteredCookies.find(c => c.domain.startsWith(cookieDomain.split(".")[0]));
          }
          if (filteredCookies.length === 1) {
            sessionCookie = filteredCookies[0];
          }
          if (sessionCookie) {
            resolve(sessionCookie.domain); // first match wins, later resolve calls are ignored
          } else if (--pending == 0) {
            resolve(currentDomain);
          }
        });
      });
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Perform cookie operations in the background page, because not all foreground pages have access to the cookie API.
  if (request.message == "getSfHost") {
    findSfHost(request.url, sender.tab.cookieStoreId).then(host => sendResponse(host || new URL(request.url).hostname));
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  }
  if (request.message == "getSessionHosts") {
    // Hosts of the orgs the user is logged in to, e.g. to pick the target org of a data transfer
    chrome.cookies.getAll({name: "sid", secure: true, storeId: sender.tab.cookieStoreId}, cookies => {
      let hosts = cookies.map(c => c.domain.replace(/^\./, "")).filter(domain => /\.my\.(salesforce\.(com|mil)|sfcrmproducts\.cn)$/.test(domain));
      sendResponse([...new Set(hosts)]);
    });
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  }
  if (request.message == "getSession") {
    if (!request.otherOrg) { // a connection to another org (e.g. data transfer target) must not change the org used by keyboard shortcuts
      sfHost = request.sfHost;
    }
    chrome.cookies.get({url: "https://" + request.sfHost, name: "sid", storeId: sender.tab.cookieStoreId}, sessionCookie => {
      if (!sessionCookie) {
        sendResponse(null);
        return;
      }
      let session = {key: sessionCookie.value, hostname: sessionCookie.domain};
      sendResponse(session);
    });
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  }
  if (request.message == "incognito") {
    if (typeof chrome !== "undefined") {
      chrome.windows.create({url: request.url, incognito: true});
    } else if (typeof browser !== "undefined") { //Firefox
      browser.windows.create({url: request.url, incognito: true});
    } else {
      console.error("No browser object found");
    }
  } else if (request.message == "refresh") {
    let queryOptions = {active: true, lastFocusedWindow: true};
    chrome.tabs.query(queryOptions, (tabs) => chrome.tabs.reload(tabs[0].id));
  } else if (request.message == "callAIAPI") {
    // Faire les appels API IA depuis le background script pour éviter les problèmes CORS
    const {endpoint, body, headers} = request;
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    }).then(response => {
      if (!response.ok) {
        return response.json().then(errorData => {
          throw new Error(errorData.error?.message || `Erreur API: ${response.status} ${response.statusText}`);
        }).catch(() => {
          throw new Error(`Erreur API: ${response.status} ${response.statusText}`);
        });
      }
      return response.json();
    }).then(data => {
      sendResponse({success: true, data});
    }).catch(error => {
      sendResponse({success: false, error: error.message});
    });
    return true; // Indique que sendResponse sera appelé de manière asynchrone
  }
  return false;
});
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (reason === "install") {
    chrome.tabs.create({
      url: "https://dufoli.github.io/Salesforce-Inspector-Advanced/welcome/"
    });
  }
});
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command, tab) => {
    //TODO home to open setup
    // Prefer the org of the active tab; tab.url is only exposed for hosts we have permission on, i.e. Salesforce domains.
    let host = tab?.url?.startsWith("https://") ? await findSfHost(tab.url, tab.cookieStoreId) : null;
    host = host || sfHost; // fall back to the last org used by the extension
    chrome.tabs.create({
      url: chrome.runtime.getURL(host ? `${command}.html?host=${host}` : "org-launcher.html")
    });
  });
}
// The toolbar button opens org-launcher.html (default_popup in the manifests), so there is no onClicked listener.
