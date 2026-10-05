package at.petrak.hexcasting.common.misc;

import at.petrak.hexcasting.api.HexAPI;
import at.petrak.hexcasting.mixin.accessor.AccessorAbstractArrow;
import at.petrak.hexcasting.mixin.accessor.AccessorVillager;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.ai.memory.MemoryModuleType;
import net.minecraft.world.entity.projectile.arrow.AbstractArrow;
import net.minecraft.world.phys.Vec3;

public class RegisterMisc {
    public static void register() {
        HexAPI.instance().registerSpecialVelocityGetter(EntityTypes.PLAYER, player -> {
            if (player instanceof ServerPlayer splayer) {
                return PlayerPositionRecorder.getMotion(splayer);
            } else {
                // bruh
                throw new IllegalStateException("Call this only on the server side, silly");
            }
        });

        HexAPI.instance().registerSpecialVelocityGetter(EntityTypes.ARROW, RegisterMisc::arrowVelocitizer);
        HexAPI.instance().registerSpecialVelocityGetter(EntityTypes.SPECTRAL_ARROW, RegisterMisc::arrowVelocitizer);
        // this is an arrow apparently
        HexAPI.instance().registerSpecialVelocityGetter(EntityTypes.TRIDENT, RegisterMisc::arrowVelocitizer);
        HexAPI.instance().registerSpecialVelocityGetter(EntityTypes.ITEM, item -> {
            // Items only tick movement every four ticks if stationary and on ground, but gravity is added every tick
            // and only cleared by movement logic every four ticks
            if (item.onGround() && item.getDeltaMovement().horizontalDistanceSqr() <= 1.0E-5F) return Vec3.ZERO;
            return item.getDeltaMovement();
        });

        HexAPI.instance().registerCustomBrainsweepingBehavior(EntityTypes.VILLAGER, villager -> {
            ((AccessorVillager) villager).hex$releaseAllPois();
            HexAPI.instance().defaultBrainsweepingBehavior().accept(villager);
        });
        HexAPI.instance().registerCustomBrainsweepingBehavior(EntityTypes.ALLAY, allay -> {
            allay.getBrain().eraseMemory(MemoryModuleType.LIKED_PLAYER);
            HexAPI.instance().defaultBrainsweepingBehavior().accept(allay);
        });
    }

    private static Vec3 arrowVelocitizer(AbstractArrow arrow) {
        if (((AccessorAbstractArrow) arrow).hex$isInGround()) {
            return Vec3.ZERO;
        } else {
            return arrow.getDeltaMovement();
        }
    }
}
