/**
 * Background timer worker to reduce timer throttling in hidden tabs.
 */
const timeouts = new Map();

self.onmessage = (event) => {
  const { command, id, delay } = event.data || {};
  if (command === "setTimeout") {
    const timeoutId = setTimeout(() => {
      self.postMessage({ type: "timeout", id });
      timeouts.delete(id);
    }, delay);
    timeouts.set(id, timeoutId);
    return;
  }
  if (command === "clearTimeout") {
    const timeoutId = timeouts.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeouts.delete(id);
    }
  }
};
