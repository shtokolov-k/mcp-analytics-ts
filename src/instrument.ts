/**
 * MCP SDK instrumentation module.
 *
 * This file contains NO top-level imports from @modelcontextprotocol/sdk.
 * All SDK interaction is done through duck-typed structural interfaces so that
 * this package continues to work without the SDK installed.
 *
 * Supported SDK versions:
 * - v1.x: Server class with setRequestHandler() directly
 * - v2.x: McpServer with a public `server: Server` property
 */
import type { MCPTracker } from './tracker';
import {
  InstrumentOptions,
  InstrumentResult,
  AnyMCPServer,
  MCPServerLike,
  MCPHighLevelServerLike,
  MCPRawHandler,
  MCPRawRequest,
  MCPMethod,
  MCPMetadata,
} from './types';
import { buildExtractor } from './extractors';
import { mergeMetadata, debugLog } from './utils';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_METHODS: MCPMethod[] = [
  'tools/call',
  'resources/read',
  'prompts/get',
  'tools/list',
  'resources/list',
  'prompts/list',
  'completion/complete',
];

/**
 * Global symbol for marking instrumented servers.
 * Symbol.for ensures the same symbol is shared across CJS/ESM module instances.
 */
const INSTRUMENTED_KEY = Symbol.for('@metatuner/mcp-analytics:instrumented');

// ============================================================================
// Public API
// ============================================================================

/**
 * Instruments an existing MCP Server or McpServer instance.
 *
 * Monkey-patches `setRequestHandler` on the underlying Server so that all
 * handlers - including those registered *after* this call - are automatically
 * wrapped with analytics tracking.
 *
 * Accepts both:
 *   - v1: A `Server` instance directly
 *   - v2: A `McpServer` instance (which exposes a `.server: Server` property)
 */
export function instrumentServer(
  target: AnyMCPServer,
  tracker: MCPTracker,
  options: InstrumentOptions = {},
  debug: boolean = false,
): InstrumentResult {
  const server = resolveServer(target);

  if (INSTRUMENTED_KEY in (server as any)) {
    debugLog(debug, 'Server already instrumented, skipping');
    return { uninstrument: () => {} };
  }

  (server as any)[INSTRUMENTED_KEY] = true;

  const methods = new Set<string>(options.methods ?? DEFAULT_METHODS);

  // Save the original before patching
  const originalSetRequestHandler = server.setRequestHandler.bind(server);

  // Patch setRequestHandler to wrap tracked methods with analytics
  (server as any).setRequestHandler = function patchedSetRequestHandler(
    schema: unknown,
    handler: MCPRawHandler,
  ): void {
    const method = extractMethodFromSchema(schema);

    if (method && methods.has(method)) {
      debugLog(debug, `[instrument] Wrapping handler for method: ${method}`);
      originalSetRequestHandler(
        schema,
        buildInstrumentedHandler(method as MCPMethod, handler, tracker, options, debug),
      );
    } else {
      if (method === undefined && schema && typeof schema === 'object') {
        // Object schema we couldn't parse: SDK/Zod shape likely changed.
        // Handler is left untracked silently otherwise — warn in debug mode.
        debugLog(debug, '[instrument] Could not extract MCP method from schema; ' +
          'handler left untracked (SDK/Zod schema shape may have changed).');
      }
      originalSetRequestHandler(schema, handler);
    }
  };

  // Re-wrap handlers that were registered before instrument() was called (McpServer v2)
  refreshExistingHandlers(target, server, methods);

  return {
    uninstrument(): void {
      (server as any).setRequestHandler = originalSetRequestHandler;
      delete (server as any)[INSTRUMENTED_KEY];
    },
  };
}

// ============================================================================
// Internal: Server Resolution
// ============================================================================

function resolveServer(target: AnyMCPServer): MCPServerLike {
  if (isHighLevelServer(target)) {
    return target.server;
  }
  if (typeof (target as any).setRequestHandler === 'function') {
    return target as MCPServerLike;
  }
  throw new Error(
    '[MCPTracker] instrument() received an object that is neither a v1 Server ' +
    'nor a v2 McpServer. Ensure @modelcontextprotocol/sdk is installed and ' +
    'the passed object is a valid server instance.',
  );
}

function isHighLevelServer(target: AnyMCPServer): target is MCPHighLevelServerLike {
  return (
    typeof target === 'object' &&
    target !== null &&
    'server' in target &&
    typeof (target as any).server?.setRequestHandler === 'function'
  );
}

/**
 * Extracts the method string from the Zod schema object the SDK uses.
 * The schema shape is: { shape: { method: { value: 'tools/call' } } }
 */
function extractMethodFromSchema(schema: unknown): string | undefined {
  // Fallback: schema might be a plain string (custom usage)
  if (typeof schema === 'string') return schema;
  if (!schema || typeof schema !== 'object') return undefined;
  // Zod schema pattern used by the MCP SDK
  const s = schema as any;
  if (s.shape?.method?.value) return s.shape.method.value;
  return undefined;
}

// ============================================================================
// Internal: Handler Wrapping
// ============================================================================

