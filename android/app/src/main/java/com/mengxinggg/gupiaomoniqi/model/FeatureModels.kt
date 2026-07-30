package com.mengxinggg.gupiaomoniqi.model

data class WatchlistItem(
    val mode: MarketMode,
    val instrumentId: String,
    val createdAt: String,
    val marketItem: MarketItem?,
)

data class Watchlist(
    val mode: MarketMode,
    val items: List<WatchlistItem>,
    val instrumentIds: List<String>,
    val limit: Int,
)

typealias WatchlistState = Watchlist

enum class RewardKind {
    CHECK_IN,
    GIFT_CODE,
}

enum class RewardClaimState {
    PENDING,
    COMPLETED,
}

data class DailyCheckInStatus(
    val date: String,
    val claimed: Boolean,
    val claimedAt: String?,
    val mode: MarketMode?,
    val rewardUsd: Double,
)

data class RewardClaimResult(
    val claimId: String,
    val kind: RewardKind,
    val mode: MarketMode,
    val amountUsd: Double,
    val state: RewardClaimState,
    val claimedAt: String,
    val portfolio: Portfolio,
)

data class AndroidAppRelease(
    val packageName: String,
    val versionCode: Long,
    val versionName: String,
    val apkPath: String,
    val sha256: String,
    val sizeBytes: Long,
    val publishedAt: String,
    val mandatory: Boolean,
    val releaseNotes: String,
)

data class AndroidUpdateCheck(
    val currentVersionCode: Long,
    val updateAvailable: Boolean,
    val release: AndroidAppRelease?,
)
