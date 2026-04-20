// Pure browser-side extractor. Loaded as a string and run in page context via page.evaluate.
// MUST be plain JS with no TS or build-tool transforms — esbuild/tsx inject __name() calls
// for arrow functions / const declarations that don't exist in the browser context.
(function listHeroes() {
  function pickName(a) {
    var imgEl = a.querySelector ? a.querySelector('img') : null;
    var nameFromText = (a.textContent || '').trim();
    var nameFromAria = a.getAttribute('aria-label') || '';
    var nameFromImg = imgEl ? (imgEl.getAttribute('alt') || '') : '';
    var candidates = [nameFromText, nameFromAria, nameFromImg];
    for (var j = 0; j < candidates.length; j++) {
      if (candidates[j] && candidates[j].length > 0 && candidates[j].length < 80) {
        return candidates[j];
      }
    }
    return '';
  }

  function pickPortrait(a) {
    var imgEl = a.querySelector ? a.querySelector('img') : null;
    return imgEl ? (imgEl.getAttribute('src') || null) : null;
  }

  function fromHeroCards() {
    var cards = Array.from(document.querySelectorAll('a.hero-card[data-role]'));
    var seen = {};
    var out = [];
    for (var i = 0; i < cards.length; i++) {
      var a = cards[i];
      var slug = a.getAttribute('id') || '';
      if (!slug) {
        var href = a.getAttribute('href') || '';
        var m = href.match(/\/heroes\/([^/]+)\/?$/);
        slug = m ? m[1] : '';
      }
      if (!slug) continue;
      if (slug.indexOf('stadium') >= 0) continue;
      var role = a.getAttribute('data-role') || '';
      // Filter chips/duplicates carry data-role="all-heroes" etc.
      if (role !== 'tank' && role !== 'damage' && role !== 'support') continue;
      if (seen[slug]) continue;
      seen[slug] = true;
      var name = pickName(a) || slug;
      var subRole = a.getAttribute('data-subrole') || null;
      out.push({ slug: slug, name: name, role: role, sub_role: subRole, portrait: pickPortrait(a) });
    }
    return out;
  }

  function fromHrefScan() {
    var anchors = Array.from(document.querySelectorAll('a[href*="/heroes/"]'));
    var seen = {};
    var out = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var href = a.getAttribute('href') || '';
      var url;
      try {
        url = new URL(href, document.baseURI);
      } catch {
        continue;
      }
      var m = url.pathname.match(/\/heroes\/([^/]+)\/?$/);
      if (!m) continue;
      var tail = m[1];
      if (!tail) continue;
      if (tail.indexOf('stadium') >= 0) continue;
      if (seen[tail]) continue;
      seen[tail] = true;
      var name = pickName(a) || tail;
      out.push({ slug: tail, name: name, role: null, sub_role: null, portrait: pickPortrait(a) });
    }
    return out;
  }

  var primary = fromHeroCards();
  if (primary.length > 0) return primary;
  // Blizzard restructured the markup — fall back to the older href scan so we don't
  // fail catastrophically. Roles will be null and PlaywrightHeroScraper will default
  // them, which is the previous (buggy) behavior — visible as a degenerate role
  // distribution in the next data-refresh PR.
  console.warn('listExtractor: no a.hero-card[data-role] found; falling back to href scan');
  return fromHrefScan();
})()
