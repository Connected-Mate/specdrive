import { dialog } from 'electron'
import fs from 'node:fs'
import type { ProjectBundle } from '../shared/types'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** One self-contained HTML page: the whole project, printable to PDF. */
export async function exportProject(bundle: ProjectBundle): Promise<string | null> {
  const p = bundle.project
  const cat = (c: string): string =>
    ({ vision: 'Vision', audience: 'Who it\u2019s for', features: 'What it does', design: 'Look & feel', tech: 'Under the hood', data: 'Data', research: 'Research', risks: 'Hard parts', decisions: 'Decisions' })[c] ?? c

  const specsByCat = new Map<string, typeof bundle.specs>()
  for (const s of bundle.specs) {
    specsByCat.set(s.category, [...(specsByCat.get(s.category) ?? []), s])
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)} — SpecDrive</title>
<style>
body{font-family:-apple-system,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;padding:48px 24px;color:#3e3e3e;line-height:1.5}
h1{font-family:Georgia,serif;font-weight:400;font-size:44px;color:#0a0a0a;line-height:1.05;margin:0 0 6px}
h2{font-family:Georgia,serif;font-weight:400;font-size:26px;color:#0a0a0a;margin:44px 0 14px;border-bottom:1px solid #eee;padding-bottom:8px}
h3{font-size:15px;color:#0a0a0a;margin:18px 0 4px}
.muted{color:#636363;font-size:14px}
.card{background:#fafafa;border-radius:14px;padding:14px 18px;margin:10px 0}\n.card p,.step{white-space:pre-wrap}
.badge{display:inline-block;background:#eee;border-radius:99px;padding:2px 10px;font-size:11px;margin-right:6px}
.step{margin:6px 0;padding-left:8px}
.done{color:#007aff}
.gap{background:#fbeee2;border-radius:10px;padding:10px 14px;font-size:13px;margin-top:8px}
footer{margin-top:60px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:14px}
@media print{body{padding:0}}
</style></head><body>
<h1>${esc(p.name)}</h1>
<p class="muted">${esc(p.oneLiner)} — exported from SpecDrive, ${new Date().toLocaleDateString('en-GB')}</p>
${
  bundle.planDoc
    ? `<h2>The plan</h2>` +
      bundle.planDoc.blocks
        .map((b) => {
          if (b.type === 'section') return `<h3>${esc(b.title)}</h3><p>${esc(b.body)}</p>`
          if (b.type === 'callout') return `<div class="card"><strong>${esc(b.tone.toUpperCase())}</strong> — ${esc(b.body)}</div>`
          if (b.type === 'table')
            return `<div class="card">${b.title ? `<h3>${esc(b.title)}</h3>` : ''}<table>${b.rows.map((r) => `<tr>${r.map((c) => `<td style="padding:4px 12px 4px 0;vertical-align:top">${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`
          if (b.type === 'questions')
            return `<div class="card"><h3>Open questions</h3>${b.items.map((q) => `<p><strong>${esc(q.q)}</strong>${q.suggestion ? `<br><span class="muted">Suggested: ${esc(q.suggestion)}</span>` : ''}</p>`).join('')}</div>`
          return ''
        })
        .join('')
    : ''
}
${[...specsByCat.entries()]
  .map(
    ([c, specs]) =>
      `<h2>${esc(cat(c))}</h2>` +
      specs
        .map(
          (s) =>
            `<div class="card"><h3>${esc(s.title)}</h3><p>${esc(s.content)}</p><span class="badge">${esc(s.status)}</span>${s.acceptance ? `<p class="muted">How we\u2019ll know it works: ${esc(s.acceptance)}</p>` : ''}</div>`
        )
        .join('')
  )
  .join('')}
${
  bundle.scenarios.length
    ? `<h2>Usage scenarios</h2>` +
      bundle.scenarios
        .map(
          (sc) =>
            `<div class="card"><h3>${esc(sc.title)}</h3><p class="muted">${esc(sc.actor)}</p>${sc.steps.map((st, i) => `<p class="step">${i + 1}. ${esc(st.action)}${st.expect ? ` → <span class="muted">${esc(st.expect)}</span>` : ''}</p>`).join('')}${sc.gapNote ? `<div class="gap">Gap: ${esc(sc.gapNote)}</div>` : ''}</div>`
        )
        .join('')
    : ''
}
${
  bundle.tasks.length
    ? `<h2>Build plan</h2>` +
      [...bundle.tasks]
        .sort((a, b) => a.order - b.order)
        .map((t) => `<p class="step">${t.status === 'done' ? '<span class="done">✓</span>' : '○'} ${t.parentId ? '&nbsp;&nbsp;&nbsp;' : ''}<strong>${esc(t.title)}</strong>${t.note ? ` — <span class="muted">${esc(t.note)}</span>` : ''}</p>`)
        .join('')
    : ''
}
<footer>Built with SpecDrive — spec-driven development for everyone.</footer>
</body></html>`

  const { filePath } = await dialog.showSaveDialog({
    defaultPath: `${p.name.replace(/[^a-zA-Z0-9]+/g, '-')}.html`,
    filters: [{ name: 'Web page', extensions: ['html'] }]
  })
  if (!filePath) return null
  fs.writeFileSync(filePath, html)
  return filePath
}
