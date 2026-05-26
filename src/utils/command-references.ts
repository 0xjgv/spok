/**
 * Command Reference Utilities
 *
 * Utilities for transforming command references to tool-specific formats.
 */

/**
 * Transforms colon-based command references to hyphen-based format.
 * Converts `/spok:` patterns to `/spok-` for tools that use hyphen syntax.
 *
 * @param text - The text containing command references
 * @returns Text with command references transformed to hyphen format
 *
 * @example
 * transformToHyphenCommands('/spok:new') // returns '/spok-new'
 * transformToHyphenCommands('Use /spok:apply to implement') // returns 'Use /spok-apply to implement'
 */
export function transformToHyphenCommands(text: string): string {
  return text.replace(/\/spok:/g, '/spok-');
}
