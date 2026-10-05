package at.petrak.hexcasting.client.render;


import at.petrak.hexcasting.api.casting.math.HexPattern;
import com.mojang.blaze3d.PrimitiveTopology;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.resources.Identifier;
import net.minecraft.util.ARGB;
import net.minecraft.world.phys.Vec2;
import net.minecraft.world.phys.Vec3;
import org.joml.Matrix4f;

import javax.annotation.Nullable;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

public class PatternRenderer {

    /**
     * Where a pattern is being drawn to, and how to make the helper that does the actual drawing.
     */
    private interface Target {
        Matrix4f matrix();

        VCDrawHelper helper(float z, Identifier texture);
    }

    private static Target guiTarget(GuiGraphicsExtractor graphics) {
        var mat = VCDrawHelperKt.guiMatrix(graphics);
        return new Target() {
            public Matrix4f matrix() {
                return mat;
            }

            public VCDrawHelper helper(float z, Identifier texture) {
                return new VCDrawHelper.Gui(graphics, z, texture.equals(VCDrawHelper.getWHITE()) ? null : texture);
            }
        };
    }

    private static Target worldTarget(PoseStack ps, WorldlyBits worldlyBits) {
        var mat = ps.last().pose();
        return new Target() {
            public Matrix4f matrix() {
                return mat;
            }

            public VCDrawHelper helper(float z, Identifier texture) {
                return new VCDrawHelper.Worldly(worldlyBits, ps, z * -1, texture);
            }
        };
    }

    // ---- GUI rendering ----

    /**
     * Render a pattern to the GUI. The current pose of the graphics object is used: (0,0) is treated as the top left
     * corner, and the size of the render is determined by patSets.
     */
    public static void renderPattern(HexPattern pattern, GuiGraphicsExtractor graphics, PatternSettings patSets, PatternColors patColors, double seed, int resPerUnit) {
        renderPattern(HexPatternLike.of(pattern), graphics, patSets, patColors, seed, resPerUnit);
    }

    public static void renderPattern(HexPatternLike patternlike, GuiGraphicsExtractor graphics, PatternSettings patSets, PatternColors patColors, double seed, int resPerUnit) {
        renderPattern(patternlike, guiTarget(graphics), patSets, patColors, seed, resPerUnit);
    }

    // ---- World rendering ----

    public static void renderPattern(HexPattern pattern, PoseStack ps, WorldlyBits worldlyBits, PatternSettings patSets, PatternColors patColors, double seed, int resPerUnit) {
        renderPattern(HexPatternLike.of(pattern), ps, worldlyBits, patSets, patColors, seed, resPerUnit);
    }

    /**
     * Renders a pattern (or rather a pattern-like) into the world according to the given settings.
     * @param patternlike the pattern (or more generally the lines) to render.
     * @param ps pose/matrix stack to render based on. (0,0) is treated as the top left corner. The size of the render is determined by patSets.
     * @param worldlyBits where to submit the geometry to, and the light/normal to use.
     * @param patSets settings that control how the pattern is drawn.
     * @param patColors colors to use for drawing the pattern and dots.
     * @param seed seed to use for zappy wobbles.
     * @param resPerUnit the texture resolution per pose unit space to be used *if* the texture renderer is used.
     */
    public static void renderPattern(HexPatternLike patternlike, PoseStack ps, WorldlyBits worldlyBits, PatternSettings patSets, PatternColors patColors, double seed, int resPerUnit) {
        renderPattern(patternlike, worldTarget(ps, worldlyBits), patSets, patColors, seed, resPerUnit);
    }

