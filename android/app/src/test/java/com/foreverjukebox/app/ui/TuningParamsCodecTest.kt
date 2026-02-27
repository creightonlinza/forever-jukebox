package com.foreverjukebox.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TuningParamsCodecTest {

    @Test
    fun parseExtractsKnownFields() {
        val parsed = TuningParamsCodec.parse("jb=1&lg=0&sq=0&thresh=27&bp=12,34,56&d=3,8&ah=1")

        assertNotNull(parsed)
        assertEquals(27, parsed?.threshold)
        assertEquals(12, parsed?.minProbPercent)
        assertEquals(34, parsed?.maxProbPercent)
        assertEquals(56, parsed?.rampPercent)
        assertTrue(parsed?.justBackwards == true)
        assertFalse(parsed?.justLongBranches == true)
        assertTrue(parsed?.removeSequentialBranches == true)
        assertTrue(parsed?.highlightAnchorBranch == true)
        assertEquals(listOf(3, 8), parsed?.deletedEdgeIds)
    }

    @Test
    fun parseReturnsNullWhenNoKnownFields() {
        val parsed = TuningParamsCodec.parse("foo=1&bar=2")
        assertNull(parsed)
    }

    @Test
    fun parseHonorsMinThreshold() {
        val parsed = TuningParamsCodec.parse("thresh=0&jb=1", minThreshold = 2)
        assertNotNull(parsed)
        assertNull(parsed?.threshold)
        assertTrue(parsed?.justBackwards == true)
    }

    @Test
    fun parseRecognizesBooleanAliasesForSequentialRule() {
        val parsedTrue = TuningParamsCodec.parse("sq=true")
        val parsedFalse = TuningParamsCodec.parse("sq=false")

        assertTrue(parsedTrue?.removeSequentialBranches == true)
        assertFalse(parsedFalse?.removeSequentialBranches == true)
    }

    @Test
    fun parseTreatsBooleanFieldsCaseInsensitively() {
        val parsed = TuningParamsCodec.parse("jb=TRUE&lg=False&ah=TrUe")

        assertTrue(parsed?.justBackwards == true)
        assertFalse(parsed?.justLongBranches == true)
        assertTrue(parsed?.highlightAnchorBranch == true)
    }

    @Test
    fun parseClampsBpPercentFields() {
        val parsed = TuningParamsCodec.parse("bp=-5,120,400")

        assertEquals(0, parsed?.minProbPercent)
        assertEquals(100, parsed?.maxProbPercent)
        assertEquals(100, parsed?.rampPercent)
    }

    @Test
    fun parseIgnoresMalformedBpTriplet() {
        val parsed = TuningParamsCodec.parse("bp=10,20")

        assertNotNull(parsed)
        assertNull(parsed?.minProbPercent)
        assertNull(parsed?.maxProbPercent)
        assertNull(parsed?.rampPercent)
    }

    @Test
    fun parseFiltersInvalidDeletedEdgeIds() {
        val parsed = TuningParamsCodec.parse("d=1,-1,foo,3")

        assertEquals(listOf(1, 3), parsed?.deletedEdgeIds)
    }

    @Test
    fun parseDecodesPercentEncodedFields() {
        val parsed = TuningParamsCodec.parse("bp=15%2C45%2C20&d=5%2C8")

        assertEquals(15, parsed?.minProbPercent)
        assertEquals(45, parsed?.maxProbPercent)
        assertEquals(20, parsed?.rampPercent)
        assertEquals(listOf(5, 8), parsed?.deletedEdgeIds)
    }

    @Test
    fun buildCastLoadPayloadFallsBackToHighlightOnly() {
        assertEquals("ah=1", TuningParamsCodec.buildCastLoadPayload(null, true))
        assertEquals("ah=0", TuningParamsCodec.buildCastLoadPayload("", false))
    }

    @Test
    fun buildCastLoadPayloadSanitizesThresholdAndOverridesHighlight() {
        val payload = TuningParamsCodec.buildCastLoadPayload(
            raw = "thresh=0&jb=1&ah=0&bp=1,2,3",
            highlightAnchorBranch = true
        )
        assertEquals("jb=1&ah=1&bp=1%2C2%2C3", payload)
    }

    @Test
    fun buildCastLoadPayloadDropsNonNumericThresholdAndKeepsKnownState() {
        val payload = TuningParamsCodec.buildCastLoadPayload(
            raw = "thresh=abc&jb=1&d=1,4",
            highlightAnchorBranch = false
        )
        assertEquals("jb=1&d=1%2C4&ah=0", payload)
    }

    @Test
    fun buildFromTuningStateClampsOutOfRangeValues() {
        val raw = TuningParamsCodec.buildFromTuningState(
            TuningState(
                threshold = -9,
                minProb = -20,
                maxProb = 140,
                ramp = 999
            )
        )
        val parsed = TuningParamsCodec.parse(raw, minThreshold = 2)

        assertEquals(2, parsed?.threshold)
        assertEquals(0, parsed?.minProbPercent)
        assertEquals(100, parsed?.maxProbPercent)
        assertEquals(100, parsed?.rampPercent)
    }

    @Test
    fun mergeIntoStateOnlyOverridesPresentValues() {
        val base = TuningState(
            threshold = 33,
            minProb = 12,
            maxProb = 49,
            ramp = 15,
            highlightAnchorBranch = true,
            justBackwards = true,
            justLong = true,
            removeSequential = true
        )
        val parsed = TuningParamsCodec.parse("jb=0")
        val merged = TuningParamsCodec.mergeIntoState(base, parsed)

        assertEquals(33, merged.threshold)
        assertEquals(12, merged.minProb)
        assertEquals(49, merged.maxProb)
        assertEquals(15, merged.ramp)
        assertEquals(true, merged.highlightAnchorBranch)
        assertEquals(false, merged.justBackwards)
        assertEquals(true, merged.justLong)
        assertEquals(true, merged.removeSequential)
    }

    @Test
    fun buildAndMergeRoundTripTuningState() {
        val original = TuningState(
            threshold = 31,
            minProb = 20,
            maxProb = 41,
            ramp = 17,
            highlightAnchorBranch = true,
            justBackwards = true,
            justLong = false,
            removeSequential = true
        )
        val raw = TuningParamsCodec.buildFromTuningState(original)
        val parsed = TuningParamsCodec.parse(raw, minThreshold = 2)
        val merged = TuningParamsCodec.mergeIntoState(TuningState(), parsed)

        assertEquals(original.threshold, merged.threshold)
        assertEquals(original.minProb, merged.minProb)
        assertEquals(original.maxProb, merged.maxProb)
        assertEquals(original.ramp, merged.ramp)
        assertEquals(original.highlightAnchorBranch, merged.highlightAnchorBranch)
        assertEquals(original.justBackwards, merged.justBackwards)
        assertEquals(original.justLong, merged.justLong)
        assertEquals(original.removeSequential, merged.removeSequential)
    }
}
