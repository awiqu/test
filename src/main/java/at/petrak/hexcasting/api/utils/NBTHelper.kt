@file:JvmName("NBTHelper")

package at.petrak.hexcasting.api.utils

import net.minecraft.advancements.AdvancementHolder
import net.minecraft.core.UUIDUtil
import net.minecraft.nbt.*
import net.minecraft.server.ServerAdvancementManager
import java.util.*
import kotlin.jvm.optionals.getOrNull

private inline fun <T : Any, K, E> T?.getIf(key: K, predicate: T?.(K) -> Boolean, get: T.(K) -> E): E? =
    getIf(key, predicate, get, null)

private inline fun <T : Any, K, E> T?.getIf(key: K, predicate: T?.(K) -> Boolean, get: T.(K) -> E, default: E): E {
    if (this != null && predicate(key))
        return get(key)
    return default
}

fun AdvancementHolder.isChildOf(root: AdvancementHolder, serverAdvancementManager: ServerAdvancementManager): Boolean {
    var current = this
    while (true) {
        if (current.equals(root)) return true
        var parentOpt = serverAdvancementManager.get(current.value.parent.getOrNull() ?: return false) ?: return false

        current = parentOpt
    }
}

// ======================================================================================================== CompoundTag

// Checks for containment

fun CompoundTag?.hasNumber(key: String) = this?.get(key) is NumericTag
fun CompoundTag?.hasByte(key: String) = this?.get(key) is ByteTag
fun CompoundTag?.hasShort(key: String) = this?.get(key) is ShortTag
fun CompoundTag?.hasInt(key: String) = this?.get(key) is IntTag
fun CompoundTag?.hasLong(key: String) = this?.get(key) is LongTag
fun CompoundTag?.hasFloat(key: String) = this?.get(key) is FloatTag
fun CompoundTag?.hasDouble(key: String) = this?.get(key) is DoubleTag
fun CompoundTag?.hasLongArray(key: String) = this?.get(key) is LongArrayTag
fun CompoundTag?.hasIntArray(key: String) = this?.get(key) is IntArrayTag
fun CompoundTag?.hasByteArray(key: String) = this?.get(key) is ByteArrayTag
fun CompoundTag?.hasCompound(key: String) = this?.get(key) is CompoundTag
fun CompoundTag?.hasString(key: String) = this?.get(key) is StringTag
fun CompoundTag?.hasList(key: String) = this?.get(key) is ListTag
fun CompoundTag?.hasList(key: String, objType: Int) = hasList(key, objType.toByte())
fun CompoundTag?.hasList(key: String, objType: Byte): Boolean {
    val lt = this?.get(key) as? ListTag ?: return false
    return lt.all { it.id == objType }
}

fun CompoundTag?.hasUUID(key: String) = this?.get(key).let { it is IntArrayTag && it.size() == 4 }

fun CompoundTag?.contains(key: String, id: Byte): Boolean {
    val tag = this?.get(key) ?: return false
    return tag.id == id || (id == 99.toByte() && tag is NumericTag)
}
fun CompoundTag?.contains(key: String, id: Int) = contains(key, id.toByte())

// Puts

fun CompoundTag?.putBoolean(key: String, value: Boolean) = this?.putBoolean(key, value)
fun CompoundTag?.putByte(key: String, value: Byte) = this?.putByte(key, value)
fun CompoundTag?.putShort(key: String, value: Short) = this?.putShort(key, value)
fun CompoundTag?.putInt(key: String, value: Int) = this?.putInt(key, value)
fun CompoundTag?.putLong(key: String, value: Long) = this?.putLong(key, value)
fun CompoundTag?.putFloat(key: String, value: Float) = this?.putFloat(key, value)
fun CompoundTag?.putDouble(key: String, value: Double) = this?.putDouble(key, value)
fun CompoundTag?.putLongArray(key: String, value: LongArray) = this?.putLongArray(key, value)
fun CompoundTag?.putIntArray(key: String, value: IntArray) = this?.putIntArray(key, value)
fun CompoundTag?.putByteArray(key: String, value: ByteArray) = this?.putByteArray(key, value)
fun CompoundTag?.putCompound(key: String, value: CompoundTag) = this?.put(key, value)
fun CompoundTag?.putString(key: String, value: String) = this?.putString(key, value)
fun CompoundTag?.putList(key: String, value: ListTag) = this?.put(key, value)
fun CompoundTag?.putUUID(key: String, value: UUID) = this?.putIntArray(key, UUIDUtil.uuidToIntArray(value))
fun CompoundTag?.put(key: String, value: Tag) = this?.put(key, value)

// Remove

fun CompoundTag?.remove(key: String) = this?.remove(key)

// Gets. Vanilla now returns Optionals (or has *Or variants); these keep the old "default if absent" behaviour for Java callers.

@JvmOverloads
fun CompoundTag?.getBoolean(key: String, defaultExpected: Boolean = false) =
    if (hasNumber(key)) this!!.getByteOr(key, 0.toByte()) != 0.toByte() else defaultExpected

