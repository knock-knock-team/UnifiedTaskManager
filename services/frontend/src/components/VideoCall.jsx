import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC';
import { useWebSocket } from '../hooks/useWebSocket';
import { setLastVideoCallId } from '../lib/lastVideoCallId';
import '../styles/VideoCall.css';

/**
 * Main component for group video calling/meetings
 * Supports multiple participants with mesh topology
 */
export function VideoCall({
  callId,
  userId,
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
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [showCopyButton, setShowCopyButton] = useState(false); // Array of {id, stream, connectionState}
  const remotePeerRef = React.useRef(null);
  const trackMapRef = React.useRef({}); // streamId|trackId -> publisherId
  const sessionReplacedRef = React.useRef(false);
  const hasRemoteOfferRef = React.useRef(false);
  const publishOfferTimerRef = React.useRef(null);
  const leavingRef = React.useRef(false);
  const endSessionRef = React.useRef(() => {});
  const wsCloseCleanupRef = React.useRef(() => {});
  const closeRtcCleanupRef = React.useRef(() => {});

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
    toggleVideo,
    close: closeWebRTC
  } = useWebRTC({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
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
            return [...prev, { id: publisher, stream: stream, connectionState: 'connected' }];
          }
          return prev.map(p => p.id === publisher ? { ...p, stream, connectionState: 'connected' } : p);
        });
      } else {
        // Fallback: if remotePeerRef is set, attach to that participant
        const fallbackId = remotePeerRef.current;
        if (fallbackId) {
          setParticipants(prev => prev.map(p => p.id === fallbackId ? { ...p, stream, connectionState: 'connected' } : p));
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
          from: userId
        });

        // Delay self-initiated offer to avoid glare with SFU backfill offers.
        publishOfferTimerRef.current = setTimeout(async () => {
          if (hasRemoteOfferRef.current) {
            console.log('[Call] Skip initial publish offer because remote offer already received');
            return;
          }
          try {
            const pubOffer = await createOffer();
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
              if (streamId) trackMapRef.current[streamId] = message.from;
              if (trackId) trackMapRef.current[trackId] = message.from;
              // ensure participant exists
              setParticipants(prev => {
                const existing = prev.find(p => p.id === message.from);
                if (!existing) {
                  return [...prev, { id: message.from, stream: null, connectionState: 'connecting' }];
                }
                return prev;
              });
            }
            break;
          case 'ready':
            console.log('[Call] User ready:', message.from);
            // Server orchestrates SFU flows; just remember participant
            remotePeerRef.current = message.from;
            setParticipants(prev => {
              const existing = prev.find(p => p.id === message.from);
              if (!existing) {
                return [...prev, { id: message.from, stream: null, connectionState: 'connecting' }];
              }
              return prev;
            });
            break;

          case 'participant-joined':
            console.log('[Call] Participant joined:', message.from);
            // remember remote peer id when someone joins
            remotePeerRef.current = message.from;
            setParticipants(prev => {
              const existing = prev.find(p => p.id === message.from);
              if (!existing) {
                return [...prev, { id: message.from, stream: null, connectionState: 'connecting' }];
              }
              return prev;
            });
            break;

          case 'participant-left':
            console.log('[Call] Participant left:', message.from);
            setParticipants(prev => prev.filter(p => p.id !== message.from));
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
                  if (trackId) trackMapRef.current[trackId] = publisher;
                  if (streamId) trackMapRef.current[streamId] = publisher;
                  // ensure participant exists
                  setParticipants(prev => {
                    const existing = prev.find(p => p.id === publisher);
                    if (!existing) {
                      return [...prev, { id: publisher, stream: null, connectionState: 'connecting' }];
                    }
                    return prev;
                  });
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
    shouldReconnect: () => !sessionReplacedRef.current
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

  // Handle audio toggle
  const handleToggleAudio = useCallback(() => {
    const newState = !isAudioEnabled;
    setIsAudioEnabled(newState);
    toggleAudio(newState);
  }, [isAudioEnabled, toggleAudio]);

  // Handle video toggle (async: первый запуск камеры — отдельный getUserMedia)
  const handleToggleVideo = useCallback(async () => {
    const next = !isVideoEnabled;
    try {
      await toggleVideo(next);
      setIsVideoEnabled(next);
      try {
        const pubOffer = await createOffer();
        ws_send({
          type: 'offer',
          call_id: callId,
          from: userId,
          payload: { sdp: pubOffer.sdp, type: pubOffer.type }
        });
      } catch (e) {
        console.warn('[Call] После изменения камеры не удалось отправить повторный offer:', e);
      }
    } catch (e) {
      console.error(e);
      showNotification?.('Не удалось получить доступ к камере или обновить соединение', 'error');
    }
  }, [isVideoEnabled, toggleVideo, createOffer, ws_send, callId, userId, showNotification]);

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
              isVideoEnabled ? (
                <LocalVideo stream={localStream} userId={userId} />
              ) : (
                <div className="video-placeholder video-placeholder-muted">
                  <span>Камера выключена</span>
                  <span className="video-placeholder-hint">Включите камеру кнопкой ниже</span>
                </div>
              )
            ) : (
              <div className="video-placeholder">
                <span>Подключение…</span>
              </div>
            )}
          </div>

          {/* Remote participants */}
          {participants.map((participant) => (
            <div key={participant.id} className="participant-tile remote">
              {participant.stream ? (
                <RemoteVideo stream={participant.stream} userId={participant.id} />
              ) : (
                <div className="video-placeholder">
                  <span>Подключение к {participant.id.slice(0, 8)}…</span>
                </div>
              )}
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
          🎤
        </button>

        <button
          className={`control-btn ${isVideoEnabled ? 'active' : 'inactive'}`}
          onClick={handleToggleVideo}
          title={isVideoEnabled ? 'Выключить камеру' : 'Включить камеру'}
        >
          📹
        </button>

        <button
          className="control-btn info-btn"
          onClick={handleCopyLink}
          title="Копировать ссылку на встречу"
        >
          🔗 {showCopyButton ? 'Скопировано!' : 'Ссылка'}
        </button>

        <button
          className="control-btn end-call"
          onClick={handleCallEnd}
          title="Завершить звонок"
        >
          ☎️
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
 * Local video component
 */
function LocalVideo({ stream, userId }) {
  const videoRef = React.useRef(null);

  React.useEffect(() => {
    const el = videoRef.current;
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
    <div className="video-track">
      <video ref={videoRef} autoPlay playsInline muted />
      <div className="video-label">Вы ({userId.slice(0, 8)})</div>
    </div>
  );
}

/**
 * Remote video component
 */
function RemoteVideo({ stream, userId }) {
  const videoRef = React.useRef(null);

  React.useEffect(() => {
    const el = videoRef.current;
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
    <div className="video-track">
      <video ref={videoRef} autoPlay playsInline />
      <div className="video-label">{userId.slice(0, 8)}</div>
    </div>
  );
}
