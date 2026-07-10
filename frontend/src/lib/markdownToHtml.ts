import { marked } from 'marked'

// Converts BlockForgeMD's on-disk markdown (including its custom :::columns
// and <callout> extensions) into the HTML shape TipTap's node specs expect.
// Shared by the editor (loads a document into TipTap) and the Slideshow
// presentation view (renders the same markdown as static HTML), so both stay
// in sync with the app's custom syntax.
export const markdownToEditorHtml = (markdown: string): string => {
  if (!markdown.trim()) return '<p></p>'
  let md = markdown
  // Pre-process :::columns blocks — render each column's markdown individually
  // so inner content is properly converted before the outer marked pass
  md = md.replace(/:::columns\n([\s\S]*?)\n:::(?!\w)\n?/g, (_match, inner) => {
    const cols = inner.split(/:::col\n/).filter((s: string) => s.trim())
    const colsHtml = cols.map((colContent: string) => {
      const rendered = marked.parse(colContent.trim()) as string
      return `<div data-column="true">${rendered}</div>`
    }).join('')
    return `<div data-columns="true">${colsHtml}</div>`
  })
  // Pre-process GitHub-style <details><summary>...</summary>...</details> toggle
  // blocks — render the body's markdown individually, same reasoning as columns
  md = md.replace(
    /<details>\n<summary>([^\n]*)<\/summary>\n\n([\s\S]*?)\n<\/details>\n?/g,
    (_match, summary, body) => {
      const rendered = marked.parse(body.trim()) as string
      return `<details><summary>${summary.trim()}</summary><div data-type="detailsContent">${rendered}</div></details>`
    }
  )
  let rawHtml = marked.parse(md)
  if (typeof rawHtml !== 'string') rawHtml = ''
  rawHtml = rawHtml
    // Convert <font color="..."> → <span style="color: ..."> for TipTap Color extension
    .replace(/<font color="([^"]+)">/gi, '<span style="color: $1">')
    .replace(/<\/font>/gi, '</span>')
    // Normalize <mark style="background:"> → background-color for Highlight extension
    .replace(/<mark style="background:\s*([^"]+)">/gi, '<mark style="background-color: $1">')
    .replace(/<p>\s*(<bookmark[^>]*>.*?<\/bookmark>)\s*<\/p>/gi, '$1')
    .replace(/<p>\s*(<toc-block[^>]*>.*?<\/toc-block>)\s*<\/p>/gi, '$1')
    .replace(/<p>\s*(<drawio[^>]*>.*?<\/drawio>)\s*<\/p>/gi, '$1')
    .replace(/<p>\s*(<excalidraw[^>]*>.*?<\/excalidraw>)\s*<\/p>/gi, '$1')
    .replace(/<p>\s*(<mindmap[^>]*>.*?<\/mindmap>)\s*<\/p>/gi, '$1')
    // Convert <callout emoji="X" label="Y" color="Z">...</callout> → <div data-callout="true" ...>
    .replace(/<callout([^>]*)>([\s\S]*?)<\/callout>/gi, (_, attrs, content) => {
      const emoji = (attrs.match(/emoji="([^"]*)"/) || [])[1] || '📝'
      const label = (attrs.match(/label="([^"]*)"/) || [])[1] || 'Note'
      const color = (attrs.match(/color="([^"]*)"/) || [])[1] || '#6366f1'
      return `<div data-callout="true" data-callout-emoji="${emoji}" data-callout-label="${label}" data-callout-color="${color}">${content}</div>`
    })
    // Convert marked's GFM task list output → TipTap taskList format.
    // marked produces (tight lists, no blank lines between items):
    //   <li><input checked="" disabled="" type="checkbox"> text</li>
    // ...but for LOOSE lists (blank line between items — common in
    // Obsidian-authored files) marked instead wraps each item's content in
    // a <p>, moving the <input> inside it:
    //   <li><p><input checked="" disabled="" type="checkbox"> text</p></li>
    // The old regexes only matched the tight form, so loose task lists
    // silently fell through to being parsed as plain bullet lists — losing
    // all checkbox/completion state on load (and then re-saved as such).
    // Attribute order isn't hard-coded either, so a "checked" is detected
    // by inspecting the captured attribute string instead of requiring an
    // exact match sequence.
    // TipTap expects:  <li data-type="taskItem" data-checked="true"><label>...</label><div><p>text</p></div></li>
    .replace(
      /<li>\s*(?:<p>)?<input\s+([^>]*?)\/?>\s*([\s\S]*?)\s*(?:<\/p>)?\s*<\/li>/gi,
      (match, attrs: string, text: string) => {
        if (!/type="checkbox"/i.test(attrs)) return match
        const checked = /\bchecked(="")?\b/i.test(attrs)
        return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? ' checked' : ''}></label><div><p>${text}</p></div></li>`
      }
    )
    // Mark any <ul> that contains task items as a taskList
    .replace(/<ul>([\s\S]*?)<\/ul>/g, (match, inner) =>
      inner.includes('data-type="taskItem"')
        ? `<ul data-type="taskList">${inner}</ul>`
        : match
    )
  return rawHtml
}
