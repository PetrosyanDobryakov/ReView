var __defProp = Object.defineProperty;
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
};

// src/engine/Camera.ts
var SMOOTHING = 0.12;
function clamp(v, min2, max2) {
  return Math.max(min2, Math.min(max2, v));
}
var Camera = class {
  x = 0;
  y = 0;
  zoom = 1;
  minZoom = 0.1;
  maxZoom = 4;
  instant = false;
  tx = 0;
  ty = 0;
  tz = 1;
  update(dt) {
    const k = this.instant ? 1 : 1 - Math.exp(-dt / SMOOTHING);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tz - this.zoom) * k;
  }
  panBy(dx, dy) {
    this.tx -= dx / this.zoom;
    this.ty -= dy / this.zoom;
  }
  zoomAt(sx, sy, halfW, halfH, factor) {
    const newZoom = clamp(this.tz * factor, this.minZoom, this.maxZoom);
    if (newZoom === this.tz) return;
    const wx = (sx - halfW) / this.tz + this.tx;
    const wy = (sy - halfH) / this.tz + this.ty;
    this.tz = newZoom;
    this.tx = wx - (sx - halfW) / newZoom;
    this.ty = wy - (sy - halfH) / newZoom;
  }
  setZoom(zoom) {
    this.tz = clamp(zoom, this.minZoom, this.maxZoom);
  }
  fitView(box, viewW, viewH, padding) {
    const w = Math.max(box.w, 10);
    const h = Math.max(box.h, 10);
    const z = Math.min((viewW - padding * 2) / w, (viewH - padding * 2) / h);
    this.tz = clamp(z, this.minZoom, this.maxZoom);
    this.zoom = this.tz;
    this.tx = box.x + box.w / 2;
    this.ty = box.y + box.h / 2;
    this.x = this.tx;
    this.y = this.ty;
  }
  screenToWorld(sx, sy, halfW, halfH) {
    return {
      x: (sx - halfW) / this.zoom + this.x,
      y: (sy - halfH) / this.zoom + this.y
    };
  }
};

// src/engine/Grid.ts
var CELL = 512;
var Grid = class {
  boxes = /* @__PURE__ */ new Map();
  cells = /* @__PURE__ */ new Map();
  upsert(id, box) {
    this.remove(id);
    this.boxes.set(id, box);
    const x0 = Math.floor(box.x / CELL);
    const x1 = Math.floor((box.x + box.w) / CELL);
    const y0 = Math.floor(box.y / CELL);
    const y1 = Math.floor((box.y + box.h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cx + ":" + cy;
        let set = this.cells.get(key);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          this.cells.set(key, set);
        }
        set.add(id);
      }
    }
  }
  remove(id) {
    const box = this.boxes.get(id);
    if (!box) return;
    this.boxes.delete(id);
    const x0 = Math.floor(box.x / CELL);
    const x1 = Math.floor((box.x + box.w) / CELL);
    const y0 = Math.floor(box.y / CELL);
    const y1 = Math.floor((box.y + box.h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const set = this.cells.get(cx + ":" + cy);
        if (set) {
          set.delete(id);
          if (!set.size) this.cells.delete(cx + ":" + cy);
        }
      }
    }
  }
  rebuild(shapes) {
    this.boxes.clear();
    this.cells.clear();
    for (const shape of shapes) {
      this.boxes.set(shape.id, shape);
    }
    for (const [id, box] of this.boxes) {
      const x0 = Math.floor(box.x / CELL);
      const x1 = Math.floor((box.x + box.w) / CELL);
      const y0 = Math.floor(box.y / CELL);
      const y1 = Math.floor((box.y + box.h) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cx + ":" + cy;
          let set = this.cells.get(key);
          if (!set) {
            set = /* @__PURE__ */ new Set();
            this.cells.set(key, set);
          }
          set.add(id);
        }
      }
    }
  }
  query(box) {
    const x0 = Math.floor(box.x / CELL);
    const x1 = Math.floor((box.x + box.w) / CELL);
    const y0 = Math.floor(box.y / CELL);
    const y1 = Math.floor((box.y + box.h) / CELL);
    const result = /* @__PURE__ */ new Set();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const set = this.cells.get(cx + ":" + cy);
        if (!set) continue;
        for (const id of set) result.add(id);
      }
    }
    return result;
  }
};

// src/core/store.ts
var store_exports = {};
__export(store_exports, {
  LOCAL_ORIGIN: () => LOCAL_ORIGIN,
  addShape: () => addShape,
  board: () => board,
  destroyProvider: () => destroyProvider,
  doc: () => doc,
  ensureOrder: () => ensureOrder,
  getProvider: () => getProvider,
  makeId: () => makeId,
  meta: () => meta,
  metaBg: () => metaBg,
  metaGrid: () => metaGrid,
  moveOrderToBack: () => moveOrderToBack,
  moveOrderToFront: () => moveOrderToFront,
  onSyncStatus: () => onSyncStatus,
  order: () => order,
  patchShape: () => patchShape,
  patchShapes: () => patchShapes,
  persistence: () => persistence,
  readShape: () => readShape,
  removeShapes: () => removeShapes,
  setMeta: () => setMeta,
  transact: () => transact3,
  undoManager: () => undoManager
});
import * as Y6 from "yjs";

// node_modules/y-indexeddb/src/y-indexeddb.js
import * as Y from "yjs";

// node_modules/lib0/math.js
var floor = Math.floor;
var min = (a, b) => a < b ? a : b;
var max = (a, b) => a > b ? a : b;
var isNaN = Number.isNaN;
var pow = Math.pow;

// node_modules/lib0/time.js
var getUnixTime = Date.now;

// node_modules/lib0/promise.js
var create = (f) => (
  /** @type {Promise<T>} */
  new Promise(f)
);
var all = Promise.all.bind(Promise);

// node_modules/lib0/error.js
var create2 = (s) => new Error(s);

// node_modules/lib0/indexeddb.js
var rtop = (request) => create((resolve, reject) => {
  request.onerror = (event) => reject(new Error(event.target.error));
  request.onsuccess = (event) => resolve(event.target.result);
});
var openDB = (name, initDB) => create((resolve, reject) => {
  const request = indexedDB.open(name);
  request.onupgradeneeded = (event) => initDB(event.target.result);
  request.onerror = (event) => reject(create2(event.target.error));
  request.onsuccess = (event) => {
    const db = event.target.result;
    db.onversionchange = () => {
      db.close();
    };
    resolve(db);
  };
});
var deleteDB = (name) => rtop(indexedDB.deleteDatabase(name));
var createStores = (db, definitions) => definitions.forEach(
  (d) => (
    // @ts-ignore
    db.createObjectStore.apply(db, d)
  )
);
var transact = (db, stores, access = "readwrite") => {
  const transaction = db.transaction(stores, access);
  return stores.map((store) => getStore(transaction, store));
};
var count = (store, range) => rtop(store.count(range));
var get = (store, key) => rtop(store.get(key));
var del = (store, key) => rtop(store.delete(key));
var put = (store, item, key) => rtop(store.put(item, key));
var addAutoKey = (store, item) => rtop(store.add(item));
var getAll = (store, range, limit) => rtop(store.getAll(range, limit));
var queryFirst = (store, query, direction) => {
  let first = null;
  return iterateKeys(store, query, (key) => {
    first = key;
    return false;
  }, direction).then(() => first);
};
var getLastKey = (store, range = null) => queryFirst(store, range, "prev");
var iterateOnRequest = (request, f) => create((resolve, reject) => {
  request.onerror = reject;
  request.onsuccess = async (event) => {
    const cursor = event.target.result;
    if (cursor === null || await f(cursor) === false) {
      return resolve();
    }
    cursor.continue();
  };
});
var iterateKeys = (store, keyrange, f, direction = "next") => iterateOnRequest(store.openKeyCursor(keyrange, direction), (cursor) => f(cursor.key));
var getStore = (t, store) => t.objectStore(store);
var createIDBKeyRangeUpperBound = (upper, upperOpen) => IDBKeyRange.upperBound(upper, upperOpen);
var createIDBKeyRangeLowerBound = (lower, lowerOpen) => IDBKeyRange.lowerBound(lower, lowerOpen);

// node_modules/lib0/map.js
var create3 = () => /* @__PURE__ */ new Map();
var setIfUndefined = (map2, key, createT) => {
  let set = map2.get(key);
  if (set === void 0) {
    map2.set(key, set = createT());
  }
  return set;
};

// node_modules/lib0/set.js
var create4 = () => /* @__PURE__ */ new Set();

// node_modules/lib0/array.js
var from = Array.from;

// node_modules/lib0/observable.js
var ObservableV2 = class {
  constructor() {
    this._observers = create3();
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  on(name, f) {
    setIfUndefined(
      this._observers,
      /** @type {string} */
      name,
      create4
    ).add(f);
    return f;
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  once(name, f) {
    const _f = (...args2) => {
      this.off(
        name,
        /** @type {any} */
        _f
      );
      f(...args2);
    };
    this.on(
      name,
      /** @type {any} */
      _f
    );
  }
  /**
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name
   * @param {EVENTS[NAME]} f
   */
  off(name, f) {
    const observers = this._observers.get(name);
    if (observers !== void 0) {
      observers.delete(f);
      if (observers.size === 0) {
        this._observers.delete(name);
      }
    }
  }
  /**
   * Emit a named event. All registered event listeners that listen to the
   * specified name will receive the event.
   *
   * @todo This should catch exceptions
   *
   * @template {keyof EVENTS & string} NAME
   * @param {NAME} name The event name.
   * @param {Parameters<EVENTS[NAME]>} args The arguments that are applied to the event listener.
   */
  emit(name, args2) {
    return from((this._observers.get(name) || create3()).values()).forEach((f) => f(...args2));
  }
  destroy() {
    this._observers = create3();
  }
};
var Observable = class {
  constructor() {
    this._observers = create3();
  }
  /**
   * @param {N} name
   * @param {function} f
   */
  on(name, f) {
    setIfUndefined(this._observers, name, create4).add(f);
  }
  /**
   * @param {N} name
   * @param {function} f
   */
  once(name, f) {
    const _f = (...args2) => {
      this.off(name, _f);
      f(...args2);
    };
    this.on(name, _f);
  }
  /**
   * @param {N} name
   * @param {function} f
   */
  off(name, f) {
    const observers = this._observers.get(name);
    if (observers !== void 0) {
      observers.delete(f);
      if (observers.size === 0) {
        this._observers.delete(name);
      }
    }
  }
  /**
   * Emit a named event. All registered event listeners that listen to the
   * specified name will receive the event.
   *
   * @todo This should catch exceptions
   *
   * @param {N} name The event name.
   * @param {Array<any>} args The arguments that are applied to the event listener.
   */
  emit(name, args2) {
    return from((this._observers.get(name) || create3()).values()).forEach((f) => f(...args2));
  }
  destroy() {
    this._observers = create3();
  }
};

// node_modules/y-indexeddb/src/y-indexeddb.js
var customStoreName = "custom";
var updatesStoreName = "updates";
var PREFERRED_TRIM_SIZE = 500;
var fetchUpdates = (idbPersistence, beforeApplyUpdatesCallback = () => {
}, afterApplyUpdatesCallback = () => {
}) => {
  const [updatesStore] = transact(
    /** @type {IDBDatabase} */
    idbPersistence.db,
    [updatesStoreName]
  );
  return getAll(updatesStore, createIDBKeyRangeLowerBound(idbPersistence._dbref, false)).then((updates) => {
    if (!idbPersistence._destroyed) {
      beforeApplyUpdatesCallback(updatesStore);
      Y.transact(idbPersistence.doc, () => {
        updates.forEach((val) => Y.applyUpdate(idbPersistence.doc, val));
      }, idbPersistence, false);
      afterApplyUpdatesCallback(updatesStore);
    }
  }).then(() => getLastKey(updatesStore).then((lastKey) => {
    idbPersistence._dbref = lastKey + 1;
  })).then(() => count(updatesStore).then((cnt) => {
    idbPersistence._dbsize = cnt;
  })).then(() => updatesStore);
};
var storeState = (idbPersistence, forceStore = true) => fetchUpdates(idbPersistence).then((updatesStore) => {
  if (forceStore || idbPersistence._dbsize >= PREFERRED_TRIM_SIZE) {
    addAutoKey(updatesStore, Y.encodeStateAsUpdate(idbPersistence.doc)).then(() => del(updatesStore, createIDBKeyRangeUpperBound(idbPersistence._dbref, true))).then(() => count(updatesStore).then((cnt) => {
      idbPersistence._dbsize = cnt;
    }));
  }
});
var IndexeddbPersistence = class extends Observable {
  /**
   * @param {string} name
   * @param {Y.Doc} doc
   */
  constructor(name, doc2) {
    super();
    this.doc = doc2;
    this.name = name;
    this._dbref = 0;
    this._dbsize = 0;
    this._destroyed = false;
    this.db = null;
    this.synced = false;
    this._db = openDB(
      name,
      (db) => createStores(db, [
        ["updates", { autoIncrement: true }],
        ["custom"]
      ])
    );
    this.whenSynced = create((resolve) => this.on("synced", () => resolve(this)));
    this._db.then((db) => {
      this.db = db;
      const beforeApplyUpdatesCallback = (updatesStore) => addAutoKey(updatesStore, Y.encodeStateAsUpdate(doc2));
      const afterApplyUpdatesCallback = () => {
        if (this._destroyed) return this;
        this.synced = true;
        this.emit("synced", [this]);
      };
      fetchUpdates(this, beforeApplyUpdatesCallback, afterApplyUpdatesCallback);
    });
    this._storeTimeout = 1e3;
    this._storeTimeoutId = null;
    this._storeUpdate = (update, origin) => {
      if (this.db && origin !== this) {
        const [updatesStore] = transact(
          /** @type {IDBDatabase} */
          this.db,
          [updatesStoreName]
        );
        addAutoKey(updatesStore, update);
        if (++this._dbsize >= PREFERRED_TRIM_SIZE) {
          if (this._storeTimeoutId !== null) {
            clearTimeout(this._storeTimeoutId);
          }
          this._storeTimeoutId = setTimeout(() => {
            storeState(this, false);
            this._storeTimeoutId = null;
          }, this._storeTimeout);
        }
      }
    };
    doc2.on("update", this._storeUpdate);
    this.destroy = this.destroy.bind(this);
    doc2.on("destroy", this.destroy);
  }
  destroy() {
    if (this._storeTimeoutId) {
      clearTimeout(this._storeTimeoutId);
    }
    this.doc.off("update", this._storeUpdate);
    this.doc.off("destroy", this.destroy);
    this._destroyed = true;
    return this._db.then((db) => {
      db.close();
    });
  }
  /**
   * Destroys this instance and removes all data from indexeddb.
   *
   * @return {Promise<void>}
   */
  clearData() {
    return this.destroy().then(() => {
      deleteDB(this.name);
    });
  }
  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @return {Promise<String | number | ArrayBuffer | Date | any>}
   */
  get(key) {
    return this._db.then((db) => {
      const [custom] = transact(db, [customStoreName], "readonly");
      return get(custom, key);
    });
  }
  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @param {String | number | ArrayBuffer | Date} value
   * @return {Promise<String | number | ArrayBuffer | Date>}
   */
  set(key, value) {
    return this._db.then((db) => {
      const [custom] = transact(db, [customStoreName]);
      return put(custom, value, key);
    });
  }
  /**
   * @param {String | number | ArrayBuffer | Date} key
   * @return {Promise<undefined>}
   */
  del(key) {
    return this._db.then((db) => {
      const [custom] = transact(db, [customStoreName]);
      return del(custom, key);
    });
  }
};

// node_modules/y-websocket/src/y-websocket.js
import * as Y5 from "yjs";

// node_modules/lib0/string.js
var fromCharCode = String.fromCharCode;
var fromCodePoint = String.fromCodePoint;
var MAX_UTF16_CHARACTER = fromCharCode(65535);
var toLowerCase = (s) => s.toLowerCase();
var trimLeftRegex = /^\s*/g;
var trimLeft = (s) => s.replace(trimLeftRegex, "");
var fromCamelCaseRegex = /([A-Z])/g;
var fromCamelCase = (s, separator) => trimLeft(s.replace(fromCamelCaseRegex, (match) => `${separator}${toLowerCase(match)}`));
var _encodeUtf8Polyfill = (str) => {
  const encodedString = unescape(encodeURIComponent(str));
  const len = encodedString.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = /** @type {number} */
    encodedString.codePointAt(i);
  }
  return buf;
};
var utf8TextEncoder = (
  /** @type {TextEncoder} */
  typeof TextEncoder !== "undefined" ? new TextEncoder() : null
);
var _encodeUtf8Native = (str) => utf8TextEncoder.encode(str);
var encodeUtf8 = utf8TextEncoder ? _encodeUtf8Native : _encodeUtf8Polyfill;
var utf8TextDecoder = typeof TextDecoder === "undefined" ? null : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
if (utf8TextDecoder && utf8TextDecoder.decode(new Uint8Array()).length === 1) {
  utf8TextDecoder = null;
}

// node_modules/lib0/conditions.js
var undefinedToNull = (v) => v === void 0 ? null : v;

// node_modules/lib0/storage.js
var VarStoragePolyfill = class {
  constructor() {
    this.map = /* @__PURE__ */ new Map();
  }
  /**
   * @param {string} key
   * @param {any} newValue
   */
  setItem(key, newValue) {
    this.map.set(key, newValue);
  }
  /**
   * @param {string} key
   */
  getItem(key) {
    return this.map.get(key);
  }
};
var _localStorage = new VarStoragePolyfill();
var usePolyfill = true;
try {
  if (typeof localStorage !== "undefined" && localStorage) {
    _localStorage = localStorage;
    usePolyfill = false;
  }
} catch (e) {
}
var varStorage = _localStorage;
var onChange = (eventHandler) => usePolyfill || addEventListener(
  "storage",
  /** @type {any} */
  eventHandler
);
var offChange = (eventHandler) => usePolyfill || removeEventListener(
  "storage",
  /** @type {any} */
  eventHandler
);

// node_modules/lib0/trait/equality.js
var EqualityTraitSymbol = /* @__PURE__ */ Symbol("Equality");

// node_modules/lib0/object.js
var keys = Object.keys;
var map = (obj, f) => {
  const results = [];
  for (const key in obj) {
    results.push(f(obj[key], key));
  }
  return results;
};
var size = (obj) => keys(obj).length;
var hasProperty = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// node_modules/lib0/function.js
var equalityDeep = (a, b) => {
  if (a === b) {
    return true;
  }
  if (a == null || b == null || a.constructor !== b.constructor && (a.constructor || Object) !== (b.constructor || Object)) {
    return false;
  }
  if (a[EqualityTraitSymbol] != null) {
    return a[EqualityTraitSymbol](b);
  }
  switch (a.constructor) {
    case ArrayBuffer:
      a = new Uint8Array(a);
      b = new Uint8Array(b);
    // eslint-disable-next-line no-fallthrough
    case Uint8Array: {
      if (a.byteLength !== b.byteLength) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          return false;
        }
      }
      break;
    }
    case Set: {
      if (a.size !== b.size) {
        return false;
      }
      for (const value of a) {
        if (!b.has(value)) {
          return false;
        }
      }
      break;
    }
    case Map: {
      if (a.size !== b.size) {
        return false;
      }
      for (const key of a.keys()) {
        if (!b.has(key) || !equalityDeep(a.get(key), b.get(key))) {
          return false;
        }
      }
      break;
    }
    case void 0:
    case Object:
      if (size(a) !== size(b)) {
        return false;
      }
      for (const key in a) {
        if (!hasProperty(a, key) || !equalityDeep(a[key], b[key])) {
          return false;
        }
      }
      break;
    case Array:
      if (a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!equalityDeep(a[i], b[i])) {
          return false;
        }
      }
      break;
    default:
      return false;
  }
  return true;
};
var isOneOf = (value, options) => options.includes(value);

