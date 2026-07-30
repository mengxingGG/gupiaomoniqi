package com.mengxinggg.gupiaomoniqi.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ApiResponseParserTest {
    @Test
    fun `unwraps successful data envelope`() {
        val data = ApiResponseParser.requireData(
            HttpResponse(
                status = 200,
                body = """{"data":{"value":42}}""",
            ),
        ) as JSONObject

        assertEquals(42, data.getInt("value"))
    }

    @Test
    fun `preserves server error code message and status`() {
        val exception = assertThrows(ApiClientException::class.java) {
            ApiResponseParser.requireData(
                HttpResponse(
                    status = 409,
                    body = """
                        {
                          "code": "INSUFFICIENT_CASH",
                          "message": "Not enough buying power"
                        }
                    """.trimIndent(),
                ),
            )
        }

        assertEquals("INSUFFICIENT_CASH", exception.code)
        assertEquals("Not enough buying power", exception.message)
        assertEquals(409, exception.status)
    }

    @Test
    fun `uses stable fallbacks for malformed error bodies`() {
        val error = ApiResponseParser.parseError(502, "<html>bad gateway</html>")

        assertEquals("HTTP_502", error.code)
        assertEquals("Request failed (HTTP 502)", error.message)
    }

    @Test
    fun `rejects success bodies without an envelope`() {
        val exception = assertThrows(ApiClientException::class.java) {
            ApiResponseParser.requireData(
                HttpResponse(200, """{"value":42}"""),
            )
        }

        assertEquals("INVALID_RESPONSE", exception.code)
        assertEquals(200, exception.status)
    }
}
