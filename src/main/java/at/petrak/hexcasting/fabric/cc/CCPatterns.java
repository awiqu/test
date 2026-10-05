package at.petrak.hexcasting.fabric.cc;

import at.petrak.hexcasting.api.casting.eval.ResolvedPattern;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import org.ladysnake.cca.api.v8.component.CardinalComponent;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class CCPatterns implements CardinalComponent {
    public static final String TAG_PATTERNS = "patterns";

    private final Player owner;

    private List<ResolvedPattern> patterns = Collections.emptyList();

    public CCPatterns(ServerPlayer owner) {
        this.owner = owner;
    }


    public List<ResolvedPattern> getPatterns() {
        return patterns;
    }

    public void setPatterns(List<ResolvedPattern> patterns) {
        this.patterns = patterns;
    }

    @Override
    public void readData(ValueInput input) {
        List<ResolvedPattern> patterns = new ArrayList<>();
        for (var pattern : input.listOrEmpty(TAG_PATTERNS, ResolvedPattern.CODEC)) {
            patterns.add(pattern);
        }
        this.patterns = patterns;
    }

    @Override
    public void writeData(ValueOutput output) {
        var list = output.list(TAG_PATTERNS, ResolvedPattern.CODEC);
        for (ResolvedPattern pattern : patterns) {
            list.add(pattern);
        }
    }
}
