import { describe, expect, it } from 'vitest';
import { isNativePartition, isWebUrl } from './nativeBrowserPolicy.cjs';

describe('native browser policy', () => {
  it('accepts only http(s) navigation targets', () => {
    expect(isWebUrl('https://example.com/a')).toBe(true);
    expect(isWebUrl('http://localhost:3000')).toBe(true);
    expect(isWebUrl('file:///etc/passwd')).toBe(false);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('about:blank')).toBe(false);
    expect(isWebUrl('')).toBe(false);
  });

  it('only embeds pages in the per-site sessions the app owns', () => {
    expect(isNativePartition('persist:terminus-site-example.com')).toBe(true);
    expect(isNativePartition('persist:terminus-site-unknown')).toBe(true);
    expect(isNativePartition('persist:other')).toBe(false);
    expect(isNativePartition('')).toBe(false);
    expect(isNativePartition(undefined as unknown as string)).toBe(false);
  });
});
