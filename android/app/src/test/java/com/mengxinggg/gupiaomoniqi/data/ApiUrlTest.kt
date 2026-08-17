package com.mengxinggg.gupiaomoniqi.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ApiUrlTest {
    @Test
    fun `production service uses the fixed official domain`() {
        assertEquals("https://gupiaomoniqi.org", PRODUCTION_BASE_URL)
    }

    @Test
    fun `normalizes bare IP http and https server addresses`() {
        assertEquals(
            "http://192.168.1.20:3100",
            ApiUrl.normalizeBaseUrl(" 192.168.1.20:3100/ "),
        )
        assertEquals(
            "http://dev-server.local:3100",
            ApiUrl.normalizeBaseUrl("http://dev-server.local:3100/"),
        )
        assertEquals(
            "https://example.com/simulator",
            ApiUrl.normalizeBaseUrl("https://example.com/simulator///"),
        )
    }

    @Test
    fun `optional base url preserves the unconfigured empty state`() {
        assertEquals("", DEFAULT_BASE_URL)
        assertEquals("", ApiUrl.normalizeOptionalBaseUrl("  "))

        val store = InMemoryTokenStore()
        assertEquals("", store.baseUrl)
        store.baseUrl = "192.168.1.20:3100"
        assertEquals("http://192.168.1.20:3100", store.baseUrl)
        store.baseUrl = ""
        assertEquals("", store.baseUrl)

        store.baseUrl = "https://example.com"
        store.clearAll()
        assertEquals(
            "",
            InMemoryTokenStore().baseUrl,
        )
        assertEquals("", store.baseUrl)
    }

    @Test
    fun `build encodes query values and path segments`() {
        val url = ApiUrl.build(
            baseUrl = "http://10.0.2.2:3100/",
            path = "/api/instruments/${ApiUrl.encodePathSegment("US/A B")}",
            query = linkedMapOf(
                "mode" to "REAL",
                "search" to "Apple & Co",
            ),
        )

        assertEquals(
            "http://10.0.2.2:3100/api/instruments/US%2FA%20B" +
                "?mode=REAL&search=Apple%20%26%20Co",
            url,
        )
    }

    @Test
    fun `rejects unsafe or ambiguous base urls`() {
        assertThrows(IllegalArgumentException::class.java) {
            ApiUrl.normalizeBaseUrl("")
        }
        assertThrows(IllegalArgumentException::class.java) {
            ApiUrl.normalizeBaseUrl("ftp://example.com")
        }
        assertThrows(IllegalArgumentException::class.java) {
            ApiUrl.normalizeBaseUrl("https://user:pass@example.com")
        }
        assertThrows(IllegalArgumentException::class.java) {
            ApiUrl.normalizeBaseUrl("https://example.com?redirect=elsewhere")
        }
    }
}
