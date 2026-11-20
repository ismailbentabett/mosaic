import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from '../../../api';
import { usePageSearch } from '../../../hooks';
import { replace } from '../../../router';
import { Loading, Page } from '../../../ui/Page';
import { noteLink, noteTitle } from '../notesUtil';
import { NoteBody } from './NoteBody';
import { NOTES } from './paths';

// ---------- one note ----------

/** Old links: note?path= goes to the canonical URL; note?wiki= finds the file by name first. */
export function NoteRedirect() {
  const params = new URLSearchParams(usePageSearch());
  const path = params.get('path');
  const wiki = params.get('wiki');

  useEffect(() => {
    if (path && !wiki) {
      replace(noteLink(path));
      return;
    }
    if (!wiki) {
      replace(NOTES);
      return;
    }
    let cancelled = false;
    void (async () => {
      const want = wiki.replace(/\.md$/i, '');
      const file = `${want}.md`.toLowerCase();
      let p = `${want}.md`;
      try {
        const r = await api.notesSearch(want);
        const hit = r.results.find((x) => x.path.toLowerCase() === file || x.path.toLowerCase().endsWith('/' + file));
        if (hit) p = hit.path;
      } catch {
        /* fall back to the plain name */
      }
      if (!cancelled) replace(noteLink(p));
    })();
    return () => {
      cancelled = true;
    };
  }, [path, wiki]);

  return (
    <Page title="Note" back={NOTES}>
      <Loading label="Opening note" lines={4} />
    </Page>
  );
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function NoteView() {
  const { pathname } = useLocation();
  const rest = pathname.startsWith(NOTES + '/') ? pathname.slice(NOTES.length + 1) : '';
  const path = rest.split('/').filter(Boolean).map(safeDecode).join('/');
  if (!path) return <Navigate to={NOTES} replace />;
  return (
    <Page title={noteTitle(path)} back={NOTES}>
      <NoteBody key={path} path={path} />
    </Page>
  );
}
