# HANDOFF — Hex Casting → Minecraft 26.2 (Fabric): что сделано, что не проверено, что чинить

Документ для новой сессии. Ветка: `port/hexcasting-26.2` (репозиторий awiqu/test). Готовые jar: `releases/`.
Язык проекта: код/комментарии английские, общение с пользователем — по-русски.

## 0. Задача и итог
Пользователь дал jar `hexcasting-fabric-1.20.1-0.11.4.jar` и попросил портировать мод на Minecraft **26.2** (Fabric). Решения принимать самому, подтверждений не будет.

Результат: мод компилируется (Java 25), выделенный сервер с модом стартует и работает; **клиентская часть не запускалась** (в контейнере нет GPU; софтовые OpenGL/Vulkan зависали на загрузке ресурсов). Всё клиентское проверено только компиляцией и чтением исходников 26.2.

## 1. Ключевые решения
1. **База — апстрим ветка `1.21`** (`FallingColors/HexMod`, 0.12.0-devel, MIT), а не 0.11.4: в ней уже сделаны data components, сеть, ValueInput и т.д. Прямой порт 1.20.1→26.2 был бы намного дороже. Следствие: игровая логика/контент новее и может отличаться от 0.11.4.
2. **Один Gradle-модуль** вместо Common+Fabric(+NeoForge): `src/main` = Common+Fabric слитые, `src/generated/resources` = datagen-вывод апстрима (правится руками, датаген отключён).
3. **Loom `net.fabricmc.fabric-loom` 1.18.2**, без маппингов (26.x не обфусцирован), Gradle 9.7.1, Kotlin 2.4.20 (+ fabric-language-kotlin 1.14.1), JDK 25. Моды подключаются через `implementation`, не `modImplementation`.
4. **Зависимости под 26.2:** Fabric API 0.161.0+26.2, Cardinal Components 8.0.1, Cloth Config 26.2.155 (через Modrinth maven), ModMenu 20.0.3, Patchouli — свой порт (см. §5).
5. **Paucal встроен минимально** (`at.petrak.hexcasting.shim.PaucalCodecs`, `ContributorsManifest` — заглушка, всегда `null`).
6. **Отключено (нет релизов под 26.x):** Inline (`disabled/inline`), Trinkets (`disabled/trinkets`), Pehkui (код-абстракция оставлена, `getPehkuiApi()` бросает исключение, `isModPresent("pehkui")` ложно), JEI/EMI (`disabled/jei`, `disabled/emi`), датаген (`disabled/datagen`). `HexInterop` вызывает Patchouli-код только если Patchouli загружен; в `fabric.mod.json` Patchouli — `recommends`.
7. `PatternIota.display` и `EntityIota` больше не используют Inline (показывают текст углов/имя).

## 2. Структура репозитория
- `src/main/java/at/petrak/hexcasting/**` — Java + Kotlin вместе (Kotlin подхватывается из `src/main/java` через `kotlin.srcDirs`).
- `src/main/resources`, `src/generated/resources` — ресурсы/данные (уже в форматах 26.2).
- `fabricasting.accesswidener` — формат `accessWidener v2 official`, пока почти пустой (нужен только `BlockSetType.register`).
- `disabled/` — отключённые интеграции и датаген (для будущего портирования).
- `dev-libs/` и `releases/` — порт Patchouli (jar); `patchouli-26.2/` — исходники порта Patchouli (отдельный Gradle-проект).
- `tools/build.sh` (сериализованный gradle через flock; `OUT=файл`), `tools/javac-check.sh` (отдельный javac по Java без Kotlin — полезен, когда Kotlin не компилируется).
- `PORTING_NOTES.md` — краткие заметки; `README.md` — описание.

## 3. Как работать в новой сессии
```bash
# JDK 25 (в чистом контейнере его нет):
mkdir -p /opt/jdk25 && cd /opt/jdk25 && curl -sL -o jdk25.tgz \
 "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jdk_x64_linux_hotspot_25.0.4.1_1.tar.gz" && tar xzf jdk25.tgz
export JAVA_HOME=/opt/jdk25/jdk-25.0.4.1+1 PATH=$JAVA_HOME/bin:$PATH
cd <repo> && ./gradlew compileJava        # быстрый чек
./gradlew jar                              # build/libs/hexcasting-fabric-26.2-*.jar
echo eula=true > run/eula.txt && ./gradlew runServer   # dev-сервер (команды через stdin)
```
Окружение: исходящий HTTPS идёт через прокси (CA уже настроен). `github.com` через curl недоступен, но `raw.githubusercontent.com` и git-clone публичных репозиториев работают (`GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 ...`). Maven Central иногда отдаёт 429 при параллельных сборках — повторить. `pkill -f <строка>` убивает и собственный шелл, если строка есть в команде — убивать процессы по PID (`jps -l`).

