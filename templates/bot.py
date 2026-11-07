"""Team A's bot: approach the nearest opponent and attack."""

from __future__ import annotations

import melee


class Bot:
    def __init__(self, port: int):
        self.port = port

    def get_character(self) -> melee.Character:
        # Change this value to switch characters. Valid choices are:
        # MARIO, FOX, CPTFALCON, DK, KIRBY, BOWSER, LINK, SHEIK,
        # NESS, PEACH, POPO, PIKACHU, SAMUS, YOSHI, JIGGLYPUFF,
        # MEWTWO, LUIGI, MARTH, ZELDA, YLINK, DOC, FALCO, PICHU,
        # GAMEANDWATCH, GANONDORF, and ROY.
        # Use melee.Character.NAME, for example melee.Character.FALCO.
        # NANA, wireframe characters, GIGA_BOWSER, SANDBAG, and
        # UNKNOWN_CHARACTER are not valid independent selections.
        return melee.Character.FOX

    def act(self, gamestate, controller) -> None:
        me = gamestate.players.get(self.port)
        if me is None:
            return

        # Try to return to the stage instead of chasing while off the edge.
        if me.off_stage:
            toward_stage = 1.0 if me.position.x < 0 else 0.0
            if me.action in (melee.Action.EDGE_CATCHING, melee.Action.EDGE_HANGING):
                controller.tilt_analog(melee.Button.BUTTON_MAIN, toward_stage, 1.0)
            elif me.jumps_left > 0:
                controller.tilt_analog(melee.Button.BUTTON_MAIN, toward_stage, 0.5)
                if gamestate.frame % 12 == 0:
                    controller.press_button(melee.Button.BUTTON_X)
            else:
                controller.tilt_analog(melee.Button.BUTTON_MAIN, toward_stage, 1.0)
                if gamestate.frame % 30 == 0:
                    controller.press_button(melee.Button.BUTTON_B)
            return

        # Don't chase an eliminated player or follow an opponent off the stage.
        opponents = [
            player for port, player in gamestate.players.items()
            if port != self.port and player.stock > 0 and not player.off_stage
        ]
        if not opponents:
            return
        opponent = min(
            opponents,
            key=lambda player: (player.position.x - me.position.x) ** 2
            + (player.position.y - me.position.y) ** 2,
        )
        dx = opponent.position.x - me.position.x
        dy = opponent.position.y - me.position.y

        # Run closer or turn to face the opponent, then attack periodically.
        if abs(dx) > 10 or (abs(dx) > 0.1 and (dx > 0) != me.facing):
            controller.tilt_analog(melee.Button.BUTTON_MAIN, 1.0 if dx > 0 else 0.0, 0.5)
        if dy > 10 and me.on_ground and gamestate.frame % 45 == 0:
            controller.press_button(melee.Button.BUTTON_X)
        if abs(dx) < 16 and abs(dy) < 16 and (gamestate.frame + self.port * 5) % 20 == 0:
            controller.press_button(melee.Button.BUTTON_A)
