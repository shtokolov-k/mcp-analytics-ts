# @metatuner/mcp-analytics

TypeScript SDK for tracking Model Context Protocol (MCP) events to Metatuner Analytics.

## Features

- 🚀 **Zero dependencies** - Minimal bundle size
- 🎯 **Type-safe** - Full TypeScript support
- 🔄 **Auto-retry** - Exponential backoff retry logic
- 📊 **Flexible tracking** - Automatic or manual event tracking
- 🛡️ **Error handling** - Fail silently in production, debug mode available
- 📦 **Dual format** - ESM and CJS support

## Installation

```bash
npm install @metatuner/mcp-analytics-ts
```

```bash
yarn add @metatuner/mcp-analytics-ts
```

```bash
pnpm add @metatuner/mcp-analytics-ts
```

## Quick Start

### Set your API key

The easiest way is to set the `METATUNER_API_KEY` environment variable:

```bash
export METATUNER_API_KEY="your-api-key-here"
```

The tracker will pick it up automatically — no need to pass it in code.

### Automatic Tracking (Recommended)

Use the `wrap()` method to automatically track invocation, success, and failure events:

```typescript
import { createMCPTracker } from '@metatuner/mcp-analytics-ts';

// Reads METATUNER_API_KEY from env automatically
const tracker = createMCPTracker();

// Wrap your MCP tool function
export const products_list = tracker.wrap(
  'products_list',
  async (params, meta) => {
    // Your tool implementation
    const result = await fetchProducts(params);
    return result;
  },
  {
    getMetadata: (params, meta) => ({
      input: { query: params.query },
      context: { locale: meta?.['openai/locale'] },
    }),
    getOutputMetadata: (result) => ({
      output: { result_count: result.products?.length },
    }),
  }
);
```

### Manual Tracking

For more control, track events manually:

```typescript
import { createMCPTracker } from '@metatuner/mcp-analytics-ts';

const tracker = createMCPTracker();

async function myTool(params) {
  const start = Date.now();

  // Track invocation
  await tracker.trackInvocation('my_tool', {
    input: { query: params.query },
  });

  try {
    const result = await doWork(params);

    // Track success
    await tracker.trackSuccess(
      'my_tool',
      { output: { count: result.length } },
      Date.now() - start
    );

    return result;
  } catch (error) {
    // Track failure
    await tracker.trackFailure(
      'my_tool',
      { error: { message: error.message } },
      Date.now() - start
    );

    throw error;
  }
}
```

## API Reference

### `createMCPTracker(config?)`

Creates a new tracker instance.

**Parameters:**

- `config.apiKey` (string, optional) - Your Metatuner API key. Falls back to the `METATUNER_API_KEY` environment variable. An error is thrown if neither is provided.
- `config.endpoint` (string, optional) - Custom endpoint URL (default: Metatuner backend)
- `config.timeout` (number, optional) - Request timeout in milliseconds (default: 5000)
- `config.retries` (number, optional) - Max retry attempts (default: 3)
- `config.debug` (boolean, optional) - Enable debug logging (default: false)

**Returns:** `MCPTracker` instance

### `tracker.wrap(toolName, fn, options)`

Wraps a function with automatic event tracking.

**Parameters:**

- `toolName` (string, required) - Name of the MCP tool
- `fn` (function, required) - Async function to wrap
- `options` (object, optional):
  - `getMetadata` - Extract metadata from params (called on invocation)
  - `getOutputMetadata` - Extract metadata from result (called on success)
  - `getErrorMetadata` - Extract metadata from error (called on failure)
  - `trackInvocation` - Whether to track invocation events (default: true)
  - `rethrowErrors` - Whether to rethrow errors after tracking (default: true)

**Returns:** Wrapped function with the same signature as `fn`

### `tracker.track(toolName, eventType, metadata?, durationMs?)`

Manually track an event.

**Parameters:**

- `toolName` (string, required) - Name of the MCP tool
- `eventType` ('invocation' | 'success' | 'failure', required) - Type of event
- `metadata` (object, optional) - Custom metadata to attach
- `durationMs` (number, optional) - Duration in milliseconds

**Returns:** `Promise<TrackingResult>`

### Convenience Methods