// node_modules/lib0/environment.js
var isNode = typeof process !== "undefined" && process.release && /node|io\.js/.test(process.release.name) && Object.prototype.toString.call(typeof process !== "undefined" ? process : 0) === "[object process]";
var isBrowser = typeof window !== "undefined" && typeof document !== "undefined" && !isNode;
var isMac = typeof navigator !== "undefined" ? /Mac/.test(navigator.platform) : false;
var params;
var args = [];
var computeParams = () => {
  if (params === void 0) {
    if (isNode) {
      params = create3();
      const pargs = process.argv;
      let currParamName = null;
      for (let i = 0; i < pargs.length; i++) {
        const parg = pargs[i];
        if (parg[0] === "-") {
          if (currParamName !== null) {
            params.set(currParamName, "");
          }
          currParamName = parg;
        } else {
          if (currParamName !== null) {
            params.set(currParamName, parg);
            currParamName = null;
          } else {
            args.push(parg);
          }
        }
      }
      if (currParamName !== null) {
        params.set(currParamName, "");
      }
    } else if (typeof location === "object") {
      params = create3();
      (location.search || "?").slice(1).split("&").forEach((kv) => {
        if (kv.length !== 0) {
          const [key, value] = kv.split("=");
          params.set(`--${fromCamelCase(key, "-")}`, value);
          params.set(`-${fromCamelCase(key, "-")}`, value);
        }
      });
    } else {
      params = create3();
    }
  }
  return params;
};
var hasParam = (name) => computeParams().has(name);
var getVariable = (name) => isNode ? undefinedToNull(process.env[name.toUpperCase().replaceAll("-", "_")]) : undefinedToNull(varStorage.getItem(name));
var hasConf = (name) => hasParam("--" + name) || getVariable(name) !== null;
var production = hasConf("production");
var forceColor = isNode && isOneOf(process.env.FORCE_COLOR, ["true", "1", "2"]);
var supportsColor = forceColor || !hasParam("--no-colors") && // @todo deprecate --no-colors
!hasConf("no-color") && (!isNode || process.stdout.isTTY) && (!isNode || hasParam("--color") || getVariable("COLORTERM") !== null || (getVariable("TERM") || "").includes("color"));

// node_modules/lib0/binary.js
var BIT8 = 128;
var BIT18 = 1 << 17;
var BIT19 = 1 << 18;
var BIT20 = 1 << 19;
var BIT21 = 1 << 20;
var BIT22 = 1 << 21;
var BIT23 = 1 << 22;
var BIT24 = 1 << 23;
var BIT25 = 1 << 24;
var BIT26 = 1 << 25;
var BIT27 = 1 << 26;
var BIT28 = 1 << 27;
var BIT29 = 1 << 28;
var BIT30 = 1 << 29;
var BIT31 = 1 << 30;
var BIT32 = 1 << 31;
var BITS7 = 127;
var BITS17 = BIT18 - 1;
var BITS18 = BIT19 - 1;
var BITS19 = BIT20 - 1;
var BITS20 = BIT21 - 1;
var BITS21 = BIT22 - 1;
var BITS22 = BIT23 - 1;
var BITS23 = BIT24 - 1;
var BITS24 = BIT25 - 1;
var BITS25 = BIT26 - 1;
var BITS26 = BIT27 - 1;
var BITS27 = BIT28 - 1;
var BITS28 = BIT29 - 1;
var BITS29 = BIT30 - 1;
var BITS30 = BIT31 - 1;

// node_modules/lib0/number.js
var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
var MIN_SAFE_INTEGER = Number.MIN_SAFE_INTEGER;
var LOWEST_INT32 = 1 << 31;
var isInteger = Number.isInteger || ((num) => typeof num === "number" && isFinite(num) && floor(num) === num);
var isNaN2 = Number.isNaN;
var parseInt2 = Number.parseInt;

// node_modules/lib0/encoding.js
var Encoder = class {
  constructor() {
    this.cpos = 0;
    this.cbuf = new Uint8Array(100);
    this.bufs = [];
  }
};
var createEncoder = () => new Encoder();
var length = (encoder) => {
  let len = encoder.cpos;
  for (let i = 0; i < encoder.bufs.length; i++) {
    len += encoder.bufs[i].length;
  }
  return len;
};
var toUint8Array = (encoder) => {
  const uint8arr = new Uint8Array(length(encoder));
  let curPos = 0;
  for (let i = 0; i < encoder.bufs.length; i++) {
    const d = encoder.bufs[i];
    uint8arr.set(d, curPos);
    curPos += d.length;
  }
  uint8arr.set(new Uint8Array(encoder.cbuf.buffer, 0, encoder.cpos), curPos);
  return uint8arr;
};
var write = (encoder, num) => {
  const bufferLen = encoder.cbuf.length;
  if (encoder.cpos === bufferLen) {
    encoder.bufs.push(encoder.cbuf);
    encoder.cbuf = new Uint8Array(bufferLen * 2);
    encoder.cpos = 0;
  }
  encoder.cbuf[encoder.cpos++] = num;
};
var writeVarUint = (encoder, num) => {
  while (num > BITS7) {
    write(encoder, BIT8 | BITS7 & num);
    num = floor(num / 128);
  }
  write(encoder, BITS7 & num);
};
var _strBuffer = new Uint8Array(3e4);
var _maxStrBSize = _strBuffer.length / 3;
var _writeVarStringNative = (encoder, str) => {
  if (str.length < _maxStrBSize) {
    const written = utf8TextEncoder.encodeInto(str, _strBuffer).written || 0;
    writeVarUint(encoder, written);
    for (let i = 0; i < written; i++) {
      write(encoder, _strBuffer[i]);
    }
  } else {
    writeVarUint8Array(encoder, encodeUtf8(str));
  }
};
var _writeVarStringPolyfill = (encoder, str) => {
  const encodedString = unescape(encodeURIComponent(str));
  const len = encodedString.length;
  writeVarUint(encoder, len);
  for (let i = 0; i < len; i++) {
    write(
      encoder,
      /** @type {number} */
      encodedString.codePointAt(i)
    );
  }
};
var writeVarString = utf8TextEncoder && /** @type {any} */
utf8TextEncoder.encodeInto ? _writeVarStringNative : _writeVarStringPolyfill;
var writeUint8Array = (encoder, uint8Array) => {
  const bufferLen = encoder.cbuf.length;
  const cpos = encoder.cpos;
  const leftCopyLen = min(bufferLen - cpos, uint8Array.length);
  const rightCopyLen = uint8Array.length - leftCopyLen;
  encoder.cbuf.set(uint8Array.subarray(0, leftCopyLen), cpos);
  encoder.cpos += leftCopyLen;
  if (rightCopyLen > 0) {
    encoder.bufs.push(encoder.cbuf);
    encoder.cbuf = new Uint8Array(max(bufferLen * 2, rightCopyLen));
    encoder.cbuf.set(uint8Array.subarray(leftCopyLen));
    encoder.cpos = rightCopyLen;
  }
};
var writeVarUint8Array = (encoder, uint8Array) => {
  writeVarUint(encoder, uint8Array.byteLength);
  writeUint8Array(encoder, uint8Array);
};
var floatTestBed = new DataView(new ArrayBuffer(4));

// node_modules/lib0/decoding.js
var errorUnexpectedEndOfArray = create2("Unexpected end of array");
var errorIntegerOutOfRange = create2("Integer out of Range");
var Decoder = class {
  /**
   * @param {Uint8Array<Buf>} uint8Array Binary data to decode
   */
  constructor(uint8Array) {
    this.arr = uint8Array;
    this.pos = 0;
  }
};
var createDecoder = (uint8Array) => new Decoder(uint8Array);
var readUint8Array = (decoder, len) => {
  const view = new Uint8Array(decoder.arr.buffer, decoder.pos + decoder.arr.byteOffset, len);
  decoder.pos += len;
  return view;
};
var readVarUint8Array = (decoder) => readUint8Array(decoder, readVarUint(decoder));
var readUint8 = (decoder) => decoder.arr[decoder.pos++];
var readVarUint = (decoder) => {
  let num = 0;
  let mult = 1;
  const len = decoder.arr.length;
  while (decoder.pos < len) {
    const r = decoder.arr[decoder.pos++];
    num = num + (r & BITS7) * mult;
    mult *= 128;
    if (r < BIT8) {
      return num;
    }
    if (num > MAX_SAFE_INTEGER) {
      throw errorIntegerOutOfRange;
    }
  }
  throw errorUnexpectedEndOfArray;
};
var _readVarStringPolyfill = (decoder) => {
  let remainingLen = readVarUint(decoder);
  if (remainingLen === 0) {
    return "";
  } else {
    let encodedString = String.fromCodePoint(readUint8(decoder));
    if (--remainingLen < 100) {
      while (remainingLen--) {
        encodedString += String.fromCodePoint(readUint8(decoder));
      }
    } else {
      while (remainingLen > 0) {
        const nextLen = remainingLen < 1e4 ? remainingLen : 1e4;
        const bytes = decoder.arr.subarray(decoder.pos, decoder.pos + nextLen);
        decoder.pos += nextLen;
        encodedString += String.fromCodePoint.apply(
          null,
          /** @type {any} */
          bytes
        );
        remainingLen -= nextLen;
      }
    }
    return decodeURIComponent(escape(encodedString));
  }
};
var _readVarStringNative = (decoder) => (
  /** @type any */
  utf8TextDecoder.decode(readVarUint8Array(decoder))
);
var readVarString = utf8TextDecoder ? _readVarStringNative : _readVarStringPolyfill;

