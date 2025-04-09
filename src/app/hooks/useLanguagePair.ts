"use client";

import { useState, useCallback } from 'react';
import { detectLanguage } from '../utils/languageDetection';

interface Language {
  code: string;
  name: string;
}

interface Speaker {
  speakerId: string;
  language: Language;
  timestamp: number;
  isActive: boolean;
}

interface LockedLanguagePair {
  source: Language;
  target: Language;
  speakers: string[];
}

interface TranslationDirection {
  source: Language;
  target: Language;
}

export const useLanguagePair = () => {
  const [lockedLanguagePair, setLockedLanguagePair] = useState<LockedLanguagePair | null>(null);
  const [activeSpeakers, setActiveSpeakers] = useState<Speaker[]>([]);
  const [lastDetectedLanguage, setLastDetectedLanguage] = useState<Language | null>(null);

  const updateSpeakerActivity = useCallback((speakerId: string, isActive: boolean) => {
    setActiveSpeakers(prev => 
      prev.map(speaker => 
        speaker.speakerId === speakerId 
          ? { ...speaker, isActive, timestamp: Date.now() }
          : speaker
      )
    );
  }, []);

  const getActiveSpeakers = useCallback(() => {
    return activeSpeakers
      .filter(speaker => speaker.isActive)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [activeSpeakers]);

  const handleNewSpeaker = useCallback((speakerId: string, language: Language) => {
    setActiveSpeakers(prev => {
      // First, check if we already have a speaker with this language
      const existingSpeakerWithLanguage = prev.find(s => s.language.code === language.code);
      
      if (existingSpeakerWithLanguage) {
        // If we found a speaker with the same language, just update their activity
        return prev.map(speaker => 
          speaker.speakerId === existingSpeakerWithLanguage.speakerId
            ? { ...speaker, isActive: true, timestamp: Date.now() }
            : speaker
        );
      }

      // If we have a locked pair, check if this language is already in it
      if (lockedLanguagePair) {
        const isLanguageInPair = 
          lockedLanguagePair.source.code === language.code || 
          lockedLanguagePair.target.code === language.code;

        if (isLanguageInPair) {
          // If the language is already in the pair, just add the speaker
          return [...prev, { speakerId, language, timestamp: Date.now(), isActive: true }];
        }
      }

      // If we get here, this is a new language
      const newSpeakers = [...prev, { speakerId, language, timestamp: Date.now(), isActive: true }];
      
      // Only update the locked pair if we have exactly two different languages
      const uniqueLanguages = new Set(newSpeakers.map(s => s.language.code));
      if (uniqueLanguages.size === 2) {
        const activeSpeakersList = newSpeakers
          .filter(s => s.isActive)
          .sort((a, b) => b.timestamp - a.timestamp);
        
        if (activeSpeakersList.length >= 2) {
          const [first, second] = activeSpeakersList;
          // Only set the pair if the languages are different
          if (first.language.code !== second.language.code) {
            setLockedLanguagePair({
              source: first.language,
              target: second.language,
              speakers: [first.speakerId, second.speakerId]
            });
            console.log(`Locked language pair: ${first.language.code} ↔ ${second.language.code}`);
          }
        }
      }

      return newSpeakers;
    });
  }, [lockedLanguagePair]);

  const getTranslationDirection = useCallback((speakerId: string): TranslationDirection | null => {
    if (!lockedLanguagePair) return null;

    // Find the current speaker
    const currentSpeaker = activeSpeakers.find(s => s.speakerId === speakerId);
    if (!currentSpeaker) return null;

    // If the current speaker's language is the source language, translate to target
    if (currentSpeaker.language.code === lockedLanguagePair.source.code) {
      return {
        source: lockedLanguagePair.source,
        target: lockedLanguagePair.target
      };
    }
    // If the current speaker's language is the target language, translate to source
    else if (currentSpeaker.language.code === lockedLanguagePair.target.code) {
      return {
        source: lockedLanguagePair.target,
        target: lockedLanguagePair.source
      };
    }

    return null;
  }, [lockedLanguagePair, activeSpeakers]);

  const handleLanguageDetection = useCallback((text: string, speakerId: string) => {
    const detectedLanguage = detectLanguage(text);
    if (!detectedLanguage) return null;

    // Update last detected language
    setLastDetectedLanguage(detectedLanguage);

    setActiveSpeakers(prev => {
      const existingSpeaker = prev.find(s => s.speakerId === speakerId);
      if (existingSpeaker) {
        return prev.map(s => 
          s.speakerId === speakerId 
            ? {...s, language: detectedLanguage, isActive: true, timestamp: Date.now()}
            : s
        );
      }
      return [...prev, {speakerId, language: detectedLanguage, isActive: true, timestamp: Date.now()}];
    });

    return detectedLanguage;
  }, []);

  return {
    lockedLanguagePair,
    activeSpeakers,
    lastDetectedLanguage,
    updateSpeakerActivity,
    getActiveSpeakers,
    handleNewSpeaker,
    getTranslationDirection,
    handleLanguageDetection
  };
}; 