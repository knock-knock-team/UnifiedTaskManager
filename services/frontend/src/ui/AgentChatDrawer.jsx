import React, { useEffect, useMemo, useRef, useState } from 'react';
import { storage } from '../lib/api';


function buildRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseSseBlocks(chunkBuffer) {
  const parts = chunkBuffer.split('\n\n');
  return {
    blocks: parts.slice(0, -1),
    rest: parts.at(-1) || ''
  };
}

function formatAssistantError(message) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'Не удалось завершить запрос.';
  if (lower.includes('upstream unavailable') || lower.includes('lookup ml-service')) {
    return 'AI сервис сейчас недоступен. Проверьте, что `ml-service` и `api-gateway` запущены и пересозданы после обновления.';
  }
  return text;
}

const TASK_MUTATION_TOOLS = new Set([
  'create_task_column',
  'update_task_column',
  'delete_task_column',
  'create_task',
  'update_task',
  'delete_task',
  'change_task_status',
  'change_task_description',
  'attach_file_to_task',
  'detach_file_from_task'
]);

function getHistoryStorageKey(scope) {
  const teamId = String(scope?.teamId || '').trim();
  const projectId = String(scope?.projectId || '').trim();
  if (!teamId || !projectId) return '';
  return `agentDrawerHistory:${teamId}:${projectId}`;
}

