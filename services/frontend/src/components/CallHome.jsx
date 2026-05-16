import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CallCreator } from './CallCreator';
import { CallJoiner } from './CallJoiner';
import '../styles/CallHome.css';

/**
 * Home page for video calling - create meeting or join by ID
 */
export function CallHome({
  userId,
  token,
  apiBase = '/api',
  showNotification
}) {
  const [mode, setMode] = useState(null); // null | 'create' | 'join'
  const [searchParams] = useSearchParams();
  const joinId = searchParams.get('join');

  console.log('CallHome render:', { mode, joinId, userId, token: !!token });

  useEffect(() => {
    if (joinId) {
      setMode('join');
    }
  }, [joinId]);

  if (mode === 'create') {
    return (
      <CallCreator
        userId={userId}
        token={token}
        apiBase={apiBase}
        onCallCreated={(callData) => {
          console.log('CallHome onCallCreated called:', callData);
          showNotification?.('Встреча создана', 'success');
        }}
        onError={(msg) => showNotification?.(msg, 'error')}
      />
    );
  }

  if (mode === 'join') {
    return (
      <CallJoiner
        userId={userId}
        token={token}
        apiBase={apiBase}
        initialCallId={joinId}
        onError={(msg) => showNotification?.(msg, 'error')}
      />
    );
  }

  return (
    <div className="call-home">
      <div className="home-container">
        <div className="home-hero">
          <p className="eyebrow">ВИДЕОЗВОНКИ</p>
          <h1>Создайте встречу или присоединитесь</h1>
          <p className="hero-note">
            Организуйте групповые видеоконференции с коллегами. Создайте встречу и поделитесь ссылкой,
            или присоединитесь к существующей по ID.
          </p>
        </div>

        <div className="mode-selector">
          <div className="mode-card create" onClick={() => setMode('create')}>
            <div className="mode-icon">🎥</div>
            <h2>Создать встречу</h2>
            <p>Создайте новую видеоконференцию и получите ссылку для приглашения</p>
            <button className="mode-btn">Создать</button>
          </div>

          <div className="divider">ИЛИ</div>

          <div className="mode-card join" onClick={() => setMode('join')}>
            <div className="mode-icon">👥</div>
            <h2>Присоединиться</h2>
            <p>Введите ID встречи, чтобы присоединиться к существующей конференции</p>
            <button className="mode-btn">Присоединиться</button>
          </div>
        </div>

        <div className="home-info">
          <h3>Как это работает</h3>
          <ul>
            <li>🎥 Создайте встречу и получите уникальный ID и ссылку</li>
            <li>🔗 Поделитесь ссылкой с коллегами для быстрого присоединения</li>
            <li>👥 До 10 участников могут присоединиться одновременно</li>
            <li>🔒 Безопасное шифрованное соединение</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
