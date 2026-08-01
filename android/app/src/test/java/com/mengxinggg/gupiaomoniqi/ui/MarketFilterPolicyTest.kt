package com.mengxinggg.gupiaomoniqi.ui

import com.mengxinggg.gupiaomoniqi.data.ApiClientException
import com.mengxinggg.gupiaomoniqi.model.IndustryCount
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarketFilterPolicyTest {
    @Test
    fun `change sorting cycles descending ascending and default`() {
        assertEquals(ChangeSort.DESC, ChangeSort.DEFAULT.next())
        assertEquals(ChangeSort.ASC, ChangeSort.DESC.next())
        assertEquals(ChangeSort.DEFAULT, ChangeSort.ASC.next())
    }

    @Test
    fun `industry response normalizes blank and duplicate rows`() {
        val result = normalizeIndustryCounts(
            listOf(
                IndustryCount("银行", 4),
                IndustryCount(" 银行 ", 2),
                IndustryCount("", 3),
                IndustryCount("-", 2),
                IndustryCount("能源", 0),
            ),
        )

        assertEquals(
            listOf(IndustryCountUi("银行", 6), IndustryCountUi("未分类", 5)),
            result,
        )
    }

    @Test
    fun `market switch retains industry when authoritative directory still contains it`() {
        val result = resolveIndustryDirectory(
            counts = listOf(
                IndustryCount("银行", 12),
                IndustryCount("科技", 8),
            ),
            selectedIndustry = "科技",
        )

        assertEquals("科技", result.selectedIndustry)
        assertFalse(result.shouldReloadMarket)
        assertEquals(8, result.options.single { it.industry == "科技" }.count)
    }

    @Test
    fun `market switch clears industry and reloads only after authoritative rejection`() {
        val result = resolveIndustryDirectory(
            counts = listOf(IndustryCount("银行", 12)),
            selectedIndustry = "科技",
        )

        assertEquals(null, result.selectedIndustry)
        assertTrue(result.shouldReloadMarket)
    }

    @Test
    fun `successful empty directory is authoritative and never invents page counts`() {
        val result = resolveIndustryDirectory(
            counts = emptyList(),
            selectedIndustry = "科技",
        )

        assertTrue(result.options.isEmpty())
        assertEquals(null, result.selectedIndustry)
        assertTrue(result.shouldReloadMarket)
    }

    @Test
    fun `old missing orders endpoint is isolated from other failures`() {
        assertTrue(ApiClientException("NOT_FOUND", 404, "missing").isMissingOrdersEndpoint())
        assertFalse(ApiClientException("SERVER", 500, "failed").isMissingOrdersEndpoint())
        assertFalse(IllegalStateException("failed").isMissingOrdersEndpoint())
    }

    @Test
    fun `missing industries endpoint is recognized without treating other failures as missing`() {
        assertTrue(ApiClientException("NOT_FOUND", 404, "missing").isMissingIndustriesEndpoint())
        assertFalse(ApiClientException("SERVER", 500, "failed").isMissingIndustriesEndpoint())
        assertFalse(IllegalStateException("failed").isMissingIndustriesEndpoint())
    }

    @Test
    fun `old backend clears fake industry filter and reloads unfiltered market`() {
        val result = resolveIndustryDirectoryFailure(
            error = ApiClientException("NOT_FOUND", 404, "missing"),
            selectedIndustry = "科技",
        )

        assertEquals(null, result.selectedIndustry)
        assertTrue(result.shouldReloadMarket)
        assertTrue(result.notice.contains("旧版后端"))
    }

    @Test
    fun `temporary industry directory failure preserves selection without reload`() {
        val result = resolveIndustryDirectoryFailure(
            error = ApiClientException("SERVER", 500, "failed"),
            selectedIndustry = "科技",
        )

        assertEquals("科技", result.selectedIndustry)
        assertFalse(result.shouldReloadMarket)
    }
}
