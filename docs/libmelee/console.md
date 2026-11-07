<!-- Markdown snapshot generated from the rendered libmelee documentation. -->

# Console

The Console represents the engine running the game.

This can be Dolphin (Slippi’s Ishiiruka) or an SLP file. The Console object is your method to start and stop Dolphin, set configs, and get the latest GameState.

**class melee.console.Console(*path: str | None = None*, *is_dolphin: bool = True*, *is_remote: bool = False*, *dolphin_home_path: str | None = None*, *tmp_home_directory: bool = True*, *copy_home_directory: bool = False*, *slippi_address: str = '127.0.0.1'*, *slippi_port: int = 51441*, *online_delay: int = 0*, *blocking_input: bool = False*, *polling_mode: bool = False*, *polling_timeout: float = 0*, *skip_rollback_frames: bool = True*, *allow_old_version: bool = False*, *logger=None*, *setup_gecko_codes: bool = True*, *fullscreen: bool = True*, *gfx_backend: str = ''*, *disable_audio: bool = False*, *audio_backend: str = ''*, *overclock: float | None = None*, *emulation_speed: float = 1.0*, *save_replays: bool = True*, *replay_dir: str | None = None*, *replay_monthly_folders: bool | None = None*, *user_json_path: str | None = None*, *log_level: int = 3*, *log_types: list[str] = ['SLIPPI']*, *infinite_time: bool = False*, *instant_match_restart: bool = False*, *use_exi_inputs: bool = False*, *enable_ffw: bool = False*, *dump_config: DumpConfig | None = None*, *debug: bool = False*)**

The console object that represents your Dolphin / Wii / SLP file

**connect()**

Connects to the Slippi server (dolphin or wii).

**Returns:**

True is successful, False otherwise

**get_dolphin_pipes_path(*port*)**

Get the path of the named pipe input file for the given controller port

**nick**

The nickname the console has given itself.

**Type:**

(str)

**run(*iso_path: str | None = None*, *dolphin_user_path: str | None = None*, *environment_vars: dict | None = None*, *platform: str | None = None*)**

Run the Dolphin emulator.

This starts the Dolphin process, so don’t run this if you’re connecting to an already running Dolphin instance.

**Parameters:**

- **iso_path** (*str**,**optional*) – Path to Melee ISO for dolphin to read
- **dolphin_user_path** (*str**,**optional*) – Alternative user path for dolphin if not using the default
- **environment_vars** (*dict**,**optional*) – Dict (string->string) of environment variables to set
- **exe_name** (*str**,**optional*) – Name of the dolphin executable.
- **platform** (*str**,**optional*) – Set to “headless” to run dolphin in headless mode. Default is typically gui, depending on how dolphin was built. Only applies to mainline dolphin; Ishiiruka bakes the platform into the executable at compilation time.

**setup_dolphin_controller(*port*, *controllertype=ControllerType.STANDARD*)**

Setup the necessary files for dolphin to recognize the player at the given controller port and type

**slippi_address**

IP address of the Dolphin / Wii to connect to.

**Type:**

(str)

**slippi_port**

UDP port of slippi server. Default 51441

**Type:**

(int)

**slp_version_tuple: tuple[int, int, int] | None**

The SLP version this stream/file currently is.

**Type:**

(str)

**step() → [GameState](gamestate.html#melee.gamestate.GameState) | None**

‘step’ to the next state of the game and flushes all controllers

**Returns:**

GameState object that represents new current state of the game.

**stop()**

Stop the console.

For Dolphin instances, this will kill the dolphin process. For Wiis and SLP files, it just shuts down our connection

**version**

The Slippi version of the console

**Type:**

(str)

**class melee.console.DolphinBuild(**values*)**

**EXI_AI = 3**

**NETPLAY = 1**

**PLAYBACK = 2**

**class melee.console.DolphinInfo(*install_dir: str*, *is_mainline: bool*, *settings: dict*, *home_path: str*, *iso_path: str | None*)**

**home_path: str**

**install_dir: str**

**is_mainline: bool**

**iso_path: str | None**

**settings: dict**

**class melee.console.DolphinVersion(*mainline: bool*, *version: str*, *build: melee.console.DolphinBuild*)**

**build: DolphinBuild**

**mainline: bool**

**version: str**

**class melee.console.DumpConfig(*dump: bool = False*, *format: str | None = None*, *codec: str | None = None*, *encoder: str | None = None*, *path: str | None = None*)**

**codec: str | None = None**

**dump: bool = False**

**encoder: str | None = None**

**format: str | None = None**

**path: str | None = None**

**update_gfx_ini(*gfx_ini: ConfigParser*)**

**exception melee.console.InvalidDolphinPath(*message*)**

Raised when given path to Dolphin is invalid

**exception melee.console.SlippiVersionTooLow(*message*)**

Raised when the Slippi version is not recent enough

**melee.console.default_dolphin_info() → DolphinInfo**

**melee.console.default_dolphin_install_path() → tuple[str, bool]**

**melee.console.get_dolphin_version(*path: str*) → DolphinVersion**

**melee.console.get_exe_path(*path: str*) → str**

Return the path to the dolphin executable

**melee.console.read_byte(*event_bytes: bytes*, *offset: int*)**

**melee.console.read_shift_jis(*event_bytes: bytes*, *offset: int*)**

**melee.console.slippi_launcher_path() → str**
