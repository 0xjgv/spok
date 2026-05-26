/**
 * Basename for generated slash-command files (e.g. propose → spok-propose).
 */
export function spokCommandBasename(commandId: string): string {
  return `spok-${commandId}`;
}
