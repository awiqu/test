package at.petrak.hexcasting.api.casting.eval

import at.petrak.hexcasting.api.utils.NBTBuilder
import net.minecraft.core.BlockPos
import net.minecraft.nbt.CompoundTag
import net.minecraft.world.phys.AABB

/**
 * Optional field on a [CastingEnvironment] for the spell circle
 */
data class SpellCircleContext(val impetusPos: BlockPos, val aabb: AABB, val activatorAlwaysInRange: Boolean) {
    fun serializeToNBT() = NBTBuilder {
        TAG_IMPETUS_X %= impetusPos.x
        TAG_IMPETUS_Y %= impetusPos.y
        TAG_IMPETUS_Z %= impetusPos.z

        TAG_MIN_X %= aabb.minX
        TAG_MIN_Y %= aabb.minY
        TAG_MIN_Z %= aabb.minZ
        TAG_MAX_X %= aabb.maxX
        TAG_MAX_Y %= aabb.maxY
        TAG_MAX_Z %= aabb.maxZ

        TAG_PLAYER_ALWAYS_IN_RANGE %= activatorAlwaysInRange
    }

    companion object {
        const val TAG_IMPETUS_X = "impetus_x"
        const val TAG_IMPETUS_Y = "impetus_y"
        const val TAG_IMPETUS_Z = "impetus_z"
        const val TAG_MIN_X = "min_x"
        const val TAG_MIN_Y = "min_y"
        const val TAG_MIN_Z = "min_z"
        const val TAG_MAX_X = "max_x"
        const val TAG_MAX_Y = "max_y"
        const val TAG_MAX_Z = "max_z"
        const val TAG_PLAYER_ALWAYS_IN_RANGE = "player_always_in_range"

        fun fromNBT(tag: CompoundTag): SpellCircleContext {
            val impX = tag.getIntOr(TAG_IMPETUS_X, 0)
            val impY = tag.getIntOr(TAG_IMPETUS_Y, 0)
            val impZ = tag.getIntOr(TAG_IMPETUS_Z, 0)

            val minX = tag.getDoubleOr(TAG_MIN_X, 0.0)
            val minY = tag.getDoubleOr(TAG_MIN_Y, 0.0)
            val minZ = tag.getDoubleOr(TAG_MIN_Z, 0.0)
            val maxX = tag.getDoubleOr(TAG_MAX_X, 0.0)
            val maxY = tag.getDoubleOr(TAG_MAX_Y, 0.0)
            val maxZ = tag.getDoubleOr(TAG_MAX_Z, 0.0)

            val playerAIR = tag.getBooleanOr(TAG_PLAYER_ALWAYS_IN_RANGE, false)

            return SpellCircleContext(BlockPos(impX, impY, impZ), AABB(minX, minY, minZ, maxX, maxY, maxZ), playerAIR)
        }
    }
}
