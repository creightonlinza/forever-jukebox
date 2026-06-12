import type { JukeboxEngine } from "../engine";
import type {
  BufferedAudioPlayer,
  JukeboxAudioMode,
} from "../audio/BufferedAudioPlayer";
import type { Edge } from "../engine/types";
import type { FavoriteTrack } from "./favorites";
import type { PlaylistState } from "./playlist";
import type { AppConfig } from "./api";
import type { AutocanonizerController } from "../autocanonizer/AutocanonizerController";
import type { JukeboxController } from "../jukebox/JukeboxController";
import type { CowbellOverlayService } from "../audio/CowbellOverlayService";

export type TabId = "top" | "search" | "play" | "faq";

export type AppState = {
  activeTabId: TabId;
  activeVizIndex: number;
  playMode: "jukebox" | "autocanonizer";
  topSongsTab: "top" | "trending" | "recent" | "favorites";
  searchTab: "search" | "upload";
  favorites: FavoriteTrack[];
  playlist: PlaylistState;
  favoritesSyncCode: string | null;
  playTimerMs: number;
  lastPlayStamp: number | null;
  lastBeatIndex: number | null;
  vizData: ReturnType<JukeboxEngine["getVisualizationData"]>;
  isRunning: boolean;
  isPaused: boolean;
  audioLoaded: boolean;
  analysisLoaded: boolean;
  audioLoadInFlight: boolean;
  autoComputedThreshold: number | null;
  lastJobId: string | null;
  lastTrackId: string | null;
  lastSourceId: string | null;
  lastSourceProvider: string | null;
  pendingAutoFavoriteId: string | null;
  lastPlayCountedJobId: string | null;
  shiftBranching: boolean;
  bringItHomeMode: boolean;
  branchStatsEnabled: boolean;
  jukeboxAudioMode: JukeboxAudioMode;
  swingPreparing: boolean;
  swingRenderToken: number;
  selectedEdge: Edge | null;
  topSongsRefreshTimer: number | null;
  trackDurationSec: number | null;
  trackTitle: string | null;
  trackArtist: string | null;
  toastTimer: number | null;
  deleteEligible: boolean;
  deleteEligibilityJobId: string | null;
  appConfig: AppConfig | null;
  pollController: AbortController | null;
  listenTimerId: number | null;
  sleepTimer: SleepTimerState;
  sleepTimerTimeoutId: number | null;
  wakeLock: WakeLockSentinel | null;
  tuningParams: string | null;
  deletedEdgeIds: number[];
  highlightAnchorBranch: boolean;
};

export type SleepTimerState = {
  configuredDurationMs: number | null;
  endTimeMs: number | null;
  remainingMs: number;
};

export type AppContext = {
  engine: JukeboxEngine;
  player: BufferedAudioPlayer;
  autocanonizer: AutocanonizerController;
  jukebox: JukeboxController;
  cowbellOverlay: CowbellOverlayService;
  defaultConfig: ReturnType<JukeboxEngine["getConfig"]>;
};