    private static void renderPattern(HexPatternLike patternlike, Target target, PatternSettings patSets, PatternColors patColors, double seed, int resPerUnit){
        HexPatternPoints staticPoints = HexPatternPoints.getStaticPoints(patternlike, patSets, seed);

        boolean shouldRenderDynamic = true;

        // only do texture rendering if it's static and has solid colors
        if(patSets.getSpeed() == 0 && PatternTextureManager.useTextures && patColors.innerStartColor() == patColors.innerEndColor()
        && patColors.outerStartColor() == patColors.outerEndColor()){
            boolean didRender = renderPatternTexture(patternlike, target, patSets, patColors, seed, resPerUnit);
            if(didRender) shouldRenderDynamic = false;
        }
        if(shouldRenderDynamic){
            List<Vec2> zappyPattern;

            if(patSets.getSpeed() == 0) {
                // re-use our static points if we're rendering a static pattern anyway
                zappyPattern = staticPoints.zappyPoints;
            } else {
                List<Vec2> nonzappyLines = patternlike.getNonZappyPoints();
                Set<Integer> dupIndices = RenderLib.findDupIndices(nonzappyLines);
                zappyPattern = RenderLib.makeZappy(nonzappyLines, dupIndices,
                        patSets.getHops(), patSets.getVariance(), patSets.getSpeed(), patSets.getFlowIrregular(),
                        patSets.getReadabilityOffset(), patSets.getLastSegmentProp(), seed);
            }

            List<Vec2> zappyRenderSpace = staticPoints.scaleVecs(zappyPattern);

            var isGlowyInline = patSets.getName().equals("inlineglowy");

            if(ARGB.alpha(patColors.outerEndColor()) != 0 && ARGB.alpha(patColors.outerStartColor()) != 0){
                RenderLib.drawLineSeq(target.matrix(), zappyRenderSpace, (float)patSets.getOuterWidth(staticPoints.finalScale),
                        patColors.outerStartColor(), patColors.outerEndColor(), target.helper(outerZ, VCDrawHelper.getWHITE()));
            }
            if(ARGB.alpha(patColors.innerEndColor()) != 0 && ARGB.alpha(patColors.innerStartColor()) != 0) {
                RenderLib.drawLineSeq(target.matrix(), zappyRenderSpace, (float)patSets.getInnerWidth(staticPoints.finalScale),
                        patColors.innerStartColor(), patColors.innerEndColor(), target.helper(isGlowyInline ? 1f : innerZ, VCDrawHelper.getWHITE()));
            }
        }

        // render dots and grid dynamically

        float dotZ = 0.0011f;

        if(ARGB.alpha(patColors.startingDotColor()) != 0) {
            RenderLib.drawSpot(target.matrix(), staticPoints.dotsScaled.get(0), (float)patSets.getStartDotRadius(staticPoints.finalScale),
                    patColors.startingDotColor(), target.helper(dotZ, VCDrawHelper.getWHITE()));
        }

        if(ARGB.alpha(patColors.gridDotsColor()) != 0) {
            for(int i = 1; i < staticPoints.dotsScaled.size(); i++){
                Vec2 gridDot = staticPoints.dotsScaled.get(i);
                RenderLib.drawSpot(target.matrix(), gridDot, (float)patSets.getGridDotsRadius(staticPoints.finalScale),
                    patColors.gridDotsColor(), target.helper(dotZ, VCDrawHelper.getWHITE()));
            }
        }
    }

    private static final float outerZ = 0.0005f;

    private static float innerZ = 0.001f;

    private static boolean renderPatternTexture(HexPatternLike patternlike, Target target, PatternSettings patSets, PatternColors patColors, double seed, int resPerUnit){

        Optional<Map<String, Identifier>> maybeTextures = PatternTextureManager.getTextures(patternlike, patSets, seed, resPerUnit);
        if(maybeTextures.isEmpty()){
            return false;
        }

        Map<String, Identifier> textures = maybeTextures.get();
        HexPatternPoints staticPoints = HexPatternPoints.getStaticPoints(patternlike, patSets, seed);

        VertexConsumer vc;

        if(ARGB.alpha(patColors.outerStartColor()) != 0) {
            VCDrawHelper vcHelper = target.helper(outerZ, textures.get("outer"));
            vc = vcHelper.vcSetupAndSupply(PrimitiveTopology.QUADS);

            int cl = patColors.outerStartColor();

            vcHelper.vertex(vc, cl, new Vec2(0, 0), new Vec2(0, 0), target.matrix());
            vcHelper.vertex(vc, cl, new Vec2(0, (float) staticPoints.fullHeight), new Vec2(0, 1), target.matrix());
            vcHelper.vertex(vc, cl, new Vec2((float) staticPoints.fullWidth, (float) staticPoints.fullHeight), new Vec2(1, 1), target.matrix());
            vcHelper.vertex(vc, cl, new Vec2((float) staticPoints.fullWidth, 0), new Vec2(1, 0), target.matrix());

            vcHelper.vcEndDrawer(vc);
        }

        if(ARGB.alpha(patColors.innerStartColor()) != 0) {
            VCDrawHelper vcHelper = target.helper(innerZ, textures.get("inner"));
            vc = vcHelper.vcSetupAndSupply(PrimitiveTopology.QUADS);

            int cl = patColors.innerStartColor();

            vcHelper.vertex(vc, cl, new Vec2(0, 0), new Vec2(0, 0), target.matrix());
            vcHelper.vertex(vc, cl, new Vec2(0, (float) staticPoints.fullHeight), new Vec2(0, 1), target.matrix());
            vcHelper.vertex(vc, cl, new Vec2((float) staticPoints.fullWidth, (float) staticPoints.fullHeight), new Vec2(1, 1), target.matrix());
            vcHelper.vertex(vc, cl, new Vec2((float) staticPoints.fullWidth, 0), new Vec2(1, 0), target.matrix());

            vcHelper.vcEndDrawer(vc);
        }

        return true;
    }

    // TODO did we want to un-hardcode this for accessibility reasons ?
    public static boolean shouldDoStrokeGradient(){
        return Minecraft.getInstance().hasControlDown();
    }

    /**
     * Information about how to draw into the world.
     *
     * @param provider where the geometry is submitted to
     * @param light the packed light coordinates to use
     * @param normal the normal of the drawn surface (before being transformed by the pose)
     * @param unlit if true, ignore the light and the normal: the pattern is drawn at full brightness with no shading
     */
    public record WorldlyBits(SubmitNodeCollector provider, @Nullable Integer light, @Nullable Vec3 normal, boolean unlit){
        public WorldlyBits(SubmitNodeCollector provider, Integer light, Vec3 normal) {
            this(provider, light, normal, false);
        }
    }
}
