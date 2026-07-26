// Barrel preserving the original playback.ts public surface; the
// implementation now lives in per-domain modules.
export {
  addSleepTimerListener,
  isSleepTimerActive,
  setSleepTimer,
  SLEEP_TIMER_OPTIONS,
  type SleepTimerOption,
} from "./sleep-timer";
export {
  closeInfo,
  closeTuning,
  openExtras,
  openInfo,
  openTuning,
  setAutocanonizerStreamPans,
  setMasterVolume,
  syncVolumeUI,
  updateListenTimeDisplay,
  updateTrackInfo,
  updateVizVisibility,
  type TuningModalTab,
} from "./status-ui";
export {
  isPlaybackBlockedForSwing,
  startAutocanonizerPlayback,
  startJukeboxFromBeat,
  startListenTimer,
  stopListenTimer,
  stopPlayback,
  togglePlayback,
} from "./transport";
export {
  applyExtrasChanges,
  applyTuningChanges,
  changedTuningControls,
  getExtrasFormValues,
  getTuningFormValues,
  resetExtrasDefaults,
  resetTuningDefaults,
  syncDeletedEdgeState,
  type ExtrasApplyResult,
  type ExtrasFormValues,
  type TuningFormValues,
} from "./tuning-forms";
export {
  applyAnalysisResult,
  cancelPoll,
  delay,
  loadAudioFromJob,
  loadTrackById,
  loadTrackByJobId,
  pollAnalysis,
  resetForNewTrack,
  tryLoadCachedAudio,
  type PlaybackDeps,
  type TrackLoadOptions,
} from "./track-load";
export {
  bumpLoadGeneration,
  getLoadGeneration,
  isStaleLoad,
} from "./load-generation";
export { releaseWakeLock, requestWakeLock } from "./wake-lock";
