import { createMCPTracker } from '@metatuner/mcp-analytics-ts';

// Initialize tracker — API key is read from METATUNER_API_KEY env var by default
const tracker = createMCPTracker({
  endpoint: 'https://custom.example.com/track', // Optional: use custom endpoint
  timeout: 10000,  // Optional: custom timeout (default: 5000ms)
  retries: 5,      // Optional: custom retry count (default: 3)
  debug: true,     // Optional: enable debug logging (default: false)
});

// Example 1: Complex metadata extraction
interface SearchParams {
  query: string;
  page?: number;
  limit?: number;
  filters?: {
    category?: string[];
    priceRange?: { min: number; max: number };
  };
}

interface SearchResult {
  items: any[];
  total: number;
  page: number;
  hasMore: boolean;
}

export const search_products = tracker.wrap(
  'search_products',
  async (params: SearchParams, meta?: any): Promise<SearchResult> => {
    // Your implementation
    const results = await performSearch(params);
    return results;
  },
  {
    getMetadata: (params, meta) => ({
      input: {
        query: params.query,
        pagination: {
          page: params.page || 1,
          limit: params.limit || 10,
        },
        filters: params.filters,
      },
      context: {
        user_id: meta?.userId,
        session_id: meta?.sessionId,
        locale: meta?.['openai/locale'],
        ip_country: meta?.['openai/userLocation']?.country,
      },
    }),
    getOutputMetadata: (result) => ({
      output: {
        result_count: result.items.length,
        total_available: result.total,
        page: result.page,
        has_more: result.hasMore,
      },
      performance: {
        results_per_page: result.items.length,
      },
    }),
    getErrorMetadata: (error) => ({
      error: {
        message: error.message,
        type: error.constructor.name,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'), // First 3 lines
      },
    }),
  }
);

// Example 2: Conditional invocation tracking
export const cached_lookup = tracker.wrap(
  'cached_lookup',
  async (params: { key: string }, meta?: any) => {
    // Check cache first
    const cached = await getFromCache(params.key);
    if (cached) {
      return { data: cached, fromCache: true };
    }

    // Fetch from database
    const data = await fetchFromDatabase(params.key);
    await saveToCache(params.key, data);
    return { data, fromCache: false };
  },
  {
    trackInvocation: false, // Don't track invocation for cached lookups
    getMetadata: (params) => ({
      input: { key: params.key },
    }),
    getOutputMetadata: (result) => ({
      output: {
        cache_hit: result.fromCache,
      },
    }),
  }
);

// Example 3: Error handling without rethrowing
export const optional_enrichment = tracker.wrap(
  'optional_enrichment',
  async (params: { data: any }) => {
    // This operation is optional, so we don't want to fail if it errors
    const enriched = await enrichData(params.data);
    return enriched;
  },
  {
    rethrowErrors: false, // Don't rethrow errors - return undefined instead
    getMetadata: (params) => ({
      input: { data_size: JSON.stringify(params.data).length },
    }),
  }
);

// Example 4: Using multiple trackers for different environments
const productionTracker = createMCPTracker({
  apiKey: process.env.PROD_API_KEY || '',
  debug: false,
});

const developmentTracker = createMCPTracker({
  apiKey: process.env.DEV_API_KEY || '',
  debug: true,
});

const trackerForEnv = process.env.NODE_ENV === 'production'
  ? productionTracker
  : developmentTracker;

export const environment_aware_tool = trackerForEnv.wrap(
  'environment_aware_tool',
  async (params: any) => {
    // Your implementation
    return { success: true };
  }
);

// Example 5: Batching and aggregating metadata
interface BatchParams {
  items: string[];
}

export const batch_process = tracker.wrap(
  'batch_process',
  async (params: BatchParams) => {
    const results = await Promise.all(
      params.items.map(item => processItem(item))
    );
    return results;
  },
  {
    getMetadata: (params) => ({
      input: {
        batch_size: params.items.length,
        sample_items: params.items.slice(0, 3), // First 3 items
      },
    }),
    getOutputMetadata: (results) => {
      const successful = results.filter(r => r.success).length;
      const failed = results.length - successful;
      return {
        output: {
          total_processed: results.length,
          successful,
          failed,
          success_rate: (successful / results.length) * 100,
        },
      };
    },
    getErrorMetadata: (error) => ({
      error: {
        message: error.message,
        occurred_at: new Date().toISOString(),
      },
    }),
  }
);

// Mock implementations
async function performSearch(params: SearchParams): Promise<SearchResult> {
  return {
    items: [],
    total: 0,
    page: params.page || 1,
    hasMore: false,
  };
}

async function getFromCache(key: string): Promise<any> {
  return null;
}

async function fetchFromDatabase(key: string): Promise<any> {
  return { data: 'value' };
}

async function saveToCache(key: string, data: any): Promise<void> {
  // Save to cache
}

async function enrichData(data: any): Promise<any> {
  return { ...data, enriched: true };
}

async function processItem(item: string): Promise<{ success: boolean }> {
  return { success: true };
}
