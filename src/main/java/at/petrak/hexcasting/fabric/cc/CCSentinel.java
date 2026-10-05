package at.petrak.hexcasting.fabric.cc;

import at.petrak.hexcasting.api.player.Sentinel;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.ladysnake.cca.api.v3.component.sync.AutoSyncedComponent;
import org.ladysnake.cca.api.v8.component.CardinalComponent;

import javax.annotation.Nullable;

public class CCSentinel implements CardinalComponent, AutoSyncedComponent {
    public static final String
        TAG_HAS_SENTINEL = "has_sentinel",
        TAG_EXTENDS_RANGE = "extends_range",
        TAG_POSITION = "position",
        TAG_DIMENSION = "dimension";

    private final Player owner;
    private @Nullable Sentinel sentinel = null;

    public CCSentinel(Player owner) {
        this.owner = owner;
    }

    public @Nullable Sentinel getSentinel() {
        return sentinel;
    }

    public void setSentinel(Sentinel sentinel) {
        this.sentinel = sentinel;
        HexCardinalComponents.SENTINEL.sync(this.owner);
    }

    @Override
    public void readData(ValueInput input) {
        var hasSentinel = input.getBooleanOr(TAG_HAS_SENTINEL, false);
        var dim = input.read(TAG_DIMENSION, Level.RESOURCE_KEY_CODEC);
        if (hasSentinel && dim.isPresent()) {
            var extendsRange = input.getBooleanOr(TAG_EXTENDS_RANGE, false);
            var position = CCFlight.readVec(input.childOrEmpty(TAG_POSITION));
            this.sentinel = new Sentinel(extendsRange, position, dim.get());
        } else {
            this.sentinel = null;
        }
    }

    @Override
    public void writeData(ValueOutput output) {
        output.putBoolean(TAG_HAS_SENTINEL, this.sentinel != null);
        if (this.sentinel != null) {
            output.putBoolean(TAG_EXTENDS_RANGE, this.sentinel.extendsRange());
            CCFlight.writeVec(output.child(TAG_POSITION), this.sentinel.position());
            output.store(TAG_DIMENSION, Level.RESOURCE_KEY_CODEC, this.sentinel.dimension());
        }
    }
}
