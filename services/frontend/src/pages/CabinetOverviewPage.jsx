import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, storage } from '../lib/api';
import { normalizeURL } from '../lib/url';

function isTaskDone(task) {
  if (task?.completedAt) return true;
  return String(task?.status || '').trim() === 'done';
}

function isTaskOverdue(task) {
  if (!task?.dueAt || isTaskDone(task)) return false;
  const t = new Date(task.dueAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t < Date.now();
}

export function CabinetOverviewPage({
  accessToken: cabinetAccessToken,
  apiBase: cabinetApiBase,
  taskApiBase,
  onUpdateAccessToken: cabinetUpdateAccessToken,
  profile,
  showNotification,
  onLogout
}) {
  const navigate = useNavigate();
  const [pendingInvites, setPendingInvites] = useState([]);
  const [taskStats, setTaskStats] = useState({
    loading: false,
    total: 0,
    done: 0,
    overdue: 0,
    active: 0,
    scopeLabel: ''
  });

  const loadPendingInvites = useCallback(async () => {
    if (!cabinetAccessToken) return;
    try {
      const data = await request(cabinetApiBase, cabinetAccessToken, '/v1/teams/invites', { auth: true }, cabinetUpdateAccessToken);
      setPendingInvites(Array.isArray(data.items) ? data.items : []);
    } catch {
      setPendingInvites([]);
    }
  }, [cabinetAccessToken, cabinetApiBase, cabinetUpdateAccessToken]);

  const loadTaskStats = useCallback(async () => {
    const teamId = storage.taskTeamId;
    const projectId = storage.taskProjectId;
    if (!cabinetAccessToken || !taskApiBase || !teamId || !projectId) {
      setTaskStats((prev) => ({
        ...prev,
        loading: false,
        total: 0,
        done: 0,
        overdue: 0,
        active: 0,
        scopeLabel: ''
      }));
      return;
    }
    setTaskStats((prev) => ({ ...prev, loading: true }));
    try {
      const data = await request(
        taskApiBase,
        cabinetAccessToken,
        `/v1/tasks?projectId=${encodeURIComponent(projectId)}&limit=500`,
        { auth: true, headers: { 'X-Team-Id': teamId } },
        cabinetUpdateAccessToken
      );
      const items = Array.isArray(data.items) ? data.items : [];
      let done = 0;
      let overdue = 0;
      for (const task of items) {
        if (isTaskDone(task)) done += 1;
        else if (isTaskOverdue(task)) overdue += 1;
      }
      const active = items.length - done;
      setTaskStats({
        loading: false,
        total: items.length,
        done,
        overdue,
        active,
        scopeLabel: 'Текущий проект в разделе «Задачи»'
      });
    } catch (error) {
      setTaskStats((prev) => ({ ...prev, loading: false }));
      showNotification?.(error.message || 'Не удалось загрузить статистику задач', 'error');
    }
  }, [cabinetAccessToken, cabinetUpdateAccessToken, showNotification, taskApiBase]);

  const handleAcceptInvite = async (inviteId) => {
    try {
      await request(cabinetApiBase, cabinetAccessToken, `/v1/teams/invites/${encodeURIComponent(inviteId)}/accept`, {
        method: 'POST',
        auth: true
      }, cabinetUpdateAccessToken);
      showNotification('Приглашение принято', 'success');
      await loadPendingInvites();
    } catch (error) {
      showNotification(error.message || 'Не удалось принять приглашение', 'error');
    }
  };

  useEffect(() => {
    void loadPendingInvites();
  }, [loadPendingInvites]);

  useEffect(() => {
    void loadTaskStats();
  }, [loadTaskStats]);

  return (
    <section className="single-page wide-page">
      <article className="pane cabinet-page">
        <div className="cabinet-toolbar">
          <button type="button" className="link-chip active">Профиль</button>
          <button type="button" className="link-chip" onClick={() => navigate('/cabinet/settings')}>Настройки профиля</button>
        </div>

        <div className="cabinet-content">
          <p className="section-label">ЛИЧНЫЙ КАБИНЕТ</p>
          <h2>Профиль пользователя</h2>
          {profile?.avatarUrl && <img className="profile-avatar" src={profile.avatarUrl} alt="avatar" />}
          <div className="profile-grid public-profile">
            <div className="profile-card"><span>Тег</span><strong>{profile?.tag ? `@${profile.tag}` : 'Не заполнено'}</strong></div>
            <div className="profile-card"><span>Имя</span><strong>{profile?.name || 'Не заполнено'}</strong></div>
            <div className="profile-card"><span>Email</span><strong>{profile?.email || 'Не заполнено'}</strong></div>
            <div className="profile-card"><span>Доп. почта</span><strong>{profile?.secondaryEmail || 'Не заполнено'}</strong></div>
            <div className="profile-card">
              <span>GitHub</span>
              {profile?.githubUrl ? <a className="profile-link" href={normalizeURL(profile.githubUrl)} target="_blank" rel="noreferrer">{profile.githubUrl}</a> : <strong>Не заполнено</strong>}
            </div>
            <div className="profile-card">
              <span>LinkedIn</span>
              {profile?.linkedInUrl ? <a className="profile-link" href={normalizeURL(profile.linkedInUrl)} target="_blank" rel="noreferrer">{profile.linkedInUrl}</a> : <strong>Не заполнено</strong>}
            </div>
            <div className="profile-card">
              <span>Telegram</span>
              <strong>{profile?.telegram || 'Не заполнено'}</strong>
            </div>
            <div className="profile-card">
              <span>Сайт</span>
              {profile?.websiteUrl ? <a className="profile-link" href={normalizeURL(profile.websiteUrl)} target="_blank" rel="noreferrer">{profile.websiteUrl}</a> : <strong>Не заполнено</strong>}
            </div>
            <div className="profile-card profile-card-wide"><span>О себе</span><strong>{profile?.bio || 'Не заполнено'}</strong></div>
          </div>

          <div className="cabinet-invites-block">
            <p className="section-label">ЗАДАЧИ</p>
            <h3>Сводка по доске</h3>
            {taskStats.scopeLabel ? (
              <>
                <p className="muted-caption">{taskStats.scopeLabel}</p>
                <div className="cabinet-stats-grid">
                  <div className="cabinet-stat-card">
                    <span>Всего</span>
                    <strong>{taskStats.loading ? '…' : taskStats.total}</strong>
                  </div>
                  <div className="cabinet-stat-card">
                    <span>В работе</span>
                    <strong>{taskStats.loading ? '…' : Math.max(0, taskStats.active - taskStats.overdue)}</strong>
                  </div>
                  <div className="cabinet-stat-card">
                    <span>Просрочено</span>
                    <strong>{taskStats.loading ? '…' : taskStats.overdue}</strong>
                  </div>
                  <div className="cabinet-stat-card">
                    <span>Завершено</span>
                    <strong>{taskStats.loading ? '…' : taskStats.done}</strong>
                  </div>
                </div>
                <p className="muted-caption">Чтобы обновить цифры, выберите команду и проект на странице «Задачи», затем вернитесь в кабинет.</p>
              </>
            ) : (
              <p className="muted-caption">Откройте раздел «Задачи», выберите команду и проект — здесь появится статистика по карточкам.</p>
            )}
          </div>

          <div className="cabinet-invites-block">
            <p className="section-label">ПРИГЛАШЕНИЯ</p>
            <h3>Входящие приглашения</h3>
            {pendingInvites.length === 0 ? <p className="muted-caption">Нет приглашений</p> : pendingInvites.map((invite) => (
              <div key={invite.id} className="sidebar-inline-row compact-row">
                <span className="compact-meta">{invite.teamName || invite.teamId} ({invite.roleKey})</span>
                <button type="button" className="compact-btn" onClick={() => void handleAcceptInvite(invite.id)}>Принять</button>
              </div>
            ))}
          </div>

          <p className="muted-caption">Тему интерфейса (светлая / тёмная) можно переключить в настройках профиля.</p>

          <div className="row">
            <button type="button" className="ghost" onClick={() => navigate('/cabinet/settings')}>Открыть настройки профиля</button>
            <button type="button" className="ghost" onClick={onLogout}>Выйти</button>
          </div>
        </div>
      </article>
    </section>
  );
}
