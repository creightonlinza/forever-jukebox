package com.foreverjukebox.app.engine

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import java.util.concurrent.CopyOnWriteArraySet

interface JukeboxPlayer {
    fun play()
    fun pause()
    fun stop()
    fun seek(time: Double)
    fun scheduleJump(targetTime: Double, audioStart: Double)
    fun getCurrentTime(): Double
    fun getAudioTime(): Double
    fun isPlaying(): Boolean
}

class JukeboxEngine(
    private val player: JukeboxPlayer,
    options: JukeboxEngineOptions = JukeboxEngineOptions()
) {
    private val scope = CoroutineScope(Dispatchers.Default)
    private var tickJob: Job? = null
    private var analysis: TrackAnalysis? = null
    private var graph: JukeboxGraphState? = null
    private var config: JukeboxConfig = JukeboxConfig()
    private var beats: MutableList<QuantumBase> = mutableListOf()
    private var ticking = false
    private var currentBeatIndex = -1
    private var nextAudioTime = 0.0
    private var beatsPlayed = 0
    private var curRandomBranchChance = 0.0
    private var lastJumped = false
    private var lastJumpTime: Double? = null
    private var lastJumpFromIndex: Int? = null
    private var lastTickTime: Double? = null
    private var forceBranch = false
    private val deletedEdgeKeys = mutableSetOf<String>()
    private val rng = createRng(options.randomMode, options.seed)
    private val listeners = CopyOnWriteArraySet<(JukeboxState) -> Unit>()
    private val branchState = BranchState(0.0)

    init {
        config = config.copy(
            maxBranches = config.maxBranches,
            maxBranchThreshold = config.maxBranchThreshold,
            currentThreshold = config.currentThreshold
        )
        options.config?.let { updateConfig(it) }
    }

    fun onUpdate(callback: (JukeboxState) -> Unit) {
        listeners.add(callback)
    }

    fun removeUpdateListener(callback: (JukeboxState) -> Unit) {
        listeners.remove(callback)
    }

    fun loadAnalysis(data: JsonElement) {
        deletedEdgeKeys.clear()
        analysis = normalizeAnalysis(data)
        val beatsCount = analysis?.beats?.size ?: 0
        config = config.copy(minLongBranch = beatsCount / 5)
        graph = analysis?.let { buildJumpGraph(it, config) }
        applyDeletedEdges()
        beats = analysis?.beats ?: mutableListOf()
        resetState()
    }

    fun clearAnalysis() {
        deletedEdgeKeys.clear()
        analysis = null
        graph = null
        beats = mutableListOf()
        resetState()
    }

    fun getGraphState(): JukeboxGraphState? = graph

    fun getConfig(): JukeboxConfig = config.copy()

    fun updateConfig(partial: JukeboxConfig) {
        config = partial
    }

    fun rebuildGraph() {
        val current = analysis ?: return
        config = config.copy(minLongBranch = current.beats.size / 5)
        graph = buildJumpGraph(current, config)
        curRandomBranchChance = config.minRandomBranchChance
        branchState.curRandomBranchChance = curRandomBranchChance
        applyDeletedEdges()
    }

    fun getVisualizationData(): VisualizationData? {
        val current = analysis ?: return null
        graph ?: return null
        val edgeMap = linkedMapOf<String, Edge>()
        for (beat in current.beats) {
            for (edge in beat.neighbors) {
                if (edge.deleted) continue
                val key = "${edge.src.which}-${edge.dest.which}"
                edgeMap.putIfAbsent(key, edge)
            }
        }
        return VisualizationData(current.beats, edgeMap.values.toMutableList())
    }

    fun play() = player.play()

    fun pause() = player.pause()

    fun startJukebox() {
        if (analysis == null || beats.isEmpty()) {
            throw IllegalStateException("Analysis not loaded")
        }
        if (ticking) return
        resetState()
        ticking = true
        tickJob = scope.launch {
            while (ticking) {
                val delayMs = tick()
                delay(delayMs)
            }
        }
    }

    fun stopJukebox() {
        ticking = false
        tickJob?.cancel()
        tickJob = null
        player.stop()
    }

    fun resetStats() {
        resetState()
        emitState(false)
    }

    fun isRunning(): Boolean = ticking

    fun clearDeletedEdges() {
        deletedEdgeKeys.clear()
    }

    fun deleteEdge(edge: Edge) {
        deletedEdgeKeys.add(edgeKey(edge.src.which, edge.dest.which))
        applyDeletedEdges()
    }

    fun deleteEdgesById(ids: List<Int>) {
        val current = graph ?: return
        if (ids.isEmpty()) return
        val edgeById = current.allEdges.associateBy { it.id }
        for (id in ids) {
            val edge = edgeById[id] ?: continue
            deletedEdgeKeys.add(edgeKey(edge.src.which, edge.dest.which))
        }
        applyDeletedEdges()
    }

    fun setForceBranch(enabled: Boolean) {
        forceBranch = enabled
    }

    fun getBeatAtTime(time: Double): QuantumBase? {
        if (analysis == null || beats.isEmpty()) return null
        val idx = findBeatIndexByTime(time)
        return if (idx >= 0) beats[idx] else null
    }

    fun seekToBeat(index: Int) {
        if (analysis == null || beats.isEmpty()) return
        val clamped = index.coerceIn(0, beats.size - 1)
        val beat = beats[clamped]
        val audioNow = player.getAudioTime()
        currentBeatIndex = clamped
        nextAudioTime = audioNow + beat.duration
        curRandomBranchChance = config.minRandomBranchChance
        branchState.curRandomBranchChance = curRandomBranchChance
        lastJumped = false
        lastJumpTime = null
        lastJumpFromIndex = null
    }

    private fun resetState() {
        currentBeatIndex = -1
        nextAudioTime = 0.0
        beatsPlayed = 0
        curRandomBranchChance = config.minRandomBranchChance
        branchState.curRandomBranchChance = curRandomBranchChance
        lastJumped = false
        lastJumpTime = null
        lastJumpFromIndex = null
        lastTickTime = null
    }

    private fun tick(): Long {
        if (!ticking || analysis == null) return TICK_INTERVAL_MS
        if (!player.isPlaying()) {
            emitState(false)
            lastTickTime = null
            return TICK_INTERVAL_MS
        }

        val audioTime = player.getAudioTime()
        lastTickTime = audioTime
        if (nextAudioTime == 0.0) {
            nextAudioTime = audioTime
        }
        var guard = beats.size
        while (guard > 0 && audioTime >= nextAudioTime) {
            advanceBeat(nextAudioTime)
            guard -= 1
        }

        emitState(lastJumped)
        lastJumped = false
        val remainingMs = ((nextAudioTime - player.getAudioTime()) * 1000.0 - 10.0)
            .coerceAtLeast(0.0)
        return remainingMs.toLong().coerceAtLeast(1L)
    }

    private fun advanceBeat(audioTime: Double) {
        val currentGraph = graph ?: return
        val currentIndex = currentBeatIndex
        val beatsCount = beats.size
        val nextIndex = currentIndex + 1
        val wrappedIndex = if (nextIndex >= beatsCount) 0 else nextIndex
        val seed = beats[wrappedIndex]
        branchState.curRandomBranchChance = curRandomBranchChance
        val selection = selectNextBeatIndex(
            seed,
            currentGraph,
            config,
            rng,
            branchState,
            forceBranch
        )
        curRandomBranchChance = branchState.curRandomBranchChance
        val chosenIndex = if (selection.second) selection.first else wrappedIndex
        val wrappedToStart = wrappedIndex == 0 && currentIndex == beatsCount - 1
        if (selection.second || wrappedToStart) {
            val targetBeat = beats[chosenIndex]
            val targetTime = targetBeat.start
            player.scheduleJump(targetTime, audioTime)
            lastJumped = true
            lastJumpTime = targetTime
            lastJumpFromIndex = if (selection.second) seed.which else currentIndex
        } else {
            lastJumpFromIndex = null
        }

        currentBeatIndex = chosenIndex
        val startTime = if (nextAudioTime == 0.0) audioTime else nextAudioTime
        nextAudioTime = startTime + beats[currentBeatIndex].duration
        beatsPlayed += 1
    }

    private fun findBeatIndexByTime(time: Double): Int {
        var low = 0
        var high = beats.size - 1
        while (low <= high) {
            val mid = (low + high) / 2
            val beat = beats[mid]
            if (time < beat.start) {
                high = mid - 1
            } else if (time >= beat.start + beat.duration) {
                low = mid + 1
            } else {
                return mid
            }
        }
        return (low - 1).coerceIn(0, beats.size - 1)
    }

    private fun applyDeletedEdges() {
        val current = graph ?: return
        if (deletedEdgeKeys.isEmpty()) return
        for (edge in current.allEdges) {
            if (deletedEdgeKeys.contains(edgeKey(edge.src.which, edge.dest.which))) {
                edge.deleted = true
            }
        }
    }

    private fun edgeKey(src: Int, dest: Int): String = "$src-$dest"

    private fun emitState(jumped: Boolean) {
        val currentGraph = graph ?: return
        if (listeners.isEmpty()) return
        val state = JukeboxState(
            currentBeatIndex = currentBeatIndex,
            beatsPlayed = beatsPlayed,
            currentTime = player.getCurrentTime(),
            lastJumped = jumped,
            lastJumpTime = lastJumpTime,
            lastJumpFromIndex = lastJumpFromIndex,
            currentThreshold = currentGraph.currentThreshold,
            lastBranchPoint = currentGraph.lastBranchPoint,
            curRandomBranchChance = curRandomBranchChance
        )
        listeners.forEach { it(state) }
    }
}

data class JukeboxEngineOptions(
    val randomMode: RandomMode = RandomMode.Random,
    val seed: Int? = null,
    val config: JukeboxConfig? = null
)

data class VisualizationData(
    val beats: List<QuantumBase>,
    val edges: MutableList<Edge>
)

private const val TICK_INTERVAL_MS = 50L
