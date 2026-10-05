# Porting notes: Hex Casting -> Minecraft 26.2 (Fabric)

Base: upstream HexMod `1.21` branch (0.12.0-devel, MIT), collapsed to a single Gradle module (Common + Fabric merged),
Fabric Loom 1.18 (no mappings: Minecraft 26.x is unobfuscated), Java 25.

Layout / tooling:
- `src/main` is the merged Common+Fabric source. `src/generated/resources` is the datagen output of upstream (shipped as-is).
- Minecraft 26.2 decompiled sources (for API lookups): run `./gradlew genSources`, then unzip the sources jar from `.gradle/loom-cache/minecraftMaven/...-sources.jar`.
- `tools/build.sh [task]` runs a serialized gradle build (Java 25 from /opt/jdk25).
- `disabled/` holds integrations that could not be ported yet (no 26.x releases of Inline/JEI/EMI/Trinkets; datagen).

## Team workflow (parallel porting)
Reference material (outside the repo, in the session scratchpad `/tmp/claude-0/-home-user-test/3d48c79f-cf20-5233-b63c-3022b75d7275/scratchpad`):
- `mcsrc/` decompiled Minecraft 26.2 sources (grep here for the current API); `tools/mc_classes.txt` all MC class names; `tools/ext_classes.txt` Fabric API/CCA/Cloth/Patchouli class names.
- `fapisrc/<module>/` Fabric API 0.161.0+26.2 sources (e.g. `fabric-networking-api-v1`, `fabric-recipe-api-v1`), `fapisrc/cca-*/` Cardinal Components 8.0.1 sources.
- `/home/user/fallingcolors/hexmod` upstream HexMod clone (branch `1.21` checked out) for the original code.
Build/feedback: `tools/build.sh compileKotlin|compileJava` (serialized via lock; writes errors to $OUT). javac only runs after Kotlin compiles, so for early Java diagnostics use `tools/javac-check.sh` (standalone javac, ignores Kotlin; errors mentioning hexcasting Kotlin classes are noise) and filter by your files.
Known API changes already handled in shared code: `ResourceLocation`->`Identifier`, NBT getters return `Optional` (use `getIntOr`, `getCompoundOrEmpty`, ... or the helpers in `api/utils/NBTHelper`), `Registry.get(Identifier)` returns an Optional holder (`getValue(...)` returns the value), `EntityType.X` constants live in `EntityTypes`, `Tier`->`ToolMaterial`, inventory access via `getItem(slot)`/`containerSize` (items/armor/offhand lists are gone), `ResourceKey.location()`->`identifier()`, `Level.isClientSide` -> `level.isClientSide()`, entity hurting is `hurtServer(ServerLevel, ...)`, block entities/entities save via `ValueInput`/`ValueOutput`.
