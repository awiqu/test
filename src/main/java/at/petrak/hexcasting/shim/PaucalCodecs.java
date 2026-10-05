package at.petrak.hexcasting.shim;

import com.mojang.serialization.Codec;
import io.netty.buffer.ByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.world.phys.Vec3;

/**
 * The tiny slice of Paucal's codec helpers that Hex Casting uses, embedded so that Paucal isn't a dependency.
 */
public final class PaucalCodecs {
    public static final StreamCodec<ByteBuf, Vec3> VEC3 = StreamCodec.of(
        (stream, v) -> {
            stream.writeDouble(v.x);
            stream.writeDouble(v.y);
            stream.writeDouble(v.z);
        },
        (stream) -> new Vec3(stream.readDouble(), stream.readDouble(), stream.readDouble())
    );

    public static <E extends Enum<E>> Codec<E> enumCodec(Class<E> clazz) {
        return Codec.stringResolver(Enum::toString, str -> Enum.valueOf(clazz, str));
    }

    private PaucalCodecs() {
    }
}
