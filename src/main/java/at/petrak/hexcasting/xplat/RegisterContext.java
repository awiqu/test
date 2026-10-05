package at.petrak.hexcasting.xplat;

import net.minecraft.core.Registry;
import net.minecraft.resources.ResourceKey;
import org.jetbrains.annotations.Nullable;

/**
 * Since Minecraft 1.21.2, every Item.Properties and BlockBehaviour.Properties has to know its registry key
 * before the Item/Block is constructed. Registries call the (lazy) suppliers handed to {@link IXplatRegister}
 * while this context holds the key being registered, so that {@code HexItems.props()} and friends can fill it in.
 */
public final class RegisterContext {
    private static final ThreadLocal<ResourceKey<?>> CURRENT = new ThreadLocal<>();

    private RegisterContext() {
    }

    @Nullable
    public static ResourceKey<?> get() {
        return CURRENT.get();
    }

    public static void set(@Nullable ResourceKey<?> key) {
        if (key == null) {
            CURRENT.remove();
        } else {
            CURRENT.set(key);
        }
    }

    public static <B> ResourceKey<B> current(ResourceKey<? extends Registry<B>> registry) {
        var key = CURRENT.get();
        if (key == null) {
            throw new IllegalStateException("No registry key is currently being registered");
        }
        if (!key.registry().equals(registry.identifier())) {
            throw new IllegalStateException("Currently registering " + key + ", not an entry of " + registry);
        }
        @SuppressWarnings("unchecked")
        var out = (ResourceKey<B>) key;
        return out;
    }
}
