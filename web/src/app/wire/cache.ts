import type { AppContext } from "../context";
import type { Elements } from "../elements";
import type { ToastOptions } from "../ui";
import { clearCachedAudio, getCachedAudioBytes } from "../cache";

type CacheDeps = {
  context: AppContext;
  elements: Elements;
  showToast: (context: AppContext, message: string, options?: ToastOptions) => void;
};

export type CacheHandlers = ReturnType<typeof createCacheHandlers>;

export function createCacheHandlers(deps: CacheDeps) {
  const { context, elements, showToast } = deps;

  function formatMegabytes(bytes: number) {
    const mb = Math.max(0, bytes) / (1024 * 1024);
    const rounded = mb.toFixed(1);
    return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
  }

  async function refreshCacheButton() {
    try {
      const bytes = await getCachedAudioBytes();
      elements.cachedAudioClearButton.textContent = `Clear ${formatMegabytes(bytes)}MB`;
      elements.cachedAudioClearButton.disabled = bytes <= 0;
    } catch (err) {
      console.warn(`Cache size failed: ${String(err)}`);
      elements.cachedAudioClearButton.textContent = "Clear 0MB";
      elements.cachedAudioClearButton.disabled = true;
    }
  }

  async function handleClearCacheClick() {
    elements.cachedAudioClearButton.disabled = true;
    elements.cachedAudioClearButton.textContent = "Clearing...";
    try {
      await clearCachedAudio();
      showToast(context, "Cached audio cleared.");
    } catch (err) {
      console.warn(`Cache clear failed: ${String(err)}`);
      showToast(context, "Unable to clear cached audio.");
    } finally {
      void refreshCacheButton();
    }
  }

  return { refreshCacheButton, handleClearCacheClick };
}
