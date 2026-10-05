package at.petrak.hexcasting.client.render;

import at.petrak.hexcasting.api.client.ClientRenderHelper;
import at.petrak.hexcasting.api.client.ScryingLensOverlayRegistry;
import at.petrak.hexcasting.api.player.Sentinel;
import at.petrak.hexcasting.api.utils.QuaternionfUtils;
import at.petrak.hexcasting.client.ClientTickCounter;
import at.petrak.hexcasting.client.render.shader.HexRenderTypes;
import at.petrak.hexcasting.common.lib.HexAttributes;
import at.petrak.hexcasting.xplat.IXplatAbstractions;
import com.google.common.collect.Lists;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.datafixers.util.Pair;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.locale.Language;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.network.chat.Style;
import net.minecraft.util.Mth;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import org.joml.Vector3f;

import java.util.List;
import java.util.function.BiConsumer;

public class HexAdditionalRenderers {
    public static void overlayLevel(SubmitNodeCollector collector, float partialTick) {
        var mc = Minecraft.getInstance();
        var player = mc.player;
        var level = mc.level;
        if (player == null || level == null) {
            return;
        }

        var cameraPos = mc.gameRenderer.mainCamera().position();

        var sentinel = IXplatAbstractions.INSTANCE.getSentinel(player);
        if (sentinel != null && player.level().dimension().equals(sentinel.dimension())) {
            var ps = new PoseStack();
            renderSentinel(sentinel, player, ps, collector, cameraPos);
        }

        // the patterns swirling around players
        var firstPerson = mc.options.getCameraType().isFirstPerson();
        for (var other : level.players()) {
            if (other == player && firstPerson) {
                continue;
            }
            var ps = new PoseStack();
            var pos = other.position();
            var lerped = new Vec3(
                Mth.lerp(partialTick, other.xo, pos.x),
                Mth.lerp(partialTick, other.yo, pos.y),
                Mth.lerp(partialTick, other.zo, pos.z));
            ps.translate(lerped.x - cameraPos.x, lerped.y - cameraPos.y, lerped.z - cameraPos.z);
            ClientRenderHelper.renderCastingStack(ps, collector, other, partialTick);
        }
    }

    public static void overlayGui(GuiGraphicsExtractor graphics, DeltaTracker partialTicks) {
        tryRenderScryingLensOverlay(graphics, partialTicks);
    }

    private static void renderSentinel(Sentinel sentinel, LocalPlayer owner,
        PoseStack ps, SubmitNodeCollector collector, Vec3 playerPos) {
        ps.pushPose();

        // zero vector is the player
        ps.translate(
            sentinel.position().x - playerPos.x,
            sentinel.position().y - playerPos.y,
            sentinel.position().z - playerPos.z);

        var time = ClientTickCounter.getTotal() / 2;
        var bobSpeed = 1f / 20;
        var magnitude = 0.1f;
        ps.translate(0, Mth.sin(bobSpeed * time) * magnitude, 0);
        var spinSpeed = 1f / 30;
        ps.mulPose(QuaternionfUtils.fromXYZ(new Vector3f(0, spinSpeed * time, 0)));
        if (sentinel.extendsRange()) {
            ps.mulPose(QuaternionfUtils.fromXYZ(new Vector3f(spinSpeed * time / 8f, 0, 0)));
        }

        float scale = 0.5f;
        ps.scale(scale, scale, scale);

        var pigment = IXplatAbstractions.INSTANCE.getPigment(owner);
        var colProvider = pigment.getColorProvider();

        collector.submitCustomGeometry(ps, HexRenderTypes.linesNoDepth(), (pose, buf) -> {
            // Icosahedron inscribed inside the unit sphere
            BiConsumer<float[], float[]> v = (l, r) -> {
                int lcolor = colProvider.getColor(time, new Vec3(l[0], l[1], l[2])),
                    rcolor = colProvider.getColor(time, new Vec3(r[0], r[1], r[2]));
                var normal = new Vector3f(r[0] - l[0], r[1] - l[1], r[2] - l[2]);
                normal.normalize();
                buf.addVertex(pose, l[0], l[1], l[2])
                    .setColor(lcolor)
                    .setNormal(pose, normal.x(), normal.y(), normal.z())
                    .setLineWidth(5f);
                buf.addVertex(pose, r[0], r[1], r[2])
                    .setColor(rcolor)
                    .setNormal(pose, normal.x(), normal.y(), normal.z())
                    .setLineWidth(5f);
            };

            for (int side = 0; side <= 1; side++) {
                var ring = (side == 0) ? Icos.BOTTOM_RING : Icos.TOP_RING;
                var apex = (side == 0) ? Icos.BOTTOM : Icos.TOP;

                // top & bottom spider
                for (int i = 0; i < 5; i++) {
                    v.accept(apex, ring[i]);
                }

                // ring around
                for (int i = 0; i < 5; i++) {
                    v.accept(ring[i % 5], ring[(i + 1) % 5]);
                }
            }
            // center band
            for (int i = 0; i < 5; i++) {
                var bottom = Icos.BOTTOM_RING[i];
                v.accept(Icos.TOP_RING[(i + 2) % 5], bottom);
                v.accept(bottom, Icos.TOP_RING[(i + 3) % 5]);
            }
        });

        ps.popPose();
    }

