// The app mark: an underdamped step response (rise, overshoot, settle) on a dark tile.
// brandSvg() is DOM-free (used by scripts/make-icons.cjs); brandMark() builds the in-app logo.

let instances = 0;
/** A logo element (DOM) containing the mark. */
export function brandMark(className) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = brandSvg(`es${instances++}`);
  return el;
}

/** SVG markup for the mark. `uid` keeps gradient ids unique when several copies are inline. */
export function brandSvg(uid = 'es') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true">
  <defs>
    <linearGradient id="${uid}-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a2544"/><stop offset="1" stop-color="#0a0f1d"/>
    </linearGradient>
    <linearGradient id="${uid}-wave" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#2fd4bd"/><stop offset="0.55" stop-color="#4f8bff"/><stop offset="1" stop-color="#a77bff"/>
    </linearGradient>
    <radialGradient id="${uid}-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#5ce6d2" stop-opacity="0.6"/><stop offset="1" stop-color="#5ce6d2" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="58" fill="url(#${uid}-bg)"/>
  <rect x="9.5" y="9.5" width="237" height="237" rx="56.5" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="3"/>
  <path d="M40 90H216M40 130H216M40 170H216" stroke="#ffffff" stroke-opacity="0.06" stroke-width="3"/>
  <path d="M38 186C66 186 74 66 102 66C126 66 124 140 141 140C155 140 157 100 171 100C183 100 187 118 199 118C209 118 213 110 222 110"
        fill="none" stroke="url(#${uid}-wave)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="102" cy="66" r="42" fill="url(#${uid}-glow)"/>
  <circle cx="102" cy="66" r="13" fill="#ffffff"/>
</svg>`;
}
