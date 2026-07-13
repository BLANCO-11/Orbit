// @ts-nocheck
"use client";

import React, { useState } from "react";
import { Plus, Search, Trash2, ChevronDown } from "lucide-react";

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
  const [collapsedParents, setCollapsedParents] = useState({});

  const toggleParent = (parentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedParents((prev) => ({
      ...prev,
      [parentId]: !prev[parentId],
    }));
  };

  // Build parent-child mapping for sessions
  const childToParent = new Map();
  const parentToChildren = new Map();

  sessions.forEach((s) => {
    const agents = s.subagentTree?.agents || [];
    agents.forEach((agent) => {
      if (agent.childSessionId) {
        childToParent.set(agent.childSessionId, s.id);
        if (!parentToChildren.has(s.id)) {
          parentToChildren.set(s.id, []);
        }
        const childSession = sessions.find((cs) => cs.id === agent.childSessionId);
        if (childSession) {
          parentToChildren.get(s.id).push(childSession);
        }
      }
    });
  });

  const isSearching = searchQuery.trim() !== "";

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
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {groupedSessions.length === 0 ? (
          <div className="py-5 text-center text-xs text-faint">
            {searchQuery ? "No matching sessions." : "No sessions yet."}
          </div>
        ) : (
          groupedSessions.map(([groupName, groupSessions]) => {
            // If not searching, only show root sessions at the top level
            const visibleSessions = isSearching
              ? groupSessions
              : groupSessions.filter((s) => !childToParent.has(s.id));

            if (visibleSessions.length === 0) return null;

            return (
              <div key={groupName} className="mb-4 last:mb-0">
                <div className="px-1.5 pb-2 pt-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-faint">
                  {groupName}
                </div>
                <div className="flex flex-col gap-2">
                  {visibleSessions.map((s) => {
                    const isActive = s.id === currentSessionId;
                    const preview = getSessionPreview(s);
                    const showDelete = (isActive || hoveredSessionId === s.id) && sessionsLength > 1;
                    const childrenSessions = parentToChildren.get(s.id) || [];
                    const hasChildren = childrenSessions.length > 0 && !isSearching;
                    const isCollapsed = collapsedParents[s.id] ?? false;

                    return (
                      <div key={s.id} className="flex flex-col gap-1">
                        {/* Parent Card */}
                        <div
                          onClick={() => onSwitch(s.id)}
                          onMouseEnter={() => onHover(s.id)}
                          onMouseLeave={() => onLeave()}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSwitch(s.id);
                            }
                          }}
                          className={`group relative flex cursor-pointer items-center rounded-lg px-3 py-2.5 border transition-all duration-150 ${
                            isActive
                              ? "bg-accent border-primary/10 shadow-[0_1px_3px_rgba(99,85,224,0.04)]"
                              : "border-transparent hover:bg-muted/70 hover:border-border-soft"
                          }`}
                        >
                          {isActive && (
                            <span className="absolute left-[3px] top-3 bottom-3 w-[3px] rounded-full bg-primary" />
                          )}

                          {hasChildren && (
                            <button
                              onClick={(e) => toggleParent(s.id, e)}
                              className="mr-1.5 shrink-0 rounded-md p-0.5 hover:bg-muted text-faint hover:text-foreground transition-transform"
                            >
                              <ChevronDown
                                size={12}
                                className={`transform transition-transform duration-200 ${
                                  isCollapsed ? "-rotate-90" : ""
                                }`}
                              />
                            </button>
                          )}

                          <div className="min-w-0 flex-1 pl-1">
                            <div
                              className={`overflow-hidden text-ellipsis whitespace-nowrap text-[13px] tracking-tight ${
                                isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground"
                              }`}
                            >
                              {s.title}
                            </div>
                            {preview && (
                              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] mt-0.5 text-faint">
                                {preview}
                              </div>
                            )}
                          </div>
                          {showDelete && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDelete(s.id);
                              }}
                              aria-label={`Delete session ${s.title}`}
                              className="ml-1.5 shrink-0 rounded-md p-1.5 text-destructive/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        {/* Sub-sessions / Child list */}
                        {hasChildren && !isCollapsed && (
                          <div className="relative ml-6 mt-0.5 flex flex-col gap-1 border-l-2 border-border/50 pl-3 animate-fade-in">
                            {childrenSessions.map((cs) => {
                              const isChildActive = cs.id === currentSessionId;
                              const childPreview = getSessionPreview(cs);
                              return (
                                <div
                                  key={cs.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSwitch(cs.id);
                                  }}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onSwitch(cs.id);
                                    }
                                  }}
                                  className={`group relative flex cursor-pointer items-center rounded-md px-2.5 py-1.5 border transition-all duration-150 ${
                                    isChildActive
                                      ? "bg-accent/60 border-primary/10 shadow-sm"
                                      : "border-transparent hover:bg-muted/40 hover:border-border-soft"
                                  }`}
                                >
                                  {isChildActive && (
                                    <span className="absolute left-[3px] top-2 bottom-2 w-[2px] rounded-full bg-primary" />
                                  )}
                                  {/* Guide Line Connection Node */}
                                  <div className="absolute left-[-13px] top-[14px] w-[11px] h-[2px] bg-border/50" />

                                  <div className="min-w-0 flex-1 pl-1">
                                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold text-muted-foreground group-hover:text-foreground">
                                      {cs.title}
                                    </div>
                                    {childPreview && (
                                      <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-faint">
                                        {childPreview}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
