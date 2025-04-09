"use client";

import React, { createContext, useContext, useReducer, useCallback } from 'react';
import { SpeakerInfo, LockedLanguagePair, SpeakerEvent } from '@/app/types';
import { useLanguagePair } from '@/app/hooks/useLanguagePair';

interface SpeakerState {
  speakerMap: Map<string, SpeakerInfo>;
  speakerEvents: SpeakerEvent[];
}

type SpeakerAction =
  | { type: 'ADD_SPEAKER'; payload: { speakerId: string; language: { code: string; name: string } } }
  | { type: 'UPDATE_SPEAKER'; payload: { speakerId: string; language: { code: string; name: string } } }
  | { type: 'SET_INACTIVE'; payload: { speakerId: string } }
  | { type: 'CLEAR_SPEAKERS' };

const initialState: SpeakerState = {
  speakerMap: new Map(),
  speakerEvents: [],
};

function speakerReducer(state: SpeakerState, action: SpeakerAction): SpeakerState {
  switch (action.type) {
    case 'ADD_SPEAKER': {
      const { speakerId, language } = action.payload;
      const newSpeakerMap = new Map(state.speakerMap);
      newSpeakerMap.set(speakerId, {
        language,
        lastSpoken: Date.now(),
        isActive: true,
      });

      return {
        ...state,
        speakerMap: newSpeakerMap,
        speakerEvents: [
          ...state.speakerEvents,
          {
            speakerId,
            language,
            timestamp: Date.now(),
            type: 'new',
          },
        ],
      };
    }

    case 'UPDATE_SPEAKER': {
      const { speakerId, language } = action.payload;
      const newSpeakerMap = new Map(state.speakerMap);
      const existingSpeaker = newSpeakerMap.get(speakerId);

      if (existingSpeaker) {
        newSpeakerMap.set(speakerId, {
          ...existingSpeaker,
          language,
          lastSpoken: Date.now(),
        });

        return {
          ...state,
          speakerMap: newSpeakerMap,
          speakerEvents: [
            ...state.speakerEvents,
            {
              speakerId,
              language,
              timestamp: Date.now(),
              type: 'update',
            },
          ],
        };
      }

      return state;
    }

    case 'SET_INACTIVE': {
      const { speakerId } = action.payload;
      const newSpeakerMap = new Map(state.speakerMap);
      const speaker = newSpeakerMap.get(speakerId);

      if (speaker) {
        newSpeakerMap.set(speakerId, {
          ...speaker,
          isActive: false,
        });

        return {
          ...state,
          speakerMap: newSpeakerMap,
          speakerEvents: [
            ...state.speakerEvents,
            {
              speakerId,
              language: speaker.language,
              timestamp: Date.now(),
              type: 'inactive',
            },
          ],
        };
      }

      return state;
    }

    case 'CLEAR_SPEAKERS': {
      return {
        ...initialState,
      };
    }

    default:
      return state;
  }
}

interface SpeakerContextType {
  state: SpeakerState;
  addSpeaker: (speakerId: string, language: { code: string; name: string }) => void;
  updateSpeaker: (speakerId: string, language: { code: string; name: string }) => void;
  setSpeakerInactive: (speakerId: string) => void;
  clearSpeakers: () => void;
  getActiveSpeakers: () => Array<[string, SpeakerInfo]>;
  getSpeakerById: (speakerId: string) => SpeakerInfo | undefined;
  getTranslationDirection: (speakerId: string) => { source: { code: string; name: string }; target: { code: string; name: string } } | null;
}

const SpeakerContext = createContext<SpeakerContextType | undefined>(undefined);

export function SpeakerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(speakerReducer, initialState);
  const { 
    lockedPair,
    getTranslationDirection: getPairTranslationDirection,
    handleNewSpeaker: handleNewSpeakerPair
  } = useLanguagePair();

  const addSpeaker = useCallback((speakerId: string, language: { code: string; name: string }) => {
    dispatch({ type: 'ADD_SPEAKER', payload: { speakerId, language } });
    const activeSpeakers = getActiveSpeakers();
    handleNewSpeakerPair(speakerId, language, activeSpeakers);
  }, [handleNewSpeakerPair]);

  const updateSpeaker = useCallback((speakerId: string, language: { code: string; name: string }) => {
    dispatch({ type: 'UPDATE_SPEAKER', payload: { speakerId, language } });
  }, []);

  const setSpeakerInactive = useCallback((speakerId: string) => {
    dispatch({ type: 'SET_INACTIVE', payload: { speakerId } });
  }, []);

  const clearSpeakers = useCallback(() => {
    dispatch({ type: 'CLEAR_SPEAKERS' });
  }, []);

  const getActiveSpeakers = useCallback(() => {
    return Array.from(state.speakerMap.entries()).filter(([_, info]) => info.isActive);
  }, [state.speakerMap]);

  const getSpeakerById = useCallback((speakerId: string) => {
    return state.speakerMap.get(speakerId);
  }, [state.speakerMap]);

  const getTranslationDirection = useCallback((speakerId: string) => {
    return getPairTranslationDirection(speakerId);
  }, [getPairTranslationDirection]);

  return (
    <SpeakerContext.Provider
      value={{
        state,
        addSpeaker,
        updateSpeaker,
        setSpeakerInactive,
        clearSpeakers,
        getActiveSpeakers,
        getSpeakerById,
        getTranslationDirection,
      }}
    >
      {children}
    </SpeakerContext.Provider>
  );
}

export function useSpeaker() {
  const context = useContext(SpeakerContext);
  if (context === undefined) {
    throw new Error('useSpeaker must be used within a SpeakerProvider');
  }
  return context;
} 