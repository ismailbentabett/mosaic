import { useCallback, useEffect, useState, type RefObject } from 'react';
import { type chat } from '../chat';

/** The window scrolls: follow new content at the bottom, else offer Jump to latest. */
export function useChatScroll(active: boolean, running: boolean, st: ReturnType<typeof chat.get>, nearBottom: RefObject<boolean>) {
  const [jump, setJump] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const measure = () => {
    const el = document.scrollingElement ?? document.documentElement;
    return { gap: el.scrollHeight - el.scrollTop - el.clientHeight, screen: el.clientHeight };
  };
  const toBottom = useCallback((smooth = true) => {
    nearBottom.current = true;
    setJump(false);
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const liveLen = st.live?.text.length ?? 0;
  const liveTools = st.live?.tools.length ?? 0;
  useEffect(() => {
    if (!active) return;
    if (nearBottom.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: running ? 'auto' : 'smooth' });
      return;
    }
    const m = measure();
    if (m.gap > m.screen) setJump(true);
  }, [st.messages.length, liveLen, liveTools, running, st.problem, active]);

  useEffect(() => {
    const onScroll = () => {
      const m = measure();
      nearBottom.current = m.gap < 80;
      if (nearBottom.current) setJump(false);
      setScrolled(window.scrollY > 4);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return { jump, scrolled, toBottom };
}
