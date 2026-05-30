import ivm from 'isolated-vm';

const DEFAULT_TIMEOUT_MS = 100;
const DEFAULT_MEMORY_MB = 16;

export async function executeFunctionInIsolate({
  fn,
  payload,
  variant,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  memoryLimitMb = DEFAULT_MEMORY_MB
}) {
  const executable = toExecutableExpression(fn);

  if (!executable) {
    return {
      variant,
      status: 'skipped',
      durationMs: 0,
      returnValue: null,
      error: {
        name: 'UnsupportedFunctionShape',
        message: `${fn.kind} cannot be executed safely in Phase 4 sandbox mode.`
      }
    };
  }

  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });
  const context = await isolate.createContext();
  const jail = context.global;
  await jail.set('globalThis', jail.derefInto());

  const args = normalizeArgs(payload);
  const scriptSource = buildScriptSource({
    executable,
    args
  });

  try {
    const script = await isolate.compileScript(scriptSource);
    const result = await script.run(context, {
      timeout: timeoutMs,
      copy: true
    });

    return {
      variant,
      status: result.status,
      durationMs: result.durationMs,
      returnValue: result.returnValue ?? null,
      error: result.error ?? null
    };
  } catch (error) {
    return {
      variant,
      status: 'error',
      durationMs: timeoutMs,
      returnValue: null,
      error: {
        name: error.name,
        message: error.message
      }
    };
  } finally {
    context.release();
    isolate.dispose();
  }
}

function normalizeArgs(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.args)) {
    return payload.args;
  }

  return [payload];
}

function buildScriptSource({ executable, args }) {
  return `
    const __btmFn = ${executable};
    const __btmArgs = ${JSON.stringify(args)};
    const __btmStart = Date.now();

    try {
      const __btmValue = __btmFn(...__btmArgs);
      ({
        status: 'returned',
        durationMs: Date.now() - __btmStart,
        returnValue: __btmValue
      });
    } catch (error) {
      ({
        status: 'threw',
        durationMs: Date.now() - __btmStart,
        error: {
          name: error && error.name ? error.name : 'Error',
          message: error && error.message ? error.message : String(error)
        }
      });
    }
  `;
}

function toExecutableExpression(fn) {
  if (fn.kind === 'FunctionDeclaration' || fn.kind === 'FunctionExpression') {
    return `(${fn.code})`;
  }

  if (fn.kind === 'ArrowFunctionExpression') {
    return `(${fn.code})`;
  }

  if (fn.kind === 'ObjectMethod' && fn.name && fn.name !== '<anonymous>') {
    return `({ ${fn.code} })[${JSON.stringify(fn.name)}]`;
  }

  return null;
}
