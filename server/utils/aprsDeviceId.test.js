import { describe, it, expect } from 'vitest';
import { identifyDevice, identifyTocall, identifyMice } from './aprsDeviceId.js';
import { parseAprsPacket } from './aprsParser.js';

describe('identifyTocall', () => {
  it('matches exact tocalls and ignores the SSID', () => {
    expect(identifyTocall('APY310')).toMatchObject({ vendor: 'Yaesu', model: 'FTM-310D', class: 'rig', shown: 'Rig' });
    expect(identifyTocall('apy310-7')).toMatchObject({ model: 'FTM-310D' });
  });

  it('matches ? wildcards (Dire Wolf APDWnn)', () => {
    expect(identifyTocall('APDW18')).toMatchObject({ vendor: 'WB2OSZ', model: 'DireWolf' });
    expect(identifyTocall('APDW1')).toBeNull(); // ? is exactly one character
  });

  it('prefers the longest literal match over a broader pattern', () => {
    // APK0?? is the TH-D7 family; APK003 is an exact entry inside that space
    const exact = identifyTocall('APK003');
    const wild = identifyTocall('APK099');
    expect(exact).not.toBeNull();
    expect(wild).not.toBeNull();
    expect(exact.model).not.toBe(wild.model);
  });

  it('treats lower-case n and * as wildcards', () => {
    expect(identifyTocall('APKEY1')).not.toBeNull(); // APKEYn
    expect(identifyTocall('APZ123')).not.toBeNull(); // APZ* experimental
    expect(identifyTocall('APZ')).not.toBeNull();
  });

  it('drops the upstream "Unknown" placeholders instead of showing them', () => {
    expect(identifyTocall('APRS')).toBeNull(); // vendor Unknown / model Unknown
    expect(identifyTocall('API123')).toEqual({ vendor: 'Icom', class: 'dstar', shown: 'D-Star' }); // model "unknown" dropped
    expect(identifyTocall('APZ001')).toMatchObject({ model: 'Experimental' });
    expect(identifyTocall('APZ001').vendor).toBeUndefined();
  });

  it('returns null for unknown or empty destinations', () => {
    expect(identifyTocall('QQQQQQ')).toBeNull();
    expect(identifyTocall('')).toBeNull();
    expect(identifyTocall(undefined)).toBeNull();
  });
});

describe('identifyMice', () => {
  it('identifies a current Yaesu by its two-character suffix and strips the type bytes', () => {
    expect(identifyMice('`Hello from the hill_3')).toEqual({
      device: { vendor: 'Yaesu', model: 'FT5D', class: 'ht', shown: 'HT' },
      comment: 'Hello from the hill',
    });
  });

  it("accepts the dumb-tracker ' prefix too", () => {
    expect(identifyMice("'_ ")).toMatchObject({ device: { model: 'VX-8' }, comment: '' });
  });

  it('strips an unrecognised type prefix but keeps the text', () => {
    expect(identifyMice('`just text')).toEqual({ device: null, comment: 'just text' });
    expect(identifyMice('`')).toEqual({ device: null, comment: '' });
  });

  it('identifies legacy Kenwoods by prefix and optional suffix', () => {
    expect(identifyMice('>Mobile^')).toMatchObject({
      device: { vendor: 'Kenwood', model: 'TH-D74' },
      comment: 'Mobile',
    });
    expect(identifyMice('>Mobile=')).toMatchObject({ device: { model: 'TH-D72' }, comment: 'Mobile' });
    expect(identifyMice('>Mobile')).toMatchObject({ device: { model: 'TH-D7A' }, comment: 'Mobile' });
    expect(identifyMice(']Truck')).toMatchObject({ device: { model: 'TM-D700' }, comment: 'Truck' });
    expect(identifyMice(']Truck=')).toMatchObject({ device: { model: 'TM-D710' }, comment: 'Truck' });
  });

  it('leaves a comment without a type prefix alone', () => {
    expect(identifyMice('plain text')).toEqual({ device: null, comment: 'plain text' });
    expect(identifyMice('')).toEqual({ device: null, comment: '' });
  });
});

describe('identifyDevice on parsed packets', () => {
  it('uses the Mic-E type bytes, never the encoded destination', () => {
    // S32U6T is an encoded latitude — must not be looked up as a tocall
    const pkt = parseAprsPacket('KE8PLM-7>S32U6T,WIDE1-1:`(_fn"Oj/`KE8PLM mobile_3');
    expect(pkt.packetType).toBe('mic-e');
    const { device, comment } = identifyDevice(pkt);
    expect(device).toMatchObject({ vendor: 'Yaesu', model: 'FT5D' });
    expect(comment).toBe('KE8PLM mobile');
  });

  it('uses the tocall for ordinary position packets and leaves the comment intact', () => {
    const pkt = parseAprsPacket('N8TAG-1>APDW16,WIDE1-1:!3801.56N/08430.09W#Digi + iGate');
    const { device, comment } = identifyDevice(pkt);
    expect(device).toMatchObject({ model: 'DireWolf' });
    expect(comment).toBe('Digi + iGate');
  });

  it('is null-safe', () => {
    expect(identifyDevice(null)).toEqual({ device: null, comment: '' });
    expect(identifyDevice({ packetType: 'position', destination: 'XXXXXX', comment: 'hi' })).toEqual({
      device: null,
      comment: 'hi',
    });
  });
});
