package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.mengxinggg.gupiaomoniqi.BuildConfig
import com.mengxinggg.gupiaomoniqi.update.AppUpdateUiState
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerSettingsSheet(
    currentUrl: String,
    error: String?,
    saving: Boolean,
    updateState: AppUpdateUiState,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
    onUpdateAction: () -> Unit,
) {
    var serverUrl by rememberSaveable(currentUrl) {
        mutableStateOf(currentUrl)
    }
    val hasUnsavedServer = serverUrl.trim() != currentUrl
    val canSave =
        serverUrl.isNotBlank() &&
            !saving &&
            !updateState.busy

    fun save() {
        if (canSave) {
            onSave(serverUrl.trim())
        }
    }

    ModalBottomSheet(
        onDismissRequest = {
            if (!saving) onDismiss()
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .navigationBarsPadding()
                .padding(start = 18.dp, end = 18.dp, bottom = 22.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    "设置",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Black,
                )
                Text(
                    "服务器",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
            }

            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it.take(300) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !saving,
                label = { Text("服务器地址") },
                placeholder = { Text("https://example.com 或 192.168.1.10:3100") },
                supportingText = {
                    Text("局域网可用 IP；应用更新仅支持 HTTPS。")
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(onDone = { save() }),
            )

            if (error != null) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Text(
                        error,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                shape = MaterialTheme.shapes.medium,
            ) {
                Text(
                    if (currentUrl.isBlank()) {
                        "未连接"
                    } else {
                        currentUrl
                    },
                    modifier = Modifier.padding(12.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                shape = MaterialTheme.shapes.medium,
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    Text(
                        "应用更新",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        "当前正式版 ${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    updateState.release?.let { release ->
                        Text(
                            "发现新版本 ${release.versionName}（${release.versionCode}）",
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (release.releaseNotes.isNotBlank()) {
                            Text(
                                release.releaseNotes,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                    if (updateState.downloading) {
                        LinearProgressIndicator(
                            progress = { updateState.downloadProgress },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Button(
                        onClick = onUpdateAction,
                        enabled =
                            !updateState.busy &&
                                !saving &&
                                currentUrl.isNotBlank() &&
                                !hasUnsavedServer,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            when {
                                updateState.checking ->
                                    "正在检查…"
                                updateState.downloading ->
                                    "正在下载 ${(
                                        updateState.downloadProgress * 100f
                                    ).roundToInt()}%"
                                updateState.downloadedApkPath != null ->
                                    "重新打开系统安装器"
                                updateState.updateAvailable ->
                                    "下载并安装 ${updateState.release?.versionName.orEmpty()}"
                                else ->
                                    "检查更新"
                            },
                        )
                    }
                    if (currentUrl.isBlank()) {
                        Text(
                            "连接服务器后可检查更新",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    } else if (hasUnsavedServer) {
                        Text(
                            "请先保存服务器地址",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedButton(
                    onClick = onDismiss,
                    enabled = !saving,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("返回")
                }
                Button(
                    onClick = { save() },
                    enabled = canSave,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(if (saving) "连接中…" else "保存")
                }
            }
        }
    }
}
