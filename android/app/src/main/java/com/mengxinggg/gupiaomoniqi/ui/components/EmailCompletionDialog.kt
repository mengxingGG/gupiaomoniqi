package com.mengxinggg.gupiaomoniqi.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.mengxinggg.gupiaomoniqi.ui.AppUiState

@Composable
fun EmailCompletionDialog(
    state: AppUiState,
    onRequestCode: (String) -> Unit,
    onConfirm: (String, String) -> Unit,
    onChangeEmail: () -> Unit,
    onLogout: () -> Unit,
) {
    val account = state.account ?: return
    var email by rememberSaveable(account.username) { mutableStateOf("") }
    var sentEmail by rememberSaveable(account.username) { mutableStateOf("") }
    var code by rememberSaveable(account.username) { mutableStateOf("") }
    val codeSent = state.emailCompletionCodeSent
    val activeEmail = if (codeSent) sentEmail else email
    val canSubmit = if (codeSent) {
        sentEmail.isNotBlank() && code.length == 6
    } else {
        email.isNotBlank()
    }

    Dialog(
        onDismissRequest = {},
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false,
        ),
    ) {
        Card(
            modifier = Modifier
                .padding(18.dp)
                .fillMaxWidth()
                .widthIn(max = 520.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
            ),
        ) {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    "ACCOUNT RECOVERY · REQUIRED",
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.labelMedium,
                )
                Text(
                    "请先补充找回邮箱",
                    fontWeight = FontWeight.Black,
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    "账户 @${account.username} 还没有邮箱资料。绑定并验证邮箱后，才能继续使用资产与模拟交易功能，也可以在忘记密码时接收六位验证码。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedTextField(
                    value = activeEmail,
                    onValueChange = { email = it.take(254) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !codeSent && !state.emailCompletionBusy,
                    label = { Text("找回邮箱") },
                    placeholder = { Text("name@example.com") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                )
                if (codeSent) {
                    OutlinedTextField(
                        value = code,
                        onValueChange = { value ->
                            code = value.filter(Char::isDigit).take(6)
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.emailCompletionBusy,
                        label = { Text("六位验证码") },
                        placeholder = { Text("000000") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.NumberPassword,
                            imeAction = ImeAction.Done,
                        ),
                    )
                }
                state.emailCompletionNotice?.let { notice ->
                    Surface(
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = MaterialTheme.shapes.medium,
                    ) {
                        Text(
                            notice,
                            modifier = Modifier.padding(12.dp),
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                state.emailCompletionError?.let { error ->
                    Surface(
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
                Button(
                    onClick = {
                        if (codeSent) {
                            onConfirm(sentEmail, code)
                        } else {
                            sentEmail = email.trim()
                            onRequestCode(sentEmail)
                        }
                    },
                    enabled = canSubmit && !state.emailCompletionBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            state.emailCompletionBusy -> "请稍候…"
                            codeSent -> "验证并绑定邮箱"
                            else -> "发送六位验证码"
                        },
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    if (codeSent) {
                        TextButton(
                            enabled = !state.emailCompletionBusy,
                            onClick = {
                                email = sentEmail
                                sentEmail = ""
                                code = ""
                                onChangeEmail()
                            },
                        ) {
                            Text("更换邮箱")
                        }
                    }
                    TextButton(
                        enabled = !state.emailCompletionBusy,
                        onClick = onLogout,
                    ) {
                        Text("退出此账户")
                    }
                }
                Text(
                    "本系统只向该邮箱发送验证码，不接收或读取你的邮件。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}
