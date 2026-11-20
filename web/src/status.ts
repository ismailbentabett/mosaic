import { api, asApiError, type ApiError, type StatusData } from './api';
import { createStore } from './store';

export const statusStore = createStore({
  data: null as StatusData | null,
  error: null as ApiError | null,
  loading: false,
});

let timer: ReturnType<typeof setInterval> | undefined;

export async function refreshStatus() {
  statusStore.set({ loading: true });
  try {
    statusStore.set({ data: await api.status(), error: null, loading: false });
  } catch (e) {
    statusStore.set({ error: asApiError(e), loading: false });
  }
}

export function startStatusPolling() {
  if (timer) return;
  void refreshStatus();
  timer = setInterval(() => void refreshStatus(), 120000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshStatus();
  });
  window.addEventListener('online', () => void refreshStatus());
}
