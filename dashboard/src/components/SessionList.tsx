// @ts-nocheck
"use client";

import React from "react";
import { Plus, Search, Trash2 } from "lucide-react";

export default function SessionList({
  sessions,
  currentSessionId,
  searchQuery,
  onSearchChange,
  groupedSessions,
  hoveredSessionId,
  onHover,
  onLeave,
  onSwitch,
  onDelete,
  onNewSession,
  getSessionPreview,
  sessionsLength,
}) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* ── Top: new session + search ── */}
      <div className="flex flex-col gap-2.5 px-3 pb-2.5 pt-3.5">
        <button
          onClick={onNewSession}
          className="flex items-center justify-between rounded-[9px] border border-border bg-card px-3 py-[9px] text-[13px] font-semibold shadow-card transition-colors hover:border-ring/40"
        >
          <span className="flex items-center gap-2">
            <Plus size={15} className="text-primary" strokeWidth={2.4} />
            New session
          </span>
          <span className="rounded border border-border px-[5px] py-px text-[10px] text-faint">⌘N</span>
        </button>

        <div className="flex items-center gap-2 rounded-[9px] border border-transparent bg-muted px-[11px] py-2 text-faint focus-within:border-ring/40 focus-within:bg-card">
          <Search size={14} className="shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
          />
        </div>
      </div>

      {/* ── Session groups ── */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {groupedSessions.length === 0 ? (
          <div className="py-5 text-center text-xs text-faint">
            {searchQuery ? "No matching sessions." : "No sessions yet."}
          </div>
        ) : (
          groupedSessions.map(([groupName, groupSessions]) => (
            <div key={groupName}>
              <div className="px-2 pb-1.5 pt-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
                {groupName}
              </div>
              <div className="flex flex-col gap-px">
                {groupSessions.map((s) => {
                  const isActive = s.id === currentSessionId;
                  const preview = getSessionPreview(s);
                  const showDelete = (isActive || hoveredSessionId === s.id) && sessionsLength > 1;
                  return (
                    <div
                      key={s.id}
                      onClick={() => onSwitch(s.id)}
                      onMouseEnter={() => onHover(s.id)}
                      onMouseLeave={() => onLeave()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSwitch(s.id); } }}
                      className={`group relative flex cursor-pointer items-center rounded-[9px] px-2.5 py-2 transition-colors ${
                        isActive ? "bg-accent" : "hover:bg-muted"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute left-[3px] top-2.5 bottom-2.5 w-[2.5px] rounded-full bg-primary" />
                      )}
                      <div className="min-w-0 flex-1 pl-1.5">
                        <div
                          className={`overflow-hidden text-ellipsis whitespace-nowrap text-[13px] ${
                            isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground"
                          }`}
                        >
                          {s.title}
                        </div>
                        {preview && (
                          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] text-faint">
                            {preview}
                          </div>
                        )}
                      </div>
                      {showDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                          aria-label={`Delete session ${s.title}`}
                          className="ml-1 shrink-0 rounded-md p-1 text-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
