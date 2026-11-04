// File System Access members TypeScript's DOM lib does not ship. All are
// Chromium-only, so they are optional and feature-detected at runtime.

type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

interface OpenFilePickerOptions {
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}