Справочные материалы, которые нужно **восстановить** (в прошлой сессии лежали в scratchpad и пропадут):
- Декомпилированные исходники MC 26.2: `./gradlew genSources`, затем `unzip .gradle/loom-cache/minecraftMaven/net/minecraft/minecraft-merged-*/26.2/*-sources.jar -d <dir>`; список классов — `unzip -Z1 <minecraft-merged-deobf-26.2.jar>`.
- Исходники Fabric API: `https://maven.fabricmc.net/net/fabricmc/fabric-api/<module>/<version>/<module>-<version>-sources.jar` (версии модулей — из gradle-кэша); CCA: `https://maven.ladysnake.org/releases/org/ladysnake/cardinal-components-api/cardinal-components-<m>/8.0.1/...-sources.jar`.
- Апстрим HexMod: `git clone https://github.com/FallingColors/hexmod` (ветка `1.21`).
- Patchouli: `git clone -b 26.1 https://github.com/VazkiiMods/Patchouli`.

## 4. Что было изменено (главные API-сдвиги 1.21.1 → 26.2 и как решено)
Общее/ядро:
- `ResourceLocation`→`Identifier` (sed + авто-поиск переехавших пакетов), `ResourceKey.location()`→`identifier()`, `Registry.get(id)` теперь Optional (значение — `getValue`), `EntityType.X`→`EntityTypes.X`, `Tier`→`ToolMaterial`, `Util`→`net.minecraft.util.Util`, `ServerPlayer.serverLevel()`→`level()`, `Direction.getNearest(double)`→`getApproximateNearest`.
- NBT: геттеры `CompoundTag` возвращают `Optional` → `api/utils/NBTHelper.kt` переписан (статические Java-обёртки сохранены), `NBTDsl.kt` поправлен; UUID хранятся как int-array через `UUIDUtil`.
- Инвентарь: списки items/armor/offhand убраны → `getItem(slot)`/`containerSize`/`getNonEquipmentItems()`/`getSelectedSlot()`; брони/offhand идентифицируются через `Inventory.EQUIPMENT_SLOT_MAPPING`.
- Урон: `Mishap.trulyHurt` переписан на `hurtServer(ServerLevel, …)`; `isInvulnerableTo(level, source)`.
- Погода (`server.setWeatherParameters`), рецепты бранесвипа (`level.recipeAccess().recipes` + `filterIsInstance<BrainsweepRecipe>`), ClickEvent/HoverEvent (record-классы), `ClipContext` с `CollisionContext`, `ArmorMaterial` (запись с `assetId`), `MobEffects` переименованы (NAUSEA, SLOWNESS, HASTE, STRENGTH…), `Item.getDescription` убран.
- Fabric API: `END_WORLD_TICK`→`END_LEVEL_TICK`, `ItemGroupEvents`→`CreativeModeTabEvents`, `FabricBrewingRecipeRegistryBuilder`→`FabricPotionBrewingBuilder`, `createS2CPacket`→`new ClientboundCustomPayloadPacket`, `UseItemCallback` возвращает `InteractionResult`.
- Теги кастомных реестров Fabric лежат в `data/<ns>/tags/<ns>/<path>/` → теги действий перенесены в `data/hexcasting/tags/hexcasting/action/` (без этого «великие» паттерны не находились: 0 per-world действий; после исправления 14).
- Миксины: удалены `FabricVillagerTurnIntoWitchMixin` и все мёртвые клиентские; `FabricMobMixin` теперь инжектится в 4-арг `convertTo`; `FabricLivingEntityMixin` — в `checkFallDamage`; `AccessorAbstractArrow` → `@Invoker("isInGround")`; `MixinWanderingTrader.updateTrades(ServerLevel)`. refmap убран.

Блоки/предметы/регистрация (агент B):
- В 26.x у `Item.Properties`/`BlockBehaviour.Properties` обязателен `setId(ResourceKey)` до конструктора → `xplat/RegisterContext` (ThreadLocal), `FabricRegister` ставит ключ перед созданием, `HexItems.props()`/`HexBlocks.blockProps()` берут его. `HexBlocks` больше не обращается к `HexItems` (иначе NPE при инициализации).
- Предметы: `use()` → `InteractionResult`, `appendHoverText` с `TooltipDisplay`, `inventoryTick(ServerLevel,…)`, `getName` вместо `getDescriptionId(stack)`, `addCooldown(stack,…)`, молот ювелира = `Item` с `props.pickaxe(...)`, линза = `equippableUnswappable(HEAD)`.
- Блоки: новый `updateShape`, `EnumProperty<Direction>`, `neighborChanged(Orientation)`, `useItemOn/useWithoutItem`, `getCloneItemStack`; `onRemove` импетуса → `BlockEntityAbstractImpetus.preRemoveSideEffects`.
- Рецепты: `BrainsweepRecipe` — record, `Recipe<RecipeInput>` с `NOT_PLACEABLE`; `SealThingsRecipe` — `CustomRecipe`; удалены `SealSpellbookRecipe`, `RecipeSerializerBase`; Fabric `CustomIngredient` для `FabricUnsealedIngredient`/`FabricModConditionalIngredient`. Лут-функции — `MapCodec`. Сеть — `PayloadTypeRegistry.serverboundPlay()/clientboundPlay()`.

