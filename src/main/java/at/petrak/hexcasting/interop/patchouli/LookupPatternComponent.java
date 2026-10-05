package at.petrak.hexcasting.interop.patchouli;

import at.petrak.hexcasting.api.casting.math.HexPattern;
import at.petrak.hexcasting.api.mod.HexTags;
import at.petrak.hexcasting.xplat.IXplatAbstractions;
import com.google.gson.annotations.SerializedName;
import net.minecraft.core.HolderLookup;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.Identifier;
import vazkii.patchouli.api.IVariable;

import java.util.List;
import java.util.function.UnaryOperator;

/**
 * Grab the pattern from the registry
 */
public class LookupPatternComponent extends AbstractPatternComponent {
    @SerializedName("op_id")
    public String opNameRaw;

    protected Identifier opName;
    protected boolean strokeOrder;

    @Override
    public List<HexPattern> getPatterns(UnaryOperator<IVariable> lookup) {
        var registry = IXplatAbstractions.INSTANCE.getActionRegistry();
        var key = ResourceKey.create(registry.key(), this.opName);
        var holder = registry.get(key).orElseThrow();

        this.strokeOrder = !holder.is(HexTags.Actions.PER_WORLD_PATTERN);
        return List.of(holder.value().prototype());
    }

    @Override
    public boolean showStrokeOrder() {
        return this.strokeOrder;
    }

    @Override
    public void onVariablesAvailable(UnaryOperator<IVariable> lookup, HolderLookup.Provider registries) {
        var opName = lookup.apply(IVariable.wrap(this.opNameRaw)).asString();
        this.opName = Identifier.tryParse(opName);

        super.onVariablesAvailable(lookup, registries);
    }
}