// node_modules/lib0/buffer.js
var createUint8ArrayFromLen = (len) => new Uint8Array(len);
var createUint8ArrayViewFromArrayBuffer = (buffer, byteOffset, length2) => new Uint8Array(buffer, byteOffset, length2);
var createUint8ArrayFromArrayBuffer = (buffer) => new Uint8Array(buffer);
var toBase64Browser = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    s += fromCharCode(bytes[i]);
  }
  return btoa(s);
};
var toBase64Node = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
var fromBase64Browser = (s) => {
  const a = atob(s);
  const bytes = createUint8ArrayFromLen(a.length);
  for (let i = 0; i < a.length; i++) {
    bytes[i] = a.charCodeAt(i);
  }
  return bytes;
};
var fromBase64Node = (s) => {
  const buf = Buffer.from(s, "base64");
  return createUint8ArrayViewFromArrayBuffer(buf.buffer, buf.byteOffset, buf.byteLength);
};
var toBase64 = isBrowser ? toBase64Browser : toBase64Node;
var fromBase64 = isBrowser ? fromBase64Browser : fromBase64Node;

// node_modules/lib0/broadcastchannel.js
var channels = /* @__PURE__ */ new Map();
var LocalStoragePolyfill = class {
  /**
   * @param {string} room
   */
  constructor(room) {
    this.room = room;
    this.onmessage = null;
    this._onChange = (e) => e.key === room && this.onmessage !== null && this.onmessage({ data: fromBase64(e.newValue || "") });
    onChange(this._onChange);
  }
  /**
   * @param {ArrayBuffer} buf
   */
  postMessage(buf) {
    varStorage.setItem(this.room, toBase64(createUint8ArrayFromArrayBuffer(buf)));
  }
  close() {
    offChange(this._onChange);
  }
};
var BC = typeof BroadcastChannel === "undefined" ? LocalStoragePolyfill : BroadcastChannel;
var getChannel = (room) => setIfUndefined(channels, room, () => {
  const subs = create4();
  const bc = new BC(room);
  bc.onmessage = (e) => subs.forEach((sub) => sub(e.data, "broadcastchannel"));
  return {
    bc,
    subs
  };
});
var subscribe = (room, f) => {
  getChannel(room).subs.add(f);
  return f;
};
var unsubscribe = (room, f) => {
  const channel = getChannel(room);
  const unsubscribed = channel.subs.delete(f);
  if (unsubscribed && channel.subs.size === 0) {
    channel.bc.close();
    channels.delete(room);
  }
  return unsubscribed;
};
var publish = (room, data, origin = null) => {
  const c = getChannel(room);
  c.bc.postMessage(data);
  c.subs.forEach((sub) => sub(data, origin));
};

// node_modules/y-protocols/sync.js
import * as Y2 from "yjs";
var messageYjsSyncStep1 = 0;
var messageYjsSyncStep2 = 1;
var messageYjsUpdate = 2;
var writeSyncStep1 = (encoder, doc2) => {
  writeVarUint(encoder, messageYjsSyncStep1);
  const sv = Y2.encodeStateVector(doc2);
  writeVarUint8Array(encoder, sv);
};
var writeSyncStep2 = (encoder, doc2, encodedStateVector) => {
  writeVarUint(encoder, messageYjsSyncStep2);
  writeVarUint8Array(encoder, Y2.encodeStateAsUpdate(doc2, encodedStateVector));
};
var readSyncStep1 = (decoder, encoder, doc2) => writeSyncStep2(encoder, doc2, readVarUint8Array(decoder));
var readSyncStep2 = (decoder, doc2, transactionOrigin, errorHandler) => {
  try {
    Y2.applyUpdate(doc2, readVarUint8Array(decoder), transactionOrigin);
  } catch (error) {
    if (errorHandler != null) errorHandler(
      /** @type {Error} */
      error
    );
    console.error("Caught error while handling a Yjs update", error);
  }
};
var writeUpdate = (encoder, update) => {
  writeVarUint(encoder, messageYjsUpdate);
  writeVarUint8Array(encoder, update);
};
var readUpdate = readSyncStep2;
var readSyncMessage = (decoder, encoder, doc2, transactionOrigin, errorHandler) => {
  const messageType = readVarUint(decoder);
  switch (messageType) {
    case messageYjsSyncStep1:
      readSyncStep1(decoder, encoder, doc2);
      break;
    case messageYjsSyncStep2:
      readSyncStep2(decoder, doc2, transactionOrigin, errorHandler);
      break;
    case messageYjsUpdate:
      readUpdate(decoder, doc2, transactionOrigin, errorHandler);
      break;
    default:
      throw new Error("Unknown message type");
  }
  return messageType;
};

// node_modules/y-protocols/auth.js
import * as Y3 from "yjs";
var messagePermissionDenied = 0;
var readAuthMessage = (decoder, y, permissionDeniedHandler2) => {
  switch (readVarUint(decoder)) {
    case messagePermissionDenied:
      permissionDeniedHandler2(y, readVarString(decoder));
  }
};

// node_modules/y-protocols/awareness.js
import * as Y4 from "yjs";
var outdatedTimeout = 3e4;
var Awareness = class extends Observable {
  /**
   * @param {Y.Doc} doc
   */
  constructor(doc2) {
    super();
    this.doc = doc2;
    this.clientID = doc2.clientID;
    this.states = /* @__PURE__ */ new Map();
    this.meta = /* @__PURE__ */ new Map();
    this._checkInterval = /** @type {any} */
    setInterval(() => {
      const now = getUnixTime();
      if (this.getLocalState() !== null && outdatedTimeout / 2 <= now - /** @type {{lastUpdated:number}} */
      this.meta.get(this.clientID).lastUpdated) {
        this.setLocalState(this.getLocalState());
      }
      const remove = [];
      this.meta.forEach((meta2, clientid) => {
        if (clientid !== this.clientID && outdatedTimeout <= now - meta2.lastUpdated && this.states.has(clientid)) {
          remove.push(clientid);
        }
      });
      if (remove.length > 0) {
        removeAwarenessStates(this, remove, "timeout");
      }
    }, floor(outdatedTimeout / 10));
    doc2.on("destroy", () => {
      this.destroy();
    });
    this.setLocalState({});
  }
  destroy() {
    this.emit("destroy", [this]);
    this.setLocalState(null);
    super.destroy();
    clearInterval(this._checkInterval);
  }
  /**
   * @return {Object<string,any>|null}
   */
  getLocalState() {
    return this.states.get(this.clientID) || null;
  }
  /**
   * @param {Object<string,any>|null} state
   */
  setLocalState(state) {
    const clientID = this.clientID;
    const currLocalMeta = this.meta.get(clientID);
    const clock = currLocalMeta === void 0 ? 0 : currLocalMeta.clock + 1;
    const prevState = this.states.get(clientID);
    if (state === null) {
      this.states.delete(clientID);
    } else {
      this.states.set(clientID, state);
    }
    this.meta.set(clientID, {
      clock,
      lastUpdated: getUnixTime()
    });
    const added = [];
    const updated = [];
    const filteredUpdated = [];
    const removed = [];
    if (state === null) {
      removed.push(clientID);
    } else if (prevState == null) {
      if (state != null) {
        added.push(clientID);
      }
    } else {
      updated.push(clientID);
      if (!equalityDeep(prevState, state)) {
        filteredUpdated.push(clientID);
      }
    }
    if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
      this.emit("change", [{ added, updated: filteredUpdated, removed }, "local"]);
    }
    this.emit("update", [{ added, updated, removed }, "local"]);
  }
  /**
   * @param {string} field
   * @param {any} value
   */
  setLocalStateField(field, value) {
    const state = this.getLocalState();
    if (state !== null) {
      this.setLocalState({
        ...state,
        [field]: value
      });
    }
  }
  /**
   * @return {Map<number,Object<string,any>>}
   */
  getStates() {
    return this.states;
  }
};
var removeAwarenessStates = (awareness, clients, origin) => {
  const removed = [];
  for (let i = 0; i < clients.length; i++) {
    const clientID = clients[i];
    if (awareness.states.has(clientID)) {
      awareness.states.delete(clientID);
      if (clientID === awareness.clientID) {
        const curMeta = (
          /** @type {MetaClientState} */
          awareness.meta.get(clientID)
        );
        awareness.meta.set(clientID, {
          clock: curMeta.clock + 1,
          lastUpdated: getUnixTime()
        });
      }
      removed.push(clientID);
    }
  }
  if (removed.length > 0) {
    awareness.emit("change", [{ added: [], updated: [], removed }, origin]);
    awareness.emit("update", [{ added: [], updated: [], removed }, origin]);
  }
};
var encodeAwarenessUpdate = (awareness, clients, states = awareness.states) => {
  const len = clients.length;
  const encoder = createEncoder();
  writeVarUint(encoder, len);
  for (let i = 0; i < len; i++) {
    const clientID = clients[i];
    const state = states.get(clientID) || null;
    const clock = (
      /** @type {MetaClientState} */
      awareness.meta.get(clientID).clock
    );
    writeVarUint(encoder, clientID);
    writeVarUint(encoder, clock);
    writeVarString(encoder, JSON.stringify(state));
  }
  return toUint8Array(encoder);
};
var applyAwarenessUpdate = (awareness, update, origin) => {
  const decoder = createDecoder(update);
  const timestamp = getUnixTime();
  const added = [];
  const updated = [];
  const filteredUpdated = [];
  const removed = [];
  const len = readVarUint(decoder);
  for (let i = 0; i < len; i++) {
    const clientID = readVarUint(decoder);
    let clock = readVarUint(decoder);
    const state = JSON.parse(readVarString(decoder));
    const clientMeta = awareness.meta.get(clientID);
    const prevState = awareness.states.get(clientID);
    const currClock = clientMeta === void 0 ? 0 : clientMeta.clock;
    if (currClock < clock || currClock === clock && state === null && awareness.states.has(clientID)) {
      if (state === null) {
        if (clientID === awareness.clientID && awareness.getLocalState() != null) {
          clock++;
        } else {
          awareness.states.delete(clientID);
        }
      } else {
        awareness.states.set(clientID, state);
      }
      awareness.meta.set(clientID, {
        clock,
        lastUpdated: timestamp
      });
      if (clientMeta === void 0 && state !== null) {
        added.push(clientID);
      } else if (clientMeta !== void 0 && state === null) {
        removed.push(clientID);
      } else if (state !== null) {
        if (!equalityDeep(state, prevState)) {
          filteredUpdated.push(clientID);
        }
        updated.push(clientID);
      }
    }
  }
  if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
    awareness.emit("change", [{
      added,
      updated: filteredUpdated,
      removed
    }, origin]);
  }
  if (added.length > 0 || updated.length > 0 || removed.length > 0) {
    awareness.emit("update", [{
      added,
      updated,
      removed
    }, origin]);
  }
};

