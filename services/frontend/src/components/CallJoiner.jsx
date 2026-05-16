import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { VideoCall } from './VideoCall';
import { getLastVideoCallId, setLastVideoCallId } from '../lib/lastVideoCallId';
import '../styles/CallJoiner.css';

/**
 * Component for joining an existing group video call/meeting
 */
export function CallJoiner({
  userId,
  token,
  apiBase = '/api',
  initialCallId,
  onError,
  showNotification
}) {
  const params = useParams();
  const paramCallId = params?.callId || '';
  const [callId, setCallId] = useState(() => {
    const fromProp = (initialCallId || '').trim();
    const fromRoute = (paramCallId || '').trim();
    if (fromProp) return fromProp;
    if (fromRoute) return fromRoute;
    return getLastVideoCallId();
  });
  const [loading, setLoading] = useState(!!(initialCallId || paramCallId));
  const [error, setError] = useState(null);
  const [activeCall, setActiveCall] = useState(null);

  useEffect(() => {
    const fromRoute = (initialCallId || paramCallId || '').trim();
    if (fromRoute) {
      setCallId(fromRoute);
    }
  }, [initialCallId, paramCallId]);

  const handleJoinCall = async (e, joinIdOverride = null) => {
    if (e) e.preventDefault();

    const idToUse = (joinIdOverride || callId || '').trim();

    if (!idToUse) {
      setError('Введите ID встречи');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBase}/calls/${idToUse}/join`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(errorData || `HTTP ${response.status}`);
      }

      const callData = await response.json();
      setLastVideoCallId(idToUse);
      setActiveCall({
        id: callData.id,
        iceServers: callData.ice_servers || [
          { urls: 'stun:stun.l.google.com:19302' }
        ],
        initiatorId: callData.initiator_id,
        isInitiator: callData.initiator_id === userId
      });
    } catch (err) {
      console.error('Error joining call:', err);
      const message = err.message || 'Не удалось присоединиться к встрече';
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-join if initialCallId prop or route param is provided
  useEffect(() => {
    const idToJoin = (initialCallId || paramCallId || '').trim();
    if (idToJoin && !activeCall && userId) {
      void handleJoinCall(null, idToJoin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror original: join from route once userId is ready
  }, [initialCallId, paramCallId, activeCall, userId]);

  if (activeCall) {
    return (
      <VideoCall
        callId={activeCall.id}
        userId={userId}
        token={token}
        apiBase={apiBase}
        isInitiator={!!activeCall.isInitiator}
        showNotification={showNotification}
        onCallEnd={() => setActiveCall(null)}
      />
    );
  }

  return (
    <section className="single-page">
      <article className="pane single-card">
        <p className="section-label">ПРИСОЕДИНИТЬСЯ К ВСТРЕЧЕ</p>
        <h2>Войти в видеоконференцию</h2>

        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        <form onSubmit={handleJoinCall} className="join-form">
          <input
            value={callId}
            onChange={(e) => setCallId(e.target.value)}
            placeholder="Введите ID встречи"
            required
            autoComplete="off"
          />

          <button type="submit" disabled={loading}>
            {loading ? 'Присоединение...' : 'Присоединиться'}
          </button>
        </form>

        <div className="join-info">
          <p>Введите ID встречи, который вам предоставил организатор, или перейдите по ссылке приглашения. Последний использованный ID подставляется автоматически.</p>
        </div>
      </article>
    </section>
  );
}
