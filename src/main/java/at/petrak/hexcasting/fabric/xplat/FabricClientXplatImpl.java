package at.petrak.hexcasting.fabric.xplat;

import at.petrak.hexcasting.api.client.ClientCastingStack;
import at.petrak.hexcasting.fabric.cc.HexCardinalComponents;
import at.petrak.hexcasting.interop.HexInterop;
import at.petrak.hexcasting.xplat.IClientXplatAbstractions;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.AABB;

public class FabricClientXplatImpl implements IClientXplatAbstractions {
    @Override
    public void sendPacketToServer(CustomPacketPayload packet) {
        ClientPlayNetworking.send(packet);
    }

    @Override
    public void initPlatformSpecific() {
    }

    @Override
    public <T extends Entity> void registerEntityRenderer(EntityType<? extends T> type,
        EntityRendererProvider<T> renderer) {
        EntityRendererRegistry.register(type, renderer);
    }

    @Override
    public ClientCastingStack getClientCastingStack(Player player) {
        return HexCardinalComponents.CLIENT_CASTING_STACK.get(player).getClientCastingStack();
    }

    @Override
    public boolean fabricAdditionalQuenchFrustumCheck(AABB aabb) {
        // Vanilla does its own culling of block entities now.
        return true;
    }
}
