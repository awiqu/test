package at.petrak.hexcasting.api.addldata;

import at.petrak.hexcasting.api.pigment.ColorProvider;
import net.minecraft.util.ARGB;
import net.minecraft.util.Mth;
import net.minecraft.world.phys.Vec3;

import java.util.UUID;

public interface ADPigment {
    ColorProvider provideColor(UUID owner);

    static int morphBetweenColors(int[] colors, Vec3 gradientDir, float time, Vec3 position) {
        float fIdx = Mth.positiveModulo(time + (float) gradientDir.dot(position), 1f) * colors.length;

        int baseIdx = Mth.floor(fIdx);
        float tRaw = fIdx - baseIdx;
        float t = tRaw < 0.5 ? 4 * tRaw * tRaw * tRaw : (float) (1 - Math.pow(-2 * tRaw + 2, 3) / 2);
        int start = colors[baseIdx % colors.length];
        int end = colors[(baseIdx + 1) % colors.length];

        var r1 = ARGB.red(start);
        var g1 = ARGB.green(start);
        var b1 = ARGB.blue(start);
        var a1 = ARGB.alpha(start);
        var r2 = ARGB.red(end);
        var g2 = ARGB.green(end);
        var b2 = ARGB.blue(end);
        var a2 = ARGB.alpha(end);

        var r = Mth.lerp(t, r1, r2);
        var g = Mth.lerp(t, g1, g2);
        var b = Mth.lerp(t, b1, b2);
        var a = Mth.lerp(t, a1, a2);

        return ARGB.color((int) a, (int) r, (int) g, (int) b);
    }
}