BlockEntity/Entity/CCA/SavedData (агент A):
- `HexBlockEntity`: `saveModData(ValueOutput)`/`loadModData(ValueInput)`, `getUpdateTag`→`saveCustomOnly`. Все BE на кодеках.
- CCA 8.0.1: компоненты — `CardinalComponent` с `readData/writeData`; **исправлен баг апстрима:** `CCFavoredPigment` не сохранялся.
- `EntityWallScroll` по образцу `Painting`/`HangingEntity`; направление хранится как `Direction.LEGACY_ID_CODEC_2D`.
- `ScrungledPatternsSave` на `SavedDataType` (id `hexcasting:per_world_patterns` — сохранённые паттерны старых миров не подхватятся).

Клиент (агент R) — **не проверено запуском**:
- Рендер переписан на `RenderPipeline`/`SubmitNodeCollector`/`GuiGraphicsExtractor`: `client/render/*`, `HexRenderPipelines`, `HexRenderTypes`, шейдер `assets/hexcasting/shaders/core/grayscale.fsh`, `VCDrawHelper` (Gui/Worldly), `PatternRenderer`, `PatternTextureManager`, `GuiSpellcasting` (новые input-события, свой аккумулятор скролла), BER (слэйт, книжная полка, quenched allay), `WallScrollRenderer`, `AltioraLayer`, частицы, `FabricHexClientInitializer.kt`.
- Свойства моделей предметов: `client/HexItemProperties.java` регистрирует `hexcasting:overlay_layer`, `gaslighting`, `media_fullness`, `max_media_scale` и tint `hexcasting:iota_color`; ссылки на них — в `src/generated/resources/assets/hexcasting/items/*.json` (128 определений). Если id не зарегистрирован — предмет рендерится «missing model».
- Остались 2 клиентских миксина: `MixinClientLevel` (`doAnimateTick`), `FabricMouseHandlerMixin` (`@WrapOperation` на `ScrollWheelHandler.onMouseScroll`).
- Упрощения: линии стража без глубины (5px), паттерны каста вокруг игрока — unlit translucent; слои GUI-паттерна зависят от порядка по bounds; текстура паттерна LINEAR/clamp.
- Удалены: `setRenderLayer` (слои выводятся из текстур), `FakeBufferSource`, `HexShaders`, `MyOwnArmorModel…`, ряд accessor'ов/миксинов.

Ресурсы (агент D):
- Все `*.json5` → `.json` (lang развёрнут по правилам старого плагина), `pack.mcmeta` удалён (Fabric генерирует).
- 128 `items/*.json`; рецепты (135) на строковые ингредиенты; advancement `background` без `textures/…png`; теги forge/neoforge/create убраны; конвенционные теги переименованы (`c:ingots/*` и т.д.); worldgen деревьев — `below_trunk_provider`; `patchouli_book` item definition.
- Load-conditions: рецепт/лут/ачивка `patchi_book` требуют `fabric:all_mods_loaded ["patchouli"]`; `pride_colorizer_pansexual` требует `farmersdelight` (иначе предупреждение про пустые ингредиенты).
- «Funny staff» (переименованный посох) был мёртв и в 1.21.1 — не портировался. Брони/робы в `HexItems` не зарегистрированы (как в апстриме) — `equipment/robes.json` не создавался; `HexAPI` ссылается на asset id `hexcasting:robes`.

## 5. Patchouli
Официального Patchouli под 26.2 нет; 26.1 бинарно несовместим (в 26.2 изменились `CriterionTrigger`, `MultiBufferSource`, `Minecraft.screen`, рендер мультиблока и др.). Порт: `patchouli-26.2/` (исходники, Gradle-проект с отключёнными spotless/pmd/neoforge, Xplat-исходники компилируются внутрь Fabric-модуля) → `dev-libs/patchouli-26.2-94-port.jar`. Мод компилируется и запускается с ним (`compileOnly`/`localRuntime files(...)`). Сервер: Patchouli грузится без ошибок, рецепт `patchi_book` и 97 JSON книги читаются. Клиент Patchouli (GUI книги, PiP мультиблока, ghost-мультиблок через `LevelRenderEvents.COLLECT_SUBMITS`) **не запускался**. Лицензия Patchouli — CC BY-NC-SA 3.0.

