<!-- Markdown snapshot generated from the rendered libmelee documentation. -->

# GameState

The GameState represents the current state of the game as a snapshot in time. It’s your primary way to view what’s happening in the game, holding all the information about the game that you probably care about including things like:

- Current frame count
- Current stage

Also a list of PlayerState objects that represent the state of the 4 players:

- Character X,Y coordinates
- Animation of each character
- Which frame of the animation the character is in

The GameState object should be treated as immutable. Changing it won’t have any effect on the game, and you’ll receive a new copy each frame anyway.

## Design Note

Libmelee tries to create a sensible and intuitive API for Melee. So it may break with some low-level binary structures that the game creates. Some examples:

- Melee is wildly inconsistent with whether animations start at 0 or 1. For some animations, the first frame is 0, for others the first frame is 1. This is very annoying when trying to program a bot. So libmelee re-indexes all animations to start at 1. This way the math is always simple and consistent. IE: If grab comes out on “frame 7”, you can reliably check `character.animation_frame == 7`.
- Libmelee treats Sheik and Zelda as one character that transforms back and forth. This is actually not how the game stores the characters internally, though. Internally to Melee, Sheik and Zelda are the same as Ice Clibmers: there’s always two of them. One just happens to be invisible and intangible at a time. But dealing with that would be a pain.

## Some Oddities

Other values in Melee are unintuitive, but are a core aspect of how the game works so we can’t abstract it away.

- Melee doesn’t have just two velocity values (X, Y) it has five! In particular, the game tracks separately your speed “due to being hit” versus “self-induced” speed. This is why after an Amsah tech, you can still go flying off stage. Because your “attack based speed” was high despite not moving anywhere for a while. Libmelee *could* produce a single X,Y speed pair but this would not accurately represent the game state. (For example, SmashBot fails at tech chasing without these 5 speed values)
- Melee tracks whether or not you’re “on ground” separately from your character’s Y position. It’s entirely possible to be “in the air” but be below the stage, and also possible to be “on ground” but have a positive Y value. This is just how the game works and we can’t easily abstract this away.
- Your character model can be in a position very different from the X, Y coordinates. A great example of this is Marth’s Forward Smash. Marth leans WAAAAY forward when doing this attack, but his X position never actually changes. This is why Marth can smash off the stage and be “standing” on empty air in the middle of it. (Because the game never actually moves Marth’s position forward)

Gamestate is a single snapshot in time of the game that represents all necessary information to make gameplay decisions

**melee.gamestate.Cursor**

alias of `Position`

**class melee.gamestate.ECB(*top: Position = <factory>*, *bottom: Position = <factory>*, *left: Position = <factory>*, *right: Position = <factory>*)**

ECBs (Environmental collision box) info. It’s a diamond with four points that define it.

**bottom: Position**

**left: Position**

**right: Position**

**top: Position**

**class melee.gamestate.FoDPlatforms(*left: float32 = np.float32(20.0)*, *right: float32 = np.float32(28.0)*)**

Dataclass for the platforms on the Fountain of Dreams stage.

**left: float32**

**right: float32**

