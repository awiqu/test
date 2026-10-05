package at.petrak.hexcasting.common.items.storage;

import at.petrak.hexcasting.api.casting.ActionRegistryEntry;
import at.petrak.hexcasting.api.casting.iota.Iota;
import at.petrak.hexcasting.api.casting.iota.PatternIota;
import at.petrak.hexcasting.api.item.IotaHolderItem;
import at.petrak.hexcasting.client.gui.PatternTooltipComponent;
import at.petrak.hexcasting.common.casting.PatternRegistryManifest;
import at.petrak.hexcasting.common.entities.EntityWallScroll;
import at.petrak.hexcasting.common.lib.HexDataComponents;
import at.petrak.hexcasting.common.misc.PatternTooltip;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.Identifier;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.tooltip.TooltipComponent;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.item.component.TooltipDisplay;
import net.minecraft.world.item.context.UseOnContext;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.gameevent.GameEvent;
import org.jetbrains.annotations.Nullable;

import java.util.function.Consumer;
import java.util.Optional;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

/**
 * TAG_OP_ID and TAG_PATTERN: "Ancient Scroll of %s" (per-world pattern preloaded)
 * <br>
 * TAG_OP_ID: "Ancient Scroll of %s" (per-world pattern loaded on inv tick)
 * <br>
 * TAG_PATTERN: "Scroll" (custom)
 * <br>
 * (none): "Empty Scroll"
 */
public class ItemScroll extends Item implements IotaHolderItem {
    public static final Identifier ANCIENT_PREDICATE = modLoc("ancient");

    public final int blockSize;

    public ItemScroll(Properties pProperties, int blockSize) {
        super(pProperties);
        this.blockSize = blockSize;
    }

    // this produces a scroll that will load the correct pattern for your world once it ticks
    public static ItemStack withPerWorldPattern(ItemStack stack, ResourceKey<ActionRegistryEntry> action) {
        Item item = stack.getItem();
        if (item instanceof ItemScroll) {
            stack.set(HexDataComponents.ACTION.get(), action);
        }

        return stack;
    }

    @Override
    public boolean writeable(ItemStack stack) {
        return true;
    }

    @Override
    public boolean canWrite(ItemStack stack, Iota datum) {
        return datum instanceof PatternIota || datum == null;
    }

    @Override
    public void writeDatum(ItemStack stack, Iota datum) {
        if (this.canWrite(stack, datum)) {
            if (datum instanceof PatternIota pat) {
                stack.set(HexDataComponents.PATTERN.get(), pat.getPattern());
            } else if (datum == null) {
                stack.remove(HexDataComponents.PATTERN.get());
            }
        }
    }

    @Override
    public InteractionResult useOn(UseOnContext ctx) {
        var posClicked = ctx.getClickedPos();
        var direction = ctx.getClickedFace();
        var posInFront = posClicked.relative(direction);
        Player player = ctx.getPlayer();
        ItemStack itemstack = ctx.getItemInHand();
        if (player != null && !this.mayPlace(player, direction, itemstack, posInFront)) {
            return InteractionResult.FAIL;
        }
        var level = ctx.getLevel();
        var scrollStack = itemstack.copy();
        scrollStack.setCount(1);
        var scrollEntity = new EntityWallScroll(level, posInFront, direction, scrollStack, false, this.blockSize);

        // i guess
        EntityType.<EntityWallScroll>createDefaultStackConfig(level, itemstack, player).apply(scrollEntity);

        if (scrollEntity.survives()) {
            if (!level.isClientSide()) {
                scrollEntity.playPlacementSound();
                level.gameEvent(player, GameEvent.ENTITY_PLACE, posClicked);
                level.addFreshEntity(scrollEntity);
            }

            itemstack.shrink(1);
            return InteractionResult.SUCCESS;
        } else {
            return InteractionResult.CONSUME;
        }
    }

    // [VanillaCopy] of HangingEntityItem
    protected boolean mayPlace(Player pPlayer, Direction pDirection, ItemStack pHangingEntityStack, BlockPos pPos) {
        return !pDirection.getAxis().isVertical() && pPlayer.mayUseItemAt(pPos, pDirection, pHangingEntityStack);
    }

