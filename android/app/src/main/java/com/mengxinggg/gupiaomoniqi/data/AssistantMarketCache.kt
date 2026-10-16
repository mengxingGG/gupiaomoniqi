package com.mengxinggg.gupiaomoniqi.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/** 仅缓存公开行情，按服务器和市场隔离；分页断点持久化，完整一轮后再清理下架股票。 */
class AssistantMarketCache(context: Context) : SQLiteOpenHelper(context, "assistant-market.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE snapshots (server TEXT, mode TEXT, id TEXT, name TEXT, symbol TEXT, data TEXT, seen INTEGER, PRIMARY KEY(server,mode,id))")
        db.execSQL("CREATE TABLE sync (server TEXT, mode TEXT, cursor TEXT, cycle INTEGER, next_at INTEGER, PRIMARY KEY(server,mode))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    data class Cursor(val after: String, val cycle: Long, val nextAt: Long)
    fun cursor(server: String, mode: String, now: Long): Cursor = readableDatabase.rawQuery(
        "SELECT cursor,cycle,next_at FROM sync WHERE server=? AND mode=?", arrayOf(server, mode)
    ).use { if (it.moveToFirst()) Cursor(it.getString(0), it.getLong(1), it.getLong(2)) else Cursor("", now, 0) }

    fun save(server: String, mode: String, cursor: Cursor, page: JSONObject, now: Long) {
        require(page.getString("mode") == mode)
        val db = writableDatabase
        val cycle = if (cursor.after.isBlank()) now else cursor.cycle
        val next = if (page.isNull("nextAfter")) "" else page.getString("nextAfter")
        db.beginTransaction()
        try {
            val items = page.getJSONArray("items")
            for (index in 0 until items.length()) {
                val item = items.getJSONObject(index)
                db.insertWithOnConflict("snapshots", null, ContentValues().apply {
                    put("server", server); put("mode", mode); put("id", item.getString("id")); put("name", item.getString("name")); put("symbol", item.getString("symbol"))
                    put("data", item.toString()); put("seen", cycle)
                }, SQLiteDatabase.CONFLICT_REPLACE)
            }
            if (next.isBlank()) db.delete("snapshots", "server=? AND mode=? AND seen<>?", arrayOf(server, mode, cycle.toString()))
            db.insertWithOnConflict("sync", null, ContentValues().apply {
                put("server", server); put("mode", mode); put("cursor", next); put("cycle", cycle)
                put("next_at", now + if (next.isBlank()) 15 * 60_000 else 2_000)
            }, SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun hints(server: String, mode: String, text: String, now: Long): JSONObject? {
        val ids = JSONArray(); var latest = 0L
        // 匹配名称、代码或ID，最多20个候选；只回传标识，价格仍由服务端工具核对。
        readableDatabase.rawQuery("SELECT id,seen FROM snapshots WHERE server=? AND mode=? AND seen>=? AND (instr(?,name)>0 OR instr(lower(?),lower(symbol))>0 OR instr(lower(?),lower(id))>0) ORDER BY length(name) DESC LIMIT 20",
            arrayOf(server, mode, (now - 7 * 86400_000L).toString(), text, text, text)).use { rows ->
            while (rows.moveToNext()) { ids.put(rows.getString(0)); latest = maxOf(latest, rows.getLong(1)) }
        }
        return if (ids.length() == 0) null else JSONObject().put("mode", mode).put("ids", ids).put("syncedAt", java.time.Instant.ofEpochMilli(latest).toString())
    }
}
