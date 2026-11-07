<!-- Markdown snapshot generated from the rendered libmelee documentation. -->

# MenuHelper

MenuHelper is there to automate away all the tedious menu selections and get you into the game as soon as possible.

Helper functions for navigating the Melee menus in ways that would be cumbersome to do on your own. The goal here is to get you into the game as easily as possible so you don’t have to worry about it. Your AI should concentrate on playing the game, not futzing with menus.

**class melee.menuhelper.MenuHelper**

**static change_controller_status(*controller: [Controller](controller.html#melee.controller.Controller)*, *gamestate: [GameState](gamestate.html#melee.gamestate.GameState)*, *targetport: int*, *status: [ControllerStatus](enums.html#melee.enums.ControllerStatus)*, *character: [Character](enums.html#melee.enums.Character) | None = None*)**

Switch a given player’s controller to be of the given state

Note

There’s a condition on this you need to know. The way controllers work in Melee, if a controller is plugged in, only that player can make the status go to uplugged. If you’ve ever played Melee, you probably know this. If your friend walks away, you have to press the A button on THEIR controller. (or else actually unplug the controller) No way around it.

**choose_character(*character: [Character](enums.html#melee.enums.Character)*, *gamestate: [GameState](gamestate.html#melee.gamestate.GameState)*, *controller: [Controller](controller.html#melee.controller.Controller)*, *cpu_level=0*, *costume=2*, *swag=False*, *start=False*)**

Choose a character from the character select menu

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character you want to pick
- **gamestate** ([*gamestate.GameState*](gamestate.html#melee.gamestate.GameState)) – The current gamestate
- **controller** ([*controller.Controller*](controller.html#melee.controller.Controller)) – The controller object to press buttons on
- **cpu_level** (*int*) – What CPU level to set this to. 0 for human/bot controlled.
- **costume** (*int*) – The costume index to choose
- **swag** (*bool*) – Pick random until you get the character
- **start** (*bool*) – Automatically start the match when it’s ready

Note

Intended to be called each frame while in the character select menu

Note

All controller cursors must be above the character level for this to work. The match won’t start otherwise.

**static choose_direct_online(*gamestate: [GameState](gamestate.html#melee.gamestate.GameState)*, *controller: [Controller](controller.html#melee.controller.Controller)*)**

Helper function to bring us into the direct connect online menu

**Parameters:**

- **gamestate** ([*gamestate.GameState*](gamestate.html#melee.gamestate.GameState)) – The current gamestate
- **controller** ([*controller.Controller*](controller.html#melee.controller.Controller)) – The controller to press buttons on

**choose_stage(*stage: [Stage](enums.html#melee.enums.Stage)*, *gamestate: [GameState](gamestate.html#melee.gamestate.GameState)*, *controller: [Controller](controller.html#melee.controller.Controller)*, *character: [Character](enums.html#melee.enums.Character)*, *frozen_stadium: bool = True*, *autostart: bool = False*)**

Choose a stage from the stage select menu

Intended to be called each frame while in the stage select menu

**Parameters:**

- **stage** ([*enums.Stage*](enums.html#melee.enums.Stage)) – The stage you want to select
- **gamestate** ([*gamestate.GameState*](gamestate.html#melee.gamestate.GameState)) – The current gamestate
- **controller** ([*controller.Controller*](controller.html#melee.controller.Controller)) – The controller object to press
- **frozen_stadium** (*bool*) – Whether to use Frozen Stadium as the stage.
- **autostart** (*bool*) – Whether to actually select the stage and start the match. Should only be true for one controller.

**static choose_versus_mode(*gamestate: [GameState](gamestate.html#melee.gamestate.GameState)*, *controller: [Controller](controller.html#melee.controller.Controller)*)**

Helper function to bring us into the versus mode menu

**Parameters:**

- **gamestate** ([*gamestate.GameState*](gamestate.html#melee.gamestate.GameState)) – The current gamestate
- **controller** ([*controller.Controller*](controller.html#melee.controller.Controller)) – The controller to press buttons on

**enter_direct_code(*gamestate: [GameState](gamestate.html#melee.gamestate.GameState)*, *controller: [Controller](controller.html#melee.controller.Controller)*, *connect_code: str*)**

At the nametag entry screen, enter the given direct connect code and exit

**Parameters:**

- **gamestate** ([*gamestate.GameState*](gamestate.html#melee.gamestate.GameState)) – The current GameState for this frame
- **controller** ([*controller.Controller*](controller.html#melee.controller.Controller)) – A Controller object to press buttons on
- **connect_code** (*str*) – The connect code to direct match with. Leave blank for VS mode.
- **index** (*int*) – Current name tag index

**Returns:**

new index (incremented if we entered a new character)

**menu_helper_simple(*gamestate: [GameState](gamestate.html#melee.gamestate.GameState)*, *controller: [Controller](controller.html#melee.controller.Controller)*, *character_selected: [Character](enums.html#melee.enums.Character)*, *stage_selected: [Stage](enums.html#melee.enums.Stage)*, *connect_code: str | None = None*, *cpu_level: int = 0*, *costume: int = 0*, *autostart: bool = False*, *swag: bool = False*, *frozen_stadium: bool = True*)**

Simplified menu helper function to get you through the menus and into a game

Does everything for you but play the game. Gets you to the right menu screen, picks your character, chooses the stage, enters connect codes, etc…

**Parameters:**

- **gamestate** ([*gamestate.GameState*](gamestate.html#melee.gamestate.GameState)) – The current GameState for this frame
- **controller** ([*controller.Controller*](controller.html#melee.controller.Controller)) – A Controller object that the bot will press buttons on
- **character_selected** ([*enums.Character*](enums.html#melee.enums.Character)) – The character your bot will play as
- **stage_selected** ([*enums.Stage*](enums.html#melee.enums.Stage)) – The stage your bot will choose to play on
- **connect_code** (*Optional**[**str**]*) – The connect code to direct match with. Leave blank for VS mode.
- **cpu_level** (*int*) – What CPU level to set this to. 0 for human/bot controlled.
- **costume** (*int*) – Costume index chosen
- **autostart** (*bool*) – Automatically start the game when it’s ready. Useful for BotvBot matches where no human is there to start it.
- **swag** (*bool*) – What it sounds like
- **frozen_stadium** (*bool*) – Whether to use Frozen Stadium as the stage. Only makes sense for Slippi >= 3.19.0.

**skip_postgame(*controller: [Controller](controller.html#melee.controller.Controller)*)**

Spam the start button
