"use client";

import { useState, useCallback } from 'react';
import { Language, LockedLanguagePair, Speaker } from '../types';
// Commented out language detection import as we're disabling automatic detection
// import { detectLanguage } from '../utils/languageDetection';

export const useLanguagePair = () => {
    // Initialize with null to force language selection
    const [lockedLanguagePair, setLockedLanguagePair] = useState<LockedLanguagePair | null>(null);
    const [activeSpeakers, setActiveSpeakers] = useState<Speaker[]>([]);
    const [lastDetectedLanguage, setLastDetectedLanguage] = useState<Language | null>(null);
    // New state for tracking if modal should be shown
    const [shouldShowLanguageModal, setShouldShowLanguageModal] = useState<boolean>(true);

    // Available languages list
    const availableLanguages: Language[] = [
        { code: 'en', name: 'English' },
        { code: 'zh', name: 'Chinese' },
        { code: 'es', name: 'Spanish' },
        { code: 'fr', name: 'French' },
        { code: 'de', name: 'German' },
        { code: 'ja', name: 'Japanese' },
        { code: 'ko', name: 'Korean' },
        { code: 'ru', name: 'Russian' },
        { code: 'ar', name: 'Arabic' },
    ];

    // Set language pair explicitly - called from modal
    const setLanguagePair = useCallback((pair: LockedLanguagePair | null) => {
        if (pair) {
            console.log(`Setting locked language pair to ${pair.source.name} ↔ ${pair.target.name}`);
            
            // Clear any existing speakers when setting a new pair
            setActiveSpeakers([]);
            
            // Set the language pair and hide modal
            setLockedLanguagePair(pair);
            setShouldShowLanguageModal(false);
        } else {
            // If null is passed, keep the modal open
            console.log('No language pair selected, keeping modal open');
        }
    }, []);

    // Reset pair selection
    const resetLanguagePair = useCallback(() => {
        setLockedLanguagePair(null);
        setShouldShowLanguageModal(true);
    }, []);

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

    // Simplified function to add a new speaker - uses locked language pair rather than detection
    const handleNewSpeaker = useCallback((speakerId: string, language: Language) => {
        // Only set language if it matches one of our locked pair
        if (!lockedLanguagePair) return;
        
        // Only accept languages that are part of the locked pair
        if (language.code !== lockedLanguagePair.source.code && 
            language.code !== lockedLanguagePair.target.code) {
            console.log(`Ignoring language ${language.code} as it's not in the locked pair`);
            return;
        }
        
        setLastDetectedLanguage(language);
        
        setActiveSpeakers(prev => {
            // Check if we already have this speaker
            const existingSpeaker = prev.find(s => s.speakerId === speakerId);
            
            if (existingSpeaker) {
                // Update existing speaker
                return prev.map(speaker => 
                    speaker.speakerId === speakerId
                        ? { ...speaker, language, isActive: true, timestamp: Date.now() }
                        : speaker
                );
            }
            
            // Add new speaker
            return [...prev, { speakerId, language, timestamp: Date.now(), isActive: true }];
        });
    }, [lockedLanguagePair]);

    const getTranslationDirection = useCallback((speakerId: string) => {
        // If we don't have a locked pair but have active speakers, try to determine direction
        if (!lockedLanguagePair) {
            console.log("No locked language pair for translation direction");
            return null;
        }

        // Try to get the specific speaker
        const speaker = activeSpeakers.find(s => s.speakerId === speakerId);
        
        // If no speaker found but we have a locked pair, use that
        if (!speaker) {
            console.log(`Speaker ${speakerId} not found, using default direction`);
            return {
                source: lockedLanguagePair.source,
                target: lockedLanguagePair.target
            };
        }

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

        // If language doesn't match either in our pair, use source -> target
        console.log(`Speaker language ${speaker.language.code} doesn't match pair, using default direction`);
        return {
            source: lockedLanguagePair.source,
            target: lockedLanguagePair.target
        };
    }, [lockedLanguagePair, activeSpeakers]);

    // Commented out as we're disabling automatic detection
    // Only use this when we already know the language based on the locked pair
    const handleLanguageDetection = useCallback((text: string, speakerId: string) => {
        if (!lockedLanguagePair) return null;
        
        // Skip actual detection, just check if speaker is already assigned a language
        const existingSpeaker = activeSpeakers.find(s => s.speakerId === speakerId);
        
        if (existingSpeaker) {
            // Check if language is in our locked pair
            if (existingSpeaker.language.code === lockedLanguagePair.source.code ||
                existingSpeaker.language.code === lockedLanguagePair.target.code) {
                return existingSpeaker.language;
            }
            
            // If not, assign the source language by default
            return lockedLanguagePair.source;
        }
        
        // For new speakers, default to source language
        const defaultLanguage = lockedLanguagePair.source;
        
        setActiveSpeakers(prev => [
            ...prev, 
            { 
                speakerId, 
                language: defaultLanguage, 
                isActive: true, 
                timestamp: Date.now() 
            }
        ]);
        
        return defaultLanguage;
    }, [lockedLanguagePair, activeSpeakers]);

    return {
        lockedLanguagePair,
        activeSpeakers,
        lastDetectedLanguage,
        availableLanguages,
        shouldShowLanguageModal,
        setLanguagePair,
        resetLanguagePair,
        updateSpeakerActivity,
        getActiveSpeakers,
        handleNewSpeaker,
        getTranslationDirection,
        handleLanguageDetection
    };
}; 