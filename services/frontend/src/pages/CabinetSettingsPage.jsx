import React from 'react';
import { CabinetSettings } from './CabinetSettings';

export function CabinetSettingsPage({ profile, accessToken, apiBase, showNotification, onProfileUpdate, onUpdateAccessToken }) {
  if (!profile) {
    return (
      <section className="single-page wide-page">
        <article className="pane cabinet-page">
          <p className="section-label">?????????????????? ??????????????</p>
          <p className="section-text">?????????????????? ??????????????...</p>
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
    />
  );
}
