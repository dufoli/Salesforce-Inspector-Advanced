let lastApiVersion = "63.0";
if (localStorage.getItem("apiVersion") == lastApiVersion) {
  localStorage.removeItem("apiVersion");
  //do not keep if last version is selected in order to update to last vrsion on update of SFI.
}
let currentBrowser;
if (typeof browser === "undefined") {
  currentBrowser = chrome;
} else {
  currentBrowser = browser;
}
export let apiVersion = localStorage.getItem("apiVersion") == null ? lastApiVersion : localStorage.getItem("apiVersion");
export let sessionError;
export let sfConn = {

  async getSession(sfHost) {
    sfHost = getMyDomain(sfHost);
    const ACCESS_TOKEN = "access__token";
    const currentUrlIncludesToken = window.location.href.includes(ACCESS_TOKEN);
    const oldToken = localStorage.getItem(sfHost + "_" + ACCESS_TOKEN);
    this.instanceHostname = sfHost;
    if (currentUrlIncludesToken){ //meaning OAuth flow just completed
      if (window.location.href.includes(ACCESS_TOKEN)) {
        const url = new URL(window.location.href);
        const hashParams = new URLSearchParams(url.hash.substring(1)); //hash (#) used in user-agent flow
        const accessToken = decodeURI(hashParams.get(ACCESS_TOKEN));
        sfHost = decodeURI(hashParams.get("instance_url")).replace(/^https?:\/\//i, "");
        this.sessionId = accessToken;
        localStorage.setItem(sfHost + "_" + ACCESS_TOKEN, accessToken);
      }
    } else if (oldToken) {
      this.sessionId = oldToken;
    } else {
      let message = await new Promise(resolve =>
        currentBrowser.runtime.sendMessage({message: "getSession", sfHost}, resolve));
      if (message) {
        this.instanceHostname = getMyDomain(message.hostname);
        this.sessionId = message.key;
        //only set localstorage with oauth flow
        //localStorage.setItem(sfHost + "_" + ACCESS_TOKEN, message.key);
      }
    }
    const IS_SANDBOX = "isSandbox";
    if (localStorage.getItem(sfHost + "_" + IS_SANDBOX) == null) {
      sfConn.rest("/services/data/v" + apiVersion + "/query/?q=SELECT+IsSandbox,+InstanceName+FROM+Organization").then(res => {
        localStorage.setItem(sfHost + "_" + IS_SANDBOX, res.records[0].IsSandbox);
        localStorage.setItem(sfHost + "_orgInstance", res.records[0].InstanceName);
      });
    }
  },

  async rest(url, {logErrors = true, method = "GET", api = "normal", body = undefined, bodyType = "json", responseType = "json", headers = {}, progressHandler = null, withoutCache = false} = {}) {
    if (!this.instanceHostname) {
      throw new Error("Instance Hostname not found");
    }

    let xhr = new XMLHttpRequest();
    if ((!url.includes("/executeAnonymous/")) || withoutCache){
      url += (url.includes("?") ? "&" : "?") + "cache=" + Math.random();
    }
    const sfHost = "https://" + this.instanceHostname;
    let finalUrl = new URL(url, sfHost);
    xhr.open(method, finalUrl.toString(), true);

    xhr.setRequestHeader("Accept", "application/json; charset=UTF-8");
    xhr.setRequestHeader("Sforce-Call-Options", "client:Salesforce Inspector Advanced");

    if (api == "bulk") {
      xhr.setRequestHeader("X-SFDC-Session", this.sessionId);
    } else if (api == "normal") {
      xhr.setRequestHeader("Authorization", "Bearer " + this.sessionId);
    } else {
      throw new Error("Unknown api");
    }

    if (body !== undefined) {
      if (bodyType == "json") {
        body = JSON.stringify(body);
        xhr.setRequestHeader("Content-Type", "application/json; charset=UTF-8");
      } else if (bodyType == "raw") {
        // Do nothing
      } else if (bodyType == "csv") {
        xhr.setRequestHeader("Content-Type", "text/csv; charset=UTF-8");
        // Do nothing
      } else if (bodyType == "xml") {
        // Do nothing
        xhr.setRequestHeader("Content-Type", "text/xml; charset=UTF-8");
      } else {
        throw new Error("Unknown bodyType");
      }
    }

    for (let [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.responseType = responseType;
    await new Promise((resolve, reject) => {
      if (progressHandler) {
        progressHandler.abort = () => {
          let err = new Error("The request was aborted.");
          err.name = "AbortError";
          reject(err);
          xhr.abort();
        };
      }

      xhr.onreadystatechange = () => {
        if (xhr.readyState == 4) {
          resolve();
        }
      };
      xhr.send(body);
    });
    if (xhr.status >= 200 && xhr.status < 300) {
      return xhr.response;
    } else if (xhr.status == 0) {
      if (!logErrors) { console.error("Received no response from Salesforce REST API", xhr); }
      let err = new Error();
      err.name = "SalesforceRestError";
      err.message = "Network error, offline or timeout";
      throw err;
    } else if (xhr.status == 401) {
      let error = xhr.response.length > 0 ? xhr.response[0].message : "New access token needed";
      const ACCESS_TOKEN = "_access__token";
      let oldToken = localStorage.getItem(this.instanceHostname + ACCESS_TOKEN);
      if (oldToken){
        sessionError = error;
        showInvalidTokenBanner();
      }
      let err = new Error();
      err.name = "Unauthorized";
      err.message = error;
      throw err;
    } else if (xhr.status == 431) {
      let err = new Error();
      err.name = "Bad Message";
      err.message = "Request Header Fields Too Large";
      throw err;
    } else if (xhr.status == 414) {
      let err = new Error();
      err.name = "Bad Message";
      err.message = "URI Too Long";
      throw err;
    } else {
      if (!logErrors) { console.error("Received error response from Salesforce REST API", xhr); }
      let err = new Error();
      err.name = "SalesforceRestError";
      err.detail = xhr.response;
      try {
        err.message = err.detail.map(err => `${err.errorCode}: ${err.message}${err.fields && err.fields.length > 0 ? ` [${err.fields.join(", ")}]` : ""}`).join("\n");
      } catch (ex) {
        err.message = JSON.stringify(xhr.response);
      }
      if (!err.message) {
        err.message = "HTTP error " + xhr.status + " " + xhr.statusText;
      }
      throw err;
    }
  },

  wsdl(apiVersion, apiName) {
    let wsdl = {
      Enterprise: {
        servicePortAddress: "/services/Soap/c/" + apiVersion,
        targetNamespaces: ' xmlns="urn:enterprise.soap.sforce.com" xmlns:sf="urn:sobject.enterprise.soap.sforce.com"',
        apiName: "Enterprise",
        wsdlUrl: "/soap/wsdl.jsp?type=*&ver_aircall=2.14&ver_b2bma=1.7&ver_dfsle=6.7&ver_dsfs=7.0&ver_efl=1.5&ver_Profile2PermSet=3.8&ver_relateiq=2.0&ver_sf_chttr_apps=1.20&ver_sf_com_apps=1.7"
      },
      Partner: {
        servicePortAddress: "/services/Soap/u/" + apiVersion,
        targetNamespaces: ' xmlns="urn:partner.soap.sforce.com" xmlns:sf="urn:sobject.partner.soap.sforce.com"',
        apiName: "Partner",
        wsdlUrl: "/soap/wsdl.jsp"
      },
      Apex: {
        servicePortAddress: "/services/Soap/s/" + apiVersion,
        targetNamespaces: ' xmlns="http://soap.sforce.com/2006/08/apex"',
        apiName: "Apex",
        wsdlUrl: "/services/wsdl/apex"
      },
      Metadata: {
        servicePortAddress: "/services/Soap/m/" + apiVersion,
        targetNamespaces: ' xmlns="http://soap.sforce.com/2006/04/metadata"',
        apiName: "Metadata",
        wsdlUrl: "/services/wsdl/metadata"
      },
      Tooling: {
        servicePortAddress: "/services/Soap/T/" + apiVersion,
        targetNamespaces: ' xmlns="urn:tooling.soap.sforce.com" xmlns:sf="urn:sobject.tooling.soap.sforce.com" xmlns:mns="urn:metadata.tooling.soap.sforce.com"',
        apiName: "Tooling",
        wsdlUrl: "/services/wsdl/tooling"
      }
    };
    if (apiName) {
      wsdl = wsdl[apiName];
    }
    return wsdl;
  },

  formatSoapMessage(wsdl, method, args, headers) {
    let sessionHeaderKey = wsdl.apiName == "Metadata" ? "met:SessionHeader" : "SessionHeader";
    let sessionIdKey = wsdl.apiName == "Metadata" ? "met:sessionId" : "sessionId";
    let requestMethod = wsdl.apiName == "Metadata" ? `met:${method}` : method;
    let requestAttributes = [
      'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    ];
    if (wsdl.apiName == "Metadata") {
      requestAttributes.push('xmlns:met="http://soap.sforce.com/2006/04/metadata"');
    }
    return XML.stringify({
      name: "soapenv:Envelope",
      attributes: ` ${requestAttributes.join(" ")}${wsdl.targetNamespaces}`,
      value: {
        "soapenv:Header": Object.assign({}, {[sessionHeaderKey]: {[sessionIdKey]: this.sessionId}}, headers),
        "soapenv:Body": {[requestMethod]: args}
      }
    });
  },
  async soap(wsdl, method, args, {headers} = {}) {
    if (!this.instanceHostname || !this.sessionId) {
      throw new Error("Session not found");
    }

    let xhr = new XMLHttpRequest();
    xhr.open("POST", "https://" + this.instanceHostname + wsdl.servicePortAddress + "?cache=" + Math.random(), true);
    xhr.setRequestHeader("Content-Type", "text/xml");
    xhr.setRequestHeader("SOAPAction", '""');
    xhr.setRequestHeader("CallOptions", "client:Salesforce Inspector Advanced");

    let requestBody;
    if (typeof args == "string") {
      requestBody = args;
    } else {
      requestBody = this.formatSoapMessage(wsdl, method, args, headers);
    }
    xhr.responseType = "document";
    await new Promise(resolve => {
      xhr.onreadystatechange = () => {
        if (xhr.readyState == 4) {
          resolve(xhr);
        }
      };
      xhr.send(requestBody);
    });
    if (xhr.status == 200) {
      let responseBody = xhr.response.querySelector(method + "Response");
      let parsed = XML.parse(responseBody).result;
      return parsed;
    } else {
      console.error("Received error response from Salesforce SOAP API", xhr);
      let err = new Error();
      err.name = "SalesforceSoapError";
      err.detail = xhr.response;
      try {
        err.message = xhr.response.querySelector("faultstring").textContent;
      } catch (ex) {
        err.message = "HTTP error " + xhr.status + " " + xhr.statusText;
      }
      throw err;
    }
  },

  asArray(x) {
    if (!x) return [];
    if (x instanceof Array) return x;
    return [x];
  },

};

class XML {
  static stringify({name, attributes, value}) {
    function buildRequest(el, params) {
      if (params == null) {
        el.setAttribute("xsi:nil", "true");
      } else if (typeof params == "object") {
        for (let [key, value] of Object.entries(params)) {
          if (key == "_") {
            if (value == null) {
              el.setAttribute("xsi:nil", "true");
            } else {
              el.textContent = value;
            }
          } else if (key == "$xsi:type") {
            el.setAttribute("xsi:type", value);
          } else if (value === undefined) {
            // ignore
          } else if (Array.isArray(value)) {
            for (let element of value) {
              let x = doc.createElement(key);
              buildRequest(x, element);
              el.appendChild(x);
            }
          } else {
            let x = doc.createElement(key);
            buildRequest(x, value);
            el.appendChild(x);
          }
        }
      } else {
        el.textContent = params;
      }
    }
    let doc = new DOMParser().parseFromString("<" + name + attributes + "/>", "text/xml");
    buildRequest(doc.documentElement, value);
    return '<?xml version="1.0" encoding="UTF-8"?>' + new XMLSerializer().serializeToString(doc).replace(/ xmlns=""/g, "");
  }

  static parse(element) {
    function parseResponse(element) {
      let str = ""; // XSD Simple Type value
      let obj = null; // XSD Complex Type value
      // If the element has child elements, it is a complex type. Otherwise we assume it is a simple type.
      if (element.getAttribute("xsi:nil") == "true") {
        return null;
      }
      let type = element.getAttribute("xsi:type");
      if (type) {
        // Salesforce never sets the xsi:type attribute on simple types. It is only used on sObjects.
        obj = {
          "$xsi:type": type
        };
      }
      for (let child = element.firstChild; child != null; child = child.nextSibling) {
        if (child instanceof CharacterData) {
          str += child.data;
        } else if (child instanceof Element) {
          if (obj == null) {
            obj = {};
          }
          let name = child.localName;
          let content = parseResponse(child);
          if (name in obj) {
            if (obj[name] instanceof Array) {
              obj[name].push(content);
            } else {
              obj[name] = [obj[name], content];
            }
          } else {
            obj[name] = content;
          }
        } else {
          throw new Error("Unknown child node type");
        }
      }
      return obj || str;
    }
    return parseResponse(element);
  }
}

function getMyDomain(host) {
  if (host) {
    const myDomain = host
      .replace(/\.lightning\.force\./, ".my.salesforce.") //avoid HTTP redirect (that would cause Authorization header to be dropped)
      .replace(/\.mcas\.ms$/, ""); //remove trailing .mcas.ms if the client uses Microsoft Defender for Cloud Apps
    return myDomain;
  }
  return host;
}

function showInvalidTokenBanner(){
  const containerToShow = document.getElementById("invalidTokenBanner");
  if (containerToShow) { containerToShow.classList.remove("hide"); }
  const containerToMask = document.getElementById("mainTabs");
  if (containerToMask) { containerToMask.classList.add("mask"); }
}
