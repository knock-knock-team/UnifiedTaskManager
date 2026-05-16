import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../lib/api';
import { normalizeURL } from '../lib/url';

export function CabinetSettings({ profile, accessToken, apiBase, showNotification, onProfileUpdate, onUpdateAccessToken }) {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: profile?.name || '',
    tag: profile?.tag || '',
    bio: profile?.bio || '',
    githubUrl: profile?.githubUrl || '',
    linkedInUrl: profile?.linkedInUrl || '',
    telegram: profile?.telegram || '',
    websiteUrl: profile?.websiteUrl || '',
    secondaryEmail: profile?.secondaryEmail || '',
    password: ''
  });
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleDiscard = () => {
    setFormData({
      name: profile?.name || '',
      tag: profile?.tag || '',
      bio: profile?.bio || '',
      githubUrl: profile?.githubUrl || '',
      linkedInUrl: profile?.linkedInUrl || '',
      telegram: profile?.telegram || '',
      websiteUrl: profile?.websiteUrl || '',
      secondaryEmail: profile?.secondaryEmail || '',
      password: ''
    });
    setIsDirty(false);
    showNotification('Изменения отменены', 'info');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {};
    if (formData.name.trim() !== (profile?.name || '')) payload.name = formData.name.trim();
    if ((formData.tag || '').trim() !== (profile?.tag || '')) payload.tag = (formData.tag || '').trim();
    if (formData.bio.trim() !== (profile?.bio || '')) payload.bio = formData.bio.trim();
    if (normalizeURL(formData.githubUrl) !== (profile?.githubUrl || '')) payload.githubUrl = normalizeURL(formData.githubUrl);
    if (normalizeURL(formData.linkedInUrl) !== (profile?.linkedInUrl || '')) payload.linkedInUrl = normalizeURL(formData.linkedInUrl);
    if (formData.telegram.trim() !== (profile?.telegram || '')) payload.telegram = formData.telegram.trim();
    if (normalizeURL(formData.websiteUrl) !== (profile?.websiteUrl || '')) payload.websiteUrl = normalizeURL(formData.websiteUrl);
    if (formData.secondaryEmail.trim().toLowerCase() !== (profile?.secondaryEmail || '')) payload.secondaryEmail = formData.secondaryEmail.trim().toLowerCase();
    if (formData.password.trim()) payload.password = formData.password.trim();

    if (Object.keys(payload).length === 0) {
      showNotification('Нет изменений для сохранения', 'info');
      return;
    }

    setIsSaving(true);
    try {
      const data = await request(apiBase, accessToken, '/v1/users/me', {
        method: 'PATCH',
        auth: true,
        body: payload
      }, onUpdateAccessToken);
      showNotification('Профиль успешно обновлён', 'success');
      onProfileUpdate(data);
      setTimeout(() => navigate('/cabinet', { replace: true }), 1000);
    } catch (error) {
      showNotification(error.message || 'Ошибка при сохранении профиля', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="single-page wide-page">
      <article className="pane cabinet-page">
        <div className="cabinet-toolbar">
          <button type="button" className="link-chip" onClick={() => navigate('/cabinet')}>Профиль</button>
          <button type="button" className="link-chip active">Настройки профиля {isDirty && <span className="unsaved-indicator">*</span>}</button>
        </div>

        <div className="cabinet-content">
          <p className="section-label">НАСТРОЙКИ ПРОФИЛЯ</p>
          <h2>Изменить профиль</h2>
          <p className="section-text">Основную почту менять нельзя. Можно добавить тег для поиска, дополнительную почту и ссылки на публичные профили.</p>
          <form onSubmit={handleSubmit} className="settings-form profile-form">
            <div className="profile-form-grid">
              <label>
                <span>Имя</span>
                <input value={formData.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="Новое имя" />
              </label>
              <label>
                <span>Тег</span>
                <input value={formData.tag} onChange={(e) => handleChange('tag', e.target.value)} placeholder="@yourtag" />
              </label>
              <label>
                <span>Дополнительная почта</span>
                <input value={formData.secondaryEmail} onChange={(e) => handleChange('secondaryEmail', e.target.value)} type="email" placeholder="second.email@example.com" />
              </label>
              <label>
                <span>GitHub</span>
                <input value={formData.githubUrl} onChange={(e) => handleChange('githubUrl', e.target.value)} placeholder="https://github.com/username" />
              </label>
              <label>
                <span>LinkedIn</span>
                <input value={formData.linkedInUrl} onChange={(e) => handleChange('linkedInUrl', e.target.value)} placeholder="https://www.linkedin.com/in/username" />
              </label>
              <label>
                <span>Telegram</span>
                <input value={formData.telegram} onChange={(e) => handleChange('telegram', e.target.value)} placeholder="@username или https://t.me/username" />
              </label>
              <label>
                <span>Сайт или портфолио</span>
                <input value={formData.websiteUrl} onChange={(e) => handleChange('websiteUrl', e.target.value)} placeholder="https://example.com" />
              </label>
              <label className="profile-bio-field">
                <span>О себе</span>
                <textarea value={formData.bio} onChange={(e) => handleChange('bio', e.target.value)} placeholder="Коротко о себе, роли, опыте, интересах" rows={5} />
              </label>
              <label>
                <span>Новый пароль</span>
                <input value={formData.password} onChange={(e) => handleChange('password', e.target.value)} type="password" minLength={8} placeholder="Оставьте пустым, если не меняете пароль" />
              </label>
            </div>
            <div className="row">
              <button type="submit" disabled={!isDirty || isSaving}>{isSaving ? 'Сохраняется...' : `Сохранить изменения ${isDirty ? '*' : ''}`}</button>
              <button type="button" className="ghost" disabled={!isDirty} onClick={handleDiscard}>Отменить изменения</button>
              <button type="button" className="ghost" onClick={() => navigate('/cabinet')}>Назад к профилю</button>
            </div>
          </form>
        </div>
      </article>
    </section>
  );
}
