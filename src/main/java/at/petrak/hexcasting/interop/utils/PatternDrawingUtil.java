package at.petrak.hexcasting.interop.utils;

import at.petrak.hexcasting.api.casting.math.HexCoord;
import at.petrak.hexcasting.api.casting.math.HexPattern;
import at.petrak.hexcasting.api.utils.HexUtils;
import at.petrak.hexcasting.client.render.RenderLib;
import at.petrak.hexcasting.client.render.VCDrawHelperKt;
import com.mojang.datafixers.util.Pair;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.util.ARGB;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec2;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

public final class PatternDrawingUtil {
    public static void drawPattern(GuiGraphicsExtractor graphics, int x, int y, List<PatternEntry> patterns, List<Vec2> dots,
                   boolean strokeOrder, int outer, int innerLight, int innerDark,
                   int dotColor) {
        var poseStack = graphics.pose();
        poseStack.pushMatrix();
        poseStack.translate(x, y);
        var mat = VCDrawHelperKt.guiMatrix(graphics);

        for (var pat : patterns) {
            RenderLib.drawLineSeq(graphics, mat, pat.zappyPoints(), 5f, 0, outer, outer);
            RenderLib.drawLineSeq(graphics, mat, pat.zappyPoints(), 2f, 0,
                strokeOrder ? innerDark : innerLight, innerLight);

            if (strokeOrder) {
                RenderLib.drawSpot(graphics, mat, pat.zappyPoints().get(0), 2.5f, 1f, 0.1f, 0.15f, 0.6f);
            }
        }

        float dotR = ARGB.red(dotColor) / 255f;
        float dotG = ARGB.green(dotColor) / 255f;
        float dotB = ARGB.blue(dotColor) / 255f;
        float dotA = ARGB.alpha(dotColor) / 255f;

        for (var dot : dots) {
            RenderLib.drawSpot(graphics, mat, dot, 1.5f, dotR, dotG, dotB, dotA);
        }

        poseStack.popMatrix();
    }

    public static PatternRenderingData loadPatterns(List<Pair<HexPattern, HexCoord>> patterns,
        float readabilityOffset, float lastLineLenProp) {
        var patternEntries = new ArrayList<PatternEntry>(patterns.size());

        var fakeScale = 1;
        var seenFakePoints = new ArrayList<Vec2>();
        var seenCoords = new HashSet<HexCoord>();
        for (var pair : patterns) {
            var pattern = pair.getFirst();
            var origin = pair.getSecond();
            for (var pos : pattern.positions(origin)) {
                var px = HexUtils.coordToPx(pos, fakeScale, Vec2.ZERO);
                seenFakePoints.add(px);
            }

            // And while we're looping add the (COORD ONLY) things internally
            patternEntries.add(new PatternEntry(pattern, origin, new ArrayList<>()));
            seenCoords.addAll(pattern.positions(origin));
        }
        var fakeCom = HexUtils.findCenter(seenFakePoints);

        var maxDx = -1f;
        var maxDy = -1f;
        for (var dot : seenFakePoints) {
            var dx = Mth.abs(dot.x - fakeCom.x);
            if (dx > maxDx) {
                maxDx = dx;
            }
            var dy = Mth.abs(dot.y - fakeCom.y);
            if (dy > maxDy) {
                maxDy = dy;
            }
        }
        var hexSize = Math.min(12, Math.min(120 / 2.5f / maxDx, 70 / 2.5f / maxDy));

        var seenRealPoints = new ArrayList<Vec2>();
        for (var pat : patternEntries) {
            for (var pos : pat.pattern().positions(pat.origin())) {
                var px = HexUtils.coordToPx(pos, hexSize, Vec2.ZERO);
                seenRealPoints.add(px);
            }
        }
        var realCom = HexUtils.findCenter(seenRealPoints);

        // and NOW for real!
        for (int i = 0; i < patternEntries.size(); i++) {
            PatternEntry pat = patternEntries.get(i);
            var localOrigin = HexUtils.coordToPx(pat.origin(), hexSize, realCom.negated());
            var points = pat.pattern().toLines(hexSize, localOrigin);
            pat.zappyPoints()
                .addAll(RenderLib.makeZappy(points, RenderLib.findDupIndices(pat.pattern().positions()), 10, 0.8f, 0f,
                    0f, readabilityOffset, lastLineLenProp, i));
        }

        var pathfinderDots = seenCoords.stream()
            .map(coord -> HexUtils.coordToPx(coord, hexSize, realCom.negated())).toList();

        return new PatternRenderingData(patternEntries, pathfinderDots, hexSize);
    }

    public record PatternRenderingData(List<PatternEntry> patterns, List<Vec2> pathfinderDots, float hexSize) {
        // NO-OP
    }
}
