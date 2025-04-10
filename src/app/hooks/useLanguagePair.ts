"use client";

import { useState, useCallback } from 'react';
import { Language, LockedLanguagePair, Speaker } from '../types';
import { detectLanguage } from '../utils/languageDetection';

export const useLanguagePair = () => {
    // Initialize with default language pair: Chinese and English
    const [lockedLanguagePair, setLockedLanguagePair] = useState<LockedLanguagePair | null>({
        source: { code: 'zh', name: 'Chinese' },
        target: { code: 'en', name: 'English' }
    });

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
        setLastDetectedLanguage(language);
        
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

                // If the language is not in the pair, update the pair
                // Keep the last spoken language from the current pair
                const lastSpokenLanguage = lockedLanguagePair.target;
                
                // Update the locked pair with the new language and the last spoken language
                setLockedLanguagePair({
                    source: language,
                    target: lastSpokenLanguage
                });
            } else {
                // If no locked pair exists, create one with the new language and English
                // This is the first language detected
                const newPair = {
                    source: language,
                    target: { code: 'en', name: 'English' }
                };
                
                // Set the locked pair synchronously
                setLockedLanguagePair(newPair);
                
                // Return the new speaker with the language pair already set
                return [...prev, { speakerId, language, timestamp: Date.now(), isActive: true }];
            }

            return [...prev, { speakerId, language, timestamp: Date.now(), isActive: true }];
        });
    }, [lockedLanguagePair]);

    const getTranslationDirection = useCallback((speakerId: string) => {
        if (!lockedLanguagePair) return null;

        const speaker = activeSpeakers.find(s => s.speakerId === speakerId);
        if (!speaker) return null;

        // If speaker's language is the source language, translate to target
        if (speaker.language.code === lockedLanguagePair.source.code) {
            return {
                source: lockedLanguagePair.source,
                target: lockedLanguagePair.target
            };
        }
        
        // If speaker's language is the target language, translate to source
        if (speaker.language.code === lockedLanguagePair.target.code) {
            return {
                source: lockedLanguagePair.target,
                target: lockedLanguagePair.source
            };
        }

        // If the language is not in the pair, find the most recent active speaker
        const mostRecentSpeaker = activeSpeakers
            .filter(s => s.isActive && s.speakerId !== speakerId)
            .sort((a, b) => b.timestamp - a.timestamp)[0];

        if (mostRecentSpeaker) {
            // Update the locked pair with the new language and the most recent speaker's language
            setLockedLanguagePair({
                source: speaker.language,
                target: mostRecentSpeaker.language
            });

            return {
                source: speaker.language,
                target: mostRecentSpeaker.language
            };
        }

        // If no other active speaker, use the current source language
        return {
            source: speaker.language,
            target: lockedLanguagePair.source
        };
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
                        ? { ...s, language: detectedLanguage, isActive: true, timestamp: Date.now() }
                        : s
                );
            }
            return [...prev, { speakerId, language: detectedLanguage, isActive: true, timestamp: Date.now() }];
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