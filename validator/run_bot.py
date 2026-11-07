"""Trusted smoke-test harness, executed as an unprivileged disposable child.

No Dolphin or game ISO is needed. This exercises actual libmelee state/enums and
strict controller inputs; it cannot prove every possible real match will work.
"""

import contextlib
import copy
import hashlib
import json
import math
import numbers
import pickle
import sys
import types

import melee


class QuietOutput:
    def write(self, text):
        return len(text)

    def flush(self):
        pass


def analog(value, low=0.0, high=1.0):
    if not isinstance(value, numbers.Real) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"Analog input must be a finite number from {low} to {high}; got {value!r}.")
    return float(value)


class RecordingController:
    """Only the in-game controller methods a team bot is allowed to use."""

    def __init__(self, port):
        self.port = port
        self.current = melee.ControllerState()
        self.prev = melee.ControllerState()
        self.calls = 0

    def called(self):
        self.calls += 1
        if self.calls > 256:
            raise ValueError("Too many controller calls in one frame; keep act() small.")

    def digital(self, button):
        if not isinstance(button, melee.Button) or button in (melee.Button.BUTTON_MAIN, melee.Button.BUTTON_C):
            raise ValueError("press/release_button needs a digital melee.Button, not an analog stick.")

    def press_button(self, button):
        self.called()
        self.digital(button)
        self.current.button[button] = True

    def release_button(self, button):
        self.called()
        self.digital(button)
        self.current.button[button] = False

    def tilt_analog(self, button, x, y):
        self.called()
        position = (analog(x), analog(y))
        if button is melee.Button.BUTTON_MAIN:
            self.current.main_stick = position
        elif button is melee.Button.BUTTON_C:
            self.current.c_stick = position
        else:
            raise ValueError("tilt_analog needs BUTTON_MAIN or BUTTON_C.")

    def tilt_analog_unit(self, button, x, y):
        self.tilt_analog(button, (analog(x, -1, 1) + 1) / 2, (analog(y, -1, 1) + 1) / 2)

    def press_shoulder(self, button, amount):
        self.called()
        if button is melee.Button.BUTTON_L:
            self.current.l_shoulder = analog(amount)
        elif button is melee.Button.BUTTON_R:
            self.current.r_shoulder = analog(amount)
        else:
            raise ValueError("press_shoulder needs BUTTON_L or BUTTON_R.")

    def release_all(self):
        self.called()
        self.current = melee.ControllerState()

    def empty_input(self):
        self.release_all()

    def simple_press(self, x, y, button):
        self.release_all()
        self.tilt_analog(melee.Button.BUTTON_MAIN, x, y)
        if button is not None:
            self.press_button(button)

    def next_frame(self):
        self.prev = copy.deepcopy(self.current)
        self.current = melee.ControllerState()
        self.calls = 0

    def check(self):
        for stick in (self.current.main_stick, self.current.c_stick):
            if len(stick) != 2:
                raise ValueError("Analog sticks must contain x and y.")
            for value in stick:
                analog(value)
        analog(self.current.l_shoulder)
        analog(self.current.r_shoulder)
        if any(not isinstance(button, melee.Button) or not isinstance(pressed, bool) for button, pressed in self.current.button.items()):
            raise ValueError("Controller button state must use melee.Button keys and boolean values.")


def selectable(character):
    # Same selection rule as the current arena runner, including Sheik's shared slot.
    if not isinstance(character, melee.Character):
        return False
    if character is melee.Character.SHEIK:
        return True
    css_id = melee.from_internal(character)
    return css_id != 0xFF and melee.to_internal(css_id) is character


STAGES = (
    melee.Stage.FINAL_DESTINATION, melee.Stage.BATTLEFIELD, melee.Stage.DREAMLAND,
    melee.Stage.FOUNTAIN_OF_DREAMS, melee.Stage.POKEMON_STADIUM, melee.Stage.YOSHIS_STORY,
)
SCENARIOS = (
    "approach", "close", "platform", "airborne", "left_recovery", "right_recovery",
    "no_jumps", "ledge", "hitstun", "eliminated", "missing_opponents", "missing_self", "projectile",
)


