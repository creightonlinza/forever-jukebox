import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => {
  const fetchAnalysisMock = vi.fn();
  const fetchAudioMock = vi.fn();
  const recordPlayMock = vi.fn();
  const parseCastTuningParamsMock = vi.fn();
  const applyCastTuningToEngineMock = vi.fn();
  const playerInstances: any[] = [];
  const engineInstances: any[] = [];
  const vizInstances: any[] = [];

  const makePlayer = () => {
    const player: any = {
      isPlayingValue: false,
      onEnded: null as (() => void) | null,
      setOnEnded: vi.fn((handler: () => void) => {
        player.onEnded = handler;
      }),
      decode: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
      stop: vi.fn(() => {
        player.isPlayingValue = false;
      }),
      isPlaying: vi.fn(() => player.isPlayingValue),
      getDuration: vi.fn(() => 120),
      setJukeboxAudioMode: vi.fn(),
    };
    return player;
  };

  const makeEngine = (player: any) => {
    const config = {
      maxBranches: 4,
      maxBranchThreshold: 80,
      currentThreshold: 20,
      justBackwards: false,
      justLongBranches: false,
      removeSequentialBranches: false,
      minRandomBranchChance: 0.18,
      maxRandomBranchChance: 0.5,
      randomBranchChanceDelta: 0.02,
      minLongBranch: 2,
    };
    const engine: any = {
      running: false,
      onUpdate: vi.fn(),
      getConfig: vi.fn(() => config),
      updateConfig: vi.fn(),
      clearDeletedEdges: vi.fn(),
      rebuildGraph: vi.fn(),
      deleteEdge: vi.fn(),
      getGraphState: vi.fn(() => ({
        computedThreshold: 18,
        currentThreshold: 20,
        totalBeats: 0,
        allEdges: [],
      })),
      getVisualizationData: vi.fn(() => ({ beats: [], edges: [] })),
      loadAnalysis: vi.fn(),
      startJukebox: vi.fn(() => {
        engine.running = true;
      }),
      play: vi.fn(() => {
        engine.running = true;
        player.isPlayingValue = true;
      }),
      pauseJukebox: vi.fn(() => {
        player.isPlayingValue = false;
      }),
      stopJukebox: vi.fn(() => {
        engine.running = false;
        player.isPlayingValue = false;
      }),
      resetStats: vi.fn(),
      isRunning: vi.fn(() => engine.running),
      syncToPlaybackPosition: vi.fn(),
    };
    return engine;
  };

  const makeViz = () => ({
    setActiveIndex: vi.fn(),
    setAnchorHighlightEnabled: vi.fn(),
    setVisible: vi.fn(),
    reset: vi.fn(),
    setData: vi.fn(),
    destroy: vi.fn(),
    update: vi.fn(),
  });

  return {
    fetchAnalysisMock,
    fetchAudioMock,
    recordPlayMock,
    parseCastTuningParamsMock,
    applyCastTuningToEngineMock,
    playerInstances,
    engineInstances,
    vizInstances,
    makePlayer,
    makeEngine,
    makeViz,
  };
});

vi.mock("../audio/BufferedAudioPlayer", () => ({
  BufferedAudioPlayer: vi.fn(() => {
    const player = doubles.makePlayer();
    doubles.playerInstances.push(player);
    return player;
  }),
}));

vi.mock("../engine", () => ({
  JukeboxEngine: vi.fn((player: unknown) => {
    const engine = doubles.makeEngine(player);
    doubles.engineInstances.push(engine);
    return engine;
  }),
}));

vi.mock("../jukebox/JukeboxViz", () => ({
  JukeboxViz: vi.fn(() => {
    const viz = doubles.makeViz();
    doubles.vizInstances.push(viz);
    return viz;
  }),
}));

vi.mock("../app/api", () => ({
  fetchAnalysis: doubles.fetchAnalysisMock,
  fetchAudio: doubles.fetchAudioMock,
  recordPlay: doubles.recordPlayMock,
}));

vi.mock("../app/format", () => ({
  formatDuration: vi.fn(() => "00:00:00"),
}));

vi.mock("./tuning", () => ({
  parseCastTuningParams: doubles.parseCastTuningParamsMock,
  applyCastTuningToEngine: doubles.applyCastTuningToEngineMock,
}));

