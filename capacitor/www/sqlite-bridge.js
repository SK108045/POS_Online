(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // swifta-contract.js
  var require_swifta_contract = __commonJS({
    "swifta-contract.js"(exports, module) {
      function validate(payload) {
        let phone = String(payload.phone || "").replace(/\D/g, "");
        if (/^254[17]\d{8}$/.test(phone)) phone = "0" + phone.slice(3);
        if (/^[17]\d{8}$/.test(phone)) phone = "0" + phone;
        if (!/^0[17]\d{8}$/.test(phone)) throw new Error("Enter a valid Kenyan mobile number.");
        if (typeof payload.amount !== "number" || !Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error("Payment amount must be greater than zero.");
        if (!String(payload.accountReference || "").trim()) throw new Error("Payment reference is required.");
        return { phone, amount: payload.amount, accountReference: String(payload.accountReference).trim(), description: String(payload.description || "POS payment") };
      }
      function normalize(result) {
        if (!result || typeof result !== "object" || Array.isArray(result)) return { status: false, message: "Swifta returned an unreadable response. Check payment status before retrying." };
        const data = result.data && typeof result.data === "object" ? result.data : result;
        const mpesa = data.mpesaResponse && typeof data.mpesaResponse === "object" ? data.mpesaResponse : result.mpesaResponse && typeof result.mpesaResponse === "object" ? result.mpesaResponse : {};
        const meta = data.meta && typeof data.meta === "object" ? data.meta : result.meta && typeof result.meta === "object" ? result.meta : {};
        const code = mpesa.ResponseCode ?? mpesa.responseCode ?? data.ResponseCode ?? data.responseCode ?? result.ResponseCode ?? result.responseCode;
        const failed = result.success === false || result.status === false || data.success === false || data.status === false || code != null && String(code) !== "0";
        const accepted = !failed && (String(code) === "0" || result.success === true || result.status === true || ["success", "accepted", "pending"].includes(String(result.status).toLowerCase()));
        const message = data.errorMessage || result.errorMessage || result.error || data.ResponseDescription || result.message || data.message || data.CustomerMessage;
        return { status: accepted, message: typeof message === "string" ? message : accepted ? "STK request accepted" : "Could not confirm STK acceptance. Check Swifta before retrying.", data: { status: accepted ? "pay_offline" : "failed", reference: mpesa.CheckoutRequestID || mpesa.checkoutRequestId || meta.checkoutRequestId || data.CheckoutRequestID || data.checkoutRequestId || data.checkout_request_id || data.reference || result.reference || "" } };
      }
      module.exports = { validate, normalize };
    }
  });

  // node_modules/@capacitor/core/dist/index.js
  var createCapacitorPlatforms, initPlatforms, CapacitorPlatforms, addPlatform, setPlatform, ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, Plugins, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp;
  var init_dist = __esm({
    "node_modules/@capacitor/core/dist/index.js"() {
      createCapacitorPlatforms = (win) => {
        const defaultPlatformMap = /* @__PURE__ */ new Map();
        defaultPlatformMap.set("web", { name: "web" });
        const capPlatforms = win.CapacitorPlatforms || {
          currentPlatform: { name: "web" },
          platforms: defaultPlatformMap
        };
        const addPlatform2 = (name, platform) => {
          capPlatforms.platforms.set(name, platform);
        };
        const setPlatform2 = (name) => {
          if (capPlatforms.platforms.has(name)) {
            capPlatforms.currentPlatform = capPlatforms.platforms.get(name);
          }
        };
        capPlatforms.addPlatform = addPlatform2;
        capPlatforms.setPlatform = setPlatform2;
        return capPlatforms;
      };
      initPlatforms = (win) => win.CapacitorPlatforms = createCapacitorPlatforms(win);
      CapacitorPlatforms = /* @__PURE__ */ initPlatforms(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      addPlatform = CapacitorPlatforms.addPlatform;
      setPlatform = CapacitorPlatforms.setPlatform;
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        var _a, _b, _c, _d, _e;
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins2 = cap.Plugins = cap.Plugins || {};
        const capPlatforms = win.CapacitorPlatforms;
        const defaultGetPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const getPlatform = ((_a = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _a === void 0 ? void 0 : _a.getPlatform) || defaultGetPlatform;
        const defaultIsNativePlatform = () => getPlatform() !== "web";
        const isNativePlatform = ((_b = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _b === void 0 ? void 0 : _b.isNativePlatform) || defaultIsNativePlatform;
        const defaultIsPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const isPluginAvailable = ((_c = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _c === void 0 ? void 0 : _c.isPluginAvailable) || defaultIsPluginAvailable;
        const defaultGetPluginHeader = (pluginName) => {
          var _a2;
          return (_a2 = cap.PluginHeaders) === null || _a2 === void 0 ? void 0 : _a2.find((h) => h.name === pluginName);
        };
        const getPluginHeader = ((_d = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _d === void 0 ? void 0 : _d.getPluginHeader) || defaultGetPluginHeader;
        const handleError = (err) => win.console.error(err);
        const pluginMethodNoop = (_target, prop, pluginName) => {
          return Promise.reject(`${pluginName} does not have an implementation of "${prop}".`);
        };
        const registeredPlugins = /* @__PURE__ */ new Map();
        const defaultRegisterPlugin = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a2, _b2;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a2 = impl[prop]) === null || _a2 === void 0 ? void 0 : _a2.bind(impl);
              }
            } else if (impl) {
              return (_b2 = impl[prop]) === null || _b2 === void 0 ? void 0 : _b2.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins2[pluginName] = proxy;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy,
            platforms: /* @__PURE__ */ new Set([
              ...Object.keys(jsImplementations),
              ...pluginHeader ? [platform] : []
            ])
          });
          return proxy;
        };
        const registerPlugin2 = ((_e = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _e === void 0 ? void 0 : _e.registerPlugin) || defaultRegisterPlugin;
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.pluginMethodNoop = pluginMethodNoop;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        cap.platform = cap.getPlatform();
        cap.isNative = cap.isNativePlatform();
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      Plugins = Capacitor.Plugins;
      WebPlugin = class {
        constructor(config) {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
          if (config) {
            console.warn(`Capacitor WebPlugin "${config.name}" config object was deprecated in v3 and will be removed in v4.`);
            this.config = config;
          }
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          return !!this.listeners[eventName].length;
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          this.listeners[eventName].splice(index, 1);
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = `; expires=${(options.expires || "").replace("expires=", "")}`;
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
    }
  });

  // node_modules/@capacitor-community/sqlite/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    CapacitorSQLiteWeb: () => CapacitorSQLiteWeb
  });
  var CapacitorSQLiteWeb;
  var init_web = __esm({
    "node_modules/@capacitor-community/sqlite/dist/esm/web.js"() {
      init_dist();
      CapacitorSQLiteWeb = class extends WebPlugin {
        constructor() {
          super(...arguments);
          this.jeepSqliteElement = null;
          this.isWebStoreOpen = false;
        }
        async initWebStore() {
          await customElements.whenDefined("jeep-sqlite");
          this.jeepSqliteElement = document.querySelector("jeep-sqlite");
          this.ensureJeepSqliteIsAvailable();
          this.jeepSqliteElement.addEventListener("jeepSqliteImportProgress", (event) => {
            this.notifyListeners("sqliteImportProgressEvent", event.detail);
          });
          this.jeepSqliteElement.addEventListener("jeepSqliteExportProgress", (event) => {
            this.notifyListeners("sqliteExportProgressEvent", event.detail);
          });
          this.jeepSqliteElement.addEventListener("jeepSqliteHTTPRequestEnded", (event) => {
            this.notifyListeners("sqliteHTTPRequestEndedEvent", event.detail);
          });
          this.jeepSqliteElement.addEventListener("jeepSqlitePickDatabaseEnded", (event) => {
            this.notifyListeners("sqlitePickDatabaseEndedEvent", event.detail);
          });
          this.jeepSqliteElement.addEventListener("jeepSqliteSaveDatabaseToDisk", (event) => {
            this.notifyListeners("sqliteSaveDatabaseToDiskEvent", event.detail);
          });
          if (!this.isWebStoreOpen) {
            this.isWebStoreOpen = await this.jeepSqliteElement.isStoreOpen();
          }
          return;
        }
        async saveToStore(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.saveToStore(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async getFromLocalDiskToStore(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.getFromLocalDiskToStore(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async saveToLocalDisk(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.saveToLocalDisk(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async echo(options) {
          this.ensureJeepSqliteIsAvailable();
          const echoResult = await this.jeepSqliteElement.echo(options);
          return echoResult;
        }
        async createConnection(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.createConnection(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async open(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.open(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async closeConnection(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.closeConnection(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async getVersion(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const versionResult = await this.jeepSqliteElement.getVersion(options);
            return versionResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async checkConnectionsConsistency(options) {
          this.ensureJeepSqliteIsAvailable();
          try {
            const consistencyResult = await this.jeepSqliteElement.checkConnectionsConsistency(options);
            return consistencyResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async close(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.close(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async beginTransaction(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const changes = await this.jeepSqliteElement.beginTransaction(options);
            return changes;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async commitTransaction(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const changes = await this.jeepSqliteElement.commitTransaction(options);
            return changes;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async rollbackTransaction(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const changes = await this.jeepSqliteElement.rollbackTransaction(options);
            return changes;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async isTransactionActive(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const result = await this.jeepSqliteElement.isTransactionActive(options);
            return result;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async getTableList(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const tableListResult = await this.jeepSqliteElement.getTableList(options);
            return tableListResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async execute(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const executeResult = await this.jeepSqliteElement.execute(options);
            return executeResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async executeSet(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const executeResult = await this.jeepSqliteElement.executeSet(options);
            return executeResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async run(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const runResult = await this.jeepSqliteElement.run(options);
            return runResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async query(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const queryResult = await this.jeepSqliteElement.query(options);
            return queryResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async isDBExists(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const dbExistsResult = await this.jeepSqliteElement.isDBExists(options);
            return dbExistsResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async isDBOpen(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const isDBOpenResult = await this.jeepSqliteElement.isDBOpen(options);
            return isDBOpenResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async isDatabase(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const isDatabaseResult = await this.jeepSqliteElement.isDatabase(options);
            return isDatabaseResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async isTableExists(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const tableExistsResult = await this.jeepSqliteElement.isTableExists(options);
            return tableExistsResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async deleteDatabase(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.deleteDatabase(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async isJsonValid(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const isJsonValidResult = await this.jeepSqliteElement.isJsonValid(options);
            return isJsonValidResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async importFromJson(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const importFromJsonResult = await this.jeepSqliteElement.importFromJson(options);
            return importFromJsonResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async exportToJson(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const exportToJsonResult = await this.jeepSqliteElement.exportToJson(options);
            return exportToJsonResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async createSyncTable(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const createSyncTableResult = await this.jeepSqliteElement.createSyncTable(options);
            return createSyncTableResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async setSyncDate(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.setSyncDate(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async getSyncDate(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const getSyncDateResult = await this.jeepSqliteElement.getSyncDate(options);
            return getSyncDateResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async deleteExportedRows(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.deleteExportedRows(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async addUpgradeStatement(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.addUpgradeStatement(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async copyFromAssets(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.copyFromAssets(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async getFromHTTPRequest(options) {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            await this.jeepSqliteElement.getFromHTTPRequest(options);
            return;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        async getDatabaseList() {
          this.ensureJeepSqliteIsAvailable();
          this.ensureWebstoreIsOpen();
          try {
            const databaseListResult = await this.jeepSqliteElement.getDatabaseList();
            return databaseListResult;
          } catch (err) {
            throw new Error(`${err}`);
          }
        }
        /**
         * Checks if the `jeep-sqlite` element is present in the DOM.
         * If it's not in the DOM, this method throws an Error.
         *
         * Attention: This will always fail, if the `intWebStore()` method wasn't called before.
         */
        ensureJeepSqliteIsAvailable() {
          if (this.jeepSqliteElement === null) {
            throw new Error(`The jeep-sqlite element is not present in the DOM! Please check the @capacitor-community/sqlite documentation for instructions regarding the web platform.`);
          }
        }
        ensureWebstoreIsOpen() {
          if (!this.isWebStoreOpen) {
            throw new Error('WebStore is not open yet. You have to call "initWebStore()" first.');
          }
        }
        ////////////////////////////////////
        ////// UNIMPLEMENTED METHODS
        ////////////////////////////////////
        async getUrl() {
          throw this.unimplemented("Not implemented on web.");
        }
        async getMigratableDbList(options) {
          console.log("getMigratableDbList", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async addSQLiteSuffix(options) {
          console.log("addSQLiteSuffix", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async deleteOldDatabases(options) {
          console.log("deleteOldDatabases", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async moveDatabasesAndAddSuffix(options) {
          console.log("moveDatabasesAndAddSuffix", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async isSecretStored() {
          throw this.unimplemented("Not implemented on web.");
        }
        async setEncryptionSecret(options) {
          console.log("setEncryptionSecret", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async changeEncryptionSecret(options) {
          console.log("changeEncryptionSecret", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async clearEncryptionSecret() {
          console.log("clearEncryptionSecret");
          throw this.unimplemented("Not implemented on web.");
        }
        async checkEncryptionSecret(options) {
          console.log("checkEncryptionPassPhrase", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async getNCDatabasePath(options) {
          console.log("getNCDatabasePath", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async createNCConnection(options) {
          console.log("createNCConnection", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async closeNCConnection(options) {
          console.log("closeNCConnection", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async isNCDatabase(options) {
          console.log("isNCDatabase", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async isDatabaseEncrypted(options) {
          console.log("isDatabaseEncrypted", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async isInConfigEncryption() {
          throw this.unimplemented("Not implemented on web.");
        }
        async isInConfigBiometricAuth() {
          throw this.unimplemented("Not implemented on web.");
        }
        async loadExtension(options) {
          console.log("loadExtension", options);
          throw this.unimplemented("Not implemented on web.");
        }
        async enableLoadExtension(options) {
          console.log("enableLoadExtension", options);
          throw this.unimplemented("Not implemented on web.");
        }
      };
    }
  });

  // src/native-providers.js
  var import_swifta_contract = __toESM(require_swifta_contract());

  // src/provider-config.json
  var provider_config_default = { swifta: "qk_e23ad9ada38abd839ec625aff167b608226ffe36e5c05f8e", sozuri: { project: "sk10", apiKey: "RYztxiLFa3x3EA4ZCFGVoEfzA0ThhocOVudGLkfILQZ1A4LUqHWF5J05p7q2", from: "Sozuri", channel: "sms", type: "promotional" } };

  // src/native-providers.js
  function createNativeProviders(http) {
    const parse = (response) => {
      const data = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
      if (!data || typeof data !== "object") throw new Error("Provider returned an invalid response.");
      return data;
    };
    return {
      async charge(payload) {
        return import_swifta_contract.default.normalize(parse(await http.request({
          url: "https://app.swifta.co.ke/stkpush",
          method: "POST",
          headers: { "x-api-key": provider_config_default.swifta, "Content-Type": "application/json", Accept: "application/json" },
          data: import_swifta_contract.default.validate(payload),
          readTimeout: 3e4
        })));
      },
      async paymentStatus({ reference }) {
        if (!/^[A-Za-z0-9_-]{5,200}$/.test(String(reference || ""))) throw new Error("Missing Swifta checkout ID.");
        const data = parse(await http.request({
          url: "https://app.swifta.co.ke/poll/" + encodeURIComponent(reference),
          method: "GET",
          headers: { Accept: "application/json" },
          readTimeout: 25e3
        }));
        const txn = data.transaction || data.data || data;
        const raw = String(txn.status || data.status || "").toLowerCase();
        const receipt = String(txn.mpesaReceiptNumber || txn.MpesaReceiptNumber || txn.transactionReceipt || txn.TransactionReceipt || data.mpesaReceiptNumber || "").trim().toUpperCase();
        if (["failed", "cancelled", "canceled", "timeout"].includes(raw)) return { status: "failed" };
        if (raw === "success" || raw === "completed" || raw === "paid") {
          if (!/^[A-Z0-9]{8,30}$/.test(receipt)) return { status: "pending" };
          const amount = txn.amount ?? txn.TransactionAmount ?? data.amount;
          const amountCents = amount == null ? null : Math.round(Number(amount) * 100);
          const phone = String(txn.phone || txn.Msisdn || txn.phoneNumber || data.phone || "");
          return { status: "success", payment_ref: receipt, checkout_id: String(reference), amount_cents: amountCents, phone };
        }
        return { status: "pending" };
      },
      async sms(path, body = {}) {
        if (path === "/api/admin/sms/config") return { configured: !!provider_config_default.sozuri?.apiKey, message: "Configured" };
        if (path !== "/api/admin/sms/send") throw new Error("Unknown SMS endpoint.");
        const message = String(body.message || "").trim();
        if (!message || message.length > 1e3) throw new Error("Enter a message of 1\u20131000 characters.");
        if (!Array.isArray(body.recipients) || !body.recipients.length || body.recipients.length > 200) throw new Error("Select 1\u2013200 recipients.");
        const recipients = [...new Set(body.recipients.map((phone) => {
          let digits = String(phone || "").replace(/\D/g, "");
          if (/^0[17]\d{8}$/.test(digits)) digits = "254" + digits.slice(1);
          if (/^[17]\d{8}$/.test(digits)) digits = "254" + digits;
          if (!/^254[17]\d{8}$/.test(digits)) throw new Error("A selected customer has an invalid Kenyan phone number.");
          return "+" + digits;
        }))];
        const response = parse(await http.request({
          url: "https://sozuri.net/api/v1/messaging",
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          data: { ...provider_config_default.sozuri, to: recipients.join(","), message },
          readTimeout: 3e4
        }));
        const results = response.recipients || [];
        const sent = results.filter((r) => [11, 13, 14].includes(Number(r.statusCode))).length;
        return { sent, total: recipients.length, failed: recipients.length - sent, results: results.map((r) => ({ ...r, number: r.to })), message: response.message || "" };
      }
    };
  }

  // src/sqlite-bridge.js
  init_dist();

  // node_modules/@capacitor-community/sqlite/dist/esm/index.js
  init_dist();

  // node_modules/@capacitor-community/sqlite/dist/esm/definitions.js
  var SQLiteConnection = class {
    constructor(sqlite) {
      this.sqlite = sqlite;
      this._connectionDict = /* @__PURE__ */ new Map();
    }
    async initWebStore() {
      try {
        await this.sqlite.initWebStore();
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async saveToStore(database) {
      try {
        await this.sqlite.saveToStore({ database });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async saveToLocalDisk(database) {
      try {
        await this.sqlite.saveToLocalDisk({ database });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async getFromLocalDiskToStore(overwrite) {
      const mOverwrite = overwrite != null ? overwrite : true;
      try {
        await this.sqlite.getFromLocalDiskToStore({ overwrite: mOverwrite });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async echo(value) {
      try {
        const res = await this.sqlite.echo({ value });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isSecretStored() {
      try {
        const res = await this.sqlite.isSecretStored();
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async setEncryptionSecret(passphrase) {
      try {
        await this.sqlite.setEncryptionSecret({ passphrase });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async changeEncryptionSecret(passphrase, oldpassphrase) {
      try {
        await this.sqlite.changeEncryptionSecret({
          passphrase,
          oldpassphrase
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async clearEncryptionSecret() {
      try {
        await this.sqlite.clearEncryptionSecret();
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async checkEncryptionSecret(passphrase) {
      try {
        const res = await this.sqlite.checkEncryptionSecret({
          passphrase
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async addUpgradeStatement(database, upgrade) {
      try {
        if (database.endsWith(".db"))
          database = database.slice(0, -3);
        await this.sqlite.addUpgradeStatement({
          database,
          upgrade
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async createConnection(database, encrypted, mode, version, readonly) {
      try {
        if (database.endsWith(".db"))
          database = database.slice(0, -3);
        await this.sqlite.createConnection({
          database,
          encrypted,
          mode,
          version,
          readonly
        });
        const conn = new SQLiteDBConnection(database, readonly, this.sqlite);
        const connName = readonly ? `RO_${database}` : `RW_${database}`;
        this._connectionDict.set(connName, conn);
        return Promise.resolve(conn);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async closeConnection(database, readonly) {
      try {
        if (database.endsWith(".db"))
          database = database.slice(0, -3);
        await this.sqlite.closeConnection({ database, readonly });
        const connName = readonly ? `RO_${database}` : `RW_${database}`;
        this._connectionDict.delete(connName);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isConnection(database, readonly) {
      const res = {};
      if (database.endsWith(".db"))
        database = database.slice(0, -3);
      const connName = readonly ? `RO_${database}` : `RW_${database}`;
      res.result = this._connectionDict.has(connName);
      return Promise.resolve(res);
    }
    async retrieveConnection(database, readonly) {
      if (database.endsWith(".db"))
        database = database.slice(0, -3);
      const connName = readonly ? `RO_${database}` : `RW_${database}`;
      if (this._connectionDict.has(connName)) {
        const conn = this._connectionDict.get(connName);
        if (typeof conn != "undefined")
          return Promise.resolve(conn);
        else {
          return Promise.reject(`Connection ${database} is undefined`);
        }
      } else {
        return Promise.reject(`Connection ${database} does not exist`);
      }
    }
    async getNCDatabasePath(path, database) {
      try {
        const databasePath = await this.sqlite.getNCDatabasePath({
          path,
          database
        });
        return Promise.resolve(databasePath);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async createNCConnection(databasePath, version) {
      try {
        await this.sqlite.createNCConnection({
          databasePath,
          version
        });
        const conn = new SQLiteDBConnection(databasePath, true, this.sqlite);
        const connName = `RO_${databasePath})`;
        this._connectionDict.set(connName, conn);
        return Promise.resolve(conn);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async closeNCConnection(databasePath) {
      try {
        await this.sqlite.closeNCConnection({ databasePath });
        const connName = `RO_${databasePath})`;
        this._connectionDict.delete(connName);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isNCConnection(databasePath) {
      const res = {};
      const connName = `RO_${databasePath})`;
      res.result = this._connectionDict.has(connName);
      return Promise.resolve(res);
    }
    async retrieveNCConnection(databasePath) {
      if (this._connectionDict.has(databasePath)) {
        const connName = `RO_${databasePath})`;
        const conn = this._connectionDict.get(connName);
        if (typeof conn != "undefined")
          return Promise.resolve(conn);
        else {
          return Promise.reject(`Connection ${databasePath} is undefined`);
        }
      } else {
        return Promise.reject(`Connection ${databasePath} does not exist`);
      }
    }
    async isNCDatabase(databasePath) {
      try {
        const res = await this.sqlite.isNCDatabase({ databasePath });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async retrieveAllConnections() {
      return this._connectionDict;
    }
    async closeAllConnections() {
      const delDict = /* @__PURE__ */ new Map();
      try {
        for (const key of this._connectionDict.keys()) {
          const database = key.substring(3);
          const readonly = key.substring(0, 3) === "RO_" ? true : false;
          await this.sqlite.closeConnection({ database, readonly });
          delDict.set(key, null);
        }
        for (const key of delDict.keys()) {
          this._connectionDict.delete(key);
        }
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async checkConnectionsConsistency() {
      try {
        const keys = [...this._connectionDict.keys()];
        const openModes = [];
        const dbNames = [];
        for (const key of keys) {
          openModes.push(key.substring(0, 2));
          dbNames.push(key.substring(3));
        }
        const res = await this.sqlite.checkConnectionsConsistency({
          dbNames,
          openModes
        });
        if (!res.result)
          this._connectionDict = /* @__PURE__ */ new Map();
        return Promise.resolve(res);
      } catch (err) {
        this._connectionDict = /* @__PURE__ */ new Map();
        return Promise.reject(err);
      }
    }
    async importFromJson(jsonstring) {
      try {
        const ret = await this.sqlite.importFromJson({ jsonstring });
        return Promise.resolve(ret);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isJsonValid(jsonstring) {
      try {
        const ret = await this.sqlite.isJsonValid({ jsonstring });
        return Promise.resolve(ret);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async copyFromAssets(overwrite) {
      const mOverwrite = overwrite != null ? overwrite : true;
      try {
        await this.sqlite.copyFromAssets({ overwrite: mOverwrite });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async getFromHTTPRequest(url, overwrite) {
      const mOverwrite = overwrite != null ? overwrite : true;
      try {
        await this.sqlite.getFromHTTPRequest({ url, overwrite: mOverwrite });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isDatabaseEncrypted(database) {
      if (database.endsWith(".db"))
        database = database.slice(0, -3);
      try {
        const res = await this.sqlite.isDatabaseEncrypted({ database });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isInConfigEncryption() {
      try {
        const res = await this.sqlite.isInConfigEncryption();
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isInConfigBiometricAuth() {
      try {
        const res = await this.sqlite.isInConfigBiometricAuth();
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isDatabase(database) {
      if (database.endsWith(".db"))
        database = database.slice(0, -3);
      try {
        const res = await this.sqlite.isDatabase({ database });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async getDatabaseList() {
      try {
        const res = await this.sqlite.getDatabaseList();
        const values = res.values;
        values.sort();
        const ret = { values };
        return Promise.resolve(ret);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async getMigratableDbList(folderPath) {
      const path = folderPath ? folderPath : "default";
      try {
        const res = await this.sqlite.getMigratableDbList({
          folderPath: path
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async addSQLiteSuffix(folderPath, dbNameList) {
      const path = folderPath ? folderPath : "default";
      const dbList = dbNameList ? dbNameList : [];
      try {
        const res = await this.sqlite.addSQLiteSuffix({
          folderPath: path,
          dbNameList: dbList
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async deleteOldDatabases(folderPath, dbNameList) {
      const path = folderPath ? folderPath : "default";
      const dbList = dbNameList ? dbNameList : [];
      try {
        const res = await this.sqlite.deleteOldDatabases({
          folderPath: path,
          dbNameList: dbList
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async moveDatabasesAndAddSuffix(folderPath, dbNameList) {
      const path = folderPath ? folderPath : "default";
      const dbList = dbNameList ? dbNameList : [];
      return this.sqlite.moveDatabasesAndAddSuffix({
        folderPath: path,
        dbNameList: dbList
      });
    }
  };
  var SQLiteDBConnection = class {
    constructor(dbName, readonly, sqlite) {
      this.dbName = dbName;
      this.readonly = readonly;
      this.sqlite = sqlite;
    }
    getConnectionDBName() {
      return this.dbName;
    }
    getConnectionReadOnly() {
      return this.readonly;
    }
    async open() {
      try {
        await this.sqlite.open({
          database: this.dbName,
          readonly: this.readonly
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async close() {
      try {
        await this.sqlite.close({
          database: this.dbName,
          readonly: this.readonly
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async beginTransaction() {
      try {
        const changes = await this.sqlite.beginTransaction({
          database: this.dbName
        });
        return Promise.resolve(changes);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async commitTransaction() {
      try {
        const changes = await this.sqlite.commitTransaction({
          database: this.dbName
        });
        return Promise.resolve(changes);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async rollbackTransaction() {
      try {
        const changes = await this.sqlite.rollbackTransaction({
          database: this.dbName
        });
        return Promise.resolve(changes);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isTransactionActive() {
      try {
        const result = await this.sqlite.isTransactionActive({
          database: this.dbName
        });
        return Promise.resolve(result);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async loadExtension(path) {
      try {
        await this.sqlite.loadExtension({
          database: this.dbName,
          path,
          readonly: this.readonly
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async enableLoadExtension(toggle) {
      try {
        await this.sqlite.enableLoadExtension({
          database: this.dbName,
          toggle,
          readonly: this.readonly
        });
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async getUrl() {
      try {
        const res = await this.sqlite.getUrl({
          database: this.dbName,
          readonly: this.readonly
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async getVersion() {
      try {
        const version = await this.sqlite.getVersion({
          database: this.dbName,
          readonly: this.readonly
        });
        return Promise.resolve(version);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async getTableList() {
      try {
        const res = await this.sqlite.getTableList({
          database: this.dbName,
          readonly: this.readonly
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async execute(statements, transaction = true, isSQL92 = true) {
      try {
        if (!this.readonly) {
          const res = await this.sqlite.execute({
            database: this.dbName,
            statements,
            transaction,
            readonly: false,
            isSQL92
          });
          return Promise.resolve(res);
        } else {
          return Promise.reject("not allowed in read-only mode");
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async query(statement, values, isSQL92 = true) {
      let res;
      try {
        if (values && values.length > 0) {
          res = await this.sqlite.query({
            database: this.dbName,
            statement,
            values,
            readonly: this.readonly,
            isSQL92: true
          });
        } else {
          res = await this.sqlite.query({
            database: this.dbName,
            statement,
            values: [],
            readonly: this.readonly,
            isSQL92
          });
        }
        res = await this.reorderRows(res);
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async run(statement, values, transaction = true, returnMode = "no", isSQL92 = true) {
      let res;
      try {
        if (!this.readonly) {
          if (values && values.length > 0) {
            res = await this.sqlite.run({
              database: this.dbName,
              statement,
              values,
              transaction,
              readonly: false,
              returnMode,
              isSQL92: true
            });
          } else {
            res = await this.sqlite.run({
              database: this.dbName,
              statement,
              values: [],
              transaction,
              readonly: false,
              returnMode,
              isSQL92
            });
          }
          res.changes = await this.reorderRows(res.changes);
          return Promise.resolve(res);
        } else {
          return Promise.reject("not allowed in read-only mode");
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async executeSet(set, transaction = true, returnMode = "no", isSQL92 = true) {
      let res;
      try {
        if (!this.readonly) {
          res = await this.sqlite.executeSet({
            database: this.dbName,
            set,
            transaction,
            readonly: false,
            returnMode,
            isSQL92
          });
          res.changes = await this.reorderRows(res.changes);
          return Promise.resolve(res);
        } else {
          return Promise.reject("not allowed in read-only mode");
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isExists() {
      try {
        const res = await this.sqlite.isDBExists({
          database: this.dbName,
          readonly: this.readonly
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isTable(table) {
      try {
        const res = await this.sqlite.isTableExists({
          database: this.dbName,
          table,
          readonly: this.readonly
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async isDBOpen() {
      try {
        const res = await this.sqlite.isDBOpen({
          database: this.dbName,
          readonly: this.readonly
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async delete() {
      try {
        if (!this.readonly) {
          await this.sqlite.deleteDatabase({
            database: this.dbName,
            readonly: false
          });
          return Promise.resolve();
        } else {
          return Promise.reject("not allowed in read-only mode");
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async createSyncTable() {
      try {
        if (!this.readonly) {
          const res = await this.sqlite.createSyncTable({
            database: this.dbName,
            readonly: false
          });
          return Promise.resolve(res);
        } else {
          return Promise.reject("not allowed in read-only mode");
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async setSyncDate(syncdate) {
      try {
        if (!this.readonly) {
          await this.sqlite.setSyncDate({
            database: this.dbName,
            syncdate,
            readonly: false
          });
          return Promise.resolve();
        } else {
          return Promise.reject("not allowed in read-only mode");
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async getSyncDate() {
      try {
        const res = await this.sqlite.getSyncDate({
          database: this.dbName,
          readonly: this.readonly
        });
        let retDate = "";
        if (res.syncDate > 0)
          retDate = new Date(res.syncDate * 1e3).toISOString();
        return Promise.resolve(retDate);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async exportToJson(mode, encrypted = false) {
      try {
        const res = await this.sqlite.exportToJson({
          database: this.dbName,
          jsonexportmode: mode,
          readonly: this.readonly,
          encrypted
        });
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async deleteExportedRows() {
      try {
        if (!this.readonly) {
          await this.sqlite.deleteExportedRows({
            database: this.dbName,
            readonly: false
          });
          return Promise.resolve();
        } else {
          return Promise.reject("not allowed in read-only mode");
        }
      } catch (err) {
        return Promise.reject(err);
      }
    }
    async executeTransaction(txn, isSQL92 = true) {
      let changes = 0;
      let isActive = false;
      if (!this.readonly) {
        await this.sqlite.beginTransaction({
          database: this.dbName
        });
        isActive = await this.sqlite.isTransactionActive({
          database: this.dbName
        });
        if (!isActive) {
          return Promise.reject("After Begin Transaction, no transaction active");
        }
        try {
          for (const task of txn) {
            if (typeof task !== "object" || !("statement" in task)) {
              throw new Error("Error a task.statement must be provided");
            }
            if ("values" in task && task.values && task.values.length > 0) {
              const retMode = task.statement.toUpperCase().includes("RETURNING") ? "all" : "no";
              const ret = await this.sqlite.run({
                database: this.dbName,
                statement: task.statement,
                values: task.values,
                transaction: false,
                readonly: false,
                returnMode: retMode,
                isSQL92
              });
              if (ret.changes.changes < 0) {
                throw new Error("Error in transaction method run ");
              }
              changes += ret.changes.changes;
            } else {
              const ret = await this.sqlite.execute({
                database: this.dbName,
                statements: task.statement,
                transaction: false,
                readonly: false
              });
              if (ret.changes.changes < 0) {
                throw new Error("Error in transaction method execute ");
              }
              changes += ret.changes.changes;
            }
          }
          const retC = await this.sqlite.commitTransaction({
            database: this.dbName
          });
          changes += retC.changes.changes;
          const retChanges = { changes: { changes } };
          return Promise.resolve(retChanges);
        } catch (err) {
          const msg = err.message ? err.message : err;
          await this.sqlite.rollbackTransaction({
            database: this.dbName
          });
          return Promise.reject(msg);
        }
      } else {
        return Promise.reject("not allowed in read-only mode");
      }
    }
    async reorderRows(res) {
      const retRes = res;
      if (res?.values && typeof res.values[0] === "object") {
        if (Object.keys(res.values[0]).includes("ios_columns")) {
          const columnList = res.values[0]["ios_columns"];
          const iosRes = [];
          for (let i = 1; i < res.values.length; i++) {
            const rowJson = res.values[i];
            const resRowJson = {};
            for (const item of columnList) {
              resRowJson[item] = rowJson[item];
            }
            iosRes.push(resRowJson);
          }
          retRes["values"] = iosRes;
        }
      }
      return Promise.resolve(retRes);
    }
  };

  // node_modules/@capacitor-community/sqlite/dist/esm/index.js
  var CapacitorSQLite = registerPlugin("CapacitorSQLite", {
    web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.CapacitorSQLiteWeb()),
    electron: () => window.CapacitorCustomPlatform.plugins.CapacitorSQLite
  });

  // src/sqlite-bridge.js
  var IndexedFallback = class {
    constructor() {
      this.dbp = null;
    }
    open() {
      if (this.dbp) return this.dbp;
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open("oraforge_pos_fallback", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return this.dbp;
    }
    async get(key, fallback) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readonly");
        const r = tx.objectStore("kv").get(key);
        r.onsuccess = () => resolve(r.result === void 0 ? fallback : r.result);
        r.onerror = () => reject(r.error);
      });
    }
    async set(key, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  };
  var OraforgeDB = class {
    constructor() {
      this.sqlite = null;
      this.db = null;
      this.fallback = new IndexedFallback();
      this.native = false;
    }
    async init() {
      this.native = ["android", "ios"].includes(Capacitor.getPlatform());
      if (!this.native) return this;
      try {
        this.sqlite = new SQLiteConnection(CapacitorSQLite);
        try {
          this.db = await this.sqlite.createConnection("oraforge_pos", false, "no-encryption", 1, false);
        } catch (_) {
          this.db = await this.sqlite.retrieveConnection("oraforge_pos", false);
        }
        await this.db.open();
        await this.db.execute("CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);");
      } catch (err) {
        console.error("Native SQLite unavailable; using IndexedDB fallback", err);
        this.native = false;
        this.db = null;
      }
      return this;
    }
    async exportRecords() {
      if (this.native && this.db) {
        const result = await this.db.query("SELECT key, value FROM kv_store;");
        return (result.values || []).map((row) => [row.key, JSON.parse(row.value)]);
      }
      const db = await this.fallback.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readonly"), rows = [];
        const request = tx.objectStore("kv").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            rows.push([cursor.key, cursor.value]);
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(rows);
        tx.onerror = () => reject(tx.error);
      });
    }
    async replaceRecords(rows) {
      if (this.native && this.db) {
        await this.db.executeSet([{ statement: "DELETE FROM kv_store;", values: [] }, ...rows.map(([key, value]) => ({ statement: "INSERT INTO kv_store(key,value) VALUES (?,?);", values: [key, JSON.stringify(value)] }))], true);
        return;
      }
      const db = await this.fallback.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readwrite"), store = tx.objectStore("kv");
        store.clear();
        rows.forEach(([key, value]) => store.put(value, key));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Restore cancelled"));
      });
    }
    async get(key, fallback) {
      if (!this.native || !this.db) return this.fallback.get(key, fallback);
      const r = await this.db.query("SELECT value FROM kv_store WHERE key = ? LIMIT 1;", [key]);
      if (!r.values || !r.values.length) return fallback;
      try {
        return JSON.parse(r.values[0].value);
      } catch (_) {
        return fallback;
      }
    }
    async set(key, value) {
      if (!this.native || !this.db) return this.fallback.set(key, value);
      await this.db.run("INSERT OR REPLACE INTO kv_store(key,value) VALUES (?,?);", [key, JSON.stringify(value)]);
    }
    // A synchronous transform inside one IndexedDB transaction prevents two POS
    // tabs from claiming the same fiscal sale. Never fall back after a failed write.
    async update(key, transform, fallback = {}) {
      if (!this.native || !this.db) {
        const db = await this.fallback.open();
        return new Promise((resolve, reject) => {
          const tx = db.transaction("kv", "readwrite"), store = tx.objectStore("kv");
          let value, failure;
          const request = store.get(key);
          request.onsuccess = () => {
            try {
              value = transform(request.result === void 0 ? fallback : request.result);
              store.put(value, key);
            } catch (error) {
              failure = error;
              tx.abort();
            }
          };
          tx.oncomplete = () => resolve(value);
          tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error("Database update failed."));
        });
      }
      if (!navigator.locks) throw new Error("Atomic fiscal updates are unavailable on this device.");
      return navigator.locks.request("oraforge-db:" + key, async () => {
        const value = transform(await this.get(key, fallback));
        await this.set(key, value);
        return value;
      });
    }
  };
  window.OraforgeDB = new OraforgeDB();
  window.OraforgeDBReady = window.OraforgeDB.init();
  window.OraforgeNative = Capacitor.isNativePlatform();
  window.OraforgeHttp = {
    async request({ url, method = "GET", headers = {}, data = null, params = null, connectTimeout = 1e4, readTimeout = 15e3 }) {
      const options = { url, method, headers, connectTimeout, readTimeout };
      if (data !== null && data !== void 0) options.data = data;
      if (params) options.params = params;
      const response = await CapacitorHttp.request(options);
      if (response.status < 200 || response.status >= 300) {
        let message = `Network request failed (${response.status})`;
        const payload = response.data;
        if (payload && typeof payload === "object") message = payload.error || payload.errorMessage || payload.message || message;
        else if (typeof payload === "string" && payload.trim()) message = payload.slice(0, 180);
        const error = new Error(message);
        error.status = response.status;
        error.data = payload;
        throw error;
      }
      return response;
    }
  };
  window.OraforgeProviders = createNativeProviders(window.OraforgeHttp);
  window.OraforgePrinter = registerPlugin("ReceiptPrinter");
})();
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
