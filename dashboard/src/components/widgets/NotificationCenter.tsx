'use client';

import React, { useState, useCallback } from 'react';
import { Bell, X, AlertTriangle, CheckCircle2, Info, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * NotificationCenter — Bell icon with dropdown showing recent notifications.
 * Notifications arrive via WebSocket log events with the notification prefix.
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
    if (text.includes('[ERROR]') || text.includes('error')) return <AlertTriangle size={12} className="text-destructive" />;
    if (text.includes('[WARN]') || text.includes('warning')) return <AlertTriangle size={12} className="text-warning" />;
    if (text.includes('completed') || text.includes('success')) return <CheckCircle2 size={12} className="text-success" />;
    if (text.includes('token') || text.includes('metric')) return <Cpu size={12} className="text-chart-3" />;
    return <Info size={12} className="text-muted-foreground" />;
  };

  return (
    <div className="relative">
      <Button variant="outline" size="icon" onClick={() => setIsOpen(!isOpen)} className="relative">
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[0.58rem] font-bold text-primary-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <>
          <div onClick={() => setIsOpen(false)} className="fixed inset-0 z-50" />
          <div className="absolute right-0 top-full z-[55] mt-2 w-80 animate-in zoom-in-95 overflow-hidden rounded-lg border border-border bg-popover shadow-xl backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
              <span className="text-[0.8rem] font-semibold">
                Notifications {unreadCount > 0 && `(${unreadCount})`}
              </span>
              {unreadCount > 0 && (
                <button onClick={dismissAll} className="text-[0.68rem] text-muted-foreground hover:text-foreground">
                  Clear all
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-5 text-center text-[0.75rem] text-muted-foreground">No notifications</div>
              ) : (
                notifications.map((notif, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-border px-3 py-2 text-[0.72rem] last:border-b-0">
                    <div className="mt-0.5 shrink-0">{getIcon(notif.text)}</div>
                    <div className="flex-1 overflow-hidden">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap leading-normal">
                        {notif.text.replace('[Proactive Notify] ', '')}
                      </div>
                      {notif.timestamp && <div className="mt-0.5 text-[0.62rem] text-muted-foreground">{notif.timestamp}</div>}
                    </div>
                    <button onClick={() => dismiss(notif.text + (notif.timestamp || ''))} className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground">
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
