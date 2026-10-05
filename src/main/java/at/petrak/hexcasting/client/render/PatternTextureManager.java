package at.petrak.hexcasting.client.render;

import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.textures.FilterMode;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;
import net.minecraft.util.ARGB;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec2;

import java.awt.geom.Line2D;
import java.util.*;
import java.util.concurrent.*;

import static at.petrak.hexcasting.api.HexAPI.modLoc;

public class PatternTextureManager {

    //TODO: remove if not needed anymore for comparison
    public static boolean useTextures = true;
    public static int repaintIndex = 0;

    private static final ConcurrentMap<String, Map<String, Identifier>> patternTexturesToAdd = new ConcurrentHashMap<>();
    private static final Set<String> inProgressPatterns = new HashSet<>();
    // basically newCachedThreadPool, but with a max pool size
    private static final ExecutorService executor = new ThreadPoolExecutor(0, 16, 60L, TimeUnit.SECONDS, new LinkedBlockingDeque<>());

    private static final HashMap<String, Map<String, Identifier>> patternTextures = new HashMap<>();

    public static Optional<Map<String, Identifier>> getTextures(HexPatternLike patternlike, PatternSettings patSets, double seed, int resPerUnit) {
        String patCacheKey = patSets.getCacheKey(patternlike, seed) + "_" + resPerUnit;

        // move textures from concurrent map to normal hashmap as needed
        if (patternTexturesToAdd.containsKey(patCacheKey)) {
            var patternTexture = patternTexturesToAdd.remove(patCacheKey);
            var oldPatternTexture = patternTextures.put(patCacheKey, patternTexture);
            inProgressPatterns.remove(patCacheKey);
            if (oldPatternTexture != null) // TODO: is this needed? when does this ever happen?
                for(Identifier oldPatternTextureSingle : oldPatternTexture.values())
                    Minecraft.getInstance().getTextureManager().getTexture(oldPatternTextureSingle).close();

            return Optional.empty(); // try not giving it immediately to avoid flickering?
        }
        if (patternTextures.containsKey(patCacheKey))
            return Optional.of(patternTextures.get(patCacheKey));

        // render a higher-resolution texture in a background thread so it eventually becomes all nice nice and pretty
        if(!inProgressPatterns.contains(patCacheKey)){
            inProgressPatterns.add(patCacheKey);
            executor.submit(() -> {
                var slowTextures = createImages(patternlike, patSets, seed, resPerUnit);

                // the GPU texture has to be made on the main thread, so move back to it after the slow part is done
                Minecraft.getInstance().execute(() -> {
                        registerTextures(patCacheKey, slowTextures);
                });
            });
        }
        return Optional.empty();
    }

    private static Map<String, NativeImage> createImages(HexPatternLike patternlike, PatternSettings patSets, double seed, int resPerUnit) {
        HexPatternPoints staticPoints = HexPatternPoints.getStaticPoints(patternlike, patSets, seed);

        List<Vec2> zappyRenderSpace = staticPoints.scaleVecs(staticPoints.zappyPoints);

        Map<String, NativeImage> patTexts = new HashMap<>();

        NativeImage innerLines = drawLines(zappyRenderSpace, staticPoints, (float)patSets.getInnerWidth((staticPoints.finalScale)), resPerUnit);
        patTexts.put("inner", innerLines);

        NativeImage outerLines = drawLines(zappyRenderSpace, staticPoints, (float)patSets.getOuterWidth((staticPoints.finalScale)), resPerUnit);
        patTexts.put("outer", outerLines);

        return patTexts;
    }

    private static Map<String, Identifier> registerTextures(String patTextureKeyBase, Map<String, NativeImage> images) {
        Map<String, Identifier> resLocs = new HashMap<>();
        for(Map.Entry<String, NativeImage> textureEntry : images.entrySet()){
            String name = "pattern_texture/" + (patTextureKeyBase + "_" + textureEntry.getKey() + "_" + repaintIndex)
                .replaceAll("[^a-z0-9/._-]", "_");
            Identifier resourceLocation = modLoc(name);
            Minecraft.getInstance().getTextureManager().register(resourceLocation,
                new PatternTexture("hex pattern " + textureEntry.getKey(), textureEntry.getValue()));
            resLocs.put(textureEntry.getKey(), resourceLocation);
        }
        patternTexturesToAdd.put(patTextureKeyBase, resLocs);
        return resLocs;
    }

    /**
     * A dynamic texture that is sampled with linear filtering so the lines look smooth when scaled down.
     */
    private static class PatternTexture extends DynamicTexture {
        PatternTexture(String label, NativeImage image) {
            super(() -> label, image);
            this.sampler = RenderSystem.getSamplerCache().getClampToEdge(FilterMode.LINEAR);
        }
    }

    private static NativeImage drawLines(List<Vec2> points, HexPatternPoints staticPoints, float unscaledLineWidth, int resPerUnit) {
        NativeImage nativeImage = new NativeImage((int)(staticPoints.fullWidth*resPerUnit), (int)(staticPoints.fullHeight*resPerUnit), true);
        for (int i = 0; i < points.size() - 1; i++) {
            TexCoord pointFrom = getTextureCoordinates(points.get(i), staticPoints, resPerUnit);
            TexCoord pointTo = getTextureCoordinates(points.get(i+1), staticPoints, resPerUnit);
           drawLine(nativeImage, pointFrom.x(), pointFrom.y(), pointTo.x(), pointTo.y(), unscaledLineWidth * resPerUnit);
        }
        return nativeImage;
    }

    private static void drawLine(NativeImage image, int x0, int y0, int x1, int y1, float width) {
        var line = new Line2D.Float(x0, y0, x1, y1);
        var bounds = line.getBounds();
        double halfWidth = width / 2;
        for (int x = (int) (bounds.x - width - 1); x < (int) (bounds.x + bounds.width + width + 1); x++) {
            for (int y = (int) (bounds.y - width - 1); y < (int) (bounds.y + bounds.height + width + 1); y++) {
                double dist = line.ptSegDist(x, y);
                int alpha = (int) (Mth.clamp(halfWidth - dist + 0.5, 0, 1) * 255);
                if (alpha > 0 && x >= 0 && y >= 0 && x < image.getWidth() && y < image.getHeight()) {
                    int oldAlpha = ARGB.alpha(image.getPixel(x, y));
                    int newAlpha = Math.max(oldAlpha, alpha);
                    image.setPixel(x, y, 0xFFFFFF | (newAlpha << 24));
                }
            }
        }
    }

    private record TexCoord(int x, int y) {
    }

    private static TexCoord getTextureCoordinates(Vec2 point, HexPatternPoints staticPoints, int resPerUnit) {
        int x = (int) ( point.x * resPerUnit);
        int y = (int) ( point.y * resPerUnit);
        return new TexCoord(x, y);
    }

    public static void repaint() {
        repaintIndex++;
        patternTexturesToAdd.clear();
        patternTextures.clear();
    }
}