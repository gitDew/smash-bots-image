<!-- Markdown snapshot generated from the rendered libmelee documentation. -->

# Framedata

Helper functions to be able to query Melee frame data in a way useful to bots

None of the functions and structures here are strictly necessary for making a bot. But they contain a vast and detailed amount of Melee-specific physics calculations and state information that would be difficult to discover on your own.

**class melee.framedata.FrameData(*write=False*)**

Set of helper functions and data structures for knowing Melee frame data

Note

The frame data in libmelee is written to be useful to bots, and behave in a sane way, not necessarily be binary-compatible with in-game structures or values.

**attack_state(*character*, *action*, *action_frame*)**

For the given player, returns their current attack state as an AttackState enum

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in
- **action_frame** (*int*) – The frame of the action we’re interested in

**dj_height(*character_state*)**

Returns the height the character’s double jump will take them. If character is in jump already, returns how heigh that one goes

**Parameters:**

**character_state** ([*gamestate.PlayerState*](gamestate.html#melee.gamestate.PlayerState)) – The player we’re calculating for

**first_hitbox_frame(*character*, *action*)**

**Returns the first frame that a hitbox appears for a given action**

returns -1 if no hitboxes (not an attack action)

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

**frame_count(*character*, *action*)**

Returns the count of total frames in the given action.

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

**frames_until_dj_apex(*character_state*)**

Return the number of frames it takes for the character to reach the apex of their double jump. If they haven’t used it yet, then calculate it as if they jumped right now.

**Parameters:**

**character_state** ([*gamestate.PlayerState*](gamestate.html#melee.gamestate.PlayerState)) – The player we’re calculating for

**hitbox_count(*character*, *action*)**

Returns the number of hitboxes an attack has

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

Note

By this we mean is it a multihit attack? (Peach’s down B?) or a single-hit attack? (Marth’s fsmash?)

**iasa(*character*, *action*)**

Returns the first frame of an attack that the character is interruptible (actionable)

returns -1 if not an attack

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

**in_range(*attacker*, *defender*, *stage*)**

Calculates if an attack is in range of a given defender

**Parameters:**

- **attacker** ([*gamestate.PlayerState*](gamestate.html#melee.gamestate.PlayerState)) – The attacking player
- **defender** ([*gamestate.PlayerState*](gamestate.html#melee.gamestate.PlayerState)) – The defending player
- **stage** ([*enums.Stage*](enums.html#melee.enums.Stage)) – The stage being played on

**Returns:**

integer with the frame that the specified attack will hit the defender 0 if it won’t hit

Note

This considers the defending character to have a single hurtbox, centered at the x,y coordinates of the player (adjusted up a little to be centered)

**is_attack(*character*, *action*)**

For a given character, is the supplied action an attack?

It is an attack if it has a hitbox at any point in the action. Not necessarily right now.

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

**is_bmove(*character*, *action*)**

For a given character, is the supplied action a ‘B-Move’

B-Moves tend to be weird, so it’s useful to know if this is a thing that warrants a special case

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

**is_grab(*character*, *action*)**

For the given character, is the supplied action a grab?

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

This includes command grabs, such as Bowser’s claw. Not just Z-grabs.

**is_roll(*character*, *action*)**

For a given character, is the supplied action a roll?

**libmelee has a liberal definition of ‘roll’. A roll is essentially a move that:**

- Has no hitbox
- Is inactionable

Spot dodge and (most) taunts for example are considered ‘rolls’ to this function

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

**is_shield(*action*)**

Is the given action a Shielding action?

**Parameters:**

**action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

**last_hitbox_frame(*character*, *action*)**

Returns the last frame that a hitbox appears for a given action

returns -1 if no hitboxes (not an attack action)

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in

**last_roll_frame(*character*, *action*)**

**Returns the last frame of the roll**

-1 if not a roll

**Parameters:**

- **character_state** ([*gamestate.PlayerState*](gamestate.html#melee.gamestate.PlayerState)) – The player we’re calculating for
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action the character is in

**max_jumps(*character*)**

Returns the number of double-jumps the given character has.

**Parameters:**

**character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in

Note

This means in general, not according to the current gamestate

**project_hit_location(*character_state*, *stage*, *frames=-1*)**

**How far does the given character fly, assuming they’ve been hit?**

Only considers air-movement, not ground sliding. Projection ends if hitstun ends, or if a platform is encountered

Note

**Platform collision doesn’t take ECB changes into account.**

This means that the timing of collision can be off by a couple frames. Since it’s possible for someone’s Y position to travel below the platform by quite a bit before registering as “collided”

**Parameters:**

- **character_state** (*GameState.PlayerState*) – The character state to calculate for
- **stage** ([*enums.Stage*](enums.html#melee.enums.Stage)) – The stage being played on
- **frames** (*int*) – The number of frames to calculate for. -1 means “until end of hitstun”

**Returns:**

x, y coordinates of the place the character will end up at the end of hitstun, plus frames until that position

**Return type:**

(float, float, int)

**range_backward(*character*, *action*, *action_frame*)**

Returns the maximum remaining range of the given attack, in the backwards direction (relative to how the character starts facing)

Range “remaining” means that it won’t consider hitboxes that we’ve already passed.

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in
- **action_frame** (*int*) – The frame of the action we’re interested in

**range_forward(*character*, *action*, *action_frame*)**

**Returns the maximum remaining range of the given attack, in the forward direction**

(relative to how the character starts facing)

Range “remaining” means that it won’t consider hitboxes that we’ve already passed.

**Parameters:**

- **character** ([*enums.Character*](enums.html#melee.enums.Character)) – The character we’re interested in
- **action** ([*enums.Action*](enums.html#melee.enums.Action)) – The action we’re interested in
- **action_frame** (*int*) – The frame of the action we’re interested in

**roll_end_position(*character_state*, *stage*)**

Returns the x coordinate that the current roll will end in

**Parameters:**

- **character_state** ([*gamestate.PlayerState*](gamestate.html#melee.gamestate.PlayerState)) – The player we’re calculating for
- **stage** ([*enums.Stage*](enums.html#melee.enums.Stage)) – The stage being played on

**save_recording()**

DEV USE ONLY Saves a recorded frame to the framedata csv

**slide_distance(*character_state*, *initspeed*, *frames*)**

How far a character will slide in the given number of frames

**Parameters:**

- **character_state** ([*gamestate.PlayerState*](gamestate.html#melee.gamestate.PlayerState)) – The player we’re interested in
- **initspeed** (*float*) – The character’s starting speed
- **frames** (*int*) – Maximum number of frames to calculate for
