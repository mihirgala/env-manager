/**
 * Lossless dotenv model — pure TS, no Tauri imports.
 *
 * The parser preserves comments, order, quoting, blank lines and `export`
 * prefixes. Only values change on save; key add/remove is explicit.
 * Round-trip invariant: `serialize(parse(fixture)) === fixture`.
 */

export type DotenvEntry =
  | {
      type: 'pair'
      key: string
      /** Raw value span: exact quoted text, or unquoted text trimmed of surrounding space. */
      value: string
      /** Everything after the value: trailing space and/or `# inline comment`, verbatim. */
      suffix: string
      exported: boolean
      quote: '"' | "'" | null
      leading: string
    }
  | { type: 'comment'; text: string }
  | { type: 'blank' }
  | { type: 'raw'; text: string }

export interface DotenvDocument {
  entries: DotenvEntry[]
}

const PAIR_RE = /^([ \t]*)(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.]*)([ \t]*)=([ \t]*)(.*)$/

function splitValue(rest: string, quote: '"' | "'" | null): { value: string; suffix: string } {
  if (quote !== null) {
    // Inside quotes, `#` is data. Scan for the closing quote starting after
    // the opening quote. Double quotes honor backslash escapes; single
    // quotes have none in shell dotenv.
    const open = rest.indexOf(quote)
    let end = -1
    for (let i = open + 1; i < rest.length; i++) {
      const ch = rest[i]
      if (quote === '"' && ch === '\\') {
        i++
        continue
      }
      if (ch === quote) {
        end = i
        break
      }
    }
    if (end === -1) return { value: rest, suffix: '' }
    return { value: rest.slice(0, end + 1), suffix: rest.slice(end + 1) }
  }
  const hash = rest.indexOf('#')
  const head = hash === -1 ? rest : rest.slice(0, hash)
  const comment = hash === -1 ? '' : rest.slice(hash)
  const value = head.trimEnd()
  return { value, suffix: head.slice(value.length) + comment }
}

export function parse(content: string): DotenvDocument {
  const entries: DotenvEntry[] = []
  // Keep line endings out; serialize() rejoins with `\n` and preserves a
  // single trailing newline when the input had one.
  const lines = content.split('\n')
  const endsWithNewline = content.endsWith('\n')
  const body = endsWithNewline ? lines.slice(0, -1) : lines

  for (const line of body) {
    const stripped = line.replace(/\r$/, '')
    if (stripped.trim() === '') {
      entries.push({ type: 'blank' })
      continue
    }
    if (/^[ \t]*#/.test(stripped)) {
      entries.push({ type: 'comment', text: stripped })
      continue
    }
    const m = PAIR_RE.exec(stripped)
    if (m === null) {
      entries.push({ type: 'raw', text: stripped })
      continue
    }
    const leading = m[1] ?? ''
    const exported = /export[ \t]+/.test(stripped.slice(leading.length))
    const key = m[2] ?? ''
    const rawValue = (m[5] ?? '').replace(/\r$/, '')
    const trimmedStart = rawValue.trimStart()
    const quote: '"' | "'" | null =
      trimmedStart.startsWith('"') || trimmedStart.startsWith("'")
        ? (trimmedStart[0] as '"' | "'")
        : null
    const { value, suffix } = splitValue(rawValue, quote)
    entries.push({ type: 'pair', key, value, suffix, exported, quote, leading })
  }
  // Represent the trailing newline as nothing extra: serialize() appends it.
  void endsWithNewline
  return { entries }
}

export function serialize(doc: DotenvDocument): string {
  const out = doc.entries.map((e) => {
    switch (e.type) {
      case 'pair': {
        const prefix = e.exported ? 'export ' : ''
        return `${e.leading}${prefix}${e.key}=${e.value}${e.suffix}`
      }
      case 'comment':
        return e.text
      case 'blank':
        return ''
      case 'raw':
        return e.text
    }
  })
  return out.join('\n') + (out.length > 0 ? '\n' : '')
}

/** Read the effective (unquoted/unescaped) value of a pair entry. */
export function effectiveValue(entry: Extract<DotenvEntry, { type: 'pair' }>): string {
  const v = entry.value.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1)
  return v
}

export function getValue(doc: DotenvDocument, key: string): string | undefined {
  for (let i = doc.entries.length - 1; i >= 0; i--) {
    const e = doc.entries[i]
    if (e?.type === 'pair' && e.key === key) return effectiveValue(e)
  }
  return undefined
}

/**
 * Replace a value in place, preserving quoting style/export prefix/position.
 * Appends a new `KEY=value` line when the key is absent.
 */
export function setValue(doc: DotenvDocument, key: string, next: string): DotenvDocument {
  const entries = doc.entries.map((e) => ({ ...e }))
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e?.type !== 'pair' || e.key !== key) continue
    if (e.quote === '"') e.value = `"${next.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    else if (e.quote === "'") e.value = `'${next}'`
    else e.value = next
    return { entries }
  }
  entries.push({ type: 'pair', key, value: next, suffix: '', exported: false, quote: null, leading: '' })
  return { entries }
}
