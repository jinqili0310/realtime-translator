import { RefObject } from "react";

export async function createRealtimeConnection(
  EPHEMERAL_KEY: string,
  audioElement: RefObject<HTMLAudioElement | null>
): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel }> {
  try {
    console.log('Creating realtime connection with ephemeral key:', EPHEMERAL_KEY);
    
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      // Add ICE candidate policy to reduce candidates
      // iceCandidatePoolSize: 10,
      // Add bundle policy to reduce the number of ICE candidates
      // bundlePolicy: 'max-bundle',
      // Add RTCP mux policy to reduce the number of ICE candidates
      // rtcpMuxPolicy: 'require'
    });

    // Add error handling for the peer connection
    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log('Signaling state:', pc.signalingState);
    };

    // Optimize ICE candidate logging
    let iceCandidateCount = 0;
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidateCount++;
        // Only log every 5th candidate to reduce noise
        if (iceCandidateCount % 5 === 0) {
          console.log(`ICE candidate ${iceCandidateCount}:`, event.candidate);
        }
      } else {
        console.log('ICE gathering complete. Total candidates:', iceCandidateCount);
      }
    };

    // Add ICE gathering state change handler
    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
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
    console.log('Created local offer');
    await pc.setLocalDescription(offer);
    console.log('Set local description');

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";

    console.log('Sending offer to server...');
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      console.error('Server response error:', {
        status: sdpResponse.status,
        statusText: sdpResponse.statusText,
        body: errorText
      });
      throw new Error(`Server responded with status ${sdpResponse.status}: ${errorText}`);
    }

    const answerSdp = await sdpResponse.text();
    console.log('Received SDP answer');

    // Validate SDP answer
    if (!answerSdp || !answerSdp.includes('v=')) {
      console.error('Invalid SDP answer');
      throw new Error('Invalid SDP answer: missing version line');
    }

    const answer: RTCSessionDescriptionInit = {
      type: "answer",
      sdp: answerSdp,
    };

    try {
      await pc.setRemoteDescription(answer);
      console.log('Successfully set remote description');
    } catch (error) {
      console.error('Error setting remote description:', error);
      throw error;
    }

    return { pc, dc };
  } catch (error) {
    console.error('Error in createRealtimeConnection:', error);
    throw error;
  }
} 