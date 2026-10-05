package at.petrak.hexcasting.fabric.recipe;

import at.petrak.hexcasting.common.items.storage.ItemFocus;
import at.petrak.hexcasting.common.items.storage.ItemSpellbook;
import com.mojang.serialization.MapCodec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import net.fabricmc.fabric.api.recipe.v1.ingredient.CustomIngredient;
import net.fabricmc.fabric.api.recipe.v1.ingredient.CustomIngredientSerializer;
import net.minecraft.core.Holder;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Ingredient;

import java.util.stream.Stream;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

/**
 * Matches the item of the given stack as long as it hasn't been sealed (by honeycomb).
 */
public class FabricUnsealedIngredient implements CustomIngredient {
    public static final Identifier ID = modLoc("unsealed");

    private final ItemStack stack;

    public static final MapCodec<FabricUnsealedIngredient> CODEC = RecordCodecBuilder.mapCodec(instance -> instance.group(
        ItemStack.CODEC.fieldOf("item").forGetter(FabricUnsealedIngredient::getStack)
    ).apply(instance, FabricUnsealedIngredient::new));

    public static final StreamCodec<RegistryFriendlyByteBuf, FabricUnsealedIngredient> STREAM_CODEC = StreamCodec.composite(
        ItemStack.STREAM_CODEC, FabricUnsealedIngredient::getStack,
        FabricUnsealedIngredient::new
    );

    protected FabricUnsealedIngredient(ItemStack stack) {
        this.stack = stack;
    }

    public ItemStack getStack() {
        return stack;
    }

    public Identifier getId() {
        return ID;
    }

    /**
     * Creates a new ingredient matching the item of the given stack
     */
    public static Ingredient of(ItemStack stack) {
        return new FabricUnsealedIngredient(stack).toVanilla();
    }

    private static boolean isSealed(ItemStack input) {
        return ItemFocus.isSealed(input) || (input.getItem() instanceof ItemSpellbook && ItemSpellbook.isSealed(input));
    }

    @Override
    public boolean test(ItemStack input) {
        return input.is(stack.getItem()) && !isSealed(input);
    }

    @Override
    public Stream<Holder<Item>> items() {
        return Stream.of(stack.typeHolder());
    }

    @Override
    public boolean requiresTesting() {
        return true;
    }

    @Override
    public CustomIngredientSerializer<?> getSerializer() {
        return Serializer.INSTANCE;
    }

    public static class Serializer implements CustomIngredientSerializer<FabricUnsealedIngredient> {
        public static final Serializer INSTANCE = new Serializer();

        @Override
        public Identifier getIdentifier() {
            return FabricUnsealedIngredient.ID;
        }

        @Override
        public MapCodec<FabricUnsealedIngredient> getCodec() {
            return CODEC;
        }

        @Override
        public StreamCodec<RegistryFriendlyByteBuf, FabricUnsealedIngredient> getStreamCodec() {
            return STREAM_CODEC;
        }
    }
}
