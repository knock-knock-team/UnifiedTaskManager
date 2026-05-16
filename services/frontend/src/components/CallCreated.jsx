import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import '../styles/CallCreated.css';

/**
 * Page showing information about a created call/meeting
 */
export function CallCreated({
  userId,
  token,
  apiBase = '/api',
  showNotification
}) {
  const { callId } = useParams();
  const navigate = useNavigate();
  const [callData, setCallData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!callId) {
      navigate('/calls');
      return;
    }

    // Fetch call details
    fetch(`${apiBase}/calls/${callId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Не удалось загрузить информацию о встрече');
        }
        return response.json();
      })
      .then(data => {
        setCallData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error fetching call:', err);
        setError(err.message);
        setLoading(false);
        showNotification?.(err.message, 'error');
      });
  }, [callId, token, apiBase, navigate, showNotification]);

  const handleStartCall = () => {
    // Navigate to video call
    navigate(`/calls/join/${callId}`);
  };

  const handleCopyLink = () => {
    const link = `${window.location.origin}/calls/join/${callId}`;
    navigator.clipboard.writeText(link);
    showNotification?.('Ссылка скопирована', 'success');
  };

  if (loading) {
    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">ЗАГРУЗКА</p>
          <h2>Загружаем информацию о встрече...</h2>
        </article>
      </section>
    );
  }

  if (error || !callData) {
    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">ОШИБКА</p>
          <h2>Не удалось загрузить встречу</h2>
          <p>{error || 'Встреча не найдена'}</p>
          <button onClick={() => navigate('/calls')}>
            Вернуться к звонкам
          </button>
        </article>
      </section>
    );
  }

  const inviteLink = `${window.location.origin}/calls/join/${callId}`;

  return (
    <section className="single-page">
      <article className="pane single-card">
        <p className="section-label">ВСТРЕЧА СОЗДАНА</p>
        <h2>Ваша видеоконференция готова</h2>

        <div className="call-info">
          <div className="info-item">
            <strong>ID встречи:</strong>
            <code>{callData.id}</code>
          </div>

          <div className="info-item">
            <strong>Ссылка для приглашения:</strong>
            <div className="link-container">
              <input
                type="text"
                value={inviteLink}
                readOnly
                className="link-input"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="copy-btn"
                title="Скопировать ссылку"
              >
                📋
              </button>
            </div>
          </div>

          <div className="info-item">
            <strong>Статус:</strong>
            <span className={`status status-${callData.status.toLowerCase()}`}>
              {callData.status === 'CREATED' ? 'Создана' :
               callData.status === 'ACTIVE' ? 'Активна' :
               callData.status === 'ENDED' ? 'Завершена' : callData.status}
            </span>
          </div>

          <div className="info-item">
            <strong>Участники:</strong>
            <span>{callData.participants?.length || 0} человек</span>
          </div>
        </div>

        <div className="call-actions">
          <button
            type="button"
            onClick={handleStartCall}
            className="primary"
          >
            Начать встречу
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => navigate('/calls')}
          >
            Создать новую
          </button>
        </div>

        <div className="share-info">
          <h3>Как пригласить участников</h3>
          <ul>
            <li>📋 Скопируйте ссылку выше и поделитесь ею</li>
            <li>💬 Отправьте ID встречи коллегам</li>
            <li>👥 Участники смогут присоединиться по ссылке или ID</li>
          </ul>
        </div>
      </article>
    </section>
  );
}