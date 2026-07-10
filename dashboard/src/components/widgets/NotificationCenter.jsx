'use client';

import React, { useState, useCallback } from 'react';
import { Bell, X, AlertTriangle, CheckCircle2, Info, Cpu } from 'lucide-react';

/**
 * NotificationCenter — Bell icon with dropdown showing recent notifications.
 * Notifications arrive via WebSocket log events with the notification prefix.
 */
export default function NotificationCenter({ logs = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState(new Set());

  // Filter logs that are notifications
  const notifications = logs
    .filter(log => {
      if (!log.text) return false;
      return log.text.includes('[Proactive Notify]') ||
             log.text.includes('[Notification]') ||
             log.text.includes('completed') ||
             log.text.includes('⚠️');
    })
    .filter(log => !dismissedIds.has(log.text + (log.timestamp || '')))
    .slice(-20)
    .reverse();

  const unreadCount = notifications.length;

  const dismiss = useCallback((id) => {
    setDismissedIds(prev => new Set([...prev, id]));
  }, []);

  const dismissAll = useCallback(() => {
    const ids = new Set(notifications.map(n => n.text + (n.timestamp || '')));
    setDismissedIds(prev => new Set([...prev, ...ids]));
  }, [notifications]);

  const getIcon = (text) => {
    if (text.includes('[ERROR]') || text.includes('error')) return <AlertTriangle size={12} style={{ color: 'var(--accent-danger)' }} />;
    if (text.includes('[WARN]') || text.includes('warning')) return <AlertTriangle size={12} style={{ color: 'var(--accent-warning)' }} />;
    if (text.includes('completed') || text.includes('success')) return <CheckCircle2 size={12} style={{ color: 'var(--accent-success)' }} />;
    if (text.includes('token') || text.includes('metric')) return <Cpu size={12} style={{ color: 'var(--accent-info)' }} />;
    return <Info size={12} style={{ color: 'var(--text-tertiary)' }} />;
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'none', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          color: 'var(--text-secondary)', padding: '6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: '-3px', right: '-3px',
            width: '16px', height: '16px', borderRadius: '50%',
            background: 'var(--accent-primary)', color: '#fff',
            fontSize: '0.58rem', fontWeight: '700',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div onClick={() => setIsOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '8px',
            width: '320px', maxHeight: '380px',
            background: 'var(--surface-elevated)',
            backdropFilter: 'blur(25px)', WebkitBackdropFilter: 'blur(25px)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            zIndex: 55, overflow: 'hidden',
            animation: 'scale-in var(--duration-150) var(--ease-out-expo) both',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)',
            }}>
              <span style={{ fontWeight: '600', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                Notifications {unreadCount > 0 && `(${unreadCount})`}
              </span>
              {unreadCount > 0 && (
                <button onClick={dismissAll} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', fontSize: '0.68rem',
                }}>
                  Clear all
                </button>
              )}
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', maxHeight: '320px' }}>
              {notifications.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                  No notifications
                </div>
              ) : (
                notifications.map((notif, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
                    fontSize: '0.72rem', color: 'var(--text-primary)',
                  }}>
                    <div style={{ marginTop: '2px', flexShrink: 0 }}>
                      {getIcon(notif.text)}
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', lineHeight: 1.4,
                      }}>
                        {notif.text.replace('[Proactive Notify] ', '')}
                      </div>
                      {notif.timestamp && (
                        <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                          {notif.timestamp}
                        </div>
                      )}
                    </div>
                    <button onClick={() => dismiss(notif.text + (notif.timestamp || ''))} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-tertiary)', padding: '2px', flexShrink: 0,
                    }}>
                      <X size={10} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
