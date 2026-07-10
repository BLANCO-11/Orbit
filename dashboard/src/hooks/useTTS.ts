'use client';

import { useRef, useCallback } from 'react';
import { useAegisState } from '@/providers/AegisProvider';

/**
 * useTTS — Streaming Text-to-Speech queue.
 *
 * Manages sentence splitting, TTS API fetching, and sequential playback.
 */
export function useTTS(selectedVoice = 'alba') {
  const { voiceState } = useAegisState();
  
  const spokenSentencesRef = useRef(new Set());
  const ttsQueueRef = useRef([]);
  const currentPlayingIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const sessionRef = useRef(null);
  const audioRef = useRef(null);

  // Start a new TTS session
  const startSession = useCallback(() => {
    // Stop and clean up previous
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.src = ''; } catch {}
    }
    spokenSentencesRef.current = new Set();
    ttsQueueRef.current = [];
    currentPlayingIndexRef.current = 0;
    isPlayingRef.current = false;
    sessionRef.current = Symbol('tts-session');
  }, []);

  // Queue a sentence for TTS
  const queueSentence = useCallback((sentence) => {
    if (voiceState !== 'audio') return;
    if (spokenSentencesRef.current.has(sentence)) return;
    
    spokenSentencesRef.current.add(sentence);
    const session = sessionRef.current;
    
    const queueItem = { sentence, audioUrl: null, status: 'pending', session };
    ttsQueueRef.current.push(queueItem);

    fetch(`/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sentence, voice: selectedVoice }),
    })
      .then(res => { if (!res.ok) throw new Error('TTS failed'); return res.blob(); })
      .then(blob => {
        if (sessionRef.current === session) {
          queueItem.audioUrl = URL.createObjectURL(blob);
          queueItem.status = 'ready';
          playNext();
        }
      })
      .catch(() => {
        if (sessionRef.current === session) {
          queueItem.status = 'failed';
          playNext();
        }
      });
  }, [selectedVoice, voiceState]);

  // Queue multiple sentences from text
  const speakText = useCallback((text) => {
    if (voiceState !== 'audio') return;
    const clean = text.replace(/[*#`_\-\[\]]/g, '').replace(/\[.*?\]\(.*?\)/g, '');
    const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 2);
    sentences.forEach(queueSentence);
  }, [voiceState, queueSentence]);

  // Play next in queue
  const playNext = useCallback(() => {
    if (isPlayingRef.current) return;
    if (currentPlayingIndexRef.current >= ttsQueueRef.current.length) return;
    
    const item = ttsQueueRef.current[currentPlayingIndexRef.current];
    if (item.session !== sessionRef.current) {
      currentPlayingIndexRef.current++;
      playNext();
      return;
    }
    
    if (item.status === 'ready') {
      isPlayingRef.current = true;
      const audio = new Audio(item.audioUrl);
      audioRef.current = audio;
      audio.play().catch(() => {
        isPlayingRef.current = false;
        currentPlayingIndexRef.current++;
        playNext();
      });
      audio.onended = () => {
        isPlayingRef.current = false;
        currentPlayingIndexRef.current++;
        playNext();
      };
    } else if (item.status === 'failed') {
      currentPlayingIndexRef.current++;
      playNext();
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      try { audioRef.current.pause(); audioRef.current.src = ''; } catch {}
    }
    sessionRef.current = Symbol('tts-stopped');
    isPlayingRef.current = false;
  }, []);

  return { speakText, queueSentence, startSession, stopSpeaking };
}