function buildInstrumentedHandler(
  method: MCPMethod,
  originalHandler: MCPRawHandler,
  tracker: MCPTracker,
  options: InstrumentOptions,
  debug: boolean,
): MCPRawHandler {
  const extractor = buildExtractor(method);
  const excludeSet = new Set<string>(options.exclude ?? []);
  const captureArguments = options.captureArguments ?? false;

  return async function instrumentedHandler(
    request: MCPRawRequest,
    ctx: unknown,
  ): Promise<unknown> {
    const eventName = extractor.extractName(request);

    // Check exclusion list
    if (excludeSet.has(eventName)) {
      return originalHandler(request, ctx);
    }

    // Resolve per-handler override
    const override = options.overrides?.[eventName];
    const shouldTrackInvocation = override?.trackInvocation ?? true;

    // Build invocation metadata
    const invocationMetadata = safeExtractMetadata(debug, eventName, 'invocation', () => {
      const globalMeta = options.getGlobalMetadata?.(request);
      const defaultMeta = extractor.extractInvocationMetadata(request, captureArguments);
      const overrideMeta = override?.getMetadata?.(request);
      return mergeMetadata(globalMeta, defaultMeta, overrideMeta);
    });

    const startTime = Date.now();

    if (shouldTrackInvocation) {
      // Fire-and-forget: never block the MCP handler on analytics network calls
      tracker.trackInvocation(eventName, invocationMetadata).catch(err =>
        debugLog(debug, `Unhandled tracking error (invocation) for "${eventName}":`, err),
      );
    }

    try {
      const result = await originalHandler(request, ctx);
      const duration = Date.now() - startTime;

      const outputMetadata = safeExtractMetadata(debug, eventName, 'output', () => {
        const defaultMeta = extractor.extractOutputMetadata(result, request);
        const overrideMeta = override?.getOutputMetadata?.(result, request);
        return mergeMetadata(defaultMeta, overrideMeta);
      });

      const successMetadata = mergeMetadata(invocationMetadata, outputMetadata);
      tracker.trackSuccess(eventName, successMetadata, duration).catch(err =>
        debugLog(debug, `Unhandled tracking error (success) for "${eventName}":`, err),
      );

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      const errorMetadata = safeExtractMetadata(debug, eventName, 'error', () => {
        const defaultMeta = extractor.extractErrorMetadata(error, request);
        const overrideMeta = override?.getErrorMetadata?.(error, request);
        return mergeMetadata(defaultMeta, overrideMeta);
      });

      const failureMetadata = mergeMetadata(invocationMetadata, errorMetadata);
      tracker.trackFailure(eventName, failureMetadata, duration).catch(err =>
        debugLog(debug, `Unhandled tracking error (failure) for "${eventName}":`, err),
      );

      // Always rethrow - the MCP server must receive the error
      throw error;
    }
  };
}

// ============================================================================
// Internal: Safe Metadata Extraction
// ============================================================================

function safeExtractMetadata(
  debug: boolean,
  eventName: string,
  phase: string,
  fn: () => MCPMetadata | undefined,
): MCPMetadata | undefined {
  try {
    return fn();
  } catch (error: any) {
    debugLog(debug, `Error extracting ${phase} metadata for "${eventName}":`, error);
    return undefined;
  }
}

// ============================================================================
// Internal: Re-wrap pre-registered handlers (McpServer v2)
// ============================================================================

/**
 * For McpServer v2, handlers may already be registered before instrument() is called.
 * This function resets the initialization guards and forces re-registration
 * through the now-patched setRequestHandler.
 */
function refreshExistingHandlers(
  target: AnyMCPServer,
  server: MCPServerLike,
  trackedMethods: Set<string>,
): void {
  const mcpServer = target as any;

  const hasToolGuard = '_toolHandlersInitialized' in mcpServer;
  const hasResourceGuard = '_resourceHandlersInitialized' in mcpServer;
  const hasPromptGuard = '_promptHandlersInitialized' in mcpServer;

  // Only applies to McpServer v2
  if (!hasToolGuard && !hasResourceGuard && !hasPromptGuard) return;

  // Collect which reinit functions are available before removing anything
  const reinitPairs: Array<{ guard: string; reinit: () => void }> = [];

  if (hasToolGuard && mcpServer._toolHandlersInitialized &&
      typeof mcpServer.setToolRequestHandlers === 'function') {
    reinitPairs.push({ guard: '_toolHandlersInitialized', reinit: () => mcpServer.setToolRequestHandlers() });
  }
  if (hasResourceGuard && mcpServer._resourceHandlersInitialized &&
      typeof mcpServer.setResourceRequestHandlers === 'function') {
    reinitPairs.push({ guard: '_resourceHandlersInitialized', reinit: () => mcpServer.setResourceRequestHandlers() });
  }
  if (hasPromptGuard && mcpServer._promptHandlersInitialized &&
      typeof mcpServer.setPromptRequestHandlers === 'function') {
    reinitPairs.push({ guard: '_promptHandlersInitialized', reinit: () => mcpServer.setPromptRequestHandlers() });
  }

  // Only remove and re-register if we confirmed at least one reinit function exists
  if (reinitPairs.length === 0) return;

  // Only remove handlers that a reinit path will re-register. Methods with no
  // reinit (e.g. completion/complete, registered outside these three groups)
  // must NOT be removed, or they would be lost permanently.
  const methodsToRefresh = new Set<string>();
  for (const { guard } of reinitPairs) {
    for (const m of GUARD_METHODS[guard]) {
      if (trackedMethods.has(m)) methodsToRefresh.add(m);
    }
  }

  for (const method of methodsToRefresh) {
    try {
      server.removeRequestHandler?.(method);
    } catch {
      // Handler may not be registered yet
    }
  }

  for (const { guard, reinit } of reinitPairs) {
    mcpServer[guard] = false;
    reinit();
  }
}

/** Maps each McpServer v2 init guard to the methods its reinit re-registers. */
const GUARD_METHODS: Record<string, MCPMethod[]> = {
  _toolHandlersInitialized: ['tools/call', 'tools/list'],
  _resourceHandlersInitialized: ['resources/read', 'resources/list'],
  _promptHandlersInitialized: ['prompts/get', 'prompts/list'],
};
