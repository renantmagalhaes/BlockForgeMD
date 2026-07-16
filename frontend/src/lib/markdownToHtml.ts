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
  rawHtml = convertTaskLists(rawHtml)
  return rawHtml
}

// Convert marked's GFM task list output → TipTap taskList format.
// marked produces (tight lists, no blank lines between items):
//   <li><input checked="" disabled="" type="checkbox"> text</li>
// ...but for LOOSE lists (blank line between items — common in
// Obsidian-authored files) marked instead wraps each item's content in
// a <p>, moving the <input> inside it:
//   <li><p><input checked="" disabled="" type="checkbox"> text</p></li>
// A nested sub-task-list sits as a further <ul>/<li>... inside the same
// parent <li>, alongside its own text.
//
// This used to be two regexes (one rewriting <li>...</li>, one rewriting
// <ul>...</ul>) using a lazy [\s\S]*? to reach the closing tag. That's only
// safe for a FLAT list — a nested task list's own </li>/</ul> is *inside*
// the parent's, so the lazy match stopped at the child's closing tag
// instead of the parent's, mangling anything with sub-items. Walking the
// actual parsed DOM (real nesting, not regex) handles any depth correctly.
// TipTap expects: <li data-type="taskItem" data-checked="true"><label>...</label><div><p>text</p>[<ul data-type="taskList">...</ul>]</div></li>
function convertTaskLists(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const items = Array.from(doc.querySelectorAll('li')).filter((li) => {
    const firstEl = li.firstElementChild
    if (!firstEl) return false
    if (firstEl.tagName === 'INPUT') return firstEl.getAttribute('type') === 'checkbox'
    // Loose-list form: <li><p><input ...> text</p>...</li>
    if (firstEl.tagName === 'P') {
      const firstChild = firstEl.firstElementChild
      return !!firstChild && firstChild.tagName === 'INPUT' && firstChild.getAttribute('type') === 'checkbox'
    }
    return false
  })
  if (items.length === 0) return html

  for (const li of items) {
    const wrapperP = li.firstElementChild?.tagName === 'P' ? li.firstElementChild : null
    const input = (wrapperP ?? li).querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null
    if (!input) continue
    const checked = input.checked || input.hasAttribute('checked')

    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', String(checked))

    const label = doc.createElement('label')
    const newInput = doc.createElement('input')
    newInput.setAttribute('type', 'checkbox')
    if (checked) newInput.setAttribute('checked', '')
    label.appendChild(newInput)

    const contentDiv = doc.createElement('div')
    const p = doc.createElement('p')
    // A nested sub-list is always a direct child of the <li> itself (block
    // content can't nest inside a <p>) — for both tight lists (no wrapperP)
    // AND loose lists (wrapperP holds just the item's own inline text; the
    // nested <ul>/<ol> is wrapperP's next sibling within <li>, not inside
    // it). So nested lists are read from li's children, while the item's
    // own text comes from wrapperP's children when present, else li's.
    const nestedLists = Array.from(li.children).filter((child) =>
      ['UL', 'OL'].includes(child.tagName)
    )
    const textContainer = wrapperP ?? li
    Array.from(textContainer.childNodes).forEach((child) => {
      if (child === input) return
      if (child.nodeType === 1 && ['UL', 'OL'].includes((child as Element).tagName)) return
      p.appendChild(child)
    })
    contentDiv.appendChild(p)
    nestedLists.forEach((list) => contentDiv.appendChild(list))

    // Clear the <li> and rebuild it explicitly so no stray whitespace-only
    // text nodes (or the now-relocated nested list) are left behind.
    while (li.firstChild) li.removeChild(li.firstChild)
    li.appendChild(label)
    li.appendChild(contentDiv)
  }

  // Mark every <ul> that directly contains a converted task item as a
  // taskList (only its own <li> children — nested sub-lists get marked
  // independently when the loop reaches them via :scope).
  doc.querySelectorAll('ul').forEach((ul) => {
    const hasTaskItemChild = Array.from(ul.children).some(
      (child) => child.tagName === 'LI' && child.getAttribute('data-type') === 'taskItem'
    )
    if (hasTaskItemChild) ul.setAttribute('data-type', 'taskList')
  })

  return doc.body.innerHTML
}
