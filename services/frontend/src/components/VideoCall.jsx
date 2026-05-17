import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC';
import { useWebSocket } from '../hooks/useWebSocket';
import { setLastVideoCallId } from '../lib/lastVideoCallId';
import '../styles/VideoCall.css';

// Простые inline SVG-иконки — автономные, без внешних зависимостей
function IconMic({ active = false, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" fill={active ? '#1f8ceb' : '#666'} />
      <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.93V21a1 1 0 1 0 2 0v-3.07A7 7 0 0 0 19 11z" fill={active ? '#1f8ceb' : '#999'} />
    </svg>
  );
}

function IconLink({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M10.59 13.41a2 2 0 0 0 2.82 0l1.59-1.59a2 2 0 0 0 0-2.82 2 2 0 0 0-2.82 0L10.59 10.6a2 2 0 0 0 0 2.81z" stroke="#444" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.05 17.95a6 6 0 0 1 0-8.49l1.59-1.59" stroke="#444" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.95 6.05a6 6 0 0 1 0 8.49l-1.59 1.59" stroke="#444" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconEnd({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M21 16.5v2a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 3.5 5.18 2 2 0 0 1 5.5 3h2a2 2 0 0 1 2 1.72c.12.9.37 1.77.73 2.58a2 2 0 0 1-.45 2.11L9.7 10.7a13.16 13.16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.11-.45c.81.36 1.68.61 2.58.73A2 2 0 0 1 21 16.5z" fill="#c0392b" />
    </svg>
  );
}

/**
 * Main component for group video calling/meetings
 * Supports multiple participants with mesh topology
 */
