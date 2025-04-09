"use client";

import { SpeakerProvider } from "./contexts/SpeakerContext";
import { TranscriptProvider } from "./contexts/TranscriptContext";
import { EventProvider } from "./contexts/EventContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <EventProvider>
      <TranscriptProvider>
        <SpeakerProvider>
          {children}
        </SpeakerProvider>
      </TranscriptProvider>
    </EventProvider>
  );
} 