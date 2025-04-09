"use client";

import React, { useEffect, useRef, useState } from "react";
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

// Utilities
import { createRealtimeConnection } from "./lib/realtimeConnection";

// Agent configs
import { allAgentSets, defaultAgentSetKey } from "@/app/agentConfigs";

function App() {
  const { transcriptItems, addTranscriptMessage, addTranscriptBreadcrumb } =
    useTranscript();
  const { logClientEvent, logServerEvent } = useEvent();

  const [selectedAgentName, setSelectedAgentName] = useState<string>("");
  const [selectedAgentConfigSet, setSelectedAgentConfigSet] =
    useState<AgentConfig[] | null>(null);

  // Add state for language information
  const [mainLanguage, setMainLanguage] = useState<{code: string, name: string}>({code: "zh", name: "Chinese"});
  const [targetLanguage, setTargetLanguage] = useState<{code: string, name: string}>({code: "en", name: "English"});
  const [languagesDetected, setLanguagesDetected] = useState<boolean>(true);
  // const [speakerCount, setSpeakerCount] = useState<number>(0);
  // const [lastSpeaker, setLastSpeaker] = useState<string>("");

  // Add a state to track when languages are newly detected for UI animation
  const [mainLangJustDetected, setMainLangJustDetected] = useState<boolean>(false);
  const [targetLangJustDetected, setTargetLangJustDetected] = useState<boolean>(false);

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
  const [speakerLanguages, setSpeakerLanguages] = useState<Array<{speakerId: string, language: {code: string, name: string}, timestamp: number}>>([
    {speakerId: "initial-zh", language: {code: "zh", name: "Chinese"}, timestamp: Date.now() - 1000},
    {speakerId: "initial-en", language: {code: "en", name: "English"}, timestamp: Date.now()}
  ]);

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

  const handleServerEventRef = useHandleServerEvent({
    setSessionStatus,
    selectedAgentName,
    selectedAgentConfigSet,
    sendClientEvent,
    setSelectedAgentName,
    mainLanguage,
    targetLanguage,
    languagesDetected,
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
        handleServerEventRef.current(JSON.parse(e.data));
      });

      setDataChannel(dc);
    } catch (err) {
      console.error("Error connecting to realtime:", err);
      setSessionStatus("DISCONNECTED");
    }
  };

  const disconnectFromRealtime = () => {
    if (pcRef.current) {
      pcRef.current.getSenders().forEach((sender) => {
        if (sender.track) {
          sender.track.stop();
        }
      });

      pcRef.current.close();
      pcRef.current = null;
    }
    setDataChannel(null);
    setSessionStatus("DISCONNECTED");
    setIsPTTUserSpeaking(false);

    logClientEvent({}, "disconnected");
  };

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
        voice: "coral",
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

  const handleSendTextMessage = () => {
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

  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.play().catch((err) => {
        console.warn("Autoplay may be blocked by browser:", err);
      });
    }
  }, []);

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

  // Array to track speaker languages in chronological order
  const [speakerSequence, setSpeakerSequence] = useState<Array<{
    id: string,
    language: {code: string, name: string}
  }>>([]);

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
    const newSpeakerSequence = [...speakerSequence];
    let sequenceChanged = false;
    
    // Process each message to identify speakers
    for (const message of chronologicalMessages) {
      if (message.role && message.title) {
        const detectedLang = detectLanguage(message.title);
        if (!detectedLang) continue;
        
        // Create unique speaker ID (could be enhanced in a real app with actual user IDs)
        // For now, use a combination of role and a portion of the item ID
        const speakerId = `${message.role}-${message.itemId.split('-')[0]}`;
        
        // Check if this exact speaker already exists in our sequence
        const existingIndex = newSpeakerSequence.findIndex(s => s.id === speakerId);
        
        if (existingIndex === -1) {
          // New speaker detected - add to sequence
          newSpeakerSequence.push({
            id: speakerId,
            language: detectedLang
          });
          sequenceChanged = true;
          console.log(`New speaker detected: ${speakerId} speaking ${detectedLang.name}`);
        }
      }
    }
    
    // If the speaker sequence changed, update state and language settings
    if (sequenceChanged) {
      setSpeakerSequence(newSpeakerSequence);
      
      // Always use the last two speakers for translation
      if (newSpeakerSequence.length >= 2) {
        const lastTwoSpeakers = newSpeakerSequence.slice(-2);
        
        // Update main language (second-to-last speaker)
        const newMainLang = lastTwoSpeakers[0].language;
        if (newMainLang && newMainLang.code !== mainLanguage.code) {
          setMainLanguage(newMainLang);
          setMainLangJustDetected(true);
          setTimeout(() => setMainLangJustDetected(false), 2000);
          console.log(`Updated main language to: ${newMainLang.name} (${newMainLang.code})`);
        }
        
        // Update target language (most recent speaker)
        const newTargetLang = lastTwoSpeakers[1].language;
        if (newTargetLang && newTargetLang.code !== targetLanguage.code) {
          setTargetLanguage(newTargetLang);
          setTargetLangJustDetected(true);
          setTimeout(() => setTargetLangJustDetected(false), 2000);
          console.log(`Updated target language to: ${newTargetLang.name} (${newTargetLang.code})`);
        }
        
        // Mark languages as detected if not already
        if (!languagesDetected) {
          setLanguagesDetected(true);
          console.log("Both languages have been detected and set");
        }
      }
    }
  }, [transcriptItems, speakerSequence]);

  return (
    <div className="text-base flex flex-col h-screen bg-gray-100 text-gray-800 relative">
      <div className="p-5 text-lg font-semibold flex justify-between items-center bg-white border-b border-gray-200">
        <div className="flex items-center">
          <div onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>
            <Image
              src="/openai-logomark.svg"
              alt="OpenAI Logo"
              width={20}
              height={20}
              className="mr-2"
            />
          </div>
          <div>
            Realtime Translator
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <span className="font-medium">Main:</span>
            <span className={`px-2 py-1 rounded transition-all duration-300 ${
              mainLangJustDetected 
                ? 'bg-blue-200 scale-110' 
                : 'bg-gray-100'
            }`}>
              {mainLanguage.name} ({mainLanguage.code})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">Target:</span>
            <span className={`px-2 py-1 rounded transition-all duration-300 ${
              targetLangJustDetected 
                ? 'bg-blue-200 scale-110' 
                : 'bg-gray-100'
            }`}>
              {targetLanguage.name} ({targetLanguage.code})
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-2 px-2 overflow-hidden relative">
        <Transcript
          userText={userText}
          setUserText={setUserText}
          onSendMessage={handleSendTextMessage}
          canSend={
            sessionStatus === "CONNECTED" &&
            dcRef.current?.readyState === "open"
          }
        />

        <Events isExpanded={isEventsPaneExpanded} />
      </div>

      <BottomToolbar
        sessionStatus={sessionStatus}
        onToggleConnection={onToggleConnection}
        isPTTUserSpeaking={isPTTUserSpeaking}
        onToggleRecording={handleToggleRecording}
        isEventsPaneExpanded={isEventsPaneExpanded}
        setIsEventsPaneExpanded={setIsEventsPaneExpanded}
      />
    </div>
  );
}

export default App;
