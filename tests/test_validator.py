"""Trusted-fixture unit tests only. Production source runs in Docker, never here."""

from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import melee

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "validator"))
from policy import check_source
from run_bot import exercise, RecordingController, selectable
import worker

STARTER = (ROOT / "templates/bot.py").read_text(encoding="utf-8")


class BotPolicyTests(unittest.TestCase):
    def test_starter_passes_interface_and_multiplayer_controller_smoke_test(self):
        check_source(STARTER)
        result = exercise(STARTER)
        self.assertTrue(result["ok"])
        self.assertEqual(result["checks"], 9360)

    def test_safe_helpers_and_bot_private_state_are_allowed(self):
        source = STARTER.replace("import melee", "import melee\nimport math\nimport random\nfrom collections import deque")
        source = source.replace("self.port = port", "self.port = port\n        self._history = deque(maxlen=10)")
        check_source(source)

    def test_no_network_files_processes_or_dynamic_python_access(self):
        snippets = [
            "import os", "import socket", "import subprocess", "import pathlib",
            "from melee import Console", "from dataclasses import sys", "from melee import *",
            "open('/tmp/evil', 'w')", "eval('1')", "exec('1')", "globals()",
            "getattr(melee, 'Console')", "melee.Console()", "melee.Controller(None, 1)",
            "melee.FrameData(write=True)", "melee.FrameData(True)", "melee.Logger()",
            "melee.Character.FOX = 1", "import random\nrandom.random = 1", "melee.__dict__",
            "from melee import FrameData as FD\nFD(write=True)",
            "import typing\ntyping.get_type_hints(object)",
            "from typing import get_type_hints as evaluate",
        ]
        for snippet in snippets:
            with self.subTest(snippet=snippet):
                with self.assertRaises((ValueError, SyntaxError)):
                    check_source(snippet + "\n" + STARTER)

    def test_no_controller_lifecycle_state_mutation_or_async_act(self):
        for statement in [
            "controller.flush()", "controller.disconnect()", "controller.connect()",
            "gamestate.players = {}", "controller.current.main_stick = (9, 9)",
            "self.__class__", "melee.framedata.os",
        ]:
            with self.subTest(statement=statement), self.assertRaises(ValueError):
                check_source(STARTER.replace("me = gamestate.players.get(self.port)", statement))
        with self.assertRaises(ValueError):
            check_source(STARTER.replace("def act(", "async def act("))
        with self.assertRaises(ValueError):
            check_source(STARTER + "\nclass Bot: pass\n")

    def test_syntax_missing_methods_and_size_limits(self):
        with self.assertRaises(SyntaxError):
            check_source("class Bot(:")
        with self.assertRaises(ValueError):
            check_source("class Bot: pass")
        with self.assertRaises(ValueError):
            check_source("#" * 32769 + STARTER)
        with self.assertRaises(ValueError):
            check_source("#\n" * 2001 + STARTER)

    def test_character_selection_matches_runner_including_sheik(self):
        self.assertTrue(selectable(melee.Character.FOX))
        self.assertTrue(selectable(melee.Character.SHEIK))
        for character in ["FOX", None, melee.Character.NANA, melee.Character.GIGA_BOWSER, melee.Character.SANDBAG, melee.Character.UNKNOWN_CHARACTER]:
            self.assertFalse(selectable(character))
        for bad in ["'FOX'", "melee.Character.NANA"]:
            with self.assertRaisesRegex(ValueError, "selectable"):
                exercise(STARTER.replace("return melee.Character.FOX", f"return {bad}"))

    def test_bad_controller_inputs_and_runtime_errors_are_caught(self):
        with self.assertRaises(ValueError):
            exercise(STARTER.replace("1.0 if dx > 0 else 0.0, 0.5", "99.0, 0.5"))
        with self.assertRaises(AttributeError):
            exercise(STARTER.replace("me.position.x", "me.does_not_exist"))
        with self.assertRaisesRegex(ValueError, r"act\(\) must return None"):
            exercise(STARTER.replace("me = gamestate.players.get(self.port)", "return 42\n        me = gamestate.players.get(self.port)"))

    def test_strict_controller_supports_real_api_and_rejects_invalid_values(self):
        controller = RecordingController(1)
        controller.tilt_analog(melee.Button.BUTTON_C, 0, 1)
        controller.tilt_analog_unit(melee.Button.BUTTON_MAIN, -1, 1)
        controller.press_shoulder(melee.Button.BUTTON_L, 0.5)
        controller.press_button(melee.Button.BUTTON_A)
        controller.check()
        controller.next_frame()
        self.assertEqual(controller.current.main_stick, (0.5, 0.5))
        self.assertTrue(controller.prev.button[melee.Button.BUTTON_A])
        for value in [float("nan"), float("inf"), -0.1, 1.1, "0.5"]:
            with self.assertRaises(ValueError):
                controller.tilt_analog(melee.Button.BUTTON_MAIN, value, 0.5)
        with self.assertRaises(ValueError):
            controller.press_button(melee.Button.BUTTON_MAIN)
        with self.assertRaises(ValueError):
            controller.press_button("A")
        with self.assertRaises(ValueError):
            controller.press_shoulder(melee.Button.BUTTON_A, 0.5)

    def test_worker_never_falls_back_to_running_source_on_the_host(self):
        with patch.object(worker.sys, "platform", "darwin"), patch.object(worker.subprocess, "Popen") as process:
            with self.assertRaisesRegex(RuntimeError, "never fall back"):
                worker.sandbox_command(["python3", "-c", "print('not executed')"], "")
            process.assert_not_called()

    def test_parent_rejects_invalid_source_or_wrong_digest_without_execution(self):
        with patch.object(worker, "sandbox_command") as process:
            result = worker.verify_source(STARTER, "wrong hash")
            self.assertFalse(result["ok"])
            process.assert_not_called()
        source = "import os\n" + STARTER
        with patch.object(worker, "sandbox_command") as process:
            import hashlib
            result = worker.verify_source(source, hashlib.sha256(source.encode()).hexdigest())
            self.assertFalse(result["ok"])
            process.assert_not_called()


if __name__ == "__main__":
    unittest.main()
