declare module "@inkylabs/synctex-js" {
  export const parser: { parseSyncTex(input: string): { hBlocks: SyncTexBlock[]; offset: { x: number; y: number } } };
  export interface SyncTexBlock {
    file?: { path: string }; line: number; page: number;
    left: number; bottom: number; width: number; height: number;
    elements: SyncTexBlock[];
  }
}
