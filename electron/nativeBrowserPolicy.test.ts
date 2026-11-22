import { describe, expect, it } from 'vitest';
import { isNativePartition, isWebUrl, shouldOpenInTab } from './nativeBrowserPolicy.cjs';

describe('native browser policy', () => {
  it('accepts only http(s) navigation targets', () => {
    expect(isWebUrl('https://example.com/a')).toBe(true);
    expect(isWebUrl('http://localhost:3000')).toBe(true);
    expect(isWebUrl('file:///etc/passwd')).toBe(false);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('about:blank')).toBe(false);
    expect(isWebUrl('')).toBe(false);
  });

  it('sends target=_blank to a new tab only for allowed web links', () => {
    expect(shouldOpenInTab('https://example.com/x')).toBe(true);
    expect(shouldOpenInTab('http://127.0.0.1:8080/a')).toBe(true);
    expect(shouldOpenInTab('javascript:alert(1)')).toBe(false);
    expect(shouldOpenInTab('file:///C:/Windows')).toBe(false);
    expect(shouldOpenInTab('mailto:hola@example.com')).toBe(false);
    expect(shouldOpenInTab('about:blank')).toBe(false);
    // Lo que bloquea EasyList no gana una pestaña solo por abrirse en otra pestaña.
    expect(shouldOpenInTab('https://ads.example.com/x', () => true)).toBe(false);
    expect(shouldOpenInTab('https://example.com/x', () => false)).toBe(true);
  });

  it('only embeds pages in the per-site sessions the app owns', () => {
    expect(isNativePartition('persist:terminus-site-example.com')).toBe(true);
    expect(isNativePartition('persist:terminus-site-unknown')).toBe(true);
    expect(isNativePartition('persist:terminus-shared')).toBe(true);
    expect(isNativePartition('persist:other')).toBe(false);
    expect(isNativePartition('')).toBe(false);
    expect(isNativePartition(undefined as unknown as string)).toBe(false);
  });
});
