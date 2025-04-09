"use client";

import React, { useRef, useEffect, useState } from "react";
import { useEvent } from "@/app/contexts/EventContext";
import { LoggedEvent } from "@/app/types";
import { useLanguagePair } from "@/app/hooks/useLanguagePair";

export interface EventsProps {
  isExpanded: boolean;
}

export default function Events({ isExpanded }: EventsProps) {
  const [prevEventLogs, setPrevEventLogs] = useState<LoggedEvent[]>([]);
  const eventLogsContainerRef = useRef<HTMLDivElement | null>(null);

  const { loggedEvents, toggleExpand } = useEvent();
  const { lockedLanguagePair, lastDetectedLanguage } = useLanguagePair();
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  const getDirectionArrow = (direction: string) => {
    if (direction === "client") return { symbol: "▲", color: "#7f5af0" };
    if (direction === "server") return { symbol: "▼", color: "#2cb67d" };
    return { symbol: "•", color: "#555" };
  };

  useEffect(() => {
    const hasNewEvent = loggedEvents.length > prevEventLogs.length;

    if (isExpanded && hasNewEvent && eventLogsContainerRef.current) {
      eventLogsContainerRef.current.scrollTop =
        eventLogsContainerRef.current.scrollHeight;
    }

    setPrevEventLogs(loggedEvents);
  }, [loggedEvents, isExpanded]);

  return (
    <div className={`flex flex-col h-full ${isExpanded ? "w-96" : "w-0"} transition-all duration-300 overflow-hidden bg-gray-50 border-l border-gray-200`}>
      <div className="flex justify-between items-center p-2 border-b border-gray-200">
        <h2 className="text-sm font-semibold">Events</h2>
        <button
          onClick={() => setShowDebugPanel(!showDebugPanel)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          {showDebugPanel ? "Hide Debug" : "Show Debug"}
        </button>
      </div>

      {showDebugPanel && (
        <div className="p-2 border-b border-gray-200 bg-gray-100">
          <h3 className="text-xs font-semibold mb-1">Language Pair Debug</h3>
          <div className="text-xs space-y-1">
            <div>
              <span className="font-medium">Locked Pair:</span>{" "}
              {lockedLanguagePair ? (
                <span>
                  {lockedLanguagePair.source.code} ↔ {lockedLanguagePair.target.code}
                </span>
              ) : (
                <span className="text-gray-500">Not set</span>
              )}
            </div>
            <div>
              <span className="font-medium">Last Detected:</span>{" "}
              {lastDetectedLanguage ? (
                <span>{lastDetectedLanguage.code} ({lastDetectedLanguage.name})</span>
              ) : (
                <span className="text-gray-500">None</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loggedEvents.map((event) => (
          <div
            key={event.id}
            className="p-2 border-b border-gray-200 hover:bg-gray-100 cursor-pointer"
            onClick={() => toggleExpand(event.id)}
          >
            <div className="flex justify-between items-start">
              <div className="text-xs font-medium">
                {event.direction === "client" ? "→" : "←"} {event.eventName}
              </div>
              <div className="text-xs text-gray-500">{event.timestamp}</div>
            </div>
            {event.expanded && (
              <pre className="mt-1 text-xs bg-gray-50 p-1 rounded overflow-x-auto">
                {JSON.stringify(event.eventData, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
