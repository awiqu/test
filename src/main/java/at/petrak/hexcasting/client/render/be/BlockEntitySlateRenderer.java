package at.petrak.hexcasting.client.render.be;

import at.petrak.hexcasting.api.casting.math.HexPattern;
import at.petrak.hexcasting.client.render.WorldlyPatternRenderHelpers;
import at.petrak.hexcasting.common.blocks.circles.BlockEntitySlate;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.client.renderer.blockentity.state.BlockEntityRenderState;
import net.minecraft.client.renderer.feature.ModelFeatureRenderer;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;

public class BlockEntitySlateRenderer implements BlockEntityRenderer<BlockEntitySlate, BlockEntitySlateRenderer.State> {
    public BlockEntitySlateRenderer(BlockEntityRendererProvider.Context ctx) {
        // NO-OP
    }

    public static class State extends BlockEntityRenderState {
        public @Nullable HexPattern pattern;
        public BlockState state;
        public int seed;
    }

    @Override
    public State createRenderState() {
        return new State();
    }

    @Override
    public void extractRenderState(BlockEntitySlate tile, State state, float partialTicks, Vec3 cameraPosition,
        ModelFeatureRenderer.@Nullable CrumblingOverlay breakProgress) {
        BlockEntityRenderer.super.extractRenderState(tile, state, partialTicks, cameraPosition, breakProgress);
        state.pattern = tile.pattern;
        state.state = tile.getBlockState();
        state.seed = tile.getBlockPos().hashCode();
    }

    @Override
    public void submit(State state, PoseStack ps, SubmitNodeCollector collector, CameraRenderState camera) {
        if (state.pattern == null)
            return;

        WorldlyPatternRenderHelpers.renderPatternForSlate(state.pattern, state.seed, ps, collector, state.lightCoords,
            state.state);
    }
}
