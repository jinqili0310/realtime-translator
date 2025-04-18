"use client";

import { ServerEvent, SessionStatus, AgentConfig } from "@/app/types";
import { useTranscript } from "@/app/contexts/TranscriptContext";
import { useEvent } from "@/app/contexts/EventContext";
import { useRef, useCallback } from "react";
import { useLanguagePair } from "./useLanguagePair";

// Declare the window property for recent translations cache
declare global {
  interface Window {
    _recentTranslations: Map<string, number>;
    _translatedItemIds: Set<string>;
  }
}

interface UseHandleServerEventParams {
  setSessionStatus: (status: SessionStatus) => void;
  selectedAgentName: string;
  selectedAgentConfigSet: AgentConfig[] | null;
  sendClientEvent: (eventObj: any, eventNameSuffix?: string) => void;
  setSelectedAgentName: (name: string) => void;
  activeLanguages: Array<{code: string, name: string}>;
  languagesDetected: boolean;
  speakerLanguages: Array<{speakerId: string, language: {code: string, name: string}, timestamp: number}>;
  translateAndSpeak: (text: string, sourceLang: string, targetLang: string) => Promise<string | null>;
  addMessage: (message: { id: string; role: "user" | "assistant"; content: string; timestamp: number }) => void;
}

interface TranslationDirection {
  source: string;
  target: string;
}

interface SpeakerLanguage {
  speakerId: string;
  language: {code: string, name: string};
  timestamp: number;
}

interface LockedLanguagePair {
  source: {code: string, name: string};
  target: {code: string, name: string};
  speakers: string[];
}

interface AudioTranscriptionCompleteEvent {
  transcription: string;
  speakerId: string;
}

interface ResponseDoneEvent {
  response: string;
  speakerId: string;
}

interface ServerResponseOutput {
  type?: string;
  name?: string;
  arguments?: any;
  call_id?: string;
  text?: string;
  transcript?: string;
  status_details?: {
    error?: any;
  };
}

// Extend the ServerEvent type
declare module "@/app/types" {
  interface ServerEvent {
    response?: {
      output?: {
        type?: string;
        name?: string;
        arguments?: any;
        call_id?: string;
      }[];
      status_details?: {
        error?: any;
      };
    };
  }
}

