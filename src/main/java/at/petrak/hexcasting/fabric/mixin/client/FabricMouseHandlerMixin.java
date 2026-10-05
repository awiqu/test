package at.petrak.hexcasting.fabric.mixin.client;

import at.petrak.hexcasting.fabric.event.MouseScrollCallback;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.ScrollWheelHandler;
import org.joml.Vector2i;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

@Mixin(MouseHandler.class)
public class FabricMouseHandlerMixin {
    /**
     * When scrolling in the world (not in a screen), vanilla scrolls the hotbar. Let us have a go at it first.
     */
    @WrapOperation(method = "onScroll", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/ScrollWheelHandler;onMouseScroll(DD)Lorg/joml/Vector2i;"))
    private Vector2i hex$onScroll(ScrollWheelHandler instance, double x, double y, Operation<Vector2i> original) {
        Vector2i wheel = original.call(instance, x, y);
        if (wheel.x == 0 && wheel.y == 0) {
            return wheel;
        }
        int delta = wheel.y == 0 ? -wheel.x : wheel.y;
        if (MouseScrollCallback.EVENT.invoker().interact(delta)) {
            return new Vector2i(0, 0);
        }
        return wheel;
    }
}
