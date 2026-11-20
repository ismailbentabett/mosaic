import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import '@fontsource-variable/inter';
import './app/global.css';
import './features/settings/display';

import { AppShell } from './app/AppShell';
import { cssVariablesResolver, theme } from './app/theme';
import { session, TOKEN_MODE } from './auth';
import { initDevice, SHARE_KEY, shareText } from './device';
import { startOutbox } from './outbox';
import { applyTheme, useScheme } from './prefs';
import { net, useStore } from './store';
import { consumeSettingsHash } from './ui';
import { Boundary } from './ui/Boundary';
import { Loading } from './ui/Page';

const Login = lazy(() => import('./features/settings/Login').then((m) => ({ default: m.Login })));

// Web share target: GET /share?title=&text=&url= (the SPA fallback serves index.html).
if (location.pathname === '/share') {
  const p = new URLSearchParams(location.search);
  // Some apps put the URL inside text already; shareText avoids repeating it.
  const text = shareText([p.get('title'), p.get('text'), p.get('url')]);
  try {
    sessionStorage.setItem(SHARE_KEY, text);
  } catch {
    /* storage blocked: quick add just starts empty */
  }
  history.replaceState(null, '', '/#/capture');
}

// The Google OAuth callback `#/settings?google=…` is read once, then the URL is cleaned.
applyTheme();
consumeSettingsHash();

window.addEventListener('online', () => net.set({ online: true }));
window.addEventListener('offline', () => net.set({ online: false }));

// With a remote API the app signs in first; nothing else renders until there is a token.
function Gate() {
  const { needLogin } = useStore(session);
  if (TOKEN_MODE && needLogin) {
    return (
      <Suspense fallback={<Loading />}>
        <Login />
      </Suspense>
    );
  }
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  );
}

function Root() {
  const scheme = useScheme();
  return (
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme={scheme}>
      <DatesProvider settings={{ firstDayOfWeek: 6, weekendDays: [5, 6], consistentWeeks: true }}>
        <Notifications position="top-center" limit={3} zIndex={1000} />
        <Boundary label="Mosaic">
          <Gate />
        </Boundary>
      </DatesProvider>
    </MantineProvider>
  );
}

// Hot reload re-runs this module; reuse the first root instead of mounting twice.
const host = document.getElementById('app')! as HTMLElement & { __root?: ReturnType<typeof createRoot> };
(host.__root ??= createRoot(host)).render(<Root />);
startOutbox();
initDevice();
