"use client";

import { ServerEvent, SessionStatus, AgentConfig } from "@/app/types";
import { useTranscript } from "@/app/contexts/TranscriptContext";
import { useEvent } from "@/app/contexts/EventContext";
import { useRef } from "react";

export interface UseHandleServerEventParams {
  setSessionStatus: (status: SessionStatus) => void;
  selectedAgentName: string;
  selectedAgentConfigSet: AgentConfig[] | null;
  sendClientEvent: (eventObj: any, eventNameSuffix?: string) => void;
  setSelectedAgentName: (name: string) => void;
  mainLanguage: {code: string, name: string};
  targetLanguage: {code: string, name: string};
  languagesDetected: boolean;
}

export function useHandleServerEvent({
  setSessionStatus,
  selectedAgentName,
  selectedAgentConfigSet,
  sendClientEvent,
  setSelectedAgentName,
  mainLanguage,
  targetLanguage,
  languagesDetected,
}: UseHandleServerEventParams) {
  const {
    transcriptItems,
    addTranscriptBreadcrumb,
    addTranscriptMessage,
    updateTranscriptMessage,
    updateTranscriptItemStatus,
  } = useTranscript();

  const { logServerEvent } = useEvent();

  // Helper function to check if text is already a translation
  const isTranslationMessage = (text: string) => {
    if (!text) return false;
    
    // Check for our translation format
    if (text.match(/\[\w+ → \w+\]/)) {
      return true;
    }

    // Common patterns that might appear in translations from function calls
    return false;
  };

  // Helper function to translate text and play TTS
  const translateAndSpeak = async (text: string, sourceLanguage: string, targetLanguage: string, role: "user" | "assistant") => {
    if (!text || text === "[inaudible]" || text === "[Transcribing...]") return;
    
    // Skip translation if the text already appears to be a translation
    if (isTranslationMessage(text)) {
      return;
    }

    try {
      // In a real implementation, this would call a translation API
      // For this demo, we'll simulate translation with simple prefixes
      const translatedText = `[${sourceLanguage} → ${targetLanguage}] ${text}`;
      
      // Add the translation as a new message only if it's not already a translation message
      const translationId = `translation-${Date.now()}`;
      
      // Check if this translation already exists in the transcript
      const translationExists = transcriptItems.some(item => 
        item.title === translatedText || 
        (item.title && item.title.includes(text) && isTranslationMessage(item.title))
      );
      
      if (!translationExists) {
        console.log(`Translating from ${sourceLanguage} to ${targetLanguage}: "${text.substring(0, 20)}..."`);
        addTranscriptMessage(translationId, role, translatedText, true);
        
        // In a real implementation, this would trigger TTS
        // For this demo, we'll request audio playback via the API
        sendClientEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "assistant", // Always treat translation as assistant to get voice output
            content: [{ type: "text", text: translatedText }],
          },
        }, `(translation ${sourceLanguage} to ${targetLanguage})`);
      }
    } catch (error) {
      console.error("Translation error:", error);
    }
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
      const sourceCode = mainLanguage.code;
      const targetCode = targetLanguage.code;
      
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
          
          // After transcript is complete, translate the user's message if languages are detected
          if (languagesDetected && 
              finalTranscript !== "[inaudible]" &&
              // Skip translation if the message already appears to be a translation
              !isTranslationMessage(finalTranscript)) {
            
            // Detect the language of this specific message
            // In a real implementation, you'd call a language detection API
            const detectedLang = detectLanguageSimple(finalTranscript);
            
            if (detectedLang) {
              // Determine which language to translate to based on the detected language
              let targetLang;
              
              // If the detected language matches the main language, translate to target
              if (detectedLang === mainLanguage.code) {
                targetLang = targetLanguage.code;
              }
              // If the detected language matches the target language, translate to main
              else if (detectedLang === targetLanguage.code) {
                targetLang = mainLanguage.code;
              }
              // If it's neither, translate to the target language by default
              else {
                targetLang = targetLanguage.code;
              }
              
              console.log(`User spoke in ${detectedLang}, translating to ${targetLang}`);
              
              // Force immediate translation without waiting for function calls
              setTimeout(() => {
                translateAndSpeak(finalTranscript, detectedLang, targetLang, "user");
              }, 500);
            } else {
              // Fallback if we couldn't detect the language
              setTimeout(() => {
                translateAndSpeak(finalTranscript, mainLanguage.code, targetLanguage.code, "user");
              }, 500);
            }
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
            if (lastAssistantMessage.title) {
              // The assistant always responds in the target language, so we translate to main
              setTimeout(() => {
                translateAndSpeak(lastAssistantMessage.title || "", targetLanguage.code, mainLanguage.code, "assistant");
              }, 500);
            }
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

  const handleServerEventRef = useRef(handleServerEvent);
  handleServerEventRef.current = handleServerEvent;

  return handleServerEventRef;
}

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
