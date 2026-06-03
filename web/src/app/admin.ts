export const ADMIN_KEY_STORAGE_KEY = "fj-admin-key";

export function getAdminKey() {
  const key = localStorage.getItem(ADMIN_KEY_STORAGE_KEY)?.trim();
  return key || null;
}

export function isAdminMode() {
  return getAdminKey() !== null;
}
