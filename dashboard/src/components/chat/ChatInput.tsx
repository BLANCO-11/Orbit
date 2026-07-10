// @ts-nocheck
'use client';

import React, { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Send, XCircle, Volume2, VolumeX } from 'lucide-react';

/**
 * ChatInput — The main input bar with mic, TTS, mode selector, textarea, send/stop
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
  modeButton,
  promptTypeButton,
  inputHistoryRef,
  inputHistoryIndexRef,
}) {
  const textareaRef = useRef(null);

  const autoGrowTextarea = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = '44px';
      const capped = Math.min(el.scrollHeight, 120);
      el.style.height = capped + 'px';
      el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden';
    }
  };

  useEffect(() => { autoGrowTextarea(); }, [prompt]);

  const navigateInputHistory = (direction) => {
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

  const submitPrompt = () => {
    const trimmed = prompt.trim();
    if (trimmed) {
      if (inputHistoryRef?.current) inputHistoryRef.current.push(trimmed);
      if (inputHistoryIndexRef) inputHistoryIndexRef.current = -1;
      onSubmit?.(trimmed);
    }
  };

  const isProcessing = status === 'thinking' || status === 'executing';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col rounded-xl border border-border bg-card p-3 shadow-lg transition-colors focus-within:border-primary">
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault();
            if (!isProcessing) submitPrompt();
          } else if (e.key === 'ArrowUp' && !e.shiftKey) {
            e.preventDefault();
            navigateInputHistory('up');
          } else if (e.key === 'ArrowDown' && !e.shiftKey) {
            e.preventDefault();
            navigateInputHistory('down');
          }
        }}
        placeholder={
          isProcessing
            ? 'Agent is processing — click Stop to interrupt.'
            : 'Ask anything: browse, code, search, deploy, analyze... (Shift+Enter for newline)'
        }
        rows={1}
        disabled={isProcessing}
        className="max-h-[120px] min-h-[44px] w-full resize-none bg-transparent px-1 py-2 text-[0.9rem] leading-relaxed outline-none placeholder:text-muted-foreground"
      />

      {/* ── Bottom Row: Controls ── */}
      <div className="mt-1.5 flex items-center justify-between border-t border-border pt-2">
        <div className="flex items-center gap-2">
          {modeButton}
          {promptTypeButton}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleListening}
            disabled={isProcessing}
            title="Voice input"
            className={isListening ? 'animate-pulse bg-accent text-primary' : 'text-muted-foreground'}
          >
            <Mic size={15} />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onVoiceStateToggle}
            title={voiceState === 'audio' ? 'Audio output active' : voiceState === 'mute' ? 'Muted' : 'TTS disabled'}
            className={voiceState === 'audio' ? 'text-primary' : 'text-muted-foreground'}
          >
            {voiceState === 'audio' ? <Volume2 size={15} /> : <VolumeX size={15} className={voiceState === 'disabled' ? 'opacity-40' : 'opacity-80'} />}
          </Button>

          {isProcessing ? (
            <Button variant="destructive" size="sm" onClick={onStop}>
              <XCircle size={13} /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={submitPrompt}>
              <Send size={13} /> Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