## 6. Что проверено / не проверено
Проверено на dedicated server (stdin-команды): загрузка реестров и миксинов; 1719 рецептов, ~1827 advancements без ошибок; все блоки мода через `setblock` + `save-all` + повторный запуск; лут-таблицы (`random_scroll`, `random_cypher`, амethyst-инъекция и др.); команды `perWorldPatterns list`, `recalcPatterns`, `brainsweep`, `textureToggle`; 27 предметов призваны как item-entity.

**Не проверено вообще:** весь клиент (рендер паттернов, GUI заклинаний, тултипы, модели/тинты, частицы, wings, BER, Patchouli GUI); `use()`/`useOn`/правый клик, hover-текст, creative-вкладки, pick-block, диспенсер; реальный каст хекса (`CastingVM`) с игроком; brainsweep через заклинание; impetus-цепочки; сетевые пакеты клиент↔сервер; CCA-синхронизация на клиент; Fabric-ингредиенты `mod_conditional/unsealed`; Mod Menu/Cloth Config экран.

## 7. Известные проблемы / TODO (приоритет сверху)
1. **Запустить клиент и починить ошибки загрузки/рендера.** Если нет GPU: `apt-get install -y mesa-vulkan-drivers xvfb`; запуск `ALSOFT_DRIVERS=null VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a ./gradlew runClient --args="--quickPlaySingleplayer world --graphicsBackend vulkan --width 427 --height 240"` (мир — скопировать серверный `run/world` в `run/saves/world`). В прошлый раз загрузка зависала после создания атласов / «BookContentResourceListenerLoader preloaded 97 jsons» (поток рендера всё время в `vkQueuePresentKHR`/GL-blit, 0 воркеров) — не ясно, виноват ли софтовый рендер (JIT шейдеров в llvmpipe) или наш код; vanilla без мода для сравнения не гоняли. Идея: сравнить с чистым клиентом; поставить `-Dfabric...`/убрать мод; включить `glDebugVerbosity`; посмотреть, нет ли бесконечного ожидания на главном потоке в нашем коде (pattern texture manager, `HexRenderPipelines`).
2. Места, где искать при падении пайплайнов/шейдеров: `client/render/shader/HexRenderPipelines.java`, `assets/hexcasting/shaders/core/grayscale.fsh`, `client/HexItemProperties.java`, `client/RegisterClientStuff.java`.
3. Лог сервера: `No key layers in MapLike[{}]` при создании мира (вероятно ванильное/Fabric, не от мода — не расследовано); `Bucketable` mixin warning от CCA (безвредно); предупреждение про непереведённые item-теги (`tag.item.hexcasting.*`).
4. Data components с Iota нужны корректные `equals/hashCode` (TODO из порта).
5. `CircleExecutionState`/`CCStaffcastImage` сериализуют `CastingImage` через голый `NbtOps` (как в апстриме) — итоты, требующие registry-контекста, могут упасть.
6. Рецепты бранесвипа не синхронизируются на клиент (Patchouli берёт их из своего `ClientRecipes`).
7. Миграция: старые сохранённые per-world паттерны не переносятся (новый id SavedData).
8. Вернуть отключённые интеграции при появлении версий под 26.x (Inline, JEI/EMI — `PatternDrawingUtil.drawPattern` теперь принимает `GuiGraphicsExtractor`, Trinkets, Pehkui); вернуть датаген (сейчас JSON правится руками); при желании зарегистрировать робы и создать `assets/hexcasting/equipment/robes.json`.
9. `AccessorLootTable`/`AccessorUseOnContext`: `UseOnContext` конструктор теперь публичный (аксессор можно убрать); проверить `AccessorLootTable` (`compositeFunction` поле существует).
10. Проверить, что `fabric.mod.json` зависимости корректны для публикации (`minecraft ~26.2`, `java >=25`, CCA/cloth `*`).
11. Распространение: Patchouli-порт — модификация чужого мода (CC BY-NC-SA); решить, как отдавать пользователю.

## 8. Как была организована работа (на случай переиспользования)
Ядро — лидер; параллельно 4 саб-агента с непересекающимися зонами (клиент/рендер; ресурсы; предметы-блоки-рецепты-сеть; BE-сущности-CCA-SavedData) + агент для Patchouli. Сборка Kotlin→Java последовательна: пока Kotlin не компилируется, javac-ошибки скрыты → `tools/javac-check.sh`. Агенты упирались в лимит API (их возобновляли `SendMessage`). Весь рабочий процесс и команды — в §3.

## 9. Файлы-результаты
- `releases/hexcasting-fabric-26.2-0.12.0-26.2.jar` — мод (4 МБ).
- `releases/patchouli-26.2-94-port.jar` — порт Patchouli.
- Ветка `port/hexcasting-26.2`, последние коммиты: «Bundle Patchouli 26.2 port, README», «Add built jars».