// node_modules/lib0/url.js
var encodeQueryParams = (params2) => map(params2, (val, key) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join("&");

// node_modules/y-websocket/src/y-websocket.js
var messageSync = 0;
var messageQueryAwareness = 3;
var messageAwareness = 1;
var messageAuth = 2;
var messageHandlers = [];
messageHandlers[messageSync] = (encoder, decoder, provider2, emitSynced, _messageType) => {
  writeVarUint(encoder, messageSync);
  const syncMessageType = readSyncMessage(
    decoder,
    encoder,
    provider2.doc,
    provider2
  );
  if (emitSynced && syncMessageType === messageYjsSyncStep2 && !provider2.synced) {
    provider2.synced = true;
  }
};
messageHandlers[messageQueryAwareness] = (encoder, _decoder, provider2, _emitSynced, _messageType) => {
  writeVarUint(encoder, messageAwareness);
  writeVarUint8Array(
    encoder,
    encodeAwarenessUpdate(
      provider2.awareness,
      Array.from(provider2.awareness.getStates().keys())
    )
  );
};
messageHandlers[messageAwareness] = (_encoder, decoder, provider2, _emitSynced, _messageType) => {
  applyAwarenessUpdate(
    provider2.awareness,
    readVarUint8Array(decoder),
    provider2
  );
};
messageHandlers[messageAuth] = (_encoder, decoder, provider2, _emitSynced, _messageType) => {
  readAuthMessage(
    decoder,
    provider2.doc,
    (_ydoc, reason) => permissionDeniedHandler(provider2, reason)
  );
};
var messageReconnectTimeout = 3e4;
var permissionDeniedHandler = (provider2, reason) => console.warn(`Permission denied to access ${provider2.url}.
${reason}`);
var readMessage = (provider2, buf, emitSynced) => {
  const decoder = createDecoder(buf);
  const encoder = createEncoder();
  const messageType = readVarUint(decoder);
  const messageHandler = provider2.messageHandlers[messageType];
  if (
    /** @type {any} */
    messageHandler
  ) {
    messageHandler(encoder, decoder, provider2, emitSynced, messageType);
  } else {
    console.error("Unable to compute message");
  }
  return encoder;
};
var closeWebsocketConnection = (provider2, ws, event) => {
  if (ws === provider2.ws) {
    provider2.emit("connection-close", [event, provider2]);
    provider2.ws = null;
    ws.close();
    provider2.wsconnecting = false;
    if (provider2.wsconnected) {
      provider2.wsconnected = false;
      provider2.synced = false;
      removeAwarenessStates(
        provider2.awareness,
        Array.from(provider2.awareness.getStates().keys()).filter(
          (client) => client !== provider2.doc.clientID
        ),
        provider2
      );
      provider2.emit("status", [{
        status: "disconnected"
      }]);
    } else {
      provider2.wsUnsuccessfulReconnects++;
    }
    setTimeout(
      setupWS,
      min(
        pow(2, provider2.wsUnsuccessfulReconnects) * 100,
        provider2.maxBackoffTime
      ),
      provider2
    );
  }
};
var setupWS = (provider2) => {
  if (provider2.shouldConnect && provider2.ws === null) {
    const websocket = new provider2._WS(provider2.url, provider2.protocols);
    websocket.binaryType = "arraybuffer";
    provider2.ws = websocket;
    provider2.wsconnecting = true;
    provider2.wsconnected = false;
    provider2.synced = false;
    websocket.onmessage = (event) => {
      provider2.wsLastMessageReceived = getUnixTime();
      const encoder = readMessage(provider2, new Uint8Array(event.data), true);
      if (length(encoder) > 1) {
        websocket.send(toUint8Array(encoder));
      }
    };
    websocket.onerror = (event) => {
      provider2.emit("connection-error", [event, provider2]);
    };
    websocket.onclose = (event) => {
      closeWebsocketConnection(provider2, websocket, event);
    };
    websocket.onopen = () => {
      provider2.wsLastMessageReceived = getUnixTime();
      provider2.wsconnecting = false;
      provider2.wsconnected = true;
      provider2.wsUnsuccessfulReconnects = 0;
      provider2.emit("status", [{
        status: "connected"
      }]);
      const encoder = createEncoder();
      writeVarUint(encoder, messageSync);
      writeSyncStep1(encoder, provider2.doc);
      websocket.send(toUint8Array(encoder));
      if (provider2.awareness.getLocalState() !== null) {
        const encoderAwarenessState = createEncoder();
        writeVarUint(encoderAwarenessState, messageAwareness);
        writeVarUint8Array(
          encoderAwarenessState,
          encodeAwarenessUpdate(provider2.awareness, [
            provider2.doc.clientID
          ])
        );
        websocket.send(toUint8Array(encoderAwarenessState));
      }
    };
    provider2.emit("status", [{
      status: "connecting"
    }]);
  }
};
var broadcastMessage = (provider2, buf) => {
  const ws = provider2.ws;
  if (provider2.wsconnected && ws && ws.readyState === ws.OPEN) {
    ws.send(buf);
  }
  if (provider2.bcconnected) {
    publish(provider2.bcChannel, buf, provider2);
  }
};
var WebsocketProvider = class extends ObservableV2 {
  /**
   * @param {string} serverUrl
   * @param {string} roomname
   * @param {Y.Doc} doc
   * @param {object} opts
   * @param {boolean} [opts.connect]
   * @param {awarenessProtocol.Awareness} [opts.awareness]
   * @param {Object<string,string>} [opts.params] specify url parameters
   * @param {Array<string>} [opts.protocols] specify websocket protocols
   * @param {typeof WebSocket} [opts.WebSocketPolyfill] Optionall provide a WebSocket polyfill
   * @param {number} [opts.resyncInterval] Request server state every `resyncInterval` milliseconds
   * @param {number} [opts.maxBackoffTime] Maximum amount of time to wait before trying to reconnect (we try to reconnect using exponential backoff)
   * @param {boolean} [opts.disableBc] Disable cross-tab BroadcastChannel communication
   */
  constructor(serverUrl, roomname, doc2, {
    connect = true,
    awareness = new Awareness(doc2),
    params: params2 = {},
    protocols = [],
    WebSocketPolyfill = WebSocket,
    resyncInterval = -1,
    maxBackoffTime = 2500,
    disableBc = false
  } = {}) {
    super();
    while (serverUrl[serverUrl.length - 1] === "/") {
      serverUrl = serverUrl.slice(0, serverUrl.length - 1);
    }
    this.serverUrl = serverUrl;
    this.bcChannel = serverUrl + "/" + roomname;
    this.maxBackoffTime = maxBackoffTime;
    this.params = params2;
    this.protocols = protocols;
    this.roomname = roomname;
    this.doc = doc2;
    this._WS = WebSocketPolyfill;
    this.awareness = awareness;
    this.wsconnected = false;
    this.wsconnecting = false;
    this.bcconnected = false;
    this.disableBc = disableBc;
    this.wsUnsuccessfulReconnects = 0;
    this.messageHandlers = messageHandlers.slice();
    this._synced = false;
    this.ws = null;
    this.wsLastMessageReceived = 0;
    this.shouldConnect = connect;
    this._resyncInterval = 0;
    if (resyncInterval > 0) {
      this._resyncInterval = /** @type {any} */
      setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const encoder = createEncoder();
          writeVarUint(encoder, messageSync);
          writeSyncStep1(encoder, doc2);
          this.ws.send(toUint8Array(encoder));
        }
      }, resyncInterval);
    }
    this._bcSubscriber = (data, origin) => {
      if (origin !== this) {
        const encoder = readMessage(this, new Uint8Array(data), false);
        if (length(encoder) > 1) {
          publish(this.bcChannel, toUint8Array(encoder), this);
        }
      }
    };
    this._updateHandler = (update, origin) => {
      if (origin !== this) {
        const encoder = createEncoder();
        writeVarUint(encoder, messageSync);
        writeUpdate(encoder, update);
        broadcastMessage(this, toUint8Array(encoder));
      }
    };
    this.doc.on("update", this._updateHandler);
    this._awarenessUpdateHandler = ({ added, updated, removed }, _origin) => {
      const changedClients = added.concat(updated).concat(removed);
      const encoder = createEncoder();
      writeVarUint(encoder, messageAwareness);
      writeVarUint8Array(
        encoder,
        encodeAwarenessUpdate(awareness, changedClients)
      );
      broadcastMessage(this, toUint8Array(encoder));
    };
    this._exitHandler = () => {
      removeAwarenessStates(
        this.awareness,
        [doc2.clientID],
        "app closed"
      );
    };
    if (isNode && typeof process !== "undefined") {
      process.on("exit", this._exitHandler);
    }
    awareness.on("update", this._awarenessUpdateHandler);
    this._checkInterval = /** @type {any} */
    setInterval(() => {
      if (this.wsconnected && messageReconnectTimeout < getUnixTime() - this.wsLastMessageReceived) {
        closeWebsocketConnection(
          this,
          /** @type {WebSocket} */
          this.ws,
          null
        );
      }
    }, messageReconnectTimeout / 10);
    if (connect) {
      this.connect();
    }
  }
  get url() {
    const encodedParams = encodeQueryParams(this.params);
    return this.serverUrl + "/" + this.roomname + (encodedParams.length === 0 ? "" : "?" + encodedParams);
  }
  /**
   * @type {boolean}
   */
  get synced() {
    return this._synced;
  }
  set synced(state) {
    if (this._synced !== state) {
      this._synced = state;
      this.emit("synced", [state]);
      this.emit("sync", [state]);
    }
  }
  destroy() {
    if (this._resyncInterval !== 0) {
      clearInterval(this._resyncInterval);
    }
    clearInterval(this._checkInterval);
    this.disconnect();
    if (isNode && typeof process !== "undefined") {
      process.off("exit", this._exitHandler);
    }
    this.awareness.off("update", this._awarenessUpdateHandler);
    this.doc.off("update", this._updateHandler);
    super.destroy();
  }
  connectBc() {
    if (this.disableBc) {
      return;
    }
    if (!this.bcconnected) {
      subscribe(this.bcChannel, this._bcSubscriber);
      this.bcconnected = true;
    }
    const encoderSync = createEncoder();
    writeVarUint(encoderSync, messageSync);
    writeSyncStep1(encoderSync, this.doc);
    publish(this.bcChannel, toUint8Array(encoderSync), this);
    const encoderState = createEncoder();
    writeVarUint(encoderState, messageSync);
    writeSyncStep2(encoderState, this.doc);
    publish(this.bcChannel, toUint8Array(encoderState), this);
    const encoderAwarenessQuery = createEncoder();
    writeVarUint(encoderAwarenessQuery, messageQueryAwareness);
    publish(
      this.bcChannel,
      toUint8Array(encoderAwarenessQuery),
      this
    );
    const encoderAwarenessState = createEncoder();
    writeVarUint(encoderAwarenessState, messageAwareness);
    writeVarUint8Array(
      encoderAwarenessState,
      encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID
      ])
    );
    publish(
      this.bcChannel,
      toUint8Array(encoderAwarenessState),
      this
    );
  }
  disconnectBc() {
    const encoder = createEncoder();
    writeVarUint(encoder, messageAwareness);
    writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID
      ], /* @__PURE__ */ new Map())
    );
    broadcastMessage(this, toUint8Array(encoder));
    if (this.bcconnected) {
      unsubscribe(this.bcChannel, this._bcSubscriber);
      this.bcconnected = false;
    }
  }
  disconnect() {
    this.shouldConnect = false;
    this.disconnectBc();
    if (this.ws !== null) {
      closeWebsocketConnection(this, this.ws, null);
    }
  }
  connect() {
    this.shouldConnect = true;
    if (!this.wsconnected && this.ws === null) {
      setupWS(this);
      this.connectBc();
    }
  }
};

// src/core/shapes.ts
var COLORS = {
  background: "#161922",
  grid: "rgba(255,255,255,0.055)",
  stroke: "#7c8cff",
  fill: "#ffffff",
  sticky: "#ffe27a",
  stickyStroke: "#d9b64d",
  pen: "#f2f5ff",
  text: "#e8ecf5",
  selection: "#7c8cff"
};
var STICKY_FONT = 16;
var TEXT_FONT = 18;
var SHAPE_FONT = 16;
function normalizeBox(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
}
function themeFor(bg) {
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? { text: "#1f2430", grid: "rgba(0,0,0,0.07)" } : { text: "#e8ecf5", grid: "rgba(255,255,255,0.055)" };
}
function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function pointInShape(v, px, py) {
  switch (v.type) {
    case "ellipse": {
      const rx = v.w / 2;
      const ry = v.h / 2;
      if (!rx || !ry) return false;
      const dx = (px - (v.x + rx)) / rx;
      const dy = (py - (v.y + ry)) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case "pen":
    case "arrow":
      return pointNearPolyline(v.points ?? [], px, py, v.strokeWidth / 2 + 3);
    default:
      return px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h;
  }
}
function pointNearPolyline(pts, px, py, tol) {
  if (pts.length < 2) return false;
  const t2 = tol * tol;
  for (let i = 0; i < pts.length - 2; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (ax + abx * t);
    const dy = py - (ay + aby * t);
    if (dx * dx + dy * dy <= t2) return true;
  }
  return false;
}
function drawPenStroke(ctx, pts, width, color, alpha) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 2) {
    ctx.beginPath();
    ctx.arc(pts[0], pts[1], width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  if (pts.length === 4) {
    ctx.lineTo(pts[2], pts[3]);
  } else {
    for (let i = 2; i < pts.length - 2; i += 2) {
      const xc = (pts[i] + pts[i + 2]) / 2;
      const yc = (pts[i + 1] + pts[i + 3]) / 2;
      ctx.quadraticCurveTo(pts[i], pts[i + 1], xc, yc);
    }
    const n = pts.length - 4;
    ctx.quadraticCurveTo(pts[n], pts[n + 1], pts[n + 2], pts[n + 3]);
  }
  ctx.stroke();
  ctx.restore();
}
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const raw of text.split("\n")) {
    if (!raw) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of raw.split(/\s+/)) {
      const test = line ? line + " " + word : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}
