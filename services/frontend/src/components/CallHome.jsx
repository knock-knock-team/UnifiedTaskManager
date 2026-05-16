import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CallCreator } from './CallCreator';
import { CallJoiner } from './CallJoiner';
import { clearLastVideoCallId, getLastVideoCallId } from '../lib/lastVideoCallId';
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
  const [mode, setMode] = useState(null);
  const [searchParams] = useSearchParams();
  const joinId = searchParams.get('join');
  const [savedCallId, setSavedCallId] = useState(() => getLastVideoCallId());

  useEffect(() => {
    if (joinId) {
      setMode('join');
    }
  }, [joinId]);

  useEffect(() => {
    if (mode === null) {
      setSavedCallId(getLastVideoCallId());
    }
  }, [mode]);

  if (mode === 'create') {
    return (
      <CallCreator
        userId={userId}
        token={token}
        apiBase={apiBase}
        showNotification={showNotification}
        onCallCreated={() => {
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
        initialCallId={joinId || undefined}
        showNotification={showNotification}
        onError={(msg) => showNotification?.(msg, 'error')}
      />
    );
  }

  return (
    <section className="single-page wide-page calls-hub">
      <article className="pane calls-hub-pane">
        <p className="section-label">Видеовстречи</p>
        <h2>Создайте комнату или войдите по ID</h2>
        <p className="calls-hub-intro">
          Групповой звонок внутри вашего аккаунта: создайте комнату и отправьте ссылку коллегам,
          либо введите ID встречи, которую вам прислали.
        </p>

        {savedCallId ? (
          <div className="calls-hub-last" role="region" aria-label="Последняя встреча">
            <p className="calls-hub-last-label">Сохранён код последней встречи (в этом браузере)</p>
            <div className="calls-hub-last-row">
              <code className="calls-hub-last-code">{savedCallId}</code>
              <button type="button" onClick={() => setMode('join')}>
                Войти снова
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  clearLastVideoCallId();
                  setSavedCallId('');
                  showNotification?.('Код встречи сброшен', 'info');
                }}
              >
                Забыть код
              </button>
            </div>
          </div>
        ) : null}

        <div className="calls-hub-grid">
          <button type="button" className="calls-hub-card" onClick={() => setMode('create')}>
            <span className="calls-hub-card-title">Создать встречу</span>
            <span className="calls-hub-card-desc">Новая комната, ссылка для приглашения и переход к звонку.</span>
          </button>
          <button type="button" className="calls-hub-card" onClick={() => setMode('join')}>
            <span className="calls-hub-card-title">Присоединиться</span>
            <span className="calls-hub-card-desc">Введите ID встречи или откройте страницу по ссылке-приглашению.</span>
          </button>
        </div>

        <p className="section-label">Как это устроено</p>
        <ol className="calls-hub-steps">
          <li>
            <span className="calls-hub-step-num" aria-hidden>1</span>
            <span>Организатор создаёт встречу — сервер выдаёт ID и защищённый канал сигналинга.</span>
          </li>
          <li>
            <span className="calls-hub-step-num" aria-hidden>2</span>
            <span>Участники открывают ссылку или вводят ID на этой странице и подключаются к той же комнате.</span>
          </li>
          <li>
            <span className="calls-hub-step-num" aria-hidden>3</span>
            <span>Камера и микрофон по умолчанию выключены — включите их в панели управления перед разговором.</span>
          </li>
        </ol>

        <p className="calls-hub-footnote">
          После выхода из звонка вы вернётесь на эту страницу; код последней встречи сохраняется, чтобы можно было подключиться снова.
          Камера и микрофон отключаются при выходе.
        </p>
      </article>
    </section>
  );
}
