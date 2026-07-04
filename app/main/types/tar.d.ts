declare module 'tar' {
  export function x(options: { file: string; cwd: string }): Promise<void>
}