function drawShape(ctx, v, textColor = COLORS.text) {
  const font = `${v.fontSize ?? TEXT_FONT}px 'Segoe UI', system-ui, sans-serif`;
  switch (v.type) {
    case "rect": {
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 6);
      ctx.fill();
      ctx.stroke();
      if (v.text) drawLabel(ctx, v, textColor);
      break;
    }
    case "ellipse": {
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.ellipse(v.x + v.w / 2, v.y + v.h / 2, v.w / 2, v.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (v.text) drawLabel(ctx, v, textColor);
      break;
    }
    case "sticky": {
      ctx.fillStyle = v.fill;
      ctx.strokeStyle = v.stroke;
      ctx.lineWidth = v.strokeWidth;
      ctx.beginPath();
      ctx.roundRect(v.x, v.y, v.w, v.h, 8);
      ctx.fill();
      ctx.stroke();
      if (v.text) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(v.x, v.y, v.w, v.h, 8);
        ctx.clip();
        ctx.fillStyle = "#3a2f00";
        ctx.font = font;
        ctx.textBaseline = "top";
        const lineHeight = (v.fontSize ?? STICKY_FONT) * 1.25;
        let lineY = v.y + 8;
        for (const line of wrapText(ctx, v.text, v.w - 16)) {
          ctx.fillText(line, v.x + 8, lineY);
          lineY += lineHeight;
          if (lineY > v.y + v.h - 8) break;
        }
        ctx.restore();
      }
      break;
    }
    case "text": {
      if (!v.text) break;
      ctx.fillStyle = v.textColor ?? textColor;
      ctx.font = font;
      ctx.textBaseline = "top";
      const lineHeight = (v.fontSize ?? TEXT_FONT) * 1.3;
      let lineY = v.y;
      for (const line of v.text.split("\n")) {
        ctx.fillText(line, v.x, lineY);
        lineY += lineHeight;
      }
      break;
    }
    case "pen":
      drawPenStroke(ctx, v.points ?? [], v.strokeWidth, v.stroke, v.alpha ?? 1);
      break;
    case "arrow":
      drawArrow(ctx, v);
      break;
    case "image": {
      const img = getImage(v.src ?? "");
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, v.x, v.y, v.w, v.h);
      } else {
        ctx.fillStyle = "#2b3040";
        ctx.fillRect(v.x, v.y, v.w, v.h);
        ctx.strokeStyle = "#4a5268";
        ctx.lineWidth = 1;
        ctx.strokeRect(v.x, v.y, v.w, v.h);
      }
      break;
    }
  }
}
var imageCache = /* @__PURE__ */ new Map();
var imageListeners = /* @__PURE__ */ new Set();
function onImageLoad(cb) {
  imageListeners.add(cb);
  return () => {
    imageListeners.delete(cb);
  };
}
function getImage(src) {
  if (!src) return null;
  const hit = imageCache.get(src);
  if (hit) return hit;
  const img = new Image();
  img.onload = () => {
    for (const l of imageListeners) l(src);
  };
  img.src = src;
  imageCache.set(src, img);
  return img;
}
function drawArrow(ctx, v) {
  const pts = v.points ?? [];
  if (pts.length < 4) return;
  const ax = pts[0];
  const ay = pts[1];
  const bx = pts[2];
  const by = pts[3];
  ctx.save();
  ctx.strokeStyle = v.stroke;
  ctx.fillStyle = v.stroke;
  ctx.lineWidth = v.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  const angle = Math.atan2(by - ay, bx - ax);
  const head = Math.max(10, v.strokeWidth * 3.5);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - head * Math.cos(angle - 0.42), by - head * Math.sin(angle - 0.42));
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - head * Math.cos(angle + 0.42), by - head * Math.sin(angle + 0.42));
  ctx.stroke();
  ctx.restore();
}
function drawLabel(ctx, v, textColor) {
  const size2 = v.fontSize ?? SHAPE_FONT;
  const lines = wrapText(ctx, v.text ?? "", Math.max(20, v.w - 16));
  if (!lines.length) return;
  ctx.save();
  ctx.beginPath();
  if (v.type === "ellipse") {
    ctx.ellipse(v.x + v.w / 2, v.y + v.h / 2, v.w / 2, v.h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.roundRect(v.x, v.y, v.w, v.h, 6);
  }
  ctx.clip();
  ctx.fillStyle = v.textColor ?? textColor;
  ctx.font = `${size2}px 'Segoe UI', system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = size2 * 1.25;
  const startY = v.y + v.h / 2 - (lines.length - 1) * lineHeight / 2;
  lines.forEach((line, i) => ctx.fillText(line, v.x + v.w / 2, startY + i * lineHeight));
  ctx.restore();
}

// src/core/store.ts
var LOCAL_ORIGIN = "local";
var doc = new Y6.Doc();
var board = doc.getMap("shapes");
var meta = doc.getMap("meta");
var order = doc.getArray("order");
function ensureOrder() {
  if (order.length === board.size) return;
  transact3(() => {
    order.delete(0, order.length);
    order.push([...board.keys()]);
  });
}
function moveOrderToFront(ids) {
  transact3(() => {
    for (const id of ids) {
      const idx = order.toArray().indexOf(id);
      if (idx >= 0) order.delete(idx, 1);
    }
    order.push(ids);
  });
}
function moveOrderToBack(ids) {
  transact3(() => {
    for (const id of ids) {
      const idx = order.toArray().indexOf(id);
      if (idx >= 0) order.delete(idx, 1);
    }
    order.insert(0, ids);
  });
}
function setMeta(patch) {
  transact3(() => {
    for (const [key, value] of Object.entries(patch)) meta.set(key, value);
  });
}
function metaBg() {
  return meta.get("bg") ?? COLORS.background;
}
function metaGrid() {
  return meta.get("grid") ?? true;
}
var undoManager = new Y6.UndoManager([board, order], {
  trackedOrigins: /* @__PURE__ */ new Set([LOCAL_ORIGIN]),
  captureTimeout: 200
});
var persistence = new IndexeddbPersistence("doska-v1", doc);
persistence.on("synced", () => {
  ensureOrder();
});
var SYNC_URL = `ws://${typeof location !== "undefined" ? location.hostname : "localhost"}:1234`;
var provider = null;
function getProvider() {
  if (!provider) {
    provider = new WebsocketProvider(SYNC_URL, "doska", doc);
  }
  return provider;
}
function destroyProvider() {
  if (provider) {
    provider.destroy();
    provider = null;
  }
}
function onSyncStatus(cb) {
  const p = getProvider();
  const count2 = () => p.awareness.getStates().size;
  const emit = () => {
    const online = p.ws?.readyState === WebSocket.OPEN;
    cb({ online, users: online ? count2() : 0 });
  };
  const onStatus = (e) => {
    if (e.status === "connected") cb({ online: true, users: count2() });
    else cb({ online: false, users: 0 });
  };
  p.on("status", onStatus);
  p.awareness.on("change", emit);
  if (p.ws?.readyState === WebSocket.OPEN) cb({ online: true, users: count2() });
  else cb({ online: false, users: 0 });
  return () => {
    p.off("status", onStatus);
    p.awareness.off("change", emit);
  };
}
var uid = 0;
function makeId() {
  uid += 1;
  return Date.now().toString(36) + "-" + uid.toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}
function transact3(fn) {
  doc.transact(fn, LOCAL_ORIGIN);
}
function readShape(m) {
  const type = m.get("type");
  const points = m.get("points");
  return {
    id: m.get("id"),
    type,
    x: m.get("x") ?? 0,
    y: m.get("y") ?? 0,
    w: m.get("w") ?? 0,
    h: m.get("h") ?? 0,
    fill: m.get("fill") ?? COLORS.fill,
    stroke: m.get("stroke") ?? COLORS.stroke,
    strokeWidth: m.get("strokeWidth") ?? 2,
    text: m.get("text"),
    fontSize: m.get("fontSize") ?? (type === "sticky" ? STICKY_FONT : type === "rect" || type === "ellipse" ? SHAPE_FONT : TEXT_FONT),
    textColor: m.get("textColor"),
    alpha: m.get("alpha"),
    src: m.get("src"),
    locked: m.get("locked"),
    points: points instanceof Y6.Array ? points.toArray() : void 0
  };
}
function createShapeYMap(v) {
  const m = new Y6.Map();
  m.set("id", v.id);
  m.set("type", v.type);
  m.set("x", v.x);
  m.set("y", v.y);
  m.set("w", v.w);
  m.set("h", v.h);
  m.set("fill", v.fill);
  m.set("stroke", v.stroke);
  m.set("strokeWidth", v.strokeWidth);
  if (v.type === "sticky" || v.type === "text" || v.type === "rect" || v.type === "ellipse") {
    m.set("text", v.text ?? "");
    m.set(
      "fontSize",
      v.fontSize ?? (v.type === "sticky" ? STICKY_FONT : v.type === "rect" || v.type === "ellipse" ? SHAPE_FONT : TEXT_FONT)
    );
    if (v.textColor) m.set("textColor", v.textColor);
  }
  if (v.points) {
    const arr = new Y6.Array();
    arr.insert(0, v.points);
    m.set("points", arr);
  }
  if (v.alpha !== void 0) m.set("alpha", v.alpha);
  if (v.src) m.set("src", v.src);
  if (v.locked) m.set("locked", true);
  return m;
}
function addShape(v) {
  const id = v.id ?? makeId();
  const m = createShapeYMap({ ...v, id });
  transact3(() => {
    ensureOrder();
    board.set(id, m);
    order.push([id]);
  });
  return id;
}
function patchShapeInternal(id, patch) {
  const m = board.get(id);
  if (!m) return;
  for (const [key, value] of Object.entries(patch)) {
    if (value === void 0) continue;
    if (key === "points" && Array.isArray(value)) {
      const arr = new Y6.Array();
      arr.insert(0, value);
      m.set("points", arr);
    } else {
      m.set(key, value);
    }
  }
}
function patchShape(id, patch) {
  transact3(() => {
    patchShapeInternal(id, patch);
  });
}
function patchShapes(patches) {
  transact3(() => {
    for (const [id, patch] of patches) patchShapeInternal(id, patch);
  });
}
function removeShapes(ids) {
  if (!ids.length) return;
  transact3(() => {
    for (const id of ids) board.delete(id);
    for (const id of ids) {
      const idx = order.toArray().indexOf(id);
      if (idx >= 0) order.delete(idx, 1);
    }
  });
}

// src/core/settings.ts
var settings = {
  pen: {
    color: "#f2f5ff",
    size: 3,
    style: "marker"
  },
  shape: {
    fill: "#ffffff",
    stroke: "#7c8cff"
  },
  text: {
    color: "#f2f5ff",
    size: 18
  },
  eraser: {
    size: 32,
    mode: "whole"
  }
};
function effectivePen() {
  if (settings.pen.style === "highlighter") {
    return { color: settings.pen.color, width: settings.pen.size * 4, alpha: 0.3 };
  }
  return { color: settings.pen.color, width: settings.pen.size, alpha: 1 };
}

// src/engine/tools.ts
var Tool = class {
  cursor = "crosshair";
  onHover(_engine, _p) {
  }
  onDown(_engine, _p) {
  }
  onMove(_engine, _p) {
  }
  onUp(_engine, _p) {
  }
  cancel(_engine) {
  }
  render(_engine, _ctx) {
  }
};
var HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
var HANDLE_CURSORS = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize"
};
var SelectTool = class extends Tool {
  id = "select";
  cursor = "default";
  mode = "idle";
  resizing = null;
  start = { x: 0, y: 0 };
  moved = 0;
  originals = /* @__PURE__ */ new Map();
  marquee = null;
  onHover(engine, p) {
    if (this.mode !== "idle") return;
    const h = engine.hitHandle(p.screen.x, p.screen.y);
    if (h) {
      engine.setCursor(HANDLE_CURSORS[h.handle]);
      return;
    }
    engine.setCursor(engine.hitTest(p.world.x, p.world.y) ? "move" : "default");
  }
  onDown(engine, p) {
    this.start = p.world;
    this.moved = 0;
    this.mode = "idle";
    this.marquee = null;
    this.originals.clear();
    const h = engine.hitHandle(p.screen.x, p.screen.y);
    if (h) {
      this.resizing = h;
      const v = engine.views.get(h.shapeId);
      if (v) this.originals.set(h.shapeId, { ...v, points: v.points ? [...v.points] : void 0 });
      return;
    }
    const hit = engine.hitTest(p.world.x, p.world.y);
    if (hit) {
      if (p.shift && engine.selection.has(hit)) {
        engine.setSelection([...engine.selection].filter((id) => id !== hit));
      } else if (!p.shift && !engine.selection.has(hit)) {
        engine.setSelection([hit]);
      }
      for (const id of engine.selection) {
        const v = engine.views.get(id);
        if (v) this.originals.set(id, { ...v, points: v.points ? [...v.points] : void 0 });
      }
      if (engine.selection.has(hit) && !this.originals.get(hit)?.locked) this.mode = "move";
    } else {
      this.mode = "marquee";
      this.marquee = { x: p.world.x, y: p.world.y, w: 0, h: 0 };
    }
  }
  onMove(engine, p) {
    this.moved = Math.max(
      this.moved,
      Math.hypot(p.world.x - this.start.x, p.world.y - this.start.y) * engine.camera.zoom
    );
    if (this.mode === "move") {
      const dx = p.world.x - this.start.x;
      const dy = p.world.y - this.start.y;
      const patches = [];
      for (const [id, o] of this.originals) {
        if (o.locked) continue;
        if (o.points) {
          patches.push([id, { x: o.x + dx, y: o.y + dy, points: o.points.map((v, i) => i % 2 === 0 ? v + dx : v + dy) }]);
        } else {
          patches.push([id, { x: o.x + dx, y: o.y + dy }]);
        }
      }
      if (patches.length) patchShapes(patches);
    } else if (this.mode === "marquee" && this.marquee) {
      this.marquee = normalizeBox(this.start, p.world);
    } else if (this.resizing) {
      this.resize(engine, p);
    }
  }
  onUp(engine, p) {
    if (this.mode === "marquee" && this.marquee) {
      if (this.moved > 3) {
        const ids = [];
        for (const id of engine.grid.query(this.marquee)) {
          const v = engine.views.get(id);
          if (v && intersects(v, this.marquee)) ids.push(id);
        }
        engine.setSelection(p.shift ? [.../* @__PURE__ */ new Set([...engine.selection, ...ids])] : ids);
      } else if (!p.shift) {
        engine.setSelection([]);
      }
    }
    this.mode = "idle";
    this.resizing = null;
    this.marquee = null;
    this.originals.clear();
  }
  cancel(_engine) {
    this.mode = "idle";
    this.resizing = null;
    this.marquee = null;
    this.originals.clear();
  }
  render(engine, ctx) {
    if (!this.marquee) return;
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.fillStyle = "rgba(124, 140, 255, 0.12)";
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.rect(this.marquee.x, this.marquee.y, this.marquee.w, this.marquee.h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  resize(engine, p) {
    const r = this.resizing;
    if (!r) return;
    const orig = this.originals.get(r.shapeId);
    if (!orig || orig.locked) return;
    const dx = p.world.x - this.start.x;
    const dy = p.world.y - this.start.y;
    const MIN = 8 / engine.camera.zoom;
    let x = orig.x;
    let y = orig.y;
    let w = orig.w;
    let h = orig.h;
    if (r.handle.includes("e")) w = Math.max(MIN, orig.w + dx);
    if (r.handle.includes("w")) {
      w = Math.max(MIN, orig.w - dx);
      x = orig.x + orig.w - w;
    }
    if (r.handle.includes("s")) h = Math.max(MIN, orig.h + dy);
    if (r.handle.includes("n")) {
      h = Math.max(MIN, orig.h - dy);
      y = orig.y + orig.h - h;
    }
    if (orig.type === "image") {
      const corner = r.handle === "nw" || r.handle === "ne" || r.handle === "se" || r.handle === "sw";
      if (corner && orig.h > 0) {
        h = w / (orig.w / orig.h);
        if (r.handle.includes("n")) y = orig.y + orig.h - h;
      }
    }
    if (orig.points) {
      const sx = orig.w > 0 ? w / orig.w : 1;
      const sy = orig.h > 0 ? h / orig.h : 1;
      const points = [];
      for (let i = 0; i < orig.points.length; i += 2) {
        points.push(x + (orig.points[i] - orig.x) * sx, y + (orig.points[i + 1] - orig.y) * sy);
      }
      patchShape(r.shapeId, { x, y, w, h, points });
    } else {
      patchShape(r.shapeId, { x, y, w, h });
    }
  }
};
var PanTool = class extends Tool {
  id = "pan";
  cursor = "grab";
  last = null;
  onHover(engine) {
    engine.setCursor(this.last ? "grabbing" : "grab");
  }
  onDown(engine) {
    this.last = null;
    engine.camera.instant = true;
    engine.setCursor("grabbing");
  }
  onMove(engine, p) {
    if (this.last) engine.camera.panBy(p.screen.x - this.last.x, p.screen.y - this.last.y);
    this.last = { x: p.screen.x, y: p.screen.y };
  }
  onUp(engine) {
    this.last = null;
    engine.camera.instant = false;
    engine.setCursor("grab");
  }
  render() {
  }
};
var PenTool = class extends Tool {
  id = "pen";
  cursor = "crosshair";
  pts = [];
  last = null;
  active = false;
  shift = false;
  onDown(_engine, p) {
    this.pts = [p.world.x, p.world.y];
    this.last = p.world;
    this.active = true;
    this.shift = p.shift;
  }
  onMove(engine, p) {
    if (!this.active) return;
    this.shift = p.shift;
    if (this.shift) {
      this.last = p.world;
      return;
    }
    this.last = p.world;
    const n = this.pts.length;
    if (n >= 2 && Math.hypot(p.world.x - this.pts[n - 2], p.world.y - this.pts[n - 1]) < 2 / engine.camera.zoom) return;
    this.pts.push(p.world.x, p.world.y);
  }
  onUp(_engine) {
    if (!this.active) return;
    this.active = false;
    const shift = this.shift;
    this.shift = false;
    const points = shift ? this.straightPoints() : this.pts;
    if (points.length < 4) {
      this.pts = [];
      this.last = null;
      return;
    }
    const pen = effectivePen();
    const pad = pen.width / 2 + 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i]);
      maxX = Math.max(maxX, points[i]);
      minY = Math.min(minY, points[i + 1]);
      maxY = Math.max(maxY, points[i + 1]);
    }
    addShape({
      type: "pen",
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
      fill: "transparent",
      stroke: pen.color,
      strokeWidth: pen.width,
      alpha: pen.alpha,
      points
    });
    this.pts = [];
    this.last = null;
  }
  cancel(_engine) {
    this.active = false;
    this.pts = [];
    this.last = null;
  }
  render(_engine, ctx) {
    if (!this.active || this.pts.length < 2 || !this.last) return;
    const pen = effectivePen();
    const points = this.shift ? this.straightPoints() : this.pts;
    if (points.length < 2) return;
    drawPenStroke(ctx, points, pen.width, pen.color, pen.alpha * 0.9);
  }
  straightPoints() {
    const ax = this.pts[0];
    const ay = this.pts[1];
    const bx = this.last?.x ?? ax;
    const by = this.last?.y ?? ay;
    const end = snapStraightEnd(ax, ay, bx, by);
    return [ax, ay, end.x, end.y];
  }
};
function snapStraightEnd(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return { x: x1, y: y1 };
  const ang = Math.atan2(dy, dx);
  const rounded = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  if (Math.abs(ang - rounded) < 0.07) {
    return { x: x0 + Math.cos(rounded) * len, y: y0 + Math.sin(rounded) * len };
  }
  return { x: x1, y: y1 };
}
var BoxTool = class extends Tool {
  start = null;
  cur = null;
  movedScreen = 0;
  onDown(_engine, p) {
    this.start = p.world;
    this.cur = p.world;
    this.movedScreen = 0;
  }
  onMove(engine, p) {
    if (!this.start) return;
    this.movedScreen = Math.max(
      this.movedScreen,
      Math.hypot(p.world.x - this.start.x, p.world.y - this.start.y) * engine.camera.zoom
    );
    this.cur = p.world;
  }
  onUp(engine, p) {
    if (!this.start || !this.cur) return;
    let box;
    if (this.movedScreen < 3) {
      box = {
        x: p.world.x - this.defaultW / 2,
        y: p.world.y - this.defaultH / 2,
        w: this.defaultW,
        h: this.defaultH
      };
    } else {
      box = normalizeBox(this.start, this.cur);
      if (p.shift) {
        const s = Math.max(box.w, box.h);
        box.w = s;
        box.h = s;
      }
    }
    const id = addShape({
      type: this.shapeType,
      ...box,
      fill: settings.shape.fill,
      stroke: settings.shape.stroke,
      strokeWidth: 2
    });
    this.start = null;
    this.cur = null;
    if (this.shapeType === "sticky") engine.openTextEditor(id);
    engine.setTool("select");
  }
  cancel(_engine) {
    this.start = null;
    this.cur = null;
  }
  render(engine, ctx) {
    if (!this.start || !this.cur) return;
    const box = normalizeBox(this.start, this.cur);
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.fillStyle = settings.shape.fill + "22";
    ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath();
    if (this.shapeType === "ellipse") {
      ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.roundRect(box.x, box.y, box.w, box.h, 6);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
};
var RectTool = class extends BoxTool {
  id = "rect";
  shapeType = "rect";
  defaultW = 120;
  defaultH = 80;
};
var EllipseTool = class extends BoxTool {
  id = "ellipse";
  shapeType = "ellipse";
  defaultW = 120;
  defaultH = 80;
};
var StickyTool = class extends BoxTool {
  id = "sticky";
  shapeType = "sticky";
  defaultW = 180;
  defaultH = 120;
};
var ArrowTool = class extends Tool {
  id = "arrow";
  cursor = "crosshair";
  start = null;
  cur = null;
  shift = false;
  onDown(_engine, p) {
    this.start = p.world;
    this.cur = p.world;
    this.shift = p.shift;
  }
  onMove(_engine, p) {
    if (!this.start) return;
    this.cur = p.world;
    this.shift = p.shift;
  }
  onUp(engine, p) {
    if (!this.start || !this.cur) return;
    this.shift = p.shift;
    const end = this.snappedEnd();
    if (Math.hypot(end.x - this.start.x, end.y - this.start.y) < 3 / engine.camera.zoom) {
      this.start = null;
      this.cur = null;
      return;
    }
    const pad = 6;
    const minX = Math.min(this.start.x, end.x) - pad;
    const minY = Math.min(this.start.y, end.y) - pad;
    const maxX = Math.max(this.start.x, end.x) + pad;
    const maxY = Math.max(this.start.y, end.y) + pad;
    addShape({
      type: "arrow",
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      fill: "transparent",
      stroke: settings.shape.stroke,
      strokeWidth: 2,
      points: [this.start.x, this.start.y, end.x, end.y]
    });
    this.start = null;
    this.cur = null;
    engine.setTool("select");
  }
  cancel(_engine) {
    this.start = null;
    this.cur = null;
  }
  render(_engine, ctx) {
    if (!this.start || !this.cur) return;
    const end = this.snappedEnd();
    ctx.save();
    ctx.strokeStyle = settings.shape.stroke;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.start.x, this.start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    const angle = Math.atan2(end.y - this.start.y, end.x - this.start.x);
    const head = 10;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle - 0.42), end.y - head * Math.sin(angle - 0.42));
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle + 0.42), end.y - head * Math.sin(angle + 0.42));
    ctx.stroke();
    ctx.restore();
  }
  snappedEnd() {
    if (!this.start || !this.cur) return { x: 0, y: 0 };
    if (!this.shift) return this.cur;
    return snapStraightEnd(this.start.x, this.start.y, this.cur.x, this.cur.y);
  }
};
var TextTool = class extends Tool {
  id = "text";
  cursor = "text";
  onDown(engine, p) {
    engine.openTextEditorAt(p.world.x, p.world.y, settings.text.size, settings.text.color);
  }
};
function circleHitsShape(cx, cy, r, v) {
  if (pointInShape(v, cx, cy)) return true;
  const nx = Math.max(v.x, Math.min(cx, v.x + v.w));
  const ny = Math.max(v.y, Math.min(cy, v.y + v.h));
  return Math.hypot(cx - nx, cy - ny) <= r;
}
var EraserTool = class extends Tool {
  id = "eraser";
  cursor = "crosshair";
  active = false;
  pos = null;
  wholeHits = /* @__PURE__ */ new Set();
  partialHits = /* @__PURE__ */ new Map();
  onDown(engine, p) {
    this.active = true;
    this.pos = p.world;
    this.wholeHits.clear();
    this.partialHits.clear();
    this.eraseAt(engine, p.world);
  }
  onMove(engine, p) {
    if (!this.active) return;
    this.pos = p.world;
    this.eraseAt(engine, p.world);
  }
  onUp(engine) {
    this.active = false;
    this.pos = null;
    engine.commitErase();
    this.wholeHits.clear();
    this.partialHits.clear();
  }
  cancel(engine) {
    this.active = false;
    this.pos = null;
    this.wholeHits.clear();
    this.partialHits.clear();
    engine.setErasePreview(/* @__PURE__ */ new Set(), /* @__PURE__ */ new Map());
  }
  render(engine, ctx) {
    if (!this.pos || !this.active) return;
    const r = settings.eraser.size;
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2 * s;
    ctx.setLineDash([4 * s, 3 * s]);
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  eraseAt(engine, world) {
    const r = settings.eraser.size + 10;
    const partial = settings.eraser.mode === "partial";
    const box = { x: world.x - r, y: world.y - r, w: r * 2, h: r * 2 };
    for (const id of engine.grid.query(box)) {
      const v = engine.views.get(id);
      if (!v) continue;
      if (partial && v.type === "pen" && v.points) {
        let idx = this.partialHits.get(id);
        if (!idx) {
          idx = /* @__PURE__ */ new Set();
          this.partialHits.set(id, idx);
        }
        for (let i = 0; i < v.points.length; i += 2) {
          if (Math.hypot(v.points[i] - world.x, v.points[i + 1] - world.y) <= r) idx.add(i / 2);
        }
      } else if (!this.wholeHits.has(id) && circleHitsShape(world.x, world.y, r, v)) {
        this.wholeHits.add(id);
      }
    }
    engine.setErasePreview(this.wholeHits, this.partialHits);
  }
};
function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    if (yi > py !== yj > py && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
var LassoTool = class extends Tool {
  id = "lasso";
  cursor = "crosshair";
  pts = [];
  active = false;
  onDown(_engine, p) {
    this.pts = [{ x: p.world.x, y: p.world.y }];
    this.active = true;
  }
  onMove(engine, p) {
    if (!this.active) return;
    const last = this.pts[this.pts.length - 1];
    if (Math.hypot(p.world.x - last.x, p.world.y - last.y) < 2 / engine.camera.zoom) return;
    this.pts.push({ x: p.world.x, y: p.world.y });
  }
  onUp(engine) {
    if (!this.active) return;
    this.active = false;
    if (this.pts.length >= 3) {
      engine.setSelection(engine.selectByPolygon(this.pts));
    }
    this.pts = [];
    engine.setTool("select");
  }
  cancel(_engine) {
    this.active = false;
    this.pts = [];
  }
  render(engine, ctx) {
    if (!this.active || this.pts.length < 2) return;
    const s = 1 / engine.camera.zoom;
    ctx.save();
    ctx.fillStyle = "rgba(124, 140, 255, 0.12)";
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(this.pts[0].x, this.pts[0].y);
    for (let i = 1; i < this.pts.length; i++) ctx.lineTo(this.pts[i].x, this.pts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
};
var Tools = class {
  select = new SelectTool();
  lasso = new LassoTool();
  pan = new PanTool();
  pen = new PenTool();
  rect = new RectTool();
  ellipse = new EllipseTool();
  sticky = new StickyTool();
  text = new TextTool();
  arrow = new ArrowTool();
  eraser = new EraserTool();
  get(id) {
    return this[id];
  }
};

// src/engine/Engine.ts
var TOOL_KEYS = {
  KeyV: "select",
  KeyH: "pan",
  KeyP: "pen",
  KeyR: "rect",
  KeyO: "ellipse",
  KeyL: "arrow",
  KeyS: "sticky",
  KeyT: "text",
  KeyE: "eraser"
};
var HANDLE_POS = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5]
};
var Engine = class {
  camera = new Camera();
  grid = new Grid();
  tools = new Tools();
  views = /* @__PURE__ */ new Map();
  selection = /* @__PURE__ */ new Set();
  events = {};
  editing = false;
  active = "select";
  override = null;
  canvas;
  ctx;
  resizer;
  w = 0;
  h = 0;
  dpr = 1;
  rafId = 0;
  lastT = 0;
  lastCam = { x: 0, y: 0, z: 1 };
  dirty = true;
  pointerDown = false;
  panDrag = false;
  lastStats = "";
  dragTool;
  offImageLoad = () => {
  };
  erasing = /* @__PURE__ */ new Set();
  partialErase = /* @__PURE__ */ new Map();
  pointers = /* @__PURE__ */ new Map();
  gesture = null;
  crop = null;
  panStart = { x: 0, y: 0 };
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
    this.resizer = new ResizeObserver(this.resize);
    this.resizer.observe(canvas);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("dblclick", this.onDblClick);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("paste", this.onPaste);
    window.addEventListener("dragover", this.onDragOver);
    window.addEventListener("drop", this.onDrop);
    board.observe(this.onStore);
    meta.observe(this.onMeta);
    ensureOrder();
    this.offImageLoad = onImageLoad(() => {
      this.dirty = true;
    });
    for (const [key, m] of board) {
      const v = readShape(m);
      this.views.set(key, v);
      this.grid.upsert(key, v);
      this.attachShape(key, m);
    }
    this.dragTool = this.tool;
    this.rafId = requestAnimationFrame(this.loop);
  }
  destroy() {
    cancelAnimationFrame(this.rafId);
    this.resizer.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("dblclick", this.onDblClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("paste", this.onPaste);
    window.removeEventListener("dragover", this.onDragOver);
    window.removeEventListener("drop", this.onDrop);
    board.unobserve(this.onStore);
    meta.unobserve(this.onMeta);
    this.offImageLoad();
    for (const un of this.shapeObs.values()) un.un();
    this.shapeObs.clear();
  }
  get tool() {
    return this.tools.get(this.override ?? this.active);
  }
  setTool(id) {
    this.active = id;
    this.override = null;
    this.setCursor(this.tool.cursor);
    this.events.onTool?.(id);
    this.dirty = true;
  }
  setCursor(cursor) {
    this.canvas.style.cursor = cursor;
  }
  setDirty() {
    this.dirty = true;
  }
  setSelection(ids) {
    this.selection.clear();
    for (const id of ids) {
      if (this.views.has(id)) this.selection.add(id);
    }
    this.dirty = true;
    this.events.onSelection?.([...this.selection]);
  }
  hitTest(x, y) {
    const box = { x: x - 1, y: y - 1, w: 2, h: 2 };
    const candidates = this.grid.query(box);
    const ord = order;
    for (let i = ord.length - 1; i >= 0; i--) {
      const id = ord.get(i);
      if (!candidates.has(id)) continue;
      const v = this.views.get(id);
      if (v && pointInShape(v, x, y)) return id;
    }
    return null;
  }
  hitHandle(sx, sy) {
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      for (const handle of HANDLES) {
        const [fx, fy] = HANDLE_POS[handle];
        const hx = (v.x + fx * v.w) * z + ox;
        const hy = (v.y + fy * v.h) * z + oy;
        if (Math.abs(hx - sx) <= 8 && Math.abs(hy - sy) <= 8) {
          return { shapeId: id, handle };
        }
      }
    }
    return null;
  }
  worldToScreen(x, y) {
    const z = this.camera.zoom;
    return {
      x: (x - this.camera.x) * z + this.w / 2,
      y: (y - this.camera.y) * z + this.h / 2
    };
  }
  translateSelection(dx, dy) {
    if (!this.selection.size) return;
    const patches = [];
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.locked) continue;
      if (v.points) {
        patches.push([
          id,
          { x: v.x + dx, y: v.y + dy, points: v.points.map((val, i) => val + (i % 2 === 0 ? dx : dy)) }
        ]);
      } else {
        patches.push([id, { x: v.x + dx, y: v.y + dy }]);
      }
    }
    patchShapes(patches);
  }
  deleteSelection() {
    if (!this.selection.size) return;
    removeShapes([...this.selection]);
  }
  clipboard = [];
  pasteN = 0;
  copySelection() {
    this.clipboard = [];
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (v) this.clipboard.push(structuredClone(v));
    }
    this.pasteN = 0;
  }
  cutSelection() {
    this.copySelection();
    this.deleteSelection();
  }
  pasteSelection() {
    if (!this.clipboard.length) return;
    this.pasteN += 1;
    const off = 40 / this.camera.zoom * this.pasteN;
    const ids = [];
    for (const v of this.clipboard) {
      ids.push(
        addShape({
          ...v,
          id: void 0,
          x: v.x + off,
          y: v.y + off,
          points: v.points ? v.points.map((p) => p + off) : void 0
        })
      );
    }
    this.setSelection(ids);
    this.setTool("select");
  }
  duplicateSelection() {
    if (!this.selection.size) return;
    const off = 40 / this.camera.zoom;
    const ids = [];
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v) continue;
      ids.push(
        addShape({
          ...v,
          id: void 0,
          x: v.x + off,
          y: v.y + off,
          points: v.points ? v.points.map((p) => p + off) : void 0
        })
      );
    }
    this.setSelection(ids);
    this.setTool("select");
  }
  bringFront() {
    if (!this.selection.size) return;
    moveOrderToFront([...this.selection]);
  }
  sendBack() {
    if (!this.selection.size) return;
    moveOrderToBack([...this.selection]);
  }
  toggleLockSelection() {
    if (!this.selection.size) return;
    let anyUnlocked = false;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (v && !v.locked) anyUnlocked = true;
    }
    const locked = !anyUnlocked;
    const patches = [];
    for (const id of this.selection) patches.push([id, { locked }]);
    patchShapes(patches);
  }
  selectionCanvas(ids) {
    let box = null;
    for (const id of ids) {
      const v = this.views.get(id);
      if (!v) continue;
      box = box ? {
        x: Math.min(box.x, v.x),
        y: Math.min(box.y, v.y),
        w: Math.max(box.x + box.w, v.x + v.w) - Math.min(box.x, v.x),
        h: Math.max(box.y + box.h, v.y + v.h) - Math.min(box.y, v.y)
      } : { x: v.x, y: v.y, w: v.w, h: v.h };
    }
    if (!box) return null;
    const pad = 8;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.w + pad * 2));
    canvas.height = Math.max(1, Math.round(box.h + pad * 2));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.translate(-box.x + pad, -box.y + pad);
    const theme = themeFor(metaBg());
    for (const id of ids) {
      const v = this.views.get(id);
      if (v) drawShape(ctx, v, theme.text);
    }
    return canvas;
  }
  async copyAsImage(ids) {
    let dataUrl = null;
    if (ids.length === 1) {
      const v = this.views.get(ids[0]);
      if (v && v.type === "image" && v.src) dataUrl = v.src;
    }
    if (!dataUrl) {
      const canvas = this.selectionCanvas(ids);
      if (canvas) dataUrl = canvas.toDataURL("image/png");
    }
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "doska.png";
      a.click();
    }
  }
  copySelectionAsImage() {
    if (!this.selection.size) return;
    void this.copyAsImage([...this.selection]);
  }
  downloadSelection() {
    if (!this.selection.size) return;
    const ids = [...this.selection];
    const v = this.views.get(ids[0]);
    if (ids.length === 1 && v?.type === "image" && v.src) {
      const a2 = document.createElement("a");
      a2.href = v.src;
      a2.download = "doska-image.png";
      a2.click();
      return;
    }
    const canvas = this.selectionCanvas(ids);
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "doska.png";
    a.click();
  }
  scaleSelectionToOriginal() {
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v || v.type !== "image") continue;
      const img = getImage(v.src ?? "");
      if (!img || !img.complete || !img.naturalWidth) continue;
      const cx = v.x + v.w / 2;
      const cy = v.y + v.h / 2;
      patchShape(id, {
        x: cx - img.naturalWidth / 2,
        y: cy - img.naturalHeight / 2,
        w: img.naturalWidth,
        h: img.naturalHeight
      });
    }
  }
  exportCsvSelection() {
    if (this.selection.size !== 1) return;
    const v = this.views.get([...this.selection][0]);
    const pts = v?.points;
    if (!v || !pts) return;
    const rows = ["x,y"];
    for (let i = 0; i < pts.length; i += 2) rows.push(`${pts[i]},${pts[i + 1]}`);
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "doska-stroke.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  shapeInfo(id) {
    const v = this.views.get(id);
    if (!v) return null;
    const typeNames = {
      rect: "\u041F\u0440\u044F\u043C\u043E\u0443\u0433\u043E\u043B\u044C\u043D\u0438\u043A",
      ellipse: "\u042D\u043B\u043B\u0438\u043F\u0441",
      sticky: "\u0421\u0442\u0438\u043A\u0435\u0440",
      text: "\u0422\u0435\u043A\u0441\u0442",
      pen: "\u041B\u0438\u043D\u0438\u044F",
      arrow: "\u0421\u0442\u0440\u0435\u043B\u043A\u0430",
      image: "\u041A\u0430\u0440\u0442\u0438\u043D\u043A\u0430"
    };
    const lines = [
      `\u0420\u0430\u0437\u043C\u0435\u0440: ${Math.round(v.w)} \xD7 ${Math.round(v.h)}`,
      `\u041F\u043E\u0437\u0438\u0446\u0438\u044F: ${Math.round(v.x)}, ${Math.round(v.y)}`
    ];
    if (v.points) lines.push(`\u0422\u043E\u0447\u0435\u043A: ${v.points.length / 2}`);
    if (v.type === "image") {
      const img = getImage(v.src ?? "");
      if (img && img.complete && img.naturalWidth) {
        lines.push(`\u041F\u0438\u043A\u0441\u0435\u043B\u0438: ${img.naturalWidth} \xD7 ${img.naturalHeight}`);
      }
    }
    if (v.locked) lines.push("\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E");
    return { title: typeNames[v.type] ?? v.type, lines };
  }
  zoomBy(factor) {
    this.camera.zoomAt(this.w / 2, this.h / 2, this.w / 2, this.h / 2, factor);
  }
  insertImageFile(file, at) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onload = () => {
        const max2 = 600;
        const scale = Math.min(1, max2 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, img.naturalWidth * scale);
        const h = Math.max(1, img.naturalHeight * scale);
        const pos = at ?? this.camera.screenToWorld(this.w / 2, this.h / 2, this.w / 2, this.h / 2);
        const id = addShape({
          type: "image",
          x: pos.x - w / 2,
          y: pos.y - h / 2,
          w,
          h,
          fill: "transparent",
          stroke: "transparent",
          strokeWidth: 0,
          src
        });
        this.setSelection([id]);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }
  hasImageSelection() {
    return this.selection.size === 1 && this.views.get([...this.selection][0])?.type === "image";
  }
  startCropSelected() {
    if (this.selection.size !== 1) return;
    const id = [...this.selection][0];
    const v = this.views.get(id);
    if (!v || v.type !== "image") return;
    this.crop = {
      id,
      box: { x: v.x, y: v.y, w: v.w, h: v.h },
      mode: "idle",
      start: { x: 0, y: 0 },
      origBox: { x: v.x, y: v.y, w: v.w, h: v.h }
    };
    this.events.onCrop?.(true);
    this.dirty = true;
  }
  cancelCrop() {
    this.crop = null;
    this.events.onCrop?.(false);
    this.dirty = true;
  }
  applyCrop() {
    const c = this.crop;
    if (!c) return;
    const v = this.views.get(c.id);
    if (!v) return;
    const img = getImage(v.src ?? "");
    if (!img || !img.complete || !img.naturalWidth) return;
    const sx = (c.box.x - v.x) / v.w * img.naturalWidth;
    const sy = (c.box.y - v.y) / v.h * img.naturalHeight;
    const sw = c.box.w / v.w * img.naturalWidth;
    const sh = c.box.h / v.h * img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw));
    canvas.height = Math.max(1, Math.round(sh));
    const cctx = canvas.getContext("2d");
    if (!cctx) return;
    cctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/png");
    patchShape(c.id, { src: url, x: c.box.x, y: c.box.y, w: c.box.w, h: c.box.h });
    this.crop = null;
    this.events.onCrop?.(false);
    this.dirty = true;
  }
  onPaste = (e) => {
    if (this.editing) return;
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            this.insertImageFile(file);
            return;
          }
        }
      }
    }
    e.preventDefault();
    this.pasteSelection();
  };
  onDragOver = (e) => {
    e.preventDefault();
  };
  onDrop = (e) => {
    e.preventDefault();
    if (this.editing) return;
    const rect = this.canvas.getBoundingClientRect();
    const at = this.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top, this.w / 2, this.h / 2);
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith("image/")) this.insertImageFile(file, at);
    }
  };
  resetZoom() {
    this.camera.setZoom(1);
  }
  fitContent() {
    let box = null;
    for (const v of this.views.values()) {
      box = box ? {
        x: Math.min(box.x, v.x),
        y: Math.min(box.y, v.y),
        w: Math.max(box.x + box.w, v.x + v.w) - Math.min(box.x, v.x),
        h: Math.max(box.y + box.h, v.y + v.h) - Math.min(box.y, v.y)
      } : { x: v.x, y: v.y, w: v.w, h: v.h };
    }
    const target = box ?? { x: -600, y: -400, w: 1200, h: 800 };
    this.camera.fitView(
      { x: target.x - 60, y: target.y - 60, w: target.w + 120, h: target.h + 120 },
      this.w,
      this.h,
      80
    );
    this.dirty = true;
  }
  openTextEditor(id) {
    const v = this.views.get(id);
    if (!v || v.type === "pen" || v.type === "arrow") return;
    this.editing = true;
    this.events.onEditText?.({
      id,
      x: v.x,
      y: v.y,
      w: v.w,
      h: v.h,
      text: v.text ?? "",
      fontSize: v.fontSize ?? (v.type === "sticky" ? STICKY_FONT : v.type === "rect" || v.type === "ellipse" ? SHAPE_FONT : TEXT_FONT),
      color: v.textColor ?? themeFor(metaBg()).text
    });
  }
  openTextEditorAt(x, y, fontSize, color) {
    this.editing = true;
    this.events.onEditText?.({ id: null, x, y, w: 240, h: 30, text: "", fontSize, color });
  }
  cancelTextEdit() {
    this.editing = false;
  }
  commitText(id, text, target) {
    this.editing = false;
    if (id === null) {
      const trimmed = text.trim();
      if (!trimmed) return;
      const newId = addShape({
        type: "text",
        x: target.x,
        y: target.y,
        w: 0,
        h: 0,
        fill: "transparent",
        stroke: "transparent",
        strokeWidth: 0,
        text: trimmed,
        fontSize: target.fontSize,
        textColor: target.color
      });
      const size2 = this.measureText(trimmed, target.fontSize);
      patchShape(newId, { w: size2.w, h: size2.h });
      this.setSelection([]);
      this.setTool("select");
    } else {
      const v = this.views.get(id);
      if (!v) return;
      if (!text.trim() && v.type === "text") {
        removeShapes([id]);
        this.setSelection([]);
        return;
      }
      const patch = { text };
      if (v.type === "text") {
        const size2 = this.measureText(text, v.fontSize ?? TEXT_FONT);
        patch.w = size2.w;
        patch.h = size2.h;
      }
      if (v.type !== "sticky") patch.textColor = target.color;
      patchShape(id, patch);
    }
    this.dirty = true;
  }
  measureText(text, fontSize) {
    this.ctx.font = `${fontSize}px 'Segoe UI', system-ui, sans-serif`;
    const lines = text.split("\n");
    let maxW = 0;
    for (const line of lines) {
      maxW = Math.max(maxW, this.ctx.measureText(line).width);
    }
    return { w: maxW + 4, h: lines.length * fontSize * 1.3 };
  }
  onMeta = () => {
    this.dirty = true;
  };
  onStore = (ev) => {
    ev.changes.keys.forEach((change, key) => {
      if (change.action === "delete") {
        this.detachShape(key);
        this.views.delete(key);
        this.grid.remove(key);
        if (this.selection.delete(key)) this.events.onSelection?.([...this.selection]);
      } else {
        const m = board.get(key);
        if (m) {
          const v = readShape(m);
          this.views.set(key, v);
          this.grid.upsert(key, v);
          this.attachShape(key, m);
        }
      }
    });
    this.dirty = true;
  };
  shapeObs = /* @__PURE__ */ new Map();
  attachShape(key, m) {
    const existing = this.shapeObs.get(key);
    if (existing && existing.m === m) return;
    this.detachShape(key);
    const cb = () => {
      const v = readShape(m);
      this.views.set(key, v);
      this.grid.upsert(key, v);
      this.dirty = true;
    };
    m.observe(cb);
    this.shapeObs.set(key, { un: () => m.unobserve(cb), m });
  }
  detachShape(key) {
    const existing = this.shapeObs.get(key);
    if (existing) {
      existing.un();
      this.shapeObs.delete(key);
    }
  }
  resize = () => {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.dirty = true;
  };
  pointerInfo(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      screen: { x: sx, y: sy },
      world: this.camera.screenToWorld(sx, sy, this.w / 2, this.h / 2),
      shift: e.shiftKey
    };
  }
  onPointerDown = (e) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      this.cancelToolDrag();
      this.pointerDown = false;
      this.updateGesture();
      return;
    }
    this.pointerDown = true;
    if (this.crop) {
      this.cropPointerDown(e);
      return;
    }
    if (e.button === 1 || e.button === 2) {
      this.panDrag = true;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.camera.instant = true;
      this.setCursor("grabbing");
      e.preventDefault();
      return;
    }
    if (this.editing) return;
    try {
      const info = this.pointerInfo(e);
      let target = this.tool;
      if (target.id !== "select" && target.id !== "pan" && target.id !== "pen" && target.id !== "eraser") {
        if (this.hitTest(info.world.x, info.world.y)) target = this.tools.select;
      }
      this.dragTool = target;
      target.onDown(this, info);
    } catch (err) {
      console.error("[doska] pointerdown error:", err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.dirty = true;
  };
  onPointerMove = (e) => {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (this.pointers.size >= 2 && this.gesture) {
      this.updateGesture();
      return;
    }
    if (this.crop) {
      this.cropPointerMove(e);
      return;
    }
    if (this.panDrag) {
      this.camera.panBy(e.movementX, e.movementY);
      return;
    }
    if (this.editing) return;
    try {
      const p2 = this.pointerInfo(e);
      if (this.pointerDown) this.dragTool.onMove(this, p2);
      else this.tool.onHover(this, p2);
    } catch (err) {
      console.error("[doska] pointermove error:", err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.dirty = true;
  };
  onPointerUp = (e) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    this.pointerDown = false;
    if (this.crop) {
      this.cropPointerUp();
      return;
    }
    if (this.panDrag) {
      this.panDrag = false;
      this.camera.instant = false;
      this.setCursor(this.tool.cursor);
      if (e.button === 2 && Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) < 5 && !this.editing) {
        this.openContextMenu(e);
      }
      return;
    }
    if (this.editing) return;
    try {
      this.dragTool.onUp(this, this.pointerInfo(e));
    } catch (err) {
      console.error("[doska] pointerup error:", err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.dirty = true;
  };
  onWheel = (e) => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    this.camera.zoomAt(sx, sy, this.w / 2, this.h / 2, Math.exp(-e.deltaY * 22e-4));
    this.dirty = true;
  };
  onDblClick = (e) => {
    if (this.editing) return;
    const p = this.pointerInfo(e);
    const id = this.hitTest(p.world.x, p.world.y);
    if (id) {
      this.openTextEditor(id);
      return;
    }
    this.openTextEditorAt(p.world.x, p.world.y, settings.text.size, settings.text.color);
  };
  cancelToolDrag() {
    this.dragTool.cancel(this);
  }
  updateGesture() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rect = this.canvas.getBoundingClientRect();
    const mx = mid.x - rect.left;
    const my = mid.y - rect.top;
    if (this.gesture) {
      if (this.gesture.dist > 1 && dist > 1) {
        this.camera.zoomAt(mx, my, this.w / 2, this.h / 2, dist / this.gesture.dist);
      }
      this.camera.panBy(mid.x - this.gesture.mid.x, mid.y - this.gesture.mid.y);
    }
    this.gesture = { dist, mid };
    this.dirty = true;
  }
  setErasePreview(whole, partial) {
    this.erasing = whole;
    this.partialErase = partial;
    this.dirty = true;
  }
  commitErase() {
    if (settings.eraser.mode === "partial") this.applyPartialErase();
    else if (this.erasing.size) removeShapes([...this.erasing]);
    this.erasing = /* @__PURE__ */ new Set();
    this.partialErase = /* @__PURE__ */ new Map();
    this.dirty = true;
  }
  applyPartialErase() {
    if (!this.partialErase.size && !this.erasing.size) return;
    transact3(() => {
      for (const id of this.erasing) {
        if (board.has(id)) removeShapes([id]);
      }
      for (const [id, indices] of this.partialErase) {
        const m = board.get(id);
        if (!m) continue;
        const v = readShape(m);
        const pts = v.points ?? [];
        if (pts.length < 4) {
          removeShapes([id]);
          continue;
        }
        const segments = [];
        let cur = [];
        for (let i = 0; i < pts.length; i += 2) {
          if (indices.has(i / 2)) {
            if (cur.length >= 4) segments.push(cur);
            cur = [];
          } else {
            cur.push(pts[i], pts[i + 1]);
          }
        }
        if (cur.length >= 4) segments.push(cur);
        if (!segments.length) {
          removeShapes([id]);
          continue;
        }
        const style = {
          fill: "transparent",
          stroke: v.stroke,
          strokeWidth: v.strokeWidth,
          alpha: v.alpha
        };
        patchShape(id, { points: segments[0], ...this.penBox(segments[0], v.strokeWidth) });
        for (let s = 1; s < segments.length; s++) {
          addShape({
            type: "pen",
            ...style,
            points: segments[s],
            ...this.penBox(segments[s], v.strokeWidth)
          });
        }
      }
    });
  }
  penBox(points, width) {
    const pad = width / 2 + 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i]);
      maxX = Math.max(maxX, points[i]);
      minY = Math.min(minY, points[i + 1]);
      maxY = Math.max(maxY, points[i + 1]);
    }
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  selectByPolygon(pts) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const ids = [];
    for (const id of this.grid.query({ x: minX, y: minY, w: maxX - minX, h: maxY - minY })) {
      const v = this.views.get(id);
      if (v && pointInPolygon(v.x + v.w / 2, v.y + v.h / 2, pts)) ids.push(id);
    }
    return ids;
  }
  cropPointerDown(e) {
    const c = this.crop;
    if (!c) return;
    const p = this.pointerInfo(e);
    const h = this.cropHitHandle(p.screen.x, p.screen.y);
    if (h) {
      c.mode = h;
    } else if (p.world.x >= c.box.x && p.world.x <= c.box.x + c.box.w && p.world.y >= c.box.y && p.world.y <= c.box.y + c.box.h) {
      c.mode = "move";
    } else {
      return;
    }
    c.start = p.world;
    c.origBox = { ...c.box };
    this.dirty = true;
  }
  cropPointerMove(e) {
    const c = this.crop;
    if (!c || c.mode === "idle") return;
    const v = this.views.get(c.id);
    if (!v) return;
    const p = this.pointerInfo(e);
    const minX = v.x;
    const minY = v.y;
    const maxX = v.x + v.w;
    const maxY = v.y + v.h;
    const minSize = 8 / this.camera.zoom;
    if (c.mode === "move") {
      const dx = p.world.x - c.start.x;
      const dy = p.world.y - c.start.y;
      let x = c.origBox.x + dx;
      let y = c.origBox.y + dy;
      x = Math.max(minX, Math.min(x, maxX - c.origBox.w));
      y = Math.max(minY, Math.min(y, maxY - c.origBox.h));
      c.box = { x, y, w: c.origBox.w, h: c.origBox.h };
    } else {
      const dx = p.world.x - c.start.x;
      const dy = p.world.y - c.start.y;
      let x = c.origBox.x;
      let y = c.origBox.y;
      let w = c.origBox.w;
      let h = c.origBox.h;
      if (c.mode.includes("e")) w = Math.max(minSize, Math.min(c.origBox.w + dx, maxX - x));
      if (c.mode.includes("w")) {
        w = Math.max(minSize, Math.min(c.origBox.w - dx, maxX - minX));
        x = Math.min(c.origBox.x + c.origBox.w - minSize, c.origBox.x + c.origBox.w - w);
      }
      if (c.mode.includes("s")) h = Math.max(minSize, Math.min(c.origBox.h + dy, maxY - y));
      if (c.mode.includes("n")) {
        h = Math.max(minSize, Math.min(c.origBox.h - dy, maxY - minY));
        y = Math.min(c.origBox.y + c.origBox.h - minSize, c.origBox.y + c.origBox.h - h);
      }
      if (x < minX) {
        w = Math.max(minSize, w - (minX - x));
        x = minX;
      }
      if (y < minY) {
        h = Math.max(minSize, h - (minY - y));
        y = minY;
      }
      c.box = { x, y, w, h };
    }
    this.dirty = true;
  }
  cropPointerUp() {
    const c = this.crop;
    if (c) c.mode = "idle";
    this.dirty = true;
  }
  cropHitHandle(sx, sy) {
    const c = this.crop;
    if (!c) return null;
    const z = this.camera.zoom;
    const ox = this.w / 2 - this.camera.x * z;
    const oy = this.h / 2 - this.camera.y * z;
    for (const handle of HANDLES) {
      const [fx, fy] = HANDLE_POS[handle];
      const hx = (c.box.x + fx * c.box.w) * z + ox;
      const hy = (c.box.y + fy * c.box.h) * z + oy;
      if (Math.abs(hx - sx) <= 8 && Math.abs(hy - sy) <= 8) return handle;
    }
    return null;
  }
  drawCropOverlay(ctx) {
    const c = this.crop;
    if (!c) return;
    const v = this.views.get(c.id);
    if (!v) return;
    const s = 1 / this.camera.zoom;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(v.x, v.y, v.w, c.box.y - v.y);
    ctx.fillRect(v.x, c.box.y + c.box.h, v.w, v.y + v.h - c.box.y - c.box.h);
    ctx.fillRect(v.x, c.box.y, c.box.x - v.x, c.box.h);
    ctx.fillRect(c.box.x + c.box.w, c.box.y, v.x + v.w - c.box.x - c.box.w, c.box.h);
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2 * s;
    ctx.strokeRect(c.box.x, c.box.y, c.box.w, c.box.h);
    ctx.fillStyle = COLORS.selection;
    for (const [fx, fy] of Object.values(HANDLE_POS)) {
      ctx.fillRect(c.box.x + fx * c.box.w - 4.5 * s, c.box.y + fy * c.box.h - 4.5 * s, 9 * s, 9 * s);
    }
    ctx.restore();
  }
  onContextMenu = (e) => {
    e.preventDefault();
  };
  openContextMenu(e) {
    const p = this.pointerInfo(e);
    const id = this.hitTest(p.world.x, p.world.y);
    const sp = this.worldToScreen(p.world.x, p.world.y);
    if (id) {
      this.setSelection([id]);
      const v = this.views.get(id);
      this.events.onContextMenu?.({
        x: sp.x,
        y: sp.y,
        shapeId: id,
        type: v?.type ?? null,
        locked: v?.locked ?? false
      });
    } else {
      this.events.onContextMenu?.({ x: sp.x, y: sp.y, shapeId: null, type: null, locked: false });
    }
  }
  onKeyDown = (e) => {
    if (this.crop) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.cancelCrop();
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.applyCrop();
      }
      return;
    }
    if (this.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === " ") {
      e.preventDefault();
      if (!this.override) {
        this.override = "pan";
        this.setCursor(this.tool.cursor);
      }
      return;
    }
    if (e.key === "Escape") {
      this.setSelection([]);
      return;
    }
    if (mod && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) undoManager.redo();
      else undoManager.undo();
      return;
    }
    if (mod && e.code === "KeyY") {
      e.preventDefault();
      undoManager.redo();
      return;
    }
    if (mod && e.code === "KeyA") {
      e.preventDefault();
      this.setSelection([...this.views.keys()]);
      return;
    }
    if (mod && e.code === "KeyC") {
      e.preventDefault();
      if (e.shiftKey) this.copySelectionAsImage();
      else this.copySelection();
      return;
    }
    if (mod && e.shiftKey && e.code === "KeyL") {
      e.preventDefault();
      this.toggleLockSelection();
      return;
    }
    if (mod && e.code === "KeyX") {
      e.preventDefault();
      this.cutSelection();
      return;
    }
    if (mod && e.code === "KeyD") {
      e.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (mod && (e.code === "Equal" || e.code === "NumpadAdd")) {
      e.preventDefault();
      this.zoomBy(1.2);
      return;
    }
    if (mod && (e.code === "Minus" || e.code === "NumpadSubtract")) {
      e.preventDefault();
      this.zoomBy(1 / 1.2);
      return;
    }
    if (mod && (e.code === "Digit0" || e.code === "Numpad0")) {
      e.preventDefault();
      this.resetZoom();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.selection.size) {
        e.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    if (e.key === "Enter" && this.selection.size === 1) {
      this.openTextEditor([...this.selection][0]);
      return;
    }
    if (e.key.startsWith("Arrow") && this.selection.size) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      this.translateSelection(dx, dy);
      return;
    }
    if (!mod && !e.altKey && e.code.startsWith("Key")) {
      const t = TOOL_KEYS[e.code];
      if (t) this.setTool(t);
    }
  };
  onKeyUp = (e) => {
    if (e.key === " " && this.override === "pan") {
      this.override = null;
      this.setCursor(this.tool.cursor);
    }
  };
  loop = (t) => {
    try {
      const dt = Math.min((t - this.lastT) / 1e3 || 0.016, 0.05);
      this.lastT = t;
      this.camera.update(dt);
      const moved = Math.abs(this.camera.x - this.lastCam.x) > 5e-4 || Math.abs(this.camera.y - this.lastCam.y) > 5e-4 || Math.abs(this.camera.zoom - this.lastCam.z) > 1e-5;
      if (moved || this.dirty) this.render();
      this.emitStats();
    } catch (err) {
      console.error("[doska] render loop error:", err);
      this.events.onError?.(err instanceof Error ? err.message : String(err));
    }
    this.rafId = requestAnimationFrame(this.loop);
  };
  render() {
    if (order.length !== this.views.size) ensureOrder();
    const { ctx, dpr, w, h } = this;
    const { x: cx, y: cy, zoom: z } = this.camera;
    const bg = metaBg();
    const theme = themeFor(bg);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-cx, -cy);
    if (metaGrid()) this.drawGrid(ctx, theme.grid);
    const vis = { x: cx - w / 2 / z, y: cy - h / 2 / z, w: w / z, h: h / z };
    const visible = this.grid.query(vis);
    const draw = (v) => {
      const partial = this.partialErase.get(v.id);
      if (partial && partial.size) {
        const pts = v.points ?? [];
        const filtered = [];
        for (let i = 0; i < pts.length; i += 2) {
          if (!partial.has(i / 2)) filtered.push(pts[i], pts[i + 1]);
        }
        if (filtered.length >= 2) drawPenStroke(ctx, filtered, v.strokeWidth, v.stroke, v.alpha ?? 1);
        return;
      }
      if (this.erasing.has(v.id)) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        drawShape(ctx, v, theme.text);
        ctx.restore();
      } else {
        drawShape(ctx, v, theme.text);
      }
    };
    const ord = order;
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!visible.has(id)) continue;
      const v = this.views.get(id);
      if (v && v.alpha !== void 0 && v.alpha < 1) draw(v);
    }
    for (let i = 0; i < ord.length; i++) {
      const id = ord.get(i);
      if (!visible.has(id)) continue;
      const v = this.views.get(id);
      if (v && (v.alpha === void 0 || v.alpha >= 1)) draw(v);
    }
    this.drawSelection(ctx);
    this.tool.render(this, ctx);
    if (this.crop) this.drawCropOverlay(ctx);
    ctx.restore();
    this.lastCam = { x: cx, y: cy, z };
    this.dirty = false;
  }
  drawGrid(ctx, color) {
    const { x: cx, y: cy, zoom: z } = this.camera;
    const w = this.w / z;
    const h = this.h / z;
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;
    let step = 50;
    while (step * z < 48) step *= 5;
    while (step * z > 240) step /= 5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    for (let x = Math.floor(x0 / step) * step; x <= x0 + w; x += step) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + h);
    }
    for (let y = Math.floor(y0 / step) * step; y <= y0 + h; y += step) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + w, y);
    }
    ctx.stroke();
  }
  drawSelection(ctx) {
    if (this.editing) return;
    if (this.active !== "select" && this.override !== "select") return;
    const s = 1 / this.camera.zoom;
    ctx.save();
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 2 * s;
    for (const id of this.selection) {
      const v = this.views.get(id);
      if (!v) continue;
      ctx.strokeRect(v.x - 4 * s, v.y - 4 * s, v.w + 8 * s, v.h + 8 * s);
      if (this.selection.size === 1) {
        ctx.fillStyle = COLORS.selection;
        for (const [fx, fy] of Object.values(HANDLE_POS)) {
          ctx.fillRect(v.x + fx * v.w - 4.5 * s, v.y + fy * v.h - 4.5 * s, 9 * s, 9 * s);
        }
      }
    }
    ctx.restore();
  }
  emitStats() {
    const z = Math.round(this.camera.zoom * 100);
    const n = this.views.size;
    const key = z + ":" + n;
    if (key !== this.lastStats) {
      this.lastStats = key;
      this.events.onStats?.({ zoom: this.camera.zoom, shapes: n });
    }
  }
};
export {
  Engine,
  settings,
  store_exports as store
};
