"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

import Image from "next/image";

// UI components
import Transcript from "./components/Transcript";
import Events from "./components/Events";
import BottomToolbar from "./components/BottomToolbar";

// Types
import { AgentConfig, SessionStatus } from "@/app/types";

// Context providers & hooks
import { useTranscript } from "@/app/contexts/TranscriptContext";
import { useEvent } from "@/app/contexts/EventContext";
import { useHandleServerEvent } from "./hooks/useHandleServerEvent";
import { useSpeaker } from './contexts/SpeakerContext';
import { useLanguagePair } from "./hooks/useLanguagePair";

// Utilities
import { createRealtimeConnection } from "./lib/realtimeConnection";

// Agent configs
import { allAgentSets, defaultAgentSetKey } from "@/app/agentConfigs";

function App() {
  const { transcriptItems, addTranscriptMessage, addTranscriptBreadcrumb } =
    useTranscript();
  const { logClientEvent, logServerEvent } = useEvent();
  const { 
    state: speakerState,
    addSpeaker,
    updateSpeaker,
    setSpeakerInactive,
    getActiveSpeakers,
    getSpeakerById,
    getTranslationDirection
  } = useSpeaker();
  const { lockedLanguagePair } = useLanguagePair();

  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedAgentConfigSet, setSelectedAgentConfigSet] =
    useState<AgentConfig[] | null>(null);

  // Add state for language information
  const [activeLanguages, setActiveLanguages] = useState<Array<{code: string, name: string}>>([
    { code: "zh", name: "Chinese" },
    { code: "en", name: "English" }
  ]);
  const [languagesDetected, setLanguagesDetected] = useState<boolean>(true);
  const [languagesJustDetected, setLanguagesJustDetected] = useState<boolean>(false);

  const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const [sessionStatus, setSessionStatus] =
    useState<SessionStatus>("DISCONNECTED");

  const [isEventsPaneExpanded, setIsEventsPaneExpanded] =
    useState<boolean>(true);
  const [userText, setUserText] = useState<string>("");
  const [isPTTUserSpeaking, setIsPTTUserSpeaking] = useState<boolean>(false);

  // Add state for tracking speaker languages by speaker ID rather than role
  const [speakerLanguages, setSpeakerLanguages] = useState<Array<{speakerId: string, language: {code: string, name: string}, timestamp: number}>>([]);

  const sendClientEvent = (eventObj: any, eventNameSuffix = "") => {
    if (dcRef.current && dcRef.current.readyState === "open") {
      logClientEvent(eventObj, eventNameSuffix);
      dcRef.current.send(JSON.stringify(eventObj));
    } else {
      logClientEvent(
        { attemptedEvent: eventObj.type },
        "error.data_channel_not_open"
      );
      console.error(
        "Failed to send message - no data channel available",
        eventObj
      );
    }
  };

  // Add translateAndSpeak function
  const translateAndSpeak = useCallback(async (text: string, sourceLang: string, targetLang: string) => {
    try {
      // Only translate if source and target languages are different
      if (sourceLang === targetLang) {
        console.log(`Skipping translation: same language (${sourceLang})`);
        return null;
      }

      // Call the translation API
      const response = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "gpt-4-turbo-preview",
          messages: [
            {
              role: "system",
              content: `You are a translation system. Translate the following text from ${sourceLang} to ${targetLang}. Only output the translated text, no explanations or additional text.`
            },
            {
              role: "user",
              content: text
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error('Translation failed');
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error in translateAndSpeak:', error);
      return null;
    }
  }, []);

  // Add message handler
  const addMessage = useCallback((message: { id: string; role: "user" | "assistant"; content: string; timestamp: number }) => {
    addTranscriptMessage(message.id, message.role, message.content);
  }, [addTranscriptMessage]);

  // Initialize handleServerEvent
  const handleServerEventRef = useHandleServerEvent({
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
  });

  useEffect(() => {
    // Initialize with default agent
    const agents = allAgentSets[defaultAgentSetKey];
    const agentKeyToUse = agents[0]?.name || "";

    setSelectedAgentName(agentKeyToUse);
    setSelectedAgentConfigSet(agents);
  }, []);

  useEffect(() => {
    if (selectedAgentName && sessionStatus === "DISCONNECTED") {
      connectToRealtime();
    }
  }, [selectedAgentName]);

  useEffect(() => {
    if (
      sessionStatus === "CONNECTED" &&
      selectedAgentConfigSet &&
      selectedAgentName
    ) {
      const currentAgent = selectedAgentConfigSet.find(
        (a) => a.name === selectedAgentName
      );
      addTranscriptBreadcrumb(
        `Agent: ${selectedAgentName}`,
        currentAgent
      );
      updateSession(false);
    }
  }, [selectedAgentConfigSet, selectedAgentName, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === "CONNECTED") {
      console.log(
        `updatingSession, isPTTACtive=${isPTTUserSpeaking} sessionStatus=${sessionStatus}`
      );
      updateSession();
    }
  }, [isPTTUserSpeaking]);

  const fetchEphemeralKey = async (): Promise<string | null> => {
    logClientEvent({ url: "/session" }, "fetch_session_token_request");
    const tokenResponse = await fetch("/api/session");
    const data = await tokenResponse.json();
    logServerEvent(data, "fetch_session_token_response");

    if (!data.client_secret?.value) {
      logClientEvent(data, "error.no_ephemeral_key");
      console.error("No ephemeral key provided by the server");
      setSessionStatus("DISCONNECTED");
      return null;
    }

    return data.client_secret.value;
  };

  const connectToRealtime = async () => {
    if (sessionStatus !== "DISCONNECTED") return;
    setSessionStatus("CONNECTING");

    try {
      const EPHEMERAL_KEY = await fetchEphemeralKey();
      if (!EPHEMERAL_KEY) {
        return;
      }

      if (!audioElementRef.current) {
        audioElementRef.current = document.createElement("audio");
      }
      audioElementRef.current.autoplay = true;

      const { pc, dc } = await createRealtimeConnection(
        EPHEMERAL_KEY,
        audioElementRef
      );
      pcRef.current = pc;
      dcRef.current = dc;

      dc.addEventListener("open", () => {
        logClientEvent({}, "data_channel.open");
      });
      dc.addEventListener("close", () => {
        logClientEvent({}, "data_channel.close");
      });
      dc.addEventListener("error", (err: any) => {
        logClientEvent({ error: err }, "data_channel.error");
      });
      dc.addEventListener("message", (e: MessageEvent) => {
        if (handleServerEventRef.current) {
          handleServerEventRef.current(JSON.parse(e.data));
        }
      });

      setDataChannel(dc);
    } catch (err) {
      console.error("Error connecting to realtime:", err);
      setSessionStatus("DISCONNECTED");
    }
  };

  const disconnectFromRealtime = () => {
    if (pcRef.current) {
      // Stop all tracks
      pcRef.current.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });

      // Close the peer connection
      pcRef.current.close();
      pcRef.current = null;
    }

    // Clean up audio element
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.srcObject = null;
    }

    setDataChannel(null);
    setSessionStatus("DISCONNECTED");
    setIsPTTUserSpeaking(false);

    logClientEvent({}, "disconnected");
  };

  // Add effect to handle audio element cleanup
  useEffect(() => {
    return () => {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.srcObject = null;
      }
    };
  }, []);

  // Add effect to handle audio autoplay
  useEffect(() => {
    if (audioElementRef.current) {
      const playAudio = async () => {
        try {
          await audioElementRef.current?.play();
        } catch (err) {
          console.warn("Autoplay may be blocked by browser:", err);
          // Try to play again when user interacts with the page
          const handleUserInteraction = async () => {
            try {
              await audioElementRef.current?.play();
              document.removeEventListener('click', handleUserInteraction);
              document.removeEventListener('keydown', handleUserInteraction);
            } catch (e) {
              console.warn("Failed to play audio after user interaction:", e);
            }
          };
          document.addEventListener('click', handleUserInteraction);
          document.addEventListener('keydown', handleUserInteraction);
        }
      };
      playAudio();
    }
  }, [audioElementRef.current]);

  const sendSimulatedUserMessage = (text: string) => {
    const id = uuidv4().slice(0, 32);
    addTranscriptMessage(id, "user", text, true);

    sendClientEvent(
      {
        type: "conversation.item.create",
        item: {
          id,
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      },
      "(simulated user text message)"
    );
    sendClientEvent(
      { type: "response.create" },
      "(trigger response after simulated user text message)"
    );
  };

  const updateSession = (shouldTriggerResponse = false) => {
    sendClientEvent(
      { type: "input_audio_buffer.clear" },
      "clear audio buffer on session update"
    );

    const currentAgent = selectedAgentConfigSet?.find(
      (a) => a.name === selectedAgentName
    );

    // Only use turn detection when the user is not actively recording
    // Set turn_detection to null to prevent automatic input processing 
    // This ensures only manual recording through the PTT button will trigger audio input
    const turnDetection = null; // Disable automatic voice activity detection entirely

    const instructions = currentAgent?.instructions || "";
    const tools = currentAgent?.tools || [];

    const sessionUpdateEvent = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions,
        voice: "shimmer",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: turnDetection,
        tools,
      },
    };

    sendClientEvent(sessionUpdateEvent);
  };

  const cancelAssistantSpeech = async () => {
    const mostRecentAssistantMessage = [...transcriptItems]
      .reverse()
      .find((item) => item.role === "assistant");

    if (!mostRecentAssistantMessage) {
      console.warn("can't cancel, no recent assistant message found");
      return;
    }
    if (mostRecentAssistantMessage.status === "DONE") {
      console.log("No truncation needed, message is DONE");
      return;
    }

    sendClientEvent({
      type: "conversation.item.truncate",
      item_id: mostRecentAssistantMessage?.itemId,
      content_index: 0,
      audio_end_ms: Date.now() - mostRecentAssistantMessage.createdAtMs,
    });
    sendClientEvent(
      { type: "response.cancel" },
      "(cancel due to user interruption)"
    );
  };

  const handleSendMessage = () => {
    if (!userText.trim()) return;
    cancelAssistantSpeech();

    sendClientEvent(
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: userText.trim() }],
        },
      },
      "(send user text message)"
    );
    setUserText("");

    sendClientEvent({ type: "response.create" }, "trigger response");
  };

  const handleToggleRecording = () => {
    if (sessionStatus !== "CONNECTED" || dataChannel?.readyState !== "open") return;
    
    if (!isPTTUserSpeaking) {
      // Starting recording
      cancelAssistantSpeech();
      setIsPTTUserSpeaking(true);
      // Clear any existing audio in the buffer before starting a new recording
      sendClientEvent({ type: "input_audio_buffer.clear" }, "clear PTT buffer");
      // Update session to indicate we're listening for input
      sendClientEvent({ 
        type: "session.update",
        session: {
          input_audio_transcription: { model: "whisper-1" }
        }
      }, "start recording mode");
    } else {
      // Stopping recording
      setIsPTTUserSpeaking(false);
      // Commit the audio buffer to be processed
      sendClientEvent({ type: "input_audio_buffer.commit" }, "commit PTT buffer");
      // Trigger response after PTT
      sendClientEvent({ type: "response.create" }, "trigger response after PTT");
    }
  };

  const onToggleConnection = () => {
    if (sessionStatus === "CONNECTED" || sessionStatus === "CONNECTING") {
      disconnectFromRealtime();
      setSessionStatus("DISCONNECTED");
    } else {
      connectToRealtime();
    }
  };

  useEffect(() => {
    const storedLogsExpanded = localStorage.getItem("logsExpanded");
    if (storedLogsExpanded) {
      setIsEventsPaneExpanded(storedLogsExpanded === "true");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("logsExpanded", isEventsPaneExpanded.toString());
  }, [isEventsPaneExpanded]);

  // Add function to detect language
  const detectLanguage = (text: string): {code: string, name: string} | null => {
    if (!text || text === "[inaudible]" || text === "[Transcribing...]") return null;
    
    // Simple language detection based on character sets
    // Chinese characters typically fall in this Unicode range
    const chinesePattern = /[\u4e00-\u9fff]/;
    // Japanese characters typically include these ranges
    const japanesePattern = /[\u3040-\u309f\u30a0-\u30ff]/;
    // Korean characters
    const koreanPattern = /[\uac00-\ud7af]/;
    // Arabic characters
    const arabicPattern = /[\u0600-\u06ff]/;
    // Russian characters
    const russianPattern = /[\u0400-\u04ff]/;
    // Spanish/Portuguese special characters
    const spanishPattern = /[áéíóúüñ¿¡]/i;
    // German special characters
    const germanPattern = /[äöüßÄÖÜ]/;
    // French special characters
    const frenchPattern = /[àâçéèêëîïôùûüÿœæ]/i;

    if (chinesePattern.test(text)) {
      return { code: "zh", name: "Chinese" };
    } else if (japanesePattern.test(text)) {
      return { code: "ja", name: "Japanese" };
    } else if (koreanPattern.test(text)) {
      return { code: "ko", name: "Korean" };
    } else if (arabicPattern.test(text)) {
      return { code: "ar", name: "Arabic" };
    } else if (russianPattern.test(text)) {
      return { code: "ru", name: "Russian" };
    } else if (spanishPattern.test(text)) {
      return { code: "es", name: "Spanish" };
    } else if (germanPattern.test(text)) {
      return { code: "de", name: "German" };
    } else if (frenchPattern.test(text)) {
      return { code: "fr", name: "French" };
    } else {
      // Default to English for Latin script (this is very simplified)
      return { code: "en", name: "English" };
    }
  };

  // Helper function to check if text is a translation message
  const isTranslationMessage = (text: string) => {
    if (!text) return false;
    
    // Check for our translation format
    if (text.match(/\[\w+ → \w+\]/)) {
      return true;
    }
    
    return false;
  };

  // Add effect to update UI when language pair changes
  useEffect(() => {
    if (lockedLanguagePair) {
      setActiveLanguages([lockedLanguagePair.source, lockedLanguagePair.target]);
      setLanguagesJustDetected(true);
      setTimeout(() => setLanguagesJustDetected(false), 1000);
    }
  }, [lockedLanguagePair]);

  // Update speaker sequence and languages when new messages are detected
  useEffect(() => {
    // Only proceed if we have transcript items to analyze
    if (transcriptItems.length < 1) return;

    // Filter to get valid original message items from USERS only (no assistant messages, no translations)
    const messageItems = transcriptItems.filter(item => 
      item.type === "MESSAGE" && 
      item.role === "user" &&  // Only process user messages, not assistant
      item.title && 
      item.title !== "[Transcribing...]" &&
      item.title !== "[inaudible]" &&
      !item.itemId.startsWith("translation-") &&
      item.title && !isTranslationMessage(item.title)
    );

    // Process messages in chronological order
    const chronologicalMessages = [...messageItems].sort((a, b) => a.createdAtMs - b.createdAtMs);
    
    // Track new speakers and their languages
    const newSpeakerLanguages = [...speakerLanguages];
    let languagesChanged = false;
    
    // Process each message to identify speakers
    for (const message of chronologicalMessages) {
      if (message.role && message.title) {
        const detectedLang = detectLanguage(message.title);
        if (!detectedLang) continue;
        
        // Create unique speaker ID (could be enhanced in a real app with actual user IDs)
        const speakerId = `${message.role}-${message.itemId.split('-')[0]}`;
        
        // Check if this speaker already exists
        const existingIndex = newSpeakerLanguages.findIndex(s => s.speakerId === speakerId);
        
        if (existingIndex === -1) {
          // New speaker detected - add to sequence
          newSpeakerLanguages.push({
            speakerId,
            language: detectedLang,
            timestamp: message.createdAtMs
          });
          languagesChanged = true;
          console.log(`New speaker detected: ${speakerId} speaking ${detectedLang.name}`);
        } else {
          // Update existing speaker's timestamp
          newSpeakerLanguages[existingIndex].timestamp = message.createdAtMs;
        }
      }
    }
    
    // If the speaker sequence changed, update state and language settings
    if (languagesChanged) {
      setSpeakerLanguages(newSpeakerLanguages);
      
      // Sort speakers by most recent timestamp
      const sortedSpeakers = [...newSpeakerLanguages].sort((a, b) => b.timestamp - a.timestamp);
      
      // Get the two most recent speakers
      if (sortedSpeakers.length >= 2) {
        const [mostRecent, secondMostRecent] = sortedSpeakers;
        
        // Only update active languages if they are different
        if (mostRecent.language.code !== secondMostRecent.language.code) {
          setActiveLanguages([mostRecent.language, secondMostRecent.language]);
          setLanguagesJustDetected(true);
          setTimeout(() => setLanguagesJustDetected(false), 1000);
        }
      }
    }
  }, [transcriptItems, speakerLanguages]);

  // Update the language detection handler
  const handleLanguageDetection = (text: string, speakerId: string) => {
    const detectedLanguage = detectLanguage(text);
    if (!detectedLanguage) return null;

    const existingSpeaker = speakerLanguages.find(s => s.speakerId === speakerId);
    
    if (!existingSpeaker) {
      // New speaker detected
      setSpeakerLanguages(prev => [...prev, {
        speakerId,
        language: detectedLanguage,
        timestamp: Date.now()
      }]);
      
      // Update active languages if we have at least one other speaker with a different language
      if (speakerLanguages.length > 0) {
        const mostRecentSpeaker = [...speakerLanguages].sort((a, b) => b.timestamp - a.timestamp)[0];
        if (mostRecentSpeaker.language.code !== detectedLanguage.code) {
          setActiveLanguages([detectedLanguage, mostRecentSpeaker.language]);
          setLanguagesJustDetected(true);
          setTimeout(() => setLanguagesJustDetected(false), 1000);
        }
      }
    } else if (existingSpeaker.language.code !== detectedLanguage.code) {
      // Update speaker's language if it changed
      setSpeakerLanguages(prev => prev.map(s => 
        s.speakerId === speakerId 
          ? {...s, language: detectedLanguage, timestamp: Date.now()}
          : s
      ));
      
      // Update active languages if this speaker is one of the active ones and the language is different
      setActiveLanguages(prev => {
        if (prev.some(lang => lang.code === existingSpeaker.language.code)) {
          const newLanguages = prev.map(lang => 
            lang.code === existingSpeaker.language.code ? detectedLanguage : lang
          );
          // Only update if the languages are different
          if (newLanguages[0].code !== newLanguages[1].code) {
            setLanguagesJustDetected(true);
            setTimeout(() => setLanguagesJustDetected(false), 1000);
            return newLanguages;
          }
        }
        return prev;
      });
    }

    return detectedLanguage;
  };

  // Modify the message handling to include translation direction
  const handleNewMessage = (text: string, role: 'user' | 'assistant') => {
    if (role === 'user') {
      // Get the current active speakers to determine if we need a new speaker
      const activeSpeakers = getActiveSpeakers();
      let speakerId: string;
      
      // Try to find an existing active speaker
      const existingSpeaker = activeSpeakers.find(([_, info]) => info.isActive);
      
      if (existingSpeaker) {
        speakerId = existingSpeaker[0];
      } else {
        // Create a new speaker if none exists
        speakerId = `user-${Date.now()}`;
      }
      
      const detectedLanguage = handleLanguageDetection(text, speakerId);
      
      if (detectedLanguage) {
        // Get translation direction before adding the message
        const translationDirection = getTranslationDirection(speakerId);
        
        // Add original message to transcript
        addTranscriptMessage(speakerId, role, text, true);
        
        // if (translationDirection && translationDirection.source.code !== translationDirection.target.code) {
        //   // Add translation message immediately after
        //   const translationId = `translation-${speakerId}`;
        //   const translatedText = `[${translationDirection.source.code} → ${translationDirection.target.code}] ${text}`;
        //   addTranscriptMessage(translationId, 'assistant', translatedText, false);
        // }
      }
    }
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Left side - iPhone-style chat interface */}
      <div className="md:w-1/2 w-full flex flex-col items-center justify-center p-4">
        <div className="hidden md:block w-[375px] h-[812px] bg-white rounded-[3.5rem] shadow-2xl overflow-hidden border-8 border-black">
          {/* iPhone notch */}
          <div className="h-10 bg-black rounded-t-[2.5rem] flex items-center justify-center relative">
            <div className="w-40 h-6 bg-black rounded-b-3xl"></div>
            <div className="absolute top-3 right-6 w-3 h-3 bg-gray-800 rounded-full"></div>
            
            {/* Status bar */}
            <div className="absolute top-2 left-0 right-0 flex justify-between items-center px-4 text-white text-xs">
              <div className="flex items-center space-x-1">
                <span>9:41</span>
              </div>
              <div className="flex items-center space-x-1">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 12C2 6.48 6.48 2 12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12Z" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2"/>
                </svg>
                <span>100%</span>
              </div>
            </div>
          </div>
          
          {/* Chat content */}
          <div className="h-[calc(100%-5rem)] overflow-y-auto">
            <Transcript
              userText={userText}
              setUserText={setUserText}
              onSendMessage={handleSendMessage}
              canSend={sessionStatus === "CONNECTED" && dcRef.current?.readyState === "open"}
              isMinimal={true}
            />
          </div>
        </div>

        {/* Mobile view */}
        <div className="md:hidden w-full h-full bg-white flex flex-col">
          <div className="flex-1 overflow-y-auto w-full">
            <Transcript
              userText={userText}
              setUserText={setUserText}
              onSendMessage={handleSendMessage}
              canSend={sessionStatus === "CONNECTED" && dcRef.current?.readyState === "open"}
              isMinimal={true}
            />
          </div>
          <div className="w-full p-4 border-t border-gray-200">
            <button
              onClick={handleToggleRecording}
              className={`w-full py-3 px-4 rounded-lg transition-all duration-300 ${
                isPTTUserSpeaking ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-800'
              }`}
              disabled={sessionStatus !== "CONNECTED" || dataChannel?.readyState !== "open"}
            >
              {isPTTUserSpeaking ? 'Stop Recording' : 'Start Recording'}
            </button>
          </div>
        </div>
      </div>

      {/* Right side - Mic toggle (desktop only) */}
      <div className="hidden md:flex w-1/2 items-center justify-center">
        <div
          onClick={handleToggleRecording}
          className={`cursor-pointer transition-transform duration-300 ${
            isPTTUserSpeaking ? 'scale-110' : ''
          }`}
          style={{ pointerEvents: sessionStatus !== "CONNECTED" || dataChannel?.readyState !== "open" ? 'none' : 'auto' }}
          aria-label={isPTTUserSpeaking ? "Stop recording" : "Start recording"}
          title={isPTTUserSpeaking ? "Stop recording" : "Start recording"}
        >
          <Image
            src="/mic01.png"
            alt={isPTTUserSpeaking ? "Recording in progress" : "Microphone"}
            width={96}
            height={96}
            className={`transition-opacity duration-300 ${
              sessionStatus !== "CONNECTED" || dataChannel?.readyState !== "open" ? 'opacity-50' : ''
            }`}
          />
        </div>
      </div>

      {/* Hidden debug panel */}
      <div className="hidden">
        <Events isExpanded={false} />
      </div>
    </div>
  );
}

export default App;
