(function listHeroes() {
  var anchors = Array.from(document.querySelectorAll('a[href*="/heroes/"]'));
  var seen = {};
  var out = [];
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    var href = a.getAttribute('href') || '';
    var url;
    try {
      url = new URL(href, document.baseURI);
    } catch (e) {
      continue;
    }
    var m = url.pathname.match(/\/heroes\/([^/]+)\/?$/);
    if (!m) continue;
    var tail = m[1];
    if (!tail) continue;
    if (tail.indexOf('stadium') >= 0) continue;

    var nameFromText = (a.textContent || '').trim();
    var nameFromAria = a.getAttribute('aria-label') || '';
    var imgEl = a.querySelector('img');
    var nameFromImg = imgEl ? (imgEl.getAttribute('alt') || '') : '';
    var name = '';
    var candidates = [nameFromText, nameFromAria, nameFromImg];
    for (var j = 0; j < candidates.length; j++) {
      if (candidates[j] && candidates[j].length > 0 && candidates[j].length < 80) {
        name = candidates[j];
        break;
      }
    }
    if (!name) name = tail;
    var portrait = imgEl ? (imgEl.getAttribute('src') || null) : null;

    if (!seen[tail]) {
      seen[tail] = true;
      out.push({ slug: tail, name: name, role: null, portrait: portrait });
    }
  }
  return out;
})()
