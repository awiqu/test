package at.petrak.hexcasting.interop.patchouli;

import net.minecraft.client.Minecraft;
import vazkii.patchouli.client.base.ClientRecipes;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.*;
import vazkii.patchouli.api.IVariable;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * > no this is a "literally copy these files/parts of file into your mod"
 * > we should put this in patchy but lol
 * > lazy
 * -- Hubry Vazcord
 */
public class PatchouliUtils {
    @SuppressWarnings("unchecked")
    public static <T extends Recipe<I>, I extends RecipeInput> T getRecipe(RecipeType<T> type, Identifier id) {
        // PageDoubleRecipeRegistry
        // Clients no longer know about recipes, but Patchouli has its own copy of all of them.
        RecipeHolder<?> holder = ClientRecipes.INSTANCE.getRecipeById(ResourceKey.create(Registries.RECIPE, id));
        if (holder == null || holder.value().getType() != type) {
            return null;
        }
        return (T) holder.value();
    }

    /**
     * The items an ingredient matches, as stacks. An absent ingredient matches only an empty stack.
     */
    public static ItemStack[] stacksOf(Ingredient ingredient) {
        if (ingredient == null || ingredient.isEmpty()) {
            return new ItemStack[]{ItemStack.EMPTY};
        }
        return ingredient.items().map(holder -> new ItemStack(holder.value())).toArray(ItemStack[]::new);
    }

    /**
     * Combines the ingredients, returning the first matching stack of each, then the second stack of each, etc.
     * looping back ingredients that run out of matched stacks, until the ingredients reach the length
     * of the longest ingredient in the recipe set.
     *
     * @param ingredients           List of ingredients in the specific slot
     * @param longestIngredientSize Longest ingredient in the entire recipe
     * @return Serialized Patchouli ingredient string
     */
    public static IVariable interweaveIngredients(List<Ingredient> ingredients, int longestIngredientSize, HolderLookup.RegistryLookup.Provider registries) {
        if (ingredients.size() == 1) {
            return IVariable.wrapList(Arrays.stream(stacksOf(ingredients.get(0)))
                    .map(v -> IVariable.from(v, registries))
                    .collect(Collectors.toList()), registries);
        }

        ItemStack[] empty = {ItemStack.EMPTY};
        List<ItemStack[]> stacks = new ArrayList<>();
        for (Ingredient ingredient : ingredients) {
            if (ingredient != null && !ingredient.isEmpty()) {
                stacks.add(stacksOf(ingredient));
            } else {
                stacks.add(empty);
            }
        }
        List<IVariable> list = new ArrayList<>(stacks.size() * longestIngredientSize);
        for (int i = 0; i < longestIngredientSize; i++) {
            for (ItemStack[] stack : stacks) {
                list.add(IVariable.from(stack[i % stack.length], registries));
            }
        }
        return IVariable.wrapList(list, registries);
    }

    /**
     * Overload of the method above that uses the provided list's longest ingredient size.
     */
    public static IVariable interweaveIngredients(List<Ingredient> ingredients, HolderLookup.RegistryLookup.Provider registries) {
        return interweaveIngredients(ingredients,
            ingredients.stream().mapToInt(ingr -> stacksOf(ingr).length).max().orElse(1), registries
        );
    }
}
