import type { VoiceLang } from '../../prefs';

/** Voice languages with a short sample for the Test button. */
export const LANGS: { id: VoiceLang; name: string; sample: string }[] = [
  { id: 'en-US', name: 'English', sample: 'Next: open the project doc.' },
  { id: 'fr-FR', name: 'Français', sample: 'Ensuite : ouvrir le document du projet.' },
  { id: 'ar-SA', name: 'العربية', sample: 'التالي: افتح ملف المشروع.' },
];
