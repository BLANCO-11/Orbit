// @ts-nocheck
'use client';

import React, { useState, useCallback } from 'react';
import { Bell, X, AlertTriangle, CheckCircle2, Info, Cpu } from 'lucide-react';

/**
 * NotificationCenter — bell + dropdown of recent notification-flavored logs.
 */
export default function NotificationCenter({ logs = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState(new Set());

  const notifications = logs
    .filter((log) => {
      if (!log.text) return false;
      return log.text.includes('[Proactive Notify]') || log.text.includes('[Notification]') || log.text.includes('completed') || log.text.includes('⚠️');
    })
    .filter((log) => !dismissedIds.has(log.text + (log.timestamp || '')))
    .slice(-20)
    .reverse();

  const unreadCount = notifications.length;

  const dismiss = useCallback((id) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  }, []);

  const dismissAll = useCallback(() => {
    const ids = new Set(notifications.map((n) => n.text + (n.timestamp || '')));
    setDismissedIds((prev) => new Set([...prev, ...ids]));
  }, [notifications]);

  const getIcon = (text) => {
    if (text.includes('[ERROR]') || text.includes('error')) return <AlertTriangle size={13} className="text-destructive" />;
    if (text.includes('[WARN]') || text.includes('warning')) return <AlertTriangle size={13} className="text-warning" />;
    if (text.includes('completed') || text.includes('success')) return <CheckCircle2 size={13} className="text-success" />;
    if (text.includes('token') || text.includes('metric')) return <Cpu size={13} className="text-info" />;
    return <Info size={13} className="text-faint" />;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Notifications"
        title="Notifications"
        className="relative grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-primary text-[9.5px] font-bold text-primary-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div onClick={() => setIsOpen(false)} className="fixed inset-0 z-50" />
          <div className="absolute right-0 top-[calc(100%+8px)] z-[55] w-80 overflow-hidden rounded-xl border border-border bg-popover shadow-float">
            <div className="flex items-center justify-between border-b border-border-soft px-3.5 py-2.5">
              <span className="text-[13px] font-semibold">
                Notifications {unreadCount > 0 && <span className="text-faint">({unreadCount})</span>}
              </span>
              {unreadCount > 0 && (
                <button onClick={dismissAll} className="text-[11.5px] font-medium text-faint hover:text-foreground">
                  Clear all
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-xs text-faint">You're all caught up.</div>
              ) : (
                notifications.map((notif, i) => (
                  <div key={i} className="flex items-start gap-2.5 border-b border-border-soft px-3.5 py-2.5 last:border-b-0">
                    <div className="mt-0.5 shrink-0">{getIcon(notif.text)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-normal">
                        {notif.text.replace('[Proactive Notify] ', '')}
                      </div>
                      {notif.timestamp && <div className="mt-0.5 text-[11px] text-faint">{notif.timestamp}</div>}
                    </div>
                    <button
                      onClick={() => dismiss(notif.text + (notif.timestamp || ''))}
                      aria-label="Dismiss notification"
                      className="shrink-0 rounded p-0.5 text-faint hover:text-foreground"
                    >
                      <X size={11} />
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
