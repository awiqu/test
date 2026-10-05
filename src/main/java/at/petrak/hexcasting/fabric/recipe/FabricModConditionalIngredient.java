package at.petrak.hexcasting.fabric.recipe;

import at.petrak.hexcasting.xplat.IXplatAbstractions;
import com.mojang.serialization.Codec;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.fabricmc.fabric.api.recipe.v1.ingredient.CustomIngredient;
import net.fabricmc.fabric.api.recipe.v1.ingredient.CustomIngredientSerializer;
import net.minecraft.core.Holder;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.display.SlotDisplay;

import java.util.stream.Stream;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

/**
 * Acts as {@code ifModLoaded} if the mod is loaded, as {@code main} otherwise.
 */
public class FabricModConditionalIngredient implements CustomIngredient {
    public static final Identifier ID = modLoc("mod_conditional");

    private final Ingredient main;
    private final String modid;
    private final Ingredient ifModLoaded;

    private final Ingredient toUse;

    public static final MapCodec<FabricModConditionalIngredient> CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
        Ingredient.CODEC.fieldOf("main").forGetter(FabricModConditionalIngredient::getMain),
        Codec.STRING.fieldOf("modid").forGetter(FabricModConditionalIngredient::getModid),
        Ingredient.CODEC.fieldOf("ifModLoaded").forGetter(FabricModConditionalIngredient::getIfModLoaded)
    ).apply(instance, FabricModConditionalIngredient::new));

    public static final StreamCodec<RegistryFriendlyByteBuf, FabricModConditionalIngredient> STREAM_CODEC = StreamCodec.composite(
        Ingredient.CONTENTS_STREAM_CODEC, FabricModConditionalIngredient::getMain,
        ByteBufCodecs.STRING_UTF8, FabricModConditionalIngredient::getModid,
        Ingredient.CONTENTS_STREAM_CODEC, FabricModConditionalIngredient::getIfModLoaded,
        FabricModConditionalIngredient::new
    );

    protected FabricModConditionalIngredient(Ingredient main, String modid, Ingredient ifModLoaded) {
        this.main = main;
        this.modid = modid;
        this.ifModLoaded = ifModLoaded;

        this.toUse = IXplatAbstractions.INSTANCE.isModPresent(modid) ? ifModLoaded : main;
    }

    public static Ingredient of(Ingredient main, String modid, Ingredient ifModLoaded) {
        return new FabricModConditionalIngredient(main, modid, ifModLoaded).toVanilla();
    }

    @Override
    public boolean test(ItemStack input) {
        return toUse.test(input);
    }

    @Override
    @SuppressWarnings("deprecation")
    public Stream<Holder<Item>> items() {
        return toUse.items();
    }

    @Override
    public SlotDisplay display() {
        return toUse.display();
    }

    @Override
    public boolean requiresTesting() {
        return toUse.requiresTesting();
    }

    public Ingredient getMain() {
        return main;
    }

    public Ingredient getToUse() {
        return toUse;
    }

    public Ingredient getIfModLoaded() {
        return ifModLoaded;
    }

    public String getModid() {
        return modid;
    }

    @Override
    public CustomIngredientSerializer<?> getSerializer() {
        return Serializer.INSTANCE;
    }

    public static class Serializer implements CustomIngredientSerializer<FabricModConditionalIngredient> {
        public static final Serializer INSTANCE = new Serializer();

        @Override
        public Identifier getIdentifier() {
            return FabricModConditionalIngredient.ID;
        }

        @Override
        public MapCodec<FabricModConditionalIngredient> getCodec() {
            return CODEC;
        }

        @Override
        public StreamCodec<RegistryFriendlyByteBuf, FabricModConditionalIngredient> getStreamCodec() {
            return STREAM_CODEC;
        }
    }
}
