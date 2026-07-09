// Splits a raw markdown file's content into its YAML front matter block and
// the remaining body. Shared by App.tsx (loading/saving files) and Editor.tsx
// (version rollback) so both always agree on where front matter ends and the
// editable body begins — feeding raw, unsplit content into the editor renders
// the front matter as literal text instead of stripping it out.
export const splitFrontMatter = (content: string) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (match) {
    return { frontMatterStr: match[1], body: match[2].replace(/^\r?\n+/, '') }
  }
  return { frontMatterStr: '', body: content }
}
