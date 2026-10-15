import { describe, it, expect } from 'vitest';
import { toNasaHttpsUrl } from './nasaImageUrl.js';

describe('toNasaHttpsUrl', () => {
  it('keeps an https NASA URL as is', () => {
    const u = 'https://svs.gsfc.nasa.gov/vis/a000000/a005500/a005587/frames/730x730_1x1_30p/moon.6892.jpg';
    expect(toNasaHttpsUrl(u)).toBe(u);
  });

  it('upgrades the plain-http URL Dial-A-Moon returns to https', () => {
    expect(
      toNasaHttpsUrl('http://svs.gsfc.nasa.gov/vis/a000000/a005500/a005587/frames/730x730_1x1_30p/moon.6892.jpg'),
    ).toBe('https://svs.gsfc.nasa.gov/vis/a000000/a005500/a005587/frames/730x730_1x1_30p/moon.6892.jpg');
  });

  it('rejects hosts outside nasa.gov, including look-alikes', () => {
    expect(toNasaHttpsUrl('https://example.com/moon.jpg')).toBeNull();
    expect(toNasaHttpsUrl('https://notnasa.gov/moon.jpg')).toBeNull();
    expect(toNasaHttpsUrl('https://svs.gsfc.nasa.gov.evil.net/moon.jpg')).toBeNull();
    expect(toNasaHttpsUrl('https://user:pw@svs.gsfc.nasa.gov/moon.jpg')).toBeNull();
  });

  it('rejects other schemes and junk', () => {
    expect(toNasaHttpsUrl('ftp://svs.gsfc.nasa.gov/moon.jpg')).toBeNull();
    expect(toNasaHttpsUrl('file:///etc/passwd')).toBeNull();
    expect(toNasaHttpsUrl('not a url')).toBeNull();
    expect(toNasaHttpsUrl('')).toBeNull();
    expect(toNasaHttpsUrl(null)).toBeNull();
    expect(toNasaHttpsUrl(undefined)).toBeNull();
  });
});
