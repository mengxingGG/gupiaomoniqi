package com.mengxinggg.gupiaomoniqi.update

import com.mengxinggg.gupiaomoniqi.BuildConfig
import com.mengxinggg.gupiaomoniqi.model.AndroidAppRelease
import com.mengxinggg.gupiaomoniqi.model.AndroidUpdateCheck
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdatePolicyTest {
    @Test
    fun `accepts a complete newer release for this application`() {
        val release = validRelease()
        val sanitized = AppUpdatePolicy.sanitize(
            AndroidUpdateCheck(
                currentVersionCode = BuildConfig.VERSION_CODE.toLong(),
                updateAvailable = true,
                release = release,
            ),
        )

        assertTrue(sanitized.updateAvailable)
        assertEquals(release, sanitized.release)
    }

    @Test
    fun `accepts a consistent response without an update`() {
        val sanitized = AppUpdatePolicy.sanitize(
            AndroidUpdateCheck(
                currentVersionCode = BuildConfig.VERSION_CODE.toLong(),
                updateAvailable = false,
                release = null,
            ),
        )

        assertFalse(sanitized.updateAvailable)
        assertNull(sanitized.release)
    }

    @Test
    fun `rejects a release with the installed version code`() {
        assertRejected(
            release = validRelease().copy(
                versionCode = BuildConfig.VERSION_CODE.toLong(),
            ),
        )
    }

    @Test
    fun `rejects a release for another package`() {
        assertRejected(
            release = validRelease().copy(
                packageName = "com.example.imposter",
            ),
        )
    }

    @Test
    fun `rejects an APK path containing traversal`() {
        assertRejected(
            release = validRelease().copy(
                apkPath = "/api/android/../private/update.apk",
            ),
        )
    }

    @Test
    fun `rejects a malformed SHA256`() {
        assertRejected(
            release = validRelease().copy(
                sha256 = "not-a-sha256",
            ),
        )
    }

    @Test
    fun `rejects an empty APK`() {
        assertRejected(
            release = validRelease().copy(
                sizeBytes = 0L,
            ),
        )
    }

    @Test
    fun `rejects an APK larger than the download limit`() {
        assertRejected(
            release = validRelease().copy(
                sizeBytes = 250L * 1024L * 1024L + 1L,
            ),
        )
    }

    @Test
    fun `rejects update available without release metadata`() {
        assertThrows(AppUpdateException::class.java) {
            AppUpdatePolicy.sanitize(
                AndroidUpdateCheck(
                    currentVersionCode = BuildConfig.VERSION_CODE.toLong(),
                    updateAvailable = true,
                    release = null,
                ),
            )
        }
    }

    @Test
    fun `rejects release metadata when update available is false`() {
        assertThrows(AppUpdateException::class.java) {
            AppUpdatePolicy.sanitize(
                AndroidUpdateCheck(
                    currentVersionCode = BuildConfig.VERSION_CODE.toLong(),
                    updateAvailable = false,
                    release = validRelease(),
                ),
            )
        }
    }

    @Test
    fun `rejects response for a different requested version`() {
        assertThrows(AppUpdateException::class.java) {
            AppUpdatePolicy.sanitize(
                AndroidUpdateCheck(
                    currentVersionCode = BuildConfig.VERSION_CODE.toLong() - 1L,
                    updateAvailable = false,
                    release = null,
                ),
            )
        }
    }

    private fun assertRejected(release: AndroidAppRelease) {
        assertFalse(AppUpdatePolicy.isValidNewRelease(release))
        assertThrows(AppUpdateException::class.java) {
            AppUpdatePolicy.sanitize(
                AndroidUpdateCheck(
                    currentVersionCode = BuildConfig.VERSION_CODE.toLong(),
                    updateAvailable = true,
                    release = release,
                ),
            )
        }
    }

    private fun validRelease() = AndroidAppRelease(
        packageName = BuildConfig.APPLICATION_ID,
        versionCode = BuildConfig.VERSION_CODE.toLong() + 1L,
        versionName = "0.3.0",
        apkPath = "/api/android/update/apk",
        sha256 = "0123456789abcdef".repeat(4),
        sizeBytes = 12_345_678L,
        publishedAt = "2026-07-30T02:00:00.000Z",
        mandatory = false,
        releaseNotes = "应用内更新测试",
    )
}
