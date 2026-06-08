import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => {
  const fetchAnalysisMock = vi.fn();
  const fetchAudioMock = vi.fn();
  const recordPlayMock = vi.fn();
  const parseCastTuningParamsMock = vi.fn();
  const applyCastTuningToEngineMock = vi.fn();
  const castAudioModeCapabilities = [
    { wireValue: "off", label: "Off" },
    { wireValue: "nightcore", label: "Nightcore" },
    { wireValue: "daycore", label: "Daycore" },
    { wireValue: "vaporwave", label: "Vaporwave" },
    { wireValue: "eight_d", label: "8D Audio" },
    { wireValue: "lofi", label: "LoFi" },
    { wireValue: "underwater", label: "Underwater" },
    { wireValue: "cathedral", label: "Cathedral" },
    { wireValue: "cowbell", label: "More Cowbell" },
  ];
  const playerInstances: any[] = [];
  const engineInstances: any[] = [];
  const vizInstances: any[] = [];
  const cowbellInstances: any[] = [];

  const makePlayer = () => {
    const context = { id: `context-${playerInstances.length}` };
    const player: any = {
      isPlayingValue: false,
      context,
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
      getContext: vi.fn(() => context),
      getPlaybackRate: vi.fn(() => 1),
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
      setUserAnchorEdge: vi.fn(),
      getUserAnchorEdgeId: vi.fn(() => null),
      getGraphState: vi.fn(() => ({
        computedThreshold: 18,
        currentThreshold: 20,
        totalBeats: 0,
        allEdges: [],
      })),
      getVisualizationData: vi.fn(() => ({
        beats: [
          { which: 0, start: 0, duration: 1 },
          { which: 1, start: 1, duration: 1 },
        ],
        edges: [],
      })),
      getSectionStartBeatIndices: vi.fn(() => [1]),
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

  const makeCowbellOverlay = () => ({
    enable: vi.fn(),
    disable: vi.fn(),
    cancelScheduledHits: vi.fn(),
    dispose: vi.fn(),
    handleBeatEnter: vi.fn(),
    setSectionStartBeatIndices: vi.fn(),
  });

  return {
    fetchAnalysisMock,
    fetchAudioMock,
    recordPlayMock,
    parseCastTuningParamsMock,
    applyCastTuningToEngineMock,
    castAudioModeCapabilities,
    playerInstances,
    engineInstances,
    vizInstances,
    cowbellInstances,
    makePlayer,
    makeEngine,
    makeViz,
    makeCowbellOverlay,
  };
});

vi.mock("../audio/BufferedAudioPlayer", () => ({
  BufferedAudioPlayer: vi.fn(() => {
    const player = doubles.makePlayer();
    doubles.playerInstances.push(player);
    return player;
  }),
}));

vi.mock("../audio/CowbellOverlayService", () => ({
  CowbellOverlayService: vi.fn((context: unknown, options: unknown) => {
    const overlay = Object.assign(doubles.makeCowbellOverlay(), {
      context,
      options,
    });
    doubles.cowbellInstances.push(overlay);
    return overlay;
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
  CAST_AUDIO_MODE_CAPABILITIES: doubles.castAudioModeCapabilities,
  parseCastTuningParams: doubles.parseCastTuningParamsMock,
  applyCastTuningToEngine: doubles.applyCastTuningToEngineMock,
}));

type CastHarness = {
  getLoadInterceptor: () => ((loadRequestData: unknown) => unknown) | null;
  getMessageListener: () => ((event: { data?: unknown; senderId?: string }) => void) | null;
  sendCustomMessage: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
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
    start: context.start,
    stop: context.stop,
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
    doubles.cowbellInstances.length = 0;
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
    expect(harness.start).toHaveBeenCalledWith({
      disableIdleTimeout: true,
      maxInactivity: 600,
      customNamespaces: {
        "urn:x-cast:com.foreverjukebox.app": "json",
      },
    });

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
    expect(doubles.cowbellInstances).toHaveLength(1);
    expect(doubles.cowbellInstances[0]?.context).toBe(
      doubles.playerInstances[0]?.context,
    );
    expect(
      doubles.cowbellInstances[0]?.setSectionStartBeatIndices,
    ).toHaveBeenCalledWith([1]);
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
      supportedAudioModes: doubles.castAudioModeCapabilities,
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
      supportedAudioModes: doubles.castAudioModeCapabilities,
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
    const viz = doubles.vizInstances[0];
    const engine = doubles.engineInstances[0];
    viz?.setData.mockClear();
    engine?.syncToPlaybackPosition.mockClear();

    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: {
        audioMode: "lofi",
        hasAudioModeParam: true,
        hasGraphTuning: false,
      },
      highlightOnly: false,
      highlightAnchorBranch: false,
    });
    doubles.parseCastTuningParamsMock.mockReturnValue({
      audioMode: "lofi",
      hasAudioModeParam: true,
      hasGraphTuning: false,
      highlightAnchorBranch: false,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=lofi" },
    });
    await flushMicrotasks();

    expect(doubles.playerInstances[0]?.setJukeboxAudioMode).toHaveBeenCalledWith("lofi");
    expect(engine?.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
    expect(doubles.applyCastTuningToEngineMock).not.toHaveBeenCalledWith(
      engine,
      expect.any(Object),
      "am=lofi",
    );
    expect(viz?.setData).not.toHaveBeenCalled();
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

  it("enables cowbell mode from a setTuning command without refreshing viz data", async () => {
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
    const viz = doubles.vizInstances[0];
    const engine = doubles.engineInstances[0];
    const cowbell = doubles.cowbellInstances[0];
    viz?.setData.mockClear();
    engine?.syncToPlaybackPosition.mockClear();
    cowbell?.disable.mockClear();

    doubles.parseCastTuningParamsMock.mockReturnValue({
      audioMode: "cowbell",
      hasAudioModeParam: true,
      hasGraphTuning: false,
      highlightAnchorBranch: false,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=cowbell" },
    });
    await flushMicrotasks();

    expect(cowbell?.enable).toHaveBeenCalledTimes(1);
    expect(cowbell?.disable).not.toHaveBeenCalled();
    expect(doubles.playerInstances[0]?.setJukeboxAudioMode).toHaveBeenCalledWith("cowbell");
    expect(engine?.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
    expect(viz?.setData).not.toHaveBeenCalled();
    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toMatchObject({
      type: "status",
      tuning: {
        audioMode: "cowbell",
      },
    });
  });

  it("disables cowbell mode when switching to another audio mode", async () => {
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
    const cowbell = doubles.cowbellInstances[0];

    doubles.parseCastTuningParamsMock.mockImplementation((tuningParams: string | null) => ({
      audioMode: tuningParams === "am=cowbell" ? "cowbell" : "lofi",
      hasAudioModeParam: true,
      hasGraphTuning: false,
      highlightAnchorBranch: false,
    }));
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=cowbell" },
    });
    await flushMicrotasks();
    cowbell?.disable.mockClear();

    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=lofi" },
    });
    await flushMicrotasks();

    expect(cowbell?.disable).toHaveBeenCalledTimes(1);
    expect(doubles.playerInstances[0]?.setJukeboxAudioMode).toHaveBeenCalledWith("lofi");
  });

  it("schedules cowbell hits on beat changes only while cowbell mode is active", async () => {
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
    const engine = doubles.engineInstances[0];
    const cowbell = doubles.cowbellInstances[0];
    const onUpdate = engine?.onUpdate.mock.calls[0]?.[0] as
      | ((state: {
          beatsPlayed: number;
          currentBeatIndex: number;
          lastJumped: boolean;
          lastJumpFromIndex: number | null;
        }) => void)
      | undefined;

    onUpdate?.({
      beatsPlayed: 1,
      currentBeatIndex: 0,
      lastJumped: false,
      lastJumpFromIndex: null,
    });
    expect(cowbell?.handleBeatEnter).not.toHaveBeenCalled();

    doubles.parseCastTuningParamsMock.mockReturnValue({
      audioMode: "cowbell",
      hasAudioModeParam: true,
      hasGraphTuning: false,
      highlightAnchorBranch: false,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=cowbell" },
    });
    await flushMicrotasks();
    cowbell?.handleBeatEnter.mockClear();

    onUpdate?.({
      beatsPlayed: 2,
      currentBeatIndex: 1,
      lastJumped: false,
      lastJumpFromIndex: null,
    });

    expect(cowbell?.handleBeatEnter).toHaveBeenCalledWith(
      1,
      { which: 1, start: 1, duration: 1 },
      undefined,
    );
  });

  it("does not support eight-bit mode from a setTuning command", async () => {
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
    const viz = doubles.vizInstances[0];
    const engine = doubles.engineInstances[0];
    viz?.setData.mockClear();
    engine?.syncToPlaybackPosition.mockClear();
    doubles.playerInstances[0]?.setJukeboxAudioMode.mockClear();

    doubles.parseCastTuningParamsMock.mockReturnValue({
      audioMode: null,
      hasAudioModeParam: true,
      hasGraphTuning: false,
      highlightAnchorBranch: false,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=eight_bit" },
    });
    await flushMicrotasks();

    expect(doubles.playerInstances[0]?.setJukeboxAudioMode).not.toHaveBeenCalled();
    expect(engine?.syncToPlaybackPosition).not.toHaveBeenCalled();
    expect(viz?.setData).not.toHaveBeenCalled();
    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toMatchObject({
      type: "status",
      tuning: {
        audioMode: "off",
      },
    });
  });

  it("ignores unsupported audio mode values from a setTuning command", async () => {
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

    doubles.parseCastTuningParamsMock.mockImplementation((tuningParams: string | null) => ({
      audioMode: tuningParams === "am=lofi" ? "lofi" : null,
      hasAudioModeParam: true,
      hasGraphTuning: false,
      highlightAnchorBranch: false,
    }));

    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=lofi" },
    });
    await flushMicrotasks();
    expect(doubles.playerInstances[0]?.setJukeboxAudioMode).toHaveBeenCalledWith("lofi");
    doubles.playerInstances[0]?.setJukeboxAudioMode.mockClear();
    harness.sendCustomMessage.mockClear();

    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "am=chipmunk" },
    });
    await flushMicrotasks();

    expect(doubles.playerInstances[0]?.setJukeboxAudioMode).not.toHaveBeenCalled();
    const statusCall =
      harness.sendCustomMessage.mock.calls[harness.sendCustomMessage.mock.calls.length - 1];
    const status = statusCall?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(status).toMatchObject({
      type: "status",
      tuning: {
        audioMode: "lofi",
      },
    });
  });

  it("updates anchor highlighting from a setTuning command without refreshing viz data", async () => {
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
    const viz = doubles.vizInstances[0];
    const engine = doubles.engineInstances[0];
    viz?.setData.mockClear();
    engine?.syncToPlaybackPosition.mockClear();

    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: {
        audioMode: null,
        hasAudioModeParam: false,
        hasGraphTuning: false,
      },
      highlightOnly: true,
      highlightAnchorBranch: true,
    });
    doubles.parseCastTuningParamsMock.mockReturnValue({
      audioMode: null,
      hasAudioModeParam: false,
      hasGraphTuning: false,
      highlightAnchorBranch: true,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "ah=1" },
    });
    await flushMicrotasks();

    expect(doubles.applyCastTuningToEngineMock).not.toHaveBeenCalledWith(
      engine,
      expect.any(Object),
      "ah=1",
    );
    expect(viz?.setAnchorHighlightEnabled).toHaveBeenCalledWith(true);
    expect(viz?.setData).not.toHaveBeenCalled();
    expect(engine?.syncToPlaybackPosition).not.toHaveBeenCalled();
  });

  it("patches live graph tuning against current receiver state", async () => {
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
    const viz = doubles.vizInstances[0];
    const engine = doubles.engineInstances[0];
    viz?.setData.mockClear();
    engine?.syncToPlaybackPosition.mockClear();
    engine.getUserAnchorEdgeId.mockReturnValue(22);
    engine.getGraphState.mockReturnValue({
      computedThreshold: 18,
      currentThreshold: 20,
      totalBeats: 0,
      allEdges: [
        { id: 4, deleted: true },
        { id: 9, deleted: false },
      ],
    });

    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: {
        audioMode: null,
        hasAudioModeParam: false,
        hasGraphTuning: true,
      },
      highlightOnly: false,
      highlightAnchorBranch: false,
    });
    doubles.parseCastTuningParamsMock.mockReturnValue({
      audioMode: null,
      hasAudioModeParam: false,
      hasGraphTuning: true,
      highlightAnchorBranch: false,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "thresh=35" },
    });
    await flushMicrotasks();

    const applyCall =
      doubles.applyCastTuningToEngineMock.mock.calls[
        doubles.applyCastTuningToEngineMock.mock.calls.length - 1
      ];
    const appliedParams = new URLSearchParams(applyCall?.[2] as string);
    expect(applyCall?.[0]).toBe(engine);
    expect(applyCall?.[1]).toEqual(engine.getConfig());
    expect(appliedParams.get("thresh")).toBe("35");
    expect(appliedParams.get("d")).toBe("4");
    expect(appliedParams.get("ab")).toBe("22");
    expect(appliedParams.get("ah")).toBe("0");
    expect(engine?.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
    expect(viz?.setData).toHaveBeenCalledTimes(1);
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
    const viz = doubles.vizInstances[0];
    const engine = doubles.engineInstances[0];
    viz?.setData.mockClear();
    engine?.syncToPlaybackPosition.mockClear();

    doubles.applyCastTuningToEngineMock.mockReturnValue({
      parsed: {
        audioMode: "daycore",
        hasAudioModeParam: true,
        hasGraphTuning: true,
      },
      highlightOnly: false,
      highlightAnchorBranch: true,
    });
    doubles.parseCastTuningParamsMock.mockReturnValue({
      audioMode: "daycore",
      hasAudioModeParam: true,
      hasGraphTuning: true,
      highlightAnchorBranch: true,
    });
    harness.getMessageListener()?.({
      data: { type: "setTuning", tuningParams: "jb=1&ah=1&am=daycore" },
    });
    await flushMicrotasks();
    expect(doubles.applyCastTuningToEngineMock).toHaveBeenLastCalledWith(
      engine,
      expect.any(Object),
      "jb=1&ah=1&am=daycore",
    );
    expect(engine?.syncToPlaybackPosition).toHaveBeenCalledTimes(1);
    expect(viz?.setData).toHaveBeenCalledTimes(1);
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

    const cowbell = doubles.cowbellInstances[0];
    const listener = harness.getMessageListener();
    expect(listener).not.toBeNull();
    listener?.({ data: { type: "reset" } });
    await flushMicrotasks(10);

    expect(cowbell?.dispose).toHaveBeenCalledTimes(1);
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
      supportedAudioModes: doubles.castAudioModeCapabilities,
    });
  });

  it("stops the receiver after the splash screen stays idle", async () => {
    const harness = setupCastHarness();
    await bootstrapReceiver();

    await vi.advanceTimersByTimeAsync(600_000);

    expect(harness.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the receiver alive while an active job is stopped for sender reconnect", async () => {
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

    harness.getMessageListener()?.({ data: { type: "stop" } });
    await vi.advanceTimersByTimeAsync(600_000);

    expect(harness.stop).not.toHaveBeenCalled();
  });
});
