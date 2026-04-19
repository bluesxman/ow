import type { Hero } from './types.js';

export interface HeroDiff {
  added: string[];
  removed: string[];
  changed: Array<{ slug: string; changes: string[] }>;
}

function fieldChanges(prev: Hero, next: Hero): string[] {
  const out: string[] = [];
  if (prev.role !== next.role) out.push(`role: ${prev.role} → ${next.role}`);
  if (prev.sub_role !== next.sub_role) out.push(`sub_role: ${prev.sub_role ?? '—'} → ${next.sub_role ?? '—'}`);

  for (const tier of ['minor', 'major'] as const) {
    const p = prev.perks[tier];
    const n = next.perks[tier];
    const pNames = p.map((x) => x.name).join(' | ');
    const nNames = n.map((x) => x.name).join(' | ');
    if (pNames !== nNames) out.push(`${tier} perk names: [${pNames}] → [${nNames}]`);
    for (let i = 0; i < Math.max(p.length, n.length); i++) {
      const pi = p[i];
      const ni = n[i];
      if (pi && ni && pi.name === ni.name && pi.description !== ni.description) {
        out.push(`${tier}[${ni.name}] description changed`);
      }
    }
  }

  const pAbil = prev.abilities.map((a) => a.name).sort().join('|');
  const nAbil = next.abilities.map((a) => a.name).sort().join('|');
  if (pAbil !== nAbil) out.push(`abilities list changed: [${pAbil}] → [${nAbil}]`);

  const keys: Array<keyof typeof prev.stats> = ['health', 'armor', 'shields'];
  for (const k of keys) {
    const pv = prev.stats[k];
    const nv = next.stats[k];
    if (pv !== nv) out.push(`stats.${String(k)}: ${pv ?? '—'} → ${nv ?? '—'}`);
  }

  return out;
}

export function diffHeroes(prev: Record<string, Hero>, next: Record<string, Hero>): HeroDiff {
  const prevSlugs = new Set(Object.keys(prev));
  const nextSlugs = new Set(Object.keys(next));
  const added = [...nextSlugs].filter((s) => !prevSlugs.has(s)).sort();
  const removed = [...prevSlugs].filter((s) => !nextSlugs.has(s)).sort();
  const changed: HeroDiff['changed'] = [];
  for (const slug of nextSlugs) {
    if (!prevSlugs.has(slug)) continue;
    const p = prev[slug];
    const n = next[slug];
    if (!p || !n) continue;
    const changes = fieldChanges(p, n);
    if (changes.length) changed.push({ slug, changes });
  }
  changed.sort((a, b) => a.slug.localeCompare(b.slug));
  return { added, removed, changed };
}

export function isEmptyDiff(d: HeroDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

export function renderDiffMarkdown(d: HeroDiff, date: string, patchVersion: string): string {
  const lines: string[] = [];
  lines.push(`## ${date} — ${patchVersion}`);
  lines.push('');
  if (d.added.length) {
    lines.push(`### Added heroes`);
    for (const s of d.added) lines.push(`- ${s}`);
    lines.push('');
  }
  if (d.removed.length) {
    lines.push(`### Removed heroes`);
    for (const s of d.removed) lines.push(`- ${s}`);
    lines.push('');
  }
  if (d.changed.length) {
    lines.push(`### Changed`);
    for (const c of d.changed) {
      lines.push(`- **${c.slug}**`);
      for (const ch of c.changes) lines.push(`  - ${ch}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
