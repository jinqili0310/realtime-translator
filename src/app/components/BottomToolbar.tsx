import React from "react";
import { SessionStatus } from "@/app/types";

interface BottomToolbarProps {
  sessionStatus: SessionStatus;
  onToggleConnection: () => void;
  isPTTUserSpeaking: boolean;
  onToggleRecording: () => void;
  isEventsPaneExpanded: boolean;
  setIsEventsPaneExpanded: (val: boolean) => void;
}

function BottomToolbar({
  sessionStatus,
  onToggleConnection,
  isPTTUserSpeaking,
  onToggleRecording,
  isEventsPaneExpanded,
  setIsEventsPaneExpanded,
}: BottomToolbarProps) {
  const isConnected = sessionStatus === "CONNECTED";
  const isConnecting = sessionStatus === "CONNECTING";

  function getConnectionButtonLabel() {
    if (isConnected) return "Disconnect";
    if (isConnecting) return "Connecting...";
    return "Connect";
  }

  function getConnectionButtonClasses() {
    const baseClasses = "text-white text-base p-2 w-36 rounded-full h-full";
    const cursorClass = isConnecting ? "cursor-not-allowed" : "cursor-pointer";

    if (isConnected) {
      // Connected -> label "Disconnect" -> red
      return `bg-red-600 hover:bg-red-700 ${cursorClass} ${baseClasses}`;
    }
    // Disconnected or connecting -> label is either "Connect" or "Connecting" -> black
    return `bg-black hover:bg-gray-900 ${cursorClass} ${baseClasses}`;
  }

  return (
    <div className="flex items-center justify-between p-2 bg-white border-t border-gray-200">
      <div className="flex items-center gap-2">
        <button
          className={getConnectionButtonClasses()}
          onClick={onToggleConnection}
          disabled={isConnecting}
        >
          {getConnectionButtonLabel()}
        </button>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          className={`text-white text-base p-2 w-36 rounded-full h-full ${
            isPTTUserSpeaking
              ? "bg-red-600 hover:bg-red-700"
              : "bg-blue-600 hover:bg-blue-700"
          } ${isConnected ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
          onClick={onToggleRecording}
          disabled={!isConnected}
        >
          {isPTTUserSpeaking ? "Stop Recording" : "Start Recording"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          className={`text-white text-base p-2 w-36 rounded-full h-full ${
            isEventsPaneExpanded
              ? "bg-gray-600 hover:bg-gray-700"
              : "bg-gray-400 hover:bg-gray-500"
          } cursor-pointer`}
          onClick={() => setIsEventsPaneExpanded(!isEventsPaneExpanded)}
        >
          {isEventsPaneExpanded ? "Hide Logs" : "Show Logs"}
        </button>
      </div>
    </div>
  );
}

export default BottomToolbar;
