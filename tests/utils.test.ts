import { describe, it, expect } from 'vitest';
import { mergeMetadata, isRetryableError } from '../src/utils';

describe('mergeMetadata', () => {
  it('should merge multiple metadata objects', () => {
    const result = mergeMetadata(
      { a: 1, b: 2 },
      { b: 3, c: 4 },
      { d: 5 }
    );
    expect(result).toEqual({ a: 1, b: 3, c: 4, d: 5 });
  });

  it('should handle undefined values', () => {
    const result = mergeMetadata(
      { a: 1 },
      undefined,
      { b: 2 }
    );
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('should return empty object if all inputs are undefined', () => {
    const result = mergeMetadata(undefined, undefined);
    expect(result).toEqual({});
  });

  it('should deep merge one level for object values', () => {
    const result = mergeMetadata(
      { input: { query: 'shoes', limit: 10 } },
      { input: { brand: 'Nike' }, output: { count: 5 } },
    );
    expect(result).toEqual({
      input: { query: 'shoes', limit: 10, brand: 'Nike' },
      output: { count: 5 },
    });
  });

  it('should overwrite scalar values from nested objects', () => {
    const result = mergeMetadata(
      { input: { query: 'shoes' } },
      { input: { query: 'boots' } },
    );
    expect(result).toEqual({ input: { query: 'boots' } });
  });

  it('should not deep merge arrays', () => {
    const result = mergeMetadata(
      { tags: ['a', 'b'] },
      { tags: ['c'] },
    );
    expect(result).toEqual({ tags: ['c'] });
  });
});

describe('isRetryableError', () => {
  it('should retry network errors', () => {
    const error = new TypeError('fetch failed');
    expect(isRetryableError(error)).toBe(true);
  });

  it('should not retry 400 errors', () => {
    const error: any = new Error('Bad Request');
    error.status = 400;
    expect(isRetryableError(error)).toBe(false);
  });

  it('should not retry 401 errors', () => {
    const error: any = new Error('Unauthorized');
    error.status = 401;
    expect(isRetryableError(error)).toBe(false);
  });

  it('should not retry 429 errors', () => {
    const error: any = new Error('Too Many Requests');
    error.status = 429;
    expect(isRetryableError(error)).toBe(false);
  });

  it('should retry 500 errors', () => {
    const error: any = new Error('Internal Server Error');
    error.status = 500;
    expect(isRetryableError(error)).toBe(true);
  });

  it('should retry 503 errors', () => {
    const error: any = new Error('Service Unavailable');
    error.status = 503;
    expect(isRetryableError(error)).toBe(true);
  });

  it('should retry unknown errors by default', () => {
    const error = new Error('Unknown error');
    expect(isRetryableError(error)).toBe(true);
  });
});