type CastHarness = {
  getLoadInterceptor: () => ((loadRequestData: unknown) => unknown) | null;
  getMessageListener: () => ((event: { data?: unknown; senderId?: string }) => void) | null;
  sendCustomMessage: ReturnType<typeof vi.fn>;
  replaceState: ReturnType<typeof vi.fn>;
};

function createClassList() {
  const classes = new Set<string>();
  return {
    add: (...tokens: string[]) => {
      tokens.forEach((token) => classes.add(token));
    },
    remove: (...tokens: string[]) => {
      tokens.forEach((token) => classes.delete(token));
    },
    toggle: (token: string, force?: boolean) => {
      const shouldAdd = force === undefined ? !classes.has(token) : force;
      if (shouldAdd) {
        classes.add(token);
      } else {
        classes.delete(token);
      }
      return classes.has(token);
    },
    contains: (token: string) => classes.has(token),
  };
}

function setupCastHarness(pathname = "/"): CastHarness {
  class MockHTMLElement {}
  vi.stubGlobal("HTMLElement", MockHTMLElement as unknown as typeof HTMLElement);
  const createElement = () =>
    Object.assign(new MockHTMLElement(), {
      textContent: "",
      classList: createClassList(),
      parentElement: null as any,
      querySelector: vi.fn((_selector: string) => null) as any,
    });

  const logo = createElement();
  const bottom = createElement();
  const vizLayer = createElement();
  const vizPanel = createElement();
  const title = createElement();
  const listenTime = createElement();
  const beatsPlayed = createElement();
  const status = createElement();
  const statusMeta = createElement();
  const statusParent = createElement();
  statusParent.querySelector = vi.fn((selector: string) => {
    if (selector === ".cast-meta") {
      return statusMeta;
    }
    return null;
  }) as any;
  status.parentElement = statusParent;

  const elements = new Map<string, any>([
    ["#cast-logo", logo],
    ["#cast-bottom", bottom],
    ["#viz-layer", vizLayer],
    ["#viz-panel", vizPanel],
    ["#cast-title", title],
    ["#cast-listen-time", listenTime],
    ["#cast-beats-played", beatsPlayed],
    ["#cast-status", status],
  ]);
  const documentMock = {
    querySelector: vi.fn((selector: string) => elements.get(selector) ?? null),
  };

  let loadInterceptor: ((loadRequestData: unknown) => unknown) | null = null;
  let messageListener: ((event: { data?: unknown; senderId?: string }) => void) | null =
    null;
  const sendCustomMessage = vi.fn();
  const replaceState = vi.fn();
  const context = {
    getPlayerManager: () => ({
      setMessageInterceptor: vi.fn((_type: unknown, handler: (loadRequestData: unknown) => unknown) => {
        loadInterceptor = handler;
      }),
    }),
    addCustomMessageListener: vi.fn(
      (_namespace: string, handler: (event: { data?: unknown; senderId?: string }) => void) => {
        messageListener = handler;
      },
    ),
    sendCustomMessage,
    start: vi.fn(),
    stop: vi.fn(),
  };
  const framework = {
    system: {
      MessageType: {
        JSON: "json",
      },
    },
    messages: {
      MessageType: {
        LOAD: "LOAD",
      },
    },
    CastReceiverContext: {
      getInstance: () => context,
    },
  };

  const windowMock = {
    cast: { framework },
    document: documentMock,
    location: { pathname, search: "" },
    history: { replaceState },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };

  vi.stubGlobal("document", documentMock);
  vi.stubGlobal("window", windowMock);
  return {
    getLoadInterceptor: () => loadInterceptor,
    getMessageListener: () => messageListener,
    sendCustomMessage,
    replaceState,
  };
}

async function bootstrapReceiver() {
  await import("./main");
  await vi.advanceTimersByTimeAsync(250);
}

async function flushMicrotasks(turns = 5) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

