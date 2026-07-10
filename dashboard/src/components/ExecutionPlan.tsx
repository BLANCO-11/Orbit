// @ts-nocheck
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";

/**
 * ExecutionPlan — Shows per-query reasoning audit trails.
 * Each user query gets its own accordion. Within each accordion,
 * streaming reasoning entries are collapsible.
 */
export default function ExecutionPlan({ executionPlan, reasoningHistory = [] }) {
  const scrollRef = useRef(null);
  const [groupCollapsed, setGroupCollapsed] = useState({});
  const [entryCollapsed, setEntryCollapsed] = useState({});

  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [reasoningHistory.length, reasoningHistory.map((g) => g.entries?.length).pop()]);

  useEffect(() => {
    if (reasoningHistory.length > 0) {
      setGroupCollapsed((prev) => {
        const next = { ...prev };
        reasoningHistory.forEach((_, idx) => {
          if (next[idx] === undefined) next[idx] = true;
        });
        return next;
      });
    }
  }, [reasoningHistory.length]);

  const toggleGroup = (idx) => setGroupCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  const toggleEntry = (groupIdx, entryIdx) => {
    setEntryCollapsed((prev) => {
      const group = prev[groupIdx] || {};
      const isCurrentlyExpanded = group[entryIdx] === true;
      return { ...prev, [groupIdx]: { ...group, [entryIdx]: !isCurrentlyExpanded } };
    });
  };

  if (reasoningHistory && reasoningHistory.length > 0) {
    const groupsWithContent = reasoningHistory.filter((g) => g.entries && g.entries.length > 0);

    if (groupsWithContent.length === 0) {
      const hasLiveReasoning =
        reasoningHistory.length > 0 &&
        reasoningHistory[reasoningHistory.length - 1].entries &&
        reasoningHistory[reasoningHistory.length - 1].entries.length === 0;

      return (
        <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-2.5 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-[0.75rem]">{hasLiveReasoning ? 'Waiting for reasoning...' : 'No reasoning recorded yet.'}</span>
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col gap-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="size-1 rounded-full bg-muted-foreground" />
          Reasoning Trail
          <span className="text-[0.6rem] opacity-60">({groupsWithContent.length} queries)</span>
        </div>

        <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto scroll-smooth pr-1">
          {reasoningHistory.map((group, gIdx) => {
            if (!group.entries || group.entries.length === 0) {
              const isCurrentLive = gIdx === reasoningHistory.length - 1 && executionPlan;
              if (!isCurrentLive) return null;
            }

            const isCurrentGroup = gIdx === reasoningHistory.length - 1;
            const isCollapsed = groupCollapsed[gIdx] === true;
            const entries = group.entries || [];
            const entryCount = entries.length;

            return (
              <div key={gIdx} className="overflow-hidden rounded-md border border-border bg-muted/20">
                {/* Group header */}
                <div
                  onClick={() => toggleGroup(gIdx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGroup(gIdx); } }}
                  className={`flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 ${
                    !isCollapsed ? 'border-b border-border' : ''
                  } ${isCurrentGroup && !isCollapsed ? 'bg-primary/5' : ''}`}
                >
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className={`size-1 shrink-0 rounded-full ${isCurrentGroup ? 'bg-info' : 'bg-muted-foreground'}`} />
                    <span className={`max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-[0.7rem] ${isCurrentGroup ? 'font-semibold text-info' : 'text-muted-foreground'}`}>
                      {isCurrentGroup ? 'Current' : `Query ${gIdx + 1}`}
                    </span>
                    {group.query && (
                      <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap text-[0.6rem] text-muted-foreground">
                        {group.query}
                      </span>
                    )}
                    {group.queryTimestamp && (
                      <span className="shrink-0 text-[0.55rem] text-muted-foreground">{group.queryTimestamp}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {entryCount > 0 && <span className="text-[0.6rem] text-muted-foreground">{entryCount} step{entryCount !== 1 ? 's' : ''}</span>}
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </div>
                </div>

                {/* Group content */}
                {!isCollapsed && (
                  <div className="flex flex-col gap-1 p-2">
                    {entryCount === 0 && isCurrentGroup && executionPlan && (
                      <div className="max-h-[320px] overflow-y-auto rounded bg-black/5 p-2 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap dark:bg-black/20">
                        {executionPlan}
                      </div>
                    )}

                    {entryCount === 1 && (
                      <div className={`max-h-[320px] overflow-y-auto rounded bg-black/5 p-2 font-mono text-[0.73rem] leading-relaxed whitespace-pre-wrap dark:bg-black/20 ${isCurrentGroup ? '' : 'opacity-80'}`}>
                        {entries[0].content || ''}
                      </div>
                    )}

                    {entryCount > 1 && entries.map((entry, eIdx) => {
                      const isLastEntry = eIdx === entries.length - 1;
                      const isEntryCollapsed = (entryCollapsed[gIdx] || {})[eIdx] !== true;

                      return (
                        <div key={eIdx} className="overflow-hidden rounded border border-border/50">
                          <div
                            onClick={() => toggleEntry(gIdx, eIdx)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleEntry(gIdx, eIdx); } }}
                            className="flex cursor-pointer select-none items-center justify-between bg-muted/30 px-2 py-1"
                          >
                            <div className="flex items-center gap-1">
                              <span className={`size-[3px] shrink-0 rounded-full ${isLastEntry ? 'bg-info' : 'bg-muted-foreground'}`} />
                              <span className="text-[0.65rem] text-muted-foreground">Step {eIdx + 1}</span>
                              {entry.timestamp && <span className="text-[0.55rem] text-muted-foreground">{entry.timestamp}</span>}
                            </div>
                            {isEntryCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                          </div>

                          {!isEntryCollapsed && (
                            <div
                              className={`whitespace-pre-wrap px-2 pb-1.5 pt-1 font-mono text-[0.73rem] leading-relaxed overflow-y-auto ${isLastEntry ? 'opacity-100' : 'opacity-70'}`}
                              style={{ maxHeight: isLastEntry ? '320px' : '100px' }}
                            >
                              {entry.content || ''}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {isCurrentGroup && executionPlan && entries.length > 0 && executionPlan !== entries[entries.length - 1].content && (
                      <div className="max-h-[160px] overflow-y-auto rounded border border-info/10 bg-info/5 p-2 font-mono text-[0.73rem] leading-relaxed whitespace-pre-wrap text-info">
                        {executionPlan}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Fallback: no history at all
  if (!executionPlan) {
    return (
      <div className="flex h-full min-h-[150px] flex-col items-center justify-center gap-2.5 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-[0.75rem]">Waiting for reasoning...</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="size-1 rounded-full bg-muted-foreground" />
        Current Reasoning
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto scroll-smooth whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-2.5 font-mono text-[0.75rem] leading-relaxed"
      >
        {executionPlan}
      </div>
    </div>
  );
}
