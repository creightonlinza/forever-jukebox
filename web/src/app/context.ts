import type { JukeboxEngine } from "../engine";
import type { BufferedAudioPlayer } from "../audio/BufferedAudioPlayer";
import type { Edge } from "../engine/types";
import type { getElements } from "./elements";
import type { FavoriteTrack } from "./favorites";
import type { AppConfig } from "./api";
import type { AutocanonizerController } from "../autocanonizer/AutocanonizerController";
import type { JukeboxController } from "../jukebox/JukeboxController";

export type TabId = "top" | "search" | "play" | "faq";

export type Elements = ReturnType<typeof getElements>;

export type AppState = {
  activeTabId: TabId;
  activeVizIndex: number;
  playMode: "jukebox" | "autocanonizer";
  topSongsTab: "top" | "rising" | "recent" | "favorites";
  searchTab: "search" | "upload";
  favorites: FavoriteTrack[];
  favoritesSyncCode: string | null;
  playTimerMs: number;
  lastPlayStamp: number | null;
  lastBeatIndex: number | null;
  vizData: ReturnType<JukeboxEngine["getVisualizationData"]>;
  isRunning: boolean;
  audioLoaded: boolean;
  analysisLoaded: boolean;
  audioLoadInFlight: boolean;
  autoComputedThreshold: number | null;
  lastJobId: string | null;
  lastYouTubeId: string | null;
  pendingAutoFavoriteId: string | null;
  lastPlayCountedJobId: string | null;
  shiftBranching: boolean;
  selectedEdge: Edge | null;
  topSongsRefreshTimer: number | null;
  topSongsLoaded: boolean;
  risingSongsLoaded: boolean;
  recentSongsLoaded: boolean;
  trackDurationSec: number | null;
  trackTitle: string | null;
  trackArtist: string | null;
  toastTimer: number | null;
  deleteEligible: boolean;
  deleteEligibilityJobId: string | null;
  appConfig: AppConfig | null;
  pollController: AbortController | null;
  listenTimerId: number | null;
  wakeLock: WakeLockSentinel | null;
  tuningParams: string | null;
  deletedEdgeIds: number[];
};

export type AppContext = {
  elements: Elements;
  engine: JukeboxEngine;
  player: BufferedAudioPlayer;
  autocanonizer: AutocanonizerController;
  jukebox: JukeboxController;
  defaultConfig: ReturnType<JukeboxEngine["getConfig"]>;
  state: AppState;
};
