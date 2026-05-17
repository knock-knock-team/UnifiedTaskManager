import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request } from '../lib/api';

function sameMessageList(left, right) {
  if (left.length !== right.length) return false;
  return left.every((message, index) => {
    const next = right[index];
    return message.id === next?.id && message.body === next?.body && message.updatedAt === next?.updatedAt;
  });
}

export function ChatPage({ accessToken, apiBase, profile, showNotification, onUpdateAccessToken }) {
  const [rooms, setRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [roomDetails, setRoomDetails] = useState(null);
  const [messages, setMessages] = useState([]);
  const [userDirectory, setUserDirectory] = useState({});
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomParticipantQuery, setNewRoomParticipantQuery] = useState('');
  const [addParticipantQuery, setAddParticipantQuery] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const messagesContainerRef = useRef(null);
  const scrollModeRef = useRef('none');
  const preservedScrollTopRef = useRef(0);
  const selectedRoomIdRef = useRef('');

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) || null,
    [rooms, selectedRoomId]
  );

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

  const loadRooms = useCallback(async ({ silent = false } = {}) => {
    if (!accessToken) return;
    if (!silent) {
      setIsLoadingRooms(true);
    }
    try {
      const data = await request(apiBase, accessToken, '/v1/chats/rooms?limit=100&offset=0', { auth: true }, onUpdateAccessToken);
      const items = Array.isArray(data.items) ? data.items : [];
      setRooms(items);
      setSelectedRoomId((prev) => {
        if (prev && items.some((item) => item.id === prev)) return prev;
        return items[0]?.id || '';
      });
    } catch (error) {
      if (!silent) {
        showNotification(error.message || 'Не удалось загрузить чаты', 'error');
      }
    } finally {
      if (!silent) {
        setIsLoadingRooms(false);
      }
    }
  }, [accessToken, apiBase, onUpdateAccessToken, showNotification]);

  const lookupUser = useCallback(async (query) => {
    const raw = String(query || '').trim();
    if (!raw) {
      return null;
    }
    const isTagQuery = raw.startsWith('@');
    const isEmailQuery = !isTagQuery && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
    const lookupPath = isEmailQuery
      ? `/v1/users/lookup?email=${encodeURIComponent(raw.toLowerCase())}`
      : `/v1/users/lookup?tag=${encodeURIComponent(raw.replace(/^@+/, ''))}`;
    const data = await request(apiBase, accessToken, lookupPath, { auth: true }, onUpdateAccessToken);
    return data || null;
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const lookupUserById = useCallback(async (userId) => {
    const normalizedId = String(userId || '').trim();
    if (!normalizedId) {
      return null;
    }
    const data = await request(apiBase, accessToken, `/v1/users/lookup?id=${encodeURIComponent(normalizedId)}`, { auth: true }, onUpdateAccessToken);
    return data || null;
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const loadRoomDetails = useCallback(async (roomID) => {
    if (!accessToken || !roomID) {
      setRoomDetails(null);
      return;
    }
    try {
      const data = await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(roomID)}`, { auth: true }, onUpdateAccessToken);
      if (selectedRoomIdRef.current !== roomID) return;
      setRoomDetails(data || null);
    } catch {
      if (selectedRoomIdRef.current !== roomID) return;
      setRoomDetails(null);
    }
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const loadMessages = useCallback(async (roomID, { silent = false } = {}) => {
    if (!accessToken || !roomID) {
      setMessages([]);
      return;
    }
    const container = messagesContainerRef.current;
    if (container) {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (scrollModeRef.current === 'bottom' || distanceToBottom < 72) {
        scrollModeRef.current = 'bottom';
      } else {
        scrollModeRef.current = 'keep';
        preservedScrollTopRef.current = container.scrollTop;
      }
    }
    if (!silent) {
      setIsLoadingMessages(true);
    }
    try {
      const data = await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(roomID)}/messages?limit=100&offset=0`, { auth: true }, onUpdateAccessToken);
      if (selectedRoomIdRef.current !== roomID) return;
      const nextMessages = Array.isArray(data.items) ? data.items : [];
      setMessages((current) => (sameMessageList(current, nextMessages) ? current : nextMessages));
    } catch (error) {
      if (selectedRoomIdRef.current !== roomID) return;
      if (!silent) {
        showNotification(error.message || 'Не удалось загрузить сообщения', 'error');
      }
    } finally {
      if (!silent && selectedRoomIdRef.current === roomID) {
        setIsLoadingMessages(false);
      }
    }
  }, [accessToken, apiBase, onUpdateAccessToken, showNotification]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (!selectedRoomId) {
      setMessages([]);
      setRoomDetails(null);
      return;
    }
    scrollModeRef.current = 'bottom';
    void loadRoomDetails(selectedRoomId);
    void loadMessages(selectedRoomId);
  }, [selectedRoomId, loadMessages, loadRoomDetails]);

  useEffect(() => {
    if (!accessToken || !selectedRoomId) {
      return undefined;
    }
    const refreshActiveChat = () => {
      if (document.hidden || selectedRoomIdRef.current !== selectedRoomId) {
        return;
      }
      void loadMessages(selectedRoomId, { silent: true });
      void loadRooms({ silent: true });
    };
    const timer = window.setInterval(refreshActiveChat, 2500);
    window.addEventListener('focus', refreshActiveChat);
    document.addEventListener('visibilitychange', refreshActiveChat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshActiveChat);
      document.removeEventListener('visibilitychange', refreshActiveChat);
    };
  }, [accessToken, loadMessages, loadRooms, selectedRoomId]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const mode = scrollModeRef.current;
    requestAnimationFrame(() => {
      if (mode === 'bottom') {
        container.scrollTop = container.scrollHeight;
      } else if (mode === 'keep') {
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.min(preservedScrollTopRef.current, maxScrollTop);
      }
      scrollModeRef.current = 'none';
    });
  }, [messages, selectedRoomId]);

  useEffect(() => {
    if (!accessToken) {
      setUserDirectory({});
      return;
    }
    const ids = new Set();
    rooms.forEach((room) => {
      (room?.participantIds || []).forEach((id) => {
        if (id && id !== profile?.id && !userDirectory[id]) {
          ids.add(id);
        }
      });
    });
    (roomDetails?.participantIds || []).forEach((id) => {
      if (id && id !== profile?.id && !userDirectory[id]) {
        ids.add(id);
      }
    });
    messages.forEach((message) => {
      if (message?.senderUserId && message.senderUserId !== profile?.id && !userDirectory[message.senderUserId]) {
        ids.add(message.senderUserId);
      }
    });
    if (ids.size === 0) {
      return;
    }

    let cancelled = false;
    const fetchUsers = async () => {
      const entries = await Promise.all(Array.from(ids).map(async (id) => {
        try {
          const user = await lookupUserById(id);
          return user?.id ? [user.id, user] : null;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      setUserDirectory((prev) => {
        const next = { ...prev };
        entries.forEach((entry) => {
          if (entry) {
            const [id, user] = entry;
            next[id] = user;
          }
        });
        return next;
      });
    };

    void fetchUsers();
    return () => {
      cancelled = true;
    };
  }, [accessToken, lookupUserById, messages, profile?.id, roomDetails, rooms]);

  const handleCreateDirectChat = async (event) => {
    event.preventDefault();
    const participantQuery = String(newRoomParticipantQuery || '').trim();
    if (!participantQuery) {
      showNotification('Введите @тег или email участника', 'error');
      return;
    }

    setIsCreatingRoom(true);
    try {
      const user = await lookupUser(participantQuery);
      if (!user?.id) {
        showNotification('Пользователь с таким тегом или email не найден', 'error');
        return;
      }
      const payload = {
        title: newRoomTitle.trim() || null,
        participantIds: [user.id]
      };
      const room = await request(apiBase, accessToken, '/v1/chats/rooms', {
        method: 'POST',
        auth: true,
        body: payload
      }, onUpdateAccessToken);

      setNewRoomTitle('');
      setNewRoomParticipantQuery('');
      showNotification('Диалог создан', 'success');
      await loadRooms();
      if (room?.id) {
        setSelectedRoomId(room.id);
      }
    } catch (error) {
      showNotification(error.message || 'Не удалось создать диалог', 'error');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!selectedRoomId) {
      showNotification('Сначала выберите чат', 'error');
      return;
    }
    const body = messageBody.trim();
    if (!body) {
      showNotification('Введите сообщение', 'error');
      return;
    }

    setIsSendingMessage(true);
    scrollModeRef.current = 'bottom';
    try {
      await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(selectedRoomId)}/messages`, {
        method: 'POST',
        auth: true,
        body: { body }
      }, onUpdateAccessToken);
      setMessageBody('');
      await loadMessages(selectedRoomId);
      await loadRooms();
    } catch (error) {
      showNotification(error.message || 'Не удалось отправить сообщение', 'error');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleMessageKeyDown = (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isSendingMessage && messageBody.trim() && selectedRoomId) {
        void handleSendMessage(event);
      }
    }
  };

  const handleAddParticipant = async (event) => {
    event.preventDefault();
    if (!selectedRoomId) {
      showNotification('Сначала выберите чат', 'error');
      return;
    }

    const query = String(addParticipantQuery || '').trim();
    if (!query) {
      showNotification('Введите @тег или email участника', 'error');
      return;
    }

    setIsAddingParticipant(true);
    try {
      const user = await lookupUser(query);
      if (!user?.id) {
        showNotification('Пользователь не найден', 'error');
        return;
      }
      await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(selectedRoomId)}/participants`, {
        method: 'POST',
        auth: true,
        body: { participantIds: [user.id] }
      }, onUpdateAccessToken);

      setAddParticipantQuery('');
      await loadRoomDetails(selectedRoomId);
      await loadRooms();
      showNotification('Участник добавлен в чат', 'success');
    } catch (error) {
        const errMsg = String(error?.message || '').toLowerCase();
        if (/не найден|not found|not exist|not exists/.test(errMsg)) {
          showNotification('Пользователь не найден', 'error');
        } else if (/неправил|invalid|bad request|invalid tag|invalid email|invalid name/.test(errMsg)) {
          showNotification('Неправильное имя', 'error');
        } else {
          showNotification('Не удалось добавить участника', 'error');
        }
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const resolveRoomTitle = (room) => {
    if (!room) return 'Без названия';
    if (room.title && String(room.title).trim()) return room.title;
    const participantNames = (room.participantIds || roomDetails?.participantIds || [])
      .filter((id) => id && id !== profile?.id)
      .map((id) => userDirectory[id]?.name || userDirectory[id]?.tag)
      .filter(Boolean);
    if (participantNames.length > 0) {
      return participantNames.join(', ');
    }
    return 'Загружаем имена...';
  };

  const resolveUserLabel = (userId) => {
    if (!userId) return 'Неизвестно';
    if (userId === profile?.id) {
      if (profile?.name) {
        return profile?.tag ? `${profile.name} (@${profile.tag})` : profile.name;
      }
      return profile?.tag ? `@${profile.tag}` : 'Вы';
    }
    const user = userDirectory[userId];
    if (user?.tag) {
      return user.name ? `${user.name} (@${user.tag})` : `@${user.tag}`;
    }
    if (user?.name) {
      return user.name;
    }
    return 'Загружаем имя...';
  };

  const isRoomOwner = Boolean(roomDetails?.createdBy && roomDetails.createdBy === profile?.id);

  const participantItems = useMemo(() => {
    const ids = Array.isArray(roomDetails?.participantIds) ? roomDetails.participantIds : [];
    return ids.map((id) => ({
      id,
      label: resolveUserLabel(id),
      isOwner: id === roomDetails?.createdBy,
      isSelf: id === profile?.id
    }));
  }, [profile?.id, roomDetails, userDirectory]);

  const handleRemoveParticipant = async (userId) => {
    if (!selectedRoomId) {
      return;
    }
    try {
      await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(selectedRoomId)}/participants/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        auth: true
      }, onUpdateAccessToken);
      await loadRoomDetails(selectedRoomId);
      await loadMessages(selectedRoomId);
      await loadRooms();
      showNotification('Участник удален из чата', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось удалить участника', 'error');
    }
  };

  const senderAccent = (userId) => {
    const value = String(userId || 'unknown');
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 68% 62%)`;
  };

  return (
    <section className="single-page wide-page chats-page">
      <article className="pane chat-layout">
        <aside className="chat-sidebar">
          <div className="chat-sidebar-header">
            <p className="section-label">Чаты</p>
            <h3>Диалоги</h3>
          </div>

          <form className="sidebar-form compact-form" onSubmit={handleCreateDirectChat}>
            <p className="compact-subtitle">Новое личное сообщение</p>
            <label>
              <span>Собеседник (@тег или email)</span>
              <input value={newRoomParticipantQuery} onChange={(event) => setNewRoomParticipantQuery(event.target.value)} placeholder="@username или user@example.com" />
            </label>
            <label>
              <span>Название чата (необязательно)</span>
              <input value={newRoomTitle} onChange={(event) => setNewRoomTitle(event.target.value)} placeholder="Например: Дизайн" />
            </label>
            <button type="submit" className="compact-btn" disabled={isCreatingRoom || !newRoomParticipantQuery.trim()}>
              {isCreatingRoom ? 'Создаем...' : 'Создать диалог'}
            </button>
          </form>

          <div className="chat-room-list">
            {isLoadingRooms ? <p className="muted-caption chat-sidebar-hint">Загрузка чатов...</p> : rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                className={`chat-room-item ${selectedRoomId === room.id ? 'active' : ''}`}
                onClick={() => setSelectedRoomId(room.id)}
              >
                <strong>{resolveRoomTitle(room)}</strong>
                <span>{new Date(room.updatedAt || room.createdAt).toLocaleString()}</span>
              </button>
            ))}
            {!isLoadingRooms && rooms.length === 0 && <p className="empty-state hub-view-empty chat-sidebar-hint">Пока нет диалогов — создайте личное сообщение по тегу или email.</p>}
          </div>
        </aside>

        <div className="chat-main">
          <header className="chat-main-header">
            <div>
              <p className="section-label">Переписка</p>
              <h3>{resolveRoomTitle(selectedRoom || roomDetails)}</h3>
              <p className="muted-caption">Участников: {roomDetails?.participantIds?.length || 0}</p>
              {participantItems.length > 0 && (
                <div className="chat-participants-list">
                  {participantItems.map((participant) => (
                    <div key={participant.id} className={`chat-participant-chip ${participant.isOwner ? 'owner' : ''}`}>
                      <span>{participant.label}</span>
                      {participant.isOwner && <em>owner</em>}
                      {isRoomOwner && !participant.isOwner && (
                        <button
                          type="button"
                          className="ghost compact-btn chat-remove-participant-btn"
                          onClick={() => void handleRemoveParticipant(participant.id)}
                          title="Удалить участника из чата"
                          aria-label="Удалить участника"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="chat-main-actions">
              <form className="chat-add-participant-form" onSubmit={handleAddParticipant}>
                <input
                  value={addParticipantQuery}
                  onChange={(event) => setAddParticipantQuery(event.target.value)}
                  placeholder="Добавить: @тег или email"
                  disabled={!selectedRoomId || isAddingParticipant}
                />
                <button type="submit" className="compact-btn" disabled={!selectedRoomId || isAddingParticipant || !addParticipantQuery.trim()}>
                  {isAddingParticipant ? '...' : 'Добавить'}
                </button>
              </form>
              {/* Кнопка "Обновить" убрана — автoобновление активировано через таймер */}
            </div>
          </header>

          <div className="chat-messages" ref={messagesContainerRef}>
            {isLoadingMessages ? (
              <p className="empty-state hub-view-empty">Загружаем сообщения…</p>
            ) : messages.length === 0 ? (
              <p className="empty-state hub-view-empty">{selectedRoomId ? 'В этом чате пока нет сообщений.' : 'Выберите чат слева.'}</p>
            ) : messages.map((message) => {
              const isMine = message.senderUserId === profile?.id;
              const accent = senderAccent(message.senderUserId);
              const senderLabel = resolveUserLabel(message.senderUserId);
              const sentAt = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <article
                  key={message.id}
                  className={`chat-message-item ${isMine ? 'mine' : 'other'}`}
                  style={{ '--sender-accent': accent }}
                  aria-label={`${isMine ? 'Ваше сообщение' : `Сообщение от ${senderLabel}`}: ${message.body}`}
                >
                  <div className="chat-message-bubble">
                    {!isMine && (
                      <div className="chat-message-author">
                        <span className="chat-author-dot" aria-hidden="true" />
                        <strong>{senderLabel}</strong>
                      </div>
                    )}
                    <p>{message.body}</p>
                    <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>
                      {sentAt}
                    </time>
                  </div>
                </article>
              );
            })}
          </div>

          <form className="chat-message-form" onSubmit={handleSendMessage}>
            <textarea
              value={messageBody}
              onChange={(event) => setMessageBody(event.target.value)}
              onKeyDown={handleMessageKeyDown}
              placeholder={selectedRoomId ? 'Напишите сообщение...' : 'Сначала выберите чат'}
              disabled={!selectedRoomId || isSendingMessage}
              rows={3}
            />
            <div className="row">
              <button type="submit" disabled={!selectedRoomId || isSendingMessage || !messageBody.trim()}>
                {isSendingMessage ? 'Отправляем...' : 'Отправить'}
              </button>
            </div>
          </form>
        </div>
      </article>
    </section>
  );
}
