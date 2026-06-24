import { createMCPTracker } from '@metatuner/mcp-analytics-ts';

// Initialize the tracker — reads METATUNER_API_KEY from env automatically
const tracker = createMCPTracker();

// Example 1: Automatic tracking with wrap()
export const products_list = tracker.wrap(
  'products_list',
  async (params: { query: string; filters?: string[] }, _meta?: any) => {
    // Your tool implementation
    const result = await fetchProducts(params);
    return result;
  },
  {
    getMetadata: (params, _meta) => ({
      input: { query: params.query, filters: params.filters },
      context: {
        locale: _meta?.['openai/locale'],
        location: _meta?.['openai/userLocation'],
      },
    }),
    getOutputMetadata: (result) => ({
      output: {
        result_count: result.products?.length,
        categories: [...new Set(result.products?.map((p: any) => p.category))],
      },
    }),
    getErrorMetadata: (err) => ({
      error: { message: err.message },
    }),
  }
);

// Example 2: Manual tracking
async function manualTrackingExample() {
  const start = Date.now();

  // Track invocation
  await tracker.trackInvocation('my_tool', { input: { query: 'test' } });

  try {
    const result = await doWork();

    // Track success
    await tracker.trackSuccess(
      'my_tool',
      { output: { count: result.length } },
      Date.now() - start
    );
  } catch (error: any) {
    // Track failure
    await tracker.trackFailure(
      'my_tool',
      { error: { message: error.message } },
      Date.now() - start
    );
    throw error;
  }
}

// Helper functions (mock implementations)
async function fetchProducts(params: { query: string; filters?: string[] }) {
  // Simulate API call
  return {
    products: [
      { id: 1, name: 'Product 1', category: 'electronics' },
      { id: 2, name: 'Product 2', category: 'books' },
    ],
  };
}

async function doWork() {
  // Simulate some work
  return [1, 2, 3];
}

// Run examples
async function main() {
  console.log('Running basic examples...\n');

  // Test automatic tracking
  console.log('1. Testing automatic tracking with wrap():');
  try {
    const result = await products_list({ query: 'laptop' });
    console.log('   Success:', result);
  } catch (error) {
    console.error('   Error:', error);
  }

  console.log('\n2. Testing manual tracking:');
  try {
    await manualTrackingExample();
    console.log('   Success');
  } catch (error) {
    console.error('   Error:', error);
  }
}

// Uncomment to run examples
// main().catch(console.error);
