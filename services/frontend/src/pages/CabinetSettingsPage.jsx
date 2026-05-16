import React from 'react';
import { CabinetSettings } from './CabinetSettings';

export function CabinetSettingsPage({ profile, accessToken, apiBase, showNotification, onProfileUpdate, onUpdateAccessToken, uiTheme, setUiTheme }) {
  if (!profile) {
    return (
      <section className="single-page wide-page">
        <article className="pane cabinet-page">
          <p className="section-label">НАСТРОЙКИ</p>
          <p className="section-text">Загрузка профиля...</p>
        </article>
      </section>
    );
  }

  return (
    <CabinetSettings
      profile={profile}
      accessToken={accessToken}
      apiBase={apiBase}
      showNotification={showNotification}
      onProfileUpdate={onProfileUpdate}
      onUpdateAccessToken={onUpdateAccessToken}
      uiTheme={uiTheme}
      setUiTheme={setUiTheme}
    />
  );
}
