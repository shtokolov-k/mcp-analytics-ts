import { MCPMethod, MCPRawRequest, MCPMetadata } from './types';

// ============================================================================
// Extractor Interface
// ============================================================================

/**
 * A MethodExtractor encapsulates all the knowledge about how to derive
 * analytics data from a specific MCP method's requests and responses.
 *
 * Each method gets its own extractor because:
 *   - tools/call  -> name is params.name, invocation args are params.arguments
 *   - resources/read -> name is params.uri, no invocation args
 *   - prompts/get -> name is params.name, args are params.arguments
 *   - list methods -> name is the method itself, no meaningful params
 *   - completion/complete -> name from params.ref
 */
export interface MethodExtractor {
  /** Derives the event name used for tracking (tool name, URI, prompt name, etc.) */
  extractName(request: MCPRawRequest): string;

  /**
   * Extracts metadata from the request at invocation time.
   * @param captureArguments When true, raw argument values may be included.
   *   When false (default), only non-sensitive shape (key names) is captured.
   */
  extractInvocationMetadata(
    request: MCPRawRequest,
    captureArguments?: boolean,
  ): MCPMetadata | undefined;

  /** Extracts metadata from the successful response. */
  extractOutputMetadata(
    response: unknown,
    request: MCPRawRequest,
  ): MCPMetadata | undefined;

