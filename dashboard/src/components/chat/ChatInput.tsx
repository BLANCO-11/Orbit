'use client';

import React, { useRef, useEffect, useState } from 'react';
import { Mic, Send, Square, Volume2, VolumeX, Settings2 } from 'lucide-react';

/** A labeled row inside the Run-config popover: caption left, control right. */
function ConfigRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

/**
 * ChatInput — frosted floating dock: textarea over a control strip
 * (mode + run-config popover left, voice + send right).
 */
export default function ChatInput({
  prompt,
  setPrompt,
  status,
  voiceState,
  onVoiceStateToggle,
  onToggleListening,
  isListening,
  onSubmit,
  onStop,
  profileButton,
  harnessButton,
  modeButton,
  promptTypeButton,
  skillButton,
  effortButton,
  inputHistoryRef,
  inputHistoryIndexRef,
}) {
  const textareaRef = useRef(null);
  const [runConfigOpen, setRunConfigOpen] = useState(false);
  const runConfigRef = useRef(null);

  // Close the Run-config popover on outside click / Escape.
  useEffect(() => {
    if (!runConfigOpen) return;
    const onDown = (e) => {
      if (runConfigRef.current && !runConfigRef.current.contains(e.target)) setRunConfigOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setRunConfigOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [runConfigOpen]);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = '40px';
      const capped = Math.min(el.scrollHeight, 120);
      el.style.height = capped + 'px';
      el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
    }
  };

  useEffect(() => { autoGrow(); }, [prompt]);

  const navigateHistory = (direction) => {
    const history = inputHistoryRef?.current || [];
    if (history.length === 0) return;

    if (direction === 'up') {
      const newIndex = (inputHistoryIndexRef?.current || 0) < history.length - 1
        ? (inputHistoryIndexRef?.current || 0) + 1
        : history.length - 1;
      if (inputHistoryIndexRef) inputHistoryIndexRef.current = newIndex;
      setPrompt(history[history.length - 1 - newIndex]);
    } else if (direction === 'down') {
      const newIndex = (inputHistoryIndexRef?.current || 0) - 1;
      if (newIndex < 0) {
        if (inputHistoryIndexRef) inputHistoryIndexRef.current = -1;
        setPrompt('');
      } else {
        if (inputHistoryIndexRef) inputHistoryIndexRef.current = newIndex;
        setPrompt(history[history.length - 1 - newIndex]);
      }
    }
  };

  const submit = () => {
    const trimmed = prompt.trim();
    if (trimmed) {
      if (inputHistoryRef?.current) inputHistoryRef.current.push(trimmed);
      if (inputHistoryIndexRef) inputHistoryIndexRef.current = -1;
      onSubmit?.(trimmed);
    }
  };

  const isProcessing = status === 'thinking' || status === 'executing';

  return (
    <div
      className="pointer-events-auto rounded-2xl border border-border shadow-float backdrop-blur-xl backdrop-saturate-150 transition-colors focus-within:border-ring/50"
      style={{ background: 'var(--dock)' }}
    >
      <div className="px-3.5 pt-3">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
              e.preventDefault();
              if (!isProcessing) submit();
            } else if (e.key === 'ArrowUp' && !e.shiftKey) {
              e.preventDefault();
              navigateHistory('up');
            } else if (e.key === 'ArrowDown' && !e.shiftKey) {
              e.preventDefault();
              navigateHistory('down');
            }
          }}
          placeholder={
            isProcessing
              ? 'Agent is working — Stop to interrupt.'
              : 'Ask anything — browse, run code, audit, deploy…'
          }
          rows={1}
          disabled={isProcessing}
          aria-label="Message the agent"
          className="max-h-[120px] min-h-[40px] w-full resize-none bg-transparent px-0.5 pb-2 text-[14.5px] leading-relaxed outline-none placeholder:text-faint disabled:opacity-60"
        />
      </div>

      <div className="flex items-center justify-between border-t border-border-soft px-3 py-2">
        <div className="flex flex-wrap items-center gap-[7px]">
          {/* Mode stays inline — it's the one control changed turn-to-turn. */}
          {modeButton}

          {/* Everything else (profile · harness · prompt · effort · skills)
              collapses behind one Run-config popover to keep the dock calm. */}
          <div className="relative" ref={runConfigRef}>
            <button
              type="button"
              onClick={() => setRunConfigOpen((o) => !o)}
              aria-label="Run configuration"
              aria-expanded={runConfigOpen}
              title="Run config — profile, harness, prompt, effort, skills"
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-[6px] text-[12.5px] font-medium transition-colors ${
                runConfigOpen
                  ? 'border-ring/50 bg-accent text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Settings2 size={14} />
              Run config
            </button>

            {runConfigOpen && (
              <div className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[260px] rounded-xl border border-border bg-card p-3 shadow-float">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
                  Run configuration
                </div>
                <div className="flex flex-col gap-2.5">
                  <ConfigRow label="Profile">{profileButton}</ConfigRow>
                  <ConfigRow label="Harness">{harnessButton}</ConfigRow>
                  <ConfigRow label="Prompt">{promptTypeButton}</ConfigRow>
                  <ConfigRow label="Effort">{effortButton}</ConfigRow>
                  <ConfigRow label="Skills">{skillButton}</ConfigRow>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleListening}
            disabled={isProcessing}
            aria-label="Voice input"
            title="Voice input"
            className={`grid size-8 place-items-center rounded-lg border transition-colors disabled:opacity-40 ${
              isListening
                ? 'animate-pulse border-primary/40 bg-accent text-primary'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Mic size={15} />
          </button>

          <button
            onClick={onVoiceStateToggle}
            aria-label="Toggle speech output"
            title={voiceState === 'audio' ? 'Speech on' : voiceState === 'mute' ? 'Muted' : 'Speech off'}
            className={`grid size-8 place-items-center rounded-lg border border-border transition-colors hover:bg-muted ${
              voiceState === 'audio' ? 'text-primary' : 'text-faint'
            }`}
          >
            {voiceState === 'audio' ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>

          {isProcessing ? (
            <button
              onClick={onStop}
              className="ml-1 flex items-center gap-1.5 rounded-[9px] bg-destructive px-3.5 py-[7px] text-[13px] font-semibold text-destructive-foreground hover:opacity-90"
            >
              <Square size={12} fill="currentColor" /> Stop
            </button>
          ) : (
            <button
              onClick={submit}
              className="ml-1 flex items-center gap-1.5 rounded-[9px] bg-primary px-3.5 py-[7px] text-[13px] font-semibold text-primary-foreground hover:opacity-90"
            >
              <Send size={13} /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