    @Override
    public Component getName(ItemStack pStack) {
        var descID = this.getDescriptionId();
        var ancientAction = pStack.get(HexDataComponents.ACTION.get());
        if (ancientAction != null) {
            return Component.translatable(descID + ".of",
                Component.translatable("hexcasting.action." + ancientAction.identifier()));
        } else if (pStack.has(HexDataComponents.PATTERN.get())) {
            var pattern = pStack.get(HexDataComponents.PATTERN.get());
            var patternLabel = Component.literal("");
            if (pattern != null) {
                patternLabel = Component.literal(": ").append(PatternIota.display(pattern));
            }
            return Component.translatable(descID).append(patternLabel);
        } else {
            return Component.translatable(descID + ".empty");
        }
    }

    @Override
    public void inventoryTick(ItemStack pStack, ServerLevel pLevel, Entity pEntity, @Nullable EquipmentSlot pSlot) {
        // the needs_purchase tag is used so you can't see the pattern on scrolls sold by a wandering trader
        // once you put the scroll into your inventory, this removes the tag to reveal the pattern
        if(pStack.has(HexDataComponents.NEEDS_PURCHASE.get()))
            pStack.remove(HexDataComponents.NEEDS_PURCHASE.get());
        // if op_id is set but there's no stored pattern, attempt to load the pattern on inv tick
        if (pStack.has(HexDataComponents.ACTION.get()) && !pStack.has(HexDataComponents.PATTERN.get()) && pLevel.getServer() != null) {
            var action = pStack.get(HexDataComponents.ACTION.get());
            if (action == null) {
                // if the provided op_id is invalid, remove it so we don't keep trying every tick
                pStack.remove(HexDataComponents.ACTION.get());
                return;
            }
            var pat = PatternRegistryManifest.getCanonicalStrokesPerWorld(action, pLevel.getServer().overworld());
            if (pat == null) {
                // if pat is null, the per-world order hasn't been registered; remove the op_id and warn the player
                pStack.set(HexDataComponents.RECALC_WARNING.get(), action);
                pStack.remove(HexDataComponents.ACTION.get());
                return;
            }
            pStack.set(HexDataComponents.PATTERN.get(), pat);
        }
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, TooltipDisplay display, Consumer<Component> tooltipComponents, TooltipFlag tooltipFlag) {
        if (stack.has(HexDataComponents.NEEDS_PURCHASE.get())) {
            var needsPurchase = Component.translatable("hexcasting.tooltip.scroll.needs_purchase");
            tooltipComponents.accept(needsPurchase.withStyle(ChatFormatting.GRAY));
        } else if (stack.has(HexDataComponents.RECALC_WARNING.get())) {
            var spellName = Component.translatable("hexcasting.action." + stack.get(HexDataComponents.RECALC_WARNING.get()).identifier());
            var line1 = Component.translatable("hexcasting.tooltip.scroll.recalc_warning.line1", spellName);
            var line2 = Component.translatable("hexcasting.tooltip.scroll.recalc_warning.line2");
            tooltipComponents.accept(line1.withStyle(ChatFormatting.RED));
            tooltipComponents.accept(line2.withStyle(ChatFormatting.RED));
        } else if (stack.has(HexDataComponents.ACTION.get()) && !stack.has(HexDataComponents.PATTERN.get())) {
            var notLoaded = Component.translatable("hexcasting.tooltip.scroll.pattern_not_loaded");
            tooltipComponents.accept(notLoaded.withStyle(ChatFormatting.GRAY));
        }
    }

    @Override
    public Optional<TooltipComponent> getTooltipImage(ItemStack stack) {
        var pattern = stack.get(HexDataComponents.PATTERN.get());
        if (pattern != null && !stack.has(HexDataComponents.NEEDS_PURCHASE.get())) {
            return Optional.of(new PatternTooltip(
                pattern,
                    stack.has(HexDataComponents.ACTION.get())
                    ? PatternTooltipComponent.ANCIENT_BG
                    : PatternTooltipComponent.PRISTINE_BG));
        }

        return Optional.empty();
    }

    @Override
    public @Nullable Iota readIota(ItemStack stack) {
        var pattern = stack.get(HexDataComponents.PATTERN.get());
        return pattern != null ? new PatternIota(pattern) : null;
    }
}
