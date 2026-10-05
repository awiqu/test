package at.petrak.hexcasting.fabric.xplat;

import at.petrak.hexcasting.xplat.IXplatRegister;
import at.petrak.hexcasting.xplat.RegisterContext;
import net.minecraft.core.Holder;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceKey;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

public class FabricRegister<B> implements IXplatRegister<B> {
    private final Registry<B> register;

    @SuppressWarnings("unchecked")
    public FabricRegister(ResourceKey<Registry<B>> registryKey) {
        this.register = (Registry<B>) BuiltInRegistries.REGISTRY.getValue(registryKey.identifier());
    }


    @Override
    public <T extends B> Supplier<T> register(String id, Supplier<T> provider) {
        T value = create(id, provider);
        return () -> value;
    }

    @Override
    public <T extends B> Holder<B> registerHolder(String id, Supplier<T> provider) {
        T value = create(id, provider);
        return register.wrapAsHolder(value);
    }

    private <T extends B> T create(String id, Supplier<T> provider) {
        ResourceKey<B> key = ResourceKey.create(register.key(), modLoc(id));
        var previous = RegisterContext.get();
        RegisterContext.set(key);
        T value;
        try {
            value = provider.get();
        } finally {
            RegisterContext.set(previous);
        }
        return Registry.register(register, key, value);
    }

    @Override
    public void registerAll() {
        // This is fabric. we register eagerly.
    }
}
