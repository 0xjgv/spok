/**
 * Extract the raw YAML body of a `---`-delimited frontmatter block.
 *
 * Returns the text between the opening `---\n` and the next `\n---`, exclusive.
 * Throws if the content does not start with a frontmatter fence or if the
 * fence is unterminated. Shared by doc/skill frontmatter assertion tests.
 */
export function extractFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) {
    throw new Error('no frontmatter');
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) {
    throw new Error('unterminated frontmatter');
  }
  return content.slice(4, end);
}
