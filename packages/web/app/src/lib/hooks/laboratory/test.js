'use strict';

import CryptoJS from 'crypto-js';
import CryptoJSPackageJson from 'crypto-js/package.json';
import { isJSONObject, isJSONPrimitive } from 'src/app/graph/explorerPage/helpers/types';

var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }

    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }

      function rejected(value) {
        try {
          step(generator['throw'](value));
        } catch (e) {
          reject(e);
        }
      }

      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }

      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __rest =
  (this && this.__rest) ||
  function (s, e) {
    var t = {};
    for (var p in s) {
      if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) {
        t[p] = s[p];
      }
    }
    if (s != null && typeof Object.getOwnPropertySymbols === 'function') {
      for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
        if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) {
          t[p[i]] = s[p[i]];
        }
      }
    }
    return t;
  };

function isValidHeaders(value) {
  return (
    typeof value === 'object' && !!value && Object.values(value).every(v => typeof v === 'string')
  );
}

// initial list comes from https://github.com/postmanlabs/uniscope/blob/develop/lib/allowed-globals.js
const ALLOWED_GLOBALS = [
  'Array',
  'ArrayBuffer',
  'Atomics',
  'BigInt',
  'BigInt64Array',
  'BigUint64Array',
  'Boolean',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'Float32Array',
  'Float64Array',
  'Function',
  'Infinity',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'Proxy',
  'RangeError',
  'ReferenceError',
  'Reflect',
  'RegExp',
  'Set',
  'SharedArrayBuffer',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakSet',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'undefined',
  'unescape',
  'btoa',
  'atob',
];

function getValidEnvVariable(value) {
  if (Array.isArray(value)) {
    return value.map(v => {
      var _a;
      return (_a = getValidEnvVariable(v)) !== null && _a !== void 0 ? _a : null;
    });
  } else if (typeof value === 'object' && value) {
    return Object.fromEntries(
      Object.entries(value)
        .map(_ref => {
          let [key, v] = _ref;
          return [key, getValidEnvVariable(v)];
        })
        .filter(v => v[1] !== undefined),
    );
  }
  if (isJSONPrimitive(value)) {
    return value;
  }
  // TODO; replace this with the logging proxy so this can show up in the UI
  // eslint-disable-next-line no-console
  console.log(
    'You tried to set a non primitive type in env variables, only string, boolean, number, null, object, or arrays are allowed in env variables. The value has been filtered out',
  );
  return undefined;
}