describe("cast receiver main", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    doubles.fetchAnalysisMock.mockReset();
    doubles.fetchAudioMock.mockReset();
    doubles.recordPlayMock.mockReset();
    doubles.parseCastTuningParamsMock.mockReset();
    doubles.parseCastTuningParamsMock.mockReturnValue(null);
    doubles.applyCastTuningToEngineMock.mockReset();
    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: null,
      highlightOnly: false,
      highlightAnchorBranch: false,
    });
    doubles.playerInstances.length = 0;
    doubles.engineInstances.length = 0;
    doubles.vizInstances.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("ignores LOAD requests without a valid job id", async () => {
    const harness = setupCastHarness();
    await bootstrapReceiver();
    const interceptor = harness.getLoadInterceptor();
    expect(interceptor).not.toBeNull();

    interceptor?.({ customData: { jobId: "not-a-job-id" } });
    await flushMicrotasks();

    expect(doubles.fetchAnalysisMock).not.toHaveBeenCalled();
    expect(harness.replaceState).not.toHaveBeenCalled();
  });

  it("loads by job id and emits status", async () => {
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    const createdAt = "2026-04-17T00:57:46.945271+00:00";
    doubles.fetchAnalysisMock.mockResolvedValue({
      status: "complete",
      id: jobId,
      created_at: createdAt,
      result: { track: { duration: 123 } },
      track: { title: "Track", artist: "Artist", duration: 123 },
    });
    doubles.fetchAudioMock.mockResolvedValue(new ArrayBuffer(8));
    doubles.recordPlayMock.mockResolvedValue(undefined);

    const harness = setupCastHarness();
    await bootstrapReceiver();
    const interceptor = harness.getLoadInterceptor();
    expect(interceptor).not.toBeNull();

    interceptor?.({
      customData: {
        baseUrl: "https://example.com",
        jobId,
      },
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2100);
    await flushMicrotasks();

    expect(doubles.fetchAnalysisMock).toHaveBeenCalledWith(jobId);
    expect(doubles.fetchAudioMock).toHaveBeenCalledWith(jobId);
    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toBeDefined();
    expect(status).toMatchObject({
      type: "status",
      jobId,
      createdAt,
      tuning: {
        justBackwards: false,
        justLongBranches: false,
        removeSequentialBranches: false,
        threshold: 20,
        computedThreshold: 18,
        branchProbability: {
          minPercent: 18,
          maxPercent: 50,
          deltaPercent: 10,
        },
        deletedEdgeIds: [],
        highlightAnchorBranch: false,
        audioMode: "off",
      },
    });
  });

  it("applies audio mode from load tuning params", async () => {
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    doubles.fetchAnalysisMock.mockResolvedValue({
      status: "complete",
      id: jobId,
      created_at: "2026-04-17T00:57:46.945271+00:00",
      result: { track: { duration: 123 } },
      track: { title: "Track", artist: "Artist", duration: 123 },
    });
    doubles.fetchAudioMock.mockResolvedValue(new ArrayBuffer(8));
    doubles.recordPlayMock.mockResolvedValue(undefined);
    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: {
        audioMode: "eight_d",
        hasAudioModeParam: true,
        hasGraphTuning: false,
      },
      highlightOnly: false,
      highlightAnchorBranch: false,
    });

    const harness = setupCastHarness();
    await bootstrapReceiver();
    harness.getLoadInterceptor()?.({
      customData: {
        jobId,
        tuningParams: "am=eight_d",
      },
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2100);
    await flushMicrotasks();

    expect(doubles.playerInstances[0]?.setJukeboxAudioMode).toHaveBeenCalledWith("eight_d");
    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toMatchObject({
      type: "status",
      jobId,
      tuning: {
        threshold: 20,
        computedThreshold: 18,
        audioMode: "eight_d",
      },
    });
  });

  it("clears prior track fields while loading a different track", async () => {
    const firstJobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    const nextJobId = "b3f3c0dc73c6476c9db95c227f9206f3";
    doubles.fetchAnalysisMock.mockResolvedValue({
      status: "complete",
      id: firstJobId,
      created_at: "2026-04-17T00:57:46.945271+00:00",
      result: { track: { duration: 123 } },
      track: { title: "Old Track", artist: "Old Artist", duration: 123 },
    });
    doubles.fetchAudioMock.mockResolvedValue(new ArrayBuffer(8));
    doubles.recordPlayMock.mockResolvedValue(undefined);
    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: {
        audioMode: "eight_d",
        hasAudioModeParam: true,
        hasGraphTuning: false,
      },
      highlightOnly: false,
      highlightAnchorBranch: false,
    });

    const harness = setupCastHarness();
    await bootstrapReceiver();
    harness.getLoadInterceptor()?.({
      customData: {
        jobId: firstJobId,
        tuningParams: "am=eight_d",
      },
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2100);
    await flushMicrotasks();
    harness.sendCustomMessage.mockClear();

    doubles.fetchAnalysisMock.mockResolvedValue({
      status: "complete",
      id: nextJobId,
      created_at: "2026-04-17T01:00:00.000000+00:00",
      result: { track: { duration: 90 } },
      track: { title: "Next Track", artist: "Next Artist", duration: 90 },
    });
    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: null,
      highlightOnly: false,
      highlightAnchorBranch: false,
    });
    harness.getLoadInterceptor()?.({ customData: { jobId: nextJobId } });

    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toMatchObject({
      type: "status",
      jobId: nextJobId,
      createdAt: null,
      title: null,
      artist: null,
      trackDurationSeconds: null,
      totalBeats: null,
      totalBranches: null,
      isPlaying: false,
      isLoading: true,
      tuning: null,
      playbackState: "loading",
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2100);
    await flushMicrotasks();
  });

  it("updates audio mode from a setTuning command", async () => {
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    doubles.fetchAnalysisMock.mockResolvedValue({
      status: "complete",
      id: jobId,
      created_at: "2026-04-17T00:57:46.945271+00:00",
      result: { track: { duration: 123 } },
      track: { title: "Track", artist: "Artist", duration: 123 },
    });
    doubles.fetchAudioMock.mockResolvedValue(new ArrayBuffer(8));
    doubles.recordPlayMock.mockResolvedValue(undefined);

    const harness = setupCastHarness();
    await bootstrapReceiver();
    harness.getLoadInterceptor()?.({ customData: { jobId } });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2100);
    await flushMicrotasks();

    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: {
        audioMode: "lofi",
        hasAudioModeParam: true,
        hasGraphTuning: false,
      },
      highlightOnly: false,
      highlightAnchorBranch: false,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=lofi" },
    });
    await flushMicrotasks();

    expect(doubles.playerInstances[0]?.setJukeboxAudioMode).toHaveBeenCalledWith("lofi");
    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toMatchObject({
      type: "status",
      tuning: {
        threshold: 20,
        computedThreshold: 18,
        audioMode: "lofi",
      },
    });
  });

  it("returns the current tuning state on getStatus after reconnect", async () => {
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    doubles.fetchAnalysisMock.mockResolvedValue({
      status: "complete",
      id: jobId,
      created_at: "2026-04-17T00:57:46.945271+00:00",
      result: { track: { duration: 123 } },
      track: { title: "Track", artist: "Artist", duration: 123 },
    });
    doubles.fetchAudioMock.mockResolvedValue(new ArrayBuffer(8));
    doubles.recordPlayMock.mockResolvedValue(undefined);

    const harness = setupCastHarness();
    await bootstrapReceiver();
    harness.getLoadInterceptor()?.({ customData: { jobId } });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2100);
    await flushMicrotasks();

    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: {
        audioMode: "daycore",
        hasAudioModeParam: true,
        hasGraphTuning: true,
      },
      highlightOnly: false,
      highlightAnchorBranch: true,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "jb=1&ah=1&am=daycore" },
    });
    await flushMicrotasks();
    harness.sendCustomMessage.mockClear();

    harness.getMessageListener()?.({ data: { type: "getStatus" } });
    await flushMicrotasks();

    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toMatchObject({
      type: "status",
      jobId,
      tuning: {
        justBackwards: false,
        justLongBranches: false,
        removeSequentialBranches: false,
        threshold: 20,
        computedThreshold: 18,
        branchProbability: {
          minPercent: 18,
          maxPercent: 50,
          deltaPercent: 10,
        },
        deletedEdgeIds: [],
        highlightAnchorBranch: true,
        audioMode: "daycore",
      },
      activeVizIndex: 0,
    });
  });

  it("reset command clears the active job status", async () => {
    const jobId = "a3f3c0dc73c6476c9db95c227f9206f2";
    doubles.fetchAnalysisMock.mockResolvedValue({
      status: "complete",
      id: jobId,
      created_at: "2026-04-17T00:57:46.945271+00:00",
      result: { track: { duration: 123 } },
      track: { title: "Track", artist: "Artist", duration: 123 },
    });
    doubles.fetchAudioMock.mockResolvedValue(new ArrayBuffer(8));
    doubles.recordPlayMock.mockResolvedValue(undefined);

    const harness = setupCastHarness();
    await bootstrapReceiver();
    harness.getLoadInterceptor()?.({ customData: { jobId } });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(2100);
    await flushMicrotasks();

    const listener = harness.getMessageListener();
    expect(listener).not.toBeNull();
    listener?.({ data: { type: "reset" } });
    await flushMicrotasks(10);

    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toBeDefined();
    expect(status).toMatchObject({
      type: "status",
      jobId: null,
      createdAt: null,
      playbackState: "idle",
    });
  });
});
