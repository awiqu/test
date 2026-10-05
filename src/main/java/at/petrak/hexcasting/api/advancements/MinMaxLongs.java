package at.petrak.hexcasting.api.advancements;

import com.mojang.brigadier.StringReader;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.serialization.Codec;
import net.minecraft.advancements.predicates.MinMaxBounds;

public record MinMaxLongs(MinMaxBounds.Bounds<Long> bounds) implements MinMaxBounds<Long> {
    public static final Codec<MinMaxLongs> CODEC = MinMaxBounds.Bounds.createCodec(Codec.LONG)
            .validate(MinMaxBounds.Bounds::validateSwappedBoundsInCodec)
            .xmap(MinMaxLongs::new, MinMaxLongs::bounds);

    public static final MinMaxLongs ANY = new MinMaxLongs(MinMaxBounds.Bounds.any());

    public static MinMaxLongs exactly(long value) {
        return new MinMaxLongs(MinMaxBounds.Bounds.exactly(value));
    }

    public static MinMaxLongs between(long min, long max) {
        return new MinMaxLongs(MinMaxBounds.Bounds.between(min, max));
    }

    public static MinMaxLongs atLeast(long min) {
        return new MinMaxLongs(MinMaxBounds.Bounds.atLeast(min));
    }

    public static MinMaxLongs atMost(long max) {
        return new MinMaxLongs(MinMaxBounds.Bounds.atMost(max));
    }

    public boolean matches(long value) {
        return (this.bounds.min().isEmpty() || this.bounds.min().get() <= value)
                && (this.bounds.max().isEmpty() || this.bounds.max().get() >= value);
    }

    public static MinMaxLongs fromReader(StringReader reader) throws CommandSyntaxException {
        int start = reader.getCursor();
        var bounds = MinMaxBounds.Bounds.fromReader(
                reader,
                Long::parseLong,
                CommandSyntaxException.BUILT_IN_EXCEPTIONS::readerInvalidLong
        );
        if (bounds.areSwapped()) {
            reader.setCursor(start);
            throw ERROR_SWAPPED.createWithContext(reader);
        }
        return new MinMaxLongs(bounds);
    }
}
