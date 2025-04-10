import { RefObject } from "react";

export async function createRealtimeConnection(
  EPHEMERAL_KEY: string,
  audioElement: RefObject<HTMLAudioElement | null>
): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel }> {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  // Add error handling for the peer connection
  pc.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', pc.iceConnectionState);
  };

  pc.onconnectionstatechange = () => {
    console.log('Connection state:', pc.connectionState);
  };

  pc.ontrack = (e) => {
    console.log('Received track:', e.track.kind);
    if (audioElement.current) {
      audioElement.current.srcObject = e.streams[0];
      // Add error handling for the audio element
      audioElement.current.onerror = (error) => {
        console.error('Audio element error:', error);
      };
      // Ensure audio continues playing
      audioElement.current.onended = () => {
        console.log('Audio stream ended, attempting to restart');
        if (audioElement.current && audioElement.current.srcObject) {
          audioElement.current.play().catch(err => {
            console.error('Failed to restart audio:', err);
          });
        }
      };
    }
  };

  const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioTrack = ms.getTracks()[0];
  
  // Add error handling for the audio track
  audioTrack.onended = () => {
    console.log('Audio track ended');
  };
  
  audioTrack.onmute = () => {
    console.log('Audio track muted');
  };
  
  audioTrack.onunmute = () => {
    console.log('Audio track unmuted');
  };

  pc.addTrack(audioTrack);

  const dc = pc.createDataChannel("oai-events");

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const baseUrl = "https://api.openai.com/v1/realtime";
  const model = "gpt-4o-realtime-preview-2024-12-17";

  const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${EPHEMERAL_KEY}`,
      "Content-Type": "application/sdp",
    },
  });

  const answerSdp = await sdpResponse.text();
  const answer: RTCSessionDescriptionInit = {
    type: "answer",
    sdp: answerSdp,
  };

  await pc.setRemoteDescription(answer);

  return { pc, dc };
} 