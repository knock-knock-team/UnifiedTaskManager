import React, { useEffect, useMemo, useState } from 'react';

export function FileEnvironments({ apiBase, accessToken, onUpdateAccessToken, showNotification, requestFn }) {
  const [environments, setEnvironments] = useState([]);
  const [selectedEnvironmentKey, setSelectedEnvironmentKey] = useState('');
  const [isLoadingEnvironments, setIsLoadingEnvironments] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [selectedEntryPath, setSelectedEntryPath] = useState('');
  const [uploadTargetDirectory, setUploadTargetDirectory] = useState('.');
  const [fileToUpload, setFileToUpload] = useState(null);
  const [environmentInfo, setEnvironmentInfo] = useState(null);
  const [memberNamesById, setMemberNamesById] = useState({});
  const [directoryItemsByPath, setDirectoryItemsByPath] = useState({ '.': [] });
  const [loadedDirectoryPaths, setLoadedDirectoryPaths] = useState({ '.': false });
  const [isBusy, setIsBusy] = useState(false);
  const [openEntryMenuPath, setOpenEntryMenuPath] = useState('');
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useState({ '.': true });
  function formatFileError(error, fallbackMessage) {
    const raw = String(error?.message || '').trim();
    const lower = raw.toLowerCase();
    if (
      lower.includes('upstream unavailable')
      || lower.includes('dial tcp')
      || lower.includes('lookup file-service')
      || lower.includes('lookup file service')
    ) {
      return 'Файловый сервис сейчас недоступен. Проверьте, что сервис запущен, и попробуйте снова.';
    }
    if (lower.includes('unauthorized') || lower.includes('session')) {
      return 'Сессия истекла. Пожалуйста, войдите снова.';
    }
    return raw || fallbackMessage;
  }


  const selectedEnvironment = environments.find((item) => item.key === selectedEnvironmentKey) || null;
  const loadedEntries = useMemo(
    () => Object.values(directoryItemsByPath).flatMap((items) => (Array.isArray(items) ? items : [])),
    [directoryItemsByPath]
  );

  function getSelectedScope() {
    if (!selectedEnvironment) {
      showNotification('Выберите файловую среду из списка', 'error');
      return null;
    }
    return selectedEnvironment;
  }

  async function ensureAndOpenEnvironment(scope, targetDirectory = '.') {
    if (!scope) return;
    setIsBusy(true);
    try {
      const data = await requestFn(
        apiBase,
        accessToken,
        '/v1/file-environments/ensure',
        {
          method: 'POST',
          auth: true,
          body: {
            team_id: scope.teamId,
            project_id: scope.projectId
          }
        },
        onUpdateAccessToken
      );
      setEnvironmentInfo(data);
      await refreshEntries(scope.teamId, scope.projectId, targetDirectory);
    } catch (error) {
      showNotification(formatFileError(error, 'Не удалось получить среду'), 'error');
    } finally {
      setIsBusy(false);
    }
  }

  async function loadAvailableEnvironments() {
    if (!accessToken) return;
    setIsLoadingEnvironments(true);
    try {
      const teamsResponse = await requestFn(apiBase, accessToken, '/v1/teams', { auth: true }, onUpdateAccessToken);
      const teams = Array.isArray(teamsResponse.items) ? teamsResponse.items : [];
      const resolved = [];

      for (const team of teams) {
        const projectsResponse = await requestFn(
          apiBase,
          accessToken,
          `/v1/teams/${team.id}/projects`,
          { auth: true },
          onUpdateAccessToken
        );
        const projects = Array.isArray(projectsResponse.items) ? projectsResponse.items : [];
        for (const project of projects) {
          resolved.push({
            key: `${team.id}::${project.id}`,
            teamId: team.id,
            teamName: team.name || team.id,
            projectId: project.id,
            projectName: project.name || project.id
          });
        }
      }

      setEnvironments(resolved);

      if (resolved.length === 0) {
        setSelectedEnvironmentKey('');
        setEnvironmentInfo(null);
        setDirectoryItemsByPath({ '.': [] });
        setLoadedDirectoryPaths({ '.': false });
        return;
      }

      const savedTeam = localStorage.getItem('taskTeamId') || '';
      const savedProject = localStorage.getItem('taskProjectId') || '';
      const preferredKey = `${savedTeam}::${savedProject}`;
      const hasPreferred = resolved.some((item) => item.key === preferredKey);
      const nextKey = hasPreferred ? preferredKey : resolved[0].key;
      setSelectedEnvironmentKey(nextKey);
    } catch (error) {
      showNotification(formatFileError(error, 'Не удалось загрузить команды и проекты'), 'error');
      setEnvironments([]);
      setSelectedEnvironmentKey('');
      setEnvironmentInfo(null);
      setDirectoryItemsByPath({ '.': [] });
      setLoadedDirectoryPaths({ '.': false });
    } finally {
      setIsLoadingEnvironments(false);
    }
  }

  useEffect(() => {
    void loadAvailableEnvironments();
  }, [accessToken]);

  useEffect(() => {
    if (!selectedEnvironment) return;
    localStorage.setItem('taskTeamId', selectedEnvironment.teamId);
    localStorage.setItem('taskProjectId', selectedEnvironment.projectId);
    void ensureAndOpenEnvironment(selectedEnvironment, '.');
  }, [selectedEnvironmentKey]);

  useEffect(() => {
    if (!selectedEnvironment) {
      setEnvironmentInfo(null);
      setMemberNamesById({});
      setSelectedEntryPath('');
      setNewFolderPath('');
      setDirectoryItemsByPath({ '.': [] });
      setLoadedDirectoryPaths({ '.': false });
    }
  }, [selectedEnvironment]);

  useEffect(() => {
    async function loadMemberNames() {
      const memberIds = Array.isArray(environmentInfo?.member_user_ids) ? environmentInfo.member_user_ids : [];
      if (memberIds.length === 0) {
        setMemberNamesById({});
        return;
      }
      try {
        const uniqueIds = [...new Set(memberIds.map((id) => String(id || '').trim()).filter(Boolean))];
        const resolved = await Promise.all(uniqueIds.map(async (id) => {
          const profile = await requestFn(
            apiBase,
            accessToken,
            `/v1/users/lookup?id=${encodeURIComponent(id)}`,
            { auth: true },
            onUpdateAccessToken
          );
          const displayName = String(profile?.name || profile?.tag || profile?.email || id).trim() || id;
          return [id, displayName];
        }));
        setMemberNamesById(Object.fromEntries(resolved));
      } catch {
        setMemberNamesById({});
      }
    }

    void loadMemberNames();
  }, [environmentInfo, apiBase, accessToken, onUpdateAccessToken, requestFn]);

  async function refreshCurrentEntries(targetDirectory = uploadTargetDirectory || '.') {
    const scope = getSelectedScope();
    if (!scope) return;
    setIsBusy(true);
    try {
      await refreshEntries(scope.teamId, scope.projectId, targetDirectory);
    } catch (error) {
      showNotification(formatFileError(error, 'Не удалось обновить список'), 'error');
    } finally {
      setIsBusy(false);
    }
  }

  async function createFolder() {
    const scope = getSelectedScope();
    if (!scope || !newFolderPath.trim()) return;
    setIsBusy(true);
    try {
      await requestFn(apiBase, accessToken, '/v1/file-environments/folders', {
        method: 'POST',
        auth: true,
        body: { team_id: scope.teamId, project_id: scope.projectId, path: newFolderPath.trim() }
      }, onUpdateAccessToken);
      await refreshEntries(scope.teamId, scope.projectId, '.');
      setNewFolderPath('');
      showNotification('Папка создана', 'success');
    } catch (error) {
      showNotification(formatFileError(error, 'Не удалось создать папку'), 'error');
    } finally {
      setIsBusy(false);
    }
  }

  async function uploadFile() {
    const scope = getSelectedScope();
    if (!scope || !fileToUpload) return;
    const form = new FormData();
    form.append('file', fileToUpload);
    setIsBusy(true);
    try {
      const response = await fetch(
        `${apiBase}/v1/file-environments/files?team_id=${encodeURIComponent(scope.teamId)}&project_id=${encodeURIComponent(scope.projectId)}&directory=${encodeURIComponent(uploadTargetDirectory || '.')}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          body: form
        }
      );
      if (response.status === 401) {
        onUpdateAccessToken(null);
        throw new Error('Сессия истекла');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      const targetDirectory = uploadTargetDirectory || '.';
      await refreshEntries(scope.teamId, scope.projectId, targetDirectory);
      if (targetDirectory !== '.') {
        await refreshEntries(scope.teamId, scope.projectId, '.');
      }
      showNotification(`Файл загружен: ${data.path || fileToUpload.name}`, 'success');
      setFileToUpload(null);
    } catch (error) {
      showNotification(formatFileError(error, 'Не удалось загрузить файл'), 'error');
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteEntry(targetPath = selectedEntryPath) {
    const scope = getSelectedScope();
    if (!scope || !targetPath) return;
    setIsBusy(true);
    try {
      await requestFn(apiBase, accessToken, '/v1/file-environments/entries', {
        method: 'DELETE',
        auth: true,
        body: { team_id: scope.teamId, project_id: scope.projectId, path: targetPath }
      }, onUpdateAccessToken);
      const parentDirectory = getParentPath(targetPath);
      await refreshEntries(scope.teamId, scope.projectId, parentDirectory);
      if (parentDirectory !== '.') {
        await refreshEntries(scope.teamId, scope.projectId, '.');
      }
      if (targetPath === selectedEntryPath) {
        setSelectedEntryPath('');
      }
      if (targetPath === openEntryMenuPath) {
        setOpenEntryMenuPath('');
      }
      showNotification('Файл/папка удалены', 'success');
    } catch (error) {
      showNotification(formatFileError(error, 'Не удалось удалить запись'), 'error');
    } finally {
      setIsBusy(false);
    }
  }

  async function downloadFile(targetPath = selectedEntryPath) {
    const scope = getSelectedScope();
    if (!scope || !targetPath) return;
    const url = `${apiBase}/v1/file-environments/files/download?team_id=${encodeURIComponent(scope.teamId)}&project_id=${encodeURIComponent(scope.projectId)}&path=${encodeURIComponent(targetPath)}`;
    setIsBusy(true);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = targetPath.split('/').pop() || 'file.bin';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      showNotification(formatFileError(error, 'Не удалось скачать файл'), 'error');
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshEntries(team, project, dir) {
    const data = await requestFn(
      apiBase,
      accessToken,
      `/v1/file-environments/entries?team_id=${encodeURIComponent(team)}&project_id=${encodeURIComponent(project)}&directory=${encodeURIComponent(dir || '.')}`,
      { auth: true },
      onUpdateAccessToken
    );
    const nextEntries = Array.isArray(data.items) ? data.items : [];
    const normalizedDirectory = String(dir || '.').trim() || '.';
    setDirectoryItemsByPath((prev) => ({ ...prev, [normalizedDirectory]: nextEntries }));
    setLoadedDirectoryPaths((prev) => ({ ...prev, [normalizedDirectory]: true }));
    setSelectedEntryPath((current) => {
      if (!current) return '';
      const existsInUpdated = Object.entries({ ...directoryItemsByPath, [normalizedDirectory]: nextEntries })
        .flatMap(([, items]) => (Array.isArray(items) ? items : []))
        .some((entry) => entry.path === current);
      return existsInUpdated ? current : '';
    });
    setOpenEntryMenuPath((current) => {
      if (!current) return '';
      const existsInUpdated = Object.entries({ ...directoryItemsByPath, [normalizedDirectory]: nextEntries })
        .flatMap(([, items]) => (Array.isArray(items) ? items : []))
        .some((entry) => entry.path === current);
      return existsInUpdated ? current : '';
    });
  }

  function getParentPath(value) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized === '.') return '.';
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 1) return '.';
    return parts.slice(0, -1).join('/');
  }

  const selectedEntry = loadedEntries.find((entry) => entry.path === selectedEntryPath) || null;
  const availableUploadFolders = ['.', ...Array.from(new Set(loadedEntries.filter((entry) => entry.kind === 'directory').map((entry) => entry.path)))];
  const fileTreeNodes = useMemo(() => {
    const rootItems = Array.isArray(directoryItemsByPath['.']) ? directoryItemsByPath['.'] : [];
    return [...rootItems].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }
      return String(left.path || '').localeCompare(String(right.path || ''));
    });
  }, [directoryItemsByPath]);

  useEffect(() => {
    const directoryPaths = loadedEntries
      .filter((entry) => entry.kind === 'directory')
      .map((entry) => String(entry.path || '').trim())
      .filter(Boolean);
    setExpandedDirectoryPaths((prev) => {
      const next = { ...prev };
      directoryPaths.forEach((path) => {
        if (!(path in next)) {
          next[path] = true;
        }
      });
      return next;
    });
  }, [loadedEntries]);

  async function expandDirectory(path) {
    const normalized = String(path || '.').trim() || '.';
    setExpandedDirectoryPaths((prev) => ({ ...prev, [normalized]: !prev[normalized] }));
    const shouldLoad = !loadedDirectoryPaths[normalized];
    if (!shouldLoad) return;
    const scope = getSelectedScope();
    if (!scope) return;
    setIsBusy(true);
    try {
      await refreshEntries(scope.teamId, scope.projectId, normalized);
    } catch (error) {
      showNotification(formatFileError(error, 'Не удалось загрузить содержимое папки'), 'error');
    } finally {
      setIsBusy(false);
    }
  }

  function renderTreeNode(node, depth = 0) {
    const isDirectory = node.kind === 'directory';
    const isExpanded = isDirectory ? Boolean(expandedDirectoryPaths[node.path]) : false;
    const canShowActions = true;
    const canSelect = true;
    const childItems = isDirectory ? (directoryItemsByPath[node.path] || []) : [];
    const sortedChildItems = [...childItems].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
      return String(left.path || '').localeCompare(String(right.path || ''));
    });
    const isSelected = selectedEntryPath === node.path;
    return (
      <div key={node.path} className="file-tree-node">
        <div
          className={`file-entry-item file-tree-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          <span className="compact-meta file-entry-meta">
            {isDirectory ? (
              <button
                type="button"
                className="file-tree-toggle"
                onClick={() => void expandDirectory(node.path)}
                title={isExpanded ? 'Свернуть папку' : 'Развернуть папку'}
              >
                {isExpanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className="file-tree-leaf-dot">•</span>
            )}
            <span className="file-tree-label">
              {isDirectory ? '[Папка]' : '[Файл]'} {node.name} {!isDirectory ? `(${node.size_bytes} B)` : ''}
            </span>
          </span>
          <div className="row file-entry-actions">
            <button type="button" className="file-entry-btn" onClick={() => setSelectedEntryPath(node.path)} title="Выбрать" disabled={!canSelect}>
              Выбрать
            </button>
            {canShowActions && (
              <>
                <button
                  type="button"
                  className="file-entry-btn file-entry-menu-trigger"
                  onClick={() => setOpenEntryMenuPath((current) => (current === node.path ? '' : node.path))}
                  title="Действия"
                >
                  ...
                </button>
                {openEntryMenuPath === node.path && (
                  <div className="file-entry-menu">
                    {node.kind === 'file' && (
                      <button type="button" className="file-entry-menu-item" onClick={() => void downloadFile(node.path)}>
                        Скачать
                      </button>
                    )}
                    <button type="button" className="file-entry-menu-item danger" onClick={() => void deleteEntry(node.path)}>
                      Удалить
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {isDirectory && isExpanded && (
          <div className="file-tree-children">
            {!loadedDirectoryPaths[node.path] ? (
              <p className="muted-caption">Загрузка...</p>
            ) : sortedChildItems.length === 0 ? (
              <p className="muted-caption">Папка пуста</p>
            ) : (
              sortedChildItems.map((child) => renderTreeNode(child, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="single-page wide-page">
      <article className="pane">
        <p className="section-label">FILE SERVICE</p>
        <h2>Файлы команды и проекта</h2>
        <p className="muted-caption">Среда создается автоматически для пары команда + проект. Квота: 100MB на команду.</p>

        <div className="section-block">
          <article className="pane">
            <p className="section-label">ФАЙЛОВЫЕ СРЕДЫ</p>
            {isLoadingEnvironments ? (
              <p className="muted-caption">Загружаем команды и проекты...</p>
            ) : environments.length === 0 ? (
              <p className="muted-caption">Сейчас нет доступных команд или проектов. Когда они появятся, файловые среды создадутся автоматически.</p>
            ) : (
              <div className="file-env-grid">
                {environments.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={selectedEnvironmentKey === item.key ? 'file-env-card active' : 'file-env-card ghost'}
                    onClick={() => setSelectedEnvironmentKey(item.key)}
                    disabled={isBusy}
                  >
                    {selectedEnvironmentKey === item.key && <span className="file-env-active-badge">Активная</span>}
                    <span className="file-env-card-title">{item.teamName}</span>
                    <span className="file-env-card-subtitle">{item.projectName}</span>
                  </button>
                ))}
              </div>
            )}
          </article>
        </div>

        {environmentInfo && (
          <div className="section-block">
            <article className="pane">
              <div className="file-env-meta-grid">
                <p><strong>Среда:</strong> {selectedEnvironment?.teamName || 'Команда'} / {selectedEnvironment?.projectName || 'Проект'}</p>
                <p>
                  <strong>Участники:</strong>{' '}
                  {(environmentInfo.member_user_ids || [])
                    .map((id) => memberNamesById[String(id)] || String(id))
                    .join(', ') || 'Только вы'}
                </p>
              </div>
            </article>
          </div>
        )}

        <div className="section-block">
          <article className="pane file-controls-pane">
            <p className="section-label">ДЕЙСТВИЯ</p>
            <div className="file-controls-grid">
              <input value={newFolderPath} onChange={(event) => setNewFolderPath(event.target.value)} placeholder="Новая папка (например docs/new-folder)" />
              <label className="file-select-label">
                <span>Куда загрузить файл</span>
                <select value={uploadTargetDirectory} onChange={(event) => setUploadTargetDirectory(event.target.value)}>
                  {availableUploadFolders.map((folderPath) => (
                    <option key={folderPath} value={folderPath}>
                      {folderPath === '.' ? 'Корневая папка' : folderPath}
                    </option>
                  ))}
                </select>
              </label>

              <p className="file-selected-entry-caption">
                <strong>Выбрано:</strong> {selectedEntry
                  ? `${selectedEntry.kind === 'directory' ? 'папка' : 'файл'} ${selectedEntry.path}. Действия доступны по кнопке "..." у элемента.`
                  : 'ничего'}
              </p>

              <div className="row file-env-actions-row">
                <button type="button" className="file-action-btn file-action-btn-primary" onClick={() => void createFolder()} disabled={isBusy || !newFolderPath.trim()} title="Создать папку">
                  Создать папку
                </button>
              </div>

              <div className="row file-upload-controls">
                <label className="file-picker-label">
                  <span className="file-picker-button">Выбрать файл</span>
                  <input
                    type="file"
                    className="file-picker-input"
                    onChange={(event) => setFileToUpload(event.target.files?.[0] || null)}
                  />
                </label>
                <span className="file-picker-name">{fileToUpload?.name || 'Файл не выбран'}</span>
                <button type="button" className="file-action-btn file-action-btn-primary" onClick={() => void uploadFile()} disabled={isBusy || !fileToUpload} title="Загрузить файл в выбранный каталог">
                  Загрузить
                </button>
                <button type="button" className="file-action-btn" onClick={() => void refreshCurrentEntries(uploadTargetDirectory || '.')} disabled={isBusy} title="Обновить список файлов">
                  Обновить список
                </button>
                <button type="button" className="file-action-btn" onClick={() => void loadAvailableEnvironments()} disabled={isBusy || isLoadingEnvironments} title="Обновить список команд и проектов">
                  Обновить среды
                </button>
              </div>
            </div>
          </article>
        </div>

        <div className="section-block">
          <article className="pane">
            <p className="section-label">СОДЕРЖИМОЕ</p>
            {!selectedEnvironment ? (
              <p className="muted-caption">Выберите среду из списка</p>
            ) : fileTreeNodes.length === 0 ? (
              <p className="muted-caption">Пока пусто</p>
            ) : (
              <div className="file-entry-list file-tree-list">
                {fileTreeNodes.map((node) => renderTreeNode(node))}
              </div>
            )}
          </article>
        </div>
      </article>
    </section>
  );
}
