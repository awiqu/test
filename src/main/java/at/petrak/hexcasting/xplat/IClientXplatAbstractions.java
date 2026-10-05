package at.petrak.hexcasting.xplat;

import at.petrak.hexcasting.api.HexAPI;
import at.petrak.hexcasting.api.client.ClientCastingStack;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.AABB;

import java.util.ServiceLoader;
import java.util.stream.Collectors;

public interface IClientXplatAbstractions {
    void sendPacketToServer(CustomPacketPayload packet);

    void initPlatformSpecific();

    <T extends Entity> void registerEntityRenderer(EntityType<? extends T> type, EntityRendererProvider<T> renderer);

    ClientCastingStack getClientCastingStack(Player player);

    boolean fabricAdditionalQuenchFrustumCheck(AABB aabb);

    IClientXplatAbstractions INSTANCE = find();
    private static IClientXplatAbstractions find() {
        var providers = ServiceLoader.load(IClientXplatAbstractions.class).stream().toList();
        if (providers.size() != 1) {
            var names = providers.stream().map(p -> p.type().getName()).collect(Collectors.joining(",", "[", "]"));
            throw new IllegalStateException(
                "There should be exactly one IClientXplatAbstractions implementation on the classpath. Found: " + names);
        } else {
            var provider = providers.get(0);
            HexAPI.LOGGER.debug("Instantiating client xplat impl: " + provider.type().getName());
            return provider.get();
        }
    }
}
