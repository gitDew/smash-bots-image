<!-- Markdown snapshot generated from the rendered libmelee documentation. -->

# Controller

Defines a Clontroller class that manages pressing buttons for your console

**class melee.controller.Controller(*console: [Console](console.html#melee.console.Console)*, *port: int*, *type: [ControllerType](enums.html#melee.enums.ControllerType) = ControllerType.STANDARD*, *fix_analog_inputs: bool = True*)**

Manages virtual controller state and button presses

The Controller object is your primary input mechanism for a bot. It’s used for pressing buttons programatically, but also automatically configuring the controller with dolphin

**connect()**

Connect the controller to the console

Note

Blocks until the other side is ready

**disconnect()**

Disconnects the controller from the console

**empty_input()**

**flush()**

Actually send the button presses to the console

Up until this point, any buttons you ‘press’ are just queued in a pipe. It doesn’t get sent to the console until you flush

**press_button(*button: [Button](enums.html#melee.enums.Button)*)**

Press a single button

If already pressed, this has no effect

**Parameters:**

**button** ([*enums.Button*](enums.html#melee.enums.Button)) – Button to press

**press_shoulder(*button: [Button](enums.html#melee.enums.Button)*, *amount: float*)**

Press the analog shoulder buttons to a given amount

**Parameters:**

- **button** ([*enums.Button*](enums.html#melee.enums.Button)) – Has to be L or R
- **amount** (*float*) – Ranges from 0 (not pressed at all) and 1 (Fully pressed in)

Note

The ‘digital’ button press of L or R are handled separately as normal button presses. Pressing the shoulder all the way in will not cause the digital button to press

**release_all()**

Resets the controller to a resting state

All buttons are released, all sticks set to 0.5, all shoulders set to 0

**release_button(*button*)**

Release a single button

If already released, this has no effect

**Parameters:**

**button** ([*enums.Button*](enums.html#melee.enums.Button)) – Button to release

**simple_press(*x*, *y*, *button*)**

Here is a simpler representation of a button press, in case you don’t want to bother with the tedium of manually doing everything. It isn’t capable of doing everything the normal controller press functions can, but probably covers most scenarios. Notably, a difference here is that doing a button press releases all other buttons pressed previously.

Note

**Don’t call this function twice in the same frame**

x = 0 (left) to 1 (right) on the main stick y = 0 (down) to 1 (up) on the main stick button = the button to press. Enter None for no button

**tilt_analog(*button: [Button](enums.html#melee.enums.Button)*, *x: float*, *y: float*)**

Tilt one of the analog sticks to a given (x,y) value

**Parameters:**

- **button** ([*enums.Button*](enums.html#melee.enums.Button)) – Must be main stick or C stick
- **x** (*float*) – Ranges between 0 (left) and 1 (right)
- **y** (*float*) – Ranges between 0 (down) and 1 (up)

**tilt_analog_unit(*button*, *x*, *y*)**

Tilt one of the analog sticks to a given (x,y) value.

Values range from -1 -> 1 (with 0 center) rather than 0 -> 1 (with 0.5 center) This doesn’t press the stick any further than the tilt_analog(), it’s just a compat helper.

**Parameters:**

- **button** ([*enums.Button*](enums.html#melee.enums.Button)) – Must be main stick or C stick
- **x** (*float*) – Ranges between -1 (left) and 1 (right)
- **y** (*float*) – Ranges between -1 (down) and 1 (up)

**class melee.controller.ControllerState(*button: dict[~melee.enums.Button*, *bool]=<factory>*, *processed_button: dict[~melee.enums.Button*, *bool]=<factory>*, *main_stick: tuple[float*, *float]=(0.5*, *0.5)*, *c_stick: tuple[float*, *float]=(0.5*, *0.5)*, *raw_main_stick: tuple[int*, *int]=(0*, *0)*, *l_shoulder: float = 0*, *r_shoulder: float = 0*)**

A snapshot of the state of a virtual controller

**button: dict[[Button](enums.html#melee.enums.Button), bool]**

**c_stick: tuple[float, float]**

The raw unprocessed main stick coordinates. Ranges from -128 -> 127. 0 is neutral.

**Type:**

(pair of ints)

**l_shoulder: float**

L shoulder analog press. Ranges from 0 (not pressed) to 1 (fully pressed)

**Type:**

(float)

**main_stick: tuple[float, float]**

The C stick’s x,y position. Ranges from 0->1, 0.5 is neutral

**Type:**

(pair of floats)

**processed_button: dict[[Button](enums.html#melee.enums.Button), bool]**

The main stick’s x,y position. Ranges from 0->1, 0.5 is neutral

**Type:**

(pair of floats)

**r_shoulder: float**

R shoulder analog press. Ranges from 0 (not pressed) to 1 (fully pressed)

**Type:**

(float)

**raw_main_stick: tuple[int, int]**

**melee.controller.fix_analog_stick(*x: float*) → float**

Fixes the analog stick values to match Console.step output.

**melee.controller.fix_analog_trigger(*x: float*) → float**

Fixes the analog trigger values to match Console.step output.
