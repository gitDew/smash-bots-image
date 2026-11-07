<!-- Markdown snapshot generated from the rendered libmelee documentation. -->

# Logger

> A custom logger for a console. Writes the gametstate out to a CSV file so you can retroactively view the game frame-by-frame
>
> **class melee.logger.Logger**
>
> A custom logger for a console. Writes the gametstate out to a CSV file each frame so you can retroactively view the game frame-by-frame
>
> **log(*column*, *contents*, *concat=False*)**
>
> Write ‘contents’ to the log at given ‘column’
>
> **Parameters:**
>
> - **column** (*str*) – The column to write the log message at
> - **contents** (*str*) – The thing to write to the log
> - **concat** (*bool*) – Should we concatenate the contents to the existing log at that column (or replace it)
>
> **logframe(*gamestate*)**
>
> Log any common per-frame things
>
> **Parameters:**
>
> **gamestate** ([*gamestate.GameState*](gamestate.html#melee.gamestate.GameState)) – A gamestate object to log
>
> **skipframe()**
>
> Skip this frame in the log
>
> **writeframe()**
>
> Write the current frame to the log and move to a new frame
>
> **writelog()**
>
> Write the log to file
