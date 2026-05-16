import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Custom hook for WebRTC peer connection
 */
export function useWebRTC(config = {}) {
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  const [iceGatheringState, setIceGatheringState] = useState('new');

  const envTurnUrl = import.meta.env.VITE_TURN_URL;
  const envTurnUser = import.meta.env.VITE_TURN_USERNAME;
  const envTurnPass = import.meta.env.VITE_TURN_CREDENTIAL;

  const defaultIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  if (envTurnUrl) {
    defaultIceServers.push({
      urls: envTurnUrl,
      username: envTurnUser || undefined,
      credential: envTurnPass || undefined
    });
  }

  const iceServers = config.iceServers || defaultIceServers;

  // Initialize peer connection
  const initPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    console.log('[WebRTC] initPeerConnection using ICE servers:', iceServers);

    const peerConnection = new RTCPeerConnection({
      iceServers
    });

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] onicecandidate ->', event.candidate);
        config.onIceCandidate?.(event.candidate);
      }
    };

    peerConnection.ontrack = (event) => {
      console.log('[WebRTC] Track received:', event.track.kind, 'streams:', event.streams.length);
      // Notify caller with full event so they can map streams to participants (support SFU)
      try {
        config.onTrack?.(event);
      } catch (e) {
        console.error('[WebRTC] onTrack handler error:', e);
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', peerConnection.connectionState);
      setConnectionState(peerConnection.connectionState);
      config.onConnectionStateChange?.(peerConnection.connectionState);
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE state:', peerConnection.iceConnectionState);
      config.onIceStateChange?.(peerConnection.iceConnectionState);
    };

    peerConnection.onicegatheringstatechange = () => {
      console.log('[WebRTC] ICE gathering state:', peerConnection.iceGatheringState);
      setIceGatheringState(peerConnection.iceGatheringState);
    };

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  }, [config, iceServers]);

  // Get user media
  const startLocalStream = useCallback(async (constraints = {}) => {
    try {
      // Always request audio and video, but they can be disabled via enabled property
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: 1280, height: 720 }
      });

      // Disable tracks based on constraints
      if (!constraints.audio) {
        stream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      if (!constraints.video) {
        stream.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
      }

      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = initPeerConnection();
      stream.getTracks().forEach((track) => {
        console.log('[WebRTC] addTrack:', track.kind);
        pc.addTrack(track, stream);
      });

      return stream;
    } catch (error) {
      console.error('[WebRTC] Failed to get user media:', error);
      throw error;
    }
  }, [initPeerConnection]);

  // Create offer
  const createOffer = useCallback(async (options = {}) => {
    const pc = peerConnectionRef.current;
    if (!pc) throw new Error('Peer connection not initialized');

    try {
      const offer = await pc.createOffer(options);
      await pc.setLocalDescription(offer);
      console.log('[WebRTC] createOffer: localDescription set, sdp length=', offer.sdp?.length);
      return offer;
    } catch (error) {
      console.error('[WebRTC] Failed to create offer:', error);
      throw error;
    }
  }, []);

  // Create answer
  const createAnswer = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc) throw new Error('Peer connection not initialized');

    try {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[WebRTC] createAnswer: localDescription set, sdp length=', answer.sdp?.length);
      return answer;
    } catch (error) {
      console.error('[WebRTC] Failed to create answer:', error);
      throw error;
    }
  }, []);

  // Set remote description
  const setRemoteDescription = useCallback(async (sdp) => {
    const pc = peerConnectionRef.current;
    if (!pc) throw new Error('Peer connection not initialized');

    try {
      console.log('[WebRTC] setRemoteDescription: type=', sdp.type, 'sdp length=', sdp.sdp?.length);
      console.log('[WebRTC] pre-setRemoteDescription signalingState=', pc.signalingState, 'remoteDesc=', !!pc.remoteDescription, 'pendingCandidates=', pendingCandidatesRef.current?.length || 0);
      if (sdp.type === 'offer' && pc.signalingState !== 'stable') {
        console.warn('[WebRTC] Offer collision detected, rolling back local description');
        await pc.setLocalDescription({ type: 'rollback' });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('[WebRTC] post-setRemoteDescription signalingState=', pc.signalingState, 'remoteDesc.type=', pc.remoteDescription?.type);
      // flush pending ICE candidates after remote description is set
      if (pendingCandidatesRef.current && pendingCandidatesRef.current.length > 0) {
        for (const cand of pendingCandidatesRef.current) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
            console.log('[WebRTC] flushed pending candidate:', cand?.candidate?.substring?.(0,80) || cand);
          } catch (e) {
            console.error('[WebRTC] Failed to add pending candidate:', e);
          }
        }
        pendingCandidatesRef.current = [];
      }
    } catch (error) {
      console.error('[WebRTC] Failed to set remote description:', error);
      throw error;
    }
  }, []);

  // Add ICE candidate
  const addIceCandidate = useCallback(async (candidate) => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    try {
      // If remoteDescription is not set yet, buffer candidate
      if (!pc.remoteDescription || !pc.remoteDescription.type) {
        pendingCandidatesRef.current.push(candidate);
        console.log('[WebRTC] addIceCandidate: queued (no remoteDescription yet)');
        return;
      }

      console.log('[WebRTC] addIceCandidate:', candidate?.candidate ? candidate.candidate.substring(0,80) : candidate);
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('[WebRTC] Failed to add ICE candidate:', error);
    }
  }, []);

  // Close peer connection
  const close = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState('new');
  }, []);

  // Toggle audio
  const toggleAudio = useCallback((enabled) => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  }, []);

  // Toggle video
  const toggleVideo = useCallback((enabled) => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  }, []);

  return {
    localStream,
    remoteStream,
    connectionState,
    iceGatheringState,
    startLocalStream,
    createOffer,
    createAnswer,
    setRemoteDescription,
    addIceCandidate,
    toggleAudio,
    toggleVideo,
    close
  };
}
