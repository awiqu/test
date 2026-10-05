package at.petrak.hexcasting.common.recipe;

import at.petrak.hexcasting.api.mod.HexTags;
import at.petrak.hexcasting.common.items.storage.ItemFocus;
import at.petrak.hexcasting.common.items.storage.ItemSpellbook;
import at.petrak.hexcasting.common.lib.HexDataComponents;
import at.petrak.hexcasting.common.lib.HexItems;
import com.mojang.serialization.MapCodec;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.util.StringRepresentable;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CustomRecipe;
import net.minecraft.world.item.crafting.RecipeSerializer;
import net.minecraft.world.level.Level;
import org.jetbrains.annotations.NotNull;

import java.util.Locale;

public class SealThingsRecipe extends CustomRecipe {
    public final Sealee sealee;

    // The recipe json only has the type (and a vanilla "category" field, which we don't care about)
    public static final RecipeSerializer<SealThingsRecipe> FOCUS_SERIALIZER = serializerFor(Sealee.FOCUS);
    public static final RecipeSerializer<SealThingsRecipe> SPELLBOOK_SERIALIZER = serializerFor(Sealee.SPELLBOOK);

    private static RecipeSerializer<SealThingsRecipe> serializerFor(Sealee sealee) {
        return new RecipeSerializer<>(
            MapCodec.unit(() -> new SealThingsRecipe(sealee)),
            StreamCodec.<RegistryFriendlyByteBuf, SealThingsRecipe>unit(new SealThingsRecipe(sealee)));
    }

    public SealThingsRecipe(Sealee sealee) {
        this.sealee = sealee;
    }

    @Override
    public boolean matches(CraftingInput container, Level level) {
        boolean foundComb = false;
        boolean foundSealee = false;

        for (int i = 0; i < container.size(); i++) {
            var stack = container.getItem(i);
            if (this.sealee.isCorrectSealee(stack)) {
                if (foundSealee) return false;
                foundSealee = true;
            } else if (stack.is(HexTags.Items.SEAL_MATERIALS)) {
                if (foundComb) return false;
                foundComb = true;
            }
        }

        return foundComb && foundSealee;
    }

    @Override
    public @NotNull ItemStack assemble(CraftingInput inv) {
        ItemStack sealee = ItemStack.EMPTY;

        for (int i = 0; i < inv.size(); i++) {
            var stack = inv.getItem(i);
            if (this.sealee.isCorrectSealee(stack)) {
                sealee = stack.copy();
                break;
            }
        }

        if (!sealee.isEmpty()) {
            this.sealee.seal(sealee);
            sealee.setCount(1);
        }

        return sealee;
    }

    @Override
    public @NotNull RecipeSerializer<SealThingsRecipe> getSerializer() {
        return switch (this.sealee) {
            case FOCUS -> FOCUS_SERIALIZER;
            case SPELLBOOK -> SPELLBOOK_SERIALIZER;
        };
    }

    public enum Sealee implements StringRepresentable {
        FOCUS,
        SPELLBOOK;

        @Override
        public String getSerializedName() {
            return this.name().toLowerCase(Locale.ROOT);
        }

        public boolean isCorrectSealee(ItemStack stack) {
            return switch (this) {
                case FOCUS -> stack.is(HexItems.FOCUS.get())
                    && stack.has(HexDataComponents.IOTA_HOLDER_IOTA.get())
                    && !ItemFocus.isSealed(stack);
                case SPELLBOOK -> stack.is(HexItems.SPELLBOOK.get())
                    && HexItems.SPELLBOOK.get().readIota(stack) != null
                    && !ItemSpellbook.isSealed(stack);
            };
        }

        public void seal(ItemStack stack) {
            switch (this) {
                case FOCUS -> {
                    ItemFocus.seal(stack);
                }
                case SPELLBOOK -> {
                    ItemSpellbook.setSealed(stack, true);
                }
            }
        }
    }
}

