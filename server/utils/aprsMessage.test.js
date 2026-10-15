import { describe, it, expect } from 'vitest';
import { parseAprsMessage, messagesForStation } from './aprsMessage.js';

const line = (body) => `N8TAG-7>APY5D1,WIDE1-1:${body}`;

describe('parseAprsMessage', () => {
  it('parses an addressed message with a message id', () => {
    const m = parseAprsMessage(line(':KE8PLM-9 :see you at the EOC{42'));
    expect(m).toMatchObject({
      type: 'message',
      from: 'N8TAG-7',
      to: 'KE8PLM-9',
      text: 'see you at the EOC',
      msgId: '42',
    });
  });

  it('strips the id when the radio leaves a CR, LF, NUL or space after it (#1212)', () => {
    for (const tail of ['\r', '\n', '\r\n', ' ', '\0', '  \r']) {
      const m = parseAprsMessage(line(`:EMCOMM   :CQ TESTNET AVAILABLE{02${tail}`));
      expect(m.text, JSON.stringify(tail)).toBe('CQ TESTNET AVAILABLE');
      expect(m.msgId, JSON.stringify(tail)).toBe('02');
      expect(m.netCommand, JSON.stringify(tail)).toEqual({
        action: 'checkin',
        netName: 'TESTNET',
        status: 'AVAILABLE',
      });
    }
  });

  it('stays fast on a 50k run of trailing NULs (CodeQL js/polynomial-redos)', () => {
    const t0 = Date.now();
    const m = parseAprsMessage(line(':EMCOMM   :CQ TESTNET{02' + '\0'.repeat(50000)));
    expect(Date.now() - t0).toBeLessThan(200);
    expect(m.text).toBe('CQ TESTNET');
    expect(m.msgId).toBe('02');
  });

  it('understands the APRS 1.2 reply-ack id forms', () => {
    expect(parseAprsMessage(line(':W1AW     :hello{02}'))).toMatchObject({ text: 'hello', msgId: '02' });
    expect(parseAprsMessage(line(':W1AW     :hello{02}AB'))).toMatchObject({ text: 'hello', msgId: '02' });
  });

  it('keeps a brace that is part of the text', () => {
    expect(parseAprsMessage(line(':W1AW     :set {verbose} on'))).toMatchObject({
      text: 'set {verbose} on',
      msgId: null,
    });
  });

  it('parses net check-in and check-out commands to EMCOMM', () => {
    expect(parseAprsMessage(line(':EMCOMM   :CQ TESTNET at the EOC')).netCommand).toEqual({
      action: 'checkin',
      netName: 'TESTNET',
      status: 'AT THE EOC',
    });
    expect(parseAprsMessage(line(':EMCOMM   :cq testnet')).netCommand).toEqual({
      action: 'checkin',
      netName: 'TESTNET',
      status: '',
    });
    expect(parseAprsMessage(line(':EMCOMM   :U TESTNET')).netCommand).toEqual({
      action: 'checkout',
      netName: 'TESTNET',
    });
    expect(parseAprsMessage(line(':W1AW     :CQ TESTNET')).netCommand).toBeNull();
  });

  it('flags bulletins and skips acks, rejs and non-messages', () => {
    expect(parseAprsMessage(line(':BLN1     :Net tonight 1900')).type).toBe('bulletin');
    expect(parseAprsMessage(line(':W1AW     :ack42'))).toBeNull();
    expect(parseAprsMessage(line(':W1AW     :rej42'))).toBeNull();
    expect(parseAprsMessage(line('!4130.00N/08142.00W>'))).toBeNull();
    expect(parseAprsMessage('garbage')).toBeNull();
  });

  it('flags shelter reports only with shelter context (#1219)', () => {
    expect(parseAprsMessage(line(':KE8PLM-9 :How many open Cots are available?')).isShelterReport).toBe(false);
    expect(parseAprsMessage(line(':EMCOMM   :Net is closed for tonight')).isShelterReport).toBe(false);
    expect(parseAprsMessage(line(':EMCOMM   :Shelter open at the high school, 40 beds')).isShelterReport).toBe(true);
    expect(parseAprsMessage(line(':EMCOMM   :Evacuees arriving at the fairgrounds')).isShelterReport).toBe(true);
    expect(parseAprsMessage(line(':EMCOMM   :[Beds 12/20] cots on the floor')).isShelterReport).toBe(true);
  });

  it('extracts resource tokens from the text', () => {
    const m = parseAprsMessage(line(':EMCOMM   :[Beds 12/20] shelter open'));
    expect(m.tokens.map((t) => t.key)).toContain('Beds');
    expect(m.isShelterReport).toBe(true);
  });
});

describe('messagesForStation', () => {
  const msgs = [
    { from: 'KE8PLM-9', to: 'EMCOMM', text: 'CQ TESTNET', timestamp: 100 },
    { from: 'K0CJH', to: 'KE8PLM-9', text: 'Acknowledged', timestamp: 300, direction: 'sent' },
    { from: 'KE8PLM-7', to: 'K0CJH', text: 'from the HT', timestamp: 200 },
    { from: 'W1AW', to: 'BLN1', text: 'unrelated', timestamp: 400 },
  ];
  it("returns both directions for the exact SSID and the operator's other SSIDs, newest first", () => {
    const h = messagesForStation(msgs, 'ke8plm-9');
    expect(h.map((m) => [m.text, m.direction])).toEqual([
      ['Acknowledged', 'sent'],
      ['from the HT', 'received'],
      ['CQ TESTNET', 'received'],
    ]);
  });
  it('is empty for an unknown or blank call and respects the limit', () => {
    expect(messagesForStation(msgs, 'N0XYZ')).toEqual([]);
    expect(messagesForStation(msgs, '')).toEqual([]);
    expect(messagesForStation(msgs, 'KE8PLM', 1)).toHaveLength(1);
  });
});