@JvmOverloads
fun CompoundTag?.getByte(key: String, defaultExpected: Byte = 0) =
    (this?.get(key) as? NumericTag)?.byteValue() ?: defaultExpected

@JvmOverloads
fun CompoundTag?.getShort(key: String, defaultExpected: Short = 0) =
    (this?.get(key) as? NumericTag)?.shortValue() ?: defaultExpected

@JvmOverloads
fun CompoundTag?.getInt(key: String, defaultExpected: Int = 0) =
    (this?.get(key) as? NumericTag)?.intValue() ?: defaultExpected

@JvmOverloads
fun CompoundTag?.getLong(key: String, defaultExpected: Long = 0) =
    (this?.get(key) as? NumericTag)?.longValue() ?: defaultExpected

@JvmOverloads
fun CompoundTag?.getFloat(key: String, defaultExpected: Float = 0f) =
    (this?.get(key) as? NumericTag)?.floatValue() ?: defaultExpected

@JvmOverloads
fun CompoundTag?.getDouble(key: String, defaultExpected: Double = 0.0) =
    (this?.get(key) as? NumericTag)?.doubleValue() ?: defaultExpected

fun CompoundTag?.getLongArray(key: String): LongArray? = (this?.get(key) as? LongArrayTag)?.getAsLongArray()
fun CompoundTag?.getIntArray(key: String): IntArray? = (this?.get(key) as? IntArrayTag)?.getAsIntArray()
fun CompoundTag?.getByteArray(key: String): ByteArray? = (this?.get(key) as? ByteArrayTag)?.getAsByteArray()
fun CompoundTag?.getCompound(key: String): CompoundTag? = this?.get(key) as? CompoundTag

fun CompoundTag?.getString(key: String): String? = (this?.get(key) as? StringTag)?.value
fun CompoundTag?.getList(key: String, objType: Byte): ListTag? = if (hasList(key, objType)) this?.get(key) as ListTag else null
fun CompoundTag?.getList(key: String, objType: Int): ListTag? = getList(key, objType.toByte())
fun CompoundTag?.getUUID(key: String): UUID? =
    (this?.get(key) as? IntArrayTag)?.takeIf { it.size() == 4 }?.let { UUIDUtil.uuidFromIntArray(it.getAsIntArray()) }
fun CompoundTag?.get(key: String): Tag? = this?.get(key)

// Get-or-create

fun CompoundTag.getOrCreateCompound(key: String): CompoundTag =
    (this.get(key) as? CompoundTag) ?: CompoundTag().also { putCompound(key, it) }
fun CompoundTag.getOrCreateList(key: String, objType: Byte) = getOrCreateList(key, objType.toInt())
fun CompoundTag.getOrCreateList(key: String, objType: Int): ListTag =
    if (hasList(key, objType)) this.get(key) as ListTag else ListTag().also { putList(key, it) }

// ================================================================================================================ Tag

val Tag.asBoolean get() = (this as? NumericTag)?.byteValue() != 0.toByte()
val Tag.asByte get() = (this as? NumericTag)?.byteValue() ?: 0.toByte()
val Tag.asShort get() = (this as? NumericTag)?.shortValue() ?: 0.toShort()
val Tag.asInt get() = (this as? NumericTag)?.intValue() ?: 0
val Tag.asLong get() = (this as? NumericTag)?.longValue() ?: 0L
val Tag.asFloat get() = (this as? NumericTag)?.floatValue() ?: 0F
val Tag.asDouble get() = (this as? NumericTag)?.doubleValue() ?: 0.0

val Tag.asLongArray: LongArray
    get() = when (this) {
        is LongArrayTag -> this.getAsLongArray()
        is IntArrayTag -> {
            val array = this.getAsIntArray()
            LongArray(array.size) { array[it].toLong() }
        }
        is ByteArrayTag -> {
            val array = this.getAsByteArray()
            LongArray(array.size) { array[it].toLong() }
        }
        else -> LongArray(0)
    }

val Tag.asIntArray: IntArray
    get() = when (this) {
        is IntArrayTag -> this.getAsIntArray()
        is LongArrayTag -> {
            val array = this.getAsLongArray()
            IntArray(array.size) { array[it].toInt() }
        }
        is ByteArrayTag -> {
            val array = this.getAsByteArray()
            IntArray(array.size) { array[it].toInt() }
        }
        else -> IntArray(0)
    }

val Tag.asByteArray: ByteArray
    get() = when (this) {
        is ByteArrayTag -> this.getAsByteArray()
        is LongArrayTag -> {
            val array = this.getAsLongArray()
            ByteArray(array.size) { array[it].toByte() }
        }
        is IntArrayTag -> {
            val array = this.getAsIntArray()
            ByteArray(array.size) { array[it].toByte() }
        }
        else -> ByteArray(0)
    }

val Tag.asCompound get() = this as? CompoundTag ?: CompoundTag()

// asString is defined in Tag
val Tag.asList get() = this as? ListTag ?: ListTag()
val Tag.asUUID: UUID get() = if (this is IntArrayTag && this.size() == 4) UUIDUtil.uuidFromIntArray(this.getAsIntArray()) else UUID(0, 0)
