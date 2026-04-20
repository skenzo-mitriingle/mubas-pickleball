const LITE_EXPERIENCE_QUERY =
  "(max-width: 47.9375rem), (pointer: coarse), (prefers-reduced-motion: reduce)";

export function prefersLiteExperience() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(LITE_EXPERIENCE_QUERY).matches;
}

export function getAdaptiveRefreshInterval() {
  return prefersLiteExperience() ? 300000 : 180000;
}

export function scheduleVisibilityAwareRefresh(task, options = {}) {
  const intervalMs = Number.isFinite(options.intervalMs) && options.intervalMs > 0
    ? options.intervalMs
    : 180000;
  let timeoutId = 0;
  let activeRun = null;
  let lastCompletedAt = 0;

  function clearScheduledRun() {
    if (!timeoutId) {
      return;
    }

    window.clearTimeout(timeoutId);
    timeoutId = 0;
  }

  async function runTask(force = false) {
    if (!force && typeof document !== "undefined" && document.hidden) {
      return null;
    }

    if (activeRun) {
      return activeRun;
    }

    activeRun = Promise.resolve()
      .then(task)
      .catch((error) => {
        console.error("Scheduled refresh failed:", error);
      })
      .finally(() => {
        lastCompletedAt = Date.now();
        activeRun = null;
      });

    return activeRun;
  }

  function scheduleNextRun() {
    clearScheduledRun();
    timeoutId = window.setTimeout(async () => {
      await runTask(false);
      scheduleNextRun();
    }, intervalMs);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      return;
    }

    const hasRecentRefresh = lastCompletedAt && (Date.now() - lastCompletedAt) < intervalMs;

    if (!hasRecentRefresh) {
      void runTask(true);
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  void runTask(true);
  scheduleNextRun();

  return () => {
    clearScheduledRun();

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  };
}
