// Minimal structural interfaces mirroring the File System Access API, so the
// installer core can run against an in-memory fake in tests.

export interface DirHandle {
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
}

export interface FileHandleLike {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;
  createWritable(): Promise<WritableLike>;
}

export interface WritableLike {
  write(data: ArrayBuffer | ArrayBufferView | string): Promise<void>;
  close(): Promise<void>;
}

export interface ManifestEntry {
  configId: string;
  versionId: string;
  name: string;
  installedAt: number;
  files: string[];
  sha256: Record<string, string>;
}

export interface InstallManifest {
  schema: 1;
  installed: ManifestEntry[];
}

export interface VersionManifest {
  configId: string;
  versionId: string;
  name: string;
  versionLabel: string;
  files: Array<{ installPath: string; r2Key: string; sha256: string }>;
}

export interface InstallConflict {
  path: string;
  /** Name of the already-installed config that owns the path, or null for a user-owned file. */
  ownedBy: string | null;
}
