/**
 * The File System Access API's permission query/request methods are not yet in
 * the standard TypeScript DOM lib. Declare just the bits we use; both are
 * optional so every call stays feature-guarded at runtime.
 */
export {};

declare global {
  interface FileSystemHandle {
    queryPermission?(descriptor?: {
      mode?: 'read' | 'readwrite';
    }): Promise<PermissionState>;
    requestPermission?(descriptor?: {
      mode?: 'read' | 'readwrite';
    }): Promise<PermissionState>;
  }

  // Async iteration over directory entries isn't in this TS DOM lib version.
  // Typed as the file|dir union so `kind` narrows the handle on iteration.
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<
      [string, FileSystemFileHandle | FileSystemDirectoryHandle]
    >;
  }
}
