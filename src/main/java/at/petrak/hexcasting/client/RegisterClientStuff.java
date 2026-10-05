package at.petrak.hexcasting.client;

import at.petrak.hexcasting.client.entity.WallScrollRenderer;
import at.petrak.hexcasting.client.render.ScryingLensOverlays;
import at.petrak.hexcasting.client.render.be.BlockEntityAkashicBookshelfRenderer;
import at.petrak.hexcasting.client.render.be.BlockEntityQuenchedAllayRenderer;
import at.petrak.hexcasting.client.render.be.BlockEntitySlateRenderer;
import at.petrak.hexcasting.common.blocks.BlockQuenchedAllay;
import at.petrak.hexcasting.common.blocks.akashic.BlockAkashicBookshelf;
import at.petrak.hexcasting.common.blocks.akashic.BlockEntityAkashicBookshelf;
import at.petrak.hexcasting.common.entities.HexEntities;
import at.petrak.hexcasting.common.lib.HexBlockEntities;
import at.petrak.hexcasting.common.lib.HexBlocks;
import at.petrak.hexcasting.xplat.IClientXplatAbstractions;
import net.fabricmc.fabric.api.client.model.loading.v1.ExtraModelKey;
import net.fabricmc.fabric.api.client.model.loading.v1.ModelLoadingPlugin;
import net.fabricmc.fabric.api.client.model.loading.v1.SimpleUnbakedExtraModel;
import net.fabricmc.fabric.api.client.rendering.v1.BlockColorRegistry;
import net.minecraft.client.renderer.block.dispatch.BlockStateModel;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import org.jetbrains.annotations.NotNull;

import java.util.*;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

public class RegisterClientStuff {
    /**
     * The extra models that make up the different variants of the quenched allay blocks, keyed by the block's ID.
     * The quenched allay BER cycles through them.
     */
    public static final Map<Identifier, List<ExtraModelKey<BlockStateModel>>> QUENCHED_ALLAY_VARIANTS = new HashMap<>();
    private static final Map<BlockQuenchedAllay, Boolean> QUENCHED_ALLAY_TYPES = Map.of(
            HexBlocks.QUENCHED_ALLAY.get(), false,
            HexBlocks.QUENCHED_ALLAY_TILES.get(), true,
            HexBlocks.QUENCHED_ALLAY_BRICKS.get(), true,
            HexBlocks.QUENCHED_ALLAY_BRICKS_SMALL.get(), true);

    public static void init() {
        // The old "item properties" are now custom properties used by the item model definitions
        HexItemProperties.register();

        IClientXplatAbstractions.INSTANCE.registerEntityRenderer(HexEntities.WALL_SCROLL.get(),
            WallScrollRenderer::new);

        ScryingLensOverlays.addScryingLensStuff();
    }

    public static void registerColorProviders() {
        BlockColorRegistry.register((state, level, pos, tints) -> {
            tints.size(1);
            tints.set(0, 0xff_ffffff);
            if (!state.getValue(BlockAkashicBookshelf.HAS_BOOKS) || level == null || pos == null) {
                return;
            }
            var tile = level.getBlockEntity(pos);
            if (!(tile instanceof BlockEntityAkashicBookshelf beas)) {
                // this gets called for particles for some irritating reason
                return;
            }
            var iota = beas.getIota();
            if (iota == null) {
                return;
            }
            tints.set(0, 0xff_000000 | iota.getType().color());
        }, HexBlocks.AKASHIC_BOOKSHELF.get());
    }

    public static void registerBlockEntityRenderers(@NotNull BlockEntityRendererRegisterererer registerer) {
        registerer.registerBlockEntityRenderer(HexBlockEntities.SLATE_TILE.get(), BlockEntitySlateRenderer::new);
        registerer.registerBlockEntityRenderer(HexBlockEntities.AKASHIC_BOOKSHELF_TILE.get(),
            BlockEntityAkashicBookshelfRenderer::new);
        registerer.registerBlockEntityRenderer(HexBlockEntities.QUENCHED_ALLAY_TILE.get(),
            BlockEntityQuenchedAllayRenderer::new);
        registerer.registerBlockEntityRenderer(HexBlockEntities.QUENCHED_ALLAY_TILES_TILE.get(),
                BlockEntityQuenchedAllayRenderer::new);
        registerer.registerBlockEntityRenderer(HexBlockEntities.QUENCHED_ALLAY_BRICKS_TILE.get(),
                BlockEntityQuenchedAllayRenderer::new);
        registerer.registerBlockEntityRenderer(HexBlockEntities.QUENCHED_ALLAY_BRICKS_SMALL_TILE.get(),
                BlockEntityQuenchedAllayRenderer::new);
    }

    @FunctionalInterface
    public interface BlockEntityRendererRegisterererer {
        <T extends BlockEntity, S extends BlockEntityRenderState> void registerBlockEntityRenderer(
            BlockEntityType<T> type, BlockEntityRendererProvider<? super T, ? super S> berp);
    }

    /**
     * Get the variants (in order) of the given quenched allay block, if it is one.
     */
    public static List<ExtraModelKey<BlockStateModel>> quenchedAllayVariants(Block block) {
        return QUENCHED_ALLAY_VARIANTS.getOrDefault(BuiltInRegistries.BLOCK.getKey(block), List.of());
    }

    public static void onModelRegister(ModelLoadingPlugin.Context context) {
        if (QUENCHED_ALLAY_VARIANTS.isEmpty()) {
            for (var type : QUENCHED_ALLAY_TYPES.entrySet()) {
                var blockLoc = BuiltInRegistries.BLOCK.getKey(type.getKey());
                var keys = new ArrayList<ExtraModelKey<BlockStateModel>>();
                for (int i = 0; i < BlockQuenchedAllay.VARIANTS; i++) {
                    var id = quenchedAllayModelId(type.getValue(), blockLoc, i);
                    keys.add(ExtraModelKey.create(id::toString));
                }
                QUENCHED_ALLAY_VARIANTS.put(blockLoc, keys);
            }
        }

        for (var type : QUENCHED_ALLAY_TYPES.entrySet()) {
            var blockLoc = BuiltInRegistries.BLOCK.getKey(type.getKey());
            var keys = QUENCHED_ALLAY_VARIANTS.get(blockLoc);
            for (int i = 0; i < BlockQuenchedAllay.VARIANTS; i++) {
                context.addModel(keys.get(i),
                    SimpleUnbakedExtraModel.blockStateModel(quenchedAllayModelId(type.getValue(), blockLoc, i)));
            }
        }
    }

    private static Identifier quenchedAllayModelId(boolean isDeco, Identifier blockLoc, int variant) {
        var locStart = "block/";
        if (isDeco)
            locStart += "deco/";
        return modLoc(locStart + blockLoc.getPath() + "_" + variant);
    }
}
