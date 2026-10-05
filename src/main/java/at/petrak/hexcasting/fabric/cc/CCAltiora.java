package at.petrak.hexcasting.fabric.cc;

import at.petrak.hexcasting.api.player.AltioraAbility;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.jetbrains.annotations.Nullable;
import org.ladysnake.cca.api.v3.component.sync.AutoSyncedComponent;
import org.ladysnake.cca.api.v8.component.CardinalComponent;

public class CCAltiora implements CardinalComponent, AutoSyncedComponent {
    public static final String
        TAG_ALLOWED = "allowed",
        TAG_GRACE = "grace_period";

    @Nullable
    private AltioraAbility altiora = null;

    private final Player owner;

    public CCAltiora(Player owner) {
        this.owner = owner;
    }


    @Nullable
    public AltioraAbility getAltiora() {
        return this.altiora;
    }


    public void setAltiora(AltioraAbility altiora) {
        this.altiora = altiora;
        HexCardinalComponents.ALTIORA.sync(this.owner);
    }

    @Override
    public void readData(ValueInput input) {
        var allowed = input.getBooleanOr(TAG_ALLOWED, false);
        if (!allowed) {
            this.altiora = null;
        } else {
            var grace = input.getIntOr(TAG_GRACE, 0);
            this.altiora = new AltioraAbility(grace);
        }
    }

    @Override
    public void writeData(ValueOutput output) {
        output.putBoolean(TAG_ALLOWED, this.altiora != null);
        if (this.altiora != null) {
            output.putInt(TAG_GRACE, this.altiora.gracePeriod());
        }
    }
}
