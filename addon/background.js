"use strict";
let sfHost = "";
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Perform cookie operations in the background page, because not all foreground pages have access to the cookie API.
  // Firefox does not support incognito split mode, so we use sender.tab.cookieStoreId to select the right cookie store.
  // Chrome does not support sender.tab.cookieStoreId, which means it is undefined, and we end up using the default cookie store according to incognito split mode.
  if (request.message == "getSfHost") {
    const currentDomain = new URL(request.url).hostname;
    // When on a *.visual.force.com page, the session in the cookie does not have API access,
    // so we read the corresponding session from *.salesforce.com page.
    // The first part of the session cookie is the OrgID,
    // which we use as key to support being logged in to multiple orgs at once.
    // http://salesforce.stackexchange.com/questions/23277/different-session-ids-in-different-contexts
    // There is no straight forward way to unambiguously understand if the user authenticated against salesforce.com or cloudforce.com
    // (and thereby the domain of the relevant cookie) cookie domains are therefore tried in sequence.
    chrome.cookies.get({url: request.url, name: "sid", storeId: sender.tab.cookieStoreId}, cookie => {
      if (!cookie || currentDomain.endsWith(".mcas.ms")) { //Domain used by Microsoft Defender for Cloud Apps, where sid exists but cannot be read
        sendResponse(currentDomain);
        sfHost = currentDomain;
        return;
      }
      const [orgId] = cookie.value.split("!");
      const orderedDomains = ["salesforce.com", "cloudforce.com", "salesforce.mil", "cloudforce.mil", "sfcrmproducts.cn", "force.com", "salesforce-setup.com", "visualforce.com", "sfcrmapps.cn", "force.mil", "visualforce.mil", "crmforce.mil"];

      orderedDomains.forEach(currentDomain => {
        chrome.cookies.getAll({name: "sid", domain: currentDomain, secure: true, storeId: sender.tab.cookieStoreId}, cookies => {
          let sessionCookie = cookies.find(c => c.value.startsWith(orgId + "!"));
          if (sessionCookie) {
            sendResponse(sessionCookie.domain);
            sfHost = sessionCookie.domain;
          }
        });
      });
    });
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  }
  if (request.message == "getSession") {
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
  if (request.message == "getAllSessions") {
    chrome.cookies.get({url: "https://" + request.sfHost, name: "sid", storeId: sender.tab.cookieStoreId}, cookie => {
      if (!cookie) { //Domain used by Microsoft Defender for Cloud Apps, where sid exists but cannot be read
        sendResponse(null);
        return;
      }
      const [orgId] = cookie.value.split("!");
      const orderedDomains = ["salesforce.com", "cloudforce.com", "salesforce.mil", "cloudforce.mil", "sfcrmproducts.cn", "force.com", "salesforce-setup.com", "visualforce.com", "sfcrmapps.cn", "force.mil", "visualforce.mil", "crmforce.mil"];
      orderedDomains.splice(orderedDomains.indexOf(request.sfHost), 1);
      orderedDomains.unshift(request.sfHost);
      let cookiesFullList = [];
      let i = 0;
      //Promise all do not worked here so just wait for all return with index.
      orderedDomains.forEach(currentDomain => chrome.cookies.getAll({name: "sid", domain: currentDomain, secure: true, storeId: sender.tab.cookieStoreId}, cookies => {
        cookiesFullList.push(...cookies);
        i++;
        if (i === orderedDomains.length) {
          cookiesFullList = cookiesFullList.filter(c => c.value.startsWith(orgId + "!"));
          sendResponse(cookiesFullList.map(c => ({key: c.value, hostname: c.domain})));
        }
      })
      );
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
  chrome.commands.onCommand.addListener((command) => {
    //TODO home to open setup
    chrome.tabs.create({
      url: `chrome-extension://${chrome.i18n.getMessage("@@extension_id")}/${command}.html?host=${sfHost}`
    });
  });
}
if (chrome.action) {
  chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({
      url: `chrome-extension://${chrome.i18n.getMessage("@@extension_id")}/data-export.html?host=${sfHost}`
    });
  });
}
