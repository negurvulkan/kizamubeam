// Rechenkern in Rust (src-tauri/core) aus der Oberfläche aufrufen. Im Browser gibt es ihn nicht, dort rechnet
// derselbe Ablauf in TypeScript (images.ts, gcode.ts).
import type { InvokeArgs, InvokeOptions } from '@tauri-apps/api/core';

export const hasNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function native<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args, options);
}
