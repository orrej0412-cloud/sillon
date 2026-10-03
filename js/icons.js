const S = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const F = d => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d}</svg>`;

const HEART = 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z';
const REPEAT = '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>';

const ICONS = {
  play: F('<path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.8-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/>'),
  pause: F('<rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/>'),
  next: F('<path d="M5 5.5v13a1 1 0 0 0 1.55.83L16 13v5a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v5L6.55 4.67A1 1 0 0 0 5 5.5z"/>'),
  prev: F('<path d="M19 5.5v13a1 1 0 0 1-1.55.83L8 13v5a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5l9.45-6.33A1 1 0 0 1 19 5.5z"/>'),
  shuffle: S('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'),
  repeat: S(REPEAT),
  'repeat-one': S(REPEAT + '<path d="M11 10h1v4"/>'),
  heart: S(`<path d="${HEART}"/>`),
  'heart-fill': `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="${HEART}"/></svg>`,
  home: S('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>'),
  library: S('<path d="M4 4v16"/><path d="M9 4v16"/><path d="m14 4.5 5.5 15"/>'),
  playlist: S('<path d="M3 6h12"/><path d="M3 12h12"/><path d="M3 18h7"/><circle cx="17" cy="18" r="3"/><path d="M20 18V6l2-1"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  more: F('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>'),
  close: S('<path d="M18 6 6 18M6 6l12 12"/>'),
  down: S('<path d="m6 9 6 6 6-6"/>'),
  back: S('<path d="m15 18-6-6 6-6"/>'),
  chevron: S('<path d="m9 18 6-6-6-6"/>'),
  volume: S('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
  mute: S('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  queue: S('<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h11"/>'),
  'next-up': S('<path d="M3 6h11"/><path d="M3 12h7"/><path d="M3 18h7"/><path d="m15 12 6 4.5-6 4.5z"/>'),
  upload: S('<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>'),
  folder: S('<path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-3H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1z"/>'),
  trash: S('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
  edit: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  note: S('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  'list-plus': S('<path d="M3 6h12"/><path d="M3 12h12"/><path d="M3 18h7"/><path d="M18 13v8"/><path d="M14 17h8"/>'),
  minus: S('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
  disc: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>'),
  user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  restart: S('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  check: S('<path d="m5 12 5 5L20 7"/>'),
};

export const icon = name => ICONS[name] || '';
