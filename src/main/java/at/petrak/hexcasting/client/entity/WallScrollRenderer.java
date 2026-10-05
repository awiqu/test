package at.petrak.hexcasting.client.entity;

import at.petrak.hexcasting.api.casting.math.HexPattern;
import at.petrak.hexcasting.client.render.WorldlyPatternRenderHelpers;
import at.petrak.hexcasting.common.entities.EntityWallScroll;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.state.EntityRenderState;
import net.minecraft.client.renderer.rendertype.RenderType;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.Identifier;
import net.minecraft.util.LightCoordsUtil;
import net.minecraft.util.Mth;
import org.jetbrains.annotations.Nullable;
import org.joml.Matrix4f;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

public class WallScrollRenderer extends EntityRenderer<EntityWallScroll, WallScrollRenderer.State> {
    private static final Identifier PRISTINE_BG_LARGE = modLoc("textures/entity/scroll_large.png");
    private static final Identifier PRISTINE_BG_MEDIUM = modLoc("textures/entity/scroll_medium.png");
    private static final Identifier PRISTINE_BG_SMOL = modLoc("textures/block/scroll_paper.png");
    private static final Identifier ANCIENT_BG_LARGE = modLoc("textures/entity/scroll_ancient_large.png");
    private static final Identifier ANCIENT_BG_MEDIUM = modLoc("textures/entity/scroll_ancient_medium.png");
    private static final Identifier ANCIENT_BG_SMOL = modLoc("textures/block/ancient_scroll_paper.png");

    public static class State extends EntityRenderState {
        public float yaw;
        public int light;
        public int blockSize = 1;
        public boolean isAncient;
        public @Nullable HexPattern pattern;
        public boolean showsStrokeOrder;
        public int seed;
    }

    public WallScrollRenderer(EntityRendererProvider.Context ctx) {
        super(ctx);
    }

    @Override
    public State createRenderState() {
        return new State();
    }

    @Override
    public void extractRenderState(EntityWallScroll wallScroll, State state, float partialTicks) {
        super.extractRenderState(wallScroll, state, partialTicks);
        state.yaw = Mth.lerp(partialTicks, wallScroll.yRotO, wallScroll.getYRot());
        state.light = LightCoordsUtil.getLightCoords(wallScroll.level(), wallScroll.getPos());
        state.blockSize = wallScroll.blockSize;
        state.isAncient = wallScroll.isAncient;
        state.pattern = wallScroll.pattern;
        state.showsStrokeOrder = wallScroll.getShowsStrokeOrder();
        state.seed = wallScroll.getPos().hashCode();
    }

    // I do as the PaintingRenderer guides
    @Override
    public void submit(State state, PoseStack ps, SubmitNodeCollector collector, CameraRenderState camera) {
        ps.pushPose();

        ps.mulPose(Axis.YP.rotationDegrees(180f - state.yaw));
        ps.mulPose(Axis.ZP.rotationDegrees(180f));

        int light = state.light;
        int blockSize = state.blockSize;

        {
            ps.pushPose();
            // X is right, Y is down, Z is *in*
            // Our origin will be the lower-left corner of the scroll touching the wall
            // (so it has "negative" thickness)
            ps.translate(-blockSize / 2f, -blockSize / 2f, 1f / 32f);

            float dx = blockSize, dy = blockSize, dz = -1f / 16f;
            float margin = 1f / 48f;

            RenderType layer = RenderTypes.entityCutout(getTextureLocation(state));

            collector.submitCustomGeometry(ps, layer, (last, verts) -> {
                var mat = last.pose();
                // Remember: CCW
                // Front face
                vertex(mat, last, light, verts, 0, 0, dz, 0, 0, 0, 0, -1);
                vertex(mat, last, light, verts, 0, dy, dz, 0, 1, 0, 0, -1);
                vertex(mat, last, light, verts, dx, dy, dz, 1, 1, 0, 0, -1);
                vertex(mat, last, light, verts, dx, 0, dz, 1, 0, 0, 0, -1);
                // Back face
                vertex(mat, last, light, verts, 0, 0, 0, 0, 0, 0, 0, 1);
                vertex(mat, last, light, verts, dx, 0, 0, 1, 0, 0, 0, 1);
                vertex(mat, last, light, verts, dx, dy, 0, 1, 1, 0, 0, 1);
                vertex(mat, last, light, verts, 0, dy, 0, 0, 1, 0, 0, 1);
                // Top face
                vertex(mat, last, light, verts, 0, 0, 0, 0, 0, 0, -1, 0);
                vertex(mat, last, light, verts, 0, 0, dz, 0, margin, 0, -1, 0);
                vertex(mat, last, light, verts, dx, 0, dz, 1, margin, 0, -1, 0);
                vertex(mat, last, light, verts, dx, 0, 0, 1, 0, 0, -1, 0);
                // Left face
                vertex(mat, last, light, verts, 0, 0, 0, 0, 0, -1, 0, 0);
                vertex(mat, last, light, verts, 0, dy, 0, 0, 1, -1, 0, 0);
                vertex(mat, last, light, verts, 0, dy, dz, margin, 1, -1, 0, 0);
                vertex(mat, last, light, verts, 0, 0, dz, margin, 0, -1, 0, 0);
                // Right face
                vertex(mat, last, light, verts, dx, 0, dz, 1 - margin, 0, 1, 0, 0);
                vertex(mat, last, light, verts, dx, dy, dz, 1 - margin, 1, 1, 0, 0);
                vertex(mat, last, light, verts, dx, dy, 0, 1, 1, 1, 0, 0);
                vertex(mat, last, light, verts, dx, 0, 0, 1, 0, 1, 0, 0);
                // Bottom face
                vertex(mat, last, light, verts, 0, dy, dz, 0, 1 - margin, 0, 1, 0);
                vertex(mat, last, light, verts, 0, dy, 0, 0, 1, 0, 1, 0);
                vertex(mat, last, light, verts, dx, dy, 0, 1, 1, 0, 1, 0);
                vertex(mat, last, light, verts, dx, dy, dz, 1, 1 - margin, 0, 1, 0);
            });

            ps.popPose();

            if (state.pattern != null)
                WorldlyPatternRenderHelpers.renderPatternForScroll(state.pattern, state.seed, ps, collector, light,
                    blockSize, state.showsStrokeOrder);
        }

        ps.popPose();
        super.submit(state, ps, collector, camera);
    }

    public Identifier getTextureLocation(State wallScroll) {
        if (wallScroll.isAncient) {
            if (wallScroll.blockSize <= 1) {
                return ANCIENT_BG_SMOL;
            } else if (wallScroll.blockSize == 2) {
                return ANCIENT_BG_MEDIUM;
            } else {
                return ANCIENT_BG_LARGE;
            }
        } else {
            if (wallScroll.blockSize <= 1) {
                return PRISTINE_BG_SMOL;
            } else if (wallScroll.blockSize == 2) {
                return PRISTINE_BG_MEDIUM;
            } else {
                return PRISTINE_BG_LARGE;
            }
        }
    }

    private static void vertex(Matrix4f mat, PoseStack.Pose last, int light, VertexConsumer verts, float x, float y,
                               float z, float u,
                               float v, float nx, float ny, float nz) {
        verts.addVertex(mat, x, y, z)
                .setColor(0xffffffff)
                .setUv(u, v)
                .setOverlay(OverlayTexture.NO_OVERLAY)
                .setLight(light)
                .setNormal(last, nx, ny, nz);
    }
}
