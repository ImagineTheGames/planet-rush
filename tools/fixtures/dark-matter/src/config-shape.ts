/** LIVE, and only from inside `export default …` in `main.ts`. See the note
 *  there: this is the `defineBuildInfo` / `vite.config.ts` shape. */
export function defineThing(spec: { value: number }): { value: number } {
  return spec;
}
