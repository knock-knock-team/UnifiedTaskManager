const STORAGE_KEY = 'vg:lastVideoCallId';

export function getLastVideoCallId() {
  try {
    return String(sessionStorage.getItem(STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setLastVideoCallId(callId) {
  const id = String(callId || '').trim();
  if (!id) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

export function clearLastVideoCallId() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
