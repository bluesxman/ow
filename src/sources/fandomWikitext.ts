export interface ParsedTemplate {
  name: string;
  params: Record<string, string>;
}

export function parseWikitext(wikitext: string): {
  infobox: ParsedTemplate | null;
  abilities: ParsedTemplate[];
} {
  const templates = extractTopLevelTemplates(wikitext);
  let infobox: ParsedTemplate | null = null;
  const abilities: ParsedTemplate[] = [];

  for (const tpl of templates) {
    const normalized = tpl.name.toLowerCase().replace(/[_\s]+/g, ' ').trim();
    if (normalized === 'infobox character' || normalized === 'infobox hero') {
      infobox = tpl;
    } else if (normalized === 'ability details' || normalized === 'ability card') {
      abilities.push(tpl);
    }
  }

  return { infobox, abilities };
}

export function extractTopLevelTemplates(wikitext: string): ParsedTemplate[] {
  const templates: ParsedTemplate[] = [];
  let i = 0;
  while (i < wikitext.length) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
      const end = findMatchingClose(wikitext, i);
      if (end === -1) break;
      const body = wikitext.slice(i + 2, end);
      const parsed = parseTemplateBody(body);
      if (parsed) templates.push(parsed);
      i = end + 2;
    } else {
      i++;
    }
  }
  return templates;
}

function findMatchingClose(s: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < s.length - 1) {
    if (s[i] === '{' && s[i + 1] === '{') {
      depth++;
      i += 2;
    } else if (s[i] === '}' && s[i + 1] === '}') {
      depth--;
      if (depth === 0) return i;
      i += 2;
    } else {
      i++;
    }
  }
  return -1;
}

function parseTemplateBody(body: string): ParsedTemplate | null {
  const parts = splitOnTopLevelPipes(body);
  if (parts.length === 0) return null;
  const name = parts[0]!.trim();
  if (!name) return null;
  const params: Record<string, string> = {};
  let positional = 0;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    const eq = findTopLevelEquals(part);
    if (eq === -1) {
      positional++;
      params[String(positional)] = cleanValue(part.trim());
    } else {
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key) params[key] = cleanValue(value);
    }
  }
  return { name, params };
}

function splitOnTopLevelPipes(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let bracketDepth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    const next = body[i + 1];
    if (c === '{' && next === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}' && next === '}') {
      depth--;
      i++;
      continue;
    }
    if (c === '[' && next === '[') {
      bracketDepth++;
      i++;
      continue;
    }
    if (c === ']' && next === ']') {
      bracketDepth--;
      i++;
      continue;
    }
    if (c === '|' && depth === 0 && bracketDepth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function findTopLevelEquals(part: string): number {
  let depth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < part.length; i++) {
    const c = part[i]!;
    const next = part[i + 1];
    if (c === '{' && next === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}' && next === '}') {
      depth--;
      i++;
      continue;
    }
    if (c === '[' && next === '[') {
      bracketDepth++;
      i++;
      continue;
    }
    if (c === ']' && next === ']') {
      bracketDepth--;
      i++;
      continue;
    }
    if (c === '=' && depth === 0 && bracketDepth === 0) return i;
  }
  return -1;
}

export function cleanValue(raw: string): string {
  let s = raw;
  s = s.replace(/<ref[^>]*\/>/g, '');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, ' / ');
  s = replaceInnerTemplates(s);
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/'''([^']+)'''/g, '$1');
  s = s.replace(/''([^']+)''/g, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function replaceInnerTemplates(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{' && s[i + 1] === '{') {
      const end = findMatchingClose(s, i);
      if (end === -1) {
        out += s[i];
        i++;
        continue;
      }
      const body = s.slice(i + 2, end);
      out += reduceInnerTemplate(body);
      i = end + 2;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}

function reduceInnerTemplate(body: string): string {
  const parts = splitOnTopLevelPipes(body);
  if (parts.length === 0) return '';
  const name = parts[0]!.trim().toLowerCase();

  if (name === 'tt') {
    return parts[1] ? cleanValue(parts[1].trim()) : '';
  }
  if (name.startsWith('#vardefineecho')) {
    const firstEq = parts[0]!.indexOf(':');
    if (firstEq !== -1 && parts[0]!.slice(firstEq + 1).trim()) {
      return parts[1] ? cleanValue(parts[1].trim()) : '';
    }
    return parts[1] ? cleanValue(parts[1].trim()) : '';
  }
  if (name.startsWith('#var')) {
    return '';
  }
  if (name === 'calcdps') {
    return '';
  }
  if (name === 'al' || name === 'ability link') {
    return parts[1] ? cleanValue(parts[1].trim()) : '';
  }
  if (name === 'flag') {
    return parts[1] ? parts[1].trim() : '';
  }
  if (name === 'proj') {
    return parts[1] ? parts[1].trim() : '';
  }
  return '';
}