- `tracker.trackInvocation(toolName, metadata?)` - Track an invocation event
- `tracker.trackSuccess(toolName, metadata?, durationMs?)` - Track a success event
- `tracker.trackFailure(toolName, metadata?, durationMs?)` - Track a failure event

## Configuration

### API Key Resolution

The API key is resolved in this order:

1. `config.apiKey` passed directly
2. `METATUNER_API_KEY` environment variable
3. Throws an error if neither is set

```typescript
// Option 1: env var (recommended) — set METATUNER_API_KEY then:
const tracker = createMCPTracker();

// Option 2: explicit key
const tracker = createMCPTracker({ apiKey: 'your-api-key' });
```

### Debug Mode

Enable debug logging to see what's happening:

```typescript
const tracker = createMCPTracker({
  debug: true, // Logs all tracking attempts and errors
});
```

### Custom Endpoint

Use a custom backend endpoint:

```typescript
const tracker = createMCPTracker({
  endpoint: 'https://your-custom-endpoint.com/track',
});
```

### Retry Configuration

Customize retry behavior:

```typescript
const tracker = createMCPTracker({
  retries: 5,      // Max 5 retry attempts
  timeout: 10000,  // 10 second timeout
});
```

## Rich Metadata Schema

The SDK provides typed interfaces for structured metadata that enables full dashboard functionality. Using the `MCPRichMetadata` type ensures your tracking data is compatible with all dashboard features.

### Metadata Structure

```typescript
import type { MCPRichMetadata } from '@metatuner/mcp-analytics-ts';

const metadata: MCPRichMetadata = {
  input: {
    query: 'wireless headphones',      // Top queries analysis
    brand: 'Sony',                     // Popular filters
    price_max: 200,
  },
  output: {
    result_count: 42,                  // Result metrics
    brands_returned: ['Sony', 'Bose'],
    price_range_returned: { min: 49.99, max: 199.99 },
    response_payload: {
      structuredContent: {
        total: 42,
        source: 'main-catalog',        // Catalog source tracking
        searchTime: 150,               // API performance metrics
        products: [
          {
            title: 'Sony WH-1000XM5',
            brand: 'Sony',
            price: 349.99,
            currency: 'USD',
            category: 'Electronics',   // Category distribution
            inStock: true,             // In-stock rate metrics
          },
        ],
      },
    },
  },
  context: {
    locale: 'en-US',
    location: {
      country: 'US',                   // Geographic distribution
      region: 'CA',
      city: 'San Francisco',
    },
    session_id: 'sess_abc123',
    user_id: 'user_xyz',
  },
  error: {                             // For failure events
    message: 'API timeout',
    code: 'TIMEOUT',
    type: 'NetworkError',
  },
};
```

### Dashboard Features by Metadata Path

| Dashboard Feature | Metadata Path | Tab |
|-------------------|---------------|-----|
| Top Queries | `input.query` | Insights |
| Popular Filters | `input.*` (non-query fields) | Insights |
| Geographic Distribution | `context.location.country` | Insights |
| Result Count Metrics | `output.result_count` | Insights |
| Empty Result Rate | `output.result_count === 0` | Insights |
| API Performance | `output.response_payload.structuredContent.searchTime` | Insights |
| Catalog Source | `output.response_payload.structuredContent.source` | Insights |
| Category Distribution | `products[].category` | Insights |
| In-Stock Rate | `products[].inStock` | Insights & Products |
| Price Range | `output.price_range_returned` | Insights |
| Top Products | `products[].*` | Products |
| Price Trends | `products[].price` by date | Products |
| Category Performance | `products[].category`, `price`, `inStock` | Products |
| Price Distribution | `products[].price` buckets | Products |
| Recent Errors | `error.message` | Tools Table |

### Available Types

```typescript
import type {
  // Core types
  MCPMetadata,           // Generic metadata (Record<string, unknown>)
  MCPRichMetadata,       // Fully typed metadata structure

  // Component types
  MCPInputMetadata,      // Input/query tracking
  MCPOutputMetadata,     // Result/output tracking
  MCPContext,            // User/session context
  MCPErrorMetadata,      // Error information

  // Data types
  MCPLocation,           // Geographic location
  MCPProduct,            // Product data for e-commerce
  MCPStructuredContent,  // Rich response content
} from '@metatuner/mcp-analytics-ts';
```

### Using Rich Metadata with wrap()

