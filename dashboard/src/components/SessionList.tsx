// @ts-nocheck
"use client";

import React, { useState } from "react";
import { Plus, Search, Trash2, ChevronDown } from "lucide-react";

// ── Shared style tokens ──────────────────────────────────────────────
// One row look, parameterized by active state. Depth is expressed purely as
// left indentation (Workstream C2/C4) — no absolute-positioned tree connectors.
const ROW_BASE =
  "group relative flex cursor-pointer items-center gap-1 rounded-lg py-2 pr-2 border transition-colors duration-150";
const ROW_ACTIVE = "bg-accent border-primary/10";
const ROW_IDLE = "border-transparent hover:bg-muted/70 hover:border-border-soft";
const INDENT_STEP = 16; // px per depth level

// ── One session row (parent or child, any depth) ─────────────────────
function SessionRow({
  session,
  depth,
  isActive,
  hasChildren,
  isCollapsed,
  showDelete,
  onSwitch,
  onDelete,
  onToggle,
  onHover,
  onLeave,
}) {
  return (
    <div
      onClick={() => onSwitch(session.id)}
      onMouseEnter={() => onHover(session.id)}
      onMouseLeave={onLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSwitch(session.id);
        }
      }}
      style={{ paddingLeft: 8 + depth * INDENT_STEP }}
      className={`${ROW_BASE} ${isActive ? ROW_ACTIVE : ROW_IDLE}`}
    >
      {isActive && (
        <span className="absolute left-[3px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
      )}

      {hasChildren ? (
        <button
          onClick={(e) => onToggle(session.id, e)}
          aria-label={isCollapsed ? "Expand sub-sessions" : "Collapse sub-sessions"}
          className="shrink-0 rounded-md p-0.5 text-faint transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown
            size={12}
            className={`transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
          />
        </button>
      ) : (
        // Keep title alignment consistent whether or not a chevron is present.
        <span className="w-[17px] shrink-0" aria-hidden />
      )}

      <span
        className={`min-w-0 flex-1 truncate text-[13px] tracking-tight ${
          isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground"
        }`}
      >
        {session.title}
      </span>

      {showDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(session.id);
          }}
          aria-label={`Delete session ${session.title}`}
          className="shrink-0 rounded-md p-1.5 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

export default function SessionList({
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
  childToParent,
  parentToChildren,
  sessionsLength,
}) {
  const [collapsedParents, setCollapsedParents] = useState({});

  const toggleParent = (parentId, e) => {
    e.stopPropagation();
    setCollapsedParents((prev) => ({ ...prev, [parentId]: !prev[parentId] }));
  };

  const isSearching = searchQuery.trim() !== "";

  // Recursively render a session and (unless searching/collapsed) its children.
  const renderRow = (s, depth) => {
    const isActive = s.id === currentSessionId;
    const children = parentToChildren.get(s.id) || [];
    const hasChildren = children.length > 0 && !isSearching;
    const isCollapsed = collapsedParents[s.id] ?? false;
    const showDelete = (isActive || hoveredSessionId === s.id) && sessionsLength > 1;

    return (
      <React.Fragment key={s.id}>
        <SessionRow
          session={s}
          depth={depth}
          isActive={isActive}
          hasChildren={hasChildren}
          isCollapsed={isCollapsed}
          showDelete={showDelete}
          onSwitch={onSwitch}
          onDelete={onDelete}
          onToggle={toggleParent}
          onHover={onHover}
          onLeave={onLeave}
        />
        {hasChildren && !isCollapsed && children.map((cs) => renderRow(cs, depth + 1))}
      </React.Fragment>
    );
  };

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
            // When not searching, only roots appear at the top level; children
            // are rendered (indented) under their parent by renderRow.
            const visibleSessions = isSearching
              ? groupSessions
              : groupSessions.filter((s) => !childToParent.has(s.id));

            if (visibleSessions.length === 0) return null;

            return (
              <div key={groupName} className="mb-4 last:mb-0">
                <div className="px-1.5 pb-2 pt-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-faint">
                  {groupName}
                </div>
                <div className="flex flex-col gap-0.5">
                  {visibleSessions.map((s) => renderRow(s, 0))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
