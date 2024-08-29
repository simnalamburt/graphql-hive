import { ALLOWED_GLOBALS } from './allowed-globals';
import { isJSONPrimitive } from './json';

function getValidEnvVariable(value) {
  if (Array.isArray(value)) {
    return value.map(v => {
      var _a;
      return (_a = getValidEnvVariable(v)) !== null && _a !== void 0 ? _a : null;
    });
  }
  if (typeof value === 'object' && value) {
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
  console.log(
    'You tried to set a non primitive type in env variables, only string, boolean, number, null, object, or arrays are allowed in env variables. The value has been filtered out',
  );
}

export async function execute({
  environmentVariables,
  script,
}: {
  environmentVariables: Record<string, string>;
  script: string;
}) {
  const inWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
  // Confirm the build pipeline worked and this is running inside a worker and not the main thread
  if (!inWorker) {
    throw new Error(
      'Preflight and postflight scripts must always be run in web workers, this is a problem with laboratory not user input',
    );
  }

  // When running in worker `environmentVariables` will not be a reference to the main thread value
  // but sometimes this will be tested outside the worker, so we don't want to mutate the input in that case
  const workingEnvironmentVariables = Object.assign({}, environmentVariables);
  // List all variables that we want to allow users to use inside their scripts
  const allowedGlobals = [
    ...ALLOWED_GLOBALS,
    // We aren't allowing access to window.console, but we need to "allow" it
    // here so a second argument isn't added for it below.
    'console',
  ];
  // generate list of all in scope variables, we do getOwnPropertyNames and `for in` because each contain slightly different sets of keys
  const allGlobalKeys = Object.getOwnPropertyNames(globalThis);
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
      // window has references as indexes on the globalThis such as `globalThis[0]`, numbers are not valid arguments, so we need to filter these out
      Number.isNaN(Number(key)) &&
      // @ is not a valid argument name beginning character, so we don't need to block it and including it will cause a syntax error
      // only example currently is @wry/context which is a dep of @apollo/client and adds @wry/context:Slot
      key.charAt(0) !== '@'
    );
  });

  const messages = [];

  function log(level: string, ...msgs: unknown[]) {
    messages.push(`${level}: ${msgs.join(' ')}`);
  }

  function getConsoleProxyLog(level: string) {
    return function () {
      for (var _len = arguments.length, msgs = new Array(_len), _key = 0; _key < _len; _key++) {
        msgs[_key] = arguments[_key];
      }
      log(level, ...msgs.map(msg => String(msg)));
    };
  }

  const consoleApi = Object.freeze({
    log: getConsoleProxyLog('log'),
    warn: getConsoleProxyLog('warn'),
    error: getConsoleProxyLog('error'),
  });

  const labApi = Object.freeze({
    environment: {
      get(key: string) {
        return Object.freeze(workingEnvironmentVariables[key]);
      },
      set(key: string, value: string) {
        const validValue = getValidEnvVariable(value);
        if (validValue === undefined) {
          delete workingEnvironmentVariables[key];
        } else {
          workingEnvironmentVariables[key] = validValue;
        }
      },
    },
    fetch(href, options) {
      return fetch(href, options).then(response =>
        Object.assign(Object.assign({}, response), {
          json: () => JSON.parse(response.body),
        }),
      );
    },
  });

  try {
    await Function.apply({}, [
      'lab',
      'console',
      // spreading all the variables we want to block creates an argument that shadows the their names, any attempt to access them will result in `undefined`
      ...blockedGlobals,
      // Wrap the users script in an async IIFE to allow the use of top level await
      `return (async () => {
  "use strict";
  ${script}
})()`,
      // Bind the function to a null constructor object to prevent `this` leaking scope in
    ]).bind(Object.create(null))(labApi, consoleApi);
  } catch (error: any) {
    messages.push(`${error.constructor.name}: ${error.message}`);
  }

  return {
    environmentVariables: workingEnvironmentVariables,
    logs: messages,
    // additionalScriptsCalled,
    // additionalOperationsCalled,
    // maxScriptDepth,
  };
}