```typescript
import { createMCPTracker } from '@metatuner/mcp-analytics-ts';
import type { MCPRichMetadata } from '@metatuner/mcp-analytics-ts';

const tracker = createMCPTracker();

const searchProducts = tracker.wrap(
  'search_products',
  async (params, meta) => {
    const results = await api.search(params);
    return results;
  },
  {
    getMetadata: (params, meta): MCPRichMetadata => ({
      input: {
        query: params.query,
        brand: params.brand,
        category: params.category,
        price_min: params.priceMin,
        price_max: params.priceMax,
      },
      context: {
        locale: meta?.['openai/locale'],
        location: meta?.['openai/userLocation'],
        session_id: meta?.sessionId,
      },
    }),
    getOutputMetadata: (result): MCPRichMetadata => ({
      output: {
        result_count: result.total,
        brands_returned: [...new Set(result.products.map(p => p.brand))],
        price_range_returned: {
          min: Math.min(...result.products.map(p => p.price)),
          max: Math.max(...result.products.map(p => p.price)),
        },
        response_payload: {
          structuredContent: {
            total: result.total,
            source: result.source,
            searchTime: result.timing,
            products: result.products.map(p => ({
              title: p.name,
              brand: p.brand,
              price: p.price,
              currency: p.currency,
              category: p.category,
              inStock: p.available,
              url: p.productUrl,
            })),
          },
        },
      },
    }),
    getErrorMetadata: (error): MCPRichMetadata => ({
      error: {
        message: error.message,
        code: error.code,
        type: error.constructor.name,
      },
    }),
  }
);
```

## Best Practices

### 1. Extract Meaningful Metadata

Capture context that helps debug and analyze tool usage:

```typescript
{
  getMetadata: (params, meta) => ({
    input: {
      query: params.query,
      filters: params.filters,
    },
    context: {
      locale: meta?.['openai/locale'],
      location: meta?.['openai/userLocation'],
      conversation_id: meta?.conversationId,
    },
  }),
}
```

### 2. Track Output Statistics

Include output metrics for performance analysis:

```typescript
{
  getOutputMetadata: (result) => ({
    output: {
      result_count: result.items?.length,
      categories: [...new Set(result.items?.map(i => i.category))],
      has_more: result.hasMore,
    },
  }),
}
```

### 3. Include Error Details

Capture error information for debugging:

```typescript
{
  getErrorMetadata: (error) => ({
    error: {
      message: error.message,
      type: error.constructor.name,
      code: error.code,
    },
  }),
}
```

### 4. Avoid Sensitive Data

Never include sensitive information in metadata:

```typescript
// ❌ DON'T
{
  getMetadata: (params) => ({
    user_password: params.password,  // Never log passwords
    credit_card: params.payment.card,  // Never log payment info
  }),
}

// ✅ DO
{
  getMetadata: (params) => ({
    has_payment_method: !!params.payment,
    user_id: params.userId,  // IDs are fine
  }),
}
```

## Error Handling

The tracker is designed to fail silently to avoid breaking your application:

- Network errors are retried with exponential backoff
- Non-retryable errors (400, 401, 429) are logged but don't throw
- Tracking failures never interrupt your tool's execution
- Enable `debug: true` to see detailed error logs

## TypeScript Support

Full TypeScript support with type inference:

```typescript
import type { MCPMetadata, WrapOptions } from '@metatuner/mcp-analytics-ts';

interface MyParams {
  query: string;
}

interface MyResult {
  items: string[];
}

const wrapped = tracker.wrap<MyParams, MyResult>(
  'my_tool',
  async (params: MyParams) => {
    return { items: ['a', 'b', 'c'] };
  },
  {
    getMetadata: (params) => ({ query: params.query }),
    getOutputMetadata: (result) => ({ count: result.items.length }),
  }
);
```

## Examples

See the [examples](./examples) directory for more usage examples:

- [basic.ts](./examples/basic.ts) - Basic usage examples
- [advanced.ts](./examples/advanced.ts) - Advanced patterns and configurations

## Support

- **Documentation:** [https://metatuner.ai/dev/docs](https://metatuner.ai/dev/docs)
- **Issues:** [GitHub Issues](https://github.com/metatuner/mcp-analytics-ts/issues)
- **Dashboard:** [https://metatuner.ai/dashboard](https://metatuner.ai/dashboard)

## License

MIT
