/**
 * DonateButton — single "Support Us" button that opens a modal
 * with Square, PayPal, and merch store links.
 */
import React, { useState, useEffect, useCallback } from 'react';

const SQUARE_URL = 'https://square.link/u/H9HA3PjU';
const PAYPAL_URL = 'https://www.paypal.com/donate/?hosted_button_id=XSXCMP8NMGL5G';
const MERCH_URL = 'https://openhamclock.printify.me';

export default function DonateButton({ compact = false, fontSize = '12px', padding = '6px 10px', tabIndex }) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Support the Patriot Radio Club"
        title="Support the Patriot Radio Club"
        tabIndex={tabIndex}
        style={{
          background: 'linear-gradient(135deg, #ff813f 0%, #ffdd00 100%)',
          border: 'none',
          padding,
          borderRadius: '4px',
          color: '#000',
          fontSize,
          cursor: 'pointer',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          justifyContent: compact ? 'center' : 'flex-start',
          gap: '6px',
          whiteSpace: 'nowrap',
          width: '100%',
        }}
      >
        <span style={{ fontSize: '14px' }}>❤️</span>
        {compact ? '' : ' Support Us'}
      </button>

      {open && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100000,
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="donate-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-secondary, #1a1a2e)',
              border: '1px solid var(--border-color, #333)',
              borderRadius: '12px',
              padding: '28px 32px',
              minWidth: '320px',
              maxWidth: '400px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}
            >
              <h3 id="donate-modal-title" style={{ margin: 0, color: 'var(--text-primary, #eee)', fontSize: '18px' }}>
                Support the Patriot Radio Club
              </h3>
              <button
                type="button"
                onClick={close}
                aria-label="Close support dialog"
                title="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted, #888)',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  lineHeight: 1,
                }}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>

            <p
              style={{ color: 'var(--text-secondary, #aaa)', fontSize: '13px', margin: '0 0 20px 0', lineHeight: 1.5 }}
            >
              This club clock is provided free by the Patriot Radio Club (K1PRC). Your donation helps keep it and the
              club's other services running. Thank you, and 73!
            </p>

            {/* Donate options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a
                href={SQUARE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Donate via Square — secure online donation (opens in new tab)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #3e4348 0%, #000000 100%)',
                  color: '#fff',
                  textDecoration: 'none',
                  fontWeight: '600',
                  fontSize: '14px',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                <span style={{ fontSize: '22px' }}>💵</span>
                <div>
                  <div>Donate via Square</div>
                  <div style={{ fontSize: '11px', fontWeight: '400', opacity: 0.8 }}>Secure online donation</div>
                </div>
              </a>

              <a
                href={PAYPAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Donate via PayPal — secure one-time donation (opens in new tab)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #0070ba 0%, #003087 100%)',
                  color: '#fff',
                  textDecoration: 'none',
                  fontWeight: '600',
                  fontSize: '14px',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                <span style={{ fontSize: '22px' }}>💳</span>
                <div>
                  <div>Donate via PayPal</div>
                  <div style={{ fontSize: '11px', fontWeight: '400', opacity: 0.8 }}>Secure one-time donation</div>
                </div>
              </a>

              <div
                style={{
                  borderTop: '1px solid var(--border-color, #333)',
                  margin: '6px 0 2px 0',
                  paddingTop: '14px',
                }}
              >
                <div
                  style={{
                    color: 'var(--text-muted, #888)',
                    fontSize: '11px',
                    marginBottom: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Support the OpenHamClock software
                </div>
                <a
                  href={MERCH_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="OpenHamClock Merch — supports the open-source OpenHamClock project, not the Patriot Radio Club (opens in new tab)"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    borderRadius: '8px',
                    background: 'var(--bg-tertiary, #252540)',
                    border: '1px solid var(--border-color, #333)',
                    color: 'var(--text-primary, #eee)',
                    textDecoration: 'none',
                    fontWeight: '600',
                    fontSize: '14px',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-green, #00ff88)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-color, #333)')}
                >
                  <span style={{ fontSize: '22px' }}>🛍️</span>
                  <div>
                    <div>OpenHamClock Merch</div>
                    <div style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-muted, #aaa)' }}>
                      Supports the open-source OpenHamClock project
                    </div>
                  </div>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
