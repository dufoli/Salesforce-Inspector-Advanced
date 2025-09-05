/* global React */
import {sfConn, apiVersion} from "./inspector.js";

export class QueryHistory {
  constructor(storageKey, max, compare, sorter) {
    this.storageKey = storageKey;
    this.max = max;
    this.list = this._get();
    this.compare = compare;
    this.sorter = sorter;
  }

  _get() {
    let history;
    try {
      history = JSON.parse(localStorage[this.storageKey]);
    } catch (e) {
    // empty
    }
    if (!Array.isArray(history)) {
      history = [];
    }
    // A previous version stored just strings. Skip entries from that to avoid errors.
    history = history.filter(e => typeof e == "object");
    this.sort(this.storageKey, history);
    return history;
  }

  add(entry) {
    let history = this._get();
    let historyIndex = history.findIndex(e => this.compare(e, entry));
    if (historyIndex > -1) {
      history.splice(historyIndex, 1);
    }
    history.splice(0, 0, entry);
    if (history.length > this.max) {
      history.pop();
    }
    localStorage[this.storageKey] = JSON.stringify(history);
    this.sort(this.storageKey, history);
  }

  remove(entry) {
    let history = this._get();
    //old and new format
    let historyIndex = history.findIndex(e => this.compare(e, entry));
    if (historyIndex > -1) {
      history.splice(historyIndex, 1);
    }
    localStorage[this.storageKey] = JSON.stringify(history);
    this.sort(this.storageKey, history);
  }

  clear() {
    localStorage.removeItem(this.storageKey);
    this.list = [];
  }

  sort(storageKey, history) {
    //sort only saved query not history
    if (storageKey.startsWith("insextSaved")) {
      history.sort(this.sorter);
    }
    this.list = history;
  }
}
