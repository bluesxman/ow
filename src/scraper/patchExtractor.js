(function patchVersion() {
  var headings = Array.from(document.querySelectorAll('h1,h2,h3'));
  for (var i = 0; i < headings.length; i++) {
    var t = ((headings[i].textContent || '') + '').trim();
    // Look for a date-bearing heading (e.g., "April 14, 2026 Patch Notes" or "Season 18: …").
    if (t.length > 8 && t.length < 80 && /(\b\d{4}\b|season\s+\d+)/i.test(t) && !/^patch\s+notes$/i.test(t)) {
      return t;
    }
  }
  // Fallback: any <time datetime>.
  var timeEl = document.querySelector('time[datetime]');
  if (timeEl) {
    var dt = timeEl.getAttribute('datetime');
    if (dt) return dt;
  }
  return '';
})()
