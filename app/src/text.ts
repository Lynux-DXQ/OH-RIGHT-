export const COLS = 40;
export const BRIEF_LINES = 7;

export function wrap(text: string, cols = COLS, maxLines = 8): string[] {
  const out: string[] = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const w = word.length > cols ? word.slice(0, cols - 1) + '…' : word;
      if (!line) line = w;
      else if ((line + ' ' + w).length <= cols) line += ' ' + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].slice(0, cols - 1) + '…';
    return cut;
  }
  return out;
}

export function pages(text: string, perPage = BRIEF_LINES): string[] {
  const lines = wrap(text, COLS, Infinity);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += perPage) out.push(lines.slice(i, i + perPage).join('\n'));
  return out.length ? out : [''];
}