  /** Extracts metadata from an error. */
  extractErrorMetadata(
    error: Error,
    request: MCPRawRequest,
  ): MCPMetadata | undefined;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Returns the appropriate MethodExtractor for the given MCP method.
 */
export function buildExtractor(method: MCPMethod): MethodExtractor {
  switch (method) {
    case 'tools/call':
      return toolsCallExtractor;
    case 'resources/read':
      return resourcesReadExtractor;
    case 'prompts/get':
      return promptsGetExtractor;
    case 'tools/list':
    case 'resources/list':
    case 'prompts/list':
      return buildListExtractor(method);
    case 'completion/complete':
      return completionCompleteExtractor;
    default: {
      const _exhaustive: never = method;
      return buildFallbackExtractor(_exhaustive as string);
    }
  }
}

// ============================================================================
// tools/call Extractor
// ============================================================================

const toolsCallExtractor: MethodExtractor = {
  extractName(request) {
    return request.params?.name ?? 'tools/call';
  },

  extractInvocationMetadata(request, captureArguments) {
    const args = request.params?.arguments;
    if (!args || Object.keys(args).length === 0) return undefined;

    // Default: capture only the shape (key names), never raw values — they
    // may carry user PII/secrets that must not be shipped to analytics.
    if (!captureArguments) {
      return { input: { argument_keys: Object.keys(args) } };
    }

    const queryValue =
      typeof args['query'] === 'string' ? args['query'] :
      typeof args['q'] === 'string' ? args['q'] :
      undefined;

    return {
      input: {
        ...(queryValue !== undefined && { query: queryValue }),
        arguments: args,
      },
    };
  },

  extractOutputMetadata(response) {
    if (!response || typeof response !== 'object') return undefined;
    const res = response as Record<string, unknown>;

    const content = res['content'];
    const resultCount = Array.isArray(content) ? content.length : undefined;

    return {
      output: {
        ...(resultCount !== undefined && { result_count: resultCount }),
        ...(typeof res['isError'] === 'boolean' && { is_error: res['isError'] }),
      },
    };
  },

  extractErrorMetadata(error) {
    return buildErrorMetadata(error);
  },
};

// ============================================================================
// resources/read Extractor
// ============================================================================

const resourcesReadExtractor: MethodExtractor = {
  extractName(request) {
    return request.params?.uri ?? 'resources/read';
  },

  extractInvocationMetadata(request) {
    const uri = request.params?.uri;
    if (!uri) return undefined;
    return { input: { uri } };
  },

  extractOutputMetadata(response) {
    if (!response || typeof response !== 'object') return undefined;
    const res = response as Record<string, unknown>;

    const contents = res['contents'];
    const resultCount = Array.isArray(contents) ? contents.length : undefined;

    return {
      output: {
        ...(resultCount !== undefined && { result_count: resultCount }),
      },
    };
  },

  extractErrorMetadata(error) {
    return buildErrorMetadata(error);
  },
};

// ============================================================================
// prompts/get Extractor
// ============================================================================

const promptsGetExtractor: MethodExtractor = {
  extractName(request) {
    return request.params?.name ?? 'prompts/get';
  },

  extractInvocationMetadata(request, captureArguments) {
    const args = request.params?.arguments;
    if (!args || Object.keys(args).length === 0) return undefined;
    if (!captureArguments) {
      return { input: { argument_keys: Object.keys(args) } };
    }
    return { input: { arguments: args } };
  },

  extractOutputMetadata(response) {
    if (!response || typeof response !== 'object') return undefined;
    const res = response as Record<string, unknown>;

    const messages = res['messages'];
    const messageCount = Array.isArray(messages) ? messages.length : undefined;

    return {
      output: {
        ...(messageCount !== undefined && { result_count: messageCount }),
      },
    };
  },

  extractErrorMetadata(error) {
    return buildErrorMetadata(error);
  },
};

// ============================================================================
// List method Extractor (tools/list, resources/list, prompts/list)
// ============================================================================

function buildListExtractor(method: string): MethodExtractor {
  return {
    extractName() {
      return method;
    },

    extractInvocationMetadata() {
      return undefined;
    },

    extractOutputMetadata(response) {
      if (!response || typeof response !== 'object') return undefined;
      const res = response as Record<string, unknown>;

      const listKey = method.split('/')[0] as 'tools' | 'resources' | 'prompts';
      const list = res[listKey];
      const count = Array.isArray(list) ? list.length : undefined;

      return {
        output: {
          ...(count !== undefined && { result_count: count }),
        },
      };
    },

    extractErrorMetadata(error) {
      return buildErrorMetadata(error);
    },
  };
}

// ============================================================================
// completion/complete Extractor
// ============================================================================

const completionCompleteExtractor: MethodExtractor = {
  extractName(request) {
    const ref = request.params?.ref;
    if (!ref) return 'completion/complete';
    if (ref.type === 'ref/tool' && ref.name) return `completion:tool:${ref.name}`;
    if (ref.type === 'ref/resource' && ref.uri) return `completion:resource:${ref.uri}`;
    if (ref.type === 'ref/prompt' && ref.name) return `completion:prompt:${ref.name}`;
    return 'completion/complete';
  },

  extractInvocationMetadata(request) {
    const ref = request.params?.ref;
    if (!ref) return undefined;
    return { input: { ref } };
  },

  extractOutputMetadata(response) {
    if (!response || typeof response !== 'object') return undefined;
    const res = response as Record<string, unknown>;

    const completion = res['completion'] as Record<string, unknown> | undefined;
    if (!completion) return undefined;

    const values = completion['values'];
    const count = Array.isArray(values) ? values.length : undefined;

    return {
      output: {
        ...(count !== undefined && { result_count: count }),
        ...(typeof completion['total'] === 'number' && { total: completion['total'] }),
        ...(typeof completion['hasMore'] === 'boolean' && { has_more: completion['hasMore'] }),
      },
    };
  },

  extractErrorMetadata(error) {
    return buildErrorMetadata(error);
  },
};

// ============================================================================
// Shared Utilities
// ============================================================================

function buildErrorMetadata(error: Error): MCPMetadata {
  return {
    error: {
      message: error.message,
      type: error.constructor?.name ?? 'Error',
      ...(typeof (error as any).code === 'string' && { code: (error as any).code }),
    },
  };
}

function buildFallbackExtractor(method: string): MethodExtractor {
  return {
    extractName() { return method; },
    extractInvocationMetadata() { return undefined; },
    extractOutputMetadata() { return undefined; },
    extractErrorMetadata(error) { return buildErrorMetadata(error); },
  };
}
