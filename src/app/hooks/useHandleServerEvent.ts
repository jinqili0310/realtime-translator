"use client";

import { ServerEvent, SessionStatus, AgentConfig } from "@/app/types";
import { useTranscript } from "@/app/contexts/TranscriptContext";
import { useEvent } from "@/app/contexts/EventContext";
import { useRef, useState, useCallback } from "react";
import { useLanguagePair } from "./useLanguagePair";
import { SpeakerInfo } from "@/app/types";

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
    const args = JSON.parse(functionCallParams.arguments);
    const currentAgent = selectedAgentConfigSet?.find(
      (a) => a.name === selectedAgentName
    );

    addTranscriptBreadcrumb(`function call: ${functionCallParams.name}`, args);

    // For translation functions, modify the target language to match our UI settings
    if (functionCallParams.name === "translate_text") {
      console.log('Translation function called with args:', args);
      console.log('Current locked language pair:', lockedLanguagePair);
      console.log('Active languages:', activeLanguages);
      
      // Create a translation direction object
      let direction = null;
      let translationArgs = args;
      
      // First, check if we have a locked language pair from user selection
      if (lockedLanguagePair) {
        // Determine direction based on source language in the request
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
        // If source doesn't match either language in our pair, use default pair direction
        else {
          direction = {
            source: lockedLanguagePair.source,
            target: lockedLanguagePair.target
          };
          console.log(`Source language ${sourceLang} not in language pair, using default direction`);
        }
        
        // Log the selected direction
        console.log(`Using locked language pair direction: ${direction.source.code} → ${direction.target.code}`);
      }
      // If no locked pair but we have active languages, use those
      else if (activeLanguages && activeLanguages.length >= 2) {
        // Default to first direction
        direction = {
          source: activeLanguages[0],
          target: activeLanguages[1]
        };
        
        // Check if source matches second language, then reverse
        if (args.source_language === activeLanguages[1].code) {
          direction = {
            source: activeLanguages[1],
            target: activeLanguages[0]
          };
        }
        
        console.log(`Using active languages for direction: ${direction.source.code} → ${direction.target.code}`);
      }
      
      if (direction) {
        // Create a new object with the correct direction, preserving other args
        translationArgs = {
          ...args,
          source_language: direction.source.code,
          target_language: direction.target.code
        };
        
        console.log('Calling translation with args:', translationArgs);
        
        // Process the function call with the updated direction
        if (currentAgent?.toolLogic?.[functionCallParams.name]) {
          const fn = currentAgent.toolLogic[functionCallParams.name];
          
          const fnResult = await fn(translationArgs, transcriptItems);
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
        }
      } else {
        console.log('No translation direction available. Details:');
        console.log('- Source language:', args.source_language);
        console.log('- Target language:', args.target_language);
        console.log('- Locked language pair:', lockedLanguagePair);
        console.log('- Active languages:', activeLanguages);
        
        // Fall back to using the args as provided
        if (currentAgent?.toolLogic?.[functionCallParams.name]) {
          console.log('Falling back to original args for translation');
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
      }
    } else {
      // Handle other function calls as before
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
    
    // Determine direction based on the locked language pair
    if (lockedLanguagePair) {
      // Try to detect which language the text is in (from our pair only)
      // Since we disabled automatic language detection, estimate based on speaker info if available
      const speaker = activeSpeakers.find(s => s.speakerId === speakerId);
      
      if (speaker) {
        // If we know which language the speaker uses, translate to the other language in the pair
        if (speaker.language.code === lockedLanguagePair.source.code) {
          sourceLanguage = lockedLanguagePair.source;
          targetLanguage = lockedLanguagePair.target;
        } else if (speaker.language.code === lockedLanguagePair.target.code) {
          sourceLanguage = lockedLanguagePair.target;
          targetLanguage = lockedLanguagePair.source;
        } else {
          // Default to source->target if speaker language doesn't match either
          sourceLanguage = lockedLanguagePair.source;
          targetLanguage = lockedLanguagePair.target;
        }
      } else {
        // If no speaker info, default to translating from source to target language
        sourceLanguage = lockedLanguagePair.source;
        targetLanguage = lockedLanguagePair.target;
      }
    } 
    // If no locked pair but we have active languages, use those
    else if (activeLanguages && activeLanguages.length >= 2) {
      sourceLanguage = activeLanguages[0];
      targetLanguage = activeLanguages[1];
    }
    
    // Skip if we couldn't determine languages
    if (!sourceLanguage || !targetLanguage) {
      console.log('Could not determine source and target languages for translation');
      return;
    }
    
    // Only translate if source and target languages are different
    if (sourceLanguage.code === targetLanguage.code) {
      console.log(`Skipping translation: same language (${sourceLanguage.code})`);
      return;
    }

    console.log(`Translating from ${sourceLanguage.code} to ${targetLanguage.code}`);

    try {
      if (!translateAndSpeak || typeof translateAndSpeak !== 'function') {
        console.error('translateAndSpeak is not a function');
        return;
      }

      // Translate the transcription
      const translatedText = await translateAndSpeak(
        transcription,
        sourceLanguage.code,
        targetLanguage.code
      );

      if (translatedText) {
        const translationId = `translation-${speakerId}-${Date.now()}`;
        addMessage({
          id: translationId,
          role: 'assistant',
          content: `[${sourceLanguage.code} → ${targetLanguage.code}] ${translatedText}`,
          timestamp: Date.now()
        });
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
    
    // Get translation direction based on locked language pair
    let sourceLanguage = null;
    let targetLanguage = null;
    
    // Determine direction based on the locked language pair
    if (lockedLanguagePair) {
      // For assistant responses, we assume they're in the target language of the last user message
      // and need to be translated back to the source language
      
      // Try to find the speaker associated with this response
      const speaker = activeSpeakers.find(s => s.speakerId === speakerId);
      
      if (speaker) {
        // If we know which language the speaker uses, translate assistant response to that language
        if (speaker.language.code === lockedLanguagePair.source.code) {
          // Assistant response is assumed to be in target language, translate to source
          sourceLanguage = lockedLanguagePair.target;
          targetLanguage = lockedLanguagePair.source;
        } else if (speaker.language.code === lockedLanguagePair.target.code) {
          // Assistant response is assumed to be in source language, translate to target
          sourceLanguage = lockedLanguagePair.source;
          targetLanguage = lockedLanguagePair.target;
        } else {
          // Default to target->source if speaker language doesn't match either
          sourceLanguage = lockedLanguagePair.target;
          targetLanguage = lockedLanguagePair.source;
        }
      } else {
        // If no speaker info, default to translating from target to source language
        sourceLanguage = lockedLanguagePair.target;
        targetLanguage = lockedLanguagePair.source;
      }
    }
    // If no locked pair but we have active languages, use those
    else if (activeLanguages && activeLanguages.length >= 2) {
      // For assistant responses, use reverse direction from user messages
      sourceLanguage = activeLanguages[1];  // Second language is assumed to be target for user messages
      targetLanguage = activeLanguages[0];  // First language is assumed to be source for user messages
    }
    
    // Skip if we couldn't determine languages
    if (!sourceLanguage || !targetLanguage) {
      console.log('Could not determine source and target languages for translation');
      return;
    }
    
    // Only translate if source and target languages are different
    if (sourceLanguage.code === targetLanguage.code) {
      console.log(`Skipping translation: same language (${sourceLanguage.code})`);
      return;
    }

    console.log(`Translating assistant response from ${sourceLanguage.code} to ${targetLanguage.code}`);

    try {
      if (!translateAndSpeak || typeof translateAndSpeak !== 'function') {
        console.error('translateAndSpeak is not a function');
        return;
      }

      // Translate the assistant's response
      const translatedText = await translateAndSpeak(
        response,
        sourceLanguage.code,
        targetLanguage.code
      );

      if (translatedText) {
        const translationId = `translation-${speakerId}-${Date.now()}`;
        addMessage({
          id: translationId,
          role: 'assistant',
          content: `[${sourceLanguage.code} → ${targetLanguage.code}] ${translatedText}`,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Error in translation:', error);
    }
  }, [activeSpeakers, lockedLanguagePair, activeLanguages, translateAndSpeak, addMessage, isTranslationMessage]);

  const handleServerEvent = (serverEvent: ServerEvent) => {
    logServerEvent(serverEvent);

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
          serverEvent.response.output.forEach((outputItem) => {
            if (
              outputItem.type === "function_call" &&
              outputItem.name &&
              outputItem.arguments
            ) {
              // Get the most recent active speaker
              const mostRecentSpeaker = activeSpeakers
                .filter(s => s.isActive)
                .sort((a, b) => b.timestamp - a.timestamp)[0];

              // Parse the arguments and add the speaker ID
              const args = JSON.parse(outputItem.arguments);
              if (mostRecentSpeaker) {
                args.speaker_id = mostRecentSpeaker.speakerId;
              }

              handleFunctionCall({
                name: outputItem.name,
                call_id: outputItem.call_id,
                arguments: JSON.stringify(args),
              });
            }
          });
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
