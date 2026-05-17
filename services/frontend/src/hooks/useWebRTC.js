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
    const turnUrls = [envTurnUrl];
    if (envTurnUrl.startsWith('turn:') && !/[?&]transport=/.test(envTurnUrl)) {
      turnUrls.push(`${envTurnUrl}?transport=tcp`);
    }

    defaultIceServers.push({
      urls: turnUrls,
      username: envTurnUser || undefined,
      credential: envTurnPass || undefined
    });
  }

  const iceServers = config.iceServers || defaultIceServers;

  const ensureAudioReceiveTransceivers = useCallback((peerConnection, desiredCount) => {
    const targetCount = Math.max(0, Number(desiredCount) || 0);
    if (!peerConnection || targetCount === 0) return;

    const usableAudioTransceivers = peerConnection.getTransceivers().filter((transceiver) => {
      const senderTrack = transceiver.sender?.track;
      return (
        transceiver.receiver?.track?.kind === 'audio' &&
        senderTrack?.kind !== 'audio' &&
        transceiver.direction !== 'inactive' &&
        !transceiver.stopped
      );
    });

    for (let i = usableAudioTransceivers.length; i < targetCount; i += 1) {
      console.log('[WebRTC] add recvonly audio transceiver for remote track slot');
      peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    }
  }, []);

  // Initialize peer connection
  const initPeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    console.log('[WebRTC] initPeerConnection using ICE servers:', iceServers);

    const peerConnection = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: envTurnUrl ? 'relay' : 'all'
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

  // Get user media — не запрашиваем видео, пока пользователь явно не включит камеру
  // (иначе индикатор камеры горит сразу после входа в комнату).
  const startLocalStream = useCallback(async (constraints = {}) => {
    try {
      const wantAudioEnabled = !!constraints.audio;
      const wantVideoEnabled = !!constraints.video;
      const pc = initPeerConnection();
      const existingStream = localStreamRef.current;
      const existingAudioTracks = existingStream
        ? existingStream.getAudioTracks().filter((track) => track.readyState !== 'ended')
        : [];

      if (existingStream && existingAudioTracks.length > 0 && !wantVideoEnabled) {
        existingAudioTracks.forEach((track) => {
          track.enabled = wantAudioEnabled;
          const alreadySending = pc.getSenders().some((sender) => sender.track === track);
          if (!alreadySending) {
            console.log('[WebRTC] add existing audio track:', track.kind);
            pc.addTrack(track, existingStream);
          }
        });
        setLocalStream(existingStream);
        return existingStream;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: wantVideoEnabled ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
      });

      stream.getAudioTracks().forEach((track) => {
        track.enabled = wantAudioEnabled;
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      stream.getTracks().forEach((track) => {
        const alreadySending = pc.getSenders().some((sender) => sender.track === track);
        if (!alreadySending) {
          console.log('[WebRTC] addTrack:', track.kind);
          pc.addTrack(track, stream);
        }
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
      const { audioReceiveTracks, ...offerOptions } = options || {};
      ensureAudioReceiveTransceivers(pc, audioReceiveTracks);

      const offer = await pc.createOffer(offerOptions);
      await pc.setLocalDescription(offer);
      console.log('[WebRTC] createOffer: localDescription set, sdp length=', offer.sdp?.length);
      return offer;
    } catch (error) {
      console.error('[WebRTC] Failed to create offer:', error);
      throw error;
    }
  }, [ensureAudioReceiveTransceivers]);

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

  // Close peer connection — останавливаем все локальные и принимаемые дорожки (камера гаснет).
  const close = useCallback(() => {
    const pc = peerConnectionRef.current;

    if (pc) {
      try {
        pc.getSenders().forEach((sender) => {
          try {
            sender.track?.stop();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      try {
        pc.getReceivers().forEach((receiver) => {
          try {
            receiver.track?.stop();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      localStreamRef.current = null;
    }

    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
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

  // Toggle video: при первом включении запрашиваем только камеру; при выключении — stop() (гаснет индикатор).
  const toggleVideo = useCallback(async (enabled) => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    let stream = localStreamRef.current;
    let vTrack = stream?.getVideoTracks()[0];

    if (!stream) return;

    if (enabled) {
      if (!vTrack || vTrack.readyState === 'ended') {
        const vs = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const newTrack = vs.getVideoTracks()[0];
        stream.addTrack(newTrack);

        const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (videoSender) {
          try {
            await videoSender.replaceTrack(newTrack);
          } catch {
            pc.addTrack(newTrack, stream);
          }
        } else {
          pc.addTrack(newTrack, stream);
        }

        const refreshed = new MediaStream(stream.getTracks());
        localStreamRef.current = refreshed;
        setLocalStream(refreshed);
      } else {
        vTrack.enabled = true;
      }
      return;
    }

    if (vTrack) {
      try {
        vTrack.stop();
      } catch {
        // ignore
      }
      try {
        stream?.removeTrack(vTrack);
      } catch {
        // ignore
      }
      const sender = pc
        .getSenders()
        .find((s) => s.track === vTrack || (s.track && s.track.kind === 'video'));
      if (sender) {
        try {
          await sender.replaceTrack(null);
        } catch {
          // ignore
        }
      }
      if (stream && stream.getTracks().length > 0) {
        const refreshed = new MediaStream(stream.getTracks());
        localStreamRef.current = refreshed;
        setLocalStream(refreshed);
      } else if (stream) {
        localStreamRef.current = stream;
        setLocalStream(stream);
      }
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
