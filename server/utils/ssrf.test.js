import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'dns';
import { isPrivateIP, validateCustomHost } from './ssrf.js';

afterEach(() => vi.restoreAllMocks());

describe('isPrivateIP', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '100.127.255.254',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd12:3456::1',
    'fc00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
  ])('%s is private', (ip) => expect(isPrivateIP(ip)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '100.128.0.1', '1.1.1.1', '2606:4700::1111'])('%s is public', (ip) =>
    expect(isPrivateIP(ip)).toBe(false),
  );
});

describe('validateCustomHost', () => {
  it('self-hosted default keeps localhost and LAN literals', async () => {
    expect(await validateCustomHost('localhost')).toEqual({ ok: true, resolvedIP: '127.0.0.1' });
    expect(await validateCustomHost('192.168.1.20')).toEqual({ ok: true, resolvedIP: '192.168.1.20' });
  });

  it('allowPrivate:false refuses localhost and private literals', async () => {
    expect((await validateCustomHost('localhost', { allowPrivate: false })).ok).toBe(false);
    expect((await validateCustomHost('127.0.0.1', { allowPrivate: false })).ok).toBe(false);
    expect((await validateCustomHost('10.0.0.5', { allowPrivate: false })).ok).toBe(false);
    expect((await validateCustomHost('169.254.169.254', { allowPrivate: false })).ok).toBe(false);
    expect(await validateCustomHost('8.8.8.8', { allowPrivate: false })).toEqual({ ok: true, resolvedIP: '8.8.8.8' });
  });

  it('allowPrivate:false refuses a name if ANY resolved address is private', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34', '127.0.0.1']);
    expect((await validateCustomHost('rebind.example', { allowPrivate: false })).ok).toBe(false);
  });

  it('allowPrivate:false accepts a name that resolves only to public addresses', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    expect(await validateCustomHost('wavelog.example', { allowPrivate: false })).toEqual({
      ok: true,
      resolvedIP: '93.184.216.34',
    });
  });

  it('self-hosted default still accepts names resolving to LAN addresses', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['192.168.1.50']);
    expect(await validateCustomHost('wavelog.lan')).toEqual({ ok: true, resolvedIP: '192.168.1.50' });
  });
});
