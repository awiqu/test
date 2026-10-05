package at.petrak.hexcasting.common.items.storage;

import at.petrak.hexcasting.api.casting.iota.Iota;
import at.petrak.hexcasting.api.item.IotaHolderItem;
import at.petrak.hexcasting.common.lib.HexDataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.component.TooltipDisplay;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.function.Consumer;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

// Would love to be able to just write to a piece of string but the api requires it to be the same item
public class ItemThoughtKnot extends Item implements IotaHolderItem {
    public static final Identifier WRITTEN_PRED = modLoc("written");

    public ItemThoughtKnot(Properties properties) {
        super(properties);
    }

    @Override
    public boolean writeable(ItemStack stack) {
        return !stack.has(HexDataComponents.IOTA_HOLDER_IOTA.get());
    }

    @Override
    public boolean canWrite(ItemStack stack, @Nullable Iota iota) {
        return iota != null && writeable(stack);
    }

    @Override
    public void writeDatum(ItemStack stack, @Nullable Iota iota) {
        if (iota != null) {
            stack.set(HexDataComponents.IOTA_HOLDER_IOTA.get(), iota);
        }
    }

    @Override
    public void appendHoverText(ItemStack pStack, TooltipContext context, TooltipDisplay display,
        Consumer<Component> pTooltipComponents, TooltipFlag pIsAdvanced) {
        var lines = new ArrayList<Component>();
        IotaHolderItem.appendHoverText(this, pStack, lines, pIsAdvanced);
        lines.forEach(pTooltipComponents);
    }
}
