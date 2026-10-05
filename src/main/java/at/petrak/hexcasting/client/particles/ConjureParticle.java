package at.petrak.hexcasting.client.particles;

import at.petrak.hexcasting.client.render.shader.HexRenderPipelines;
import at.petrak.hexcasting.common.particles.ConjureParticleOptions;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.particle.*;
import net.minecraft.client.renderer.texture.TextureAtlas;
import net.minecraft.util.ARGB;
import net.minecraft.util.RandomSource;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.Random;

public class ConjureParticle extends SingleQuadParticle {
    private static final Random RANDOM = new Random();

    private final SpriteSet sprites;

    ConjureParticle(ClientLevel pLevel, double x, double y, double z, double dx, double dy, double dz,
        SpriteSet pSprites, int color) {
        super(pLevel, x, y, z, dx, dy, dz, pSprites.first());
        this.quadSize *= 0.9f;
        this.setParticleSpeed(dx, dy, dz);

        var r = ARGB.red(color);
        var g = ARGB.green(color);
        var b = ARGB.blue(color);
        this.setColor(r / 255f, g / 255f, b / 255f);
        this.setAlpha(0.3f);

        this.friction = 0.96F;
        this.gravity = dy != 0 && dx != 0 && dz != 0 ? -0.01F : 0F;
        this.speedUpWhenYMotionIsBlocked = true;
        this.sprites = pSprites;

        this.roll = RANDOM.nextFloat(360);
        this.oRoll = this.roll;

        this.lifetime = (int) (64.0 / ((Math.random() + 3f) * 0.25f));
        this.hasPhysics = false;
        this.setSpriteFromAge(pSprites);
    }

    @Override
    protected @NotNull Layer getLayer() {
        return CONJURE_LAYER;
    }

    public void tick() {
        super.tick();
        this.setSpriteFromAge(this.sprites);
        this.alpha = 1.0f - ((float) this.age / (float) this.lifetime);
        this.alpha *= 0.3f;
        this.quadSize *= 0.96f;
    }

    @Override
    public void setSpriteFromAge(@NotNull SpriteSet pSprite) {
        if (!this.removed) {
            int age = this.age * 4;
            if (age > this.lifetime) {
                age /= 4;
            }
            this.setSprite(pSprite.get(age, this.lifetime));
        }
    }

    public static class Provider implements ParticleProvider<ConjureParticleOptions> {
        private final SpriteSet sprite;

        public Provider(SpriteSet pSprites) {
            this.sprite = pSprites;
        }

        @Nullable
        @Override
        public Particle createParticle(ConjureParticleOptions type, ClientLevel level,
            double pX, double pY, double pZ,
            double pXSpeed, double pYSpeed, double pZSpeed, RandomSource random) {
            return new ConjureParticle(level, pX, pY, pZ, pXSpeed, pYSpeed, pZSpeed, this.sprite, type.color());
        }
    }

    // https://github.com/VazkiiMods/Botania/blob/db85d778ab23f44c11181209319066d1f04a9e3d/Xplat/src/main/java/vazkii/botania/client/fx/FXWisp.java
    /**
     * Translucent, additive, doesn't write depth. The particles are in the vanilla particle atlas.
     */
    public static final Layer CONJURE_LAYER = new Layer(true, TextureAtlas.LOCATION_PARTICLES,
        HexRenderPipelines.PARTICLE_ADDITIVE);
}
