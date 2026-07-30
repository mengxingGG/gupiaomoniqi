package com.mengxinggg.gupiaomoniqi.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

const val DEFAULT_BASE_URL = ""

/**
 * Small, substitutable session/settings boundary. ApiClient depends on this
 * interface, allowing JVM tests to use [InMemoryTokenStore] without Android.
 */
interface TokenStore {
    var token: String?
    var baseUrl: String

    fun clearToken() {
        token = null
    }

    fun clearAll() {
        token = null
        baseUrl = DEFAULT_BASE_URL
    }
}

class InMemoryTokenStore(
    initialToken: String? = null,
    initialBaseUrl: String = DEFAULT_BASE_URL,
) : TokenStore {
    override var token: String? = initialToken
        set(value) {
            field = value?.takeIf(String::isNotBlank)
        }

    override var baseUrl: String =
        ApiUrl.normalizeOptionalBaseUrl(initialBaseUrl)
        set(value) {
            field = ApiUrl.normalizeOptionalBaseUrl(value)
        }
}

/**
 * Stores only authenticated ciphertext in SharedPreferences. The AES key is
 * non-exportable and generated inside AndroidKeyStore.
 */
class EncryptedTokenStore(
    context: Context,
    preferencesName: String = PREFERENCES_NAME,
) : TokenStore {
    private val preferences: SharedPreferences =
        context.applicationContext.getSharedPreferences(
            preferencesName,
            Context.MODE_PRIVATE,
        )
    private val lock = Any()

    override var token: String?
        get() = synchronized(lock) {
            decryptPreference(TOKEN_KEY)?.takeIf(String::isNotBlank)
        }
        set(value) = synchronized(lock) {
            writeEncrypted(TOKEN_KEY, value?.takeIf(String::isNotBlank))
        }

    override var baseUrl: String
        get() = synchronized(lock) {
            val stored = decryptPreference(BASE_URL_KEY)
            if (stored == null) {
                DEFAULT_BASE_URL
            } else {
                runCatching { ApiUrl.normalizeOptionalBaseUrl(stored) }
                    .getOrDefault(DEFAULT_BASE_URL)
            }
        }
        set(value) = synchronized(lock) {
            writeEncrypted(
                BASE_URL_KEY,
                ApiUrl.normalizeOptionalBaseUrl(value),
            )
        }

    override fun clearToken() {
        synchronized(lock) {
            preferences.edit().remove(TOKEN_KEY).apply()
        }
    }

    override fun clearAll() {
        synchronized(lock) {
            preferences.edit()
                .remove(TOKEN_KEY)
                .remove(BASE_URL_KEY)
                .apply()
        }
    }

    private fun writeEncrypted(key: String, plainText: String?) {
        if (plainText == null) {
            preferences.edit().remove(key).apply()
            return
        }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        cipher.updateAAD(key.toByteArray(StandardCharsets.UTF_8))
        val encrypted = cipher.doFinal(
            plainText.toByteArray(StandardCharsets.UTF_8),
        )
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val stored = listOf(
            ENCRYPTION_VERSION,
            encoder.encodeToString(cipher.iv),
            encoder.encodeToString(encrypted),
        ).joinToString(":")
        preferences.edit().putString(key, stored).apply()
    }

    private fun decryptPreference(key: String): String? {
        val stored = preferences.getString(key, null) ?: return null
        return runCatching {
            val parts = stored.split(':')
            require(
                parts.size == 3 && parts[0] == ENCRYPTION_VERSION,
            ) {
                "Unsupported encrypted preference format"
            }
            val decoder = Base64.getUrlDecoder()
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateSecretKey(),
                GCMParameterSpec(GCM_TAG_LENGTH_BITS, decoder.decode(parts[1])),
            )
            cipher.updateAAD(key.toByteArray(StandardCharsets.UTF_8))
            String(
                cipher.doFinal(decoder.decode(parts[2])),
                StandardCharsets.UTF_8,
            )
        }.getOrNull()
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply {
            load(null)
        }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let {
            return it
        }

        return KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEY_STORE,
        ).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or
                        KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(
                        KeyProperties.ENCRYPTION_PADDING_NONE,
                    )
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }

    private companion object {
        const val PREFERENCES_NAME = "stock_simulator_secure_settings"
        const val TOKEN_KEY = "auth_token"
        const val BASE_URL_KEY = "base_url"
        const val KEY_ALIAS =
            "com.mengxinggg.gupiaomoniqi.session.aes"
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
        const val ENCRYPTION_VERSION = "v1"
    }
}
