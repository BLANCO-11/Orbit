'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useAegisDispatch, actions } from '@/providers/AegisProvider';

/**
 * useSTT — Browser Speech Recognition wrapper.
 */
export function useSTT() {
  const dispatch = useAegisDispatch();
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }
    
    setIsSupported(true);
    const rec = new SpeechRecognition();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';
    
    rec.onstart = () => {
      setIsListening(true);
      dispatch(actions.setIsListening(true));
    };
    
    rec.onresult = (event) => {
      const text = event.results[0][0].transcript;
      setIsListening(false);
      dispatch(actions.setIsListening(false));
      // Return the text — caller handles what to do with it
      if (recognitionRef.current._onResult) {
        recognitionRef.current._onResult(text);
      }
    };
    
    rec.onerror = (event) => {
      setIsListening(false);
      dispatch(actions.setIsListening(false));
      setError(event.error);
    };
    
    rec.onend = () => {
      setIsListening(false);
      dispatch(actions.setIsListening(false));
    };
    
    recognitionRef.current = rec;
  }, [dispatch]);

  const startListening = useCallback((onResult) => {
    if (!recognitionRef.current) return;
    setError(null);
    recognitionRef.current._onResult = onResult;
    recognitionRef.current.start();
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  return { isListening, isSupported, error, startListening, stopListening };
}
