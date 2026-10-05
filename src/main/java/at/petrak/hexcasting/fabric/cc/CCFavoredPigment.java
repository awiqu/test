package at.petrak.hexcasting.fabric.cc;

import at.petrak.hexcasting.api.pigment.FrozenPigment;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jetbrains.annotations.Nullable;
import org.ladysnake.cca.api.v3.component.sync.AutoSyncedComponent;
import org.ladysnake.cca.api.v8.component.CardinalComponent;

/**
 * Holds the pigment item favored by the player
 */
public class CCFavoredPigment implements CardinalComponent, AutoSyncedComponent {
    public static final String TAG_PIGMENT = "pigment";

    private final Player owner;

    public CCFavoredPigment(Player owner) {
        this.owner = owner;
    }

    private FrozenPigment pigment = FrozenPigment.DEFAULT.get();

    public FrozenPigment getPigment() {
        return pigment;
    }

    public FrozenPigment setPigment(@Nullable FrozenPigment pigment) {
        var old = this.pigment;
        this.pigment = pigment != null ? pigment : FrozenPigment.DEFAULT.get();
        HexCardinalComponents.FAVORED_PIGMENT.sync(this.owner);
        return old;
    }

    @Override
    public void readData(ValueInput input) {
        this.pigment = input.read(TAG_PIGMENT, FrozenPigment.CODEC).orElseGet(FrozenPigment.DEFAULT);
    }

    @Override
    public void writeData(ValueOutput output) {
        output.store(TAG_PIGMENT, FrozenPigment.CODEC, this.pigment);
    }
}
