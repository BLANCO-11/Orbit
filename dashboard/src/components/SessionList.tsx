// @ts-nocheck
"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

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
      <div className="px-3 pt-4 pb-2">
        <Button onClick={onNewSession} variant="outline" className="w-full justify-center gap-2 font-semibold">
          <Plus size={14} /> New Session
        </Button>
      </div>

      <div className="px-3 pb-2">
        <Input value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search sessions..." className="h-[34px] text-[0.78rem]" />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {groupedSessions.length === 0 ? (
          <div className="py-5 text-center text-xs text-muted-foreground">
            {searchQuery ? "No matching sessions." : "No sessions yet."}
          </div>
        ) : (
          groupedSessions.map(([groupName, groupSessions]) => (
            <div key={groupName} className="mb-3">
              <div className="px-2 pt-1 pb-1.5 text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground">
                {groupName}
              </div>
              <div className="flex flex-col gap-0.5">
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
                      className={`relative flex min-h-10 cursor-pointer items-center justify-between rounded-md px-3 py-2 text-[0.78rem] ${
                        isActive ? "bg-accent" : hoveredSessionId === s.id ? "bg-muted/50" : ""
                      }`}
                    >
                      {isActive && <div className="absolute left-1 h-[18px] w-[3px] rounded-full bg-primary" />}

                      <div className={`flex-1 overflow-hidden ${isActive ? "pl-1.5" : ""}`}>
                        <span className={`block overflow-hidden text-ellipsis whitespace-nowrap ${isActive ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                          {s.title}
                        </span>
                        {preview && (
                          <span className={`mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-[0.68rem] text-muted-foreground ${isActive ? "opacity-95" : "opacity-75"}`}>
                            {preview}
                          </span>
                        )}
                      </div>

                      {showDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                          className="ml-1.5 shrink-0 rounded p-1 text-destructive/65 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={12} />
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
