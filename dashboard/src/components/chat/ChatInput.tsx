// @ts-nocheck
'use client';

import React, { useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Send, XCircle, Volume2, VolumeX, ChevronDown } from 'lucide-react';

/**
 * ChatInput — The main input bar with mic, TTS, mode selector, textarea, send/stop
 *
 * Props:
 *   prompt, setPrompt
 *   status — 'idle' | 'thinking' | 'executing' | ...
 *   voiceState — 'audio' | 'mute' | 'disabled'
 *   onVoiceStateToggle
 *   onToggleListening — toggle mic
 *   isListening
 *   onSubmit
 *   onStop
 *   modeButton (ReactNode) — mode selector element to render
 *   inputHistory
 *   inputHistoryIndex
 *   onNavigateHistory
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
      const capped = Math.min(el.scrollHeight, 80);
      el.style.height = capped + 'px';
      el.style.overflowY = el.scrollHeight > 80 ? 'auto' : 'hidden';
    }
  };

  useEffect(() => {
    autoGrowTextarea();
  }, [prompt]);

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

  const isProcessing = status === 'thinking' || status === 'executing';

  return (
    <div
      className="chat-input-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-default)',
        background: 'var(--surface-primary)',
        backdropFilter: 'blur(25px)',
        padding: '8px 12px',
        maxWidth: '900px',
        width: '100%',
        margin: '0 auto',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
        transition: 'border-color 0.2s var(--ease-out-expo)',
      }}
      onFocusCapture={(e) => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
      onBlurCapture={(e) => e.currentTarget.style.borderColor = 'var(--border-default)'}
    >
      {/* ── Top Row: Textarea ── */}
      <textarea
        ref={textareaRef}
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault();
            if (!isProcessing) {
              const trimmed = prompt.trim();
              if (trimmed && inputHistoryRef?.current) {
                inputHistoryRef.current.push(trimmed);
              }
              if (inputHistoryIndexRef) inputHistoryIndexRef.current = -1;
              onSubmit?.(trimmed);
            }
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
        style={{
          width: '100%',
          minHeight: '44px',
          maxHeight: '120px',
          fontSize: '0.9rem',
          backgroundColor: 'transparent',
          color: 'var(--text-primary)',
          border: 'none',
          padding: '8px 4px',
          resize: 'none',
          overflowY: 'auto',
          lineHeight: '1.55',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />

      {/* ── Bottom Row: Controls ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '6px',
          paddingTop: '8px',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {/* Left: Mode selectors */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {modeButton}
          {promptTypeButton}
        </div>

        {/* Right: Audio toggles + Action Button */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* Mic Button */}
          <button
            onClick={onToggleListening}
            className={`interactive-base ${isListening ? 'pulsing-mic' : ''}`}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: isListening ? 'var(--accent-primary-muted)' : 'transparent',
              color: isListening ? 'var(--accent-primary)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            title="Voice input"
            disabled={isProcessing}
          >
            <Mic size={15} />
          </button>

          {/* TTS Button */}
          <button
            onClick={onVoiceStateToggle}
            className="interactive-base"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: voiceState === 'audio' ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
              color: voiceState === 'audio' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            title={
              voiceState === 'audio'
                ? 'Audio output active'
                : voiceState === 'mute'
                ? 'Muted'
                : 'TTS disabled'
            }
          >
            {voiceState === 'audio' ? (
              <Volume2 size={15} />
            ) : (
              <VolumeX size={15} style={{ opacity: voiceState === 'disabled' ? 0.4 : 0.8 }} />
            )}
          </button>

          <div style={{ width: '4px' }} />

          {/* Send / Stop Button */}
          {isProcessing ? (
            <Button
              onClick={onStop}
              style={{
                borderRadius: 'var(--radius-md)',
                padding: '0 12px',
                height: '32px',
                backgroundColor: 'var(--accent-danger)',
                color: '#fff',
                fontSize: '0.75rem',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <XCircle size={13} /> Stop
            </Button>
          ) : (
            <Button
              onClick={() => {
                const trimmed = prompt.trim();
                if (trimmed) {
                  if (inputHistoryRef?.current) {
                    inputHistoryRef.current.push(trimmed);
                  }
                  if (inputHistoryIndexRef) inputHistoryIndexRef.current = -1;
                  onSubmit?.(trimmed);
                }
              }}
              style={{
                borderRadius: 'var(--radius-md)',
                padding: '0 12px',
                height: '32px',
                fontSize: '0.75rem',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
              }}
            >
              <Send size={13} /> Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
