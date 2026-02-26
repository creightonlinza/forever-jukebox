package com.foreverjukebox.app.engine

data class TrackMeta(
    val duration: Double? = null,
    val tempo: Double? = null,
    val timeSignature: Double? = null
)

data class JukeboxConfig(
    val maxBranches: Int = 4,
    val maxBranchThreshold: Int = 80,
    val currentThreshold: Int = 0,
    val justBackwards: Boolean = false,
    val justLongBranches: Boolean = false,
    val removeSequentialBranches: Boolean = false,
    val minRandomBranchChance: Double = 0.18,
    val maxRandomBranchChance: Double = 0.5,
    val randomBranchChanceDelta: Double = 0.1,
    val minLongBranch: Int = 0
)

data class JukeboxGraphState(
    val computedThreshold: Int,
    val currentThreshold: Int,
    val lastBranchPoint: Int,
    val totalBeats: Int,
    val longestReach: Double,
    val allEdges: MutableList<Edge>
)

data class JukeboxState(
    val currentBeatIndex: Int,
    val beatsPlayed: Int,
    val currentTime: Double,
    val lastJumped: Boolean,
    val lastJumpTime: Double?,
    val lastJumpFromIndex: Int?,
    val currentThreshold: Int,
    val lastBranchPoint: Int,
    val curRandomBranchChance: Double
)

data class Segment(
    val start: Double,
    val duration: Double,
    val confidence: Double,
    val loudnessStart: Double,
    val loudnessMax: Double,
    val loudnessMaxTime: Double,
    val pitches: List<Double>,
    val timbre: List<Double>,
    var which: Int
)

data class QuantumBase(
    val start: Double,
    val duration: Double,
    val confidence: Double?,
    var which: Int,
    var prev: QuantumBase? = null,
    var next: QuantumBase? = null,
    var parent: QuantumBase? = null,
    var children: MutableList<QuantumBase> = mutableListOf(),
    var indexInParent: Int? = null,
    var overlappingSegments: MutableList<Segment> = mutableListOf(),
    var oseg: Segment? = null,
    var neighbors: MutableList<Edge> = mutableListOf(),
    var allNeighbors: MutableList<Edge> = mutableListOf(),
    var reach: Int? = null
)

data class Edge(
    var id: Int,
    val src: QuantumBase,
    val dest: QuantumBase,
    val distance: Double,
    var deleted: Boolean
)

data class TrackAnalysis(
    val sections: MutableList<QuantumBase>,
    val bars: MutableList<QuantumBase>,
    val beats: MutableList<QuantumBase>,
    val tatums: MutableList<QuantumBase>,
    val segments: MutableList<Segment>,
    val track: TrackMeta? = null
)
