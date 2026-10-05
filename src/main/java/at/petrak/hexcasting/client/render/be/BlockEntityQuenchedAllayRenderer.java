package at.petrak.hexcasting.client.render.be;

import at.petrak.hexcasting.client.RegisterClientStuff;
import at.petrak.hexcasting.client.render.GaslightingTracker;
import at.petrak.hexcasting.common.blocks.BlockQuenchedAllay;
import at.petrak.hexcasting.common.blocks.entity.BlockEntityQuenchedAllay;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.Sheets;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.block.dispatch.BlockStateModel;
import net.minecraft.client.renderer.block.dispatch.BlockStateModelPart;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.util.RandomSource;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;

// TODO: this doesn't cover the block being *behind* something. Is it possible to cleanly do that?
// it would probably require some depth-texture bullshit that I don't want to worry about
public class BlockEntityQuenchedAllayRenderer implements BlockEntityRenderer<BlockEntityQuenchedAllay, BlockEntityQuenchedAllayRenderer.State> {
    private static final int[] NO_TINTS = new int[0];

    public BlockEntityQuenchedAllayRenderer(BlockEntityRendererProvider.Context ctx) {
    }

    public static class State extends BlockEntityRenderState {
        public final List<BlockStateModelPart> parts = new ArrayList<>();
    }

    @Override
    public State createRenderState() {
        return new State();
    }

    @Override
    public void extractRenderState(BlockEntityQuenchedAllay blockEntity, State state, float partialTick,
        Vec3 cameraPosition, ModelFeatureRenderer.@Nullable CrumblingOverlay breakProgress) {
        BlockEntityRenderer.super.extractRenderState(blockEntity, state, partialTick, cameraPosition, breakProgress);
        state.parts.clear();

        var variants = RegisterClientStuff.quenchedAllayVariants(blockEntity.getBlockState().getBlock());
        if (variants.isEmpty()) {
            return;
        }
        var idx = Math.abs(GaslightingTracker.getGaslightingAmount() % BlockQuenchedAllay.VARIANTS);
        BlockStateModel model = Minecraft.getInstance().getModelManager().getModel(variants.get(idx));
        if (model != null) {
            model.collectParts(RandomSource.create(state.blockPos.asLong()), state.parts);
        }
    }

    @Override
    public void submit(State state, PoseStack ps, SubmitNodeCollector collector, CameraRenderState camera) {
        if (state.parts.isEmpty()) {
            return;
        }
        collector.submitBlockModel(ps, Sheets.translucentBlockItemSheet(), new ArrayList<>(state.parts), NO_TINTS,
            state.lightCoords, OverlayTexture.NO_OVERLAY, 0);
    }

    @Override
    public boolean shouldRenderOffScreen() {
        return false;
    }
}
