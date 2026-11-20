// Notes: the Obsidian vault. List + search, one note (read, edit, append under today's heading),
// and Syncthing conflicts. Routes: /brain/notes, /brain/notes/<path…>, note?path= / note?wiki=, conflicts.
// Desktop: picking a note in the list opens it beside the list.
import { Route, Routes } from 'react-router-dom';
import { Conflicts } from './notes/Conflicts';
import { NoteRedirect, NoteView } from './notes/NoteView';
import { NotesList } from './notes/NotesList';

export function NotesScreen() {
  return (
    <Routes>
      <Route index element={<NotesList />} />
      <Route path="conflicts" element={<Conflicts />} />
      <Route path="note" element={<NoteRedirect />} />
      <Route path="*" element={<NoteView />} />
    </Routes>
  );
}
