'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useOrbitState, useOrbitDispatch, actions } from '@/providers/OrbitProvider';

// Releases a queue item's object URL exactly once, so it doesn't linger for the
// life of the tab (blob URLs are never garbage-collected on their own).
function revokeItem(item) {
  if (item?.audioUrl) {
    URL.revokeObjectURL(item.audioUrl);
    item.audioUrl = null;
  }
}

/**
 * useTTS — Streaming Text-to-Speech queue.
 *
 * Manages sentence splitting, TTS API fetching, and sequential playback.
 */
export function useTTS(selectedVoice = 'alba') {
  const { voiceState } = useOrbitState();
  const dispatch = useOrbitDispatch();
  // Belt-and-suspenders: speech can be triggered from long-lived closures (WS
  // handlers). Read voiceState through a ref so the mute check always sees the
  // CURRENT state, not whatever was captured when the callback was created.
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;
  // Browsers block audio.play() until the user has interacted with the page.
  // Warn once so a blocked first sentence reads as "needs a click", not broken.
  const autoplayWarnedRef = useRef(false);

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
    // Release any object URLs from the previous session that never got to play.
    ttsQueueRef.current.forEach(revokeItem);
    spokenSentencesRef.current = new Set();
    ttsQueueRef.current = [];
    currentPlayingIndexRef.current = 0;
    isPlayingRef.current = false;
    sessionRef.current = Symbol('tts-session');
  }, []);

  // Queue a sentence for TTS
  const queueSentence = useCallback((sentence) => {
    if (voiceStateRef.current !== 'audio') return;
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
  }, [selectedVoice]);

  // Queue multiple sentences from text
  const speakText = useCallback((text) => {
    if (voiceStateRef.current !== 'audio') return;
    const clean = text.replace(/[*#`_\-\[\]]/g, '').replace(/\[.*?\]\(.*?\)/g, '');
    const sentences = clean.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 2);
    sentences.forEach(queueSentence);
  }, [queueSentence]);

  // Play next in queue
  const playNext = useCallback(() => {
    if (isPlayingRef.current) return;
    if (currentPlayingIndexRef.current >= ttsQueueRef.current.length) return;
    
    const item = ttsQueueRef.current[currentPlayingIndexRef.current];
    if (item.session !== sessionRef.current) {
      revokeItem(item);
      currentPlayingIndexRef.current++;
      playNext();
      return;
    }

    if (item.status === 'ready') {
      isPlayingRef.current = true;
      const audio = new Audio(item.audioUrl);
      audioRef.current = audio;
      audio.play().catch(() => {
        if (!autoplayWarnedRef.current) {
          autoplayWarnedRef.current = true;
          dispatch(actions.addLog({
            text: '[Voice] Speech is blocked until you interact with the page (browser autoplay policy). Click anywhere, then it will speak.',
            isSystem: true,
            timestamp: new Date().toLocaleTimeString(),
          }));
        }
        isPlayingRef.current = false;
        revokeItem(item);
        currentPlayingIndexRef.current++;
        playNext();
      });
      audio.onended = () => {
        // A sentence played through → audio is unblocked; re-arm the warning.
        autoplayWarnedRef.current = false;
        isPlayingRef.current = false;
        revokeItem(item);
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
    // Anything still queued will never play now — release its object URL.
    ttsQueueRef.current.slice(currentPlayingIndexRef.current).forEach(revokeItem);
    sessionRef.current = Symbol('tts-stopped');
    isPlayingRef.current = false;
  }, []);

  // Muting (or any other non-'audio' voice state) should stop speech that's already
  // in flight, not just gate future sentences from being queued.
  useEffect(() => {
    if (voiceState !== 'audio') {
      stopSpeaking();
    }
  }, [voiceState, stopSpeaking]);

  return { speakText, queueSentence, startSession, stopSpeaking };
}