**class melee.gamestate.GameState(*frame: int = -10000*, *stage: [Stage](enums.html#melee.enums.Stage) = Stage.FINAL_DESTINATION*, *whispy: WhispyBlowDirection | None = None*, *fod_platforms: FoDPlatforms | None = None*, *stadium_transformation: StadiumTransformation | None = None*, *menu_state: [Menu](enums.html#melee.enums.Menu) = Menu.IN_GAME*, *submenu: [SubMenu](enums.html#melee.enums.SubMenu) = SubMenu.UNKNOWN_SUBMENU*, *players: dict[int*, *~melee.gamestate.PlayerState]=<factory>*, *projectiles: list[Projectile] = <factory>*, *ready_to_start: bool = False*, *is_teams: bool = False*, *distance: float = 0.0*, *menu_selection: int = 0*, *startAt: str = ''*, *playedOn: str = ''*, *consoleNick: str = ''*, *_newframe: bool = True*, *custom: dict = <factory>*)**

Represents the state of a running game of Melee at a given moment in time

**consoleNick: str**

The name of the console the replay was created on. Might be blank.

**Type:**

(string)

**custom: dict**

Custom fields to be added by the user

**Type:**

(dict)

**distance: float**

Euclidian distance between the two players. (or just Popo for climbers)

**Type:**

(float)

**fod_platforms: FoDPlatforms | None**

**frame: int**

The current frame number. Monotonically increases. Can be negative.

**Type:**

int

**is_teams: bool**

Is this a teams game?

**Type:**

(bool)

**menu_selection: int**

The index of the selected menu item for when in menus.

**Type:**

(int)

**menu_state: [Menu](enums.html#melee.enums.Menu)**

The current menu scene, such as IN_GAME, or STAGE_SELECT

**Type:**

enums.MenuState

**playedOn: str**

Platform the game was played on (values include dolphin, console, and network). Might be blank.

**Type:**

(string)

**players: dict[int, PlayerState]**

Dict of PlayerState objects. Key is controller port

**Type:**

(dict of int - gamestate.PlayerState)

**projectiles: list[Projectile]**

All projectiles (items) currently existing

**Type:**

(list of Projectile)

**ready_to_start: bool**

Is the ‘ready to start’ banner showing at the character select screen?

**Type:**

(bool)

**stadium_transformation: StadiumTransformation | None**

**stage: [Stage](enums.html#melee.enums.Stage)**

The current stage being played on

**Type:**

[enums.Stage](enums.html#melee.enums.Stage)

**startAt: str**

52:59Z’

**Type:**

(string)

**Type:**

Timestamp string of when the game started. Such as ‘2018-06-22T07

**submenu: [SubMenu](enums.html#melee.enums.SubMenu)**

The current sub-menu

**Type:**

([enums.SubMenu](enums.html#melee.enums.SubMenu))

**whispy: WhispyBlowDirection | None**

**class melee.gamestate.PlayerState(*character: [Character](enums.html#melee.enums.Character) = Character.UNKNOWN_CHARACTER*, *character_selected: [Character](enums.html#melee.enums.Character) = Character.UNKNOWN_CHARACTER*, *position: Position = <factory>*, *percent: float = 0*, *shield_strength: float = 60.0*, *is_powershield: bool = False*, *stock: int = 0*, *facing: bool = True*, *action: [Action](enums.html#melee.enums.Action) | UnknownAnimation = <factory>*, *action_frame: int = 0*, *invulnerable: bool = False*, *invulnerability_left: int = 0*, *hitlag_left: int = 0*, *hitstun_frames_left: int = 0*, *jumps_left: int = 0*, *on_ground: bool = True*, *speed_air_x_self: float = 0*, *speed_y_self: float = 0*, *speed_x_attack: float = 0*, *speed_y_attack: float = 0*, *speed_ground_x_self: float = 0*, *nana: PlayerState | None = None*, *cursor: Position = <factory>*, *coin_down: bool = False*, *controller_status: [ControllerStatus](enums.html#melee.enums.ControllerStatus) = ControllerStatus.CONTROLLER_UNPLUGGED*, *off_stage: bool = False*, *iasa: int = 0*, *moonwalkwarning: bool = False*, *controller_state: [ControllerState](controller.html#melee.controller.ControllerState) = <factory>*, *ecb: ECB = <factory>*, *ecb_right: tuple = (0*, *0)*, *ecb_left: tuple = (0*, *0)*, *ecb_top: tuple = (0*, *0)*, *ecb_bottom: tuple = (0*, *0)*, *costume: int = 0*, *cpu_level: int = 0*, *is_holding_cpu_slider: bool = False*, *nickName: str = ''*, *connectCode: str = ''*, *displayName: str = ''*, *team_id: int = 0*)**

Represents the state of a single player

**action: [Action](enums.html#melee.enums.Action) | UnknownAnimation**

The current action (or animation) the character is in

**Type:**

(enum.Action)

**action_frame: int**

What frame of the Action is the character in? Indexed from 1.

**Type:**

(int)

**character: [Character](enums.html#melee.enums.Character)**

The player’s current character

**Type:**

(enum.Character)

**character_selected: [Character](enums.html#melee.enums.Character)**

**coin_down: bool**

Is the player’s character selection coin placed down? (Does not work in Slippi selection screen)

**Type:**

(bool)

**connectCode: str**

The rollback connect code for the player. Might be blank.

**Type:**

(string)

**controller_state: [ControllerState](controller.html#melee.controller.ControllerState)**

What buttons were pressed for this character

**Type:**

([controller.ControllerState](controller.html#melee.controller.ControllerState))

**controller_status: [ControllerStatus](enums.html#melee.enums.ControllerStatus)**

Status of the player’s controller.

**Type:**

([enums.ControllerStatus](enums.html#melee.enums.ControllerStatus))

**costume: int**

Index for which costume the player is wearing

**Type:**

(int)

**cpu_level: int**

CPU level of player. 0 for a libmelee-controller bot or human player.

**Type:**

(int)

**cursor: Position**

x, y cursor position

**Type:**

(Position)

**displayName: str**

The Slippi Online display name for the play. Might be blank

**Type:**

(string)

**ecb: ECB**

**ecb_bottom: tuple**

Bottom edge of the ECB. (x, y) offset from player’s center.

**Type:**

(float, float)

**ecb_left: tuple**

Left edge of the ECB. (x, y) offset from player’s center.

**Type:**

(float, float)

**ecb_right: tuple**

Right edge of the ECB. (x, y) offset from player’s center.

**Type:**

(float, float)

**ecb_top: tuple**

Top edge of the ECB. (x, y) offset from player’s center.

**Type:**

(float, float)

**facing: bool**

Is the character facing right? (left is False). Characters in Melee must always be facing left or right

**Type:**

(bool)

**hitlag_left: int**

How many more frames of hitlag there is

**Type:**

(bool)

**hitstun_frames_left: int**

How many more frames of hitstun there is

**Type:**

(int)

**iasa: int**

**invulnerability_left: int**

How many frames of invulnerability are left.

**Type:**

(int)

**invulnerable: bool**

Is the player invulnerable?

**Type:**

(bool)

**is_holding_cpu_slider: bool**

Is the player holding the CPU slider in the character select screen?

**Type:**

(bool)

**is_powershield: bool**

Is the current action a Powershield? (not directly determinable via action states)

**Type:**

(bool)

**jumps_left: int**

Number of jumps available. Including ground jump. Will be 2 for most characters on ground.

**Type:**

(int)

**moonwalkwarning: bool**

Helper variable to tell you that if you dash back right now, it’ll moon walk

**Type:**

(bool)

**nana: PlayerState | None**

Additional player state for Nana, if applicable. If the character is not Ice Climbers, Nana will be None. Will also be None if this player state is Nana itself. Lastly, the secondary climber is called ‘Nana’ here, regardless of the costume used.

**Type:**

(enums.PlayerState)

**nickName: str**

The in-game nickname for the player. Might be blank.

**Type:**

(string)

**off_stage: bool**

Helper variable to say if the character is ‘off stage’.

**Type:**

(bool)

**on_ground: bool**

Is the character on the ground?

**Type:**

(bool)

**percent: float**

The player’s damage

**Type:**

(int)

**position: Position**

x, y character position

**Type:**

(Position)

**shield_strength: float**

The player’s shield strength (max 60). Shield breaks at 0

**Type:**

(float)

**speed_air_x_self: float**

Self-induced horizontal air speed

**Type:**

(float)

**speed_ground_x_self: float**

Self-induced horizontal ground speed

**Type:**

(float)

**speed_x_attack: float**

Attack-induced horizontal speed

**Type:**

(float)

**speed_y_attack: float**

Attack-induced vertical speed

**Type:**

(float)

**speed_y_self: float**

Self-induced vertical speed

**Type:**

(float)

**stock: int**

The player’s remaining stock count

**Type:**

(int)

**team_id: int**

The team ID of the player. This is different than costume, and only relevant during teams.

**Type:**

(int)

**class melee.gamestate.Position(*x: float32 = np.float32(0.0)*, *y: float32 = np.float32(0.0)*)**

Dataclass for position types. Has (x, y) coords.

**x: float32**

**y: float32**

**class melee.gamestate.Projectile(*position: Position = <factory>*, *speed: Position = <factory>*, *owner: int = -1*, *type: [ProjectileType](enums.html#melee.enums.ProjectileType) | UnknownProjectileType = ProjectileType.UNKNOWN_PROJECTILE*, *expiration_frames: float = 0*, *subtype: int = 0*, *spawn_id: uint32 = np.uint32(0)*)**

Represents the state of a projectile (items, lasers, etc…)

**expiration_frames: float**

How long the item has been out

**Type:**

(int)

**owner: int**

Player port of the projectile’s owner. -1 for no owner

**Type:**

(int)

**position: Position**

x, y projectile position

**Type:**

(Position)

**spawn_id: uint32**

**speed: Position**

x, y projectile speed

**Type:**

(Position)

**subtype: int**

The subtype of the item. Many projectiles have ‘subtypes’ that make them different. They’re all different, so it’s not an enum

**Type:**

(int)

**type: [ProjectileType](enums.html#melee.enums.ProjectileType) | UnknownProjectileType**

Which actual projectile type this is

**Type:**

([enums.ProjectileType](enums.html#melee.enums.ProjectileType))

**melee.gamestate.Speed**

alias of `Position`

**class melee.gamestate.StadiumTransformation(*event: StadiumTransformationEvent = StadiumTransformationEvent.FINISHED*, *type: StadiumTransformationType = StadiumTransformationType.NORMAL*)**

Current Pokemon Stadium transformation state

**event: StadiumTransformationEvent**

**type: StadiumTransformationType**

**class melee.gamestate.StadiumTransformationEvent(**values*)**

Pokemon Stadium transformation event types

**FINALIZE = 6**

**FINISHED = 0**

**INITIALIZE = 2**

**NEW_RISING = 5**

**ON_MONITOR = 3**

**PREVIOUS_RECEDING = 4**

**class melee.gamestate.StadiumTransformationType(**values*)**

Pokemon Stadium transformation types

**FIRE = 3**

**GRASS = 4**

**NORMAL = 5**

**ROCK = 6**

**WATER = 9**

**class melee.gamestate.UnknownAnimation(*value: int = -1*)**

**value: int**

**class melee.gamestate.UnknownProjectileType(*value: uint16*)**

Represents an unknown projectile type

**value: uint16**

**class melee.gamestate.WhispyBlowDirection(**values*)**

**LEFT = np.uint8(1)**

**NONE = np.uint8(0)**

**RIGHT = np.uint8(2)**

**melee.gamestate.port_detector(*gamestate*, *character*, *costume*)**

Autodiscover what port the given character is on

Slippi Online assigns us a random port when playing online. Find out which we are

**Returns:**

The given character belongs to the returned port 0: We don’t know.

**Return type:**

[1-4]

**Parameters:**

- **gamestate** – Current gamestate
- **character** – The character we know we picked
- **costume** – Costume index we picked