    private static class Icos {
        public static float[] TOP = {0, 1, 0};
        public static float[] BOTTOM = {0, -1, 0};
        public static float[][] TOP_RING = new float[5][];
        public static float[][] BOTTOM_RING = new float[5][];

        static {
            var theta = (float) Mth.atan2(0.5, 1);
            for (int i = 0; i < 5; i++) {
                var phi = (float) i / 5f * Mth.TWO_PI;
                var x = Mth.cos(theta) * Mth.cos(phi);
                var y = Mth.sin(theta);
                var z = Mth.cos(theta) * Mth.sin(phi);
                TOP_RING[i] = new float[]{x, y, z};
                BOTTOM_RING[i] = new float[]{-x, -y, -z};
            }
        }
    }

    private static void tryRenderScryingLensOverlay(GuiGraphicsExtractor graphics, DeltaTracker partialTicks) {
        var mc = Minecraft.getInstance();
        var ps = graphics.pose();

        LocalPlayer player = mc.player;
        ClientLevel level = mc.level;
        if (player == null || level == null) {
            return;
        }

        if (player.getAttributeValue(HexAttributes.SCRY_SIGHT) <= 0.0 || player.getAttributeValue(HexAttributes.FEEBLE_MIND) > 0)
            return;

        var hitRes = mc.hitResult;
        if (hitRes != null && hitRes.getType() == HitResult.Type.BLOCK) {
            var bhr = (BlockHitResult) hitRes;
            var pos = bhr.getBlockPos();
            var bs = level.getBlockState(pos);

            var lines = ScryingLensOverlayRegistry.getLines(bs, pos, player, level, bhr.getDirection());

            int totalHeight = 8;
            List<Pair<ItemStack, List<FormattedText>>> actualLines = Lists.newArrayList();

            var window = mc.getWindow();
            var maxWidth = (int) (window.getGuiScaledWidth() / 2f * 0.8f);

            for (var pair : lines) {
                totalHeight += mc.font.lineHeight + 6;
                var text = pair.getSecond();
                var textLines = mc.font.getSplitter().splitLines(text, maxWidth, Style.EMPTY);

                actualLines.add(Pair.of(pair.getFirst(), textLines));

                if (textLines.size() > 1) {
                    totalHeight += mc.font.lineHeight * (textLines.size() - 1);
                }
            }

            if (!lines.isEmpty()) {
                var x = window.getGuiScaledWidth() / 2f + 8f;
                var y = window.getGuiScaledHeight() / 2f - totalHeight;
                ps.pushMatrix();
                ps.translate(x, y);

                for (var pair : actualLines) {
                    var stack = pair.getFirst();
                    if (!stack.isEmpty()) {
                        // this draws centered in the Y ...
                        graphics.item(pair.getFirst(), 0, 0);
                    }
                    int tx = stack.isEmpty() ? 0 : 18;
                    int ty = 5;
                    // but this draws where y=0 is the baseline
                    var text = pair.getSecond();

                    for (var line : text) {
                        var actualLine = Language.getInstance().getVisualOrder(line);
                        graphics.text(mc.font, actualLine, tx, ty, 0xffffffff);
                        ps.translate(0, mc.font.lineHeight);
                    }
                    if (text.isEmpty()) {
                        ps.translate(0, mc.font.lineHeight);
                    }
                    ps.translate(0, 6);
                }

                ps.popMatrix();
            }
        }
    }
}