export function AgentChatDrawer({ apiBase, accessToken, isAuthorized, showNotification, onUpdateAccessToken }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState('');
  const [scope, setScope] = useState({
    teamId: storage.taskTeamId,
    teamName: storage.taskTeamName,
    projectId: storage.taskProjectId,
    projectName: storage.taskProjectName
  });
  const messagesRef = useRef(null);

  useEffect(() => {
    if (!isAuthorized) {
      setIsOpen(false);
      setMessages([]);
      setDraft('');
      setIsStreaming(false);
      setStreamStatus('');
      return undefined;
    }
    const syncScope = () => {
      setScope({
        teamId: storage.taskTeamId,
        teamName: storage.taskTeamName,
        projectId: storage.taskProjectId,
        projectName: storage.taskProjectName
      });
    };
    syncScope();
    const timer = setInterval(syncScope, 800);
    return () => clearInterval(timer);
  }, [isAuthorized]);

  useEffect(() => {
    if (!isAuthorized) return;
    const key = getHistoryStorageKey(scope);
    if (!key) {
      setMessages([]);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      setMessages(Array.isArray(parsed) ? parsed : []);
    } catch {
      setMessages([]);
    }
  }, [isAuthorized, scope.projectId, scope.teamId]);

  useEffect(() => {
    if (!isAuthorized) return;
    const key = getHistoryStorageKey(scope);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(messages.slice(-100)));
    } catch {
      // ignore storage overflow or serialization issues
    }
  }, [isAuthorized, messages, scope.projectId, scope.teamId]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, streamStatus]);

  const canSend = useMemo(() => {
    return Boolean(
      isAuthorized
      && accessToken
      && draft.trim()
      && scope.teamId
      && scope.projectId
      && !isStreaming
    );
  }, [accessToken, draft, isAuthorized, isStreaming, scope.projectId, scope.teamId]);

  function updateAssistantMessage(messageId, updater) {
    setMessages((current) => current.map((item) => {
      if (item.id !== messageId) return item;
      return {
        ...item,
        ...updater(item)
      };
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isStreaming) return;
    if (!scope.teamId || !scope.projectId) {
      showNotification('Сначала выберите команду и проект на странице задач или файлов.', 'error');
      return;
    }

    const userMessage = { id: buildRequestId(), role: 'user', content: prompt };
    const assistantId = buildRequestId();
    setDraft('');
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', pending: true }
    ]);
    setIsOpen(true);
    setIsStreaming(true);
    setStreamStatus('Думаю...');

    try {
      const response = await fetch(`${apiBase}/api/tasks/assistant/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          request_id: buildRequestId(),
          message: prompt,
          team_id: scope.teamId,
          project_id: scope.projectId,
          include_capabilities: false
        })
      });

      if (response.status === 401) {
        onUpdateAccessToken?.(null);
        throw new Error('Сессия истекла. Пожалуйста, авторизируйтесь снова.');
      }

      if (!response.ok || !response.body) {
        let errorMessage = 'Не удалось получить ответ агента.';
        try {
          const data = await response.json();
          errorMessage = data.message || data.detail || errorMessage;
        } catch {
          // ignore parse failure
        }
        throw new Error(errorMessage);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let hasAssistantText = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { blocks, rest } = parseSseBlocks(buffer);
        buffer = rest;

        for (const block of blocks) {
          const dataLine = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('');
          if (!dataLine) continue;
          let payload = null;
          try {
            payload = JSON.parse(dataLine);
          } catch {
            continue;
          }
          if (payload.type === 'token') {
            hasAssistantText = true;
            updateAssistantMessage(assistantId, (item) => ({
              content: `${item.content || ''}${payload.text || ''}`,
              pending: false
            }));
          } else if (payload.type === 'status') {
            setStreamStatus(payload.text || 'Думаю...');
          } else if (payload.type === 'tool_start') {
            setStreamStatus(`Использую ${payload.tool_name || 'инструмент'}...`);
          } else if (payload.type === 'tool_end') {
            setStreamStatus(`Готово: ${payload.tool_name || 'инструмент'}`);
            if (TASK_MUTATION_TOOLS.has(String(payload.tool_name || '')) && payload.payload?.success !== false) {
              window.dispatchEvent(new CustomEvent('assistant:task-data-changed', { detail: { toolName: payload.tool_name } }));
            }
          } else if (payload.type === 'final') {
            setStreamStatus('');
            updateAssistantMessage(assistantId, (item) => ({
              content: hasAssistantText ? item.content : (payload.text || item.content || ''),
              pending: false
            }));
          } else if (payload.type === 'error') {
            setStreamStatus('');
            updateAssistantMessage(assistantId, (item) => ({
              content: item.content || payload.text || 'Не удалось завершить запрос.',
              pending: false,
              error: true
            }));
            if (payload.text) {
              showNotification(formatAssistantError(payload.text), 'error');
            }
          }
        }
      }

      updateAssistantMessage(assistantId, () => ({ pending: false }));
    } catch (error) {
      const formattedError = formatAssistantError(error.message);
      updateAssistantMessage(assistantId, (item) => ({
        content: item.content || formattedError,
        pending: false,
        error: true
      }));
      showNotification(formattedError, 'error');
    } finally {
      setIsStreaming(false);
      setStreamStatus('');
    }
  }

  if (!isAuthorized) return null;

  return (
    <>
      <button
        type="button"
        className={`agent-drawer-toggle ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isOpen ? 'Скрыть агента' : 'Агент'}
      </button>

      <aside className={`agent-drawer ${isOpen ? 'open' : 'collapsed'}`}>
        <div className="agent-drawer-header">
          <div>
            <p className="section-label">AI Assistant</p>
            <strong>Помощник по задачам и файлам</strong>
            <p className="agent-drawer-scope">
              {scope.teamId && scope.projectId
                ? `Команда: ${scope.teamName || scope.teamId} · Проект: ${scope.projectName || scope.projectId}`
                : 'Контекст пока не выбран'}
            </p>
          </div>
          <button type="button" className="ghost agent-drawer-close" onClick={() => setIsOpen(false)}>
            ×
          </button>
        </div>

        <div ref={messagesRef} className="agent-drawer-messages">
          {messages.length === 0 ? (
            <div className="agent-message assistant empty">
              <p>Спросите что сделать с задачами, колонками или файлами.</p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`agent-message ${message.role} ${message.error ? 'error' : ''}`}
              >
                <div className="agent-message-role">{message.role === 'user' ? 'Вы' : 'Агент'}</div>
                <div className="agent-message-content">
                  {message.content || (message.pending ? '...' : '')}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="agent-drawer-footer">
          <div className="agent-drawer-status">
            {isStreaming ? (
              <>
                <span className="agent-status-dot" />
                <span>{streamStatus || 'Печатает...'}</span>
              </>
            ) : (
              <span>{scope.teamId && scope.projectId ? 'Готов к работе' : 'Нужно выбрать команду и проект'}</span>
            )}
          </div>

          <form className="agent-drawer-form" onSubmit={handleSubmit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Например: создай колонку «Ревью», найди задачу по дедлайну и прикрепи файл..."
              disabled={isStreaming}
            />
            <button type="submit" disabled={!canSend}>
              {isStreaming ? 'Ждём' : 'Отправить'}
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
