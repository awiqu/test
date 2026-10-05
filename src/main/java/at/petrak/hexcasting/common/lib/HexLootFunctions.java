package at.petrak.hexcasting.common.lib;

import at.petrak.hexcasting.common.loot.AddHexToAncientCypherFunc;
import at.petrak.hexcasting.common.loot.AddPerWorldPatternToScrollFunc;
import at.petrak.hexcasting.common.loot.AmethystReducerFunc;
import at.petrak.hexcasting.xplat.IXplatAbstractions;
import at.petrak.hexcasting.xplat.IXplatRegister;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.level.storage.loot.functions.LootItemConditionalFunction;
import com.mojang.serialization.MapCodec;
import net.minecraft.world.level.storage.loot.functions.LootItemFunction;

import java.util.function.Supplier;

public class HexLootFunctions {
    private static final IXplatRegister<MapCodec<? extends LootItemFunction>> REGISTER = IXplatAbstractions.INSTANCE.createRegistar(Registries.LOOT_FUNCTION_TYPE);

    public static void register() {
        REGISTER.registerAll();
    }

    public static final Supplier<MapCodec<? extends LootItemConditionalFunction>> PATTERN_SCROLL = REGISTER.register("pattern_scroll",
            () -> AddPerWorldPatternToScrollFunc.CODEC);
    public static final Supplier<MapCodec<? extends LootItemConditionalFunction>> HEX_CYPHER = REGISTER.register("hex_cypher",
            () -> AddHexToAncientCypherFunc.CODEC);
    public static final Supplier<MapCodec<? extends LootItemConditionalFunction>> AMETHYST_SHARD_REDUCER = REGISTER.register("amethyst_shard_reducer",
            () -> AmethystReducerFunc.CODEC);
}
