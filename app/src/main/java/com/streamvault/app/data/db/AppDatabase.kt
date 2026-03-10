package com.streamvault.app.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import com.streamvault.app.data.model.FavoriteItem

@Database(entities = [FavoriteItem::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun favoriteDao(): FavoriteDao
}
