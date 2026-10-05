package at.petrak.hexcasting.fabric.mixin;

import at.petrak.hexcasting.fabric.event.VillagerConversionCallback;
import net.minecraft.world.entity.ConversionParams;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(Mob.class)
public class FabricMobMixin {
    // All the convertTo overloads funnel through this one (including villager -> witch)
    @Inject(method = "convertTo(Lnet/minecraft/world/entity/EntityType;Lnet/minecraft/world/entity/ConversionParams;Lnet/minecraft/world/entity/EntitySpawnReason;Lnet/minecraft/world/entity/ConversionParams$AfterConversion;)Lnet/minecraft/world/entity/Mob;",
        at = @At("RETURN"))
    public <T extends Mob> void hex$onConvert(EntityType<T> entityType, ConversionParams params,
        EntitySpawnReason spawnReason, ConversionParams.AfterConversion<T> afterConversion,
        CallbackInfoReturnable<T> cir) {
        var self = (Mob) (Object) this;
        var mob = cir.getReturnValue();
        if (mob != null) {
            VillagerConversionCallback.EVENT.invoker().interact(self, mob);
        }
    }
}