def game_state(port, count, character, stage, scenario, frame):
    ports = [port] + [other for other in range(1, 5) if other != port][:count - 1]
    players = {
        player_port: melee.PlayerState(
            character=character if player_port == port else melee.Character.FOX,
            position=melee.Position(x=0 if player_port == port else (index * 40) * (-1 if index % 2 else 1), y=0),
            stock=4, percent=(frame + player_port) % 130, facing=bool(frame % 2),
            action=melee.Action.STANDING, action_frame=1 + frame % 10,
            on_ground=True, jumps_left=2,
        ) for index, player_port in enumerate(ports)
    }
    me = players[port]
    opponent = players[ports[1]]
    if scenario == "close":
        opponent.position.x = 5
    elif scenario == "platform":
        opponent.position.x, opponent.position.y = 5, 25
        opponent.on_ground = True
    elif scenario == "airborne":
        me.position.y, me.on_ground, me.action = 20, False, melee.Action.FALLING
    elif scenario in ("left_recovery", "right_recovery", "no_jumps", "ledge"):
        me.position.x = -95 if scenario != "right_recovery" else 95
        me.position.y, me.off_stage, me.on_ground = -25, True, False
        me.jumps_left = 0 if scenario == "no_jumps" else 1
        me.action = melee.Action.EDGE_HANGING if scenario == "ledge" else melee.Action.FALLING
    elif scenario == "hitstun":
        me.hitstun_frames_left, me.hitlag_left = 10, 2
    elif scenario == "eliminated":
        for other_port in ports[1:]:
            players[other_port].stock = 0
    elif scenario == "missing_opponents":
        players = {port: me}
    elif scenario == "missing_self":
        del players[port]
    state = melee.GameState(frame=frame, stage=stage, players=players)
    if scenario == "projectile":
        state.projectiles = [melee.Projectile(
            owner=ports[1], position=melee.Position(x=15, y=5),
            speed=melee.Position(x=-1, y=0), type=melee.ProjectileType.FOX_LASER,
        )]
    return state


def exercise(source):
    module = types.ModuleType("team_bot")
    # dataclass decorators expect their module to be registered.
    sys.modules[module.__name__] = module
    with contextlib.redirect_stdout(QuietOutput()), contextlib.redirect_stderr(QuietOutput()):
        exec(compile(source, "bot.py", "exec"), module.__dict__)
        bot_class = getattr(module, "Bot", None)
        if not isinstance(bot_class, type):
            raise ValueError("Bot must be a class.")
        checks = 0
        for port in range(1, 5):
            bot = bot_class(port=port)
            character = bot.get_character()
            if not selectable(character):
                raise ValueError("get_character() must return a selectable melee.Character enum (not a string, NANA, or a special character).")
            controller = RecordingController(port)
            for count in (2, 3, 4):
                for stage in STAGES:
                    for scenario in SCENARIOS:
                        for _ in range(10):
                            frame = checks
                            state = game_state(port, count, character, stage, scenario, frame)
                            original = pickle.dumps(state)
                            returned = bot.act(state, controller)
                            if returned is not None:
                                raise ValueError("act() must return None, not a coroutine, generator, or value.")
                            controller.check()
                            if pickle.dumps(state) != original:
                                raise ValueError("Do not mutate gamestate; it is shared between bots.")
                            controller.next_frame()
                            checks += 1
        return {"ok": True, "checks": checks, "message": f"Passed syntax/policy/interface and {checks} simulated frames across ports 1–4, 2–4 players, six stages, recovery, elimination, and controller inputs."}


def main():
    request = json.loads(sys.stdin.read(128 * 1024))
    source = request["code"]
    try:
        result = exercise(source)
    except BaseException as error:
        # A small actionable message, never an arbitrary traceback or file contents.
        result = {"ok": False, "message": f"{error.__class__.__name__}: {str(error)[:700]}"}
    result["sha256"] = hashlib.sha256(source.encode("utf-8")).hexdigest()
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
