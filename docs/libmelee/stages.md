<!-- Markdown snapshot generated from the rendered libmelee documentation. -->

# Stages

Stages has some helper functions and variables related to stage information.

Stages is a collection of helper data for information regarding stages

**melee.stages.BLASTZONES = {Stage.BATTLEFIELD: (-224, 224, 200, -108.8), Stage.DREAMLAND: (-255, 255, 250, -123), Stage.FINAL_DESTINATION: (-246, 246, 188, -140), Stage.FOUNTAIN_OF_DREAMS: (-198.75, 198.75, 202.5, -146.25), Stage.POKEMON_STADIUM: (-230, 230, 180, -111), Stage.YOSHIS_STORY: (-175.7, 173.6, 168, -91)}**

Get the X coordinate of the edge of the stage, approaching from off_stage IE: This is your X coordinate when hanging on the edge NOTE: The left edge is always the same, but negative

**melee.stages.EDGE_POSITION = {Stage.BATTLEFIELD: 71.3078536987, Stage.DREAMLAND: 80.1791534424, Stage.FINAL_DESTINATION: 88.4735488892, Stage.FOUNTAIN_OF_DREAMS: 66.2554016113, Stage.POKEMON_STADIUM: 90.657852, Stage.YOSHIS_STORY: 58.907848}**

Get the X coordinate of the edge of the stage, while standing on the stage IE: This is your X coordinate when teetering on the edge NOTE: The left edge is always the same, but negative

**melee.stages.left_platform_position(*stage*)**

Gets the position of the left platform

**Parameters:**

**(****enums.Stage****)** – The current stage

**Returns:**

Tuple of height, left edge, right edge

**Return type:**

(float, float, float)

**melee.stages.randall_position(*frame: int*) → tuple[float, float, float]**

Gets the current position of Randall

**Parameters:**

**(****int****)** – The frame you’d like to know position for

Note

The values returned here are not EXACT. But they’re at most off by .001 in practice The reason is that Randall’s location is not easily read from in-game memory. So we have to exprapolate it on our own. But unfortunately, it doesn’t move very regularly.

**Returns:**

(height, x_left, x_right)

**Return type:**

(float, float, float)

**melee.stages.right_platform_position(*stage*)**

Gets the position of the right platform

**Parameters:**

**(****enums.Stage****)** – The current stage

**Returns:**

Tuple of height, left edge, right edge

**Return type:**

(float, float, float)

**melee.stages.side_platform_position(*right_platform*, *stage*)**

Gets the position of the specified side platform

**Parameters:**

- **(****bool****)** – Is it the right platform?
- **(****enums.Stage****)** – The current stage

**Returns:**

Tuple of height, left edge, right edge

**Return type:**

(float, float, float)

**melee.stages.top_platform_position(*stage*)**

Gets the position of the top platform

**Parameters:**

**(****enums.Stage****)** – The current stage

**Returns:**

Tuple of height, left edge, right edge. (None, None, None) if no platform

**Return type:**

(float, float, float)