export const useHandleServerEvent = ({
  setSessionStatus,
  selectedAgentName,
  selectedAgentConfigSet,
  sendClientEvent,
  setSelectedAgentName,
  activeLanguages,
  languagesDetected,
  speakerLanguages,
  translateAndSpeak,
  addMessage
}: UseHandleServerEventParams) => {
  const {
    transcriptItems,
    addTranscriptBreadcrumb,
    addTranscriptMessage,
    updateTranscriptMessage,
    updateTranscriptItemStatus,
  } = useTranscript();

  const { logServerEvent } = useEvent();
  const { 
    getActiveSpeakers,
    updateSpeakerActivity,
    handleNewSpeaker,
    lockedLanguagePair,
    activeSpeakers,
    getTranslationDirection
  } = useLanguagePair();

  const handleServerEventRef = useRef<((event: any) => void) | null>(null);

  // Add cache for language detection results
  const languageDetectionCache = useRef<Map<string, {code: string, name: string}>>(new Map());

  const detectAndCacheLanguage = useCallback((text: string): {code: string, name: string} | null => {
    // Skip invalid text
    if (!text || text === "[inaudible]" || text === "[Transcribing...]") {
      return null;
    }

    // Check cache first
    const cachedResult = languageDetectionCache.current.get(text);
    if (cachedResult) {
      return cachedResult;
    }

    // Instead of auto-detecting, use the locked pair
    if (lockedLanguagePair && activeLanguages.length === 2) {
      // Default to source language (first language in the pair)
      const result = lockedLanguagePair.source;
      languageDetectionCache.current.set(text, result);
      return result;
    }

    return null;
  }, [lockedLanguagePair, activeLanguages]);

  // Helper function to check if text is already a translation
  const isTranslationMessage = (text: string) => {
    if (!text) return false;
    
    // Check for our translation format
    if (text.match(/\[\w+ → \w+\]/)) {
      return true;
    }

    return false;
  };

  const handleFunctionCall = async (functionCallParams: {
    name: string;
    call_id?: string;
    arguments: string;
  }) => {
    // For translation functions, modify the target language before logging
    if (functionCallParams.name === "translate_text") {
      let args = JSON.parse(functionCallParams.arguments);
      let translationArgs = args;
      const originalArgs = {...args}; // Store original args for logging
      
      // Check if this is a translation of something we just translated
      // Get a simple hash of the text to help identify repeat translations
      const textToTranslate = args.text;
      const textHash = textToTranslate ? 
        textToTranslate.substring(0, 20).replace(/\s+/g, '') : '';
      
      // Keep track of recent translations to avoid circular translations
      if (!window._recentTranslations) {
        window._recentTranslations = new Map();
      }
      
      // Check if we've seen this text pattern recently, which would indicate a circular translation
      const sourceLang = args.source_language;
      const targetLang = args.target_language;
      const translationKey = `${textHash}:${sourceLang}→${targetLang}`;
      
      if (window._recentTranslations.has(translationKey)) {
        const timestamp = window._recentTranslations.get(translationKey);
        // If this exact translation was requested in the last 3 seconds, it's likely circular
        if (timestamp && (Date.now() - timestamp < 3000)) {
          console.log('Skipping suspected circular translation:', {
            text: textToTranslate,
            source: sourceLang,
            target: targetLang,
            key: translationKey
          });
          
          // Continue the conversation flow
          sendClientEvent({ type: "response.create" });
          return;
        }
      }
      
      // Record this translation attempt
      window._recentTranslations.set(translationKey, Date.now());
      
      // Clean up old entries (keep only last 5 minutes of history)
      const cleanupTime = Date.now() - 5 * 60 * 1000;
      window._recentTranslations.forEach((timestamp, key) => {
        if (timestamp < cleanupTime) {
          window._recentTranslations.delete(key);
        }
      });
      
      let direction = null;
      
      // First, check if we have a locked language pair from user selection
      if (lockedLanguagePair) {
        // Get the actual source language
        const sourceLang = args.source_language;
        
        // If source is the first language in our pair, translate to the second
        if (sourceLang === lockedLanguagePair.source.code) {
          direction = {
            source: lockedLanguagePair.source,
            target: lockedLanguagePair.target
          };
        }
        // If source is the second language in our pair, translate to the first
        else if (sourceLang === lockedLanguagePair.target.code) {
          direction = {
            source: lockedLanguagePair.target, 
            target: lockedLanguagePair.source
          };
        }
        // If source doesn't match either language in our pair, try to detect from text
        else {
          // Default to the first direction in the pair
          direction = {
            source: lockedLanguagePair.source,
            target: lockedLanguagePair.target
          };
          console.log(`Source language ${sourceLang} not in language pair, using default direction`);
        }
        
        // Double-check that source and target are different
        if (direction.source.code === direction.target.code) {
          console.log('Warning: Source and target language are the same. Using default direction.');
          if (lockedLanguagePair.source.code !== lockedLanguagePair.target.code) {
            direction = {
              source: lockedLanguagePair.source,
              target: lockedLanguagePair.target
            };
          } else {
            console.log('Error: Selected language pair has same source and target. Cannot translate.');
            return; // Skip translation
          }
        }
      }
      // If no locked pair but we have active languages, use those
      else if (activeLanguages && activeLanguages.length >= 2) {
        // Get source language from args
        const sourceLang = args.source_language;
        
        // If source matches the first language in activeLanguages
        if (sourceLang === activeLanguages[0].code) {
          direction = {
            source: activeLanguages[0],
            target: activeLanguages[1]
          };
        }
        // If source matches the second language in activeLanguages
        else if (sourceLang === activeLanguages[1].code) {
          direction = {
            source: activeLanguages[1],
            target: activeLanguages[0]
          };
        }
        // If source doesn't match either, use first direction
        else {
          direction = {
            source: activeLanguages[0],
            target: activeLanguages[1]
          };
          console.log(`Source language ${sourceLang} not in active languages, using default direction`);
        }
        
        // Double-check that source and target are different
        if (direction.source.code === direction.target.code) {
          console.log('Warning: Source and target language are the same. Will not translate.');
          return; // Skip translation
        }
      }
      
      // If we have a valid direction, update the args
      if (direction && direction.source.code !== direction.target.code) {
        // Update args with the correct direction
        translationArgs = {
          ...args,
          source_language: direction.source.code,
          target_language: direction.target.code
        };
        
        // Replace the function arguments with the corrected ones
        functionCallParams.arguments = JSON.stringify(translationArgs);
        args = translationArgs;
        
        // Now log with the corrected args
        console.log('Translation function called with args:', args);
        // console.log('Current locked language pair:', lockedLanguagePair);
        console.log('Active languages:', activeLanguages);
        console.log(`Using language pair direction: ${direction.source.code} → ${direction.target.code}`);
        
        // Add breadcrumb with the corrected args
        addTranscriptBreadcrumb(`function call: ${functionCallParams.name}`, args);
        
        const currentAgent = selectedAgentConfigSet?.find(
          (a) => a.name === selectedAgentName
        );
        
        // Process the function call with the updated direction
        if (currentAgent?.toolLogic?.[functionCallParams.name]) {
          const fn = currentAgent.toolLogic[functionCallParams.name];
          
          try {
            console.log('Executing translation function with args:', args);
            const fnResult = await fn(args, transcriptItems);
            console.log('Translation result:', fnResult);
            
            // Ensure the translation is displayed and announced
            if (fnResult && fnResult.translated_text) {
              // Create a unique ID for this translation
              const translationId = `translation-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
              console.log(`Adding translation to UI with ID: ${translationId}`);
              
              // Format the message for display
              const formattedContent = `[${args.source_language} → ${args.target_language}] ${fnResult.translated_text}`;
              
              // Add the translation to the transcript with proper formatting
              addMessage({
                id: translationId,
                role: 'assistant',
                content: formattedContent,
                timestamp: Date.now()
              });
              
              // Log that we're adding this message
              console.log(`Added translation message to transcript: ${formattedContent}`);
              
              // Also speak the translation if it's going to the target language
              if (translateAndSpeak && typeof translateAndSpeak === 'function') {
                console.log(`Speaking translation: ${fnResult.translated_text}`);
                // Use the translated text directly from the result
                translateAndSpeak(
                  fnResult.translated_text,
                  args.target_language, // Source is already the target language 
                  args.target_language  // Keep same language for TTS
                ).catch(error => {
                  console.error('Error in TTS for translation:', error);
                });
              }
            } else {
              console.warn('Translation result missing translated_text property:', fnResult);
            }
            
            // Add breadcrumb for debugging
            addTranscriptBreadcrumb(
              `function call result: ${functionCallParams.name}`,
              fnResult
            );

            // Send the result to acknowledge completion of the function
            sendClientEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: functionCallParams.call_id,
                output: JSON.stringify(fnResult),
              },
            });
          } catch (error) {
            console.error('Error in translation function:', error);
          }
        }
      } else {
        console.log('No valid translation direction available. Details:');
        console.log('- Source language:', originalArgs.source_language);
        console.log('- Target language:', originalArgs.target_language);
        console.log('- Locked language pair:', lockedLanguagePair);
        console.log('- Active languages:', activeLanguages);
        
        // Skip translation if languages are the same
        if (direction && direction.source.code === direction.target.code) {
          console.log('Skipping translation: source and target languages are the same');
          sendClientEvent({ type: "response.create" });
          return;
        }
        
        // Add breadcrumb with the original args
        addTranscriptBreadcrumb(`function call: ${functionCallParams.name}`, originalArgs);
        
        // Fall back to using the args as provided
        const currentAgent = selectedAgentConfigSet?.find(
          (a) => a.name === selectedAgentName
        );
        
        if (currentAgent?.toolLogic?.[functionCallParams.name]) {
          console.log('Falling back to original args for translation:', args);
          const fn = currentAgent.toolLogic[functionCallParams.name];
          try {
            console.log('Falling back to original args for translation:', args);
            const fnResult = await fn(args, transcriptItems);
            console.log('Fallback translation result:', fnResult);
            
            // Ensure the translation is displayed and announced even in fallback case
            if (fnResult && fnResult.translated_text) {
              // Create a unique ID for this translation
              const translationId = `translation-fallback-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
              console.log(`Adding fallback translation to UI with ID: ${translationId}`);
              
              // Format the message for display
              const formattedContent = `[${args.source_language} → ${args.target_language}] ${fnResult.translated_text}`;
              
              // Add the translation to the transcript with proper formatting
              addMessage({
                id: translationId,
                role: 'assistant',
                content: formattedContent,
                timestamp: Date.now()
              });
              
              // Log that we're adding this message
              console.log(`Added fallback translation message to transcript: ${formattedContent}`);
              
              // Also speak the translation
              if (translateAndSpeak && typeof translateAndSpeak === 'function') {
                console.log(`Speaking fallback translation: ${fnResult.translated_text}`);
                // Use the translated text directly from the result
                translateAndSpeak(
                  fnResult.translated_text,
                  args.target_language, // Source is already the target language
                  args.target_language  // Keep same language for TTS
                ).catch(error => {
                  console.error('Error in TTS for fallback translation:', error);
                });
              }
            } else {
              console.warn('Fallback translation result missing translated_text property:', fnResult);
            }
            
            // Add breadcrumb for debugging
            addTranscriptBreadcrumb(
              `function call result: ${functionCallParams.name}`,
              fnResult
            );

            sendClientEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: functionCallParams.call_id,
                output: JSON.stringify(fnResult),
              },
            });
          } catch (error) {
            console.error('Error in fallback translation:', error);
          }
        }
      }
        
      // Always continue the conversation flow
      sendClientEvent({ type: "response.create" });
        
      // Return early since we've already handled everything
      return;
    }
    
    // For non-translation function calls, continue with the original logic
    const args = JSON.parse(functionCallParams.arguments);
    const currentAgent = selectedAgentConfigSet?.find(
      (a) => a.name === selectedAgentName
    );

    addTranscriptBreadcrumb(`function call: ${functionCallParams.name}`, args);
    
    if (currentAgent?.toolLogic?.[functionCallParams.name]) {
      const fn = currentAgent.toolLogic[functionCallParams.name];
      const fnResult = await fn(args, transcriptItems);
      addTranscriptBreadcrumb(
        `function call result: ${functionCallParams.name}`,
        fnResult
      );

      sendClientEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: functionCallParams.call_id,
          output: JSON.stringify(fnResult),
        },
      });
    }

    // Always continue the conversation flow
    sendClientEvent({ type: "response.create" });
  };

  const handleAudioTranscriptionComplete = useCallback(async (event: AudioTranscriptionCompleteEvent) => {
    const { transcription, speakerId } = event;
    
    // Skip invalid transcriptions
    if (!transcription || transcription === "[inaudible]" || transcription === "[Transcribing...]") {
      console.log('Skipping invalid transcription');
      return;
    }

    // Skip if already a translation message
    if (isTranslationMessage(transcription)) {
      console.log('Skipping translation: message is already a translation');
      return;
    }

    // Get translation direction based on locked language pair
    let sourceLanguage = null;
    let targetLanguage = null;
    const sourceText = transcription;
    
    console.log(`Processing transcription: "${transcription.substring(0, 30)}${transcription.length > 30 ? '...' : ''}"`);
    
    // Determine direction based on the locked language pair
    if (lockedLanguagePair) {
      // Verify that source and target in locked pair are different
      if (lockedLanguagePair.source.code === lockedLanguagePair.target.code) {
        console.log('Error: Locked language pair has identical source and target. Cannot translate.');
        return;
      }
      
      // Try to detect which language the text is in (from our pair only)
      // Since we disabled automatic language detection, use speaker info if available
      const speaker = activeSpeakers.find(s => s.speakerId === speakerId);
      console.log('Speaker info:', speaker);
      
      if (speaker) {
        // If we know which language the speaker uses, translate to the other language in the pair
        if (speaker.language.code === lockedLanguagePair.source.code) {
          sourceLanguage = lockedLanguagePair.source;
          targetLanguage = lockedLanguagePair.target;
          console.log(`Speaker uses source language (${sourceLanguage.code}), translating to target (${targetLanguage.code})`);
        } else if (speaker.language.code === lockedLanguagePair.target.code) {
          sourceLanguage = lockedLanguagePair.target;
          targetLanguage = lockedLanguagePair.source;
          console.log(`Speaker uses target language (${sourceLanguage.code}), translating to source (${targetLanguage.code})`);
        } else {
          // Default to source->target if speaker language doesn't match either
          sourceLanguage = lockedLanguagePair.source;
          targetLanguage = lockedLanguagePair.target;
          console.log(`Speaker language (${speaker.language.code}) doesn't match pair, using default direction`);
        }
      } else {
        // If no speaker info, default to translating from source to target language
        sourceLanguage = lockedLanguagePair.source;
        targetLanguage = lockedLanguagePair.target;
        console.log(`No speaker info, using default direction (${sourceLanguage.code} -> ${targetLanguage.code})`);
      }
    } 
    // If no locked pair but we have active languages, use those
    else if (activeLanguages && activeLanguages.length >= 2) {
      // Verify that active languages are different
      if (activeLanguages[0].code === activeLanguages[1].code) {
        console.log('Error: Active languages are identical. Cannot translate.');
        return;
      }
      
      sourceLanguage = activeLanguages[0];
      targetLanguage = activeLanguages[1];
      console.log(`Using active languages: ${sourceLanguage.code} -> ${targetLanguage.code}`);
    }
    
    // Skip if we couldn't determine languages
    if (!sourceLanguage || !targetLanguage) {
      console.log('Could not determine source and target languages for translation');
      return;
    }
    
    // Double-check that source and target languages are different
    if (sourceLanguage.code === targetLanguage.code) {
      console.log(`Error: Source and target languages are the same (${sourceLanguage.code}). Skipping translation.`);
      return;
    }

    console.log(`Translating from ${sourceLanguage.code} to ${targetLanguage.code}`);

    try {
      if (!translateAndSpeak || typeof translateAndSpeak !== 'function') {
        console.error('translateAndSpeak is not a function');
        return;
      }

      // Translate the transcription
      console.log(`Sending text for translation: "${sourceText.substring(0, 30)}${sourceText.length > 30 ? '...' : ''}"`);
      const translatedText = await translateAndSpeak(
        sourceText,
        sourceLanguage.code,
        targetLanguage.code
      );

      if (translatedText) {
        const translationId = `translation-${speakerId}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        console.log(`Adding transcription translation to UI with ID: ${translationId}`);
        
        // Format the message for display
        const formattedContent = `[${sourceLanguage.code} → ${targetLanguage.code}] ${translatedText}`;
        
        // Add to transcript
        addMessage({
          id: translationId,
          role: 'assistant',
          content: formattedContent,
          timestamp: Date.now()
        });
        
        console.log(`Added transcription translation to UI: ${formattedContent}`);
        
        // Also speak the translation
        if (translateAndSpeak && typeof translateAndSpeak === 'function') {
          console.log(`Speaking transcription translation: ${translatedText}`);
          try {
            await translateAndSpeak(
              translatedText,  
              targetLanguage.code,  // Already in target language
              targetLanguage.code   // Keep same language for TTS
            );
          } catch (ttsError) {
            console.error('Error in TTS for transcription translation:', ttsError);
          }
        }
      } else {
        console.warn('No translation result returned for transcription');
      }
    } catch (error) {
      console.error('Error in translation:', error);
    }
  }, [activeSpeakers, lockedLanguagePair, activeLanguages, translateAndSpeak, addMessage, isTranslationMessage]);

  const handleResponseDone = useCallback(async (event: ResponseDoneEvent) => {
    const { response, speakerId } = event;
    
    // Skip invalid or already translated responses
    if (!response || isTranslationMessage(response)) {
      console.log('Skipping translation: invalid or already translated message');
      return;
    }
    
    console.log(`Processing assistant response: "${response.substring(0, 30)}${response.length > 30 ? '...' : ''}"`);
    
    // Get translation direction based on locked language pair
    let sourceLanguage = null;
    let targetLanguage = null;
    const sourceText = response;
    
    // Determine direction based on the locked language pair
    if (lockedLanguagePair) {
      // Verify that source and target in locked pair are different
      if (lockedLanguagePair.source.code === lockedLanguagePair.target.code) {
        console.log('Error: Locked language pair has identical source and target. Cannot translate.');
        return;
      }
      
      // For assistant responses, we assume they're in the target language of the last user message
      // and need to be translated back to the source language
      
      // Try to find the speaker associated with this response
      const speaker = activeSpeakers.find(s => s.speakerId === speakerId);
      console.log('Assistant response speaker info:', speaker);
      
      if (speaker) {
        // If we know which language the speaker uses, translate assistant response to that language
        if (speaker.language.code === lockedLanguagePair.source.code) {
          // Assistant response is assumed to be in target language, translate to source
          sourceLanguage = lockedLanguagePair.target;
          targetLanguage = lockedLanguagePair.source;
          console.log(`Speaker uses source language (${targetLanguage.code}), translating from target (${sourceLanguage.code})`);
        } else if (speaker.language.code === lockedLanguagePair.target.code) {
          // Assistant response is assumed to be in source language, translate to target
          sourceLanguage = lockedLanguagePair.source;
          targetLanguage = lockedLanguagePair.target;
          console.log(`Speaker uses target language (${targetLanguage.code}), translating from source (${sourceLanguage.code})`);
        } else {
          // Default to target->source if speaker language doesn't match either
          sourceLanguage = lockedLanguagePair.target;
          targetLanguage = lockedLanguagePair.source;
          console.log(`Speaker language (${speaker.language.code}) doesn't match pair, using default direction`);
        }
      } else {
        // If no speaker info, default to translating from target to source language
        sourceLanguage = lockedLanguagePair.target;
        targetLanguage = lockedLanguagePair.source;
        console.log(`No speaker info for assistant response, using default reverse direction (${sourceLanguage.code} -> ${targetLanguage.code})`);
      }
    }
    // If no locked pair but we have active languages, use those
    else if (activeLanguages && activeLanguages.length >= 2) {
      // Verify that active languages are different
      if (activeLanguages[0].code === activeLanguages[1].code) {
        console.log('Error: Active languages are identical. Cannot translate.');
        return;
      }
      
      // For assistant responses, use reverse direction from user messages
      sourceLanguage = activeLanguages[1];  // Second language is assumed to be target for user messages
      targetLanguage = activeLanguages[0];  // First language is assumed to be source for user messages
      console.log(`Using reversed active languages: ${sourceLanguage.code} -> ${targetLanguage.code}`);
    }
    
    // Skip if we couldn't determine languages
    if (!sourceLanguage || !targetLanguage) {
      console.log('Could not determine source and target languages for translation');
      return;
    }
    
    // Double-check that source and target languages are different
    if (sourceLanguage.code === targetLanguage.code) {
      console.log(`Error: Source and target languages are the same (${sourceLanguage.code}). Skipping translation.`);
      return;
    }

    console.log(`Translating assistant response from ${sourceLanguage.code} to ${targetLanguage.code}`);

    try {
      if (!translateAndSpeak || typeof translateAndSpeak !== 'function') {
        console.error('translateAndSpeak is not a function');
        return;
      }

      // Translate the assistant's response
      console.log(`Sending assistant response for translation: "${sourceText.substring(0, 30)}${sourceText.length > 30 ? '...' : ''}"`);
      const translatedText = await translateAndSpeak(
        sourceText,
        sourceLanguage.code,
        targetLanguage.code
      );

      if (translatedText) {
        const translationId = `translation-response-${speakerId}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        console.log(`Adding assistant response translation to UI with ID: ${translationId}`);
        
        // Format the message for display
        const formattedContent = `[${sourceLanguage.code} → ${targetLanguage.code}] ${translatedText}`;
        
        // Add to transcript
        addMessage({
          id: translationId,
          role: 'assistant',
          content: formattedContent,
          timestamp: Date.now()
        });
        
        console.log(`Added assistant response translation to UI: ${formattedContent}`);
        
        // Also speak the translation
        if (translateAndSpeak && typeof translateAndSpeak === 'function') {
          console.log(`Speaking assistant response translation: ${translatedText}`);
          try {
            await translateAndSpeak(
              translatedText,
              targetLanguage.code,  // Already in target language
              targetLanguage.code   // Keep same language for TTS
            );
          } catch (ttsError) {
            console.error('Error in TTS for assistant response translation:', ttsError);
          }
        }
      } else {
        console.warn('No translation result returned for assistant response');
      }
    } catch (error) {
      console.error('Error in assistant response translation:', error);
    }
  }, [activeSpeakers, lockedLanguagePair, activeLanguages, translateAndSpeak, addMessage, isTranslationMessage]);

  const handleServerEvent = (serverEvent: ServerEvent) => {
    logServerEvent(serverEvent);

    // Track items we've already sent for translation
    if (!window._translatedItemIds) {
      window._translatedItemIds = new Set();
    }

    switch (serverEvent.type) {
      case "session.created": {
        if (serverEvent.session?.id) {
          setSessionStatus("CONNECTED");
          addTranscriptBreadcrumb(
            `session.id: ${
              serverEvent.session.id
            }\nStarted at: ${new Date().toLocaleString()}`
          );
        }
        break;
      }

      case "conversation.item.created": {
        let text =
          serverEvent.item?.content?.[0]?.text ||
          serverEvent.item?.content?.[0]?.transcript ||
          "";
        const role = serverEvent.item?.role as "user" | "assistant";
        const itemId = serverEvent.item?.id;

        if (itemId && transcriptItems.some((item) => item.itemId === itemId)) {
          break;
        }

        // Skip displaying duplicate translations - check if this is a translation message
        // that we've already processed or that will be handled by our own translation system
        if (itemId && role && 
            languagesDetected && 
            text && 
            isTranslationMessage(text) &&
            // Check if this is an automatic translation we should skip
            text.match(/\[(en|ko|zh|ja|ru|ar|fr|es|de) → (en|ko|zh|ja|ru|ar|fr|es|de)\]/)) {
          
          // Check if this translation already exists or we'd create it ourselves
          const translationExists = transcriptItems.some(item => 
            item.title === text || 
            (item.title && item.title.includes(text.replace(/\[\w+ → \w+\] /, "")))
          );
          
          if (translationExists) {
            // Skip adding this duplicate translation
            break;
          }
        }

        if (itemId && role) {
          if (role === "user" && !text) {
            text = "[Transcribing...]";
          }
          addTranscriptMessage(itemId, role, text);
        }
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const itemId = serverEvent.item_id;
        const finalTranscript =
          !serverEvent.transcript || serverEvent.transcript === "\n"
            ? "[inaudible]"
            : serverEvent.transcript;
        if (itemId) {
          updateTranscriptMessage(itemId, finalTranscript, false);
          
          // After transcript is complete, translate if languages are detected
          if (languagesDetected && 
              finalTranscript !== "[inaudible]" &&
              !isTranslationMessage(finalTranscript)) {
            
            // Detect the language of this specific message
            const detectedLanguage = detectAndCacheLanguage(finalTranscript);
            
            if (detectedLanguage) {
              // Find existing speaker with this language
              const existingSpeakerWithLanguage = activeSpeakers.find(s => 
                s.language.code === detectedLanguage.code
              );
              
              let speakerId = itemId;
              if (existingSpeakerWithLanguage) {
                // If we found a speaker with the same language, just update their activity
                speakerId = existingSpeakerWithLanguage.speakerId;
                updateSpeakerActivity(speakerId, true);
                console.log(`Speaker activity updated for language: ${detectedLanguage.code}`);
              } else {
                // Create a new speaker for this language
                handleNewSpeaker(speakerId, detectedLanguage);
                console.log(`New language detected: ${detectedLanguage.code}`);
              }

              // Get translation direction and handle translation
              const direction = getTranslationDirection(speakerId);
              if (direction && direction.source.code !== direction.target.code) {
                // Use setTimeout to ensure state updates are processed
                setTimeout(() => {
                  handleAudioTranscriptionComplete({
                    transcription: finalTranscript,
                    speakerId
                  });
                }, 0);
              }
            }
          }
        }
        break;
      }

      case "conversation.item.assistant.response.done": {
        const itemId = serverEvent.item_id;
        const response = serverEvent.response?.output?.[0]?.arguments;
        if (itemId && response) {
          updateTranscriptMessage(itemId, response, false);
          
          // Get the most recent user speaker
          const activeSpeakersList = getActiveSpeakers();
          const mostRecentUserSpeaker = activeSpeakersList.find(s => 
            s.speakerId.startsWith('user-')
          );

          // Only translate if we have a valid language pair and different languages
          if (mostRecentUserSpeaker && 
              lockedLanguagePair && 
              lockedLanguagePair.source.code !== lockedLanguagePair.target.code) {
            handleResponseDone({
              response,
              speakerId: mostRecentUserSpeaker.speakerId
            });
          }
        }
        break;
      }

      case "response.audio_transcript.delta": {
        const itemId = serverEvent.item_id;
        const deltaText = serverEvent.delta || "";
        if (itemId) {
          updateTranscriptMessage(itemId, deltaText, true);
        }
        break;
      }

      case "response.done": {
        // Find the most recent assistant message to translate
        if (languagesDetected) {
          const assistantMessages = transcriptItems.filter(
            item => item.role === "assistant" && 
                   item.status === "DONE" && 
                   !item.itemId.startsWith("translation-") &&
                   // Skip messages that already look like translations
                   !isTranslationMessage(item.title || "")
          );
          
          if (assistantMessages.length > 0) {
            const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
          }
        }

        // Process function calls in response
        if (serverEvent.response?.output) {
          // Group function calls to avoid duplicate translations
          const functionCalls = new Map();
          
          // First collect all function calls in this batch
          serverEvent.response.output.forEach((outputItem) => {
            if (
              outputItem.type === "function_call" &&
              outputItem.name &&
              outputItem.arguments
            ) {
              // Use function name and call_id as key to deduplicate
              const callKey = `${outputItem.name}:${outputItem.call_id}`;
              functionCalls.set(callKey, {
                name: outputItem.name,
                call_id: outputItem.call_id,
                arguments: outputItem.arguments
              });
            }
          });
          
          // Now process the deduplicated function calls
          for (const functionCall of functionCalls.values()) {
            // Get the most recent active speaker
            const mostRecentSpeaker = activeSpeakers
              .filter(s => s.isActive)
              .sort((a, b) => b.timestamp - a.timestamp)[0];

            // Parse the arguments and add the speaker ID
            const args = JSON.parse(functionCall.arguments);
            if (mostRecentSpeaker) {
              args.speaker_id = mostRecentSpeaker.speakerId;
            }

            // Check if we've already processed this exact function call
            const callWithArgsKey = `${functionCall.name}:${JSON.stringify(args)}`;
            if (window._translatedItemIds.has(callWithArgsKey)) {
              console.log(`Skipping duplicate function call: ${callWithArgsKey}`);
              continue;
            }
            
            // Mark this function call as processed
            window._translatedItemIds.add(callWithArgsKey);
            
            // Process the function call
            handleFunctionCall({
              name: functionCall.name,
              call_id: functionCall.call_id,
              arguments: JSON.stringify(args),
            });
          }
        }
        break;
      }

      case "response.output_item.done": {
        const itemId = serverEvent.item?.id;
        if (itemId) {
          updateTranscriptItemStatus(itemId, "DONE");
        }
        break;
      }

      default:
        break;
    }
  };

  handleServerEventRef.current = handleServerEvent;

  return handleServerEventRef;
};

// Helper function to get language name from code
const getLanguageName = (code: string): string => {
  const languageNames: Record<string, string> = {
    'en': 'English',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ru': 'Russian',
    'ar': 'Arabic',
    'fr': 'French',
    'es': 'Spanish',
    'de': 'German'
  };
  return languageNames[code] || code;
};
