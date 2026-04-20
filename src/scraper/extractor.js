// Pure browser-side extractor. Loaded as a string and run in page context via page.evaluate.
// MUST be plain JS with no TS or build-tool transforms — esbuild/tsx inject __name() calls
// for arrow functions / const declarations that don't exist in the browser context.
(function extractHeroData() {
  function findDescriptionFor(headingEl) {
    // Blizzard renders perks/abilities inside web components: <blz-header>...<h3 slot="subheading">NAME</h3>
    // <div slot="description">DESC</div></blz-header>. Walk up 3 ancestors then find slot="description".
    var node = headingEl;
    for (var depth = 0; depth < 4 && node; depth++) {
      var d = node.querySelector ? node.querySelector('[slot="description"]') : null;
      if (d) {
        var t = ((d.textContent || '') + '').replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      node = node.parentElement;
    }
    // Fallback: next-sibling text after the heading.
    var sib = headingEl.nextElementSibling;
    while (sib) {
      if (sib.tagName === 'DIV' || sib.tagName === 'P' || sib.tagName === 'SPAN') {
        var t2 = ((sib.textContent || '') + '').replace(/\s+/g, ' ').trim();
        if (t2 && t2.length > 5) return t2;
      }
      sib = sib.nextElementSibling;
    }
    return '';
  }

  // Build a unified item list of headings + description-bearing elements, in document order.
  var allEls = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  var items = allEls.map(function (el) {
    return {
      tag: el.tagName,
      text: ((el.textContent || '') + '').replace(/\s+/g, ' ').trim(),
      el: el,
    };
  });

  function findIdx(pred, start) {
    for (var i = start || 0; i < items.length; i++) {
      if (pred(items[i])) return i;
    }
    return -1;
  }

  var perksIdx = findIdx(function (i) { return i.tag === 'H2' && /^perks$/i.test(i.text); }, 0);
  var stadiumIdx = findIdx(function (i) { return i.tag === 'H2' && /^stadium\s+(powers|items|armory)/i.test(i.text); }, perksIdx >= 0 ? perksIdx : 0);
  var abilitiesIdx = findIdx(function (i) { return i.tag === 'H2' && /^abilities$/i.test(i.text); }, 0);

  var perksEnd = stadiumIdx >= 0 ? stadiumIdx : (perksIdx >= 0 ? Math.min(perksIdx + 40, items.length) : -1);

  function extractPerks() {
    var out = { minor: [], major: [] };
    if (perksIdx < 0 || perksEnd < 0) return out;
    var currentTier = null;
    for (var i = perksIdx + 1; i < perksEnd; i++) {
      var it = items[i];
      if (it.tag === 'H4' && /^minor\s+perk$/i.test(it.text)) {
        currentTier = 'minor';
        continue;
      }
      if (it.tag === 'H4' && /^major\s+perk$/i.test(it.text)) {
        currentTier = 'major';
        continue;
      }
      if (!currentTier) continue;
      if (it.tag === 'H3' && it.text) {
        var desc = findDescriptionFor(it.el);
        if (desc) out[currentTier].push({ name: it.text, description: desc });
      }
    }
    return out;
  }

  function extractAbilities() {
    var out = [];
    if (abilitiesIdx < 0) return out;
    var end = perksIdx > abilitiesIdx ? perksIdx : items.length;
    var seen = {};
    for (var i = abilitiesIdx + 1; i < end; i++) {
      var it = items[i];
      if (it.tag === 'H2') break;
      if (it.tag === 'H3' && it.text && !seen[it.text]) {
        var desc = findDescriptionFor(it.el);
        if (desc) {
          out.push({ name: it.text, description: desc });
          seen[it.text] = true;
        }
      }
    }
    return out;
  }

  var bodyText = document.body.innerText;
  var hp = bodyText.match(/(?:Health|HP)\s*[:\s]\s*(\d{2,4})/i);
  var armor = bodyText.match(/Armor\s*[:\s]\s*(\d{2,4})/i);
  var shields = bodyText.match(/Shields?\s*[:\s]\s*(\d{2,4})/i);

  return {
    perks: extractPerks(),
    abilities: extractAbilities(),
    stats: {
      health: hp ? Number(hp[1]) : undefined,
      armor: armor ? Number(armor[1]) : undefined,
      shields: shields ? Number(shields[1]) : undefined,
    },
    markers: { perksIdx: perksIdx, stadiumIdx: stadiumIdx, abilitiesIdx: abilitiesIdx },
  };
})()