export function VideoCall({
  callId,
  userId,
  displayName,
  token,
  apiBase = '/api',
  onCallEnd,
  isInitiator = false,
  showNotification
}) {
  const navigate = useNavigate();
  const [callState, setCallState] = useState(isInitiator ? 'waiting' : 'joining');
  const [callDuration, setCallDuration] = useState(0);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [showCopyButton, setShowCopyButton] = useState(false); // Array of {id, stream, connectionState}
  const remotePeerRef = React.useRef(null);
  const trackMapRef = React.useRef({}); // streamId|trackId -> publisherId
  const remoteAudioTrackIdsRef = React.useRef(new Set());
  const sessionReplacedRef = React.useRef(false);
  const callUnavailableRef = React.useRef(false);
  const hasRemoteOfferRef = React.useRef(false);
  const publishOfferTimerRef = React.useRef(null);
  const leavingRef = React.useRef(false);
  const endSessionRef = React.useRef(() => {});
  const wsCloseCleanupRef = React.useRef(() => {});
  const closeRtcCleanupRef = React.useRef(() => {});
  const localDisplayName = React.useMemo(() => (
    String(displayName || userId || '').trim() || 'Вы'
  ), [displayName, userId]);

  const rememberRemoteTrack = useCallback((publisherId, payload = {}) => {
    if (!publisherId || publisherId === userId) return;
    const kind = payload.kind || payload.trackKind || 'audio';
    if (kind !== 'audio') return;
    const trackId = payload.trackId || payload.track_id || payload.id || '';
    const streamId = payload.streamId || payload.streamID || payload.stream_id || '';
    remoteAudioTrackIdsRef.current.add(`${publisherId}:${trackId || streamId || remoteAudioTrackIdsRef.current.size}`);
  }, [userId]);

  const upsertParticipant = useCallback((participantId, updates = {}) => {
    if (!participantId || participantId === userId) return;
    setParticipants(prev => {
      const existing = prev.find(p => p.id === participantId);
      if (!existing) {
        return [...prev, {
          id: participantId,
          stream: null,
          connectionState: 'connecting',
          audioEnabled: false,
          ...updates
        }];
      }
      return prev.map(p => (p.id === participantId ? { ...p, ...updates } : p));
    });
  }, [userId]);

  useEffect(() => {
    setLastVideoCallId(callId);
  }, [callId]);

  useEffect(() => {
    return () => {
      if (publishOfferTimerRef.current) {
        clearTimeout(publishOfferTimerRef.current);
        publishOfferTimerRef.current = null;
      }
    };
  }, []);

  // WebRTC hook - for now keeping single connection, will extend later
  const {
    localStream,
    remoteStream,
    connectionState,
    startLocalStream,
    createOffer,
    createAnswer,
    setRemoteDescription,
    addIceCandidate,
    toggleAudio,
    close: closeWebRTC
  } = useWebRTC({
    onTrack: (event) => {
      // Map incoming stream to participant based on track-added metadata
      const stream = event.streams && event.streams[0];
      if (!stream) return;
      const sid = stream.id;
      const tid = event.track && event.track.id;
      const publisher = trackMapRef.current[sid] || trackMapRef.current[tid];
      if (publisher) {
        setParticipants(prev => {
          const existing = prev.find(p => p.id === publisher);
          if (!existing) {
            return [...prev, { id: publisher, stream: stream, connectionState: 'connected', audioEnabled: false }];
          }
          return prev.map(p => p.id === publisher ? { ...p, stream, connectionState: 'connected' } : p);
        });
      } else {
        // Fallback: if remotePeerRef is set, attach to that participant
        const fallbackId = remotePeerRef.current;
        if (fallbackId) {
          upsertParticipant(fallbackId, { stream, connectionState: 'connected' });
        } else {
          // Ignore until signaling metadata arrives to avoid duplicate ghost participants.
          console.log('[Call] Track received without publisher mapping yet, waiting for track metadata');
        }
      }
    },
    onIceCandidate: (candidate) => {
      ws.send({
        type: 'ice-candidate',
        call_id: callId,
        from: userId,
        to: remotePeerRef.current || '',
        payload: {
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex,
          sdpMid: candidate.sdpMid
        }
      });
    },
    onConnectionStateChange: (state) => {
      console.log('[Call] Connection state:', state);
      // SFU handles multiplexing of tracks; just reflect high-level connection state
      if (state === 'connected') {
        setCallState('active');
      } else if (state === 'failed') {
        setError('WebRTC connection failed');
      } else if (state === 'disconnected') {
        // Temporary network hiccups are common; don't auto-end server-side call.
        setCallState('reconnecting');
      }
    }
  });

  // WebSocket for signaling
  const wsOrigin = window.location.origin.replace(/^http/, 'ws');
  const wsEndpoint = `${wsOrigin}/ws/calls?token=${token}&call_id=${callId}`;
  const { send: ws_send, close: wsClose } = useWebSocket(wsEndpoint, {
    onOpen: async () => {
      try {
        // Микрофон: только аудиопоток, дорожки выключены до явного «включить».
        // Камера не запрашивается до нажатия кнопки — индикатор не горит.
        await startLocalStream({
          audio: false,
          video: false
        });

        // Send join message
        console.log('[Call] WS send join', { call_id: callId, from: userId });
        ws_send({
          type: 'join',
          call_id: callId,
          from: userId,
          payload: { displayName: localDisplayName }
        });
        ws_send({
          type: 'media-state',
          call_id: callId,
          from: userId,
          payload: { audioEnabled: false, displayName: localDisplayName }
        });

        // Delay self-initiated offer to avoid glare with SFU backfill offers.
        publishOfferTimerRef.current = setTimeout(async () => {
          if (hasRemoteOfferRef.current) {
            console.log('[Call] Skip initial publish offer because remote offer already received');
            return;
          }
          try {
            const pubOffer = await createOffer({ audioReceiveTracks: remoteAudioTrackIdsRef.current.size });
            console.log('[Call] Publishing local tracks, offer sdp len=', pubOffer.sdp?.length);
            ws_send({
              type: 'offer',
              call_id: callId,
              from: userId,
              payload: { sdp: pubOffer.sdp, type: pubOffer.type }
            });
          } catch (e) {
            console.error('[Call] Failed to create/send publish offer:', e);
          }
        }, 400);

        setCallState('active');
      } catch (error) {
        console.error('Error starting call:', error);
        setError('Не удаётся получить доступ к микрофону. Разрешите доступ в браузере или попробуйте другой браузер.');
      }
    },
    onMessage: async (message) => {
      try {
        switch (message.type) {
          case 'track-added':
            console.log('[Call] Track added metadata from:', message.from, 'payload:', message.payload);
            if (message.payload) {
              // store mapping from streamId/trackId to publisher id
              const streamId = message.payload.streamId || message.payload.streamID || message.payload.stream_id;
              const trackId = message.payload.trackId || message.payload.track_id;
              const remoteName = message.payload.displayName || message.payload.display_name;
              if (streamId) trackMapRef.current[streamId] = message.from;
              if (trackId) trackMapRef.current[trackId] = message.from;
              rememberRemoteTrack(message.from, message.payload);
              // ensure participant exists
              upsertParticipant(message.from, remoteName ? { displayName: remoteName } : {});
            }
            break;
          case 'ready':
            console.log('[Call] User ready:', message.from);
            // Server orchestrates SFU flows; just remember participant
            remotePeerRef.current = message.from;
            upsertParticipant(message.from, message.payload?.displayName ? { displayName: message.payload.displayName } : {});
            break;

          case 'participant-joined':
            console.log('[Call] Participant joined:', message.from);
            // remember remote peer id when someone joins
            remotePeerRef.current = message.from;
            upsertParticipant(message.from, message.payload?.displayName ? { displayName: message.payload.displayName } : {});
            break;

          case 'participant-left':
            console.log('[Call] Participant left:', message.from);
            remoteAudioTrackIdsRef.current.forEach((key) => {
              if (String(key).startsWith(`${message.from}:`)) {
                remoteAudioTrackIdsRef.current.delete(key);
              }
            });
            setParticipants(prev => prev.filter(p => p.id !== message.from));
            break;

          case 'media-state':
            upsertParticipant(message.from, {
              audioEnabled: Boolean(message.payload?.audioEnabled),
              ...(message.payload?.displayName ? { displayName: message.payload.displayName } : {})
            });
            break;

          case 'renegotiate':
            hasRemoteOfferRef.current = true;
            console.log('[Call] Received renegotiate from:', message.from, 'payload keys:', Object.keys(message.payload || {}));
            if (message.payload && message.payload.tracks) {
              try {
                const tracks = message.payload.tracks;
                tracks.forEach(t => {
                  const trackId = t.track_id || t.trackId;
                  const streamId = t.stream_id || t.streamId;
                  const publisher = t.publisher || t.publisher_id || message.from;
                  const remoteName = t.displayName || t.display_name;
                  if (trackId) trackMapRef.current[trackId] = publisher;
                  if (streamId) trackMapRef.current[streamId] = publisher;
                  rememberRemoteTrack(publisher, t);
                  // ensure participant exists
                  upsertParticipant(publisher, remoteName ? { displayName: remoteName } : {});
                });
              } catch (e) {
                console.warn('[Call] Failed to process tracks metadata:', e);
              }
            }
            try {
              const renegotiateOffer = await createOffer({
                audioReceiveTracks: remoteAudioTrackIdsRef.current.size
              });
              ws_send({
                type: 'offer',
                call_id: callId,
                from: userId,
                to: message.from,
                payload: { sdp: renegotiateOffer.sdp, type: renegotiateOffer.type }
              });
            } catch (e) {
              console.error('[Call] Failed to create renegotiation offer:', e);
              throw e;
            }
            break;

          case 'offer':
            hasRemoteOfferRef.current = true;
            console.log('[Call] Received offer from:', message.from, 'payload keys:', Object.keys(message.payload || {}));
            // If SFU includes track metadata, store mapping before negotiation
            if (message.payload && message.payload.tracks) {
              try {
                const tracks = message.payload.tracks;
                tracks.forEach(t => {
                  const trackId = t.track_id || t.trackId;
                  const streamId = t.stream_id || t.streamId;
                  const publisher = t.publisher || t.publisher_id || message.from;
                  const remoteName = t.displayName || t.display_name;
                  if (trackId) trackMapRef.current[trackId] = publisher;
                  if (streamId) trackMapRef.current[streamId] = publisher;
                  rememberRemoteTrack(publisher, t);
                  // ensure participant exists
                  upsertParticipant(publisher, remoteName ? { displayName: remoteName } : {});
                });
              } catch (e) {
                console.warn('[Call] Failed to process tracks metadata:', e);
              }
            }
            await setRemoteDescription({ type: 'offer', sdp: message.payload.sdp });
            const answer2 = await createAnswer();
            console.log('[Call] Created answer, sending via WS to', message.from, 'answer sdp len=', answer2.sdp?.length);
            ws_send({
              type: 'answer',
              call_id: callId,
              from: userId,
              to: message.from,
              payload: { sdp: answer2.sdp, type: answer2.type }
            });
            break;

          case 'answer':
            console.log('[Call] Received answer from:', message.from);
            try {
              await setRemoteDescription({
                type: 'answer',
                sdp: message.payload.sdp
              });
            } catch (err) {
              console.error('[WebRTC] Failed to set remote description:', err);
              // If remote indicates ICE restart, perform ICE restart by creating a new offer
              const msg = String(err || '');
              if (msg.includes('ICE restart') || msg.includes('ice-ufrag') || msg.includes('ICE')) {
                // Usually means stale answer after offer glare; wait for next SFU offer.
                console.warn('[Call] Ignoring stale ICE-restart answer, waiting for renegotiation');
              } else {
                throw err;
              }
            }
            break;

          case 'ice-candidate':
            console.log('[Call] Received ICE candidate from:', message.from, 'payload:', message.payload ? Object.keys(message.payload) : null);
            if (message.payload) {
              await addIceCandidate(message.payload);
            }
            break;

          case 'end': {
            const remoteEnded = Boolean(message.from && message.from !== userId);
            endSessionRef.current?.(
              remoteEnded ? 'Встреча завершена другим участником' : 'Встреча завершена',
              'info'
            );
            break;
          }

          case 'error':
            console.error('[Call] Server error:', message.payload);
            if (message.payload?.code === 'session_replaced') {
              sessionReplacedRef.current = true;
              setError('Вы вошли в этот звонок с другого устройства/вкладки. Текущая сессия завершена.');
              endSessionRef.current?.(null, 'info');
              break;
            }
            if (message.payload?.code === 'call_unavailable') {
              callUnavailableRef.current = true;
              setError('Встреча уже завершена или недоступна. Создайте новую комнату.');
              break;
            }
            setError(message.payload?.message || 'Call error');
            break;

          default:
            console.warn('[Call] Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('[Call] Error handling message:', error);
        setError(error.message);
      }
    },
    onError: (error) => {
      console.error('[Call] WebSocket error:', error);
      setError('Connection error');
    },
    onClose: () => {
      console.log('[Call] WebSocket closed');
    },
    shouldReconnect: () => !sessionReplacedRef.current && !callUnavailableRef.current
  });

  const runEndSession = useCallback((message, notifyType = 'success') => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      wsClose();
    } catch {
      // ignore
    }
    try {
      closeWebRTC();
    } catch {
      // ignore
    }
    setCallState('ended');
    onCallEnd?.();
    if (message) {
      showNotification?.(message, notifyType);
    }
    window.setTimeout(() => {
      navigate('/calls', { replace: true });
    }, 220);
  }, [wsClose, closeWebRTC, onCallEnd, showNotification, navigate]);

  useEffect(() => {
    endSessionRef.current = runEndSession;
  }, [runEndSession]);

  wsCloseCleanupRef.current = wsClose;
  closeRtcCleanupRef.current = closeWebRTC;

  useEffect(() => {
    return () => {
      try {
        wsCloseCleanupRef.current?.();
      } catch {
        // ignore
      }
      try {
        closeRtcCleanupRef.current?.();
      } catch {
        // ignore
      }
    };
  }, [callId]);

  // Create wrapper for ws_send
  const ws = { send: ws_send };

  // Call timer
  useEffect(() => {
    if (callState !== 'active') return;

    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [callState]);

  useEffect(() => {
    if (!userId || !callId) return;
    ws_send({
      type: 'media-state',
      call_id: callId,
      from: userId,
      payload: { audioEnabled: isAudioEnabled, displayName: localDisplayName }
    });
  }, [callId, isAudioEnabled, localDisplayName, userId, ws_send]);

  // Handle audio toggle
  const handleToggleAudio = useCallback(() => {
    const newState = !isAudioEnabled;
    setIsAudioEnabled(newState);
    toggleAudio(newState);
    ws_send({
      type: 'media-state',
      call_id: callId,
      from: userId,
      payload: { audioEnabled: newState, displayName: localDisplayName }
    });
  }, [isAudioEnabled, toggleAudio, ws_send, callId, userId, localDisplayName]);

  // Handle copy meeting link
  const handleCopyLink = useCallback(() => {
    const link = `${window.location.origin}/calls/join/${callId}`;
    navigator.clipboard.writeText(link);
    setShowCopyButton(true);
    setTimeout(() => setShowCopyButton(false), 2000);
  }, [callId]);

  // Handle end call
  const handleCallEnd = useCallback(async () => {
    try {
      ws_send({
        type: 'end',
        call_id: callId,
        from: userId,
        payload: { reason: 'user_initiated' }
      });
    } catch (error) {
      console.error('Error sending end signal:', error);
    }

    try {
      await fetch(`${apiBase}/calls/${callId}/end`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.error('Error ending call:', error);
    }

    runEndSession('Встреча завершена', 'success');
  }, [callId, userId, token, apiBase, ws_send, runEndSession]);

  // Format duration
  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="video-call" lang="ru">
      <div className="video-container">
        {/* Participants grid */}
        <div className="participants-grid">
          {/* Local participant */}
          <div className="participant-tile local">
            {localStream ? (
              <ParticipantAudioTile
                userId={userId}
                label={localDisplayName}
                audioEnabled={isAudioEnabled}
                isLocal
              />
            ) : (
              <div className="video-placeholder">
                <span>Подключение…</span>
              </div>
            )}
          </div>

          {/* Remote participants */}
          {participants.map((participant) => (
            <div key={participant.id} className="participant-tile remote">
              <ParticipantAudioTile
                userId={participant.id}
                label={participant.displayName}
                stream={participant.stream}
                audioEnabled={participant.audioEnabled}
              />
            </div>
          ))}

          {/* Empty slots for better layout */}
          {Array.from({ length: Math.max(0, 4 - participants.length - 1) }, (_, i) => (
            <div key={`empty-${i}`} className="participant-tile empty">
              <div className="video-placeholder">
                <span>Место свободно</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Call info */}
      <div className="call-info">
        <div className="call-status">
          <span className={`status-indicator ${connectionState}`}></span>
          <span className="status-text">{connectionState.toUpperCase()}</span>
          {callState === 'active' && <span className="duration">{formatDuration(callDuration)}</span>}
          <span className="participants-count">
            {participants.length + 1} участник{participants.length + 1 > 1 ? 'ов' : ''}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="call-controls">
        <button
          className={`control-btn ${isAudioEnabled ? 'active' : 'inactive'}`}
          onClick={handleToggleAudio}
          title={isAudioEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
        >
          <IconMic active={isAudioEnabled} />
        </button>

        <button
          className="control-btn info-btn"
          onClick={handleCopyLink}
          title="Копировать ссылку на встречу"
        >
          <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
            <IconLink />
            <span>{showCopyButton ? 'Скопировано!' : 'Ссылка'}</span>
          </span>
        </button>

        <button
          className="control-btn end-call"
          onClick={handleCallEnd}
          title="Завершить звонок"
        >
          <IconEnd />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="error-banner">
          <p>{error}</p>
          <button type="button" onClick={() => setError(null)}>Закрыть</button>
        </div>
      )}
    </div>
  );
}

/**
 * Audio-only participant tile.
 */
function ParticipantAudioTile({ stream, userId, label, audioEnabled = false, isLocal = false }) {
  const audioRef = React.useRef(null);

  React.useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    el.srcObject = stream || null;
    return () => {
      try {
        el.pause();
      } catch {
        // ignore
      }
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <div className={`audio-tile ${audioEnabled ? 'mic-on' : 'mic-off'}`}>
      {!isLocal && stream ? <audio ref={audioRef} autoPlay playsInline /> : null}
      <div className="audio-avatar" aria-hidden="true">
        <IconMic active={audioEnabled} size={28} />
      </div>
      <div className="audio-tile-title">{label || userId.slice(0, 8)}</div>
      <div className={`mic-status-pill ${audioEnabled ? 'on' : 'off'}`}>
        <span className="mic-status-dot" aria-hidden="true" />
        {audioEnabled ? 'Микрофон включён' : 'Микрофон выключен'}
      </div>
    </div>
  );
}