export function execute(_ref2) {
  let {
    script,
    environmentVariables,
    fetch,
    runOperation,
    oauth2Request,
    prompt,
    log,
    requestBody,
    responseBody,
    previousOperations,
  } = _ref2;
  return __awaiter(this, void 0, void 0, function* () {
    const inWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
    // Confirm the build pipeline worked and this is running inside a worker and not the main thread
    if (!inWorker && process.env.NODE_ENV !== 'test') {
      throw new Error(
        'Preflight and postflight scripts must always be run in web workers, this is a problem with studio not user input',
      );
    }
    // When running in worker `environmentVariables` will not be a reference to the main thread value
    // but sometimes this will be tested outside of the worker so we don't want to mutate the input in that case
    let workingEnvironmentVariables = Object.assign({}, environmentVariables);
    // List all variables that we want to allow users to use inside their scripts
    const allowedGlobals = [
      ...ALLOWED_GLOBALS,
      // We aren't allowing access to window.console, but we need to "allow" it
      // here so an second argument isn't added for it below.
      'console',
    ];
    // generate list of all in scope variables, we do getOwnPropertyNames and `for in` because each contain slightly different sets of keys
    const allGlobalKeys = Object.getOwnPropertyNames(globalThis);
    // eslint-disable-next-line no-restricted-syntax,guard-for-in
    for (const key in globalThis) {
      allGlobalKeys.push(key);
    }
    // filter out allowed global variables and keys that will cause problems
    const blockedGlobals = allGlobalKeys.filter(key => {
      return (
        // When testing in the main thread this exists on window and is not a valid argument name.
        // because global is blocked, even if this was in the worker it's still wouldn't be available because it's not a valid variable name
        !key.includes('-') &&
        !allowedGlobals.includes(key) &&
        // window has references as indexes on the globalThis such as `globalThis[0]`, numbers are not valid arguments so we need to filter these out
        isNaN(Number(key)) &&
        // @ is not a valid argument name beginning character so we don't need to block it and including it will cause a syntax error
        // only example currently is @wry/context which is a dep of @apollo/client and adds @wry/context:Slot
        key.charAt(0) !== '@'
      );
    });

    function getConsoleProxyLog(level) {
      return function () {
        for (var _len = arguments.length, msgs = new Array(_len), _key = 0; _key < _len; _key++) {
          msgs[_key] = arguments[_key];
        }
        // eslint-disable-next-line no-console
        console[level](...msgs);
        log(level, ...msgs.map(msg => String(msg)));
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function deprecatedWrapper(msg, func) {
      return function () {
        log('warn', msg);
        return func(...arguments);
      };
    }

    const consoleApi = {
      log: getConsoleProxyLog('log'),
      warn: getConsoleProxyLog('warn'),
      error: getConsoleProxyLog('error'),
    };
    const inflightPromises = [];
    // create explorer API
    let additionalScriptsCalled = 0;
    let additionalOperationsCalled = 0;
    let maxScriptDepth = previousOperations.length;
    let hasLoggedCryptoJSVersion = false;
    const explorerApi = Object.freeze({
      get CryptoJS() {
        if (!hasLoggedCryptoJSVersion) {
          consoleApi.log(`Using crypto-js version: ${CryptoJSPackageJson.version}`);
          hasLoggedCryptoJSVersion = true;
        }
        return CryptoJS;
      },
      request: {
        body: requestBody,
      },
      response: {
        body: responseBody,
      },
      environment: {
        get(key) {
          return Object.freeze(workingEnvironmentVariables[key]);
        },
        set(key, value) {
          const validValue = getValidEnvVariable(value);
          if (validValue === undefined) {
            delete workingEnvironmentVariables[key];
          } else {
            workingEnvironmentVariables[key] = validValue;
          }
        },
      },
      fetch: (href, options) => {
        const fetchPromise = fetch(href, options).then(response =>
          Object.assign(Object.assign({}, response), {
            json: () => JSON.parse(response.body),
          }),
        );
        inflightPromises.push(fetchPromise);
        return fetchPromise;
      },
      runOperation: _ref3 => {
        let { scope, graphRef, collectionName, operationName, headers, variables } = _ref3;
        if (
          scope !== 'personal' &&
          scope !== 'shared' &&
          scope !== 'sandbox' &&
          scope !== undefined
        ) {
          throw new Error(`invalid scope, must be one of 'personal', 'shared', or 'sandbox'`);
        } else if (typeof graphRef !== 'string' && graphRef !== null && graphRef !== undefined) {
          throw new Error('invalid graphRef');
        } else if (typeof collectionName !== 'string') {
          throw new Error('invalid collectionName');
        } else if (typeof operationName !== 'string') {
          throw new Error('invalid operationName');
        } else if (!isJSONObject(variables) && variables !== undefined) {
          throw new Error('invalid variables');
        } else if (!isValidHeaders(headers) && headers !== undefined) {
          throw new Error('invalid headers');
        }
        const runOperationPromise = runOperation({
          scope,
          graphRef,
          collectionName,
          operationName,
          oauth2Request,
          prompt,
          log,
          environmentVariables: workingEnvironmentVariables,
          previousOperations,
          variables,
          headers,
        }).then(_a => {
          var {
              environmentVariables: updatedEnvironmentVariables,
              additionalScriptsCalled: scriptsCalled,
              additionalOperationsCalled: operationsCalled,
              maxScriptDepth: scriptDepth,
            } = _a,
            rest = __rest(_a, [
              'environmentVariables',
              'additionalScriptsCalled',
              'additionalOperationsCalled',
              'maxScriptDepth',
            ]);
          maxScriptDepth = Math.max(maxScriptDepth, scriptDepth);
          additionalScriptsCalled += scriptsCalled;
          additionalOperationsCalled += operationsCalled;
          // TODO: do we want to only update the changed values?
          workingEnvironmentVariables = Object.assign({}, updatedEnvironmentVariables);
          return rest;
        });
        inflightPromises.push(runOperationPromise);
        return runOperationPromise;
      },
      prompt,
      oauth2Request,
    });
    const deprecatedApi = Object.freeze({
      environment: {
        get: deprecatedWrapper(
          'pm.environment.get is deprecated, please use explorer.environment.get instead',
          key => {
            return Object.freeze(workingEnvironmentVariables[key]);
          },
        ),
        set: deprecatedWrapper(
          'pm.environment.set is deprecated, please use explorer.environment.set instead',
          (key, value) => {
            const validValue = getValidEnvVariable(value);
            if (validValue === undefined) {
              delete workingEnvironmentVariables[key];
            } else {
              workingEnvironmentVariables[key] = validValue;
            }
          },
        ),
      },
      sendRequest: deprecatedWrapper(
        'pm.sendRequest is deprecated, please use explorer.fetch instead',
        (_ref4, callback) => {
          let { url, body, headers, method, credentials } = _ref4;
          inflightPromises.push(
            fetch(url, {
              body,
              headers,
              method,
              credentials,
            }).then(
              response => {
                callback(
                  undefined,
                  Object.assign(Object.assign({}, response), {
                    json: () => JSON.parse(response.body),
                  }),
                );
              },
              err => callback(err),
            ),
          );
        },
      ),
    });
    yield Function.apply({}, [
      'explorer',
      'console',
      'pm',
      // spreading all the variables we want to block creates an argument that shadows the their names, any attempt to access them will result in `undefined`
      ...blockedGlobals,
      // Wrap the users script in an async IIFE to allow the use of top level await
      `
      return (async () => {
        "use strict";
        ${script};
      })()
    `,
      // Bind the function to a null constructor object to prevent `this` leaking scope in
    ]).bind(Object.create(null))(explorerApi, consoleApi, deprecatedApi);
    // For the deprecated callback send request, we need to make sure all promises have settled before returning
    while (inflightPromises.length) {
      // Loop over promises so if new promises are added during waiting, they will also be awaited
      // eslint-disable-next-line no-await-in-loop
      yield inflightPromises.pop();
    }
    return {
      environmentVariables: workingEnvironmentVariables,
      additionalScriptsCalled,
      additionalOperationsCalled,
      maxScriptDepth,
    };
  });
}
