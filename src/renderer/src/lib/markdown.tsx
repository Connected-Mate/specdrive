import React from 'react'

// Tiny markdown renderer for spec content: paragraphs, bold, inline code,
// links (opened in the system browser), unordered/ordered lists.
// Deliberately minimal — spec bodies are short editorial notes.

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Split on **bold**, `code`, [label](url), bare urls
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`')) {
      nodes.push(<code key={key}>{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('[')) {
      const label = tok.slice(1, tok.indexOf(']'))
      const url = m[2]
      nodes.push(
        <a
          key={key}
          href={url}
          onClick={(e) => {
            e.preventDefault()
            window.specdrive.openExternal(url)
          }}
        >
          {label}
        </a>
      )
    } else {
      nodes.push(
        <a
          key={key}
          href={tok}
          onClick={(e) => {
            e.preventDefault()
            window.specdrive.openExternal(tok)
          }}
        >
          {tok.replace(/^https?:\/\//, '').slice(0, 48)}
        </a>
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim())
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n')
        const isList = lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l.trim()) || !l.trim())
        if (isList) {
          const ordered = /^\s*\d+\./.test(lines[0])
          const items = lines
            .filter((l) => l.trim())
            .map((l, li) => (
              <li key={li}>{renderInline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''), `${bi}-${li}`)}</li>
            ))
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>
        }
        // Strip markdown heading markers — spec cards already have titles.
        const clean = block.replace(/^#{1,4}\s+/gm, '')
        return <p key={bi}>{renderInline(clean, `${bi}`)}</p>
      })}
    </>
  )
}
