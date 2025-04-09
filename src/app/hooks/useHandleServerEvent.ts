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
      // Get the current main and target languages from our UI state
      const sourceCode = activeLanguages[0].code;
      const targetCode = activeLanguages[1].code;
      
      // Override the function arguments with our UI languages
      if (args.source_language && args.target_language) {
        // If the source language matches our main language, translate to target
        if (args.source_language === sourceCode) {
          args.target_language = targetCode;
        }
        // If the source language matches our target language, translate to main
        else if (args.source_language === targetCode) {
          args.target_language = sourceCode;
        }
        // If the source is neither main nor target, translate to target by default
        else {
          args.target_language = targetCode;
        }
        
        console.log(`Translation direction: ${args.source_language} → ${args.target_language}`);
      }
      
      // Process and acknowledge the function call with modified args
      let fnResult = { result: true };
      
      if (currentAgent?.toolLogic?.[functionCallParams.name]) {
        const fn = currentAgent.toolLogic[functionCallParams.name];
        fnResult = await fn(args, transcriptItems);
      }
      
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
      
      // Always continue the conversation flow
      sendClientEvent({ type: "response.create" });
      return;
    } else if (functionCallParams.name === "detect_language") {
      // Handle language detection normally
      let fnResult = { result: true };
      
      if (currentAgent?.toolLogic?.[functionCallParams.name]) {
        const fn = currentAgent.toolLogic[functionCallParams.name];
        fnResult = await fn(args, transcriptItems);
      }
      
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
      
      // Always continue the conversation flow
      sendClientEvent({ type: "response.create" });
      return;
    }

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
      sendClientEvent({ type: "response.create" });
    } else if (functionCallParams.name === "transferAgents") {
      const destinationAgent = args.destination_agent;
      const newAgentConfig =
        selectedAgentConfigSet?.find((a) => a.name === destinationAgent) || null;
      if (newAgentConfig) {
        setSelectedAgentName(destinationAgent);
      }
      const functionCallOutput = {
        destination_agent: destinationAgent,
        did_transfer: !!newAgentConfig,
      };
      sendClientEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: functionCallParams.call_id,
          output: JSON.stringify(functionCallOutput),
        },
      });
      addTranscriptBreadcrumb(
        `function call: ${functionCallParams.name} response`,
        functionCallOutput
      );
      sendClientEvent({ type: "response.create" });
    } else {
      const simulatedResult = { result: true };
      addTranscriptBreadcrumb(
        `function call fallback: ${functionCallParams.name}`,
        simulatedResult
      );

      // Always send the function call output
      sendClientEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: functionCallParams.call_id,
          output: JSON.stringify(simulatedResult),
        },
      });
      
      // Only trigger additional response for non-translation functions
      if (!isTranslationMessage(functionCallParams.name) || !languagesDetected) {
        sendClientEvent({ type: "response.create" });
      } else if (functionCallParams.name === "detect_language" && languagesDetected) {
        // Ensure that after language detection, translation happens
        sendClientEvent({ type: "response.create" });
      }
    }
  };

  const handleAudioTranscriptionComplete = useCallback(async (event: AudioTranscriptionCompleteEvent) => {
    const { transcription, speakerId } = event;
    
    // Get translation direction based on locked language pair
    const direction = getTranslationDirection(speakerId);
    if (!direction) {
      console.log('No translation direction available');
      return;
    }

    // Only translate if source and target languages are different
    if (direction.source.code === direction.target.code) {
      console.log(`Skipping translation: same language detected (${direction.source.code})`);
      return;
    }

    try {
      if (!translateAndSpeak || typeof translateAndSpeak !== 'function') {
        console.error('translateAndSpeak is not a function');
        return;
      }

      console.log(`Translation direction: ${direction.source.code} → ${direction.target.code}`);

      // Check if this is already a translation message
      if (isTranslationMessage(transcription)) {
        console.log('Skipping translation: message is already a translation');
        return;
      }

      // Translate the transcription
      const translatedText = await translateAndSpeak(
        transcription,
        direction.source.code,
        direction.target.code
      );

      if (translatedText) {
        const translationId = `translation-${speakerId}-${Date.now()}`;
        addMessage({
          id: translationId,
          role: 'assistant',
          content: `[${direction.source.code} → ${direction.target.code}] ${translatedText}`,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Error in translation:', error);
    }
  }, [getTranslationDirection, translateAndSpeak, addMessage, isTranslationMessage]);

  const handleResponseDone = useCallback(async (event: ResponseDoneEvent) => {
    const { response, speakerId } = event;
    
    // Get translation direction based on locked language pair
    const direction = getTranslationDirection(speakerId);
    if (!direction) {
      console.log('No translation direction available');
      return;
    }

    // Only translate if source and target languages are different
    if (direction.source.code === direction.target.code) {
      console.log(`Skipping translation: same language detected (${direction.source.code})`);
      return;
    }

    try {
      if (!translateAndSpeak || typeof translateAndSpeak !== 'function') {
        console.error('translateAndSpeak is not a function');
        return;
      }

      console.log(`Translation direction: ${direction.source.code} → ${direction.target.code}`);

      // Check if this is already a translation message
      if (isTranslationMessage(response)) {
        console.log('Skipping translation: message is already a translation');
        return;
      }

      // Translate the assistant's response
      const translatedText = await translateAndSpeak(
        response,
        direction.target.code, // Assistant speaks in target language
        direction.source.code  // Translate to source language
      );

      if (translatedText) {
        const translationId = `translation-${speakerId}-${Date.now()}`;
        addMessage({
          id: translationId,
          role: 'assistant',
          content: `[${direction.target.code} → ${direction.source.code}] ${translatedText}`,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Error in translation:', error);
    }
  }, [getTranslationDirection, translateAndSpeak, addMessage, isTranslationMessage]);

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
            const detectedLang = detectLanguageSimple(finalTranscript);
            
            if (detectedLang) {
              // Check if this language is already in the locked pair
              const isLanguageInLockedPair = lockedLanguagePair && 
                (lockedLanguagePair.source.code === detectedLang || 
                 lockedLanguagePair.target.code === detectedLang);

              // Find existing speaker with this language
              const existingSpeakerWithLanguage = activeSpeakers.find(s => 
                s.language.code === detectedLang
              );
              
              let speakerId = itemId;
              if (existingSpeakerWithLanguage) {
                // If we found a speaker with the same language, just update their activity
                speakerId = existingSpeakerWithLanguage.speakerId;
                updateSpeakerActivity(speakerId, true);
                console.log(`Speaker activity updated for language: ${detectedLang}`);
              } else if (!isLanguageInLockedPair) {
                // Only create a new speaker if this is a new language not in the locked pair
                handleNewSpeaker(speakerId, { 
                  code: detectedLang, 
                  name: getLanguageName(detectedLang) 
                });
                console.log(`New language detected: ${detectedLang}`);
              }

              // Only attempt translation if we have a valid language pair and different languages
              if (lockedLanguagePair && 
                  lockedLanguagePair.source.code !== lockedLanguagePair.target.code) {
                handleAudioTranscriptionComplete({
                  transcription: finalTranscript,
                  speakerId
                });
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
            // if (lastAssistantMessage.title) {
            //   // Get the current active speakers
            //   // The assistant always responds in the target language, so we translate to main
            //   setTimeout(() => {
            //     translateAndSpeak(lastAssistantMessage.title || "", activeLanguages[1].code, activeLanguages[0].code, "assistant");
            //   }, 500);
            // }
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
              handleFunctionCall({
                name: outputItem.name,
                call_id: outputItem.call_id,
                arguments: outputItem.arguments,
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

// Add a simple language detection function
const detectLanguageSimple = (text: string): string | null => {
  if (!text) return null;
  
  // Simple language detection based on character sets (same logic as in App.tsx)
  const chinesePattern = /[\u4e00-\u9fff]/;
  const japanesePattern = /[\u3040-\u309f\u30a0-\u30ff]/;
  const koreanPattern = /[\uac00-\ud7af]/;
  const arabicPattern = /[\u0600-\u06ff]/;
  const russianPattern = /[\u0400-\u04ff]/;
  const spanishPattern = /[áéíóúüñ¿¡]/i;
  const germanPattern = /[äöüßÄÖÜ]/;
  const frenchPattern = /[àâçéèêëîïôùûüÿœæ]/i;

  if (chinesePattern.test(text)) return "zh";
  if (japanesePattern.test(text)) return "ja";
  if (koreanPattern.test(text)) return "ko";
  if (arabicPattern.test(text)) return "ar";
  if (russianPattern.test(text)) return "ru";
  if (spanishPattern.test(text)) return "es";
  if (germanPattern.test(text)) return "de";
  if (frenchPattern.test(text)) return "fr";
  
  // Default to English for Latin script
  return "en";
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
