"use-client";

import React, { useEffect, useRef } from "react";
import { useTranscript } from "../contexts/TranscriptContext";
import { useSpeaker } from "../contexts/SpeakerContext";

interface TranscriptProps {
  userText: string;
  setUserText: (text: string) => void;
  onSendMessage: () => void;
  canSend: boolean;
  isMinimal?: boolean;
}

export default function Transcript({
  userText,
  setUserText,
  onSendMessage,
  canSend,
  isMinimal = false,
}: TranscriptProps) {
  const { transcriptItems } = useTranscript();
  const { getSpeakerById } = useSpeaker();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [transcriptItems]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {transcriptItems.map((item) => {
          const speaker = getSpeakerById(item.speakerId);
          const isUser = item.role === "user";
          const isTranslation = item.itemId.startsWith("translation-");

          return (
            <div
              key={item.itemId}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  isUser
                    ? "bg-blue-500 text-white"
                    : isTranslation
                    ? "bg-gray-100 text-gray-800"
                    : "bg-gray-200 text-gray-800"
                }`}
              >
                {!isMinimal && speaker && (
                  <div className="text-xs font-semibold mb-1">
                    {speaker.name || `Speaker ${item.speakerId}`}
                  </div>
                )}
                <div className="text-sm">{item.title}</div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {!isMinimal && (
        <div className="p-4 border-t border-gray-200">
          <div className="flex space-x-2">
            <input
              type="text"
              value={userText}
              onChange={(e) => setUserText(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && onSendMessage()}
              placeholder="Type a message..."
              className="flex-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={onSendMessage}
              disabled={!canSend || !userText.trim()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
