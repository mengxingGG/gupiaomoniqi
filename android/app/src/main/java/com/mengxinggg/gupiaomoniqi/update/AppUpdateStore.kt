package com.mengxinggg.gupiaomoniqi.update

import android.content.Context
import android.content.SharedPreferences
import com.mengxinggg.gupiaomoniqi.model.AndroidAppRelease
import com.mengxinggg.gupiaomoniqi.model.AndroidUpdateCheck
import org.json.JSONObject

data class StoredUpdateSnapshot(
    val sourceBaseUrl: String,
    val lastSuccessfulCheckAtMillis: Long,
    val release: AndroidAppRelease?,
)

class AppUpdateStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun snapshot(): StoredUpdateSnapshot = StoredUpdateSnapshot(
        sourceBaseUrl = preferences.getString(SOURCE_BASE_URL, "").orEmpty(),
        lastSuccessfulCheckAtMillis = preferences.getLong(LAST_SUCCESS, 0L),
        release = preferences.getString(RELEASE_JSON, null)
            ?.let(::decodeRelease),
    )

    fun saveSuccessfulCheck(
        sourceBaseUrl: String,
        check: AndroidUpdateCheck,
        checkedAtMillis: Long = System.currentTimeMillis(),
    ) {
        val editor = preferences.edit()
            .putString(SOURCE_BASE_URL, sourceBaseUrl)
            .putLong(LAST_SUCCESS, checkedAtMillis)
        val release = check.release
        if (release == null) {
            editor.remove(RELEASE_JSON)
        } else {
            editor.putString(RELEASE_JSON, encodeRelease(release).toString())
        }
        editor.apply()
    }

    fun addChangeListener(listener: () -> Unit): AutoCloseable {
        val preferenceListener =
            SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
                if (
                    key == SOURCE_BASE_URL ||
                    key == LAST_SUCCESS ||
                    key == RELEASE_JSON
                ) {
                    listener()
                }
            }
        preferences.registerOnSharedPreferenceChangeListener(preferenceListener)
        return AutoCloseable {
            preferences.unregisterOnSharedPreferenceChangeListener(
                preferenceListener,
            )
        }
    }

    private fun decodeRelease(raw: String): AndroidAppRelease? =
        runCatching {
            val json = JSONObject(raw)
            AndroidAppRelease(
                packageName = json.getString("packageName"),
                versionCode = json.getLong("versionCode"),
                versionName = json.getString("versionName"),
                apkPath = json.getString("apkPath"),
                sha256 = json.getString("sha256"),
                sizeBytes = json.getLong("sizeBytes"),
                publishedAt = json.getString("publishedAt"),
                mandatory = json.getBoolean("mandatory"),
                releaseNotes = json.getString("releaseNotes"),
            )
        }.getOrNull()

    private fun encodeRelease(release: AndroidAppRelease): JSONObject =
        JSONObject()
            .put("packageName", release.packageName)
            .put("versionCode", release.versionCode)
            .put("versionName", release.versionName)
            .put("apkPath", release.apkPath)
            .put("sha256", release.sha256)
            .put("sizeBytes", release.sizeBytes)
            .put("publishedAt", release.publishedAt)
            .put("mandatory", release.mandatory)
            .put("releaseNotes", release.releaseNotes)

    private companion object {
        const val PREFERENCES_NAME = "stock_simulator_app_updates"
        const val SOURCE_BASE_URL = "source_base_url"
        const val LAST_SUCCESS = "last_successful_check_at"
        const val RELEASE_JSON = "release_json"
    }
}
