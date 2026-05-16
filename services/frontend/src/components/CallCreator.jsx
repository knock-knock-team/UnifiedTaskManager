import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { VideoCall } from './VideoCall';
import '../styles/CallCreator.css';

/**
 * Component for creating a new group video call/meeting
 */
export function CallCreator({
  userId,
  token,
  apiBase = '/api',
  onCallCreated,
  onError
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [createdCall, setCreatedCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);

  console.log('CallCreator render:', { createdCall, activeCall, loading, error });

  const handleCreateCall = async (e) => {
    e.preventDefault();

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBase}/calls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Call creation failed:', response.status, errorData);
        throw new Error(errorData || `HTTP ${response.status}`);
      }

      const callData = await response.json();
      console.log('Call created successfully:', callData);
      
      const callInfo = {
        id: callData.id,
        link: `${window.location.origin}/calls/join/${callData.id}`,
        iceServers: callData.ice_servers || [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      };

      console.log('Setting active call:', callInfo);
      setActiveCall(callInfo);
      onCallCreated?.(callData);
      // Перейти сразу на страницу присоединения к встрече, чтобы попасть в VideoCall
      try {
        navigate(`/calls/join/${callInfo.id}`);
      } catch (e) {
        console.warn('Navigation failed after call creation:', e);
      }
    } catch (error) {
      console.error('Error creating call:', error);
      const message = error.message || 'Не удалось создать встречу';
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartCall = () => {
    if (activeCall) {
      // Already called by auto-start in return
    }
  };

  const handleCopyLink = () => {
    if (createdCall?.link) {
      navigator.clipboard.writeText(createdCall.link);
    }
  };

  if (activeCall) {
    return (
      <VideoCall
        callId={activeCall.id}
        userId={userId}
        token={token}
        apiBase={apiBase}
        isInitiator={true}
        onCallEnd={() => setActiveCall(null)}
      />
    );
  }

  if (createdCall) {
    console.log('Rendering created call page:', createdCall);
    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">ВСТРЕЧА СОЗДАНА</p>
          <h2>Ваша видеоконференция готова</h2>

          <div className="call-info">
            <div className="info-item">
              <strong>ID встречи:</strong>
              <code>{createdCall.id}</code>
            </div>

            <div className="info-item">
              <strong>Ссылка для приглашения:</strong>
              <div className="link-container">
                <input
                  type="text"
                  value={createdCall.link}
                  readOnly
                  className="link-input"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="copy-btn"
                >
                  📋
                </button>
              </div>
            </div>
          </div>

          <div className="call-actions">
            <button type="button" onClick={handleStartCall}>
              Начать встречу
            </button>
            <button type="button" className="ghost" onClick={() => setCreatedCall(null)}>
              Создать новую
            </button>
          </div>

          <div className="share-info">
            <p>Поделитесь ссылкой или ID с участниками, чтобы они могли присоединиться к встрече.</p>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="single-page">
      <article className="pane single-card">
        <p className="section-label">СОЗДАТЬ ВСТРЕЧУ</p>
        <h2>Новая видеоконференция</h2>

        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        <form onSubmit={handleCreateCall} className="create-form">
          <p className="form-description">
            Создайте групповую видеоконференцию. После создания вы получите уникальный ID и ссылку для приглашения участников.
          </p>

          <button type="submit" disabled={loading}>
            {loading ? 'Создание...' : 'Создать встречу'}
          </button>
        </form>
      </article>
    </section>
  );
}
