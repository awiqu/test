package at.petrak.hexcasting.fabric.cc.adimpl;

import at.petrak.hexcasting.api.addldata.ItemDelegatingEntityIotaHolder;
import at.petrak.hexcasting.api.casting.iota.Iota;
import org.jetbrains.annotations.Nullable;

public abstract class CCEntityIotaHolder implements CCIotaHolder {


    public static class Wrapper extends CCEntityIotaHolder {
        private final ItemDelegatingEntityIotaHolder inner;

        public Wrapper(ItemDelegatingEntityIotaHolder inner) {
            this.inner = inner;
        }


        @Override
        public @Nullable Iota readIota() {
            return inner.readIota();
        }

        @Override
        public boolean writeable() {
            return inner.writeable();
        }

        @Override
        public boolean writeIota(@Nullable Iota iota, boolean simulate) {
            return inner.writeIota(iota, simulate);
        }

        @Override
        public @Nullable Iota emptyIota() {
            return inner.emptyIota();
        }
    }
}
