// Import functions for the code-split panels and modals, kept apart from
// AppRoot so that file exports components only.
export const lazyImports = {
  faq: () => import("./FaqPanel").then((m) => ({ default: m.FaqPanel })),
  search: () =>
    import("./SearchPanel").then((m) => ({ default: m.SearchPanel })),
  tuning: () =>
    import("./listen/TuningModal").then((m) => ({ default: m.TuningModal })),
  settings: () =>
    import("./SettingsModal").then((m) => ({ default: m.SettingsModal })),
  feedback: () =>
    import("./FeedbackModal").then((m) => ({ default: m.FeedbackModal })),
  info: () =>
    import("./listen/InfoModal").then((m) => ({ default: m.InfoModal })),
  playlist: () =>
    import("./listen/PlaylistModal").then((m) => ({
      default: m.PlaylistModal,
    })),
};
